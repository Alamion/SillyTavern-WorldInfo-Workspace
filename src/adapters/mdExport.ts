import { planExport, type ExportPlan } from '../core/md/exportPlan';
import { decodeDataUri } from '../core/md/dataUri';
import { textBytes } from '../core/md/hash';
import { createReportBuilder, type OperationReport } from '../core/md/report';
import type { Digest, DiskFolder, RelPath, YamlCodec } from '../core/md/ports';
import type { WorkspaceState } from '../core/state/schema';

/**
 * One-off export runner (spec 004 US1, FR-006/FR-007/FR-019): pre-flight against
 * the target folder, then sequential writes with progress. Files the plan does not
 * produce are never touched.
 */

export type ImageResolver = (src: string) => Promise<Uint8Array | null>;

export interface ExportPreflight {
    plan: ExportPlan;
    /** Existing files the export would change. */
    overwrites: RelPath[];
    /** The target already contains files (any). */
    targetNonEmpty: boolean;
    /** Number of files that will be written (new or changed). */
    toWrite: number;
    run(onProgress?: (done: number, total: number) => void): Promise<OperationReport>;
}

const YIELD_EVERY = 25;

export const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** data: URIs are decoded locally; same-origin app paths are fetched. */
export function createImageResolver(fetchFn: typeof fetch = (...args) => fetch(...args)): ImageResolver {
    return async (src) => {
        if (src.startsWith('data:')) {
            return decodeDataUri(src)?.bytes ?? null;
        }
        try {
            const response = await fetchFn(src.startsWith('/') ? src : `/${src}`);
            if (!response.ok) {
                return null;
            }
            return new Uint8Array(await response.arrayBuffer());
        } catch {
            return null;
        }
    };
}

export async function prepareExport(input: {
    folder: DiskFolder;
    state: WorkspaceState;
    scopeFolderId: string;
    yaml: YamlCodec;
    digest: Digest;
    resolveImage: ImageResolver;
}): Promise<ExportPreflight | null> {
    const plan = planExport({ state: input.state, scopeFolderId: input.scopeFolderId, yaml: input.yaml });
    if (!plan) {
        return null;
    }
    const listing = await input.folder.list();
    const existingFiles = new Set(listing.filter((entry) => entry.kind === 'file').map((entry) => entry.path));
    const builder = createReportBuilder('export');
    const items: Array<{ path: RelPath; bytes: Uint8Array; exists: boolean }> = [];
    for (const file of plan.files) {
        let bytes: Uint8Array | null;
        if (file.kind === 'image') {
            bytes = await input.resolveImage(file.src);
            if (bytes === null) {
                builder.add(file.path, 'warning', 'The image could not be read; no file was written.');
                continue;
            }
        } else {
            bytes = textBytes(file.text);
        }
        const exists = existingFiles.has(file.path);
        if (exists) {
            const current = await input.digest(await input.folder.readBytes(file.path));
            if (current === (await input.digest(bytes))) {
                builder.add(file.path, 'skipped');
                continue;
            }
        }
        items.push({ path: file.path, bytes, exists });
    }
    for (const id of plan.urlOnlyImageIds) {
        builder.add(id, 'preserved', 'External image kept as a URL in the folder record.');
    }
    return {
        plan,
        overwrites: items.filter((item) => item.exists).map((item) => item.path),
        targetNonEmpty: existingFiles.size > 0,
        toWrite: items.length,
        run: async (onProgress) => {
            for (const dir of plan.directories) {
                await input.folder.createDirectory(dir);
            }
            let done = 0;
            for (const item of items) {
                try {
                    await input.folder.writeBytes(item.path, item.bytes);
                    builder.add(item.path, item.exists ? 'updated' : 'created');
                } catch (error) {
                    builder.add(item.path, 'warning', `Write failed: ${error instanceof Error ? error.message : String(error)}`);
                }
                done += 1;
                onProgress?.(done, items.length);
                if (done % YIELD_EVERY === 0) {
                    await yieldToEventLoop();
                }
            }
            return builder.finish();
        },
    };
}
