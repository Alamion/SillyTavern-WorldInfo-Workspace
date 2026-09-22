import { describe, expect, it } from 'vitest';

import { createCancelSource, isCancellation, OperationCancelled } from '../../src/core/md/cancel';
import { scanFolder } from '../../src/core/md/scan';
import { MemoryDiskFolder, nodeDigest, nodeYaml } from '../support/memoryDisk';

/**
 * Cancellation of long disk operations (spec 006 FR-003).
 *
 * Only READ phases are cancellable — a scan has written nothing, so stopping it
 * leaves no trace. Writing phases are declared uninterruptible instead, which is
 * why `MdBusy.cancel` is absent while they run.
 */

async function folderWith(fileCount: number): Promise<MemoryDiskFolder> {
    const folder = new MemoryDiskFolder();
    for (let index = 0; index < fileCount; index += 1) {
        await folder.writeText(`note-${index}.md`, `---\nwi_key: [k${index}]\n---\nbody ${index}`);
    }
    return folder;
}

describe('createCancelSource', () => {
    it('starts uncancelled and throws only after cancel', () => {
        const source = createCancelSource();
        expect(source.token.cancelled).toBe(false);
        expect(() => source.token.throwIfCancelled()).not.toThrow();
        source.cancel();
        expect(source.token.cancelled).toBe(true);
        expect(() => source.token.throwIfCancelled()).toThrow(OperationCancelled);
    });

    it('recognises its own cancellation but not other errors', () => {
        expect(isCancellation(new OperationCancelled())).toBe(true);
        expect(isCancellation(new Error('disk on fire'))).toBe(false);
        expect(isCancellation(null)).toBe(false);
    });
});

describe('scanFolder cancellation', () => {
    it('completes normally when never cancelled', async () => {
        const folder = await folderWith(5);
        const source = createCancelSource();
        const scan = await scanFolder(folder, {
            digest: nodeDigest,
            yaml: nodeYaml,
            cancel: source.token,
        });
        expect(scan.entries).toHaveLength(5);
    });

    it('stops once cancellation is requested mid-scan', async () => {
        const folder = await folderWith(40);
        const source = createCancelSource();
        let seen = 0;
        await expect(
            scanFolder(folder, {
                digest: nodeDigest,
                yaml: nodeYaml,
                cancel: source.token,
                onProgress: (done) => {
                    seen = done;
                    if (done >= 5) {
                        source.cancel();
                    }
                },
                yieldNow: () => Promise.resolve(),
            })
        ).rejects.toThrow(OperationCancelled);
        // It stopped early rather than reading everything.
        expect(seen).toBeLessThan(40);
    });

    it('is a no-op when the token is never passed', async () => {
        const folder = await folderWith(3);
        const scan = await scanFolder(folder, { digest: nodeDigest, yaml: nodeYaml });
        expect(scan.entries).toHaveLength(3);
    });
});
