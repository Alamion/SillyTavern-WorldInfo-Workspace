import {
    createEntryNode,
    createFolderNode,
    createImageNode,
    findNode,
    type EntryNode,
    type TreeNode,
    type WorkspaceState,
} from '../state/schema';
import {
    copyNode,
    withNodeCopied,
    withNodeDetached,
    withNodesCopied,
} from '../state/sharing';

/**
 * Pure tree mutations (US1, FR-002..FR-006, FR-011). Every function takes a state
 * and returns a NEW state (immutable update, never in-place) or `null` when the
 * operation is rejected. UI layers then mark the sync engine dirty.
 *
 * These used to `structuredClone` the ENTIRE workspace per call (spec 006 R1) —
 * 48.5 ms for one field commit on the 1000-entry dataset, paid per keystroke.
 * They now path-copy: only the root→target spine is copied, every other subtree
 * keeps its object identity. Callers must therefore never mutate a node they did
 * not obtain from a copy helper, or they would write into the previous state.
 */

export type CreateKind = 'folder' | 'entry' | 'image';

let nativeUidSeed = 0;
function nextPlaceholderUid(): number {
    nativeUidSeed += 1;
    // 900000+ placeholders never collide with real book uids (pool 0..999999 is
    // re-resolved at export time; see core/sync/flatten.ts).
    return 900000 + nativeUidSeed;
}

export function resetPlaceholderUidSeed(seed: number): void {
    nativeUidSeed = seed;
}

/** Detaches `nodeId`, returning a writable copy of it ready to be re-attached. */
function detach(
    state: WorkspaceState,
    nodeId: string
): { state: WorkspaceState; node: TreeNode } | null {
    const removed = withNodeDetached(state, nodeId);
    if (!removed) {
        return null;
    }
    // The detached node still belongs to the previous state; copy before writing.
    return { state: removed.state, node: copyNode(removed.detached) };
}

export function createChild(
    state: WorkspaceState,
    parentId: string,
    kind: CreateKind,
    name: string,
    newId: () => string,
    nativeUid?: number
): WorkspaceState | null {
    const trimmed = name.trim();
    if (trimmed === '') {
        return null;
    }
    const copied = withNodeCopied(state, parentId);
    if (!copied || copied.node.kind !== 'folder') {
        return null;
    }
    const target = copied.node;
    const now = new Date().toISOString();
    const id = newId();
    const node =
        kind === 'folder'
            ? createFolderNode({ id, parentId, name: trimmed, now })
            : kind === 'entry'
              ? createEntryNode({
                    id,
                    parentId,
                    name: trimmed,
                    now,
                    nativeUid: nativeUid ?? nextPlaceholderUid(),
                })
              : createImageNode({ id, parentId, name: trimmed, now });
    target.children.push(node);
    target.expanded = true;
    return copied.state;
}

export function renameNode(
    state: WorkspaceState,
    nodeId: string,
    name: string
): WorkspaceState | null {
    const trimmed = name.trim();
    if (trimmed === '') {
        return null;
    }
    if (nodeId === state.root.id) {
        return null;
    }
    const copied = withNodeCopied(state, nodeId);
    if (!copied) {
        return null;
    }
    const node = copied.node;
    node.name = trimmed;
    node.updatedAt = new Date().toISOString();
    if (node.kind === 'entry') {
        node.native.comment = trimmed;
    }
    return copied.state;
}

export function moveNode(
    state: WorkspaceState,
    nodeId: string,
    newParentId: string,
    indexInParent?: number
): WorkspaceState | null {
    if (nodeId === state.root.id || nodeId === newParentId) {
        return null;
    }
    const node = findNode(state, nodeId);
    const parent = findNode(state, newParentId);
    if (!node || parent?.kind !== 'folder') {
        return null;
    }
    if (node.kind === 'folder') {
        const descendants = new Set<string>();
        const collect = (folder: TreeNode): void => {
            if (folder.kind !== 'folder') {
                return;
            }
            folder.children.forEach((child) => {
                descendants.add(child.id);
                collect(child);
            });
        };
        collect(node);
        if (descendants.has(newParentId)) {
            return null;
        }
    }
    const removed = detach(state, nodeId);
    if (!removed) {
        return null;
    }
    const copied = withNodeCopied(removed.state, newParentId);
    if (!copied || copied.node.kind !== 'folder') {
        return null;
    }
    const targetParent = copied.node;
    const moved = removed.node;
    moved.parentId = newParentId;
    moved.updatedAt = new Date().toISOString();
    const at = Math.min(
        Math.max(indexInParent ?? targetParent.children.length, 0),
        targetParent.children.length
    );
    targetParent.children.splice(at, 0, moved);
    return copied.state;
}

export function reorderChild(
    state: WorkspaceState,
    parentId: string,
    fromIndex: number,
    toIndex: number
): WorkspaceState {
    const copied = withNodeCopied(state, parentId);
    if (!copied || copied.node.kind !== 'folder' || copied.node.children.length === 0) {
        return state;
    }
    const children = copied.node.children;
    const from = Math.min(Math.max(fromIndex, 0), children.length - 1);
    const to = Math.min(Math.max(toIndex, 0), children.length - 1);
    const moved = children.splice(from, 1)[0];
    if (moved) {
        children.splice(to, 0, moved);
    }
    return copied.state;
}

export function deleteSubtree(state: WorkspaceState, nodeId: string): WorkspaceState {
    if (nodeId === state.root.id) {
        return state;
    }
    const removed = withNodeDetached(state, nodeId);
    return removed ? removed.state : state;
}

export function bulkDeleteNodes(state: WorkspaceState, nodeIds: readonly string[]): WorkspaceState {
    let next = state;
    for (const id of nodeIds) {
        if (id === next.root.id) {
            continue;
        }
        const removed = withNodeDetached(next, id);
        if (removed) {
            next = removed.state;
        }
    }
    return next;
}

/**
 * Moves a selection as one block into `targetParentId`, keeping tree order.
 * Nodes nested inside another moved folder travel with it (never pulled out).
 * The block starts at `indexInParent` of the resulting child list (same rule as
 * `moveNode`), or is appended. Rejected (null) when nothing can move or the
 * target lies inside a moved folder.
 */
export function bulkMoveNodes(
    state: WorkspaceState,
    nodeIds: readonly string[],
    targetParentId: string,
    indexInParent?: number
): WorkspaceState | null {
    const requested = new Set(nodeIds);
    requested.delete(state.root.id);
    if (findNode(state, targetParentId)?.kind !== 'folder') {
        return null;
    }
    // Tree-order walk: a node is a block member unless an ancestor already is.
    const blockIds: string[] = [];
    let targetInsideBlock = false;
    const walk = (node: TreeNode, insideBlock: boolean): void => {
        const member = !insideBlock && requested.has(node.id);
        if (member) {
            blockIds.push(node.id);
        }
        if ((insideBlock || member) && node.id === targetParentId) {
            targetInsideBlock = true;
        }
        if (node.kind === 'folder') {
            node.children.forEach((child) => walk(child, insideBlock || member));
        }
    };
    state.root.children.forEach((child) => walk(child, false));
    if (blockIds.length === 0 || targetInsideBlock) {
        return null;
    }

    const now = new Date().toISOString();
    let working = state;
    const block: TreeNode[] = [];
    for (const id of blockIds) {
        const removed = detach(working, id);
        if (!removed) {
            continue;
        }
        working = removed.state;
        block.push(removed.node);
    }
    const copied = withNodeCopied(working, targetParentId);
    if (!copied || copied.node.kind !== 'folder') {
        return null;
    }
    const target = copied.node;
    for (const node of block) {
        node.parentId = targetParentId;
        node.updatedAt = now;
    }
    const at = Math.min(
        Math.max(indexInParent ?? target.children.length, 0),
        target.children.length
    );
    target.children.splice(at, 0, ...block);
    return copied.state;
}

export function bulkSetDisable(
    state: WorkspaceState,
    nodeIds: readonly string[],
    disabled: boolean
): WorkspaceState {
    const now = new Date().toISOString();
    // Only ids that actually change are path-copied: an unchanged entry must keep
    // its identity so downstream memoization stays valid.
    const changing = nodeIds.filter((id) => {
        const node = findNode(state, id);
        return node?.kind === 'entry' && node.native.disable !== disabled;
    });
    return withNodesCopied(state, changing, (node) => {
        if (node.kind !== 'entry') {
            return;
        }
        node.native.disable = disabled;
        node.updatedAt = now;
        markEntryBooksDirty(node);
    });
}

/** Every book copy of the entry must be re-pushed (the engine pushes dirty books). */
function markEntryBooksDirty(node: EntryNode): void {
    for (const bookSync of Object.values(node.sync.books)) {
        if (bookSync.status === 'in-sync') {
            bookSync.status = 'dirty';
        }
    }
}

/** Field commit (US2): updates the native field, marks dirty under a root. */
export function commitEntryField(
    state: WorkspaceState,
    entryId: string,
    name: string,
    value: unknown
): WorkspaceState {
    const copied = withNodeCopied(state, entryId);
    if (!copied || copied.node.kind !== 'entry') {
        return state;
    }
    const node = copied.node;
    (node.native as unknown as Record<string, unknown>)[name] = value;
    node.updatedAt = new Date().toISOString();
    if (name === 'comment') {
        node.name = String(value ?? '');
    }
    markEntryBooksDirty(node);
    return copied.state;
}

export function commitImage(
    state: WorkspaceState,
    imageId: string,
    patch: { src?: string; caption?: string }
): WorkspaceState {
    const copied = withNodeCopied(state, imageId);
    if (!copied || copied.node.kind !== 'image') {
        return state;
    }
    const node = copied.node;
    if (patch.src !== undefined) {
        node.src = patch.src;
    }
    if (patch.caption !== undefined) {
        node.caption = patch.caption;
    }
    node.updatedAt = new Date().toISOString();
    return copied.state;
}

/**
 * Re-inserts a previously removed subtree at its old position (assistant batch
 * undo, spec 005 FR-015). Ids are preserved so per-book sync state and markdown
 * tracking keep pointing at the same entities. Rejected when the parent is gone
 * or any id is already present.
 */
export function insertSubtree(
    state: WorkspaceState,
    parentId: string,
    index: number,
    subtree: TreeNode
): WorkspaceState | null {
    const parent = findNode(state, parentId);
    if (parent?.kind !== 'folder') {
        return null;
    }
    const existing = new Set<string>();
    const collect = (node: TreeNode): void => {
        existing.add(node.id);
        if (node.kind === 'folder') {
            node.children.forEach(collect);
        }
    };
    collect(state.root);
    const incoming: string[] = [];
    const walk = (node: TreeNode): void => {
        incoming.push(node.id);
        if (node.kind === 'folder') {
            node.children.forEach(walk);
        }
    };
    walk(subtree);
    if (incoming.some((id) => existing.has(id))) {
        return null;
    }
    const copied = withNodeCopied(state, parentId);
    if (!copied || copied.node.kind !== 'folder') {
        return null;
    }
    const target = copied.node;
    // The incoming subtree comes from outside this state (an undo record), so it
    // is cloned rather than shared.
    const node = structuredClone(subtree);
    node.parentId = parentId;
    const at = Math.min(Math.max(index, 0), target.children.length);
    target.children.splice(at, 0, node);
    return copied.state;
}

export function setExpanded(
    state: WorkspaceState,
    folderId: string,
    expanded: boolean
): WorkspaceState {
    const existing = findNode(state, folderId);
    if (existing?.kind !== 'folder' || existing.expanded === expanded) {
        return state;
    }
    const copied = withNodeCopied(state, folderId);
    if (!copied || copied.node.kind !== 'folder') {
        return state;
    }
    copied.node.expanded = expanded;
    return copied.state;
}