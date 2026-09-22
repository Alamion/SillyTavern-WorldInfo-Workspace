import { bytesToDataUri } from '../core/md/dataUri';
import { planImport } from '../core/md/importPlan';
import { EXT_MIME } from '../core/md/naming';
import type { Digest, DiskFolder, ImageStorePort, YamlCodec } from '../core/md/ports';
import { createReportBuilder, type OperationReport } from '../core/md/report';
import { scanFolder } from '../core/md/scan';
import type { CancelToken } from '../core/md/cancel';
import { findNode, type TreeNode } from '../core/state/schema';
import type { WorkspaceStore } from '../core/state/store';
import { yieldToEventLoop } from './mdExport';

/**
 * One-off import runner (spec 004 US2, FR-008/FR-009/FR-024): scan (read-only) →
 * plan → store images in the app image storage → add the subtree in ONE store
 * update → restore World Info roots through the Phase 1 designation flow.
 * Nothing is ever written to the source folder.
 */

export interface ImportDeps {
    folder: DiskFolder;
    store: WorkspaceStore;
    targetFolderId: string;
    yaml: YamlCodec;
    digest: Digest;
    imageStore: ImageStorePort;
    newId: () => string;
    placeholderUid: () => number;
    /** Phase 1 designation flow (adopt-or-create, collision-resolved, never activated). */
    designate: (folderId: string, bookName: string | undefined) => Promise<void>;
    onProgress?: (label: string, done: number, total: number) => void;
    /** Cancels the READ phase; nothing is written until the scan completes. */
    cancel?: CancelToken;
}

export interface ImportResult {
    report: OperationReport;
    /** Ids of the new top-level items added to the target folder. */
    addedIds: string[];
}

export async function runImport(deps: ImportDeps): Promise<ImportResult> {
    const builder = createReportBuilder('import');
    const scan = await scanFolder(deps.folder, {
        digest: deps.digest,
        yaml: deps.yaml,
        onProgress: (done, total) => deps.onProgress?.('Reading files', done, total),
        yieldNow: yieldToEventLoop,
        cancel: deps.cancel,
    });
    if (findNode(deps.store.getState(), deps.targetFolderId)?.kind !== 'folder') {
        builder.add('', 'skipped', 'The target folder no longer exists.');
        return { report: builder.finish(), addedIds: [] };
    }
    const plan = planImport({
        scan,
        state: deps.store.getState(),
        targetFolderId: deps.targetFolderId,
        newId: deps.newId,
        placeholderUid: deps.placeholderUid,
        acceptsUpload: (ext) => deps.imageStore.accepts(ext),
    });
    plan.lines.forEach((line) => builder.add(line.path, line.outcome, line.message));

    const nodesById = new Map<string, TreeNode>();
    const index = (node: TreeNode): void => {
        nodesById.set(node.id, node);
        if (node.kind === 'folder') {
            node.children.forEach(index);
        }
    };
    plan.nodes.forEach(index);
    let done = 0;
    for (const upload of plan.uploads) {
        const node = nodesById.get(upload.nodeId);
        if (node?.kind !== 'image') {
            continue;
        }
        try {
            node.src = await deps.imageStore.upload({ bytes: upload.bytes, ext: upload.ext, stem: upload.stem });
        } catch (error) {
            node.src = bytesToDataUri(upload.bytes, EXT_MIME[upload.ext] ?? 'application/octet-stream');
            builder.add(
                upload.path,
                'warning',
                `Stored inside the workspace data: the app image storage refused it (${error instanceof Error ? error.message : String(error)}).`
            );
        }
        done += 1;
        deps.onProgress?.('Storing images', done, plan.uploads.length);
    }

    deps.store.update((draft) => {
        const target = findNode(draft, deps.targetFolderId);
        if (target?.kind === 'folder') {
            target.children.push(...plan.nodes);
            target.expanded = true;
        }
    });

    for (const request of plan.rootRequests) {
        try {
            await deps.designate(request.folderId, request.bookName);
        } catch (error) {
            builder.add('', 'warning', `A World Info root could not be restored: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    if (plan.nodes.length === 0) {
        builder.add('', 'skipped', 'Nothing to import: no markdown or image files were found.');
    }
    return { report: builder.finish(), addedIds: plan.nodes.map((node) => node.id) };
}
