import { describe, expect, it } from 'vitest';
import { planImport } from '../../src/core/md/importPlan';
import { planExport } from '../../src/core/md/exportPlan';
import { scanFolder } from '../../src/core/md/scan';
import { decodeDataUri } from '../../src/core/md/dataUri';
import { createDefaultState, type FolderNode, type TreeNode } from '../../src/core/state/schema';
import { MemoryDiskFolder, nodeDigest as digest, nodeYaml as yaml } from '../support/memoryDisk';
import { sampleState } from '../support/mdFixtures';

let idSeq = 0;
const newId = (): string => `id-${++idSeq}`;
let uidSeq = 900000;
const placeholderUid = (): number => ++uidSeq;

async function exportToDisk(scopeId?: string): Promise<{ folder: MemoryDiskFolder; source: FolderNode }> {
    const state = sampleState();
    const scopeFolderId = scopeId ?? state.root.id;
    const plan = planExport({ state, scopeFolderId, yaml })!;
    const folder = new MemoryDiskFolder();
    for (const file of plan.files) {
        if (file.kind === 'image') {
            await folder.writeBytes(file.path, decodeDataUri(file.src)!.bytes);
        } else {
            folder.writeText(file.path, file.text);
        }
    }
    const source = (scopeId ? state.root.children.find((child) => child.id === scopeId) : state.root) as FolderNode;
    return { folder, source };
}

/** Structure without ids, uids, timestamps, sync, or designations (checked separately). */
function shape(node: TreeNode): unknown {
    if (node.kind === 'folder') {
        return { kind: 'folder', name: node.name, md: node.md, children: node.children.map(shape) };
    }
    if (node.kind === 'entry') {
        const native: Partial<typeof node.native> = { ...node.native };
        delete native.uid;
        delete native.displayIndex;
        return { kind: 'entry', name: node.name, native, md: node.md };
    }
    const bytes = node.src.startsWith('data:') ? [...decodeDataUri(node.src)!.bytes] : node.src;
    return { kind: 'image', name: node.name, caption: node.caption, bytes };
}

describe('planImport (US2)', () => {
    it('reproduces an exported workspace except ids (SC-001)', async () => {
        const { folder, source } = await exportToDisk();
        const scan = await scanFolder(folder, { digest, yaml });
        const state = createDefaultState();
        const plan = planImport({
            scan,
            state,
            targetFolderId: state.root.id,
            newId,
            placeholderUid,
            acceptsUpload: () => false,
        });
        expect(plan.nodes.map(shape)).toEqual(source.children.map(shape));
        expect(plan.rootRequests.map((request) => request.bookName).sort()).toEqual(['Houses Book', 'Kingdoms East']);
        expect(plan.nodes.every((node) => node.parentId === state.root.id)).toBe(true);
        // Custom order restored from wi_order (URL-only images included).
        const kingdoms = plan.nodes[0] as FolderNode;
        expect(kingdoms.children.map((child) => child.name)).toEqual([
            'House Varn',
            'Aldermeer',
            'Aldermeer map',
            'Crest',
            'Remote portrait',
            'Houses',
        ]);
    });

    it('imports the contents of the picked folder into the target, not a wrapper folder', async () => {
        const folder = new MemoryDiskFolder();
        folder.writeText('b.md', 'B');
        folder.writeText('A.md', 'A');
        folder.writeText('Sub/c.md', 'C');
        const scan = await scanFolder(folder, { digest, yaml });
        const state = createDefaultState();
        const plan = planImport({ scan, state, targetFolderId: state.root.id, newId, placeholderUid, acceptsUpload: () => true });
        expect(plan.nodes.map((child) => child.name)).toEqual(['Sub', 'A', 'b']);
        expect(plan.rootRequests).toEqual([]);
        expect(plan.uploads).toEqual([]);
        expect(new Set([...plan.idsByPath.values()]).size).toBe(plan.idsByPath.size);
    });

    it('requests uploads for accepted formats and embeds the rest', async () => {
        const folder = new MemoryDiskFolder();
        await folder.writeBytes('p.png', new Uint8Array([1, 2]));
        folder.writeText('v.svg', '<svg/>');
        const scan = await scanFolder(folder, { digest, yaml });
        const state = createDefaultState();
        const plan = planImport({
            scan,
            state,
            targetFolderId: state.root.id,
            newId,
            placeholderUid,
            acceptsUpload: (ext) => ext === 'png',
        });
        expect(plan.uploads.map((upload) => upload.path)).toEqual(['p.png']);
        const svg = plan.nodes.find((child) => child.name === 'v');
        expect(svg?.kind === 'image' ? svg.src : '').toMatch(/^data:image\/svg\+xml;base64,/);
    });

    it('honors an unused wi_id hint and replaces a taken one', async () => {
        const folder = new MemoryDiskFolder();
        folder.writeText('free.md', '---\nwi_id: free-id\n---\n\nx');
        folder.writeText('taken.md', '---\nwi_id: workspace-root\n---\n\ny');
        const scan = await scanFolder(folder, { digest, yaml });
        const state = createDefaultState();
        const plan = planImport({ scan, state, targetFolderId: state.root.id, newId, placeholderUid, acceptsUpload: () => true });
        expect(plan.idsByPath.get('free.md')).toBe('free-id');
        expect(plan.idsByPath.get('taken.md')).not.toBe('workspace-root');
        expect(plan.lines.some((line) => line.path === 'taken.md' && line.outcome === 'warning')).toBe(true);
    });
});
