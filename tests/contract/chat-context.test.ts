import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChatContext } from '../../src/adapters/chatContext';
import type { SillyTavernContext } from '../../src/global';

/**
 * Contract: the chat context adapter reads the app's live data surfaces
 * (spec 005 FR-022): `chat`, `getCharacterCardFields`, `name1/name2`,
 * `powerUserSettings.persona_description`, and the WORLD_INFO_ACTIVATED /
 * CHAT_CHANGED events (context/SillyTavern/public/scripts/world-info.js:900).
 */

type Handler = (...args: unknown[]) => void;

function installHost() {
    const listeners = new Map<string, Handler[]>();
    const live = {
        chat: [
            { name: 'Kara', is_user: true, mes: 'What about the harbor?' },
            { name: 'System', is_user: false, is_system: true, mes: 'hidden note' },
            { name: 'Guide', is_user: false, mes: 'The guilds run it.' },
        ],
        name1: 'Kara',
        name2: 'Guide',
        characterId: 3 as number | undefined,
        powerUserSettings: { persona_description: 'A travelling scribe.' } as Record<string, unknown>,
        getCharacterCardFields: () => ({
            description: 'A weathered harbor guide.',
            personality: 'Dry humour.',
            scenario: 'On the quay.',
            persona: '',
            system: '',
            jailbreak: '',
            mesExamples: '',
        }),
        eventTypes: { WORLD_INFO_ACTIVATED: 'wi_activated', CHAT_CHANGED: 'chat_changed' },
        eventSource: {
            on: (event: string, handler: Handler) => {
                listeners.set(event, [...(listeners.get(event) ?? []), handler]);
            },
            removeListener: (event: string, handler: Handler) => {
                listeners.set(event, (listeners.get(event) ?? []).filter((item) => item !== handler));
            },
            emit: async (event: string, ...args: unknown[]) => {
                for (const handler of listeners.get(event) ?? []) {
                    handler(...args);
                }
            },
        },
    };
    (globalThis as unknown as { window: { SillyTavern: { getContext: () => SillyTavernContext } } }).window = {
        SillyTavern: { getContext: () => live as unknown as SillyTavernContext },
    };
    return { live, listeners };
}

let host: ReturnType<typeof installHost>;

beforeEach(() => {
    host = installHost();
});

afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
});

describe('chatContext adapter', () => {
    it('reads the last messages fresh on every call, skipping system messages', () => {
        const chat = createChatContext();
        expect(chat.chatMessages(5)).toEqual([
            { name: 'Kara', isUser: true, text: 'What about the harbor?' },
            { name: 'Guide', isUser: false, text: 'The guilds run it.' },
        ]);
        host.live.chat.push({ name: 'Kara', is_user: true, mes: 'And the watch?' });
        expect(chat.chatMessages(1)).toEqual([{ name: 'Kara', isUser: true, text: 'And the watch?' }]);
        expect(chat.chatMessages(0)).toEqual([]);
    });

    it('reads the character card only when a character is open', () => {
        const chat = createChatContext();
        expect(chat.characterCard()).toEqual({
            name: 'Guide',
            description: 'A weathered harbor guide.',
            personality: 'Dry humour.',
            scenario: 'On the quay.',
        });
        host.live.characterId = undefined;
        expect(chat.characterCard()).toBeNull();
    });

    it('reads the persona description', () => {
        const chat = createChatContext();
        expect(chat.persona()).toEqual({ name: 'Kara', description: 'A travelling scribe.' });
        host.live.powerUserSettings = {};
        expect(chat.persona()).toBeNull();
    });

    it('caches activated entries and clears them when the chat changes', async () => {
        const chat = createChatContext();
        let changed = 0;
        chat.onChatChanged(() => {
            changed += 1;
        });
        await host.live.eventSource.emit('wi_activated', [
            { world: 'Aldermeer', uid: 1, comment: 'Bristlemark' },
            { uid: 7 },
        ]);
        expect(chat.activatedEntries()).toEqual([{ bookName: 'Aldermeer', uid: 1 }]);
        await host.live.eventSource.emit('chat_changed');
        expect(chat.activatedEntries()).toEqual([]);
        expect(changed).toBe(1);
    });
});
