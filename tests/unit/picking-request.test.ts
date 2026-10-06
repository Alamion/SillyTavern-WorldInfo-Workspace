import { describe, expect, it } from 'vitest';
import { buildPickRequest, type PickCandidate } from '../../src/core/picking/request';
import { createDefaultNativeEntry } from '../../src/core/state/schema';

/** The picking request (contracts/main-chat-picking.md). */

function candidate(uid: number, name: string, path: string, content: string, summary?: string): PickCandidate {
    const native = { ...createDefaultNativeEntry(uid), comment: name, content };
    if (summary !== undefined) {
        native.extensions = { wiw_summary: summary };
    }
    return { id: `Book:${String(uid)}`, name, native, book: 'Book', uid, path };
}

const CANDIDATES = [
    candidate(1, 'Selene', 'Lore / Characters', 'High priestess of the Lunar Order.', 'When the Lunar Order or the temple matters.'),
    candidate(2, 'Mistveil Marsh', 'Lore / Places', 'A marsh of wisps and deep pools.'),
    candidate(3, 'Harbor', 'Lore / Places', 'Ships and salt.'),
];

const CHAT = [
    { name: 'User', text: 'We reach the temple.' },
    { name: 'Seraphina', text: 'The pillars glow.' },
];

describe('buildPickRequest', () => {
    it('sends rules in the system message and chat + catalog in the user turn', () => {
        const built = buildPickRequest({ candidates: CANDIDATES, chat: CHAT, scene: null, maxPicks: 8, catalogTokens: 4000 });
        expect(built.messages[0]?.role).toBe('system');
        expect(built.messages[0]?.content).toContain('<pick id="');
        expect(built.messages[0]?.content).toContain('at most 8');
        const user = built.messages[1]?.content ?? '';
        expect(user).toContain('User: We reach the temple.');
        expect(user).toContain('### Lore / Characters');
        expect(user).toMatch(/e1 \| Selene \| ≈\d+ — When the Lunar Order or the temple matters\./);
        expect(user).toMatch(/e2 \| Mistveil Marsh \| ≈\d+ — "A marsh of wisps/);
        expect(built.handles.get('e1')).toEqual({ book: 'Book', uid: 1, name: 'Selene' });
    });

    it('adds the scene when there is one', () => {
        const built = buildPickRequest({
            candidates: CANDIDATES,
            chat: CHAT,
            scene: { present: ['Seraphina', 'Selene'], location: 'Lunar Temple' },
            maxPicks: 8,
            catalogTokens: 4000,
        });
        expect(built.messages[1]?.content).toContain('Present: Seraphina, Selene');
    });

    it('keeps the entries most related to the chat when the catalog budget is small', () => {
        const many = Array.from({ length: 300 }, (_, i) => candidate(100 + i, `Filler ${String(i)}`, 'Lore / Misc', 'nothing relevant here at all '.repeat(5)));
        const built = buildPickRequest({ candidates: [...many, ...CANDIDATES], chat: CHAT, scene: null, maxPicks: 8, catalogTokens: 600 });
        const user = built.messages[1]?.content ?? '';
        expect(user).toContain('Selene');
        expect(built.handles.size).toBeLessThan(303);
        expect(built.omitted).toBeGreaterThan(0);
    });
});
