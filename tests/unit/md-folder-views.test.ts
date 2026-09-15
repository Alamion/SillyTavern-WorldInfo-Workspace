import { describe, expect, it } from 'vitest';
import { listTopLevel, selectTopLevel, wrapAsDirectory } from '../../src/core/md/folderViews';
import { planImport } from '../../src/core/md/importPlan';
import { scanFolder } from '../../src/core/md/scan';
import { createDefaultState } from '../../src/core/state/schema';
import { MemoryDiskFolder, nodeDigest as digest, nodeYaml as yaml } from '../support/memoryDisk';

function vault(): MemoryDiskFolder {
    const folder = new MemoryDiskFolder();
    folder.writeText('.wiw-folder.yaml', 'wi_root: true\nwi_book: Whole\n');
    folder.writeText('Realm/City.md', 'City');
    folder.writeText('Notes/Todo.md', 'Todo');
    folder.writeText('Loose.md', 'Loose');
    folder.writeText('.obsidian/app.json', '{}');
    folder.writeText('doc.pdf', 'PDF');
    return folder;
}

async function importNames(folder: Parameters<typeof scanFolder>[0]) {
    const state = createDefaultState();
    let n = 0;
    const plan = planImport({
        scan: await scanFolder(folder, { digest, yaml }),
        state,
        targetFolderId: state.root.id,
        newId: () => `id${n++}`,
        placeholderUid: () => 900000 + n,
        acceptsUpload: () => false,
    });
    return plan;
}

describe('import folder views', () => {
    it('lists importable top-level items', async () => {
        expect(await listTopLevel(vault())).toEqual([
            { name: 'Notes', kind: 'folder' },
            { name: 'Realm', kind: 'folder' },
            { name: 'Loose.md', kind: 'entry' },
        ]);
    });

    it('imports the picked folder itself as one folder, with its own record', async () => {
        const plan = await importNames(wrapAsDirectory(vault(), '123'));
        expect(plan.nodes.map((node) => node.name)).toEqual(['123']);
        const top = plan.nodes[0]!;
        expect(top.kind === 'folder' ? top.children.map((child) => child.name) : []).toEqual(['Notes', 'Realm', 'Loose']);
        expect(plan.rootRequests).toEqual([{ folderId: top.id, bookName: 'Whole' }]);
    });

    it('imports only the chosen top-level folders, each as its own folder', async () => {
        const plan = await importNames(selectTopLevel(vault(), new Set(['Realm', 'Notes'])));
        expect(plan.nodes.map((node) => node.name)).toEqual(['Notes', 'Realm']);
        expect(plan.rootRequests).toEqual([]);
    });
});
