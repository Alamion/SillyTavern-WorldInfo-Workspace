import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLlmClient } from '../../src/adapters/llmClient';
import type { LlmEvent } from '../../src/core/assistant/ports';
import type {
    ConnectionManagerCustomParams,
    ConnectionProfile,
    ExtractedLlmData,
    LlmRequestMessage,
    LlmStreamFactory,
    SillyTavernContext,
} from '../../src/global';

/**
 * Contract test: the adapter's use of the app's request service mirrors
 * context/SillyTavern/public/scripts/extensions/shared.js:388-783 and
 * custom-request.js:481-531 (spec 005 contracts/llm-port.md).
 */

interface SendCall {
    profileId: string;
    prompt: LlmRequestMessage[] | string;
    maxTokens: number;
    custom?: ConnectionManagerCustomParams;
    overridePayload?: Record<string, unknown>;
}

const CC_PROFILE: ConnectionProfile = {
    id: 'p-cc',
    name: 'openrouter free provider',
    mode: 'cc',
    api: 'openrouter',
    preset: 'Default',
    model: 'openrouter/free',
};

const TC_PROFILE: ConnectionProfile = {
    id: 'p-tc',
    name: 'local kobold',
    mode: 'tc',
    api: 'koboldcpp',
    preset: 'Storywriter',
    model: 'local',
};

function createHost(options: {
    profiles?: ConnectionProfile[];
    disabled?: string[];
    presets?: Record<string, Record<string, unknown>>;
    result?: ExtractedLlmData | LlmStreamFactory | (() => never);
    error?: unknown;
}) {
    const calls: SendCall[] = [];
    const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    const profiles = options.profiles ?? [CC_PROFILE];
    const ctx = {
        eventTypes: {
            CONNECTION_PROFILE_CREATED: 'cp_created',
            CONNECTION_PROFILE_UPDATED: 'cp_updated',
            CONNECTION_PROFILE_DELETED: 'cp_deleted',
        } as unknown as SillyTavernContext['eventTypes'],
        eventSource: {
            on: (event: string, handler: (...args: unknown[]) => void) => {
                const bucket = listeners.get(event) ?? [];
                bucket.push(handler);
                listeners.set(event, bucket);
            },
            removeListener: (event: string, handler: (...args: unknown[]) => void) => {
                listeners.set(event, (listeners.get(event) ?? []).filter((item) => item !== handler));
            },
            makeFirst: () => undefined,
            makeLast: () => undefined,
            emit: async () => undefined,
        },
        extensionSettings: { disabledExtensions: options.disabled ?? [] },
        chatCompletionSettings: { stream_openai: false },
        textCompletionSettings: { streaming: false },
        getPresetManager: (apiId?: string) => ({
            getCompletionPresetByName: (name: string) =>
                options.presets?.[`${apiId ?? ''}:${name}`] ?? options.presets?.[name],
        }),
        ConnectionManagerRequestService: {
            getSupportedProfiles: () => profiles,
            getProfile: (id: string) => {
                const found = profiles.find((profile) => profile.id === id);
                if (!found) {
                    throw new Error('Profile not found');
                }
                return found;
            },
            sendRequest: async (
                profileId: string,
                prompt: LlmRequestMessage[] | string,
                maxTokens: number,
                custom?: ConnectionManagerCustomParams,
                overridePayload?: Record<string, unknown>
            ) => {
                calls.push({ profileId, prompt, maxTokens, custom, overridePayload });
                if (options.error !== undefined) {
                    throw options.error;
                }
                const result = options.result ?? { content: 'plain reply', reasoning: '' };
                return result as ExtractedLlmData | LlmStreamFactory;
            },
        },
    } as unknown as SillyTavernContext;
    return { ctx, calls, listeners };
}

function streamOf(chunks: Array<{ text: string; reasoning?: string }>): LlmStreamFactory {
    return () =>
        (async function* generate() {
            for (const chunk of chunks) {
                yield { text: chunk.text, state: { reasoning: chunk.reasoning ?? '' } };
            }
        })();
}

async function collect(
    run: (onEvent: (event: LlmEvent) => void) => Promise<void>
): Promise<LlmEvent[]> {
    const events: LlmEvent[] = [];
    await run((event) => events.push(event));
    return events;
}

describe('llmClient availability', () => {
    it('reports connection-manager-disabled without calling getSupportedProfiles', () => {
        const { ctx } = createHost({ disabled: ['connection-manager'] });
        const service = ctx.ConnectionManagerRequestService;
        const spy = vi.fn(() => {
            throw new Error('Connection Manager is not available');
        });
        if (service) {
            service.getSupportedProfiles = spy;
        }
        const client = createLlmClient(() => ctx);
        expect(client.availability()).toEqual({ state: 'connection-manager-disabled' });
        expect(spy).not.toHaveBeenCalled();
    });

    it('maps profiles and resolves streaming from the profile preset', () => {
        const { ctx } = createHost({
            profiles: [CC_PROFILE, TC_PROFILE],
            presets: { 'openai:Default': { stream_openai: true }, 'textgenerationwebui:Storywriter': { streaming: true } },
        });
        const availability = createLlmClient(() => ctx).availability();
        expect(availability.state).toBe('ready');
        if (availability.state !== 'ready') {
            return;
        }
        expect(availability.profiles[0]).toEqual({
            id: 'p-cc',
            name: 'openrouter free provider',
            api: 'chat-completion',
            model: 'openrouter/free',
            streaming: true,
        });
        expect(availability.profiles[1]).toMatchObject({
            api: 'text-completion',
            streaming: true,
            hasInstructTemplate: false,
        });
    });

    it('falls back to the global API setting when the preset is missing', () => {
        const { ctx } = createHost({ presets: {} });
        (ctx as unknown as { chatCompletionSettings: Record<string, unknown> }).chatCompletionSettings = {
            stream_openai: true,
        };
        const availability = createLlmClient(() => ctx).availability();
        expect(availability.state === 'ready' && availability.profiles[0]?.streaming).toBe(true);
    });

    it('subscribes and unsubscribes from profile events', () => {
        const { ctx, listeners } = createHost({});
        const client = createLlmClient(() => ctx);
        const off = client.onProfilesChanged(() => undefined);
        expect(listeners.get('cp_created')?.length).toBe(1);
        off();
        expect(listeners.get('cp_created')?.length).toBe(0);
    });
});

describe('llmClient run', () => {
    let signal: AbortSignal;
    beforeEach(() => {
        signal = new AbortController().signal;
    });

    it('sends the documented custom params and no override payload', async () => {
        const { ctx, calls } = createHost({ presets: { 'openai:Default': { stream_openai: false } } });
        const client = createLlmClient(() => ctx);
        const events = await collect((onEvent) =>
            client.run(
                { profileId: 'p-cc', messages: [{ role: 'user', content: 'hi' }], maxTokens: 1234, signal },
                onEvent
            )
        );
        expect(calls[0]).toMatchObject({
            profileId: 'p-cc',
            maxTokens: 1234,
            custom: {
                stream: false,
                extractData: true,
                includePreset: true,
                includeInstruct: true,
            },
        });
        expect(calls[0]?.overridePayload).toBeUndefined();
        expect(events.map((event) => event.type)).toEqual(['started', 'done']);
    });

    it('streams accumulated text and ends with exactly one done', async () => {
        const { ctx } = createHost({
            presets: { 'openai:Default': { stream_openai: true } },
            result: streamOf([
                { text: 'Hello' },
                { text: 'Hello world', reasoning: 'thinking' },
            ]),
        });
        const events = await collect((onEvent) =>
            createLlmClient(() => ctx).run(
                { profileId: 'p-cc', messages: [{ role: 'user', content: 'hi' }], maxTokens: 100, signal },
                onEvent
            )
        );
        const done = events.filter((event) => event.type === 'done');
        expect(done).toHaveLength(1);
        expect(done[0]).toEqual({ type: 'done', text: 'Hello world', reasoning: 'thinking' });
        expect(events[0]).toEqual({ type: 'started', streaming: true });
    });

    it('classifies a wrapped rate-limit error', async () => {
        const wrapped = new Error('API request failed');
        Object.assign(wrapped, { cause: new Error('Got response status 429') });
        const { ctx } = createHost({ error: wrapped });
        const events = await collect((onEvent) =>
            createLlmClient(() => ctx).run(
                { profileId: 'p-cc', messages: [], maxTokens: 10, signal },
                onEvent
            )
        );
        expect(events.at(-1)).toMatchObject({ type: 'failed', failure: { kind: 'rate-limit' } });
    });

    it('reports an unknown profile as a profile failure', async () => {
        const { ctx } = createHost({});
        const events = await collect((onEvent) =>
            createLlmClient(() => ctx).run(
                { profileId: 'nope', messages: [], maxTokens: 10, signal },
                onEvent
            )
        );
        expect(events).toEqual([
            {
                type: 'failed',
                failure: expect.objectContaining({ kind: 'profile', retryable: false }),
            },
        ]);
    });

    it('reports an empty reply', async () => {
        const { ctx } = createHost({ result: { content: '   ' } });
        const events = await collect((onEvent) =>
            createLlmClient(() => ctx).run(
                { profileId: 'p-cc', messages: [], maxTokens: 10, signal },
                onEvent
            )
        );
        expect(events.at(-1)).toMatchObject({ failure: { kind: 'empty' } });
    });

    it('reports thinking without an answer as a response-length problem (live run 2026-09-22)', async () => {
        const blocking = createHost({ result: { content: '', reasoning: 'Let me plan five entries…' } });
        const streamed = createHost({
            presets: { 'openai:Default': { stream_openai: true } },
            result: streamOf([{ text: '', reasoning: 'Let me plan' }]),
        });
        for (const { ctx } of [blocking, streamed]) {
            const events = await collect((onEvent) =>
                createLlmClient(() => ctx).run(
                    { profileId: 'p-cc', messages: [], maxTokens: 150, signal },
                    onEvent
                )
            );
            expect(events.at(-1)).toMatchObject({
                type: 'failed',
                failure: { kind: 'thinking-only', retryable: true },
            });
        }
    });

    it('reports an abort by the caller', async () => {
        const controller = new AbortController();
        const { ctx } = createHost({
            error: Object.assign(new Error('aborted'), { name: 'AbortError' }),
        });
        controller.abort();
        const events = await collect((onEvent) =>
            createLlmClient(() => ctx).run(
                { profileId: 'p-cc', messages: [], maxTokens: 10, signal: controller.signal },
                onEvent
            )
        );
        expect(events.at(-1)).toMatchObject({ failure: { kind: 'aborted' } });
    });

    it('times out a blocking request and aborts the underlying fetch', async () => {
        vi.useFakeTimers();
        let observed: AbortSignal | undefined;
        const { ctx } = createHost({});
        const service = ctx.ConnectionManagerRequestService;
        if (service) {
            service.sendRequest = (async (
                _profileId: string,
                _prompt: LlmRequestMessage[] | string,
                _maxTokens: number,
                custom?: ConnectionManagerCustomParams
            ) => {
                observed = custom?.signal ?? undefined;
                await new Promise<void>((resolve) => {
                    observed?.addEventListener('abort', () => resolve(), { once: true });
                });
                const error = new Error('aborted by timeout');
                error.name = 'AbortError';
                throw error;
            }) as typeof service.sendRequest;
        }
        const client = createLlmClient(() => ctx);
        const events: LlmEvent[] = [];
        const running = client.run(
            { profileId: 'p-cc', messages: [], maxTokens: 10, signal },
            (event) => events.push(event)
        );
        await vi.advanceTimersByTimeAsync(180001);
        await running;
        vi.useRealTimers();
        expect(observed?.aborted).toBe(true);
        expect(events.at(-1)).toMatchObject({ failure: { kind: 'timeout' } });
    });
});
