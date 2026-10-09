import type {
    AssistantFailure,
    Conversation,
    LlmMessage,
    Message,
} from './types';

/**
 * Ports the assistant core depends on (contracts: llm-port.md). Adapters provide
 * the app-facing implementations; tests provide fakes.
 */

export type ProfileApi = 'chat-completion' | 'text-completion';

export interface ProfileInfo {
    id: string;
    name: string;
    api: ProfileApi;
    /** Model id configured in the profile ('' when it has none). */
    model: string;
    /** Resolved from the profile's completion preset (research R2). */
    streaming: boolean;
    /** Text Completion profiles without an instruct template (warning text). */
    hasInstructTemplate?: boolean;
}

export type LlmAvailability =
    | { state: 'ready'; profiles: ProfileInfo[] }
    | { state: 'connection-manager-disabled' };

export interface LlmRequest {
    profileId: string;
    messages: LlmMessage[];
    maxTokens: number;
    signal: AbortSignal;
    /** Overrides the profile's model for this request (spec 009 R3); empty = profile's. */
    model?: string;
}

export type LlmEvent =
    | { type: 'started'; streaming: boolean }
    | { type: 'progress'; text: string; reasoning: string }
    | { type: 'done'; text: string; reasoning: string }
    | { type: 'failed'; failure: AssistantFailure };

export interface LlmPort {
    availability(): LlmAvailability;
    /** Subscribes to profile list changes; returns an unsubscribe function. */
    onProfilesChanged(listener: () => void): () => void;
    /** Never throws; every outcome is an event. Exactly one terminal event. */
    run(request: LlmRequest, onEvent: (event: LlmEvent) => void): Promise<void>;
}

export interface ConversationStorePort {
    /** false = in-memory fallback; conversations do not survive a reload. */
    available(): boolean;
    listConversations(): Promise<Conversation[]>;
    getConversation(id: string): Promise<Conversation | undefined>;
    putConversation(conversation: Conversation): Promise<void>;
    /** Deletes the conversation AND its messages. */
    deleteConversation(id: string): Promise<void>;
    listMessages(conversationId: string): Promise<Message[]>;
    putMessage(message: Message): Promise<void>;
    deleteMessagesAfter(conversationId: string, seq: number): Promise<void>;
    deleteMessage(conversationId: string, seq: number): Promise<void>;
    /** Flushes debounced writes of one conversation (or all). */
    flush(conversationId?: string): Promise<void>;
}

export interface ChatMessageView {
    name: string;
    isUser: boolean;
    text: string;
}

export interface CharacterCardView {
    name: string;
    description: string;
    personality: string;
    scenario: string;
}

export interface PersonaView {
    name: string;
    description: string;
}

export interface ActivatedEntryRef {
    bookName: string;
    uid: number;
}

export interface ChatContextPort {
    chatMessages(count: number): ChatMessageView[];
    characterCard(): CharacterCardView | null;
    persona(): PersonaView | null;
    activatedEntries(): ActivatedEntryRef[];
    onChatChanged(listener: () => void): () => void;
}

/**
 * Other lore extensions (spec 007 US4), detected lazily at the moment of use:
 * every member answers "unavailable" (null / false) when the extension is absent
 * or its data has an unexpected shape — never an error.
 */
export interface InteropPort {
    /** Doom's Enhancement Suite: the tracked scene of the current chat. */
    scene(): { present: string[]; location?: string } | null;
    /** DeepLore: whether its public matcher exists. */
    deepLoreAvailable(): boolean;
    /** DeepLore keyword matches for the given texts; null when unavailable or failed. */
    deepLoreMatches(texts: readonly string[]): Promise<{ text: string; count: number } | null>;
    /** Memory Books: whether its commands are registered (it registers them late). */
    memoryBooksAvailable(): boolean;
    /** Runs Memory Books' own /creatememory; false when it is unavailable. */
    createMemory(): Promise<boolean>;
}

export const NO_INTEROP: InteropPort = {
    scene: () => null,
    deepLoreAvailable: () => false,
    deepLoreMatches: async () => null,
    memoryBooksAvailable: () => false,
    createMemory: async () => false,
};
