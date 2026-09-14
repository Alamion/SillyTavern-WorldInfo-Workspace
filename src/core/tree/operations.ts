import {
    createEntryNode,
    createFolderNode,
    createImageNode,
    findNode,
    type EntryNode,
    type TreeNode,
    type WorkspaceState,
} from '../state/schema';

/**
 * Pure tree mutations (US1, FR-002..FR-006, FR-011). Every function takes a state
 * and returns a NEW state (immutable update, never in-place) or `null` when the
 * operation is rejected. The store clones before running these; UI layers then
 * mark the sync engine dirty.
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

function clone(state: WorkspaceState): WorkspaceState {
    return structuredClone(state);
}

function detachFromParent(state: WorkspaceState, nodeId: string): TreeNode | null {
    let detached: TreeNode | null = null;
    const walk = (folder: WorkspaceState['root']): boolean => {
        const at = folder.children.findIndex((child) => child.id === nodeId);
        if (at >= 0) {
            detached = folder.children.splice(at, 1)[0] ?? null;
            return true;
        }
        return folder.children.some((child) => child.kind === 'folder' && walk(child));
    };
    if (!walk(state.root)) {
        return null;
    }
    return detached;
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
    const parent = findNode(state, parentId);
    if (parent?.kind !== 'folder') {
        return null;
    }
    const next = clone(state);
    const target = findNode(next, parentId);
    if (target?.kind !== 'folder') {
        return null;
    }
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
    return next;
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
    if (!findNode(state, nodeId) || nodeId === state.root.id) {
        return null;
    }
    const next = clone(state);
    const node = findNode(next, nodeId);
    if (!node) {
        return null;
    }
    node.name = trimmed;
    node.updatedAt = new Date().toISOString();
    if (node.kind === 'entry') {
        node.native.comment = trimmed;
    }
    return next;
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
    const next = clone(state);
    const detached = detachFromParent(next, nodeId);
    if (!detached) {
        return null;
    }
    const targetParent = findNode(next, newParentId);
    if (targetParent?.kind !== 'folder') {
        return null;
    }
    detached.parentId = newParentId;
    detached.updatedAt = new Date().toISOString();
    const at = Math.min(Math.max(indexInParent ?? targetParent.children.length, 0), targetParent.children.length);
    targetParent.children.splice(at, 0, detached);
    return next;
}

export function reorderChild(
    state: WorkspaceState,
    parentId: string,
    fromIndex: number,
    toIndex: number
): WorkspaceState {
    const next = clone(state);
    const parent = findNode(next, parentId);
    if (parent?.kind !== 'folder' || parent.children.length === 0) {
        return next;
    }
    const children = parent.children;
    const from = Math.min(Math.max(fromIndex, 0), children.length - 1);
    const to = Math.min(Math.max(toIndex, 0), children.length - 1);
    const moved = children.splice(from, 1)[0];
    if (moved) {
        children.splice(to, 0, moved);
    }
    return next;
}

export function deleteSubtree(state: WorkspaceState, nodeId: string): WorkspaceState {
    if (nodeId === state.root.id) {
        return state;
    }
    const next = clone(state);
    detachFromParent(next, nodeId);
    return next;
}

export function bulkDeleteNodes(state: WorkspaceState, nodeIds: readonly string[]): WorkspaceState {
    let next = state;
    for (const id of nodeIds) {
        if (id !== next.root.id && findNode(next, id)) {
            next = deleteSubtree(next, id);
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

    const next = clone(state);
    const now = new Date().toISOString();
    const block = blockIds
        .map((id) => detachFromParent(next, id))
        .filter((node): node is TreeNode => node !== null);
    const target = findNode(next, targetParentId);
    if (target?.kind !== 'folder') {
        return null;
    }
    for (const node of block) {
        node.parentId = targetParentId;
        node.updatedAt = now;
    }
    const at = Math.min(Math.max(indexInParent ?? target.children.length, 0), target.children.length);
    target.children.splice(at, 0, ...block);
    return next;
}

export function bulkSetDisable(
    state: WorkspaceState,
    nodeIds: readonly string[],
    disabled: boolean
): WorkspaceState {
    const next = clone(state);
    const now = new Date().toISOString();
    for (const id of nodeIds) {
        const node = findNode(next, id);
        if (node?.kind === 'entry' && node.native.disable !== disabled) {
            node.native.disable = disabled;
            node.updatedAt = now;
            markEntryBooksDirty(node);
        }
    }
    return next;
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
    const next = clone(state);
    const node = findNode(next, entryId);
    if (node?.kind !== 'entry') {
        return next;
    }
    (node.native as unknown as Record<string, unknown>)[name] = value;
    node.updatedAt = new Date().toISOString();
    if (name === 'comment') {
        node.name = String(value ?? '');
    }
    markEntryBooksDirty(node);
    return next;
}

export function commitImage(
    state: WorkspaceState,
    imageId: string,
    patch: { src?: string; caption?: string }
): WorkspaceState {
    const next = clone(state);
    const node = findNode(next, imageId);
    if (node?.kind !== 'image') {
        return next;
    }
    if (patch.src !== undefined) {
        node.src = patch.src;
    }
    if (patch.caption !== undefined) {
        node.caption = patch.caption;
    }
    node.updatedAt = new Date().toISOString();
    return next;
}

export function setExpanded(
    state: WorkspaceState,
    folderId: string,
    expanded: boolean
): WorkspaceState {
    const next = clone(state);
    const folder = findNode(next, folderId);
    if (folder?.kind === 'folder') {
        folder.expanded = expanded;
    }
    return next;
}