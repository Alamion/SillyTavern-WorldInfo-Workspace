import { findNode, type FolderNode, type TreeNode, type WorkspaceState } from '../state/schema';
import type { ContextScope } from './types';

/**
 * Resolves the conversation's context scope into concrete nodes (spec 005
 * FR-021). Only the nodes inside the scope are shown to the assistant (plus the
 * folders above them, for orientation) and only they are valid operation
 * targets; folder ids that no longer exist are reported as dropped.
 */

export interface ResolvedScope {
    folderIds: string[];
    nodeIds: Set<string>;
    dropped: string[];
    /** Folders above the scope folders (outline orientation, valid placements). */
    ancestorIds: Set<string>;
}

function ancestorsOf(state: WorkspaceState, folderIds: readonly string[]): Set<string> {
    const ancestors = new Set<string>();
    for (const id of folderIds) {
        let current = findNode(state, id);
        while (current && current.parentId !== null) {
            const parent = findNode(state, current.parentId);
            if (!parent || parent.id === state.root.id) {
                break;
            }
            ancestors.add(parent.id);
            current = parent;
        }
    }
    return ancestors;
}

function collect(folder: FolderNode, into: Set<string>): void {
    into.add(folder.id);
    const walk = (node: TreeNode): void => {
        into.add(node.id);
        if (node.kind === 'folder') {
            node.children.forEach(walk);
        }
    };
    folder.children.forEach(walk);
}

/** The folder a selection stands for: the folder itself, or an item's parent. */
export function selectionFolder(state: WorkspaceState, selection: readonly string[]): FolderNode {
    for (const id of selection) {
        const node = findNode(state, id);
        if (!node) {
            continue;
        }
        if (node.kind === 'folder') {
            return node;
        }
        const parent = node.parentId !== null ? findNode(state, node.parentId) : undefined;
        if (parent?.kind === 'folder') {
            return parent;
        }
    }
    return state.root;
}

export function resolveScope(
    state: WorkspaceState,
    scope: ContextScope,
    selection: readonly string[]
): ResolvedScope {
    const nodeIds = new Set<string>();
    if (scope.kind === 'workspace') {
        collect(state.root, nodeIds);
        return { folderIds: [state.root.id], nodeIds, dropped: [], ancestorIds: new Set() };
    }
    if (scope.kind === 'selection') {
        const folder = selectionFolder(state, selection);
        collect(folder, nodeIds);
        return { folderIds: [folder.id], nodeIds, dropped: [], ancestorIds: ancestorsOf(state, [folder.id]) };
    }
    const folderIds: string[] = [];
    const dropped: string[] = [];
    for (const id of scope.folderIds) {
        const node = findNode(state, id);
        if (node?.kind === 'folder') {
            folderIds.push(id);
            collect(node, nodeIds);
        } else {
            dropped.push(id);
        }
    }
    return { folderIds, nodeIds, dropped, ancestorIds: ancestorsOf(state, folderIds) };
}
