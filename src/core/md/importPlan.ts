import {
    buildNodeIndex,
    createEntryNode,
    createFolderNode,
    createImageNode,
    type FolderNode,
    type ImageNode,
    type TreeNode,
    type WorkspaceState,
} from '../state/schema';
import { bytesToDataUri } from './dataUri';
import { EXT_MIME, compareDiskNames, splitName } from './naming';
import { baseName, type RelPath } from './ports';
import type { ReportLine } from './report';
import type { ScanResult, ScannedFolder } from './scan';

/**
 * Pure import plan (spec 004 US2, FR-008/FR-009/FR-023): the CONTENTS of a scanned
 * folder become new children of the target folder — symmetric with the export, which
 * writes the workspace root's contents (or a subtree as its own directory) into the
 * picked folder. Root designations are returned as requests (they must go through
 * the Phase 1 designation flow), image uploads as requests for the runner.
 */

export const OVERSIZE_EMBED_BYTES = 1024 * 1024;

export interface ImageUploadRequest {
    nodeId: string;
    bytes: Uint8Array;
    ext: string;
    stem: string;
    path: RelPath;
}

export interface RootRequest {
    folderId: string;
    bookName: string | undefined;
}

export interface ImportPlan {
    /** New children of the target folder, in import order. */
    nodes: TreeNode[];
    uploads: ImageUploadRequest[];
    rootRequests: RootRequest[];
    /** Node id by source path (folders, entries, image files). */
    idsByPath: Map<RelPath, string>;
    lines: ReportLine[];
}

export interface ImportPlanInput {
    scan: ScanResult;
    state: WorkspaceState;
    targetFolderId: string;
    newId: () => string;
    placeholderUid: () => number;
    /** Image formats the app image storage accepts (others are embedded). */
    acceptsUpload: (ext: string) => boolean;
    now?: string;
}

export function planImport(input: ImportPlanInput): ImportPlan {
    const now = input.now ?? new Date().toISOString();
    const usedIds = new Set(buildNodeIndex(input.state.root).keys());
    const lines: ReportLine[] = [...input.scan.lines];
    const uploads: ImageUploadRequest[] = [];
    const rootRequests: RootRequest[] = [];
    const idsByPath = new Map<RelPath, string>();

    const hintCounts = new Map<string, number>();
    for (const item of input.scan.entries) {
        const hint = item.model.idHint;
        if (hint) {
            hintCounts.set(hint, (hintCounts.get(hint) ?? 0) + 1);
        }
    }
    const takeId = (hint: string | undefined, path: RelPath): string => {
        if (hint && !usedIds.has(hint) && hintCounts.get(hint) === 1) {
            usedIds.add(hint);
            return hint;
        }
        if (hint) {
            lines.push({ path, outcome: 'warning', message: `wi_id "${hint}" is already used; a new id was assigned.` });
        }
        let id = input.newId();
        while (usedIds.has(id)) {
            id = input.newId();
        }
        usedIds.add(id);
        return id;
    };

    const childrenOf = new Map<RelPath, Array<{ name: string; isDir: boolean; node: TreeNode }>>();
    const pushChild = (dir: RelPath, name: string, isDir: boolean, node: TreeNode): void => {
        const list = childrenOf.get(dir) ?? [];
        list.push({ name, isDir, node });
        childrenOf.set(dir, list);
    };

    const folderNodes = new Map<RelPath, FolderNode>();
    const makeFolder = (scanned: ScannedFolder, name: string): FolderNode => {
        const node = createFolderNode({ id: takeId(scanned.record?.idHint, scanned.path), parentId: 'pending', name, now });
        if (scanned.record?.md) {
            node.md = scanned.record.md;
        }
        if (scanned.record?.root) {
            rootRequests.push({ folderId: node.id, bookName: scanned.record.book });
        }
        return node;
    };

    // The picked folder itself maps onto the target: only its contents are imported.
    const holder = createFolderNode({ id: input.targetFolderId, parentId: input.targetFolderId, name: 'target', now });
    folderNodes.set('', holder);
    const topRecord = input.scan.folders.get('')?.record;
    if (topRecord?.root) {
        lines.push({
            path: '.wiw-folder.yaml',
            outcome: 'warning',
            message: 'The picked folder itself is a World Info root; its contents were imported without that designation.',
        });
    }
    const sortedFolders = [...input.scan.folders.values()]
        .filter((scanned) => scanned.path !== '')
        .sort((a, b) => a.path.split('/').length - b.path.split('/').length);
    for (const scanned of sortedFolders) {
        const name = scanned.record?.title ?? scanned.name;
        const node = makeFolder(scanned, name.trim() === '' ? 'Imported' : name);
        folderNodes.set(scanned.path, node);
        idsByPath.set(scanned.path, node.id);
        if (scanned.parentPath !== null) {
            pushChild(scanned.parentPath, scanned.name, true, node);
        }
    }

    for (const item of input.scan.entries) {
        const id = takeId(item.model.idHint, item.path);
        const node = createEntryNode({ id, parentId: 'pending', name: item.model.title, now, nativeUid: input.placeholderUid() });
        const uid = node.native.uid;
        node.native = item.model.native;
        node.native.uid = uid;
        if (item.model.md) {
            node.md = item.model.md;
        }
        idsByPath.set(item.path, id);
        pushChild(item.parentPath, baseName(item.path), false, node);
        lines.push({ path: item.path, outcome: 'created' });
    }

    for (const item of input.scan.images) {
        const record = input.scan.folders.get(item.parentPath)?.record?.images.get(item.fileName);
        const id = takeId(undefined, item.path);
        const node = createImageNode({ id, parentId: 'pending', name: record?.title ?? splitName(item.fileName).stem, now });
        node.caption = record?.caption ?? '';
        if (input.acceptsUpload(item.ext)) {
            uploads.push({ nodeId: id, bytes: item.bytes, ext: item.ext, stem: node.name, path: item.path });
        } else {
            node.src = bytesToDataUri(item.bytes, EXT_MIME[item.ext] ?? 'application/octet-stream');
            if (item.bytes.length > OVERSIZE_EMBED_BYTES) {
                lines.push({
                    path: item.path,
                    outcome: 'warning',
                    message: 'Large image embedded in the workspace data (format not accepted by the app image storage).',
                });
            }
        }
        idsByPath.set(item.path, id);
        pushChild(item.parentPath, item.fileName, false, node);
        lines.push({ path: item.path, outcome: 'created' });
    }

    // URL-only images live only in folder records.
    for (const scanned of input.scan.folders.values()) {
        for (const [key, image] of scanned.record?.images ?? []) {
            if (!image.src || input.scan.images.some((file) => file.parentPath === scanned.path && file.fileName === key)) {
                continue;
            }
            const node: ImageNode = createImageNode({ id: takeId(undefined, scanned.path), parentId: 'pending', name: key, now });
            node.src = image.src;
            node.caption = image.caption ?? '';
            pushChild(scanned.path, key, false, node);
            lines.push({ path: `${scanned.path}${scanned.path === '' ? '' : '/'}${key}`, outcome: 'created', message: 'External image (URL).' });
        }
    }

    for (const [dir, folder] of folderNodes) {
        const children = childrenOf.get(dir) ?? [];
        const order = input.scan.folders.get(dir)?.record?.order;
        const sorted = [...children].sort(compareDiskNames);
        if (order) {
            const rank = new Map(order.map((name, index) => [name, index]));
            sorted.sort((a, b) => (rank.get(a.name) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.name) ?? Number.MAX_SAFE_INTEGER));
        }
        folder.children = sorted.map((child) => {
            child.node.parentId = folder.id;
            return child.node;
        });
    }

    return { nodes: holder.children, uploads, rootRequests, idsByPath, lines };
}
