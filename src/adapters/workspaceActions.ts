import { findNode, type TreeNode, type WorkspaceState } from '../core/state/schema';
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
