/**
 * Book list navigation shared by the Books panel and the import dialog: users
 * keep hundreds of native books, so the lists search, filter and paginate
 * instead of rendering everything. Pure — callers supply the book facts.
 */

export interface BookFacts {
    name: string;
    globallyActive: boolean;
    /** Primary lorebook of the current character. */
    characterBound: boolean;
    /** Lorebook bound to the current chat. */
    chatBound: boolean;
    /** Name of the workspace folder bound to this book, if any. */
    workspaceRoot: string | null;
    /** Id of that folder (null together with workspaceRoot). */
    workspaceRootId: string | null;
}

export type BookFilter = 'all' | 'active' | 'context' | 'workspace' | 'outside';

export const BOOK_FILTERS: ReadonlyArray<{ id: BookFilter; label: string; icon: string; title: string }> = [
    { id: 'all', label: 'All', icon: 'fa-book', title: 'All books' },
    { id: 'active', label: 'Active', icon: 'fa-globe', title: 'Globally active books' },
    { id: 'context', label: 'Character & chat', icon: 'fa-user', title: 'Books of the current character or chat' },
    { id: 'workspace', label: 'In workspace', icon: 'fa-folder-tree', title: 'Books bound to a workspace folder' },
    { id: 'outside', label: 'Not in workspace', icon: 'fa-file-circle-question', title: 'Books not bound to the workspace' },
];

export const BOOK_PAGE_SIZE = 50;

export function matchesBookFilter(book: BookFacts, filter: BookFilter): boolean {
    switch (filter) {
        case 'all':
            return true;
        case 'active':
            return book.globallyActive;
        case 'context':
            return book.characterBound || book.chatBound;
        case 'workspace':
            return book.workspaceRoot !== null;
        case 'outside':
            return book.workspaceRoot === null;
    }
}

export function countByFilter(books: readonly BookFacts[]): Record<BookFilter, number> {
    const counts: Record<BookFilter, number> = { all: 0, active: 0, context: 0, workspace: 0, outside: 0 };
    for (const book of books) {
        for (const { id } of BOOK_FILTERS) {
            if (matchesBookFilter(book, id)) {
                counts[id] += 1;
            }
        }
    }
    return counts;
}

export interface BookPage {
    items: BookFacts[];
    /** Books matching the query and filter (all pages). */
    total: number;
    /** Clamped zero-based page index. */
    page: number;
    pageCount: number;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * Name order (stable while toggling activation — rows never jump), then the
 * requested page. Search matches the book name or its workspace folder name.
 */
export function pageBooks(
    books: readonly BookFacts[],
    options: { query: string; filter: BookFilter; page: number; pageSize?: number }
): BookPage {
    const pageSize = options.pageSize ?? BOOK_PAGE_SIZE;
    const needle = options.query.trim().toLowerCase();
    const matching = books
        .filter((book) => matchesBookFilter(book, options.filter))
        .filter(
            (book) =>
                needle === '' ||
                book.name.toLowerCase().includes(needle) ||
                (book.workspaceRoot ?? '').toLowerCase().includes(needle)
        )
        .sort((a, b) => collator.compare(a.name, b.name));
    const pageCount = Math.max(1, Math.ceil(matching.length / pageSize));
    const page = Math.min(Math.max(options.page, 0), pageCount - 1);
    return {
        items: matching.slice(page * pageSize, (page + 1) * pageSize),
        total: matching.length,
        page,
        pageCount,
    };
}
