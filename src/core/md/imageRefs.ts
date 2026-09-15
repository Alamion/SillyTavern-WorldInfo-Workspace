import type { TreeNode, WorkspaceState } from '../state/schema';

/**
 * Owned image cleanup (spec 004 FR-024): which stored images are no longer
 * referenced after a state transition. Pure; the adapter deletes them.
 */

function collectImageSrcs(root: TreeNode, into: Set<string>): Set<string> {
    const stack: TreeNode[] = [root];
    while (stack.length > 0) {
        const node = stack.pop()!;
        if (node.kind === 'folder') {
            stack.push(...node.children);
        } else if (node.kind === 'image' && node.src !== '') {
            into.add(node.src);
        }
    }
    return into;
}

export function ownedSrcsReleasedBy(
    before: WorkspaceState,
    after: WorkspaceState,
    isOwned: (src: string) => boolean
): string[] {
    if (before.root === after.root) {
        return [];
    }
    const previous = collectImageSrcs(before.root, new Set());
    const current = collectImageSrcs(after.root, new Set());
    return [...previous].filter((src) => isOwned(src) && !current.has(src));
}
