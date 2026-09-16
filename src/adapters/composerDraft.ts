/**
 * Unsent assistant request text (spec 005 FR-002a): kept in the tab's session storage so
 * closing the workspace to check the chat or a character card does not lose it. Storage
 * that is missing, blocked or full only means the draft is not kept.
 */

export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface ComposerDraft {
    load(): string;
    /** Stores the text; empty text removes the draft. */
    save(text: string): void;
}

const DRAFT_KEY = 'WorldInfoWorkspace:assistant-draft';

export function createComposerDraft(
    getStorage: () => DraftStorage | null = () => globalThis.sessionStorage ?? null
): ComposerDraft {
    const withStorage = <T>(fallback: T, use: (storage: DraftStorage) => T): T => {
        try {
            const storage = getStorage();
            return storage === null ? fallback : use(storage);
        } catch {
            return fallback;
        }
    };
    return {
        load: () => withStorage('', (storage) => storage.getItem(DRAFT_KEY) ?? ''),
        save: (text) =>
            withStorage(undefined, (storage) => {
                if (text === '') {
                    storage.removeItem(DRAFT_KEY);
                } else {
                    storage.setItem(DRAFT_KEY, text);
                }
            }),
    };
}
