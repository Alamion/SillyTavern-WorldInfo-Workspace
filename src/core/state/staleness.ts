import { fnv1a, stableStringify } from '../sync/fingerprint';
import { diffTree } from '../hooks/treeDiff';
import type { FolderNode, SaveMarker, TreeNode, WorkspaceState } from './schema';

/**
 * Stale-tab protection (spec 008, research R2/R3): a content identity of the
 * workspace that ignores bookkeeping, the trust rule for save markers, and the
 * comparison of a saved payload with the copy a tab last saw.
 *
 * Bookkeeping is never content (FR-015): folder expand state, layout sizes, the
 * sort mode, per-book sync status/hash/uid, tombstones, native uid copies, and
 * the markers themselves. Another tab's successful native push rewrites sync
 * status without any user change; counting it would raise false conflicts.
 */

const NODE_BOOKKEEPING = new Set(['expanded', 'sync', 'children', 'parentId']);

// Identity-keyed: the store path-copies, so an unchanged subtree keeps its node
// objects and its hash is never recomputed (same idea as fingerprintEntry).
const nodeHashes = new WeakMap<TreeNode, string>();
const stateHashes = new WeakMap<WorkspaceState, string>();

function nodeHash(node: TreeNode): string {
    const cached = nodeHashes.get(node);
    if (cached !== undefined) {
        return cached;
    }
    const own: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
        if (NODE_BOOKKEEPING.has(key)) {
            continue;
        }
        if (key === 'native' && value !== null && typeof value === 'object') {
            own[key] = { ...(value as Record<string, unknown>), uid: undefined };
        } else if (key === 'book' && value !== null && typeof value === 'object') {
            own[key] = { ...(value as Record<string, unknown>), tombstones: undefined };
        } else {
            own[key] = value;
        }
    }
    const children = node.kind === 'folder' ? (node as FolderNode).children.map(nodeHash).join(',') : '';
    const hash = fnv1a(`${stableStringify(own)}|${children}`);
    nodeHashes.set(node, hash);
    return hash;
}

/** Content identity of a workspace state (bookkeeping excluded). */
export function contentHash(state: WorkspaceState): string {
    const cached = stateHashes.get(state);
    if (cached !== undefined) {
        return cached;
    }
    const settings = stableStringify({ ...state.settings, layout: undefined, sortMode: undefined });
    const hash = fnv1a(`${String(state.version)}|${nodeHash(state.root)}|${settings}`);
    stateHashes.set(state, hash);
    return hash;
}

/** A marker counts only while it describes the payload it travels with. */
export function markerTrusted(state: WorkspaceState): boolean {
    return state._save !== undefined && state._save.hash === contentHash(state);
}

export type StalenessKind = 'unchanged' | 'newer' | 'older' | 'conflict';

/** What a tab last loaded or saved: its content hash and marker. */
export interface SeenIdentity {
    hash: string;
    marker: SaveMarker | undefined;
}

/** Research R2 classification of a saved payload against a tab's last seen copy. */
export function classify(seen: SeenIdentity, saved: WorkspaceState): StalenessKind {
    if (contentHash(saved) === seen.hash) {
        return 'unchanged';
    }
    if (!markerTrusted(saved)) {
        return 'conflict';
    }
    const savedRev = saved._save?.rev ?? 0;
    const seenRev = seen.marker?.rev ?? 0;
    if (savedRev > seenRev) {
        return 'newer';
    }
    return savedRev < seenRev ? 'older' : 'conflict';
}

/** The marker for this tab's next save: above every revision either side has seen. */
export function nextMarker(
    seen: SaveMarker | undefined,
    saved: SaveMarker | undefined,
    writer: string,
    hash: string,
    at: string
): SaveMarker {
    return { rev: Math.max(seen?.rev ?? 0, saved?.rev ?? 0) + 1, writer, at, hash };
}

/**
 * A loaded workspace with this tab's bookkeeping: folder expand state (by node
 * id), layout sizes and sort mode. Everything else, sync status included, comes
 * from the loaded state. Neither input is mutated.
 */
export function withBookkeeping(loaded: WorkspaceState, tab: WorkspaceState): WorkspaceState {
    const expanded = new Map<string, boolean>();
    const collect = (node: TreeNode): void => {
        if (node.kind === 'folder') {
            expanded.set(node.id, node.expanded);
            node.children.forEach(collect);
        }
    };
    collect(tab.root);
    const apply = (node: TreeNode): TreeNode => {
        if (node.kind !== 'folder') {
            return node;
        }
        const own = expanded.get(node.id);
        return {
            ...node,
            expanded: own ?? node.expanded,
            children: node.children.map(apply),
        };
    };
    const settings = { ...loaded.settings, sortMode: tab.settings.sortMode };
    if (tab.settings.layout !== undefined) {
        settings.layout = tab.settings.layout;
    }
    return { ...loaded, root: apply(loaded.root) as FolderNode, settings };
}

export interface ConflictSide {
    /** "Name — edited/added/removed", at most `limit` lines. */
    lines: string[];
    /** How many more changes were not listed. */
    more: number;
}

export interface ConflictSummary {
    /** Changed in this tab since the last seen copy (lost by "Use the saved version"). */
    mine: ConflictSide;
    /** Changed in the saved version since then (overwritten by "Keep this version"). */
    theirs: ConflictSide;
}

function sideOf(seen: WorkspaceState, side: WorkspaceState, limit: number): ConflictSide {
    const byNode = new Map<string, { name: string; label: string }>();
    for (const { change, node } of diffTree(seen, side)) {
        const label = change === 'create' ? 'added' : change === 'delete' ? 'removed' : 'edited';
        // One line per item: "added"/"removed" win over the edits that come with them.
        if (byNode.get(node.nodeId)?.label !== 'edited' && byNode.has(node.nodeId)) {
            continue;
        }
        byNode.set(node.nodeId, { name: node.name, label });
    }
    const lines = [...byNode.values()].map((item) => `${item.name} — ${item.label}`);
    const settingsChanged = (pick: (state: WorkspaceState) => unknown, title: string): void => {
        if (stableStringify(pick(seen)) !== stableStringify(pick(side))) {
            lines.push(`${title} — changed`);
        }
    };
    settingsChanged((state) => state.settings.assistant, 'Assistant settings');
    settingsChanged((state) => state.settings.picking, 'Lore picking settings');
    settingsChanged((state) => state.settings.images, 'Image settings');
    return { lines: lines.slice(0, limit), more: Math.max(0, lines.length - limit) };
}

/** Both sides of a conflict for the banner (FR-016); bookkeeping is never listed. */
export function conflictSummary(
    seen: WorkspaceState,
    mine: WorkspaceState,
    theirs: WorkspaceState,
    limit = 10
): ConflictSummary {
    return { mine: sideOf(seen, mine, limit), theirs: sideOf(seen, theirs, limit) };
}
