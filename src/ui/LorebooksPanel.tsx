import { useState } from 'react';
import { notifyInfo, notifySuccess } from '../adapters/logger';
import { confirmDialog } from '../adapters/popups';
import type { WorkspaceStateServices } from '../adapters/settingsStore';
import type { BookFacts } from '../core/books/listing';
import type { BoundConflict, BoundImportPlan } from '../core/sync/import';
import { BookList, BookMarkers, useBookFacts } from './BookList';

/**
 * The single native-lorebook surface (FR-016/FR-017/FR-022): every book with
 * its global activation checkbox, import (books outside the workspace) or
 * update-from-native (books bound to a workspace folder), and deletion.
 * Deleting a bound book removes BOTH the native file and its workspace folder.
 * Search, filters and pagination keep hundreds of books navigable.
 */
export function LorebooksPanel({
    services,
    importTarget,
    onDeleteBoundBook,
    onClose,
}: {
    services: WorkspaceStateServices;
    /** Folder new imports land in (next to the tree selection). */
    importTarget: { id: string; name: string };
    /** Deletes the bound folder together with its native book (asks first). */
    onDeleteBoundBook(folderId: string, bookName: string): Promise<boolean>;
    onClose(): void;
}): JSX.Element {
    const { worldInfo, activeBooks, sync } = services;
    const { books, refresh } = useBookFacts(services);
    const [busy, setBusy] = useState(false);
    const [plan, setPlan] = useState<{ book: string; data: BoundImportPlan } | null>(null);
    const [resolutions, setResolutions] = useState<Record<string, 'keep-workspace' | 'take-native'>>({});
    const canActivate = activeBooks.isAvailable();

    const run = async (action: () => Promise<void>): Promise<void> => {
        setBusy(true);
        try {
            await action();
        } finally {
            setBusy(false);
            refresh();
        }
    };

    const toggleActive = (name: string, active: boolean): void => {
        const current = activeBooks.getActiveBooks();
        activeBooks.setActiveBooks(active ? [...current, name] : current.filter((item) => item !== name));
        refresh();
    };

    const importBook = (book: BookFacts): Promise<void> =>
        run(async () => {
            if (book.workspaceRootId === null) {
                await sync.importUnboundBook(book.name, importTarget.id);
                return;
            }
            const data = await sync.planBoundImportFor(book.name);
            if (data && (data.conflicts.length > 0 || data.additions.length > 0)) {
                setPlan({ book: book.name, data });
                setResolutions(
                    Object.fromEntries(data.conflicts.map((conflict) => [conflict.nodeId, 'keep-workspace' as const]))
                );
                return;
            }
            // Nothing to resolve: clean refreshes apply directly.
            if (data && data.refreshes.length > 0) {
                await sync.applyBoundImport(book.name, data, new Map());
                notifySuccess(`Updated ${data.refreshes.length} entries of "${book.workspaceRoot ?? book.name}".`);
            } else if (data) {
                notifyInfo(`"${book.workspaceRoot ?? book.name}" is already up to date.`);
            }
        });

    const deleteBook = (book: BookFacts): Promise<void> =>
        run(async () => {
            if (book.workspaceRootId !== null) {
                await onDeleteBoundBook(book.workspaceRootId, book.name);
                return;
            }
            const confirmed = await confirmDialog(
                `Delete the native lorebook "${book.name}"? This cannot be undone. Character bindings to it remain native and are not cleaned up.`
            );
            if (confirmed) {
                await worldInfo.deleteBook(book.name);
            }
        });

    const applyPlan = (): Promise<void> =>
        run(async () => {
            if (!plan) {
                return;
            }
            await sync.applyBoundImport(plan.book, plan.data, new Map(Object.entries(resolutions)));
            sync.markBooksDirty([plan.book]);
            setPlan(null);
        });

    const activeCount = books.filter((book) => book.globallyActive).length;

    return (
        <div className="wiw-overlay" onClick={onClose}>
            <div className="wiw-panel wiw-books-panel" onClick={(event) => event.stopPropagation()}>
                <h3>
                    <i className="fa-solid fa-book-atlas" /> Lorebooks{' '}
                    <span className="wiw-membership-line">
                        ({activeCount} of {books.length} globally active)
                    </span>
                </h3>
                {!plan && (
                    <>
                        <p className="wiw-membership-line">
                            <i className="fa-solid fa-square-check" /> active for every chat ·{' '}
                            <i className="fa-solid fa-user wiw-book-marker" /> current character ·{' '}
                            <i className="fa-solid fa-comment wiw-book-marker" /> current chat
                            <br />
                            New imports go into <strong>{importTarget.name}</strong> (select a folder in the tree to
                            change).
                        </p>
                        {!canActivate && (
                            <p className="wiw-banner wiw-banner-warn">
                                <i className="fa-solid fa-triangle-exclamation" />
                                The native activation list is not available yet; activation is read-only.
                            </p>
                        )}
                        <BookList
                            books={books}
                            filters={['all', 'active', 'context', 'workspace', 'outside']}
                            emptyText={books.length === 0 ? 'No native lorebooks yet.' : 'No lorebooks match.'}
                            renderRow={(book) => (
                                <>
                                    <label
                                        className="wiw-book-check"
                                        title={book.globallyActive ? 'Active for every chat' : 'Not globally active'}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={book.globallyActive}
                                            disabled={!canActivate}
                                            onChange={(event) => toggleActive(book.name, event.target.checked)}
                                        />
                                        <span title={book.name}>{book.name}</span>
                                        <BookMarkers book={book} />
                                    </label>
                                    <button
                                        type="button"
                                        className="wiw-button wiw-icon-button"
                                        disabled={busy}
                                        title={
                                            book.workspaceRootId === null
                                                ? `Import into "${importTarget.name}"`
                                                : `Update folder "${book.workspaceRoot ?? ''}" from the native book`
                                        }
                                        onClick={() => void importBook(book)}
                                    >
                                        <i
                                            className={`fa-solid ${book.workspaceRootId === null ? 'fa-file-import' : 'fa-rotate'}`}
                                        />
                                    </button>
                                    <button
                                        type="button"
                                        className="wiw-button wiw-icon-button wiw-danger-button"
                                        disabled={busy}
                                        title={
                                            book.workspaceRootId === null
                                                ? `Delete lorebook "${book.name}"`
                                                : `Delete lorebook "${book.name}" and its workspace folder`
                                        }
                                        onClick={() => void deleteBook(book)}
                                    >
                                        <i className="fa-solid fa-trash-can" />
                                    </button>
                                </>
                            )}
                        />
                        <div className="wiw-panel-actions">
                            <button type="button" className="wiw-button" onClick={onClose}>
                                Close
                            </button>
                        </div>
                    </>
                )}
                {plan && (
                    <div className="wiw-import-plan">
                        <p>
                            Update from <strong>{plan.book}</strong>: {plan.data.conflicts.length} conflicted{' '}
                            {plan.data.conflicts.length === 1 ? 'entry' : 'entries'} (changed both here and
                            outside), {plan.data.refreshes.length} will be updated in place,{' '}
                            {plan.data.additions.length} new from the native book.
                        </p>
                        <div className="wiw-folder-picker">
                            {plan.data.conflicts.map((conflict: BoundConflict) => (
                                <div key={conflict.nodeId} className="wiw-book-row">
                                    <label className="wiw-book-check">
                                        <input
                                            type="checkbox"
                                            checked={resolutions[conflict.nodeId] === 'take-native'}
                                            onChange={(event) =>
                                                setResolutions((prev) => ({
                                                    ...prev,
                                                    [conflict.nodeId]: event.target.checked
                                                        ? 'take-native'
                                                        : 'keep-workspace',
                                                }))
                                            }
                                        />
                                        <span>
                                            Take native: {conflict.nativeEntry.comment || `Entry ${conflict.uid}`}
                                        </span>
                                    </label>
                                </div>
                            ))}
                            {plan.data.refreshes.map((item) => (
                                <div key={item.nodeId} className="wiw-book-row">
                                    <span className="wiw-membership-line">
                                        ↻ update: {item.nativeEntry.comment || `Entry ${item.uid}`}
                                    </span>
                                </div>
                            ))}
                            {plan.data.additions.map((addition) => (
                                <div key={addition.uid} className="wiw-book-row">
                                    <span className="wiw-membership-line">
                                        + add {addition.name} (native uid {addition.uid})
                                    </span>
                                </div>
                            ))}
                        </div>
                        <div className="wiw-panel-actions">
                            <button type="button" className="wiw-button" onClick={() => setPlan(null)}>
                                Back
                            </button>
                            <button
                                type="button"
                                className="wiw-button wiw-danger-button"
                                disabled={busy}
                                onClick={() => void applyPlan()}
                            >
                                Apply
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
