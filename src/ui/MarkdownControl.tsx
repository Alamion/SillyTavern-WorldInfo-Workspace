import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { MdController } from '../adapters/mdController';
import { UNSUPPORTED_MESSAGE } from '../adapters/mdController';
import { getAppContext } from '../adapters/appApi';
import { ConflictDialog } from './ConflictDialog';
import { MappingReference } from './MappingReference';
import { OperationReport } from './OperationReport';

/**
 * Header control for markdown folders (spec 004, contracts/md-ui-contract.md):
 * availability gate, link status chip, operations menu, busy progress, conflict and
 * deletion decisions, operation report, mapping reference.
 */

interface MenuItem {
    id: string;
    icon: string;
    label: string;
    run(): void;
    danger?: boolean;
    allowWhileBusy?: boolean;
}

export interface MarkdownControlProps {
    md: MdController;
    /** Folder the menu's "Export to folder…" exports (selection or workspace root). */
    exportScopeId: string;
    exportScopeLabel: string;
    /** Folder "Import folder…" adds the imported subtree to. */
    importTargetId: string;
    importTargetLabel: string;
}

function relativeTime(iso: string | null): string {
    if (!iso) {
        return 'not synced yet';
    }
    const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
    if (seconds < 60) {
        return 'synced just now';
    }
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) {
        return `synced ${minutes} min ago`;
    }
    const hours = Math.round(minutes / 60);
    return hours < 48 ? `synced ${hours} h ago` : `synced ${new Date(iso).toLocaleDateString()}`;
}

export function MarkdownControl({
    md,
    exportScopeId,
    exportScopeLabel,
    importTargetId,
    importTargetLabel,
}: MarkdownControlProps): JSX.Element {
    const ui = useSyncExternalStore(md.subscribe, md.getUi);
    const link = useSyncExternalStore(md.link.subscribe, md.link.getStatus);
    const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
    const [referenceOpen, setReferenceOpen] = useState(false);
    const [, setTick] = useState(0);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const supported = md.isSupported();
    const busy = ui.busy ?? link.busy;
    // The header has a backdrop-filter, which makes it the containing block of any
    // absolute/fixed descendant: overlays and the dropdown must render outside it.
    const [surface, setSurface] = useState<HTMLElement | null>(null);
    useEffect(() => {
        setSurface((buttonRef.current?.closest('.wiw-surface') as HTMLElement | null) ?? document.body);
    }, []);
    const outside = (node: ReactNode): ReactNode => (surface ? createPortal(node, surface) : null);

    useEffect(() => {
        if (!menuAt) {
            return;
        }
        const close = (): void => setMenuAt(null);
        window.addEventListener('pointerdown', close);
        return () => window.removeEventListener('pointerdown', close);
    }, [menuAt]);

    // Keeps the relative "synced … ago" label fresh.
    useEffect(() => {
        const timer = window.setInterval(() => setTick((tick) => tick + 1), 60_000);
        return () => window.clearInterval(timer);
    }, []);

    const openMenu = (): void => {
        const rect = buttonRef.current?.getBoundingClientRect();
        setMenuAt(rect ? { x: Math.max(8, rect.right - 250), y: rect.bottom + 4 } : { x: 8, y: 48 });
    };

    const explainUnsupported = (): void => {
        const ctx = getAppContext();
        void ctx.callGenericPopup(UNSUPPORTED_MESSAGE, ctx.POPUP_TYPE.TEXT);
    };

    const confirmUnlink = async (): Promise<void> => {
        const ok = await md.confirm(
            `Unlink the workspace from "${link.folderName ?? 'the folder'}"? Files in the folder and workspace data stay as they are; only automatic syncing stops.`,
        );
        if (ok) {
            await md.link.unlink();
        }
    };

    const linked = link.phase !== 'none' && link.phase !== 'loading';
    const items: MenuItem[] = [];
    if (link.phase === 'linked') {
        items.push({ id: 'sync', icon: 'fa-rotate', label: 'Sync now', run: () => void md.link.syncNow() });
    } else if (link.phase === 'needs-reconnect') {
        items.push({
            id: 'reconnect',
            icon: 'fa-plug',
            label: 'Reconnect folder',
            run: () => void md.link.reconnect(),
        });
    }
    if (!linked) {
        items.push({
            id: 'link',
            icon: 'fa-link',
            label: 'Link workspace to a folder…',
            run: () => void md.link.link(),
        });
    } else {
        items.push({
            id: 'relink',
            icon: 'fa-folder-open',
            label: 'Re-link to a folder…',
            run: () => void md.link.relink(),
        });
    }
    items.push(
        {
            id: 'export',
            icon: 'fa-file-export',
            label: `Export ${exportScopeLabel} to folder…`,
            run: () => void md.exportFolder(exportScopeId),
        },
        {
            id: 'import',
            icon: 'fa-file-import',
            label: `Import folders into ${importTargetLabel}…`,
            run: () => void md.importFolder(importTargetId),
        },
        {
            id: 'import-files',
            icon: 'fa-file-circle-plus',
            label: `Import files (.md, images) into ${importTargetLabel}…`,
            run: () => void md.importFiles(importTargetId),
        },
        {
            id: 'reference',
            icon: 'fa-table-list',
            label: 'Mapping reference',
            run: () => setReferenceOpen(true),
            allowWhileBusy: true,
        },
    );
    if (ui.lastReport) {
        items.push({
            id: 'report',
            icon: 'fa-list-check',
            label: 'Last report',
            run: () => md.openLastReport(),
            allowWhileBusy: true,
        });
    }
    if (linked) {
        items.push({
            id: 'unlink',
            icon: 'fa-link-slash',
            label: 'Unlink',
            run: () => void confirmUnlink(),
            danger: true,
        });
    }

    const chip = (() => {
        if (busy) {
            return (
                <span className="wiw-chip" title={busy.label}>
                    <i className="fa-solid fa-spinner fa-spin" />
                    <span>
                        {busy.label}
                        {busy.total > 0 ? ` ${busy.done}/${busy.total}` : '…'}
                    </span>
                </span>
            );
        }
        if (!supported || !linked) {
            return null;
        }
        if (link.phase === 'needs-reconnect') {
            return (
                <button
                    type="button"
                    className="wiw-chip wiw-chip-warn"
                    title="Confirm access to the linked folder"
                    onClick={() => void md.link.reconnect()}
                >
                    <i className="fa-solid fa-plug" />
                    <span>Reconnect {link.folderName}</span>
                </button>
            );
        }
        if (link.phase === 'unavailable') {
            return (
                <button
                    type="button"
                    className="wiw-chip wiw-chip-warn"
                    title="The linked folder cannot be reached"
                    onClick={() => void md.link.relink()}
                >
                    <i className="fa-solid fa-triangle-exclamation" />
                    <span>Folder unavailable — re-link</span>
                </button>
            );
        }
        const attention = link.heldBack + link.conflicts;
        return (
            <button
                type="button"
                className={`wiw-chip${attention > 0 ? ' wiw-chip-warn' : ''}`}
                title={
                    attention > 0
                        ? 'Some items changed on both sides — click to sync and resolve'
                        : 'Sync the linked folder now'
                }
                onClick={() => void md.link.syncNow()}
            >
                <i className="fa-solid fa-folder-tree" />
                <span>
                    {link.folderName} · {relativeTime(link.lastSyncAt)}
                </span>
                {attention > 0 && <span className="wiw-chip-count">{attention}</span>}
            </button>
        );
    })();

    return (
        <>
            {chip}
            <button
                ref={buttonRef}
                type="button"
                className="wiw-button wiw-icon-button"
                title={supported ? 'Markdown folders: link, export, import' : UNSUPPORTED_MESSAGE}
                aria-disabled={!supported}
                style={supported ? undefined : { opacity: 0.55 }}
                onClick={(event) => {
                    event.stopPropagation();
                    if (!supported) {
                        explainUnsupported();
                        return;
                    }
                    if (menuAt) {
                        setMenuAt(null);
                    } else {
                        openMenu();
                    }
                }}
            >
                <i className="fa-solid fa-folder-tree" />
            </button>
            {menuAt &&
                outside(
                    <div
                        className="wiw-dropdown"
                        style={{ left: menuAt.x, top: menuAt.y }}
                        onPointerDown={(event) => event.stopPropagation()}
                    >
                        {items.map((item) => (
                            <button
                                key={item.id}
                                type="button"
                                className={`wiw-tree-menu-item${item.danger ? ' wiw-outcome-bad' : ''}`}
                                disabled={busy !== null && !item.allowWhileBusy}
                                onClick={() => {
                                    setMenuAt(null);
                                    item.run();
                                }}
                            >
                                <i className={`fa-solid ${item.icon}`} /> {item.label}
                            </button>
                        ))}
                        {linked && link.phase === 'linked' && (
                            <div className="wiw-dropdown-note">
                                Workspace edits are written to the folder automatically; changes made in the folder are
                                picked up on Sync and when the workspace opens.
                            </div>
                        )}
                    </div>,
                )}
            {ui.pending?.type === 'conflicts' &&
                outside(
                    <ConflictDialog
                        conflicts={ui.pending.conflicts}
                        onApply={(decisions) => ui.pending?.type === 'conflicts' && ui.pending.resolve(decisions)}
                    />,
                )}
            {ui.pending?.type === 'deletions' && outside(<DeletionDialog pending={ui.pending} />)}
            {ui.pending?.type === 'import-select' && outside(<ImportSelectDialog pending={ui.pending} />)}
            {ui.reportOpen &&
                ui.lastReport &&
                outside(<OperationReport report={ui.lastReport} onClose={() => md.closeReport()} />)}
            {referenceOpen && outside(<MappingReference onClose={() => setReferenceOpen(false)} />)}
        </>
    );
}

function DeletionDialog({
    pending,
}: {
    pending: Extract<NonNullable<ReturnType<MdController['getUi']>['pending']>, { type: 'deletions' }>;
}): JSX.Element {
    const synced = pending.items.filter((item) => item.syncedBooks.length > 0);
    return (
        <div className="wiw-overlay">
            <div className="wiw-panel wiw-panel-wide">
                <h3>Files deleted in the linked folder</h3>
                <p>
                    {pending.items.length} item(s) were deleted in the folder. Delete them in the workspace too? Cancel
                    keeps them and writes their files again.
                    {synced.length > 0 && ' Native book copies of synced entries will be removed at the next sync.'}
                </p>
                <div className="wiw-panel-body">
                    {pending.items.map((item) => (
                        <div key={item.id} className="wiw-report-row">
                            <i className="fa-solid fa-trash-can wiw-outcome-warn" />
                            <code>{item.path}</code>
                            {item.syncedBooks.length > 0 && <small>In books: {item.syncedBooks.join(', ')}</small>}
                        </div>
                    ))}
                </div>
                <div className="wiw-panel-actions">
                    <button type="button" className="wiw-button" onClick={() => pending.resolve(false)}>
                        Keep them
                    </button>
                    <button
                        type="button"
                        className="wiw-button wiw-danger-button"
                        onClick={() => pending.resolve(true)}
                    >
                        <i className="fa-solid fa-trash-can" /> Delete in workspace
                    </button>
                </div>
            </div>
        </div>
    );
}

type ImportSelectPending = Extract<NonNullable<ReturnType<MdController['getUi']>['pending']>, { type: 'import-select' }>;

function ImportSelectDialog({ pending }: { pending: ImportSelectPending }): JSX.Element {
    const [whole, setWhole] = useState(true);
    const [names, setNames] = useState<ReadonlySet<string>>(new Set());
    const toggle = (name: string): void => {
        setWhole(false);
        setNames((prev) => {
            const next = new Set(prev);
            if (next.has(name)) {
                next.delete(name);
            } else {
                next.add(name);
            }
            return next;
        });
    };
    const icon = { folder: 'fa-folder', entry: 'fa-book', image: 'fa-image' } as const;
    const canImport = whole || names.size > 0;
    return (
        <div className="wiw-overlay">
            <div className="wiw-panel wiw-panel-wide">
                <h3>Import from “{pending.folderName}”</h3>
                <p>
                    Import the whole folder as one workspace folder, or pick folders and files inside it — each picked
                    folder becomes its own workspace folder.
                </p>
                <div className="wiw-panel-body">
                    <label className="wiw-folder-option">
                        <input
                            type="checkbox"
                            checked={whole}
                            onChange={() => {
                                setWhole(!whole);
                                setNames(new Set());
                            }}
                        />
                        <i className="fa-solid fa-folder-tree" /> {pending.folderName} <small>(whole folder)</small>
                    </label>
                    {pending.items.map((item) => (
                        <label key={item.name} className="wiw-folder-option" style={{ paddingLeft: 24 }}>
                            <input
                                type="checkbox"
                                checked={!whole && names.has(item.name)}
                                onChange={() => toggle(item.name)}
                            />
                            <i className={`fa-solid ${icon[item.kind]}`} /> {item.name}
                        </label>
                    ))}
                </div>
                <div className="wiw-panel-actions">
                    <button type="button" className="wiw-button" onClick={() => pending.resolve(null)}>
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="wiw-button"
                        disabled={!canImport}
                        onClick={() => pending.resolve(whole ? { whole: true } : { whole: false, names })}
                    >
                        <i className="fa-solid fa-file-import" /> Import
                        {!whole && names.size > 0 ? ` ${names.size}` : ''}
                    </button>
                </div>
            </div>
        </div>
    );
}
