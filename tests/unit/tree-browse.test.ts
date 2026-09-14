import { describe, expect, it } from 'vitest';
import {
    createEntryNode,
    createFolderNode,
    createImageNode,
    type TreeNode,
} from '../../src/core/state/schema';
import {
    filterKindsFor,
    matchesSearch,
    sortChildrenView,
    type BrowseFilter,
    type SortMode,
} from '../../src/core/tree/browse';

const NOW = '2026-09-08T00:00:00.000Z';

function makeEntry(
    id: string,
    name: string,
    fields: Partial<{ position: number; depth: number; order: number; probability: number; content: string }>
): TreeNode {
    const entry = createEntryNode({ id, parentId: 'f', name, now: NOW, nativeUid: 0 });
    entry.native.position = fields.position ?? 0;
    entry.native.depth = fields.depth ?? 4;
    entry.native.order = fields.order ?? 100;
    entry.native.probability = fields.probability ?? 100;
    entry.native.content = fields.content ?? '';
    return entry;
}

describe('sort modes', () => {
    const children: TreeNode[] = [
        createFolderNode({ id: 'f1', parentId: 'f', name: 'zeta', now: NOW }),
        makeEntry('e1', 'banana', { position: 2, depth: 3, order: 5, probability: 40 }),
        makeEntry('e2', 'apple', { position: 1, depth: 9, order: 50, probability: 80 }),
    ];

    it.each([
        ['custom', ['f1', 'e1', 'e2']],
        ['title', ['e2', 'e1', 'f1']],
        ['position', ['e1', 'e2', 'f1']],
        ['depth', ['e2', 'e1', 'f1']],
        ['order', ['e2', 'e1', 'f1']],
        ['trigger', ['e2', 'e1', 'f1']],
    ] as const)('sorts children by %s (folders last except custom)', (mode, expected) => {
        const view = sortChildrenView(children, mode as SortMode);
        expect(view.map((node) => node.id)).toEqual(expected);
    });

    it('never mutates the persisted order', () => {
        const orderBefore = children.map((node) => node.id).join(',');
        sortChildrenView(children, 'title');
        expect(children.map((node) => node.id).join(',')).toBe(orderBefore);
    });
});

describe('filters and search', () => {
    const plain = createFolderNode({ id: 'plain', parentId: 'f', name: 'Plain folder', now: NOW });
    const wf = createFolderNode({ id: 'wf', parentId: 'f', name: 'Rooted', now: NOW });
    wf.isWiRoot = true;
    const e1 = makeEntry('e1', 'Riverborn', { content: 'people of the Lowlands' });
    const i1 = createImageNode({ id: 'i1', parentId: 'f', name: 'Map', now: NOW });
    i1.caption = 'The Verdant Span';
    const tree: TreeNode[] = [plain, wf, e1, i1];

    it('filters by kind, treating WI folders separately from plain folders', () => {
        expect(filterKindsFor(new Set<BrowseFilter>(['folders']), tree).map((n) => n.id)).toEqual(['plain']);
        const result = filterKindsFor(new Set<BrowseFilter>(['wiFolders']), tree);
        expect(result.map((node) => node.id)).toEqual(['wf']);
    });

    it('searches title and prompt per scope', () => {
        expect(matchesSearch(e1, 'river', 'title')).toBe(true);
        expect(matchesSearch(e1, 'lowlands', 'title')).toBe(false);
        expect(matchesSearch(e1, 'lowlands', 'title+prompt')).toBe(true);
        expect(matchesSearch(i1, 'verdant', 'title+prompt')).toBe(true);
        expect(matchesSearch(e1, 'zzz', 'title+prompt')).toBe(false);
    });

    it('empty query matches everything', () => {
        expect(matchesSearch(plain, '', 'title')).toBe(true);
    });
});