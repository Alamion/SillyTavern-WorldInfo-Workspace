import { describe, expect, it } from 'vitest';
import { createComposerDraft, type DraftStorage } from '../../src/adapters/composerDraft';

function memoryStorage(): DraftStorage & { items: Map<string, string> } {
    const items = new Map<string, string>();
    return {
        items,
        getItem: (key) => items.get(key) ?? null,
        setItem: (key, value) => void items.set(key, value),
        removeItem: (key) => void items.delete(key),
    };
}

function throwingStorage(): DraftStorage {
    const fail = (): never => {
        throw new Error('SecurityError: storage is blocked');
    };
    return { getItem: fail, setItem: fail, removeItem: fail };
}

describe('assistant composer draft (FR-002a)', () => {
    it('starts empty when nothing was typed', () => {
        expect(createComposerDraft(() => memoryStorage()).load()).toBe('');
    });

    it('restores the typed text in a new composer of the same session', () => {
        const storage = memoryStorage();
        createComposerDraft(() => storage).save('Add a tavern to\nBristlemark');
        expect(createComposerDraft(() => storage).load()).toBe('Add a tavern to\nBristlemark');
    });

    it('keeps whitespace-only text as typed', () => {
        const storage = memoryStorage();
        createComposerDraft(() => storage).save('  ');
        expect(createComposerDraft(() => storage).load()).toBe('  ');
    });

    it('removes the stored draft when the text is cleared or sent', () => {
        const storage = memoryStorage();
        const draft = createComposerDraft(() => storage);
        draft.save('Ask about the harbor');
        draft.save('');
        expect(storage.items.size).toBe(0);
        expect(draft.load()).toBe('');
    });

    it('keeps working without session storage', () => {
        for (const storage of [() => null, throwingStorage, (): DraftStorage => {
            throw new Error('sessionStorage is not accessible');
        }]) {
            const draft = createComposerDraft(storage);
            expect(() => draft.save('text')).not.toThrow();
            expect(draft.load()).toBe('');
        }
    });
});
