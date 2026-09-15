import { describe, expect, it } from 'vitest';
import { DiskError, type DiskFolder } from '../../src/core/md/ports';
import { MemoryDiskFolder } from '../support/memoryDisk';

/**
 * Port guarantees of contracts/disk-port.md. Exported so every DiskFolder
 * implementation runs the same suite; jsdom has no File System Access API, so the
 * FSA implementation is exercised live (quickstart S1–S11).
 */
export function runDiskPortSuite(
    name: string,
    factory: () => { folder: DiskFolder; failNextWrite(): void }
): void {
    const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
    const text = (data: Uint8Array): string => new TextDecoder().decode(data);

    describe(`DiskFolder contract — ${name}`, () => {
        it('1. round-trips bytes and keeps previous content on a failed write', async () => {
            const { folder, failNextWrite } = factory();
            await folder.writeBytes('a.md', bytes('one'));
            expect(text(await folder.readBytes('a.md'))).toBe('one');
            failNextWrite();
            await expect(folder.writeBytes('a.md', bytes('two'))).rejects.toBeInstanceOf(DiskError);
            expect(text(await folder.readBytes('a.md'))).toBe('one');
        });

        it('2. creates missing parent directories', async () => {
            const { folder } = factory();
            await folder.writeBytes('a/b/c.md', bytes('x'));
            const listed = await folder.list();
            expect(listed).toEqual(
                expect.arrayContaining([
                    { path: 'a', kind: 'directory' },
                    { path: 'a/b', kind: 'directory' },
                    { path: 'a/b/c.md', kind: 'file' },
                ])
            );
        });

        it('3. removes directories recursively; missing paths are a no-op', async () => {
            const { folder } = factory();
            await folder.writeBytes('d/e/f.md', bytes('x'));
            await folder.writeBytes('d/g.md', bytes('y'));
            await folder.remove('d');
            expect(await folder.list()).toEqual([]);
            await expect(folder.remove('missing/path.md')).resolves.toBeUndefined();
        });

        it('4. lists every descendant once with / separators', async () => {
            const { folder } = factory();
            await folder.writeBytes('x/1.md', bytes('1'));
            await folder.writeBytes('x/2.md', bytes('2'));
            await folder.createDirectory('empty');
            const paths = (await folder.list()).map((entry) => entry.path).sort();
            expect(paths).toEqual(['empty', 'x', 'x/1.md', 'x/2.md']);
            expect(new Set(paths).size).toBe(paths.length);
        });

        it('5. rejects paths that could escape the folder', async () => {
            const { folder } = factory();
            for (const bad of ['../a.md', '/a.md', 'a//b.md', 'a\\b.md', '']) {
                await expect(folder.writeBytes(bad, bytes('x'))).rejects.toMatchObject({ code: 'invalid-path' });
            }
        });

        it('6. reports a missing file as not-found', async () => {
            const { folder } = factory();
            await expect(folder.readBytes('nope.md')).rejects.toMatchObject({ code: 'not-found', path: 'nope.md' });
        });
    });
}

runDiskPortSuite('MemoryDiskFolder', () => {
    const folder = new MemoryDiskFolder();
    return {
        folder,
        failNextWrite: () => folder.failOnWrite(1),
    };
});
