import { buildNodeIndex, findNode, type TreeNode, type WorkspaceState } from '../core/state/schema';
import { bulkDeleteNodes } from '../core/tree/operations';
import type { WorkspaceStore } from '../core/state/store';
import type { SyncEngine } from './syncEngine';

/**
 * Shared "apply a tree change and keep native sync consistent" plumbing
 * (spec 004 research R10). The UI and the markdown link manager both change the
 * tree; both must drive the Phase 1 sync engine the same way afterwards.
 */

export interface TreeChangeEffects {
    /** Structure changed (moves, creations under roots): membership re-derived. */
    structure?: boolean;
    /** Entities deleted while synced: removal intents recorded before the change. */
    deletions?: ReadonlyArray<{ bookName: string; uid: number }>;
    /** Books whose content changed without a membership change (reorders, deletes). */
    books?: readonly string[];
}

/** Deletion intents and affected books for removing `nodes` (folders recursively). */
export function collectEntityDeletions(nodes: readonly TreeNode[]): {
    deletions: Array<{ bookName: string; uid: number }>;
    books: string[];
} {
    const deletions: Array<{ bookName: string; uid: number }> = [];
    const books = new Set<string>();
    const walk = (node: TreeNode): void => {
        if (node.kind === 'entry') {
            for (const [bookName, bookSync] of Object.entries(node.sync.books)) {
                books.add(bookName);
                if (bookSync.uid !== null) {
                    deletions.push({ bookName, uid: bookSync.uid });
                }
            }
        } else if (node.kind === 'folder') {
            node.children.forEach(walk);
        }
    };
    nodes.forEach(walk);
    return { deletions, books: [...books] };
}

/**
 * Applies `next` (computed against the CURRENT store state) and notifies the sync
 * engine. Tombstones are recorded first so the auto-merge cannot resurrect
 * deleted entities (Phase 1 invariant).
 */
export function applyTreeChange(
    deps: { store: WorkspaceStore; sync: SyncEngine },
    compute: (current: WorkspaceState) => WorkspaceState | null,
    effects: TreeChangeEffects = {}
): boolean {
    if (effects.deletions && effects.deletions.length > 0) {
        deps.sync.recordEntityDeletions(effects.deletions);
    }
    const next = compute(deps.store.getState());
    if (!next) {
        return false;
    }
    deps.store.replace(next);
    if (effects.structure) {
        deps.sync.refreshStructure();
    }
    if (effects.books && effects.books.length > 0) {
        deps.sync.markBooksDirty([...effects.books]);
    }
    return true;
}

/**
 * Restores a World Info root designation recorded in markdown (spec 004 FR-009):
 * the Phase 1 adopt-or-create flow with the recorded book name as the proposal;
 * the book is never activated.
 */
export async function designateRestoredRoot(
    deps: { store: WorkspaceStore; sync: SyncEngine; confirm: (message: string) => Promise<boolean> },
    folderId: string,
    bookName: string | undefined
): Promise<void> {
    const folder = findNode(deps.store.getState(), folderId);
    if (folder?.kind !== 'folder' || folder.isWiRoot) {
        return;
    }
    const proposal = bookName ?? folder.name;
    const match = deps.sync.matchBookForAdopt(proposal);
    if (match) {
        const adopt = await deps.confirm(
            `The folder "${folder.name}" is a World Info root of the book "${match}", which already exists in the app. ` +
                'OK = bind the folder to that book (entries only in the book are merged in); Cancel = create a new book.'
        );
        if (adopt) {
            await deps.sync.designateRoot(folderId, 'adopt', match);
            const plan = await deps.sync.planBoundImportFor(match);
            if (plan && (plan.additions.length > 0 || plan.conflicts.length > 0)) {
                await deps.sync.applyBoundImport(match, plan, new Map());
            }
            return;
        }
    }
    await deps.sync.designateRoot(folderId, 'create', proposal);
}


export interface DeletionDescription {
    /** Every item that would be removed (folders include their subtree). */
    items: TreeNode[];
    /** Native books that hold copies of the deleted entries. */
    books: string[];
    /** Designated World Info roots among the targets (book keep-or-delete). */
    roots: Array<{ nodeId: string; bookName: string }>;
    /** True when files of the linked markdown folder would be removed. */
    linkedFiles: boolean;
    /** The confirmation text shown to the user. */
    message: string;
}

function entityBooks(node: TreeNode): string[] {
    return node.kind === 'entry' ? Object.keys(node.sync.books) : [];
}

/**
 * Full disclosure of what a deletion removes (spec 003 FR-021, spec 005 FR-010):
 * used by the tree UI and by the assistant's destructive confirmation.
 */
export function describeDeletion(
    state: WorkspaceState,
    ids: readonly string[],
    trackedIds: ReadonlySet<string> = new Set(),
    undoNote = 'This cannot be undone.'
): DeletionDescription {
    const targets = ids
        .map((id) => findNode(state, id))
        .filter((node): node is TreeNode => node !== undefined && node.id !== state.root.id);
    const items: TreeNode[] = [];
    for (const target of targets) {
        items.push(...buildNodeIndex(target).values());
    }
    const { deletions, books } = collectEntityDeletions(targets);
    void deletions;
    const roots = targets
        .filter((node) => node.kind === 'folder' && node.isWiRoot && node.book !== null)
        .map((node) => ({
            nodeId: node.id,
            bookName: node.kind === 'folder' && node.book ? node.book.bookName : '',
        }));
    const linkedFiles = items.some((item) => trackedIds.has(item.id));
    const single = targets.length === 1 ? targets[0] : undefined;
    let message: string;
    if (single) {
        message = `Delete "${single.name}"${single.kind === 'folder' ? ' and everything inside it' : ''}? ${undoNote}`;
        const entryBooks = entityBooks(single);
        if (entryBooks.length > 0) {
            message += ` Its copy in the native book "${entryBooks[0] ?? ''}" will be removed at the next sync.`;
        }
    } else {
        message = `Delete ${String(targets.length)} items? ${undoNote}`;
        if (targets.some((node) => entityBooks(node).length > 0)) {
            message += ' Native book copies of synced items will be removed at the next sync.';
        }
    }
    if (linkedFiles) {
        message += ' Its file(s) in the linked folder will be removed.';
    }
    return { items, books, roots, linkedFiles, message };
}

export interface DeleteNodesDeps {
    store: WorkspaceStore;
    sync: SyncEngine;
    confirm: (message: string) => Promise<boolean>;
    trackedIds?: () => ReadonlySet<string>;
}

/**
 * The single delete path of the workspace (extracted from WorkspaceApp so the
 * assistant applies deletions exactly like the tree UI): confirmation with full
 * disclosure, tombstones recorded BEFORE the tree change, the keep-or-delete
 * question for designated roots, then the delete against the CURRENT state.
 */
export async function deleteNodes(
    deps: DeleteNodesDeps,
    ids: readonly string[],
    options: { preconfirmed?: boolean; rootBooks?: 'ask' | 'delete'; undoNote?: string } = {}
): Promise<boolean> {
    const state = deps.store.getState();
    const description = describeDeletion(state, ids, deps.trackedIds?.() ?? new Set(), options.undoNote);
    if (description.items.length === 0) {
        return false;
    }
    if (options.preconfirmed !== true && !(await deps.confirm(description.message))) {
        return false;
    }
    const targets = ids
        .map((id) => findNode(deps.store.getState(), id))
        .filter((node): node is TreeNode => node !== undefined && node.id !== state.root.id);
    const { deletions, books } = collectEntityDeletions(targets);
    if (deletions.length > 0) {
        deps.sync.recordEntityDeletions(deletions);
    }
    for (const root of description.roots) {
        const deleteBook =
            options.rootBooks === 'delete' ||
            (await deps.confirm(
                `Also delete the native book "${root.bookName}"? Cancel = keep the book file in the app.`
            ));
        await deps.sync.deleteRootBook(root.nodeId, deleteBook ? 'delete' : 'keep');
    }
    applyTreeChange(deps, (current) => bulkDeleteNodes(current, ids), { deletions, books });
    return true;
}
