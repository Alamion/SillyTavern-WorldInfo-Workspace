import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { getAppContext } from '../adapters/appApi';
import { collectBookFacts } from '../adapters/bookStates';
import type { WorkspaceStateServices } from '../adapters/settingsStore';
import {
    BOOK_FILTERS,
    countByFilter,
    pageBooks,
    type BookFacts,
    type BookFilter,
} from '../core/books/listing';

/**
 * Live book facts: recomputed when activation, settings, the chat/character or
 * the workspace change. `refresh` covers our own writes that emit nothing.
 */
export function useBookFacts(services: WorkspaceStateServices): { books: BookFacts[]; refresh(): void } {
    const { store, activeBooks } = services;
    const state = useSyncExternalStore(store.subscribe, store.getState);
    const [tick, setTick] = useState(0);

    useEffect(() => {
        const ctx = getAppContext();
        const bump = (): void => setTick((value) => value + 1);
        const events = [
            ctx.eventTypes.WORLDINFO_SETTINGS_UPDATED,
            ctx.eventTypes.SETTINGS_UPDATED,
            ctx.eventTypes.CHAT_CHANGED,
            ctx.eventTypes.WORLDINFO_UPDATED,
        ];
        events.forEach((event) => ctx.eventSource.on(event, bump));
        return () => events.forEach((event) => ctx.eventSource.removeListener(event, bump));
    }, []);

    const books = useMemo(
        () => collectBookFacts(activeBooks.getActiveBooks(), state),
        // `tick` is the invalidation signal for app-side facts.
        [state, activeBooks, tick]
    );
    return { books, refresh: () => setTick((value) => value + 1) };
}

/**
 * Search + filter chips (with counts) + pagination over a book list. Row
 * content is supplied by the caller.
 */
export function BookList({
    books,
    filters,
    initialFilter = 'all',
    renderRow,
    emptyText,
}: {
    books: readonly BookFacts[];
    filters: readonly BookFilter[];
    initialFilter?: BookFilter;
    renderRow(book: BookFacts): ReactNode;
    emptyText: string;
}): JSX.Element {
    const [query, setQuery] = useState('');
    const [filter, setFilter] = useState<BookFilter>(initialFilter);
    const [page, setPage] = useState(0);
    const counts = useMemo(() => countByFilter(books), [books]);
    const view = pageBooks(books, { query, filter, page });

    return (
        <div className="wiw-book-list">
            <input
                className="wiw-tree-search"
                type="search"
                placeholder={`Search ${books.length} books…`}
                value={query}
                onChange={(event) => {
                    setQuery(event.target.value);
                    setPage(0);
                }}
            />
            <div className="wiw-book-filters">
                {BOOK_FILTERS.filter((item) => filters.includes(item.id)).map((item) => (
                    <button
                        key={item.id}
                        type="button"
                        className={`wiw-toggle-chip${filter === item.id ? ' wiw-toggle-on' : ''}`}
                        title={item.title}
                        onClick={() => {
                            setFilter(item.id);
                            setPage(0);
                        }}
                    >
                        <i className={`fa-solid ${item.icon}`} />
                        <span>
                            {item.label} ({counts[item.id]})
                        </span>
                    </button>
                ))}
            </div>
            <div className="wiw-folder-picker">
                {view.items.map((book) => (
                    <div key={book.name} className="wiw-book-row">
                        {renderRow(book)}
                    </div>
                ))}
                {view.total === 0 && <p className="wiw-membership-line">{emptyText}</p>}
            </div>
            {view.pageCount > 1 && (
                <div className="wiw-book-pager">
                    <button
                        type="button"
                        className="wiw-button wiw-icon-button"
                        title="Previous page"
                        disabled={view.page === 0}
                        onClick={() => setPage(view.page - 1)}
                    >
                        <i className="fa-solid fa-chevron-left" />
                    </button>
                    <span className="wiw-membership-line">
                        {view.page + 1} / {view.pageCount} · {view.total} books
                    </span>
                    <button
                        type="button"
                        className="wiw-button wiw-icon-button"
                        title="Next page"
                        disabled={view.page >= view.pageCount - 1}
                        onClick={() => setPage(view.page + 1)}
                    >
                        <i className="fa-solid fa-chevron-right" />
                    </button>
                </div>
            )}
        </div>
    );
}

/** Character / chat / workspace markers shared by both book lists. */
export function BookMarkers({ book }: { book: BookFacts }): JSX.Element {
    return (
        <>
            {book.characterBound && (
                <i className="fa-solid fa-user wiw-book-marker" title="Lorebook of the current character" />
            )}
            {book.chatBound && (
                <i className="fa-solid fa-comment wiw-book-marker" title="Lorebook of the current chat" />
            )}
            {book.workspaceRoot !== null && (
                <span className="wiw-badge wiw-badge-book" title={`Workspace folder: ${book.workspaceRoot}`}>
                    WI
                </span>
            )}
        </>
    );
}
