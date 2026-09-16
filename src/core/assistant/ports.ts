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
