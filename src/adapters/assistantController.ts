import { describeFailure, retryPolicy } from '../core/assistant/failures';
import type { ChatContextPort, ConversationStorePort, LlmPort, ProfileInfo } from '../core/assistant/ports';
import { systemPrompt } from '../core/assistant/prompts';
import { canSaveAssistantSettings, setAssistantSettings } from '../core/assistant/settingsOps';
import type {
    AssistantFailure,
    AssistantMode,
    AssistantSettings,
    ContextSettings,
    Conversation,
    LlmMessage,
    Message,
} from '../core/assistant/types';
import { getAssistantSettings, type WorkspaceState } from '../core/state/schema';
import type { WorkspaceStore } from '../core/state/store';

/**
 * UI-facing assistant surface (spec 005): conversations, requests, streaming
 * state, failures and retries. The panel reads one immutable snapshot and calls
 * these actions; nothing else in the UI talks to the LLM or the store for
 * assistant concerns.
 */

export type AvailabilityState =
    | 'ready'
    | 'no-profile'
    | 'connection-manager-disabled';

export interface ActiveRequest {
    conversationId: string;
    seq: number;
}

export interface AssistantSnapshot {
    availability: AvailabilityState;
    profiles: ProfileInfo[];
    profile: ProfileInfo | null;
    settings: AssistantSettings;
    settingsLocked: boolean;
    storageAvailable: boolean;
    textCompletionWarning: boolean;
    conversations: Conversation[];
    activeConversationId: string | null;
    activeConversation: Conversation | null;
    messages: Message[];
    activeRequest: ActiveRequest | null;
}

export interface AssistantControllerDeps {
    store: WorkspaceStore;
    llm: LlmPort;
    conversations: ConversationStorePort;
    chat: ChatContextPort;
    newId: () => string;
    now: () => string;
    /** Assistant settings cannot be saved while a data recovery is unresolved. */
    isRecoveryPending: () => boolean;
    emit?: (event: string, payload: unknown) => void;
}

export interface AssistantController {
    subscribe(listener: () => void): () => void;
    getSnapshot(): AssistantSnapshot;
    init(): Promise<void>;
    createConversation(): Promise<string>;
    selectConversation(id: string): Promise<void>;
    renameConversation(id: string, title: string): Promise<void>;
    deleteConversation(id: string): Promise<void>;
    setMode(mode: AssistantMode): Promise<void>;
    updateSettings(patch: Partial<AssistantSettings>): boolean;
    resetInstructions(): boolean;
    saveContextAsDefault(): boolean;
    updateConversationContext(patch: Partial<ContextSettings>): Promise<void>;
    setSelection(nodeIds: readonly string[]): void;
    send(text: string): Promise<void>;
    stop(): void;
    retry(seq: number): Promise<void>;
    retryNow(seq: number): Promise<void>;
}

const TITLE_LIMIT = 60;

/** Snapshot for a request built before the US1 context builder exists. */
function emptySnapshot(requestMessages: LlmMessage[]): NonNullable<Message['context']> {
    return {
        handles: {},
        scopeNodeIds: [],
        included: {
            outline: false,
            fullItems: 0,
            chatMessages: 0,
            characterCard: false,
            persona: false,
            activatedEntries: 0,
        },
        omitted: [],
        estimatedTokens: 0,
        requestMessages,
    };
}

function conversationTitle(text: string): string {
    const trimmed = text.trim().replace(/\s+/g, ' ');
    if (trimmed === '') {
        return 'New conversation';
    }
    return trimmed.length > TITLE_LIMIT ? `${trimmed.slice(0, TITLE_LIMIT)}…` : trimmed;
}

export function createAssistantController(deps: AssistantControllerDeps): AssistantController {
    const listeners = new Set<() => void>();
    let conversations: Conversation[] = [];
    let messagesByConversation = new Map<string, Message[]>();
    let activeConversationId: string | null = null;
    let selection: string[] = [];
    let activeRequest: ActiveRequest | null = null;
    // Set SYNCHRONOUSLY when a request starts: a second send must be refused and
    // Stop must work before the first await has even run.
    let busy = false;
    let abortController: AbortController | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let snapshot: AssistantSnapshot | null = null;

    const settings = (): AssistantSettings => getAssistantSettings(deps.store.getState());

    const notify = (): void => {
        snapshot = null;
        for (const listener of listeners) {
            listener();
        }
    };

    const messagesOf = (conversationId: string): Message[] => {
        const existing = messagesByConversation.get(conversationId);
        if (existing) {
            return existing;
        }
        const created: Message[] = [];
        messagesByConversation.set(conversationId, created);
        return created;
    };

    const buildSnapshot = (): AssistantSnapshot => {
        const availability = deps.llm.availability();
        const current = settings();
        const profiles = availability.state === 'ready' ? availability.profiles : [];
        const profile = profiles.find((item) => item.id === current.profileId) ?? null;
        const state: AvailabilityState =
            availability.state === 'connection-manager-disabled'
                ? 'connection-manager-disabled'
                : profile
                  ? 'ready'
                  : 'no-profile';
        const active = conversations.find((item) => item.id === activeConversationId) ?? null;
        return {
            availability: state,
            profiles,
            profile,
            settings: current,
            settingsLocked: !canSaveAssistantSettings(deps.isRecoveryPending()),
            storageAvailable: deps.conversations.available(),
            textCompletionWarning: profile?.api === 'text-completion',
            conversations: [...conversations],
            activeConversationId,
            activeConversation: active,
            messages: active ? [...messagesOf(active.id)] : [],
            activeRequest,
        };
    };

    const putConversation = async (conversation: Conversation): Promise<void> => {
        const at = conversations.findIndex((item) => item.id === conversation.id);
        if (at >= 0) {
            conversations[at] = conversation;
        } else {
            conversations = [conversation, ...conversations];
        }
        await deps.conversations.putConversation(conversation);
    };

    const touchConversation = async (conversation: Conversation): Promise<Conversation> => {
        const next: Conversation = { ...conversation, updatedAt: deps.now() };
        await putConversation(next);
        return next;
    };

    const putMessage = async (message: Message): Promise<void> => {
        const bucket = messagesOf(message.conversationId);
        const at = bucket.findIndex((item) => item.seq === message.seq);
        if (at >= 0) {
            bucket[at] = message;
        } else {
            bucket.push(message);
            bucket.sort((a, b) => a.seq - b.seq);
        }
        await deps.conversations.putMessage(message);
    };

    const activeConversationOrThrow = (): Conversation => {
        const conversation = conversations.find((item) => item.id === activeConversationId);
        if (!conversation) {
            throw new Error('[WorldInfoWorkspace] no active assistant conversation');
        }
        return conversation;
    };

    /**
     * Foundational request messages: instructions + history + the new request.
     * The workspace context builder (US1) replaces this in `buildRequest`.
     */
    const historyMessages = (conversationId: string): LlmMessage[] =>
        messagesOf(conversationId)
            .filter((message) => message.status === 'received' || message.role === 'user' || message.role === 'note')
            .filter((message) => message.text.trim() !== '')
            .map((message) => ({
                role: message.role === 'assistant' ? ('assistant' as const) : message.role === 'note' ? ('system' as const) : ('user' as const),
                content: message.text,
            }));

    const runRequest = async (
        conversation: Conversation,
        assistantSeq: number,
        requestMessages: LlmMessage[]
    ): Promise<void> => {
        const current = settings();
        const availability = deps.llm.availability();
        if (availability.state !== 'ready') {
            await failMessage(conversation.id, assistantSeq, describeFailure('connection-manager-disabled'));
            return;
        }
        const profile = availability.profiles.find((item) => item.id === current.profileId);
        if (!profile || current.profileId === null) {
            await failMessage(conversation.id, assistantSeq, describeFailure('profile'));
            return;
        }
        const existing = messagesOf(conversation.id).find((item) => item.seq === assistantSeq);
        if (!existing) {
            return;
        }
        activeRequest = { conversationId: conversation.id, seq: assistantSeq };
        await putMessage({
            ...existing,
            status: 'pending',
            startedAt: deps.now(),
            failure: undefined,
            origin: {
                profileId: profile.id,
                profileName: profile.name,
                api: profile.api,
                model: profile.model,
            },
            // The context snapshot of a request already built by the US1 builder is
            // kept; the foundational path records just the messages it sent.
            context: existing.context ?? emptySnapshot(requestMessages),
        });
        notify();

        let failure: AssistantFailure | null = null;
        const controller = abortController ?? new AbortController();
        abortController = controller;
        await deps.llm.run(
            {
                profileId: profile.id,
                messages: requestMessages,
                maxTokens: current.responseTokens,
                signal: controller.signal,
            },
            (event) => {
                const message = messagesOf(conversation.id).find((item) => item.seq === assistantSeq);
                if (!message) {
                    return;
                }
                if (event.type === 'progress') {
                    void putMessage({
                        ...message,
                        status: 'receiving',
                        text: event.text,
                        reasoning: event.reasoning === '' ? undefined : event.reasoning,
                    });
                    notify();
                    return;
                }
                if (event.type === 'done') {
                    void putMessage({
                        ...message,
                        status: 'received',
                        text: event.text,
                        reasoning: event.reasoning === '' ? undefined : event.reasoning,
                    });
                    notify();
                    return;
                }
                if (event.type === 'failed') {
                    failure = event.failure;
                }
            }
        );

        activeRequest = null;
        if (failure) {
            await failMessage(conversation.id, assistantSeq, failure);
            return;
        }
        await deps.conversations.flush(conversation.id);
        notify();
    };

    const failMessage = async (
        conversationId: string,
        seq: number,
        failure: AssistantFailure
    ): Promise<void> => {
        const message = messagesOf(conversationId).find((item) => item.seq === seq);
        if (!message) {
            return;
        }
        const aborted = failure.kind === 'aborted';
        const attempt = message.retryAttempt ?? 0;
        const policy = aborted ? null : retryPolicy(failure.kind, attempt);
        if (policy) {
            const retryAt = new Date(Date.parse(deps.now()) + policy.delayMs).toISOString();
            await putMessage({
                ...message,
                status: 'retry-wait',
                failure,
                retryAt,
                retryAttempt: attempt + 1,
            });
            notify();
            if (retryTimer !== null) {
                clearTimeout(retryTimer);
            }
            retryTimer = setTimeout(() => {
                retryTimer = null;
                void retry(seq);
            }, policy.delayMs);
            return;
        }
        await putMessage({
            ...message,
            status: aborted ? 'stopped' : 'failed',
            failure: aborted ? undefined : failure,
            retryAt: undefined,
        });
        await deps.conversations.flush(conversationId);
        notify();
    };

    const requestMessagesFor = (conversation: Conversation, seq: number): LlmMessage[] => {
        const stored = messagesOf(conversation.id).find((item) => item.seq === seq);
        const fromSnapshot = stored?.context?.requestMessages;
        if (fromSnapshot && fromSnapshot.length > 0) {
            return fromSnapshot;
        }
        return [
            { role: 'system', content: systemPrompt(conversation.mode, settings().instructions) },
            ...historyMessages(conversation.id).filter((_, index) => index < seq),
        ];
    };

    const retry = async (seq: number): Promise<void> => {
        const conversation = conversations.find((item) => item.id === activeConversationId);
        if (!conversation || busy) {
            return;
        }
        busy = true;
        abortController = new AbortController();
        try {
            await runRequest(conversation, seq, requestMessagesFor(conversation, seq));
        } finally {
            busy = false;
            abortController = null;
        }
    };

    const sendInternal = async (trimmed: string): Promise<void> => {
        if (activeConversationId === null) {
            await create();
        }

        let conversation = activeConversationOrThrow();
        const userSeq = conversation.nextSeq;
        const assistantSeq = userSeq + 1;
        conversation = await touchConversation({
            ...conversation,
            nextSeq: assistantSeq + 1,
            title:
                messagesOf(conversation.id).length === 0
                    ? conversationTitle(trimmed)
                    : conversation.title,
        });
        await putMessage({
            conversationId: conversation.id,
            seq: userSeq,
            role: 'user',
            text: trimmed,
            status: 'received',
            mode: conversation.mode,
            createdAt: deps.now(),
        });
        await putMessage({
            conversationId: conversation.id,
            seq: assistantSeq,
            role: 'assistant',
            text: '',
            status: 'pending',
            mode: conversation.mode,
            createdAt: deps.now(),
        });
        notify();
        const requestMessages: LlmMessage[] = [
            { role: 'system', content: systemPrompt(conversation.mode, settings().instructions) },
            ...historyMessages(conversation.id),
        ];
        await runRequest(conversation, assistantSeq, requestMessages);
    };

    const create = async (): Promise<string> => {
        const current = settings();
        const conversation: Conversation = {
            id: deps.newId(),
            title: 'New conversation',
            createdAt: deps.now(),
            updatedAt: deps.now(),
            mode: 'propose',
            context: structuredClone(current.defaultContext),
            nextSeq: 0,
        };
        await putConversation(conversation);
        activeConversationId = conversation.id;
        messagesByConversation.set(conversation.id, []);
        notify();
        return conversation.id;
    };

    const writeSettings = (patch: Partial<AssistantSettings>): boolean => {
        if (!canSaveAssistantSettings(deps.isRecoveryPending())) {
            return false;
        }
        const next: WorkspaceState = setAssistantSettings(deps.store.getState(), patch);
        deps.store.replace(next);
        notify();
        return true;
    };

    const controller: AssistantController = {
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        getSnapshot() {
            if (!snapshot) {
                snapshot = buildSnapshot();
            }
            return snapshot;
        },
        async init() {
            conversations = await deps.conversations.listConversations();
            messagesByConversation = new Map();
            for (const conversation of conversations) {
                messagesByConversation.set(
                    conversation.id,
                    await deps.conversations.listMessages(conversation.id)
                );
            }
            activeConversationId = conversations[0]?.id ?? null;
            deps.llm.onProfilesChanged(notify);
            notify();
        },
        createConversation: create,
        async selectConversation(id) {
            if (!conversations.some((item) => item.id === id)) {
                return;
            }
            activeConversationId = id;
            if (!messagesByConversation.has(id)) {
                messagesByConversation.set(id, await deps.conversations.listMessages(id));
            }
            notify();
        },
        async renameConversation(id, title) {
            const conversation = conversations.find((item) => item.id === id);
            const trimmed = title.trim();
            if (!conversation || trimmed === '') {
                return;
            }
            await putConversation({ ...conversation, title: trimmed, updatedAt: deps.now() });
            notify();
        },
        async deleteConversation(id) {
            conversations = conversations.filter((item) => item.id !== id);
            messagesByConversation.delete(id);
            await deps.conversations.deleteConversation(id);
            if (activeConversationId === id) {
                activeConversationId = conversations[0]?.id ?? null;
            }
            notify();
        },
        async setMode(mode) {
            const conversation = conversations.find((item) => item.id === activeConversationId);
            if (!conversation) {
                return;
            }
            await putConversation({ ...conversation, mode, updatedAt: deps.now() });
            notify();
        },
        updateSettings: writeSettings,
        resetInstructions: () => writeSettings({ instructions: null }),
        saveContextAsDefault() {
            const conversation = conversations.find((item) => item.id === activeConversationId);
            if (!conversation) {
                return false;
            }
            return writeSettings({ defaultContext: structuredClone(conversation.context) });
        },
        async updateConversationContext(patch) {
            const conversation = conversations.find((item) => item.id === activeConversationId);
            if (!conversation) {
                return;
            }
            await putConversation({
                ...conversation,
                context: { ...conversation.context, ...patch },
                updatedAt: deps.now(),
            });
            notify();
        },
        setSelection(nodeIds) {
            selection = [...nodeIds];
        },
        async send(text) {
            const trimmed = text.trim();
            if (trimmed === '' || busy) {
                return;
            }
            busy = true;
            abortController = new AbortController();
            try {
                await sendInternal(trimmed);
            } finally {
                busy = false;
                abortController = null;
            }
        },
        stop() {
            // Stop cancels a pending automatic retry as well as a running request
            // (FR-026: retries are visible AND stoppable).
            if (retryTimer !== null) {
                clearTimeout(retryTimer);
                retryTimer = null;
            }
            if (activeConversationId !== null) {
                const waiting = messagesOf(activeConversationId).find(
                    (item) => item.status === 'retry-wait'
                );
                if (waiting) {
                    void putMessage({ ...waiting, status: 'failed', retryAt: undefined });
                    notify();
                }
            }
            abortController?.abort();
        },
        retry,
        async retryNow(seq) {
            if (retryTimer !== null) {
                clearTimeout(retryTimer);
                retryTimer = null;
            }
            await retry(seq);
        },
    };

    // `selection` is consumed by the US1 context builder; referenced here so the
    // foundational build keeps the setter meaningful.
    void selection;

    return controller;
}
