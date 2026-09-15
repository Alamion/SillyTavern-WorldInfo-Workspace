import type { FolderNode, TreeNode, WorkspaceState } from '../state/schema';

/**
 * Short per-request handles (`f1`, `e12`, `i3`) for the items the assistant may
 * see (research R5). Node ids are UUIDs: token-heavy and easy for a model to
 * garble, and names are ambiguous — handles are neither.
 */

export interface HandleMap {
    /** handle → node id (stored in the message's context snapshot). */
    handles: Record<string, string>;
    /** node id → handle. */
    byNode: Map<string, string>;
}

const PREFIX = { folder: 'f', entry: 'e', image: 'i' } as const;

export function buildHandleMap(state: WorkspaceState, include?: ReadonlySet<string>): HandleMap {
    const handles: Record<string, string> = {};
    const byNode = new Map<string, string>();
    const counters = { folder: 0, entry: 0, image: 0 };
    const assign = (node: TreeNode): void => {
        if (include && !include.has(node.id)) {
            return;
        }
        counters[node.kind] += 1;
        const handle = `${PREFIX[node.kind]}${String(counters[node.kind])}`;
        handles[handle] = node.id;
        byNode.set(node.id, handle);
    };
    const walk = (folder: FolderNode): void => {
        for (const child of folder.children) {
            assign(child);
            if (child.kind === 'folder') {
                walk(child);
            }
        }
    };
    walk(state.root);
    return { handles, byNode };
}

export function nodeIdOf(map: HandleMap, handle: string): string | undefined {
    return map.handles[handle];
}
