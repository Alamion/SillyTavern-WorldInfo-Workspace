import type { TreeNode, WorkspaceState } from '../state/schema';

/**
 * Owned image cleanup (spec 004 FR-024): which stored images are no longer
 * referenced after a state transition. Pure; the adapter deletes them.
 */

function collectImageSrcs(root: TreeNode, into: Set<string>): Set<string> {
    const stack: TreeNode[] = [root];
    while (stack.length > 0) {
        const node = stack.pop();
        if (!node) {
            continue;
        }
        if (node.kind === 'folder') {
            for (const child of node.children) {
                stack.push(child);
            }
        } else if (node.kind === 'image' && node.src !== '') {
            into.add(node.src);
        }
    }
    return into;
}

/**
 * Images that MIGHT have been released: walks only the parts of `before` that
 * are not reference-identical to their counterpart in `after`.
 *
 * Structural sharing (spec 006 R1) leaves untouched subtrees ===, so a text edit
 * visits just the copied spine and yields no candidates at all. Anything it does
 * yield is still confirmed against the whole of `after` below, because an image
 * may simply have MOVED.
 */
function collectReleaseCandidates(
    before: TreeNode,
    after: TreeNode | undefined,
    into: Set<string>
): void {
    if (after !== undefined && before === after) {
        return;
    }
    if (before.kind === 'image') {
        if (before.src !== '') {
            into.add(before.src);
        }
        return;
    }
    if (before.kind !== 'folder') {
        return;
    }
    const counterparts =
        after?.kind === 'folder'
            ? new Map(after.children.map((child) => [child.id, child]))
            : undefined;
    for (const child of before.children) {
        collectReleaseCandidates(child, counterparts?.get(child.id), into);
    }
}

export function ownedSrcsReleasedBy(
    before: WorkspaceState,
    after: WorkspaceState,
    isOwned: (src: string) => boolean
): string[] {
    if (before.root === after.root) {
        return [];
    }
    // This runs on EVERY store notification, i.e. on every keystroke. It used to
    // walk both whole trees each time; now the full scan of `after` only happens
    // when something owned actually disappeared from the changed region.
    const candidates = new Set<string>();
    collectReleaseCandidates(before.root, after.root, candidates);
    const owned = [...candidates].filter(isOwned);
    if (owned.length === 0) {
        return [];
    }
    const current = collectImageSrcs(after.root, new Set());
    return owned.filter((src) => !current.has(src));
}
