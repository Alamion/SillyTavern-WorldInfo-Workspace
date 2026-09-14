import { describe, expect, it } from 'vitest';
import {
    createDefaultState,
    createEntryNode,
    createFolderNode,
    findNode,
    type WorkspaceState,
} from '../../src/core/state/schema';
import {
    bulkDeleteNodes,
    bulkMoveNodes,
    bulkSetDisable,
    createChild,
    deleteSubtree,
    moveNode,
    renameNode,
    reorderChild,
} from '../../src/core/tree/operations';

const NOW = '2026-09-08T00:00:00.000Z';

/** createChild/renameNode return null on rejection; tests assert success paths. */
function expectState(next: WorkspaceState | null): WorkspaceState {
    if (!next) {
        throw new Error('expected a successful operation');
    }
    return next;
}

interface Fixture {
    state: WorkspaceState;
    folderA: string;
    folderB: string;
    entryA: string;
}

function freshState(): WorkspaceState {
    return createDefaultState();
}

/** root > A (entry a1, folder deep > (entry ad)) and B (entry b1) */
function fixture(): Fixture {
    const state = freshState();
    const a = createFolderNode({ id: 'A', parentId: state.root.id, name: 'Alpha', now: NOW });
    const b = createFolderNode({ id: 'B', parentId: state.root.id, name: 'Beta', now: NOW });
    const eA = createEntryNode({ id: 'a1', parentId: 'A', name: 'Alpha entry', now: NOW, nativeUid: 1 });
    const deep = createFolderNode({ id: 'deep', parentId: 'A', name: 'Deep', now: NOW });
    const eDeep = createEntryNode({ id: 'ad', parentId: 'deep', name: 'Deep entry', now: NOW, nativeUid: 2 });
    const eB = createEntryNode({ id: 'b1', parentId: 'B', name: 'Beta entry', now: NOW, nativeUid: 3 });
    a.children.push(eA, deep);
    deep.children.push(eDeep);
    b.children.push(eB);
    state.root.children.push(a, b);
    return { state, folderA: 'A', folderB: 'B', entryA: 'a1' };
}

describe('tree operations: create', () => {
    it.each(['folder', 'entry', 'image'] as const)('creates a %s under any folder', (kind) => {
        const state = freshState();
        const parent = createFolderNode({ id: 'P', parentId: state.root.id, name: 'Parent', now: NOW });
        const nested = createFolderNode({ id: 'N', parentId: 'P', name: 'Nested', now: NOW });
        parent.children.push(nested);
        state.root.children.push(parent);

        const next = expectState(createChild(state, nested.id, kind, 'Item', () => 'new-id', 1));
        const node = findNode(next, 'new-id');
        expect(node).toBeDefined();
        expect(node?.parentId).toBe('N');
        expect(node?.name).toBe('Item');
    });

    it('trims names and requires non-empty after trim', () => {
        const state = freshState();
        const next = expectState(createChild(state, state.root.id, 'entry', '  Padded  ', () => 'e1'));
        expect(findNode(next, 'e1')?.name).toBe('Padded');
        expect(createChild(state, state.root.id, 'entry', '   ', () => 'e2')).toBeNull();
    });

    it('new entries carry a placeholder uid and a fresh sync state', () => {
        const state = freshState();
        const next = expectState(createChild(state, state.root.id, 'entry', 'E', () => 'e1'));
        const entry = findNode(next, 'e1');
        if (entry?.kind !== 'entry') {
            throw new Error('expected entry');
        }
        expect(typeof entry.native.uid).toBe('number');
        expect(Object.keys(entry.sync.books)).toEqual([]);
    });
});

describe('tree operations: move & reorder', () => {
    it('moves a node between folders and keeps content intact', () => {
        const fx = fixture();
        const next = expectState(moveNode(fx.state, fx.entryA, fx.folderB, 0));
        const moved = findNode(next, fx.entryA);
        expect(moved?.parentId).toBe(fx.folderB);
        if (moved?.kind === 'entry') {
            expect(moved.native.comment).toBe('Alpha entry');
            expect(moved.native.content).toBe('');
        }
    });

    it('rejects moving a folder into its own descendant', () => {
        const fx = fixture();
        expect(moveNode(fx.state, fx.folderA, 'deep')).toBeNull();
    });

    it('rejects moving the root', () => {
        const fx = fixture();
        expect(moveNode(fx.state, fx.state.root.id, fx.folderA)).toBeNull();
    });

    it('reorders children within a folder in custom mode', () => {
        const fx = fixture();
        const next = reorderChild(fx.state, fx.state.root.id, 1, 0);
        expect(next.root.children[0]?.id).toBe(fx.folderB);
    });

    it('bulk-moves multiple entries into a target folder', () => {
        const fx = fixture();
        const next = expectState(bulkMoveNodes(fx.state, [fx.entryA, 'ad'], fx.folderB));
        const target = findNode(next, fx.folderB);
        expect(target?.kind === 'folder' && target.children.some((c) => c.id === fx.entryA)).toBe(true);
        expect(target?.kind === 'folder' && target.children.some((c) => c.id === 'ad')).toBe(true);
    });

    it('bulk-moves a block in tree order at the drop index', () => {
        const fx = fixture();
        // Selection order differs from tree order; b1 sits at index 0 of B.
        const next = expectState(bulkMoveNodes(fx.state, ['ad', fx.entryA], fx.folderB, 0));
        const target = findNode(next, fx.folderB);
        expect(target?.kind === 'folder' && target.children.map((c) => c.id)).toEqual(['a1', 'ad', 'b1']);
        expect(findNode(next, 'ad')?.parentId).toBe(fx.folderB);
    });

    it('keeps nodes nested in a moved folder inside it', () => {
        const fx = fixture();
        const next = expectState(bulkMoveNodes(fx.state, ['deep', 'ad'], fx.folderB));
        const deep = findNode(next, 'deep');
        expect(deep?.parentId).toBe(fx.folderB);
        expect(deep?.kind === 'folder' && deep.children.map((c) => c.id)).toEqual(['ad']);
    });

    it('rejects a bulk move into a folder that is part of the block', () => {
        const fx = fixture();
        expect(bulkMoveNodes(fx.state, [fx.folderA, fx.folderB], 'deep')).toBeNull();
    });
});

describe('tree operations: rename & delete', () => {
    it('renames and trims; syncs entry comment (name ↔ comment single source)', () => {
        const fx = fixture();
        const next = expectState(renameNode(fx.state, fx.entryA, '  Renamed  '));
        const node = findNode(next, fx.entryA);
        expect(node?.name).toBe('Renamed');
        if (node?.kind === 'entry') {
            expect(node.native.comment).toBe('Renamed');
        }
        expect(renameNode(fx.state, fx.entryA, '   ')).toBeNull();
    });

    it('deletes a subtree; the root cannot be deleted', () => {
        const fx = fixture();
        const next = deleteSubtree(fx.state, fx.folderA);
        expect(findNode(next, fx.folderA)).toBeUndefined();
        expect(findNode(next, 'deep')).toBeUndefined();
        expect(findNode(next, fx.folderB)).toBeDefined();
        expect(deleteSubtree(fx.state, fx.state.root.id).root.children).toHaveLength(2);
    });

    it('bulk-deletes multiple subtrees', () => {
        const fx = fixture();
        const next = bulkDeleteNodes(fx.state, [fx.folderA, 'b1']);
        expect(findNode(next, fx.folderA)).toBeUndefined();
        expect(findNode(next, 'ad')).toBeUndefined();
        expect(findNode(next, fx.folderB)).toBeDefined();
    });

    it('bulk enable/disable applies to entries only', () => {
        const fx = fixture();
        const next = bulkSetDisable(fx.state, [fx.entryA, fx.folderA], true);
        const entry = findNode(next, fx.entryA);
        expect(entry?.kind === 'entry' && entry.native.disable).toBe(true);
        const folder = findNode(next, fx.folderA);
        expect(folder?.kind === 'folder' && folder.children.length).toBeGreaterThan(0);
    });

    it('bulk enable/disable marks every book copy dirty so the books are pushed', () => {
        const fx = fixture();
        const entry = findNode(fx.state, fx.entryA);
        if (entry?.kind !== 'entry') {
            throw new Error('expected entry');
        }
        entry.sync.books = {
            One: { uid: 1, hash: 'h', status: 'in-sync' },
            Two: { uid: 7, hash: 'h', status: 'in-sync' },
        };
        const next = bulkSetDisable(fx.state, [fx.entryA], true);
        const updated = findNode(next, fx.entryA);
        expect(updated?.kind === 'entry' && Object.values(updated.sync.books).map((b) => b.status)).toEqual([
            'dirty',
            'dirty',
        ]);
        // No-op toggles leave the books untouched.
        const again = bulkSetDisable(next, [fx.entryA], true);
        expect(again).toEqual(next);
    });
});