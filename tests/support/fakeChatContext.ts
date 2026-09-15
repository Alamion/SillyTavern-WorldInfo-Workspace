import type {
    ActivatedEntryRef,
    CharacterCardView,
    ChatContextPort,
    ChatMessageView,
    PersonaView,
} from '../../src/core/assistant/ports';

/** Scriptable ChatContextPort for US6 tests. */
export class FakeChatContext implements ChatContextPort {
    messages: ChatMessageView[] = [];
    card: CharacterCardView | null = null;
    personaView: PersonaView | null = null;
    activated: ActivatedEntryRef[] = [];
    private readonly listeners = new Set<() => void>();

    chatMessages(count: number): ChatMessageView[] {
        return count <= 0 ? [] : this.messages.slice(-count);
    }

    characterCard(): CharacterCardView | null {
        return this.card;
    }

    persona(): PersonaView | null {
        return this.personaView;
    }

    activatedEntries(): ActivatedEntryRef[] {
        return [...this.activated];
    }

    onChatChanged(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    emitChatChanged(): void {
        this.activated = [];
        for (const listener of this.listeners) {
            listener();
        }
    }
}
