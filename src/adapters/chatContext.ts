import { getLiveAppContext } from './appApi';
import type {
    ActivatedEntryRef,
    CharacterCardView,
    ChatContextPort,
    ChatMessageView,
    PersonaView,
} from '../core/assistant/ports';
import type { NativeWorldInfoEntry } from '../global';

/**
 * Optional assistant context taken from the app (spec 005 FR-022, research R6):
 * recent chat messages, the character card, the persona, and the World Info
 * entries the app activated for the current chat. Everything is read fresh —
 * the memoized context object goes stale for data fields.
 */

interface ActivatedPayloadEntry extends Partial<NativeWorldInfoEntry> {
    world?: string;
}

export function createChatContext(): ChatContextPort {
    let activated: ActivatedEntryRef[] = [];

    // The event source is an app singleton; read it from a fresh context so the
    // adapter never binds to a stale memoized context object.
    const ctx = getLiveAppContext();
    const activatedEvent = ctx.eventTypes.WORLD_INFO_ACTIVATED;
    if (typeof activatedEvent === 'string') {
        ctx.eventSource.on(activatedEvent, (...args: unknown[]) => {
            const payload = args[0];
            if (!Array.isArray(payload)) {
                return;
            }
            activated = payload
                .filter((item): item is ActivatedPayloadEntry => typeof item === 'object' && item !== null)
                .flatMap((item) =>
                    typeof item.world === 'string' && typeof item.uid === 'number'
                        ? [{ bookName: item.world, uid: item.uid }]
                        : []
                );
        });
    }
    const chatChangedEvent = ctx.eventTypes.CHAT_CHANGED;

    return {
        chatMessages(count: number): ChatMessageView[] {
            if (count <= 0) {
                return [];
            }
            const live = getLiveAppContext();
            return live.chat
                .filter((message) => message.is_system !== true && typeof message.mes === 'string')
                .slice(-count)
                .map((message) => ({
                    name: message.name,
                    isUser: message.is_user,
                    text: message.mes,
                }));
        },
        characterCard(): CharacterCardView | null {
            const live = getLiveAppContext();
            const fields = live.getCharacterCardFields?.();
            if (!fields || live.characterId === undefined) {
                return null;
            }
            return {
                name: live.name2,
                description: fields.description,
                personality: fields.personality,
                scenario: fields.scenario,
            };
        },
        persona(): PersonaView | null {
            const live = getLiveAppContext();
            const description = live.powerUserSettings['persona_description'];
            if (typeof description !== 'string' || description.trim() === '') {
                return null;
            }
            return { name: live.name1, description };
        },
        activatedEntries(): ActivatedEntryRef[] {
            return [...activated];
        },
        onChatChanged(listener: () => void): () => void {
            const handler = (): void => {
                activated = [];
                listener();
            };
            if (typeof chatChangedEvent !== 'string') {
                return () => undefined;
            }
            ctx.eventSource.on(chatChangedEvent, handler);
            return () => ctx.eventSource.removeListener(chatChangedEvent, handler);
        },
    };
}
