import { describe, expect, it } from 'vitest';
import { runImport } from '../../src/adapters/mdImport';
import { createFilesFolder } from '../../src/core/md/filesFolder';
import { createDefaultState, type FolderNode } from '../../src/core/state/schema';
import { WorkspaceStore } from '../../src/core/state/store';
import { MemoryDiskFolder, MemoryImageStore, nodeDigest as digest, nodeYaml as yaml } from '../support/memoryDisk';

let seq = 0;

function deps(folder: MemoryDiskFolder, overrides: { imageStore?: MemoryImageStore } = {}) {
    const store = new WorkspaceStore(createDefaultState());
    const imageStore = overrides.imageStore ?? new MemoryImageStore();
    const designated: Array<{ folderId: string; bookName: string | undefined }> = [];
    return {
        store,
        imageStore,
        designated,
        run: () =>
            runImport({
                folder,
                store,
                targetFolderId: store.getState().root.id,
                yaml,
                digest,
                imageStore,
                newId: () => `n${++seq}`,
                placeholderUid: () => 900000 + ++seq,
                designate: async (folderId, bookName) => {
                    designated.push({ folderId, bookName });
                },
            }),
    };
}

describe('import runner (US2)', () => {
    it('adds the folder contents to the target, stores images, restores roots, never writes to disk', async () => {
        const folder = new MemoryDiskFolder();
        folder.writeText('Kingdoms/.wiw-folder.yaml', 'wi_root: true\nwi_book: Kingdoms East\n');
        folder.writeText('Kingdoms/Aldermeer.md', '---\nwi_keys: [river]\n---\n\nRiver city.');
        folder.writeText('Kingdoms/crest.svg', '<svg/>');
        await folder.writeBytes('Kingdoms/map.png', new Uint8Array([1, 2, 3]));
        folder.resetLog();
        const before = folder.snapshot();
        const ctx = deps(folder);
        let notified = 0;
        ctx.store.subscribe(() => (notified += 1));

        const { report, addedIds } = await ctx.run();

        expect(notified).toBe(1);
        const root = ctx.store.getState().root;
        expect(root.children.map((child) => child.id)).toEqual(addedIds);
        const kingdoms = root.children[0] as FolderNode;
        expect(kingdoms.name).toBe('Kingdoms');
        expect(kingdoms.children.map((child) => child.name)).toEqual(['Aldermeer', 'crest', 'map']);
        const map = kingdoms.children.find((child) => child.name === 'map');
        expect(map?.kind === 'image' ? map.src : '').toMatch(/^user\/images\/WorldInfoWorkspace\/map-\d+\.png$/);
        const crest = kingdoms.children.find((child) => child.name === 'crest');
        expect(crest?.kind === 'image' ? crest.src : '').toMatch(/^data:image\/svg\+xml;base64,/);
        expect(ctx.designated).toEqual([{ folderId: kingdoms.id, bookName: 'Kingdoms East' }]);
        expect(kingdoms.isWiRoot).toBe(false); // designation happens only through the flow
        expect(report.counts.created).toBe(3);
        expect(folder.writes).toEqual([]);
        expect(folder.snapshot()).toEqual(before);
    });

    it('falls back to embedding when the image storage refuses an upload', async () => {
        const folder = new MemoryDiskFolder();
        await folder.writeBytes('p.png', new Uint8Array([9]));
        const failing = new MemoryImageStore();
        failing.upload = async () => {
            throw new Error('Invalid image format');
        };
        const ctx = deps(folder, { imageStore: failing });
        const { report } = await ctx.run();
        const image = ctx.store.getState().root.children[0];
        expect(image?.kind === 'image' ? image.src : '').toBe('data:image/png;base64,CQ==');
        expect(report.lines.some((line) => line.path === 'p.png' && line.outcome === 'warning')).toBe(true);
    });

    it('imports individually picked files into the target', async () => {
        const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
        const folder = createFilesFolder([
            { name: 'Dragon.md', bytes: encode('---\nwi_keys: [dragon]\n---\n\nScales.') },
            { name: 'Dragon.md', bytes: encode('Second note with the same file name.') },
            { name: 'portrait.png', bytes: new Uint8Array([7, 7]) },
        ]);
        const ctx = deps(folder as unknown as MemoryDiskFolder);
        const { report, addedIds } = await ctx.run();
        const root = ctx.store.getState().root;
        expect(addedIds).toHaveLength(3);
        expect(root.children.map((child) => child.name).sort()).toEqual(['Dragon', 'Dragon (2)', 'portrait']);
        const dragon = root.children.find((child) => child.name === 'Dragon');
        expect(dragon?.kind === 'entry' ? dragon.native.key : []).toEqual(['dragon']);
        expect(report.counts.created).toBe(3);
    });
});
