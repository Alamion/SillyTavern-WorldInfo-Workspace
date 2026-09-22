import { applyDeletion, applyProposals, undoAppliedBatch } from './assistantApply';
import { buildRequest } from '../core/assistant/context';
import { describeFailure, retryPolicy } from '../core/assistant/failures';
import { parseReply } from '../core/assistant/parser';
import { acceptAllSelection, applyOrder, canApplyAgain, withBlocked } from '../core/assistant/plan';
import { stalenessOf } from '../core/assistant/rules';
import { toProposals } from '../core/assistant/validate';
import { editMessage, type EditedReply } from '../core/assistant/editReply';
import { forkedMessage, showVariant, variantIndex, withNewVariant } from '../core/assistant/variants';
import type { SyncEngine } from './syncEngine';
import type { ApplyOutcome } from './assistantApply';
import type { ChatContextPort, ConversationStorePort, LlmPort, ProfileInfo } from '../core/assistant/ports';
import { systemPrompt } from '../core/assistant/prompts';
import { canSaveAssistantSettings, setAssistantSettings } from '../core/assistant/settingsOps';
import type {
    AppliedBatch,
    AppliedBatchUndone,
    AssistantFailure,
    AssistantMode,
    AssistantSettings,
    ContextSettings,
    Conversation,
    LlmMessage,
    Message,
    OperationProposal,
    ProposalBatch,
    ProposedValues,
} from '../core/assistant/types';
import { findNode, getAssistantSettings, type WorkspaceState } from '../core/state/schema';
import { fingerprintValues } from '../core/assistant/rules';
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
    sync: SyncEngine;
    /** Confirmation dialog for destructive proposals (FR-010). */
    confirm: (message: string) => Promise<boolean>;
    /** Ids tracked by the markdown link, for the delete disclosure. */
    trackedIds?: () => ReadonlySet<string>;
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
    /** The active conversation id, creating a conversation when there is none. */
    ensureConversation(): Promise<string>;
    selectConversation(id: string): Promise<void>;
    renameConversation(id: string, title: string): Promise<void>;
    deleteConversation(id: string): Promise<void>;
    setMode(mode: AssistantMode): Promise<void>;
    updateSettings(patch: Partial<AssistantSettings>): boolean;
    resetInstructions(): boolean;
    /**
     * Changes the active conversation's context. The result is also remembered as
     * the default for new conversations (owner request 2026-09-22), unless settings
     * are locked by a pending recovery.
     */
    updateConversationContext(patch: Partial<ContextSettings>): Promise<void>;
    setSelection(nodeIds: readonly string[]): void;
    /**
     * Sends a request. An empty text answers the last message when it is the
     * user's (after the replies below it were deleted) without adding anything.
     */
    send(text: string): Promise<void>;
    /** Whether an empty send would re-trigger the model (see `send`). */
    canAnswerLast(): boolean;
    stop(): void;
    retry(seq: number): Promise<void>;
    retryNow(seq: number): Promise<void>;
    /** Destructive confirmation and batch undo (FR-010, FR-015). */
    confirmDestructive(seq: number, proposalId: string): Promise<void>;
    /** Resolves with the undo result, or null when nothing was undone. */
    undoBatch(seq: number, appliedBatchId: string): Promise<AppliedBatchUndone | null>;
    /** Undoes every applied batch of a reply, newest first; the results are combined. */
    undoAll(seq: number): Promise<AppliedBatchUndone | null>;
    /** Proposal review (FR-009, FR-010, FR-013, FR-017). */
    accept(seq: number, proposalId: string): Promise<void>;
    acceptAll(seq: number): Promise<void>;
    deny(seq: number, proposalId: string): Promise<void>;
    denyAll(seq: number): Promise<void>;
    editProposal(seq: number, proposalId: string, values: ProposedValues): Promise<void>;
    refreshProposal(seq: number, proposalId: string): Promise<void>;
    feedback(seq: number, text: string, proposalId?: string): Promise<void>;
    continueReply(seq: number): Promise<void>;
    /** Generates a new version of a reply; earlier versions are kept (swipes). */
    regenerate(seq: number, options?: { sameContext?: boolean }): Promise<void>;
    /** Shows another stored version of a reply. */
    showVariant(seq: number, index: number): Promise<void>;
    askToFix(seq: number): Promise<void>;
    /** Removes one message from the conversation; applied changes stay in the workspace. */
    deleteMessage(seq: number): Promise<void>;
    /** Copies the messages up to `seq` into a new conversation and opens it. */
    forkConversation(seq: number): Promise<string | null>;
    /**
     * Replaces a message's text (owner request 2026-09-22). A reply is re-parsed;
     * its proposals and undo records are carried over (`core/assistant/editReply`).
     * Null when the message cannot be edited now.
     */
    editMessage(seq: number, text: string): Promise<EditedReply | null>;
}

const TITLE_LIMIT = 60;
const FORK_PREFIX = 'Fork: ';

const findNodeInState = findNode;
const fingerprintOf = fingerprintValues;

/** Snapshot for a request built before the US1 context builder exists. */
function emptySnapshot(requestMessages: LlmMessage[]): NonNullable<Message['context']> {
    return {
        handles: {},
        scopeNodeIds: [],
        included: {
            outline: false,
            outlineItems: 0,
            fullItems: 0,
            triggeredItems: 0,
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
        requestMessages: LlmMessage[],
        contextSnapshot?: NonNullable<Message['context']>
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
            context: contextSnapshot ?? existing.context ?? emptySnapshot(requestMessages),
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
                    // Blocks are parsed as they close, so proposals appear while
                    // the reply is still streaming (FR-002).
                    const streaming = parseReply(event.text, {});
                    void putMessage({
                        ...message,
                        status: 'receiving',
                        text: event.text,
                        prose: streaming.prose,
                        reasoning:
                            event.reasoning === '' ? streaming.reasoning || undefined : event.reasoning,
                    });
                    notify();
                    return;
                }
                if (event.type === 'done') {
                    const parsed = parseReply(event.text, { final: true });
                    const received: Message = {
                        ...message,
                        status: 'received',
                        text: event.text,
                        prose: parsed.prose,
                        reasoning:
                            event.reasoning === '' ? parsed.reasoning || undefined : event.reasoning,
                    };
                    const batch = batchFor(received, event.text);
                    void putMessage(batch === undefined ? received : { ...received, batch });
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
        const built = buildForConversation(conversation, trimmed, userSeq);
        await runRequest(conversation, assistantSeq, built.messages, built.snapshot);
    };

    /** The last message of the active conversation, when it is the user's. */
    const lastUserMessage = (): Message | undefined => {
        if (activeConversationId === null) {
            return undefined;
        }
        const last = messagesOf(activeConversationId).at(-1);
        return last?.role === 'user' ? last : undefined;
    };

    /** Answers the last user message again: only an assistant reply is added. */
    const answerLast = async (userMessage: Message): Promise<void> => {
        let conversation = activeConversationOrThrow();
        const assistantSeq = conversation.nextSeq;
        conversation = await touchConversation({ ...conversation, nextSeq: assistantSeq + 1 });
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
        const built = buildForConversation(conversation, userMessage.text, userMessage.seq);
        await runRequest(conversation, assistantSeq, built.messages, built.snapshot);
    };

    /** Full request for a conversation turn (context builder, research R6). */
    const buildForConversation = (
        conversation: Conversation,
        request: string,
        historyBeforeSeq: number
    ): { messages: LlmMessage[]; snapshot: NonNullable<Message['context']> } => {
        const current = settings();
        const context = conversation.context;
        const history = messagesOf(conversation.id).filter(
            (message) => message.seq < historyBeforeSeq && message.status !== 'failed'
        );
        const built = buildRequest({
            state: deps.store.getState(),
            mode: conversation.mode,
            instructions: current.instructions,
            context,
            selection,
            request,
            history,
            contextTokens: current.contextTokens,
            responseTokens: current.responseTokens,
            chat: {
                messages: deps.chat.chatMessages(context.chatMessages),
                card: context.characterCard ? deps.chat.characterCard() : null,
                persona: context.persona ? deps.chat.persona() : null,
                activated: context.activatedEntries ? deps.chat.activatedEntries() : [],
            },
        });
        return { messages: built.messages, snapshot: built.snapshot };
    };

    const messageAt = (seq: number): Message | undefined =>
        activeConversationId === null
            ? undefined
            : messagesOf(activeConversationId).find((item) => item.seq === seq);

    /** Parses a reply into a reviewable batch (propose mode only). */
    const batchFor = (message: Message, text: string): ProposalBatch | undefined => {
        if (message.mode !== 'propose') {
            return undefined;
        }
        const parsed = parseReply(text, { final: true });
        let counter = 0;
        const proposals = toProposals(parsed.blocks, {
            state: deps.store.getState(),
            snapshot: {
                handles: message.context?.handles ?? {},
                scopeNodeIds: message.context?.scopeNodeIds ?? [],
            },
            newProposalId: () => `${String(message.seq)}-${String((counter += 1))}`,
        });
        return {
            id: `${message.conversationId}-${String(message.seq)}${
                variantIndex(message) > 0 ? `-v${String(variantIndex(message))}` : ''
            }`,
            proposals: withBlocked(proposals),
            unparsed: parsed.unparsed,
            applied: message.batch?.applied ?? [],
        };
    };

    const updateBatch = async (
        seq: number,
        change: (batch: ProposalBatch) => ProposalBatch
    ): Promise<void> => {
        const message = messageAt(seq);
        if (!message?.batch) {
            return;
        }
        const next = change(message.batch);
        await putMessage({ ...message, batch: { ...next, proposals: withBlocked(next.proposals) } });
        notify();
    };

    const setDecision = async (
        seq: number,
        proposalId: string,
        decision: OperationProposal['decision']
    ): Promise<void> => {
        await updateBatch(seq, (batch) => ({
            ...batch,
            proposals: batch.proposals.map((proposal) =>
                proposal.id === proposalId && proposal.decision === 'pending'
                    ? { ...proposal, decision }
                    : proposal
            ),
        }));
    };

    /** Applies accepted proposals and writes their outcome back (FR-011–FR-013). */
    const applyAccepted = async (seq: number, proposalIds: readonly string[]): Promise<void> => {
        const message = messageAt(seq);
        if (!message?.batch || proposalIds.length === 0) {
            return;
        }
        const ordered = applyOrder(
            message.batch.proposals.filter((proposal) => proposalIds.includes(proposal.id))
        ).map((proposal) => proposal.id);
        const result = applyProposals(
            {
                store: deps.store,
                sync: deps.sync,
                newId: deps.newId,
                now: deps.now,
                emit: deps.emit,
            },
            { conversationId: message.conversationId },
            message.batch,
            ordered
        );
        await writeOutcomes(seq, result);
        await deps.conversations.flush(message.conversationId);
    };

    const writeOutcomes = async (
        seq: number,
        result: { batch: AppliedBatch; outcomes: ApplyOutcome[] }
    ): Promise<void> => {
        await updateBatch(seq, (batch) => ({
            ...batch,
            applied: result.batch.items.length > 0 ? [...batch.applied, result.batch] : batch.applied,
            proposals: batch.proposals.map((proposal) => {
                const outcome = result.outcomes.find((item) => item.proposalId === proposal.id);
                if (!outcome) {
                    return proposal;
                }
                if (outcome.status === 'applied') {
                    const next: OperationProposal = { ...proposal, decision: 'applied' };
                    delete next.failedReason;
                    return next;
                }
                if (outcome.status === 'stale') {
                    return {
                        ...proposal,
                        decision: 'stale' as const,
                        blockedReason:
                            outcome.reason === 'missing'
                                ? 'the item no longer exists'
                                : 'the item changed since this was proposed',
                    };
                }
                return { ...proposal, decision: 'failed' as const, failedReason: outcome.reason };
            }),
        }));
    };

    /** Reverts one applied batch (FR-015); an already undone one is left alone. */
    const undoBatch = async (seq: number, appliedBatchId: string): Promise<AppliedBatchUndone | null> => {
        const message = messageAt(seq);
        const applied = message?.batch?.applied.find((item) => item.id === appliedBatchId);
        // A fork shares the original's applied changes but not its undo (owner decision 2026-09-16).
        if (!message?.batch || !applied || applied.undone !== undefined || message.forkedFrom !== undefined) {
            return null;
        }
        const undone = undoAppliedBatch(
            {
                store: deps.store,
                sync: deps.sync,
                newId: deps.newId,
                now: deps.now,
                emit: deps.emit,
            },
            { conversationId: message.conversationId },
            applied
        );
        const revertedProposals = new Set(
            applied.items
                .filter((item) => undone.reverted.includes(item.nodeId))
                .map((item) => item.proposalId)
        );
        await updateBatch(seq, (batch) => ({
            ...batch,
            applied: batch.applied.map((item) =>
                item.id === appliedBatchId ? { ...item, undone } : item
            ),
            proposals: batch.proposals.map((proposal) =>
                revertedProposals.has(proposal.id)
                    ? { ...proposal, decision: 'reverted' as const }
                    : proposal
            ),
        }));
        await deps.conversations.flush(message.conversationId);
        return undone;
    };

    /** A follow-up turn in the same conversation (feedback, continue, ask to fix). */
    const followUp = async (request: string, assistantPrefill?: string): Promise<void> => {
        const conversation = conversations.find((item) => item.id === activeConversationId);
        if (!conversation || busy) {
            return;
        }
        busy = true;
        abortController = new AbortController();
        try {
            const userSeq = conversation.nextSeq;
            const assistantSeq = userSeq + 1;
            const touched = await touchConversation({ ...conversation, nextSeq: assistantSeq + 1 });
            await putMessage({
                conversationId: touched.id,
                seq: userSeq,
                role: 'user',
                text: request,
                status: 'received',
                mode: touched.mode,
                createdAt: deps.now(),
            });
            await putMessage({
                conversationId: touched.id,
                seq: assistantSeq,
                role: 'assistant',
                text: '',
                status: 'pending',
                mode: touched.mode,
                createdAt: deps.now(),
            });
            notify();
            const built = buildForConversation(touched, request, userSeq);
            const messages =
                assistantPrefill === undefined
                    ? built.messages
                    : [...built.messages, { role: 'assistant' as const, content: assistantPrefill }];
            await runRequest(touched, assistantSeq, messages, {
                ...built.snapshot,
                requestMessages: messages,
            });
        } finally {
            busy = false;
            abortController = null;
        }
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

    const ensure = async (): Promise<string> => {
        if (activeConversationId !== null && conversations.some((item) => item.id === activeConversationId)) {
            return activeConversationId;
        }
        return await create();
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
        ensureConversation: ensure,
        async setMode(mode) {
            // Mode and context controls work before the first message: they create
            // the conversation they configure (owner report 2026-09-15).
            await ensure();
            const conversation = conversations.find((item) => item.id === activeConversationId);
            if (!conversation) {
                return;
            }
            await putConversation({ ...conversation, mode, updatedAt: deps.now() });
            notify();
        },
        updateSettings: writeSettings,
        resetInstructions: () => writeSettings({ instructions: null }),
        async updateConversationContext(patch) {
            await ensure();
            const conversation = conversations.find((item) => item.id === activeConversationId);
            if (!conversation) {
                return;
            }
            const context: ContextSettings = { ...conversation.context, ...patch };
            await putConversation({ ...conversation, context, updatedAt: deps.now() });
            // The last choice is the start of the next conversation: no more resets to
            // "current folder, by keys" (owner request 2026-09-22).
            writeSettings({ defaultContext: structuredClone(context) });
            notify();
        },
        setSelection(nodeIds) {
            selection = [...nodeIds];
        },
        async send(text) {
            const trimmed = text.trim();
            const answered = trimmed === '' ? lastUserMessage() : undefined;
            if ((trimmed === '' && answered === undefined) || busy) {
                return;
            }
            busy = true;
            abortController = new AbortController();
            try {
                await (answered !== undefined ? answerLast(answered) : sendInternal(trimmed));
            } finally {
                busy = false;
                abortController = null;
            }
        },
        async confirmDestructive(seq, proposalId) {
            const message = messageAt(seq);
            const proposal = message?.batch?.proposals.find((item) => item.id === proposalId);
            if (!message || !proposal || (proposal.decision !== 'pending' && !canApplyAgain(proposal.decision))) {
                return;
            }
            if (proposal.op === 'delete' && proposal.targetId !== undefined) {
                const result = await applyDeletion(
                    {
                        store: deps.store,
                        sync: deps.sync,
                        newId: deps.newId,
                        now: deps.now,
                        emit: deps.emit,
                        confirm: deps.confirm,
                        ...(deps.trackedIds !== undefined ? { trackedIds: deps.trackedIds } : {}),
                    },
                    { conversationId: message.conversationId },
                    message.batch as ProposalBatch,
                    proposalId
                );
                await writeOutcomes(seq, result);
                return;
            }
            // Destructive EDIT: disclose what disappears before applying.
            const node = proposal.targetId !== undefined ? findNode(deps.store.getState(), proposal.targetId) : undefined;
            const confirmed = await deps.confirm(
                `Apply this change: ${proposal.summary}? It removes a large part of ${
                    node?.name ?? 'the entry'
                } (or one of its keywords). This can be undone from the batch bar.`
            );
            if (!confirmed) {
                return;
            }
            await applyAccepted(seq, [proposalId]);
        },
        undoBatch,
        async undoAll(seq) {
            // Newest first: later changes may sit inside items created earlier.
            const pending = [...(messageAt(seq)?.batch?.applied ?? [])]
                .filter((applied) => applied.undone === undefined)
                .reverse();
            const reverted: string[] = [];
            const skipped: AppliedBatchUndone['skipped'] = [];
            for (const applied of pending) {
                const undone = await undoBatch(seq, applied.id);
                reverted.push(...(undone?.reverted ?? []));
                skipped.push(...(undone?.skipped ?? []));
            }
            return pending.length === 0 ? null : { at: deps.now(), reverted, skipped };
        },
        async accept(seq, proposalId) {
            const message = messageAt(seq);
            const proposal = message?.batch?.proposals.find((item) => item.id === proposalId);
            if (!proposal) {
                return;
            }
            const stale = stalenessOf(deps.store.getState(), proposal);
            if (stale !== null) {
                await updateBatch(seq, (batch) => ({
                    ...batch,
                    proposals: batch.proposals.map((item) =>
                        item.id === proposalId
                            ? {
                                  ...item,
                                  decision: 'stale' as const,
                                  blockedReason:
                                      stale === 'missing'
                                          ? 'the item no longer exists'
                                          : 'the item changed since this was proposed',
                              }
                            : item
                    ),
                }));
                return;
            }
            await applyAccepted(seq, [proposalId]);
        },
        async acceptAll(seq) {
            const message = messageAt(seq);
            if (!message?.batch) {
                return;
            }
            await applyAccepted(seq, acceptAllSelection(message.batch.proposals));
        },
        async deny(seq, proposalId) {
            await setDecision(seq, proposalId, 'denied');
        },
        async denyAll(seq) {
            await updateBatch(seq, (batch) => ({
                ...batch,
                proposals: batch.proposals.map((proposal) =>
                    proposal.decision === 'pending' ? { ...proposal, decision: 'denied' as const } : proposal
                ),
            }));
        },
        async editProposal(seq, proposalId, values) {
            await updateBatch(seq, (batch) => ({
                ...batch,
                proposals: batch.proposals.map((proposal) =>
                    proposal.id === proposalId ? { ...proposal, userEdited: values } : proposal
                ),
            }));
        },
        async refreshProposal(seq, proposalId) {
            await updateBatch(seq, (batch) => ({
                ...batch,
                proposals: batch.proposals.map((proposal) => {
                    if (proposal.id !== proposalId || proposal.decision !== 'stale') {
                        return proposal;
                    }
                    const node =
                        proposal.targetId !== undefined
                            ? findNodeInState(deps.store.getState(), proposal.targetId)
                            : undefined;
                    if (!node) {
                        return { ...proposal, decision: 'invalid' as const, invalidReason: 'the item no longer exists' };
                    }
                    const next: OperationProposal = { ...proposal, decision: 'pending' };
                    delete next.blockedReason;
                    next.baseline = {
                        updatedAt: node.updatedAt,
                        fingerprint: fingerprintOf(node, proposal.userEdited ?? proposal.values),
                    };
                    return next;
                }),
            }));
        },
        async feedback(seq, text, proposalId) {
            const message = messageAt(seq);
            const target = message?.batch?.proposals.find((item) => item.id === proposalId);
            const problem =
                target?.invalidReason ?? target?.blockedReason ?? target?.failedReason;
            const scopeNote =
                target !== undefined
                    ? ` Only revise this proposal: ${target.summary}.${
                          problem !== undefined ? ` It could not be used: ${problem}.` : ''
                      }`
                    : '';
            if (proposalId !== undefined) {
                await setDecision(seq, proposalId, 'superseded');
            }
            await followUp(`${text}${scopeNote}`);
        },
        async continueReply(seq) {
            const message = messageAt(seq);
            if (!message) {
                return;
            }
            await followUp('Continue exactly where you stopped.', message.text);
        },
        async regenerate(seq, options = {}) {
            const conversation = conversations.find((item) => item.id === activeConversationId);
            const message = messageAt(seq);
            if (!conversation || message?.role !== 'assistant' || busy) {
                return;
            }
            // The request this reply answers: the nearest user message before it.
            const userMessage = messagesOf(conversation.id)
                .filter((item) => item.role === 'user' && item.seq < seq)
                .at(-1);
            busy = true;
            abortController = new AbortController();
            try {
                await deps.conversations.deleteMessagesAfter(conversation.id, seq);
                const bucket = messagesOf(conversation.id);
                bucket.splice(
                    0,
                    bucket.length,
                    ...bucket.filter((item) => item.seq <= seq)
                );
                const previousContext = message.context;
                await putMessage(withNewVariant(message, deps.now()));
                notify();
                if (options.sameContext === true && previousContext !== undefined) {
                    await runRequest(conversation, seq, previousContext.requestMessages, previousContext);
                    return;
                }
                const built = buildForConversation(
                    conversation,
                    userMessage?.text ?? '',
                    userMessage?.seq ?? seq
                );
                await runRequest(conversation, seq, built.messages, built.snapshot);
            } finally {
                busy = false;
                abortController = null;
            }
        },
        async showVariant(seq, index) {
            const message = messageAt(seq);
            if (!message || busy) {
                return;
            }
            const next = showVariant(message, index);
            if (next === message) {
                return;
            }
            await putMessage(next);
            notify();
        },
        async deleteMessage(seq) {
            const message = messageAt(seq);
            if (!message || (busy && activeRequest?.seq === seq)) {
                return;
            }
            if (message.status === 'retry-wait' && retryTimer !== null) {
                clearTimeout(retryTimer);
                retryTimer = null;
            }
            const bucket = messagesOf(message.conversationId);
            bucket.splice(
                0,
                bucket.length,
                ...bucket.filter((item) => item.seq !== seq)
            );
            await deps.conversations.deleteMessage(message.conversationId, seq);
            notify();
        },
        async forkConversation(seq) {
            const original = conversations.find((item) => item.id === activeConversationId);
            if (!original || busy) {
                return null;
            }
            const copied = messagesOf(original.id).filter((item) => item.seq <= seq);
            if (copied.length === 0) {
                return null;
            }
            const baseTitle = original.title.startsWith(FORK_PREFIX)
                ? original.title
                : `${FORK_PREFIX}${original.title}`;
            const fork: Conversation = {
                ...structuredClone(original),
                id: deps.newId(),
                title: baseTitle,
                createdAt: deps.now(),
                updatedAt: deps.now(),
                nextSeq: seq + 1,
            };
            await putConversation(fork);
            messagesByConversation.set(fork.id, []);
            for (const message of copied) {
                await putMessage(forkedMessage(message, fork.id, original.id));
            }
            await deps.conversations.flush(fork.id);
            activeConversationId = fork.id;
            notify();
            return fork.id;
        },
        canAnswerLast: () => !busy && lastUserMessage() !== undefined,
        async editMessage(seq, text) {
            const message = messageAt(seq);
            const trimmed = text.trim();
            if (
                !message ||
                message.role === 'note' ||
                trimmed === '' ||
                (busy && activeRequest?.seq === seq) ||
                message.status === 'pending' ||
                message.status === 'receiving' ||
                message.status === 'retry-wait'
            ) {
                return null;
            }
            const edited = editMessage(message, trimmed, deps.store.getState());
            await putMessage(edited.message);
            await deps.conversations.flush(message.conversationId);
            notify();
            return edited;
        },
        async askToFix(seq) {
            const message = messageAt(seq);
            if (!message?.batch) {
                return;
            }
            const reasons = [
                ...message.batch.unparsed.map((item) => `- ${item.reason}: ${item.excerpt}`),
                ...message.batch.proposals
                    .filter((proposal) => proposal.invalidReason !== undefined)
                    .map((proposal) => `- ${proposal.summary}: ${proposal.invalidReason ?? ''}`),
            ].join('\n');
            await followUp(
                `Your previous operation blocks could not be used:\n${reasons}\nSend them again, fixed, using only handles from the <workspace> block.`
            );
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
