import type { LlmAvailability, LlmEvent, LlmPort, LlmRequest, ProfileApi, ProfileInfo } from '../core/assistant/ports';
import { classifyError, describeFailure } from '../core/assistant/failures';
import type {
    ConnectionProfile,
    ExtractedLlmData,
    LlmStreamFactory,
    SillyTavernContext,
} from '../global';

/**
 * The only module that talks to the app's LLM request service (spec 005 research
 * R1/R2/R7/R11). Requests run on the profile the user picked for the assistant —
 * never on the main chat connection, never with plugin-held credentials, and
 * always cancellable. Contract: specs/005-ai-lore-assistant/contracts/llm-port.md.
 */

const CONNECTION_MANAGER = 'connection-manager';
const PROGRESS_THROTTLE_MS = 100;
const STREAM_IDLE_TIMEOUT_MS = 90000;
const BLOCKING_TIMEOUT_MS = 180000;

const PROFILE_EVENTS = [
    'CONNECTION_PROFILE_CREATED',
    'CONNECTION_PROFILE_UPDATED',
    'CONNECTION_PROFILE_DELETED',
] as const;

function isStreamFactory(value: ExtractedLlmData | LlmStreamFactory): value is LlmStreamFactory {
    return typeof value === 'function';
}

function apiOf(profile: ConnectionProfile): ProfileApi {
    return profile.mode === 'tc' ? 'text-completion' : 'chat-completion';
}

function readBoolean(source: Record<string, unknown> | undefined, key: string): boolean | undefined {
    const value = source?.[key];
    return typeof value === 'boolean' ? value : undefined;
}

export function createLlmClient(getContext: () => SillyTavernContext): LlmPort {
    const isConnectionManagerDisabled = (): boolean => {
        const disabled = getContext().extensionSettings.disabledExtensions;
        return Array.isArray(disabled) && disabled.includes(CONNECTION_MANAGER);
    };

    /** Streaming follows the profile's own preset (R2), never a plugin toggle. */
    const resolveStreaming = (profile: ConnectionProfile): boolean => {
        const ctx = getContext();
        const api = apiOf(profile);
        const presetApiId = api === 'text-completion' ? 'textgenerationwebui' : 'openai';
        const flag = api === 'text-completion' ? 'streaming' : 'stream_openai';
        const preset =
            profile.preset !== undefined && profile.preset !== ''
                ? ctx.getPresetManager?.(presetApiId)?.getCompletionPresetByName(profile.preset)
                : undefined;
        const fromPreset = readBoolean(preset, flag);
        if (fromPreset !== undefined) {
            return fromPreset;
        }
        const globalSettings =
            api === 'text-completion' ? ctx.textCompletionSettings : ctx.chatCompletionSettings;
        return readBoolean(globalSettings, flag) ?? false;
    };

    const toProfileInfo = (profile: ConnectionProfile): ProfileInfo => {
        const api = apiOf(profile);
        const info: ProfileInfo = {
            id: profile.id,
            name: profile.name,
            api,
            model: profile.model ?? '',
            streaming: resolveStreaming(profile),
        };
        if (api === 'text-completion') {
            info.hasInstructTemplate = profile.instruct !== undefined && profile.instruct !== '';
        }
        return info;
    };

    return {
        availability(): LlmAvailability {
            if (isConnectionManagerDisabled()) {
                return { state: 'connection-manager-disabled' };
            }
            const service = getContext().ConnectionManagerRequestService;
            if (!service) {
                return { state: 'connection-manager-disabled' };
            }
            try {
                return { state: 'ready', profiles: service.getSupportedProfiles().map(toProfileInfo) };
            } catch {
                return { state: 'connection-manager-disabled' };
            }
        },

        onProfilesChanged(listener: () => void): () => void {
            const ctx = getContext();
            const handler = (): void => listener();
            for (const name of PROFILE_EVENTS) {
                const event = ctx.eventTypes[name];
                if (typeof event === 'string') {
                    ctx.eventSource.on(event, handler);
                }
            }
            return () => {
                for (const name of PROFILE_EVENTS) {
                    const event = ctx.eventTypes[name];
                    if (typeof event === 'string') {
                        ctx.eventSource.removeListener(event, handler);
                    }
                }
            };
        },

        async run(request: LlmRequest, onEvent: (event: LlmEvent) => void): Promise<void> {
            const ctx = getContext();
            if (isConnectionManagerDisabled() || !ctx.ConnectionManagerRequestService) {
                onEvent({ type: 'failed', failure: describeFailure('connection-manager-disabled') });
                return;
            }
            const service = ctx.ConnectionManagerRequestService;
            let profile: ConnectionProfile;
            try {
                profile = service.getProfile(request.profileId);
            } catch (error) {
                onEvent({ type: 'failed', failure: classifyError(error, {}) });
                return;
            }
            const streaming = resolveStreaming(profile);
            // Own controller so the port can time out without touching the app's
            // generation abort controller (FR-029).
            const controller = new AbortController();
            const abortFromCaller = (): void => controller.abort();
            request.signal.addEventListener('abort', abortFromCaller, { once: true });
            let timedOut = false;
            let timer: ReturnType<typeof setTimeout> | undefined;
            const armTimeout = (ms: number): void => {
                if (timer !== undefined) {
                    clearTimeout(timer);
                }
                timer = setTimeout(() => {
                    timedOut = true;
                    controller.abort();
                }, ms);
            };
            const finish = (): void => {
                if (timer !== undefined) {
                    clearTimeout(timer);
                }
                request.signal.removeEventListener('abort', abortFromCaller);
            };

            onEvent({ type: 'started', streaming });
            armTimeout(streaming ? STREAM_IDLE_TIMEOUT_MS : BLOCKING_TIMEOUT_MS);
            try {
                const result = await service.sendRequest(
                    request.profileId,
                    request.messages,
                    request.maxTokens,
                    {
                        stream: streaming,
                        signal: controller.signal,
                        extractData: true,
                        includePreset: true,
                        includeInstruct: true,
                    }
                );
                if (!isStreamFactory(result)) {
                    const text = typeof result.content === 'string' ? result.content : String(result.content ?? '');
                    const reasoning = typeof result.reasoning === 'string' ? result.reasoning : '';
                    if (text.trim() === '') {
                        onEvent({ type: 'failed', failure: describeFailure('empty') });
                        return;
                    }
                    onEvent({ type: 'done', text, reasoning });
                    return;
                }
                let text = '';
                let reasoning = '';
                let lastProgressAt = 0;
                for await (const chunk of result()) {
                    text = chunk.text;
                    reasoning = chunk.state.reasoning;
                    armTimeout(STREAM_IDLE_TIMEOUT_MS);
                    const now = Date.now();
                    if (now - lastProgressAt >= PROGRESS_THROTTLE_MS) {
                        lastProgressAt = now;
                        onEvent({ type: 'progress', text, reasoning });
                    }
                }
                if (text.trim() === '') {
                    onEvent({ type: 'failed', failure: describeFailure('empty') });
                    return;
                }
                onEvent({ type: 'done', text, reasoning });
            } catch (error) {
                if (timedOut) {
                    onEvent({ type: 'failed', failure: describeFailure('timeout') });
                    return;
                }
                onEvent({
                    type: 'failed',
                    failure: classifyError(error, { aborted: request.signal.aborted }),
                });
            } finally {
                finish();
            }
        },
    };
}
