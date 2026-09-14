import type { WorldInfoBook } from '../global';

/**
 * Active-books activation drive (FR-017; contract "Active-books drive"). The
 * app's `selected_world_info` is module state with no context write path — the
 * host's own `#world_info` select handler is the only sanctioned writer, so the
 * adapter reads its values and drives it by setting options + dispatching
 * `change` (host-stable DOM, isolated here per constitution II).
 */
export interface ActiveBooksAdapter {
    isAvailable(): boolean;
    getActiveBooks(): string[];
    setActiveBooks(names: readonly string[]): void;
}

const SELECT_SELECTOR = '#world_info';

function select(): HTMLSelectElement | null {
    return document.querySelector(SELECT_SELECTOR);
}

export function createActiveBooksAdapter(): ActiveBooksAdapter {
    return {
        isAvailable: (): boolean => select() !== null,
        getActiveBooks: (): string[] => {
            const element = select();
            if (!element) {
                return [];
            }
            // Option VALUES are INDICES into the app's world_names (native
            // updateWorldInfoList builds Option(name, index)); the NAME lives in
            // the option text. Matching by value never matches a book name.
            return Array.from(element.selectedOptions).map((option) => option.textContent ?? '');
        },
        setActiveBooks: (names: readonly string[]): void => {
            const element = select();
            if (!element) {
                return;
            }
            const wanted = new Set(names);
            Array.from(element.options).forEach((option) => {
                option.selected = wanted.has(option.textContent ?? '');
            });
            element.dispatchEvent(new Event('change', { bubbles: true }));
        },
    };
}

export function bookNameFromBook(book: WorldInfoBook, fallback: string): string {
    return typeof book.name === 'string' && book.name.trim() !== '' ? book.name : fallback;
}