import type { TreeNode } from './schema';

/**
 * Identity-keyed node index (spec 006 R2).
 *
 * `findNode` walks the tree on every lookup — O(n) per call, from ~30 call sites,
 * several of them inside loops. This cache lets those loops pay that walk once.
 * It is keyed by the root OBJECT, so structural sharing (which gives every
 * mutation a fresh root) turns any real change into a plain cache miss.
 *
 * A `WeakMap` means an index is collected with the state version it belongs to,
 * so holding many historical states (undo, baselines) cannot leak.
 *
 * OPT-IN ONLY. The cache is keyed by the root object, so it is correct only while
 * that tree is treated as immutable. Code that mutates a tree IN PLACE and then
 * looks ids up on the same object (e.g. `core/md/applyPull.ts`) must keep using
 * `findNode`, which always walks fresh — a stale index there would silently skip
 * a node added during the pass. Use `getNodeIndex` in tight read-only loops over
 * a state that does not change while the loop runs.
 */

const indexCache = new WeakMap<TreeNode, Map<string, TreeNode>>();

/** Walks the subtree and returns a fresh, uncached id→node map. */
export function buildNodeIndex(root: TreeNode): Map<string, TreeNode> {
    const index = new Map<string, TreeNode>();
    const walk = (node: TreeNode): void => {
        index.set(node.id, node);
        if (node.kind === 'folder') {
            node.children.forEach(walk);
        }
    };
    walk(root);
    return index;
}

/** Returns the cached index for `root`, building it on first use. */
export function getNodeIndex(root: TreeNode): Map<string, TreeNode> {
    const cached = indexCache.get(root);
    if (cached) {
        return cached;
    }
    const index = buildNodeIndex(root);
    indexCache.set(root, index);
    return index;
}
