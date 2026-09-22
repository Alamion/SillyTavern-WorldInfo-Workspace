import { baseName, parentPath, type BaselineItem, type MdItemKind, type RelPath } from './ports';

/**
 * Three-way reconcile for the linked folder (spec 004 FR-011..FR-014, research R7,
 * R9). Pure: compares the workspace render, the disk scan, and the baseline of the
 * last successful sync, and classifies what must happen. Workspace→disk writes are
 * NOT listed here — the push step derives them from the baseline — so the pull only
 * decides what flows into the workspace, what needs the user, and which pairs are
 * already equal.
 *
 * Identity without ids in files (FR-003, FR-023), matching order:
 * optional `wi_id` → path → folder move → unique content move.
 */

/** Hash used for "no folder record" on either side. */
export const NO_RECORD = '';

export interface WsItem {
    id: string;
    kind: MdItemKind;
    path: RelPath;
    parentId: string | null;
    name: string;
    /** Canonical hash of the workspace side (entry text, image bytes, record text or NO_RECORD). */
    hash: string;
}

export interface DiskItem {
    kind: MdItemKind;
    path: RelPath;
    /** Hash of the bytes on disk (folders: record file, or NO_RECORD). */
    hash: string;
    /** Hash of the canonical rendering of what the file means (comparable with WsItem.hash). */
    canonHash: string;
    /** Name the item gets in the workspace (title, else file stem / directory name). */
    name: string;
    idHint?: string;
}

export type MatchVia = 'wi_id' | 'path' | 'folder-move' | 'content-move';

export type SideState = 'edited' | 'deleted' | 'moved' | 'created';

export interface Conflict {
    /** Workspace id (absent for a disk item with no workspace counterpart). */
    id: string;
    kind: MdItemKind;
    path: RelPath;
    workspace: SideState;
    disk: SideState;
}

export type WorkspaceChange =
    /** Disk item without a workspace counterpart → create it. */
    | { type: 'create'; path: RelPath; kind: MdItemKind; parentPath: RelPath }
    /** Disk content changed, workspace unchanged → take the disk content. */
    | { type: 'update'; id: string; path: RelPath; kind: MdItemKind }
    /** Disk location/name changed → move/rename the workspace item. */
    | { type: 'move'; id: string; path: RelPath; kind: MdItemKind; parentPath: RelPath; name: string };

export interface ReconcileResult {
    matches: Map<string, { path: RelPath; via: MatchVia }>;
    toWorkspace: WorkspaceChange[];
    /** Deleted on disk while unchanged in the workspace: confirmation required (FR-014). */
    pendingDeletions: Array<{ id: string; path: RelPath; kind: MdItemKind }>;
    conflicts: Conflict[];
    /** Pairs that are equal although the baseline was missing or stale: record them. */
    adopt: Array<{ id: string; path: RelPath; kind: MdItemKind }>;
    warnings: Array<{ path: RelPath; message: string }>;
}

export interface ReconcileInput {
    rootId: string;
    ws: ReadonlyMap<string, WsItem>;
    disk: ReadonlyMap<RelPath, DiskItem>;
    baseline: Readonly<Record<string, BaselineItem>>;
}

function depth(path: RelPath): number {
    return path === '' ? 0 : path.split('/').length;
}

export function reconcile(input: ReconcileInput): ReconcileResult {
    const { ws, disk, baseline, rootId } = input;
    const matches = new Map<string, { path: RelPath; via: MatchVia }>();
    const matchedPaths = new Map<RelPath, string>();
    const warnings: ReconcileResult['warnings'] = [];

    const match = (id: string, path: RelPath, via: MatchVia): void => {
        matches.set(id, { path, via });
        matchedPaths.set(path, id);
    };
    const pathFree = (path: RelPath, kind: MdItemKind): boolean => {
        const item = disk.get(path);
        return item !== undefined && item.kind === kind && !matchedPaths.has(path);
    };

    // The workspace root always maps to the linked folder itself.
    if (disk.has('')) {
        match(rootId, '', 'path');
    }

    // 1. Optional wi_id hints (only unique hints naming a known item).
    const hintCount = new Map<string, number>();
    for (const item of disk.values()) {
        if (item.idHint) {
            hintCount.set(item.idHint, (hintCount.get(item.idHint) ?? 0) + 1);
        }
    }
    for (const item of disk.values()) {
        const hint = item.idHint;
        if (!hint || matches.has(hint)) {
            continue;
        }
        const known = baseline[hint] ?? undefined;
        const wsItem = ws.get(hint);
        if (hintCount.get(hint) !== 1 || (!known && !wsItem) || (known ?? wsItem)!.kind !== item.kind) {
            warnings.push({ path: item.path, message: `wi_id "${hint}" was ignored.` });
            continue;
        }
        match(hint, item.path, 'wi_id');
    }

    const baseItems = Object.values(baseline).sort((a, b) => depth(a.path ?? '') - depth(b.path ?? ''));

    // 2. Path matches for baseline items.
    for (const base of baseItems) {
        if (base.path !== null && !matches.has(base.id) && pathFree(base.path, base.kind)) {
            match(base.id, base.path, 'path');
        }
    }

    // Pre-bucketed lookups (spec 006 R8). Passes 3 and 4 used to re-scan every
    // baseline item and re-materialize the whole disk map for EVERY unmatched
    // item, which is quadratic on a large vault.
    const baseByParent = new Map<string, typeof baseItems>();
    for (const item of baseItems) {
        if (item.path === null) {
            continue;
        }
        const parent = parentPath(item.path);
        const bucket = baseByParent.get(parent);
        if (bucket) {
            bucket.push(item);
        } else {
            baseByParent.set(parent, [item]);
        }
    }
    const diskFolders = [...disk.values()].filter((item) => item.kind === 'folder');

    // 3. Folder moves: a missing directory whose record or direct children reappear elsewhere.
    for (const base of baseItems) {
        if (base.kind !== 'folder' || base.path === null || base.id === rootId || matches.has(base.id)) {
            continue;
        }
        const childNames = (baseByParent.get(base.path) ?? [])
            .filter((item) => item.path !== null && item.path !== base.path)
            .map((item) => baseName(item.path!));
        const candidates = diskFolders.filter((item) => {
            if (matchedPaths.has(item.path) || item.path === '') {
                return false;
            }
            if (base.diskHash !== NO_RECORD && item.hash === base.diskHash) {
                return true;
            }
            return childNames.length > 0 && childNames.every((name) => disk.has(item.path === '' ? name : `${item.path}/${name}`));
        });
        if (candidates.length !== 1) {
            continue;
        }
        const target = candidates[0]!.path;
        match(base.id, target, 'folder-move');
        // Descendants follow under the new prefix.
        const prefix = `${base.path}/`;
        for (const child of baseItems) {
            if (child.path === null || matches.has(child.id) || !child.path.startsWith(prefix)) {
                continue;
            }
            const moved = `${target}/${child.path.slice(prefix.length)}`;
            if (pathFree(moved, child.kind)) {
                match(child.id, moved, 'folder-move');
            }
        }
    }

    // 4. Unique content moves for files whose old path is gone.
    const unmatchedBase = baseItems.filter(
        (base) => base.kind !== 'folder' && base.path !== null && !matches.has(base.id) && !disk.has(base.path)
    );
    const kindHash = (kind: string, hash: string): string => `${kind}\u0000${hash}`;
    const diskByKindHash = new Map<string, DiskItem[]>();
    for (const item of disk.values()) {
        const key = kindHash(item.kind, item.hash);
        const bucket = diskByKindHash.get(key);
        if (bucket) {
            bucket.push(item);
        } else {
            diskByKindHash.set(key, [item]);
        }
    }
    const rivalCount = new Map<string, number>();
    for (const base of unmatchedBase) {
        const key = kindHash(base.kind, base.diskHash);
        rivalCount.set(key, (rivalCount.get(key) ?? 0) + 1);
    }
    for (const base of unmatchedBase) {
        const key = kindHash(base.kind, base.diskHash);
        const candidates = (diskByKindHash.get(key) ?? []).filter(
            (item) => !matchedPaths.has(item.path)
        );
        if (candidates.length === 1 && (rivalCount.get(key) ?? 0) === 1) {
            match(base.id, candidates[0]!.path, 'content-move');
        }
    }

    // 5. New workspace items (no baseline) meeting an unmatched disk item at their path.
    for (const item of [...ws.values()].sort((a, b) => depth(a.path) - depth(b.path))) {
        if (!baseline[item.id] && !matches.has(item.id) && pathFree(item.path, item.kind)) {
            match(item.id, item.path, 'path');
        }
    }

    const toWorkspace: WorkspaceChange[] = [];
    const pendingDeletions: ReconcileResult['pendingDeletions'] = [];
    const conflicts: Conflict[] = [];
    const adopt: ReconcileResult['adopt'] = [];

    const ids = new Set<string>([...Object.keys(baseline), ...matches.keys()]);
    for (const id of ids) {
        if (id === rootId) {
            classifyRoot();
            continue;
        }
        const base = baseline[id];
        const wsItem = ws.get(id);
        const matched = matches.get(id);
        const diskItem = matched ? disk.get(matched.path) : undefined;
        const kind = (wsItem ?? base ?? diskItem)!.kind;

        if (!base) {
            // No baseline: initial link / re-link, or a new workspace item meeting a file.
            if (wsItem && diskItem) {
                if (wsItem.hash === diskItem.canonHash) {
                    adopt.push({ id, path: diskItem.path, kind });
                } else if (kind === 'folder' && wsItem.hash === NO_RECORD) {
                    toWorkspace.push({ type: 'update', id, path: diskItem.path, kind });
                } else if (kind === 'folder' && diskItem.hash === NO_RECORD) {
                    // Workspace holds non-default folder info: the push writes the record.
                } else {
                    conflicts.push({ id, kind, path: diskItem.path, workspace: 'created', disk: 'created' });
                }
            }
            continue;
        }

        if (!wsItem && !diskItem) {
            continue; // gone on both sides
        }
        const wsChanged = wsItem ? wsItem.hash !== base.wsHash : false;
        const diskChanged = diskItem ? diskItem.hash !== base.diskHash : false;

        if (wsItem && !diskItem) {
            if (base.path === null) {
                continue; // URL-only images have no file of their own
            }
            if (wsChanged) {
                conflicts.push({ id, kind, path: base.path, workspace: 'edited', disk: 'deleted' });
            } else {
                pendingDeletions.push({ id, path: base.path, kind });
            }
            continue;
        }
        if (!wsItem && diskItem) {
            if (diskChanged) {
                conflicts.push({ id, kind, path: diskItem.path, workspace: 'deleted', disk: 'edited' });
            }
            // Unchanged on disk: the push removes the file (deleted in the workspace).
            continue;
        }

        const w = wsItem!;
        const d = diskItem!;
        const diskMoved = base.path !== d.path;
        const wsMoved = base.path !== w.path;
        if (diskMoved && wsMoved && w.path !== d.path) {
            conflicts.push({ id, kind, path: d.path, workspace: 'moved', disk: 'moved' });
            continue;
        }
        if (diskMoved && !wsMoved) {
            toWorkspace.push({ type: 'move', id, path: d.path, kind, parentPath: parentPath(d.path), name: d.name });
        }
        if (wsChanged && diskChanged) {
            if (w.hash === d.canonHash) {
                adopt.push({ id, path: d.path, kind });
            } else {
                conflicts.push({ id, kind, path: d.path, workspace: 'edited', disk: 'edited' });
            }
        } else if (diskChanged) {
            toWorkspace.push({ type: 'update', id, path: d.path, kind });
        }
    }

    // Disk items nobody claimed → new workspace items (parents first).
    const unclaimed = [...disk.values()]
        .filter((item) => item.path !== '' && !matchedPaths.has(item.path))
        .sort((a, b) => depth(a.path) - depth(b.path));
    for (const item of unclaimed) {
        toWorkspace.push({ type: 'create', path: item.path, kind: item.kind, parentPath: parentPath(item.path) });
    }

    return { matches, toWorkspace, pendingDeletions, conflicts, adopt, warnings };

    function classifyRoot(): void {
        const base = baseline[rootId];
        const wsItem = ws.get(rootId);
        const diskItem = disk.get('');
        if (!wsItem || !diskItem) {
            return;
        }
        if (!base) {
            if (wsItem.hash === diskItem.canonHash) {
                adopt.push({ id: rootId, path: '', kind: 'folder' });
            } else if (wsItem.hash === NO_RECORD) {
                toWorkspace.push({ type: 'update', id: rootId, path: '', kind: 'folder' });
            } else if (diskItem.hash !== NO_RECORD) {
                conflicts.push({ id: rootId, kind: 'folder', path: '', workspace: 'created', disk: 'created' });
            }
            return;
        }
        const wsChanged = wsItem.hash !== base.wsHash;
        const diskChanged = diskItem.hash !== base.diskHash;
        if (wsChanged && diskChanged) {
            if (wsItem.hash === diskItem.canonHash) {
                adopt.push({ id: rootId, path: '', kind: 'folder' });
            } else {
                conflicts.push({ id: rootId, kind: 'folder', path: '', workspace: 'edited', disk: 'edited' });
            }
        } else if (diskChanged) {
            toWorkspace.push({ type: 'update', id: rootId, path: '', kind: 'folder' });
        }
    }
}
