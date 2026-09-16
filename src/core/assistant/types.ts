import type { NativeWorldInfoEntry } from '../../global';
import type { TreeNode } from '../state/schema';

/**
 * Assistant data model (spec 005; shapes in
 * specs/005-ai-lore-assistant/data-model.md). Pure module: no app imports.
 *
 * Persistence split (clarification 2026-09-15): `AssistantSettings` lives in the
 * shared extension settings; conversations, messages, proposals and undo records
 * live per device in IndexedDB.
 */

export type OperationType =
    | 'create_entry'
    | 'edit_entry'
    | 'create_folder'
    | 'rename'
    | 'move'
    | 'delete';

export type AssistantMode = 'propose' | 'discuss';

/** Part of the tree the assistant sees and may change (FR-021). */
export type ContextScope =
    | { kind: 'selection' }
    | { kind: 'folders'; folderIds: string[] }
    | { kind: 'workspace' };

/**
 * Which entries are sent with their full content (FR-021a): `triggered` = the
 * selected entries plus entries whose keys or title appear in the request, the
 * chat or other sent entries, recursively; `all` = every entry of the structure.
 */
export type EntryContents = 'triggered' | 'all';

export interface ContextSettings {
    scope: ContextScope;
    entryContents: EntryContents;
    /** 0 = do not send chat messages. */
    chatMessages: number;
    characterCard: boolean;
    persona: boolean;
    activatedEntries: boolean;
}

export interface AssistantSettings {
    profileId: string | null;
    responseTokens: number;
    contextTokens: number;
    /** null = built-in default instructions. */
    instructions: string | null;
    defaultContext: ContextSettings;
}

export const RESPONSE_TOKENS_RANGE = { min: 64, max: 32768 } as const;
export const CONTEXT_TOKENS_RANGE = { min: 1000, max: 1000000 } as const;
/** `contextTokens` must leave this much room above the response length. */
export const CONTEXT_HEADROOM_TOKENS = 500;

export const DEFAULT_CONTEXT_SETTINGS: ContextSettings = {
    scope: { kind: 'selection' },
    entryContents: 'triggered',
    chatMessages: 0,
    characterCard: false,
    persona: false,
    activatedEntries: false,
};

export const DEFAULT_ASSISTANT_SETTINGS: AssistantSettings = {
    profileId: null,
    responseTokens: 2000,
    contextTokens: 16000,
    instructions: null,
    defaultContext: DEFAULT_CONTEXT_SETTINGS,
};

export interface Conversation {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    mode: AssistantMode;
    context: ContextSettings;
    /** Monotonic message sequence inside the conversation. */
    nextSeq: number;
}

export type MessageStatus =
    | 'pending'
    | 'receiving'
    | 'received'
    | 'failed'
    | 'stopped'
    | 'retry-wait';

export type FailureKind =
    | 'rate-limit'
    | 'provider'
    | 'network'
    | 'timeout'
    | 'aborted'
    | 'profile'
    | 'connection-manager-disabled'
    | 'empty'
    | 'truncated'
    | 'malformed';

export interface AssistantFailure {
    kind: FailureKind;
    /** Readable, user-facing reason. */
    message: string;
    retryable: boolean;
    /** Raw provider text, shown collapsed. */
    detail?: string;
}

export interface MessageOrigin {
    profileId: string;
    profileName: string;
    api: 'chat-completion' | 'text-completion';
    /** Model id configured in the profile (routers do not expose the real one). */
    model: string;
}

export type OmittedKind = 'item' | 'outline-depth' | 'chat' | 'history';

export interface OmittedPart {
    what: OmittedKind;
    label: string;
    count?: number;
}

export interface ContextIncluded {
    outline: boolean;
    /** Items of the structure listed in the outline. */
    outlineItems: number;
    fullItems: number;
    /** Of `fullItems`: entries sent because their keys or title were mentioned. */
    triggeredItems: number;
    chatMessages: number;
    characterCard: boolean;
    persona: boolean;
    activatedEntries: number;
}

export interface LlmMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface ContextSnapshot {
    /** handle (`e12`) → node id (research R5). */
    handles: Record<string, string>;
    /** Nodes valid as operation targets. */
    scopeNodeIds: string[];
    included: ContextIncluded;
    omitted: OmittedPart[];
    estimatedTokens: number;
    /** Exact messages sent — "regenerate with the same context" re-sends these. */
    requestMessages: LlmMessage[];
}

export interface ProposedValues {
    title?: string;
    keys?: string[];
    secondaryKeys?: string[];
    content?: string;
    fields?: Partial<NativeWorldInfoEntry>;
}

export type Decision =
    | 'pending'
    | 'accepted'
    | 'denied'
    | 'blocked'
    | 'stale'
    | 'invalid'
    | 'applied'
    | 'reverted'
    | 'failed'
    | 'superseded';

export type ProposalParent = { nodeId: string } | { ref: string };

export interface ProposalBaseline {
    updatedAt: string;
    /** Fingerprint of the fields this proposal touches (staleness, FR-013). */
    fingerprint: string;
}

export interface OperationProposal {
    id: string;
    op: OperationType;
    /** Resolved node id for edit/rename/move/delete. */
    targetId?: string;
    parent?: ProposalParent;
    /** Temporary ref declared by a creation. */
    ref?: string;
    values: ProposedValues;
    /** User edits made before accepting (applied instead of `values`). */
    userEdited?: ProposedValues;
    baseline?: ProposalBaseline;
    dependsOn: string[];
    destructive: boolean;
    duplicateOf?: string;
    invalidReason?: string;
    blockedReason?: string;
    failedReason?: string;
    decision: Decision;
    revisionOf?: string;
    /** Human-readable summary rendered in the proposal card. */
    summary: string;
}

export type UnparsedKind = 'malformed-block' | 'truncated';

export interface UnparsedBlock {
    kind: UnparsedKind;
    excerpt: string;
    reason: string;
}

export type AppliedInverse =
    | { kind: 'delete-created' }
    | { kind: 'restore-fields'; name: string; native: Partial<NativeWorldInfoEntry> }
    | { kind: 'restore-name'; name: string }
    | { kind: 'restore-position'; parentId: string; index: number }
    | { kind: 'reinsert'; parentId: string; index: number; subtree: TreeNode };

export interface AppliedItem {
    proposalId: string;
    op: OperationType;
    nodeId: string;
    /** `updatedAt` right after the application — undo skips items changed since. */
    afterUpdatedAt: string;
    inverse: AppliedInverse;
}

export interface AppliedBatchUndone {
    at: string;
    reverted: string[];
    skipped: Array<{ proposalId: string; reason: string }>;
}

export interface AppliedBatch {
    id: string;
    appliedAt: string;
    items: AppliedItem[];
    failed?: { proposalId: string; reason: string };
    undone?: AppliedBatchUndone;
}

export interface ProposalBatch {
    id: string;
    proposals: OperationProposal[];
    unparsed: UnparsedBlock[];
    applied: AppliedBatch[];
}

/** One generated version of an assistant reply (swipes, owner request 2026-09-16). */
export interface ReplyVariant {
    text: string;
    prose?: string;
    reasoning?: string;
    status: MessageStatus;
    failure?: AssistantFailure;
    origin?: MessageOrigin;
    context?: ContextSnapshot;
    batch?: ProposalBatch;
    createdAt: string;
    startedAt?: string;
}

export interface Message {
    conversationId: string;
    seq: number;
    role: 'user' | 'assistant' | 'note';
    text: string;
    /** Assistant messages: the reply prose with operation blocks removed. */
    prose?: string;
    reasoning?: string;
    status: MessageStatus;
    failure?: AssistantFailure;
    mode: AssistantMode;
    origin?: MessageOrigin;
    context?: ContextSnapshot;
    batch?: ProposalBatch;
    /**
     * Every version of an assistant reply. The shown one is mirrored in the
     * message's own fields; its slot here is refreshed when the user switches.
     */
    variants?: ReplyVariant[];
    variantIndex?: number;
    /**
     * Copied from another conversation by a fork: undo records stay with the
     * original, so applied changes are read-only here.
     */
    forkedFrom?: string;
    createdAt: string;
    /** Start of the request, for the elapsed-time display. */
    startedAt?: string;
    /** Automatic retry countdown target (ISO), set in `retry-wait`. */
    retryAt?: string;
    /** Number of automatic retries already spent. */
    retryAttempt?: number;
}
