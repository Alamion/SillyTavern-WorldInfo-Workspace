import {
    buildNodeIndex,
    createEntryNode,
    createFolderNode,
    createImageNode,
    findNode,
    type FolderNode,
    type TreeNode,
    type WorkspaceState,
} from '../state/schema';
import { deleteSubtree, moveNode, renameNode } from '../tree/operations';
import type { FolderRecordModel } from './convention';
import { compareDiskNames, splitName } from './naming';
import { baseName, type RelPath } from './ports';
import type { WorkspaceChange } from './reconcile';
import type { ReportLine } from './report';
import type { ScanResult, ScannedEntry, ScannedFolder, ScannedImage } from './scan';

/**
 * Applies disk-side changes to the workspace state (spec 004 US3, research R10).
 * Pure: image sources for new/changed image files are resolved by the caller
 * (uploads) and passed in. Returns the next state plus what the sync engine and the
 * baseline need to know.
 */

export interface PullApplyInput {
    state: WorkspaceState;
    scan: ScanResult;
    /** Workspace id → disk path for every matched item (reconcile matches). */
    matchedPaths: ReadonlyMap<string, RelPath>;
    changes: readonly WorkspaceChange[];
    /** Confirmed deletions (workspace ids). */
    deletions: readonly string[];
    /** Image `src` for created/updated image files, by disk path. */
    imageSrcByPath: ReadonlyMap<RelPath, string>;
    newId: () => string;
    placeholderUid: () => number;
    now?: string;
}

export interface PullApplyResult {
    state: WorkspaceState;
    /** Disk path → workspace id for items created from disk. */
    createdIds: Map<RelPath, string>;
    /** Every workspace id whose content now comes from disk (baseline refresh). */
    appliedIds: Map<string, RelPath>;
    deletedNodes: TreeNode[];
    rootRequests: Array<{ folderId: string; bookName: string | undefined }>;
    lines: ReportLine[];
}

function markDirty(node: TreeNode): void {
    if (node.kind === 'entry') {
        for (const bookSync of Object.values(node.sync.books)) {
            bookSync.status = 'dirty';
        }
    }
}

export function applyPull(input: PullApplyInput): PullApplyResult {
    const now = input.now ?? new Date().toISOString();
    let state = structuredClone(input.state);
    const lines: ReportLine[] = [];
    const createdIds = new Map<RelPath, string>();
    const appliedIds = new Map<string, RelPath>();
    const rootRequests: PullApplyResult['rootRequests'] = [];
    const folderByPath = new Map<RelPath, string>();
    for (const [id, path] of input.matchedPaths) {
        if (findNode(state, id)?.kind === 'folder') {
            folderByPath.set(path, id);
        }
    }
    folderByPath.set('', state.root.id);

    /** Folders that received children from disk (creations and moves). */
    const touchedFolders = new Set<string>();
    const scannedEntries = new Map<RelPath, ScannedEntry>(input.scan.entries.map((entry) => [entry.path, entry]));
    const scannedImages = new Map<RelPath, ScannedImage>(input.scan.images.map((image) => [image.path, image]));
    const recordImage = (image: ScannedImage) => input.scan.folders.get(image.parentPath)?.record?.images.get(image.fileName);

    const applyRecord = (folder: FolderNode, scanned: ScannedFolder): void => {
        const record: FolderRecordModel | null = scanned.record;
        if (scanned.path !== '') {
            folder.name = record?.title ?? scanned.name;
        }
        if (record?.md) {
            folder.md = record.md;
        } else {
            delete folder.md;
        }
        if (record?.root && !folder.isWiRoot) {
            rootRequests.push({ folderId: folder.id, bookName: record.book });
        }
        folder.updatedAt = now;
    };

    // Creations (parents first — reconcile sorts them by depth).
    for (const change of input.changes) {
        if (change.type !== 'create') {
            continue;
        }
        const parentId = folderByPath.get(change.parentPath);
        const parent = parentId ? findNode(state, parentId) : undefined;
        if (parent?.kind !== 'folder') {
            lines.push({ path: change.path, outcome: 'skipped', message: 'Its parent folder is not in the workspace.' });
            continue;
        }
        const id = input.newId();
        let node: TreeNode | null = null;
        if (change.kind === 'folder') {
            const scanned = input.scan.folders.get(change.path);
            if (!scanned) {
                continue;
            }
            const folder = createFolderNode({ id, parentId: parent.id, name: scanned.name, now });
            applyRecord(folder, scanned);
            folderByPath.set(change.path, id);
            node = folder;
        } else if (change.kind === 'entry') {
            const scanned = scannedEntries.get(change.path);
            if (!scanned) {
                continue;
            }
            const entry = createEntryNode({ id, parentId: parent.id, name: scanned.model.title, now, nativeUid: input.placeholderUid() });
            const uid = entry.native.uid;
            entry.native = structuredClone(scanned.model.native);
            entry.native.uid = uid;
            if (scanned.model.md) {
                entry.md = scanned.model.md;
            }
            node = entry;
        } else {
            const scanned = scannedImages.get(change.path);
            if (!scanned) {
                continue;
            }
            const meta = recordImage(scanned);
            const image = createImageNode({ id, parentId: parent.id, name: meta?.title ?? splitName(scanned.fileName).stem, now });
            image.caption = meta?.caption ?? '';
            image.src = input.imageSrcByPath.get(change.path) ?? '';
            node = image;
        }
        parent.children.push(node);
        touchedFolders.add(parent.id);
        createdIds.set(change.path, id);
        appliedIds.set(id, change.path);
        lines.push({ path: change.path, outcome: 'created', message: 'Added to the workspace.' });
    }

    // Moves / renames.
    for (const change of input.changes) {
        if (change.type !== 'move') {
            continue;
        }
        const node = findNode(state, change.id);
        const parentId = folderByPath.get(change.parentPath);
        if (!node || !parentId) {
            continue;
        }
        let moved = false;
        if (node.parentId !== parentId) {
            const next = moveNode(state, change.id, parentId);
            if (next) {
                state = next;
                moved = true;
                touchedFolders.add(parentId);
            }
        }
        const current = findNode(state, change.id);
        if (current && current.name !== change.name && change.name.trim() !== '') {
            state = renameNode(state, change.id, change.name) ?? state;
            moved = true;
            if (current.parentId !== null) {
                touchedFolders.add(current.parentId);
            }
        }
        if (change.kind === 'folder') {
            folderByPath.set(change.path, change.id);
        }
        appliedIds.set(change.id, change.path);
        if (moved) {
            lines.push({ path: change.path, outcome: 'moved', message: 'Moved/renamed in the workspace.' });
        }
    }

    // Content updates.
    for (const change of input.changes) {
        if (change.type !== 'update') {
            continue;
        }
        const node = findNode(state, change.id);
        if (!node) {
            continue;
        }
        if (node.kind === 'entry') {
            const scanned = scannedEntries.get(change.path);
            if (!scanned) {
                continue;
            }
            const uid = node.native.uid;
            node.native = structuredClone(scanned.model.native);
            node.native.uid = uid;
            node.name = scanned.model.title;
            if (scanned.model.md) {
                node.md = scanned.model.md;
            } else {
                delete node.md;
            }
            node.updatedAt = now;
            markDirty(node);
        } else if (node.kind === 'image') {
            const src = input.imageSrcByPath.get(change.path);
            if (src !== undefined) {
                node.src = src;
                node.updatedAt = now;
            }
        } else {
            const scanned = input.scan.folders.get(change.path);
            if (!scanned) {
                continue;
            }
            applyRecord(node, scanned);
        }
        appliedIds.set(change.id, change.path);
        lines.push({ path: change.path, outcome: 'updated', message: 'Updated from the file.' });
    }

    // Folder records also carry image metadata and child order: re-apply for every
    // folder whose record exists (cheap and keeps captions/titles/order in step).
    const index = buildNodeIndex(state.root);
    const pathOf = new Map<string, RelPath>([
        ...input.matchedPaths,
        ...[...createdIds].map(([path, id]) => [id, path] as [string, RelPath]),
        ...appliedIds,
    ]);
    for (const [path, folderId] of folderByPath) {
        const scanned = input.scan.folders.get(path);
        const folder = index.get(folderId);
        const changed = input.changes.some((change) => change.path === path && change.type !== 'move');
        const touched = folder !== undefined && touchedFolders.has(folder.id);
        if (!scanned || folder?.kind !== 'folder' || (!changed && !touched)) {
            continue;
        }
        const childName = (child: TreeNode): string | undefined => {
            const childPath = pathOf.get(child.id);
            return childPath !== undefined ? baseName(childPath) : child.kind === 'image' ? child.name : undefined;
        };
        for (const child of folder.children) {
            if (child.kind !== 'image') {
                continue;
            }
            const key = childName(child);
            const meta = key !== undefined ? scanned.record?.images.get(key) : undefined;
            const title = meta?.title ?? (key !== undefined && pathOf.has(child.id) ? splitName(key).stem : child.name);
            child.name = title;
            child.caption = meta?.caption ?? '';
            if (meta?.src && !pathOf.has(child.id)) {
                child.src = meta.src;
            }
        }
        const order = scanned.record?.order;
        if (!order && touched) {
            // No custom order on disk: items arriving from disk take their default
            // position, so the workspace does not invent an order (FR-023).
            const named = folder.children.map((child) => ({ child, name: childName(child) ?? child.name, isDir: child.kind === 'folder' }));
            named.sort(compareDiskNames);
            folder.children = named.map((item) => item.child);
        }
        if (order) {
            const rank = new Map(order.map((name, i) => [name, i]));
            const named = folder.children.map((child) => ({ child, name: childName(child) ?? child.name, isDir: child.kind === 'folder' }));
            named.sort(compareDiskNames);
            named.sort((a, b) => (rank.get(a.name) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.name) ?? Number.MAX_SAFE_INTEGER));
            folder.children = named.map((item) => item.child);
        }
    }

    // Confirmed deletions.
    const deletedNodes: TreeNode[] = [];
    for (const id of input.deletions) {
        const node = findNode(state, id);
        if (!node || id === state.root.id) {
            continue;
        }
        deletedNodes.push(structuredClone(node));
        state = deleteSubtree(state, id);
        lines.push({ path: input.matchedPaths.get(id) ?? node.name, outcome: 'deleted', message: 'Deleted in the workspace (file was removed).' });
    }

    return { state, createdIds, appliedIds, deletedNodes, rootRequests, lines };
}
