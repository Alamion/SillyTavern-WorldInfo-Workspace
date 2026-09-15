import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { getAppContext } from '../adapters/appApi';
import { confirmDialog, inputDialog } from '../adapters/popups';
import { onSaveEvent } from '../adapters/saveEvents';
import { openNativeMode } from '../adapters/shell';
import { notifyError, notifySuccess } from '../adapters/logger';
import { discardRecovered, restoreRecovered, type WorkspaceStateServices } from '../adapters/settingsStore';
import { applyTreeChange, collectEntityDeletions } from '../adapters/workspaceActions';
import type { NativeWorldInfoEntry } from '../global';
import { createDemoState } from '../core/demo/dataset';
import {
    buildNodeIndex,
    findNode,
    type FolderNode,
    type TreeNode,
    type WorkspaceState,
} from '../core/state/schema';
import type { SortMode } from '../core/tree/browse';
import {
    bulkDeleteNodes,
    bulkMoveNodes,
    bulkSetDisable,
    commitEntryField as commitEntryFieldOp,
    commitImage as commitImageOp,
    createChild,
    moveNode,
    renameNode,
    setExpanded,
    type CreateKind,
} from '../core/tree/operations';
import { validateNode } from '../core/tree/validation';
import { resolveImageReference } from '../core/tree/imageLinks';
import { AssistantPanel } from './AssistantPanel';
import { LorebooksPanel } from './LorebooksPanel';
import { MarkdownControl } from './MarkdownControl';
import { ItemEditor } from './ItemEditor';
import Sheet from './Sheet';
import { StructureTree, type TreeMenuAction, type TreeMenuState } from './StructureTree';

const TREE_MIN = 140;
const TREE_COLLAPSE_BELOW = 120;
const TREE_MAX = 640;

const BASE_NAMES: Record<CreateKind, string> = {
    folder: 'New Folder',
    entry: 'New Entry',
    image: 'New Image',
};

export function WorkspaceApp({ services }: { services: WorkspaceStateServices }): JSX.Element {
    const { store, sync } = services;
    const state = useSyncExternalStore(store.subscribe, store.getState);
    const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
    const [menu, setMenu] = useState<TreeMenuState | null>(null);
    const [movePickerFor, setMovePickerFor] = useState<{ ids: string[] } | null>(null);
    const [lorebooksOpen, setLorebooksOpen] = useState(false);
    const [reportsTick, setReportsTick] = useState(0);
    const [lastFailure, setLastFailure] = useState<{ message: string; bookName?: string } | null>(null);
    const [retrying, setRetrying] = useState(false);
    const [assistantOpen, setAssistantOpen] = useState(false);
    const [treeWidth, setTreeWidth] = useState(300);
    const [treeCollapsed, setTreeCollapsed] = useState(false);
    const [dragging, setDragging] = useState<{ startX: number; startWidth: number } | null>(null);
    const [mobileSheet, setMobileSheet] = useState<'none' | 'editor' | 'assistant'>('none');
    const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 900px)').matches);

    useEffect(() => {
        const query = window.matchMedia('(max-width: 900px)');
        const listener = (event: MediaQueryListEvent): void => {
            setIsMobile(event.matches);
        };
        query.addEventListener('change', listener);
        return () => query.removeEventListener('change', listener);
    }, []);

    useEffect(() => {
        const offSync = sync.subscribe(() => setReportsTick((tick) => tick + 1));
        const offSave = onSaveEvent((event) => {
            if (event.kind === 'failure') {
                setLastFailure({ message: event.message, bookName: event.bookName });
            } else {
                // A success clears only the failure of the same book.
                setLastFailure((prev) => (prev && prev.bookName !== event.bookName ? prev : null));
            }
        });
        return () => {
            offSync();
            offSave();
        };
    }, [sync]);

    void reportsTick;

    const ctx = getAppContext();
    const index = useMemo(() => buildNodeIndex(state.root), [state]);
    const primaryId = selectedIds.size > 0 ? [...selectedIds][selectedIds.size - 1]! : null;
    const selected: TreeNode | null = primaryId !== null ? (index.get(primaryId) ?? null) : null;
    const violations = useMemo(() => (selected ? validateNode(selected) : []), [selected]);

    /**
     * UI operations MUST apply against the CURRENT store state, never a render
     * snapshot: the engine writes sync bookkeeping between renders, and a
     * replace from a stale snapshot would silently drop it (real bug: deletion
     * tombstones were erased before their push).
     */
    const applyOperation = (op: (current: WorkspaceState) => WorkspaceState | null): void => {
        const next = op(store.getState());
        if (next) {
            store.replace(next);
        }
    };

    const handleRetry = async (): Promise<void> => {
        let failed = false;
        const offSave = onSaveEvent((event) => {
            if (event.kind === 'failure') {
                failed = true;
            }
        });
        setRetrying(true);
        try {
            await sync.pushPendingNow('retry');
        } finally {
            offSave();
            setRetrying(false);
        }
        if (!failed) {
            setLastFailure(null);
            notifySuccess('All pending changes are saved to the lorebooks.');
        }
    };

    const handleRestoreBackup = (): void => {
        const outcome = restoreRecovered(store);
        if (outcome.ok) {
            setSelectedIds(new Set());
            notifySuccess('Workspace restored from the backup.');
        } else {
            notifyError(`The backup still cannot be loaded: ${outcome.issues.slice(0, 3).join('; ')}`);
        }
    };

    const handleDiscardBackup = async (): Promise<void> => {
        if (await confirmDialog('Permanently delete the workspace backup? This cannot be undone.')) {
            discardRecovered(store);
        }
    };

    const importTarget = (): { id: string; name: string } => {
        const id = resolveSelectionParent();
        return { id, name: id === state.root.id ? 'the workspace root' : (index.get(id)?.name ?? 'the workspace root') };
    };

    const handleDeleteBoundBook = async (folderId: string, bookName: string): Promise<boolean> => {
        const folder = index.get(folderId);
        if (folder?.kind !== 'folder') {
            return false;
        }
        const items = buildNodeIndex(folder).size - 1;
        const confirmed = await confirmDialog(
            `Delete the lorebook "${bookName}" AND its workspace folder "${folder.name}" (${items} ${items === 1 ? 'item' : 'items'} inside)? ` +
                'Both the native file and the folder are removed. This cannot be undone.'
        );
        if (!confirmed) {
            return false;
        }
        await handleDelete([folderId], { preconfirmed: true, rootBooks: 'delete' });
        return true;
    };

    const resolveSelectionParent = (): string => {
        if (selected && selected.kind === 'folder' && selected.id !== state.root.id) {
            return selected.id;
        }
        if (selected && selected.parentId !== null) {
            return selected.parentId;
        }
        return state.root.id;
    };

    const handleCreate = (kind: CreateKind): void => {
        const target = resolveSelectionParent();
        let createdId: string | null = null;
        applyOperation((current) => {
            const next = createChild(current, target, kind, BASE_NAMES[kind], () => ctx.uuidv4());
            if (next) {
                createdId = diffCreatedId(current, next);
            }
            return next;
        });
        if (createdId) {
            setSelectedIds(new Set([createdId]));
            if (isMobile) {
                setMobileSheet('editor');
            }
        }
    };

    const handleSelect = (id: string, additive: 'none' | 'toggle' | 'range'): void => {
        setMenu(null);
        if (additive === 'toggle') {
            setSelectedIds((prev) => {
                const next = new Set(prev);
                if (next.has(id)) {
                    next.delete(id);
                } else {
                    next.add(id);
                }
                return next;
            });
            return;
        }
        if (additive === 'range') {
            const clicked = index.get(id);
            const anchor = selected;
            if (clicked && anchor && clicked.parentId === anchor.parentId && clicked.parentId !== null) {
                const parent = index.get(clicked.parentId);
                if (parent?.kind === 'folder') {
                    const ids = parent.children.map((child) => child.id);
                    const from = ids.indexOf(anchor.id);
                    const to = ids.indexOf(id);
                    if (from >= 0 && to >= 0) {
                        const [a, b] = from <= to ? [from, to] : [to, from];
                        setSelectedIds(new Set(ids.slice(a, b + 1)));
                        return;
                    }
                }
            }
            setSelectedIds(new Set([id]));
            return;
        }
        setSelectedIds(new Set([id]));
        if (isMobile) {
            setMobileSheet('editor');
        }
    };

    const handleExpand = (folderId: string, expanded: boolean): void => {
        applyOperation((current) => setExpanded(current, folderId, expanded));
    };

    const handleSort = (mode: SortMode): void => {
        store.update((draft) => {
            draft.settings.sortMode = mode;
        });
    };

    const handleMoveNode = (nodeId: string, parentId: string, indexInParent?: number): void => {
        // A multi-selection drags as one block, including the grabbed row even
        // when it was not selected. A single selection is just the open item and
        // does not follow an unrelated drag.
        if (selectedIds.size > 1) {
            const ids = [...selectedIds, nodeId];
            applyTreeChange(services, (current) => bulkMoveNodes(current, ids, parentId, indexInParent));
        } else {
            applyTreeChange(services, (current) => moveNode(current, nodeId, parentId, indexInParent));
        }
        sync.refreshStructure();
    };

    const handleReorder = (parentId: string, fromIndex: number, toIndex: number): void => {
        const parent = findNode(state, parentId);
        const book = parent?.kind === 'folder' ? nearestBook(parentId) : null;
        store.update((draft) => {
            const target = findNode(draft, parentId);
            if (target?.kind === 'folder') {
                const moved = target.children.splice(fromIndex, 1)[0];
                if (moved) {
                    target.children.splice(Math.max(toIndex, 0), 0, moved);
                }
            }
        });
        if (book) {
            sync.markBooksDirty([book]);
        }
    };

    const nearestBook = (nodeId: string): string | null => {
        let cursor: TreeNode | undefined = index.get(nodeId);
        while (cursor) {
            if (cursor.kind === 'folder' && cursor.isWiRoot && cursor.book) {
                return cursor.book.bookName;
            }
            cursor = cursor.parentId !== null ? index.get(cursor.parentId) : undefined;
        }
        return null;
    };

    const entityBooks = (node: TreeNode): string[] =>
        node.kind === 'entry' ? Object.keys(node.sync.books) : [];

    const deleteMessageFor = (node: TreeNode): string => {
        let message = `Delete "${node.name}"${node.kind === 'folder' ? ' and everything inside it' : ''}? This cannot be undone.`;
        const books = entityBooks(node);
        if (books.length > 0) {
            message += ` Its copy in the native book "${books[0]}" will be removed at the next sync.`;
        }
        return message;
    };

    /**
     * `preconfirmed` skips the generic prompt (the caller already asked);
     * `rootBooks: 'delete'` removes designated roots' native books without the
     * keep-or-delete question (Lorebooks panel: delete book + folder).
     */
    const handleDelete = async (
        ids: readonly string[],
        options: { preconfirmed?: boolean; rootBooks?: 'ask' | 'delete' } = {}
    ): Promise<void> => {
        const targets = ids
            .map((id) => index.get(id))
            .filter((node): node is TreeNode => Boolean(node) && node!.id !== state.root.id);
        if (targets.length === 0) {
            return;
        }
        const label =
            targets.length === 1
                ? deleteMessageFor(targets[0]!)
                : `Delete ${targets.length} items? This cannot be undone.` +
                  (targets.some((node) => entityBooks(node).length > 0)
                      ? ' Native book copies of synced items will be removed at the next sync.'
                      : '');
        const tracked = services.md.link.getStatus().trackedIds;
        const linkedFiles = targets.some((node) => {
            const ids = buildNodeIndex(node).keys();
            return [...ids].some((id) => tracked.has(id));
        });
        const confirmed =
            options.preconfirmed === true ||
            (await confirmDialog(linkedFiles ? `${label} Its file(s) in the linked folder will be removed.` : label));
        if (!confirmed) {
            return;
        }
        // Deletion of a FOLDER removes its whole subtree: per-book uids are
        // collected recursively, otherwise copies inside parent WI books survive.
        const { deletions, books: affectedBooks } = collectEntityDeletions(targets);
        if (deletions.length > 0) {
            // FR-021 removal intent: tombstones keep the auto-merge from
            // resurrecting what the user explicitly deleted.
            sync.recordEntityDeletions(deletions);
        }
        // FR-019: designated roots offer keep-or-delete for their native book.
        for (const node of targets) {
            if (node.kind === 'folder' && node.isWiRoot && node.book) {
                const deleteBook =
                    options.rootBooks === 'delete' ||
                    (await confirmDialog(
                        `Also delete the native book "${node.book.bookName}"? Cancel = keep the book file in the app.`
                    ));
                await sync.deleteRootBook(node.id, deleteBook ? 'delete' : 'keep');
            }
        }
        // Record tombstones FIRST, then delete against the CURRENT state so the
        // tombstones survive (a stale replace would erase them and the next
        // auto-merge would resurrect the deleted entities).
        applyTreeChange(services, (current) => bulkDeleteNodes(current, ids), {
            deletions,
            books: affectedBooks,
        });
        setSelectedIds((prev) => {
            const next = new Set(prev);
            ids.forEach((id) => next.delete(id));
            return next;
        });
        if (isMobile && mobileSheet !== 'none') {
            setMobileSheet('none');
        }
    };

    const handleDuplicate = (id: string): void => {
        const node = index.get(id);
        const parent = node && node.parentId !== null ? index.get(node.parentId) : null;
        if (!node || node.parentId === null || parent?.kind !== 'folder' || node.kind === 'folder') {
            return;
        }
        const baseName = `${node.name} (copy)`;
        const parentId: string = node.parentId; // narrowed above; closure-safe copy
        let createdId: string | null = null;
        applyOperation((current) => {
            const fresh = createChild(current, parentId, node.kind, baseName, () => ctx.uuidv4());
            if (!fresh) {
                return null;
            }
            const localCreated = diffCreatedId(current, fresh);
            if (node.kind !== 'entry' || localCreated === null) {
                createdId = localCreated;
                return fresh;
            }
            const patched = patchState(fresh, localCreated, (draftNode) => {
                if (draftNode.kind === 'entry') {
                    // Justified: duplicating an entry copies its full native
                    // payload verbatim (new uid placeholder).
                    draftNode.native = structuredClone(node.native);
                    draftNode.native.comment = baseName;
                    draftNode.native.uid = 900000 + Math.floor(Math.random() * 90000);
                }
            });
            createdId = diffCreatedId(current, patched);
            return patched;
        });
        if (createdId) {
            setSelectedIds(new Set([createdId]));
        }
    };

    const handleRename = async (id: string): Promise<void> => {
        const node = index.get(id);
        if (!node) {
            return;
        }
        const nextName = await inputDialog('New name', node.name);
        if (nextName === null) {
            return;
        }
        applyOperation((current) => renameNode(current, id, nextName));
    };

    const handleMenuAction = (action: TreeMenuAction, id: string): void => {
        switch (action) {
            case 'rename':
                void handleRename(id);
                break;
            case 'move-to':
                setMovePickerFor({ ids: [id] });
                break;
            case 'move-up': {
                const node = index.get(id);
                if (node?.parentId) {
                    const parent = index.get(node.parentId);
                    if (parent?.kind === 'folder') {
                        const at = parent.children.findIndex((child) => child.id === id);
                        if (at > 0) {
                            handleReorder(parent.id, at, at - 1);
                        }
                    }
                }
                break;
            }
            case 'move-down': {
                const node = index.get(id);
                if (node?.parentId) {
                    const parent = index.get(node.parentId);
                    if (parent?.kind === 'folder') {
                        const at = parent.children.findIndex((child) => child.id === id);
                        if (at >= 0 && at < parent.children.length - 1) {
                            handleReorder(parent.id, at, at + 1);
                        }
                    }
                }
                break;
            }
            case 'duplicate':
                handleDuplicate(id);
                break;
            case 'delete':
                void handleDelete([id]);
                break;
            case 'export-md':
                void services.md.exportFolder(id);
                break;
        }
    };

    const handleBulk = (action: 'move' | 'enable' | 'disable' | 'delete'): void => {
        const ids = [...selectedIds];
        if (ids.length === 0) {
            return;
        }
        switch (action) {
            case 'move':
                setMovePickerFor({ ids });
                break;
            case 'enable':
                applyOperation((current) => bulkSetDisable(current, ids, false));
                break;
            case 'disable':
                applyOperation((current) => bulkSetDisable(current, ids, true));
                break;
            case 'delete':
                void handleDelete(ids);
                break;
        }
    };

    const handlePickMoveTarget = (parentId: string): void => {
        const ids = movePickerFor?.ids ?? [];
        setMovePickerFor(null);
        if (ids.length > 0) {
            applyTreeChange(services, (current) => bulkMoveNodes(current, ids, parentId), { structure: true });
        }
    };

    const handleImportFile = async (file: File): Promise<void> => {
        await sync.importBookFile(file, resolveSelectionParent());
    };

    const handleLoadDemo = async (): Promise<void> => {
        if (state.root.children.length > 0) {
            const confirmed = await confirmDialog(
                'Load the demo lore into the workspace? Existing items are kept and the demo is added alongside them.'
            );
            if (!confirmed) {
                return;
            }
        }
        const demo = createDemoState(() => ctx.uuidv4());
        store.update((draft) => {
            draft.root.children.push(...demo.root.children);
        });
    };

    const toggleWiRoot = async (folderId: string): Promise<void> => {
        const folder = index.get(folderId);
        if (folder?.kind !== 'folder') {
            return;
        }
        if (!folder.isWiRoot) {
            const match = sync.matchBookForAdopt(folder.name);
            if (match) {
                const adopt = await confirmDialog(
                    `A native book named "${match}" already exists. OK = adopt it into this folder (its entries are imported); Cancel = create a fresh book ("${match} (1)").`
                );
                if (adopt) {
                    await sync.designateRoot(folder.id, 'adopt', match);
                    // Adoption intent: merge the adopted book's content in.
                    const plan = await sync.planBoundImportFor(match);
                    if (plan && (plan.additions.length > 0 || plan.conflicts.length > 0)) {
                        await sync.applyBoundImport(match, plan, new Map());
                    }
                } else {
                    await sync.designateRoot(folder.id, 'create');
                }
                return;
            }
            await sync.designateRoot(folder.id, 'create');
            return;
        }
        sync.undesignateRoot(folder.id);
    };

    const resolveOrphan = async (bookName: string, uid: number, mode: 'remove' | 'keep'): Promise<void> => {
        if (mode === 'remove') {
            const confirmed = await confirmDialog(
                'Remove this entry from the native book at the next sync?'
            );
            if (!confirmed) {
                return;
            }
        }
        await sync.resolveOrphan(bookName, uid, mode);
    };

    const commitEntryField = (entryId: string, name: keyof NativeWorldInfoEntry, value: unknown): void => {
        applyOperation((current) => commitEntryFieldOp(current, entryId, name as string, value));
    };

    const commitImage = (imageId: string, patch: { src?: string; caption?: string }): void => {
        applyOperation((current) => commitImageOp(current, imageId, patch));
    };

    const resolveImage = (ref: string): string | undefined =>
        resolveImageReference(state.root, index, selected?.id ?? null, ref);

    const substitute = (text: string): string => {
        try {
            return ctx.substituteParams(text);
        } catch {
            return text;
        }
    };

    const membershipLine = computeMembershipLine(selected, index);

    const onSplitterDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
        if (treeCollapsed) {
            return;
        }
        setDragging({ startX: event.clientX, startWidth: treeWidth });
        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const onSplitterMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
        if (!dragging) {
            return;
        }
        const width = dragging.startWidth + (event.clientX - dragging.startX);
        if (width < TREE_COLLAPSE_BELOW) {
            setTreeCollapsed(true);
            setDragging(null);
            return;
        }
        setTreeWidth(Math.min(Math.max(width, TREE_MIN), TREE_MAX));
    };

    const isEmpty = state.root.children.length === 0;
    const treeProps = {
        root: state.root,
        sortMode: state.settings.sortMode,
        onSort: handleSort,
        selectedIds,
        onSelect: handleSelect,
        onExpand: handleExpand,
        onCreate: handleCreate,
        onMoveNode: handleMoveNode,
        onReorder: handleReorder,
        menu,
        onOpenMenu: setMenu,
        onCloseMenu: () => setMenu(null),
        onMenuAction: handleMenuAction,
        onImportFile: (file: File) => void handleImportFile(file),
    };
    const editorProps = {
        node: selected,
        violations,
        membershipLine,
        resolveImage,
        substitute,
        onCommitEntryField: commitEntryField,
        onCommitImage: commitImage,
        onCommitName: (nodeId: string, name: string) => {
            const node = index.get(nodeId);
            if (node?.kind === 'entry') {
                commitEntryField(nodeId, 'comment', name);
                return;
            }
            applyOperation((current) => renameNode(current, nodeId, name));
        },
        onRenameRequest: (id: string) => void handleRename(id),
        onDuplicate: (id: string) => handleDuplicate(id),
        onDelete: (id: string) => void handleDelete([id]),
        onToggleWiRoot: (id: string) => void toggleWiRoot(id),
        uploadImage: async (file: File): Promise<string | null> => {
            const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase() : '';
            if (!services.md.imageStore.accepts(ext)) {
                return null;
            }
            try {
                return await services.md.imageStore.upload({
                    bytes: new Uint8Array(await file.arrayBuffer()),
                    ext,
                    stem: file.name.replace(/\.[^.]+$/, ''),
                });
            } catch (error) {
                notifyError(`The image could not be stored: ${error instanceof Error ? error.message : String(error)}`);
                throw error;
            }
        },
        folderExtras: (folder: FolderNode) => (
            <RootBookSettings
                folder={folder}
                onRenameBook={(nextName) => void sync.renameRootBook(folder.id, nextName)}
                onResolveOrphan={(uid, mode) => void resolveOrphan(folder.book!.bookName, uid, mode)}
            />
        ),
    };

    return (
        <div className="wiw-surface">
            <header className="wiw-header">
                <button
                    type="button"
                    className="wiw-button wiw-mode-button"
                    title="Switch to the native Worlds/Lorebooks editor"
                    onClick={() => openNativeMode()}
                >
                    <i className="fa-solid fa-book-atlas" /> Worlds/Lorebooks
                </button>
                <div className="wiw-header-spacer" />
                <MarkdownControl
                    md={services.md}
                    exportScopeId={selected?.kind === 'folder' ? selected.id : state.root.id}
                    exportScopeLabel={selected?.kind === 'folder' ? `"${selected.name}"` : 'workspace'}
                    importTargetId={importTarget().id}
                    importTargetLabel={importTarget().id === state.root.id ? 'workspace root' : `"${importTarget().name}"`}
                />
                <button
                    type="button"
                    className="wiw-button wiw-icon-button"
                    title="Lorebooks: activation, import and deletion of native books"
                    onClick={() => setLorebooksOpen(true)}
                >
                    <i className="fa-solid fa-book-bookmark" />
                </button>
                <button
                    type="button"
                    className="wiw-button wiw-icon-button"
                    title={isMobile || !assistantOpen ? 'Show assistant' : 'Hide assistant'}
                    onClick={() => {
                        if (isMobile) {
                            setMobileSheet('assistant');
                        } else {
                            setAssistantOpen((prev) => !prev);
                        }
                    }}
                >
                    <i className="fa-solid fa-wand-magic-sparkles" />
                </button>
            </header>
            <div className="wiw-regions">
                {!isMobile && (
                    <>
                        <aside
                            className={`wiw-region wiw-region-tree${treeCollapsed ? ' wiw-tree-collapsed' : ''}`}
                            style={{ flexBasis: treeCollapsed ? 44 : treeWidth }}
                        >
                            {treeCollapsed ? (
                                <button
                                    type="button"
                                    className="wiw-tree-expand"
                                    title="Show tree"
                                    onClick={() => setTreeCollapsed(false)}
                                >
                                    <i className="fa-solid fa-angles-right" />
                                </button>
                            ) : (
                                <>
                                    <StructureTree {...treeProps} />
                                    {selectedIds.size > 1 && (
                                        <div className="wiw-bulk-bar">
                                            <span>{selectedIds.size} selected</span>
                                            <button type="button" className="wiw-button" title="Move selected" onClick={() => handleBulk('move')}>
                                                <i className="fa-solid fa-folder-open" />
                                            </button>
                                            <button type="button" className="wiw-button" title="Enable selected entries" onClick={() => handleBulk('enable')}>
                                                <i className="fa-solid fa-toggle-on" />
                                            </button>
                                            <button type="button" className="wiw-button" title="Disable selected entries" onClick={() => handleBulk('disable')}>
                                                <i className="fa-solid fa-toggle-off" />
                                            </button>
                                            <button type="button" className="wiw-button wiw-danger-button" title="Delete selected" onClick={() => handleBulk('delete')}>
                                                <i className="fa-solid fa-trash-can" />
                                            </button>
                                            <button
                                                type="button"
                                                className="wiw-button wiw-icon-button"
                                                title="Clear selection"
                                                onClick={() => setSelectedIds(new Set())}
                                            >
                                                <i className="fa-solid fa-xmark" />
                                            </button>
                                        </div>
                                    )}
                                </>
                            )}
                        </aside>
                        {!treeCollapsed && (
                            <div
                                className="wiw-splitter"
                                title="Drag to resize; double-click to collapse"
                                onPointerDown={onSplitterDown}
                                onPointerMove={onSplitterMove}
                                onPointerUp={() => setDragging(null)}
                                onDoubleClick={() => setTreeCollapsed(true)}
                            />
                        )}
                    </>
                )}
                {!isMobile && (
                    <main className="wiw-region wiw-region-editor">
                        {isEmpty ? (
                            <EmptyState onLoadDemo={() => void handleLoadDemo()} />
                        ) : (
                            <ItemEditor {...editorProps} />
                        )}
                    </main>
                )}
                {!isMobile && assistantOpen && (
                    <aside className="wiw-region wiw-region-assistant">
                        <AssistantPanel />
                    </aside>
                )}
                {isMobile && (
                    <main className="wiw-mobile-tree">
                        {isEmpty ? (
                            <EmptyState onLoadDemo={() => void handleLoadDemo()} />
                        ) : (
                            <StructureTree {...treeProps} />
                        )}
                    </main>
                )}
            </div>
            {isMobile && mobileSheet === 'editor' && (
                <Sheet key="editor-sheet" onClose={() => setMobileSheet('none')}>
                    {isEmpty ? (
                        <EmptyState onLoadDemo={() => void handleLoadDemo()} />
                    ) : (
                        <ItemEditor {...editorProps} />
                    )}
                </Sheet>
            )}
            {isMobile && mobileSheet === 'assistant' && (
                <Sheet key="assistant-sheet" onClose={() => setMobileSheet('none')}>
                    <AssistantPanel />
                </Sheet>
            )}
            {movePickerFor && (
                <FolderPicker
                    root={state.root}
                    excludeIds={new Set(movePickerFor.ids)}
                    onPick={handlePickMoveTarget}
                    onClose={() => setMovePickerFor(null)}
                />
            )}
            {lorebooksOpen && (
                <LorebooksPanel
                    services={services}
                    importTarget={importTarget()}
                    onDeleteBoundBook={handleDeleteBoundBook}
                    onClose={() => setLorebooksOpen(false)}
                />
            )}
            {state._recovered !== undefined && (
                <RecoveryBanner onRestore={handleRestoreBackup} onDiscard={() => void handleDiscardBackup()} />
            )}
            <SaveFailureBanner
                failure={lastFailure}
                retrying={retrying}
                onRetry={() => void handleRetry()}
                onDismiss={() => setLastFailure(null)}
            />
            <DivergenceBanners
                tick={reportsTick}
                reports={[...sync.getReports().values()]}
                onPushAnyway={(book) => void sync.overridePush(book)}
                onImport={() => setLorebooksOpen(true)}
                onDismiss={(book) => sync.dismissReport(book)}
            />
        </div>
    );
}

let bookRenameTimer: number | null = null;

function EmptyState({ onLoadDemo }: { onLoadDemo(): void }): JSX.Element {
    return (
        <div className="wiw-editor-empty wiw-empty-state">
            <h2>Your workspace is empty</h2>
            <p>
                Create folders, entries, and images with the tree toolbar, or load the
                demo lore to see how the workspace is meant to be used.
            </p>
            <button type="button" className="wiw-button" onClick={onLoadDemo}>
                <i className="fa-solid fa-book-atlas" /> Load demo data
            </button>
        </div>
    );
}

function FolderPicker({
    root,
    excludeIds,
    onPick,
    onClose,
}: {
    root: FolderNode;
    excludeIds: ReadonlySet<string>;
    onPick(parentId: string): void;
    onClose(): void;
}): JSX.Element {
    const options: Array<{ id: string; name: string; depth: number }> = [];
    const walk = (node: FolderNode, depth: number): void => {
        node.children.forEach((child) => {
            if (child.kind === 'folder' && !excludeIds.has(child.id)) {
                options.push({ id: child.id, name: child.name, depth });
                walk(child, depth + 1);
            }
        });
    };
    walk(root, 0);
    return (
        <div className="wiw-overlay" onClick={onClose}>
            <div className="wiw-panel" onClick={(event) => event.stopPropagation()}>
                <h3>Move to folder</h3>
                <div className="wiw-folder-picker">
                    <button type="button" className="wiw-folder-option" onClick={() => onPick(root.id)}>
                        <i className="fa-solid fa-house" /> Workspace root
                    </button>
                    {options.map((option) => (
                        <button
                            key={option.id}
                            type="button"
                            className="wiw-folder-option"
                            style={{ paddingLeft: `${option.depth * 14 + 8}px` }}
                            onClick={() => onPick(option.id)}
                        >
                            <i className="fa-solid fa-folder" /> {option.name}
                        </button>
                    ))}
                </div>
                <div className="wiw-editor-actions">
                    <button type="button" className="wiw-button" onClick={onClose}>
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
}

function patchState(
    next: WorkspaceState,
    nodeId: string,
    patch: (node: TreeNode) => void
): WorkspaceState {
    const draft = structuredClone(next);
    const node = findNode(draft, nodeId);
    if (node) {
        patch(node);
    }
    return draft;
}

function diffCreatedId(before: WorkspaceState, after: WorkspaceState): string | null {
    const beforeIds = buildNodeIndex(before.root);
    const afterIds = buildNodeIndex(after.root);
    for (const id of afterIds.keys()) {
        if (!beforeIds.has(id)) {
            return id;
        }
    }
    return null;
}

function computeMembershipLine(node: TreeNode | null, index: Map<string, TreeNode>): string {
    if (!node || (node.kind !== 'entry' && node.kind !== 'image')) {
        return '';
    }
    const books: string[] = [];
    let cursor: TreeNode | undefined = node.parentId !== null ? index.get(node.parentId) : undefined;
    while (cursor) {
        if (cursor.kind === 'folder' && cursor.isWiRoot) {
            books.unshift(cursor.book?.bookName ?? cursor.name);
        }
        cursor = cursor.parentId !== null ? index.get(cursor.parentId) : undefined;
    }
    return books.length > 0
        ? `Appears in WI books: ${books.join(', ')}`
        : 'Not part of any WI book (workspace-only item)';
}

function RecoveryBanner({ onRestore, onDiscard }: { onRestore(): void; onDiscard(): void }): JSX.Element {
    return (
        <div className="wiw-banner wiw-banner-warn wiw-save-banner">
            <i className="fa-solid fa-life-ring" />
            <span>A backup of workspace data that could not be loaded is kept.</span>
            <button type="button" className="wiw-button" onClick={onRestore}>
                Restore
            </button>
            <button type="button" className="wiw-button" onClick={onDiscard}>
                Discard backup
            </button>
        </div>
    );
}

function SaveFailureBanner({
    failure,
    retrying,
    onRetry,
    onDismiss,
}: {
    failure: { message: string; bookName?: string } | null;
    retrying: boolean;
    onRetry(): void;
    onDismiss(): void;
}): JSX.Element | null {
    if (!failure) {
        return null;
    }
    return (
        <div className="wiw-banner wiw-banner-error wiw-save-banner">
            <i className="fa-solid fa-triangle-exclamation" />
            <span>{failure.message}</span>
            <button type="button" className="wiw-button" disabled={retrying} onClick={onRetry}>
                <i className={`fa-solid ${retrying ? 'fa-spinner fa-spin' : 'fa-rotate-right'}`} />
                {retrying ? 'Saving…' : 'Retry'}
            </button>
            <button type="button" className="wiw-button wiw-icon-button" title="Dismiss" onClick={onDismiss}>
                <i className="fa-solid fa-xmark" />
            </button>
        </div>
    );
}

function DivergenceBanners({
    tick,
    reports,
    onPushAnyway,
    onImport,
    onDismiss,
}: {
    tick: number;
    reports: Array<{ bookName: string; driftedUids: number[]; foreign: Array<{ uid: number; name: string }>; blocked: boolean; validationReasons?: string[] }>;
    onPushAnyway(book: string): void;
    onImport(): void;
    onDismiss(book: string): void;
}): JSX.Element | null {
    void tick;
    if (reports.length === 0) {
        return null;
    }
    return (
        <div className="wiw-divergence-list">
            {reports.map((report) => (
                <div key={report.bookName} className="wiw-divergence-banner">
                    <i className="fa-solid fa-code-branch" />
                    <span>
                        <strong>{report.bookName}</strong> changed outside the workspace —{' '}
                        {report.driftedUids.length} drifted entr
                        {report.driftedUids.length === 1 ? 'y' : 'ies'},{' '}
                        {report.foreign.length} outside entr
                        {report.foreign.length === 1 ? 'y' : 'ies'}
                        {report.blocked ? '. The next push is blocked.' : '.'}
                    </span>
                    {report.validationReasons && report.validationReasons.length > 0 ? (
                        <span className="wiw-membership-line" title={report.validationReasons.join('; ')}>
                            Fix invalid fields to unblock the push ({report.validationReasons.length}).
                        </span>
                    ) : (
                        report.blocked && (
                            <button
                                type="button"
                                className="wiw-button"
                                onClick={() => onPushAnyway(report.bookName)}
                            >
                                Push anyway
                            </button>
                        )
                    )}
                    <button type="button" className="wiw-button" onClick={onImport}>
                        Resolve via import
                    </button>
                    <button
                        type="button"
                        className="wiw-button wiw-icon-button"
                        title="Ignore this warning for now (nothing is changed)"
                        onClick={() => onDismiss(report.bookName)}
                    >
                        <i className="fa-solid fa-xmark" />
                    </button>
                </div>
            ))}
        </div>
    );
}

function RootBookSettings({
    folder,
    onRenameBook,
    onResolveOrphan,
}: {
    folder: FolderNode;
    onRenameBook(nextName: string): void;
    onResolveOrphan(uid: number, mode: 'remove' | 'keep'): void;
}): JSX.Element | null {
    const [draft, setDraft] = useState(folder.book?.bookName ?? '');
    useEffect(() => {
        setDraft(folder.book?.bookName ?? '');
    }, [folder.book?.bookName]);
    if (!folder.isWiRoot || !folder.book) {
        return null;
    }
    return (
        <div className="wiw-root-settings">
            <div className="wiw-field-grid">
                <div className="wiw-field wiw-field-wide" style={{ gridColumn: 'span 12' }}>
                    <span className="wiw-field-label" title="Renamed with a short delay; the binding follows the book, not the folder name (FR-023)">
                        Native book
                    </span>
                    <input
                        type="text"
                        value={draft}
                        onChange={(event) => {
                            const next = event.target.value;
                            setDraft(next);
                            if (bookRenameTimer !== null) {
                                window.clearTimeout(bookRenameTimer);
                            }
                            if (next.trim() !== '' && next !== folder.book?.bookName) {
                                bookRenameTimer = window.setTimeout(() => onRenameBook(next), 700);
                            }
                        }}
                    />
                </div>
            </div>
            {folder.book.orphans.length > 0 && (
                <div className="wiw-orphan-list">
                    <p className="wiw-membership-line">
                        Entries that left this root but still exist in the native book
                        (FR-018). Decide for each:
                    </p>
                    {folder.book.orphans.map((orphan) => (
                        <div key={orphan.uid} className="wiw-orphan-row">
                            <span>{orphan.name}</span>
                            <button
                                type="button"
                                className="wiw-button wiw-danger-button"
                                onClick={() => onResolveOrphan(orphan.uid, 'remove')}
                            >
                                Remove from book
                            </button>
                            <button
                                type="button"
                                className="wiw-button"
                                onClick={() => onResolveOrphan(orphan.uid, 'keep')}
                            >
                                Keep
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
