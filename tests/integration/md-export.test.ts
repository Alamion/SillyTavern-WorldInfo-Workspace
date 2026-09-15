import { describe, expect, it } from 'vitest';
import { createImageResolver, prepareExport } from '../../src/adapters/mdExport';
import { MemoryDiskFolder, nodeDigest as digest, nodeYaml as yaml } from '../support/memoryDisk';
import { sampleState } from '../support/mdFixtures';

const offlineFetch = (async () => new Response(null, { status: 404 })) as typeof fetch;

async function exportTo(folder: MemoryDiskFolder, fetchFn = offlineFetch) {
    const state = sampleState();
    const preflight = await prepareExport({
        folder,
        state,
        scopeFolderId: state.root.id,
        yaml,
        digest,
        resolveImage: createImageResolver(fetchFn),
    });
    return preflight!;
}

describe('export runner (US1, FR-006/FR-007)', () => {
    it('writes every planned file and reports them', async () => {
        const folder = new MemoryDiskFolder();
        const preflight = await exportTo(folder);
        expect(preflight.targetNonEmpty).toBe(false);
        const report = await preflight.run();
        expect(folder.filePaths()).toContain('Kingdoms/Aldermeer.md');
        expect(folder.filePaths()).toContain('Kingdoms/Aldermeer map.png');
        expect(folder.readText('Kingdoms/Crest.svg')).toContain('<svg');
        expect(report.counts.created).toBe(folder.filePaths().length);
        expect(report.counts.preserved).toBe(1);
    });

    it('changes zero files on a repeated export (SC-005)', async () => {
        const folder = new MemoryDiskFolder();
        await (await exportTo(folder)).run();
        const before = folder.snapshot();
        folder.resetLog();
        const second = await exportTo(folder);
        expect(second.toWrite).toBe(0);
        const report = await second.run();
        expect(folder.writes).toEqual([]);
        expect(folder.snapshot()).toEqual(before);
        expect(report.counts.updated).toBe(0);
    });

    it('never touches files it does not produce and lists overwrites', async () => {
        const folder = new MemoryDiskFolder();
        folder.writeText('.obsidian/app.json', '{}');
        folder.writeText('notes.pdf', 'PDF');
        folder.writeText('Notes.md', 'old text');
        const preflight = await exportTo(folder);
        expect(preflight.targetNonEmpty).toBe(true);
        expect(preflight.overwrites).toEqual(['Notes.md']);
        await preflight.run();
        expect(folder.readText('.obsidian/app.json')).toBe('{}');
        expect(folder.readText('notes.pdf')).toBe('PDF');
        expect(folder.readText('Notes.md')).toBe('# Notes\nPlain.');
    });

    it('fetches same-origin images and warns when an image cannot be read', async () => {
        const folder = new MemoryDiskFolder();
        const state = sampleState();
        const kingdoms = state.root.children[0];
        if (kingdoms?.kind === 'folder') {
            const map = kingdoms.children.find((child) => child.id === 'map');
            if (map?.kind === 'image') {
                map.src = 'user/images/WorldInfoWorkspace/map-1.png';
            }
        }
        const requested: string[] = [];
        const fetchFn = (async (url: string) => {
            requested.push(url);
            return new Response(new Uint8Array([1, 2, 3]));
        }) as unknown as typeof fetch;
        const preflight = await prepareExport({
            folder,
            state,
            scopeFolderId: state.root.id,
            yaml,
            digest,
            resolveImage: createImageResolver(fetchFn),
        });
        await preflight!.run();
        expect(requested).toEqual(['/user/images/WorldInfoWorkspace/map-1.png']);
        expect([...(await folder.readBytes('Kingdoms/Aldermeer map.png'))]).toEqual([1, 2, 3]);

        const failing = await prepareExport({
            folder: new MemoryDiskFolder(),
            state,
            scopeFolderId: state.root.id,
            yaml,
            digest,
            resolveImage: createImageResolver(offlineFetch),
        });
        const report = await failing!.run();
        expect(report.lines.some((line) => line.path === 'Kingdoms/Aldermeer map.png' && line.outcome === 'warning')).toBe(true);
    });

    it('reports a failed write and completes the rest', async () => {
        const folder = new MemoryDiskFolder();
        const preflight = await exportTo(folder);
        folder.failOnWrite(2);
        const report = await preflight.run();
        expect(report.counts.warning).toBe(1);
        expect(report.counts.created).toBe(preflight.toWrite - 1);
    });
});
