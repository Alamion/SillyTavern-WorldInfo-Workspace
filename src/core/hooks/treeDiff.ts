import type { FolderNode, TreeNode, WorkspaceState } from '../state/schema';
import type { NodeRef, TreeChange } from './events';

/**
 * Derives `tree-changed` entries from two published states (spec 006 R9).
 *
 * Why a diff rather than explicit emit calls at the mutation sites:
 * `applyTreeChange` is NOT the universal funnel it looks like. Nine UI routes go
 * through a raw `store.replace`, and markdown import plus every native-sync
 * mutation bypass it too. FR-009 requires exactly one event per occurrence
 * REGARDLESS of route, and the store is the only place no route escapes.
 *
 * Bookkeeping is not a change: deltas confined to sync status/hashes, native
 * uid, tombstones, folder expand/collapse or settings produce NOTHING, so a push
 * can never masquerade as a user edit and consumers need not filter push noise.
 */

interface IndexedNode {
    node: TreeNode;
    parentId: string | null;
    bookName: string | null;
}

function indexTree(state: WorkspaceState): Map<string, IndexedNode> {
    const index = new Map<string, IndexedNode>();
    const walk = (node: TreeNode, parentId: string | null, bookName: string | null): void => {
        const ownBook =
            node.kind === 'folder' && node.isWiRoot && node.book
                ? node.book.bookName
                : bookName;
        index.set(node.id, { node, parentId, bookName: ownBook });
        if (node.kind === 'folder') {
            for (const child of node.children) {
                walk(child, node.id, ownBook);
            }
        }
    };
    walk(state.root, null, null);
    return index;
}

function refOf(entry: IndexedNode): NodeRef {
    return {
        nodeId: entry.node.id,
        kind: entry.node.kind,
        name: entry.node.name,
        parentId: entry.parentId,
        bookName: entry.bookName,
    };
}

/**
 * True when the two versions differ in something a consumer should hear about.
 * Compared field by field rather than by serializing the node, so a change is
 * never inferred from bookkeeping noise.
 */
function contentChanged(before: TreeNode, after: TreeNode): boolean {
    if (before === after) {
        return false;
    }
    if (before.kind !== after.kind) {
        return true;
    }
    if (before.kind === 'entry' && after.kind === 'entry') {
        const a = before.native as unknown as Record<string, unknown>;
        const b = after.native as unknown as Record<string, unknown>;
        // `uid` is assigned by the push pipeline, not by the user.
        const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
        keys.delete('uid');
        keys.delete('displayIndex');
        for (const key of keys) {
            if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
                return true;
            }
        }
        return false;
    }
    if (before.kind === 'image' && after.kind === 'image') {
        return before.src !== after.src || before.caption !== after.caption;
    }
    if (before.kind === 'folder' && after.kind === 'folder') {
        // `expanded` is a view preference; the book binding is reported by
        // `root-changed`, which carries far more useful detail.
        return before.isWiRoot !== after.isWiRoot;
    }
    return false;
}

/** Ordered list of user-visible changes between two published states. */
export function diffTree(before: WorkspaceState, after: WorkspaceState): TreeChange[] {
    if (before === after || before.root === after.root) {
        return [];
    }
    const previous = indexTree(before);
    const current = indexTree(after);
    const changes: TreeChange[] = [];

    for (const [id, entry] of current) {
        const was = previous.get(id);
        if (!was) {
            changes.push({ change: 'create', node: refOf(entry) });
            continue;
        }
        if (was.node === entry.node && was.parentId === entry.parentId) {
            continue;
        }
        if (was.parentId !== entry.parentId) {
            changes.push({ change: 'move', node: refOf(entry) });
        }
        if (was.node.name !== entry.node.name) {
            changes.push({ change: 'rename', node: refOf(entry) });
        }
        if (contentChanged(was.node, entry.node)) {
            changes.push({ change: 'update', node: refOf(entry) });
        }
    }

    for (const [id, entry] of previous) {
        if (!current.has(id)) {
            changes.push({ change: 'delete', node: refOf(entry) });
        }
    }

    return changes;
}

/** Test/consumer helper: the workspace root of a state, typed. */
export function rootOf(state: WorkspaceState): FolderNode {
    return state.root;
}
