import { webDigest } from '../core/md/hash';
import type { OperationReport } from '../core/md/report';
import type { Digest, DiskFolderAccess, ImageStorePort, YamlCodec } from '../core/md/ports';
import type { WorkspaceStore } from '../core/state/store';
import { findNode } from '../core/state/schema';
import { notifyError, notifyWarning } from './logger';
import { confirmDialog } from './popups';
import { createImageResolver, prepareExport } from './mdExport';
import { createYamlCodec } from './yamlCodec';
import { runImport } from './mdImport';
import { createCancelSource, isCancellation } from '../core/md/cancel';
import { createFilesFolder } from '../core/md/filesFolder';
import { listTopLevel, selectTopLevel, wrapAsDirectory, type TopLevelItem } from '../core/md/folderViews';
import type { DiskFolder } from '../core/md/ports';
import type { SyncEngine } from './syncEngine';
import { designateRestoredRoot } from './workspaceActions';
import { createMdLink, type ConflictDecision, type ConflictView, type MdLink } from './mdLink';
import type { RelPath } from '../core/md/ports';

/**
 * Markdown feature controller (spec 004): the single UI-facing surface for
 * export, import and the folder link. Holds the observable UI state (busy
 * progress, last report) so any component — header control, tree menu — can
 * trigger operations and render their outcome.
 */

export interface MdBusy {
    label: string;
    done: number;
    total: number;
    /**
     * Present only while the operation is in a phase that can be stopped safely
     * (spec 006 FR-003). Writing phases deliberately omit it — stopping halfway
     * would leave a partially written folder — and say so in their label.
     */
    cancel?: () => void;
}

/** Import choice: the picked folder as one folder, or some of its top-level items. */
export type ImportSelection = { whole: true } | { whole: false; names: ReadonlySet<string> };

export type MdPendingDecision =
    | {
          type: 'import-select';
          folderName: string;
          items: TopLevelItem[];
          resolve(selection: ImportSelection | null): void;
      }
    | { type: 'conflicts'; conflicts: ConflictView[]; resolve(decisions: Map<string, ConflictDecision>): void }
    | {
          type: 'deletions';
          items: Array<{ id: string; path: RelPath; name: string; syncedBooks: string[] }>;
          resolve(confirmed: boolean): void;
      };

export interface MdUiState {
    busy: MdBusy | null;
    lastReport: OperationReport | null;
    reportOpen: boolean;
    pending: MdPendingDecision | null;
}

export interface MdControllerDeps {
    store: WorkspaceStore;
    sync: SyncEngine;
    newId: () => string;
    access: DiskFolderAccess;
    imageStore: ImageStorePort;
    digest?: Digest;
    yaml?: () => YamlCodec;
    confirm?: (message: string) => Promise<boolean>;
    emit?: (event: string, payload: unknown) => void;
}

export interface MdController {
    readonly access: DiskFolderAccess;
    readonly link: MdLink;
    getUi(): MdUiState;
    subscribe(listener: () => void): () => void;
    isSupported(): boolean;
    exportFolder(scopeFolderId: string): Promise<void>;
    importFolder(targetFolderId: string): Promise<void>;
    importFiles(targetFolderId: string): Promise<void>;
    showReport(report: OperationReport): void;
    openLastReport(): void;
    closeReport(): void;
    /** Shared plumbing for the other md flows. */
    setBusy(busy: MdBusy | null): void;
    yaml(): YamlCodec;
    readonly digest: Digest;
    readonly imageStore: ImageStorePort;
    readonly store: WorkspaceStore;
    readonly sync: SyncEngine;
    readonly newId: () => string;
    readonly confirm: (message: string) => Promise<boolean>;
}

export const UNSUPPORTED_MESSAGE =
    'Markdown folders need a desktop Chromium-based browser (Chrome, Edge, Opera…) and a secure page (HTTPS or localhost).';

export function createMdController(deps: MdControllerDeps): MdController {
    let ui: MdUiState = { busy: null, lastReport: null, reportOpen: false, pending: null };
    const listeners = new Set<() => void>();
    let yamlCodec: YamlCodec | null = null;
    const digest = deps.digest ?? webDigest;
    const confirm = deps.confirm ?? confirmDialog;

    const setUi = (patch: Partial<MdUiState>): void => {
        ui = { ...ui, ...patch };
        listeners.forEach((listener) => listener());
    };

    const yaml = (): YamlCodec => {
        if (!yamlCodec) {
            yamlCodec = (deps.yaml ?? createYamlCodec)();
        }
        return yamlCodec;
    };

    const link = createMdLink({
        store: deps.store,
        sync: deps.sync,
        access: deps.access,
        imageStore: deps.imageStore,
        digest,
        yaml,
        resolveImage: createImageResolver(),
        designate: (folderId, bookName) => designateRestoredRoot({ store: deps.store, sync: deps.sync, confirm }, folderId, bookName),
        newId: deps.newId,
        emit: deps.emit,
        onReport: (report) => {
            const changed = report.lines.some((line) => line.outcome !== 'skipped');
            // Quiet syncs (nothing happened) only refresh the last report.
            setUi(changed ? { lastReport: report, reportOpen: true } : { lastReport: report });
        },
        onError: (message) => notifyError(message),
        decisions: {
            confirmLink: (summary) =>
                confirm(
                    `Link the workspace to "${summary.folderName}"? ${summary.matched} item(s) already match, ` +
                        `${summary.imported} will be added to the workspace from the folder, ${summary.written} will be written ` +
                        `to the folder, ${summary.conflicts} conflict(s) will be shown for a decision. Unrelated files are never touched.`
                ),
            resolveConflicts: (conflicts) =>
                new Promise((resolve) =>
                    setUi({
                        pending: {
                            type: 'conflicts',
                            conflicts,
                            resolve: (decisions) => {
                                setUi({ pending: null });
                                resolve(decisions);
                            },
                        },
                    })
                ),
            confirmDeletions: (items) =>
                new Promise((resolve) =>
                    setUi({
                        pending: {
                            type: 'deletions',
                            items,
                            resolve: (confirmed) => {
                                setUi({ pending: null });
                                resolve(confirmed);
                            },
                        },
                    })
                ),
        },
    });

    const runImportFrom = async (folder: DiskFolder, targetFolderId: string): Promise<void> => {
        const source = createCancelSource();
        try {
            setUi({ busy: { label: 'Importing', done: 0, total: 0, cancel: source.cancel } });
            const { report } = await runImport({
                cancel: source.token,
                folder,
                store: deps.store,
                targetFolderId,
                yaml: yaml(),
                digest,
                imageStore: deps.imageStore,
                newId: deps.newId,
                placeholderUid: () => 900000 + Math.floor(Math.random() * 90000),
                designate: (folderId, bookName) =>
                    designateRestoredRoot({ store: deps.store, sync: deps.sync, confirm }, folderId, bookName),
                onProgress: (label, done, total) =>
                    setUi({
                        busy: {
                            label,
                            done,
                            total,
                            // Only the reading phase can be stopped; once files
                            // are being written the handle is dropped.
                            cancel: label === 'Reading files' ? source.cancel : undefined,
                        },
                    }),
            });
            controller.showReport(report);
        } catch (error) {
            if (isCancellation(error)) {
                notifyWarning('Import cancelled. Nothing was changed.');
            } else {
                notifyError(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
            }
        } finally {
            setUi({ busy: null });
        }
    };

    const controller: MdController = {
        access: deps.access,
        link,
        digest,
        imageStore: deps.imageStore,
        store: deps.store,
        sync: deps.sync,
        newId: deps.newId,
        confirm,
        yaml,
        getUi: () => ui,
        subscribe: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        isSupported: () => deps.access.isSupported(),
        setBusy: (busy) => setUi({ busy }),
        showReport: (report) => setUi({ lastReport: report, reportOpen: true }),
        openLastReport: () => setUi({ reportOpen: ui.lastReport !== null }),
        closeReport: () => setUi({ reportOpen: false }),

        exportFolder: async (scopeFolderId) => {
            if (ui.busy) {
                return;
            }
            // The picker must open within the click's user activation: no awaits before it.
            let picked: Awaited<ReturnType<DiskFolderAccess['pick']>>;
            try {
                picked = await deps.access.pick('readwrite');
            } catch (error) {
                notifyError(`The folder could not be opened: ${String(error)}`);
                return;
            }
            if (!picked) {
                return;
            }
            try {
                setUi({ busy: { label: 'Preparing export', done: 0, total: 0 } });
                const state = deps.store.getState();
                const preflight = await prepareExport({
                    folder: picked.folder,
                    state,
                    scopeFolderId,
                    yaml: yaml(),
                    digest,
                    resolveImage: createImageResolver(),
                });
                if (!preflight) {
                    return;
                }
                if (preflight.overwrites.length > 0) {
                    const scopeName =
                        scopeFolderId === state.root.id ? 'the workspace' : `"${findNode(state, scopeFolderId)?.name ?? ''}"`;
                    const shown = preflight.overwrites.slice(0, 8).join(', ');
                    const more = preflight.overwrites.length > 8 ? ` and ${preflight.overwrites.length - 8} more` : '';
                    setUi({ busy: null });
                    const ok = await confirm(
                        `Export ${scopeName} into "${picked.name}"? ${preflight.overwrites.length} existing file(s) will be overwritten: ${shown}${more}. Files the export does not produce are left untouched.`
                    );
                    if (!ok) {
                        return;
                    }
                }
                const report = await preflight.run((done, total) =>
                    setUi({ busy: { label: 'Exporting', done, total } })
                );
                controller.showReport(report);
            } catch (error) {
                notifyError(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
            } finally {
                setUi({ busy: null });
            }
        },

        importFolder: async (targetFolderId) => {
            if (ui.busy) {
                return;
            }
            let picked: Awaited<ReturnType<DiskFolderAccess['pick']>>;
            try {
                picked = await deps.access.pick('read');
            } catch (error) {
                notifyError(`The folder could not be opened: ${String(error)}`);
                return;
            }
            if (!picked) {
                return;
            }
            const folder = picked.folder;
            const folderName = picked.name;
            const items = await listTopLevel(folder);
            const selection =
                items.some((item) => item.kind === 'folder')
                    ? await new Promise<ImportSelection | null>((resolve) =>
                          setUi({
                              pending: {
                                  type: 'import-select',
                                  folderName,
                                  items,
                                  resolve: (choice) => {
                                      setUi({ pending: null });
                                      resolve(choice);
                                  },
                              },
                          })
                      )
                    : ({ whole: true } as const);
            if (!selection) {
                return;
            }
            await runImportFrom(
                selection.whole ? wrapAsDirectory(folder, folderName) : selectTopLevel(folder, selection.names),
                targetFolderId
            );
        },

        importFiles: async (targetFolderId) => {
            if (ui.busy) {
                return;
            }
            let files: Awaited<ReturnType<DiskFolderAccess['pickFiles']>>;
            try {
                files = await deps.access.pickFiles();
            } catch (error) {
                notifyError(`The files could not be opened: ${String(error)}`);
                return;
            }
            if (files && files.length > 0) {
                await runImportFrom(createFilesFolder(files), targetFolderId);
            }
        },
    };
    return controller;
}
