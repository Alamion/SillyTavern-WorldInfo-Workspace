import { describe, expect, it } from 'vitest';
import { SAMPLE_DATASET, type SampleFolderNode } from '../../src/core/sample/dataset';
import {
    buildNodeIndex,
    createEntry,
    createFolder,
    createImage,
    deleteNode,
    duplicateNode,
    matchesFilter,
    moveNode,
    sortChildrenRecursively,
    type FilterKind,
} from '../../src/core/sample/tree';

const clone = (): SampleFolderNode => structuredClone(SAMPLE_DATASET.root);
const index = buildNodeIndex(SAMPLE_DATASET.root);

describe('sortChildrenRecursively', () => {
    it('sorts entries by title ascending', () => {
        const root = clone();
        sortChildrenRecursively(root, 'title');
        const cities = (index.get('cities') as SampleFolderNode) && root;
        const sandbox = root.children.find((n) => n.id === 'sandbox') as SampleFolderNode;
        const names = sandbox.children.map((c) => c.name);
        expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names);
        expect(cities).toBeDefined();
    });

    it('sorts entries by order descending', () => {
        const root = clone();
        const marches = buildNodeIndex(root).get('marches-root') as SampleFolderNode;
        sortChildrenRecursively(root, 'order');
        const orders = marches.children
            .filter((n) => n.kind === 'entry')
            .map((n) => (n.kind === 'entry' ? n.fields.order : 0));
        const sorted = [...orders].sort((a, b) => b - a);
        expect(orders).toEqual(sorted);
    });

    it('keeps custom order untouched', () => {
        const root = clone();
        const before = JSON.stringify(root);
        sortChildrenRecursively(root, 'custom');
        expect(JSON.stringify(root)).toBe(before);
    });
});

describe('moveNode', () => {
    it('moves an entry between folders', () => {
        const root = clone();
        const moved = moveNode(root, 'card-verdant-span', 'factions');
        expect(moved).not.toBeNull();
        const factions = buildNodeIndex(root).get('factions') as SampleFolderNode;
        expect(factions.children.some((n) => n.id === 'card-verdant-span')).toBe(true);
        expect(moveNode(root, 'card-verdant-span', 'factions')?.id).toBe('workspace-root');
    });

    it('rejects moving a folder into itself and moving the root', () => {
        const root = clone();
        expect(moveNode(root, 'geography', 'cities')).toBeNull();
        expect(moveNode(root, 'workspace-root', 'cities')).toBeNull();
    });
});

describe('matchesFilter', () => {
    const kinds = new Set<FilterKind>(['folders', 'wiFolders', 'entries', 'images']);
    const entry = index.get('card-verdant-span');
    const image = index.get('img-map');

    it('filters by kind', () => {
        const entriesOnly = new Set<FilterKind>(['entries']);
        expect(entry ? matchesFilter(entry, entriesOnly, '', 'title') : false).toBe(true);
        expect(image ? matchesFilter(image, entriesOnly, '', 'title') : false).toBe(false);
    });

    it('searches by title and by prompt depending on scope', () => {
        expect(entry ? matchesFilter(entry, kinds, 'verdant', 'title') : false).toBe(true);
        expect(entry ? matchesFilter(entry, kinds, 'charcoal', 'title') : false).toBe(false);
        expect(entry ? matchesFilter(entry, kinds, 'charcoal', 'prompt') : false).toBe(true);
        expect(entry ? matchesFilter(entry, kinds, 'charcoal', 'title+prompt') : false).toBe(true);
    });
});

describe('create helpers', () => {
    it('creates a folder, entry and image inside the target folder', () => {
        const root = clone();
        const folder = createFolder(root, 'factions', 'Created Folder');
        expect(folder).not.toBeNull();
        const entry = createEntry(root, folder?.id ?? '', 'Created Entry');
        expect(entry).not.toBeNull();
        expect(entry?.fields.comment).toBe('Created Entry');
        expect(entry?.fields.uid).toBeGreaterThan(0);
        const image = createImage(root, folder?.id ?? '', 'Created Image');
        expect(image).not.toBeNull();
        const factions2 = buildNodeIndex(root).get('factions') as SampleFolderNode;
        const created = factions2.children.find((n) => n.id === folder?.id) as SampleFolderNode;
        expect(created?.children).toHaveLength(2);
    });

    it('rejects creation outside folders', () => {
        const root = clone();
        expect(createEntry(root, 'card-bristlemark', 'X')).toBeNull();
    });
});

describe('duplicateNode', () => {
    it('duplicates an entry right after the original with a fresh uid', () => {
        const root = clone();
        const copy = duplicateNode(root, 'card-bristlemark');
        expect(copy).not.toBeNull();
        expect(copy?.name).toBe('Bristlemark (copy)');
        const cities = buildNodeIndex(root).get('cities') as SampleFolderNode;
        const at = cities.children.findIndex((n) => n.id === 'card-bristlemark');
        expect(cities.children[at + 1]?.id).toBe(copy?.id);
        if (copy?.kind === 'entry') {
            expect(copy.fields.uid).not.toBe(0);
            expect(copy.fields.comment).toBe('Bristlemark (copy)');
        }
    });

    it('refuses to duplicate folders and the root', () => {
        const root = clone();
        expect(duplicateNode(root, 'cities')).toBeNull();
        expect(duplicateNode(root, 'workspace-root')).toBeNull();
    });
});

describe('deleteNode', () => {
    it('removes a node from its parent', () => {
        const root = clone();
        expect(deleteNode(root, 'card-verdant-span')).toBe(true);
        expect(buildNodeIndex(root).has('card-verdant-span')).toBe(false);
    });

    it('refuses to delete the root', () => {
        const root = clone();
        expect(deleteNode(root, 'workspace-root')).toBe(false);
    });
});
