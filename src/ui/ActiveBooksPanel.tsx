import { useEffect, useMemo, useState } from 'react';
import { getAppContext } from '../adapters/appApi';
import { confirmDialog } from '../adapters/popups';
import type { WorkspaceStateServices } from '../adapters/settingsStore';
import { collectBookStates, type BookState } from '../adapters/bookStates';
import { buildNodeIndex, type FolderNode } from '../core/state/schema';

/**
 * Replacement book-management surface (FR-017/FR-022): every native book with
 * its activation checkbox (driven through the native select), workspace-bound
 * roots marked, character/chat bindings shown with badges, detached books
 * visible and deletable. Search + count keep hundreds of books navigable.
 */
export function ActiveBooksPanel({
    services,
    onClose,
}: {
    services: WorkspaceStateServices;
    onClose(): void;
}): JSX.Element {
    const { store, worldInfo, activeBooks } = services;
    const ctx = getAppContext();
    const [books, setBooks] = useState<string[]>(() => worldInfo.listBooks());
    const [active, setActive] = useState<string[]>(() => activeBooks.getActiveBooks());
    const [boundTo, setBoundTo] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState(false);
    const [query, setQuery] = useState('');

    const refresh = (): void => {
        setBooks(worldInfo.listBooks());
        setActive(activeBooks.getActiveBooks());
        const index = buildNodeIndex(store.getState().root);
        const mapping: Record<string, string> = {};
        for (const node of index.values()) {
            if (node.kind === 'folder') {
                const folder = node as FolderNode;
                if (folder.isWiRoot && folder.book) {
                    mapping[folder.book.bookName] = folder.name;
                }
            }
        }
        setBoundTo(mapping);
    };

    useEffect(() => {
        const onSettingsUpdated = (
            event: string,
            handler: (...args: unknown[]) => void
        ): (() => void) => {
            ctx.eventSource.on(event, handler);
            return () => ctx.eventSource.removeListener(event, handler);
        };
        refresh();
        const off1 = onSettingsUpdated(ctx.eventTypes.WORLDINFO_SETTINGS_UPDATED, refresh);
        const off2 = onSettingsUpdated(ctx.eventTypes.SETTINGS_UPDATED, refresh);
        const off3 = onSettingsUpdated(ctx.eventTypes.CHAT_CHANGED, refresh);
        return () => {
            off1();
            off2();
            off3();
        };
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    }, [store, worldInfo, activeBooks, ctx]);

    const states: BookState[] = useMemo(() => {
        const ctx2 = getAppContext();
        return collectBookStates(ctx2, active).filter((book) =>
            book.name.toLowerCase().includes(query.trim().toLowerCase())
        );
    }, [books, active, query, refreshTick]);

    const toggle = (name: string): void => {
        const next = active.includes(name)
            ? active.filter((item) => item !== name)
            : [...active, name];
        activeBooks.setActiveBooks(next);
        setActive(activeBooks.getActiveBooks());
    };

    const deleteBook = async (name: string): Promise<void> => {
        const confirmed = await confirmDialog(
            `Delete the native book file "${name}"? Character bindings to it remain native and are not cleaned up.`
        );
        if (!confirmed) {
            return;
        }
        setBusy(true);
        await worldInfo.deleteBook(name);
        setBooks([...worldInfo.listBooks()]);
        setBusy(false);
    };

    const activeCount = books.filter((name) => active.includes(name)).length;

    return (
        <div className="wiw-overlay" onClick={onClose}>
            <div className="wiw-panel" onClick={(event) => event.stopPropagation()}>
                <h3>
                    <i className="fa-solid fa-book-bookmark" /> Books{' '}
                    <span className="wiw-membership-line">
                        ({activeCount} of {books.length} active)
                    </span>
                </h3>
                <p>
                    Active books participate in generation for all chats.{' '}
                    <i className="fa-solid fa-user" style={{ color: 'var(--SmartThemeQuoteColor)' }} /> marks
                    the current character's book.
                </p>
                <input
                    className="wiw-tree-search"
                    type="text"
                    placeholder="Filter books…"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                />
                <div className="wiw-folder-picker">
                    {states.map((state) => (
                        <div key={state.name} className="wiw-book-row">
                            <label className="wiw-book-check">
                                <input
                                    type="checkbox"
                                    checked={state.globallyActive}
                                    onChange={() => toggle(state.name)}
                                />
                                <span title={state.name}>{state.name}</span>
                                {state.characterBound && (
                                    <i
                                        className="fa-solid fa-user wiw-book-char"
                                        title="Bound to the current character"
                                    />
                                )}
                                {state.chatBound && (
                                    <i
                                        className="fa-solid fa-comment"
                                        title="Bound to the current chat"
                                    />
                                )}
                            </label>
                            {boundTo[state.name] !== undefined ? (
                                <span className="wiw-badge wiw-badge-book" title={`Workspace root: ${boundTo[state.name]}`}>
                                    WI
                                </span>
                            ) : (
                                <button
                                    type="button"
                                    className="wiw-button wiw-icon-button wiw-danger-button"
                                    title={`Delete book file "${state.name}"`}
                                    disabled={busy}
                                    onClick={() => void deleteBook(state.name)}
                                >
                                    <i className="fa-solid fa-trash-can" />
                                </button>
                            )}
                        </div>
                    ))}
                    {states.length === 0 && <p>No books match the filter.</p>}
                </div>
                <div className="wiw-panel-actions">
                    <button type="button" className="wiw-button" onClick={onClose}>
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}

let refreshTick = 0;
function useRefreshTick(): number {
    return ++refreshTick;
}