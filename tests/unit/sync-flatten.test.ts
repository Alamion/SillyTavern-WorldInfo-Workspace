import { describe, expect, it } from 'vitest';
import type { WorldInfoBook } from '../../src/global';
import {
    createDefaultState,
    createEntryNode,
    createFolderNode,
    createImageNode,
    findNode,
    type WorkspaceState,
} from '../../src/core/state/schema';
import { flattenRoot } from '../../src/core/sync/flatten';

const NOW = '2026-09-08T00:00:00.000Z';

function emptyBook(): WorldInfoBook {
    return { entries: {} };
}

function allocateLowest(used: ReadonlySet<number>): number {
    for (let uid = 0; uid < 1000000; uid++) {
        if (!used.has(uid)) {
            return uid;
        }
    }
    return 999999;
}

/**
 * root > R (WI root 'Aldermeer') > entry e1 (book uid 5), image img1
 * (workspace-only), folder N (WI root 'InnerRoot') > entry e2 (InnerRoot uid 2).
 */
function designatedFixture(): WorkspaceState {
    const state = createDefaultState();
    const root = createFolderNode({ id: 'R', parentId: state.root.id, name: 'Aldermeer', now: NOW });
    root.isWiRoot = true;
    root.book = { bookName: 'Aldermeer', orphans: [] };
    const entry = createEntryNode({ id: 'e1', parentId: 'R', name: 'Riverborn', now: NOW, nativeUid: 5 });
    entry.sync.books['Aldermeer'] = { uid: 5, hash: null, status: 'in-sync' };
    entry.native.comment = 'Riverborn';
    const image = createImageNode({ id: 'img1', parentId: 'R', name: 'Map', now: NOW });
    image.src = 'https://x/map.png';
    image.caption = 'The Verdant Span';
    const nested = createFolderNode({ id: 'N', parentId: 'R', name: 'Inner root', now: NOW });
    nested.isWiRoot = true;
    nested.book = { bookName: 'InnerRoot', orphans: [] };
    const nestedEntry = createEntryNode({ id: 'e2', parentId: 'N', name: 'Shared', now: NOW, nativeUid: 9 });
    nestedEntry.sync.books['InnerRoot'] = { uid: 2, hash: null, status: 'in-sync' };
    root.children.push(entry, image, nested);
    nested.children.push(nestedEntry);
    state.root.children.push(root);
    return state;
}

describe('flattenRoot (FR-013/FR-14; entries only — images are workspace-only)', () => {
    it('produces an entries-keyed payload with stable per-book uids', () => {
        const state = designatedFixture();
        const result = flattenRoot({
            state,
            rootId: 'R',
            bookName: 'Aldermeer',
            existingBook: emptyBook(),
            orphans: [],
            allocateUid: allocateLowest,
        });
        const byNode = new Map(result.exported.map((row) => [row.nodeId, row.uid]));
        expect(byNode.get('e1')).toBe(5);
        const uids = Object.values(result.entries).map((entry) => entry.uid);
        expect(new Set(uids).size).toBe(uids.length);
        expect(Object.keys(result.entries).sort()).toEqual(uids.map(String).sort());
    });

    it('sets comment from the node name and unique displayIndex values', () => {
        const state = designatedFixture();
        const result = flattenRoot({
            state,
            rootId: 'R',
            bookName: 'Aldermeer',
            existingBook: emptyBook(),
            orphans: [],
            allocateUid: allocateLowest,
        });
        const exported = new Map(
            result.exported.map((row) => [row.nodeId, result.entries[String(row.uid)]!])
        );
        expect(exported.get('e1')?.comment).toBe('Riverborn');
        const indexes = result.exported.map((row) => exported.get(row.nodeId)?.displayIndex ?? -1);
        expect(indexes.every((value) => value >= 0)).toBe(true);
        expect(new Set(indexes).size).toBe(indexes.length);
    });

    it('excludes images from the export (workspace-only items)', () => {
        const state = designatedFixture();
        const result = flattenRoot({
            state,
            rootId: 'R',
            bookName: 'Aldermeer',
            existingBook: emptyBook(),
            orphans: [],
            allocateUid: allocateLowest,
        });
        expect(result.exported.map((row) => row.nodeId).sort()).toEqual(['e1', 'e2']);
    });

    it('keeps orphaned native entries in the output (FR-018 retention)', () => {
        const state = designatedFixture();
        const retained = {
            ...structuredClone(
                createEntryNode({ id: 't', parentId: 'r', name: 'x', now: NOW, nativeUid: 42 }).native
            ),
            uid: 42,
            comment: 'Old Roads',
        } as WorldInfoBook['entries'][string];
        const result = flattenRoot({
            state,
            rootId: 'R',
            bookName: 'Aldermeer',
            existingBook: { entries: { '42': retained } },
            orphans: [{ uid: 42, name: 'Old Roads' }],
            allocateUid: allocateLowest,
        });
        expect(result.entries['42']).toBeDefined();
        expect(result.exported.map((row) => row.uid)).not.toContain(42);
    });

    it('preserves unknown top-level book keys (e.g. originalData)', () => {
        const state = designatedFixture();
        const existing = { entries: {}, originalData: { keep: true } } as WorldInfoBook;
        const result = flattenRoot({
            state,
            rootId: 'R',
            bookName: 'Aldermeer',
            existingBook: existing,
            orphans: [],
            allocateUid: allocateLowest,
        });
        expect((result.book as { originalData?: unknown }).originalData).toEqual({ keep: true });
        expect(result.book.entries).toBeDefined();
    });

    it('skips invalid entities with a visible reason instead of exporting them', () => {
        const state = designatedFixture();
        const bad = findNode(state, 'e1');
        if (bad?.kind !== 'entry') {
            throw new Error('expected entry');
        }
        bad.native.probability = 200;
        const result = flattenRoot({
            state,
            rootId: 'R',
            bookName: 'Aldermeer',
            existingBook: emptyBook(),
            orphans: [],
            allocateUid: allocateLowest,
        });
        expect(result.skipped.map((row) => row.nodeId)).toContain('e1');
        expect(result.exported.map((row) => row.nodeId)).not.toContain('e1');
    });
});