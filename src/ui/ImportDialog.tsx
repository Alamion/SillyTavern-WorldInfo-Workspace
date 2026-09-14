import { useState } from 'react';
import type { WorkspaceStateServices } from '../adapters/settingsStore';
import type { BoundConflict, BoundImportPlan } from '../core/sync/import';

/**
 * Import entry point (FR-016): pick a native book → unbound books import into
 * a fresh designated folder; books already bound to a root go through the
 * per-entry divergence resolution (keep workspace / take native).
 */
export function ImportDialog({
    services,
    onClose,
}: {
    services: WorkspaceStateServices;
    onClose(): void;
}): JSX.Element {
    const { worldInfo, sync } = services;
    const [books] = useState<string[]>(() => worldInfo.listBooks());
    const [plan, setPlan] = useState<{ book: string; data: BoundImportPlan } | null>(null);
    const [resolutions, setResolutions] = useState<Record<string, 'keep-workspace' | 'take-native'>>({});
    const [busy, setBusy] = useState(false);

    const pick = async (name: string): Promise<void> => {
        if (sync.isBookBound(name)) {
            const data = await sync.planBoundImportFor(name);
            if (data && (data.conflicts.length > 0 || data.additions.length > 0)) {
                setPlan({ book: name, data });
                setResolutions(
                    Object.fromEntries(
                        data.conflicts.map((conflict) => [conflict.nodeId, 'keep-workspace' as const])
                    )
                );
                return;
            }
        }
        setBusy(true);
        await sync.importUnboundBook(name);
        setBusy(false);
        onClose();
    };

    const apply = async (): Promise<void> => {
        if (!plan) {
            return;
        }
        setBusy(true);
        await sync.applyBoundImport(plan.book, plan.data, new Map(Object.entries(resolutions)));
        sync.markBooksDirty([plan.book]);
        setBusy(false);
        onClose();
    };

    return (
        <div className="wiw-overlay" onClick={onClose}>
            <div className="wiw-panel" onClick={(event) => event.stopPropagation()}>
                <h3>
                    <i className="fa-solid fa-file-import" /> Import a native lorebook
                </h3>
                {!plan && (
                    <div className="wiw-folder-picker">
                        {books.map((name) => (
                            <button
                                key={name}
                                type="button"
                                className="wiw-folder-option"
                                disabled={busy}
                                onClick={() => void pick(name)}
                            >
                                <i className="fa-solid fa-file-import" />
                                <span>{name}</span>
                                <small className="wiw-membership-line">
                                    {sync.isBookBound(name) ? 'update bound root' : 'import as new folder'}
                                </small>
                            </button>
                        ))}
                        {books.length === 0 && <p>No native books to import.</p>}
                    </div>
                )}
                {plan && (
                    <div className="wiw-import-plan">
                        <p>
                            {plan.data.conflicts.length} conflicted{' '}
                            {plan.data.conflicts.length === 1 ? 'entry' : 'entries'} (changed
                            both here and outside), {plan.data.refreshes.length} will be
                            updated in place, {plan.data.additions.length} new from the
                            native book.
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
                                            Take native:{' '}
                                            {conflict.nativeEntry.comment || `Entry ${conflict.uid}`}
                                        </span>
                                    </label>
                                </div>
                            ))}
                            {plan.data.refreshes.map((refresh) => (
                                <div key={refresh.nodeId} className="wiw-book-row">
                                    <span className="wiw-membership-line">
                                        ↻ update: {refresh.nativeEntry.comment || `Entry ${refresh.uid}`}
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
                                onClick={() => void apply()}
                            >
                                Apply
                            </button>
                        </div>
                    </div>
                )}
                {!plan && (
                    <div className="wiw-panel-actions">
                        <button type="button" className="wiw-button" onClick={onClose}>
                            Cancel
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}