import { describe, expect, it } from 'vitest';
import {
    buildNodeIndex,
    createDefaultState,
    createEntryNode,
    createFolderNode,
    createImageNode,
    deepValidateState,
    findNode,
    migrate,
    normalizeNativeEntry,
} from '../../src/core/state/schema';
import type { NativeWorldInfoEntry } from '../../src/global';
import { fingerprintEntry } from '../../src/core/sync/fingerprint';

const NOW = '2026-09-08T00:00:00.000Z';

describe('schema defaults', () => {
    it('creates a valid empty v1 state with a fixed root', () => {
        const state = createDefaultState();
        expect(state.version).toBe(1);
        expect(state.root.kind).toBe('folder');
        expect(state.root.parentId).toBeNull();
        expect(state.root.children).toEqual([]);
        expect(state.root.isWiRoot).toBe(false);
        expect(state.root.book).toBeNull();
        expect(state.settings.sortMode).toBe('custom');
    });

    it('entry factory carries the full native template and a fresh sync state', () => {
        const entry = createEntryNode({
            id: 'e1',
            parentId: 'workspace-root',
            name: 'Riverborn',
            now: NOW,
            nativeUid: 7,
        });
        expect(entry.kind).toBe('entry');
        expect(entry.native.uid).toBe(7);
        expect(entry.native.comment).toBe('Riverborn');
        expect(entry.native.probability).toBe(100);
        expect(entry.native.selective).toBe(true);
        expect(entry.native.order).toBe(100);
        expect(entry.native.position).toBe(0);
        expect(entry.native.depth).toBe(4);
        expect(entry.native.useProbability).toBe(true);
        expect(entry.native.extensions).toEqual({});
        expect(entry.sync.books).toEqual({});
    });

    it('image factory carries src/caption and never a book binding', () => {
        const image = createImageNode({
            id: 'i1',
            parentId: 'workspace-root',
            name: 'Map',
            now: NOW,
        });
        expect(image.src).toBe('');
        expect(image.caption).toBe('');
        expect(image.sync.books).toEqual({});
    });
});

describe('migrate', () => {
    it('passes a valid v1 payload through, preserving unknown keys', () => {
        const raw: Record<string, unknown> = JSON.parse(JSON.stringify(createDefaultState()));
        raw.futureKey = 'keep-me';
        (raw.settings as Record<string, unknown>).futureSetting = 42;
        const state = migrate(raw);
        expect((state as unknown as Record<string, unknown>).futureKey).toBe('keep-me');
        expect((state.settings as unknown as Record<string, unknown>).futureSetting).toBe(42);
        expect(state._recovered).toBeUndefined();
    });

    it('normalizes a valid state that carries unknown node keys', () => {
        const raw: Record<string, unknown> = JSON.parse(JSON.stringify(createDefaultState()));
        const entry = createEntryNode({ id: 'e1', parentId: raw.root ? 'workspace-root' : '', name: 'x', now: NOW, nativeUid: 1 });
        const root = raw.root as Record<string, unknown>;
        root.children = [JSON.parse(JSON.stringify(entry))];
        const state = migrate(raw);
        const restored = findNode(state, 'e1');
        expect(restored?.kind).toBe('entry');
        expect(deepValidateState(state)).toEqual([]);
    });

    it('recovers garbage input into a default state with the payload retained', () => {
        const state = migrate('not-a-workspace');
        expect(state.version).toBe(1);
        expect(state.root.children).toEqual([]);
        expect(state._recovered).toBe('not-a-workspace');
    });

    it('recovers when the payload is null and retains null under _recovered', () => {
        const state = migrate(null);
        expect(state.root.children).toEqual([]);
        expect(state._recovered).toBeNull();
    });

    it('recovers on structural violations: wrong version', () => {
        const raw = { ...JSON.parse(JSON.stringify(createDefaultState())), version: 99 };
        const state = migrate(raw);
        expect(state.version).toBe(1);
        expect(state._recovered).toEqual(raw);
    });

    it('recovers when a folder carries a book without the root designation', () => {
        const raw: Record<string, unknown> = JSON.parse(JSON.stringify(createDefaultState()));
        const root = raw.root as Record<string, unknown>;
        (root.children as unknown[]) = [
            {
                id: 'f1', parentId: 'workspace-root', kind: 'folder', name: 'Broken',
                createdAt: NOW, updatedAt: NOW, expanded: false,
                isWiRoot: false, book: { bookName: 'X', orphans: [] }, children: [],
            },
        ];
        const state = migrate(raw);
        expect(state._recovered).toEqual(raw);
    });

    it('recovers on duplicate ids or dangling parents', () => {
        const raw: Record<string, unknown> = JSON.parse(JSON.stringify(createDefaultState()));
        const root = raw.root as Record<string, unknown>;
        (root.children as unknown[]) = [
            { id: 'dup', parentId: 'workspace-root', kind: 'folder', name: 'A', createdAt: NOW, updatedAt: NOW, expanded: false, isWiRoot: false, book: null, children: [] },
            { id: 'dup', parentId: 'missing-parent', kind: 'folder', name: 'B', createdAt: NOW, updatedAt: NOW, expanded: false, isWiRoot: false, book: null, children: [] },
        ];
        const state = migrate(raw);
        expect(state._recovered).toEqual(raw);
    });

    it('rewrites stale parent links from the nesting instead of recovering', () => {
        const raw: Record<string, unknown> = JSON.parse(JSON.stringify(createDefaultState()));
        const folder = createFolderNode({ id: 'f1', parentId: 'stale-root', name: 'A', now: NOW });
        folder.children.push(createFolderNode({ id: 'f2', parentId: 'also-stale', name: 'B', now: NOW }));
        (raw.root as Record<string, unknown>).children = [JSON.parse(JSON.stringify(folder))];

        const state = migrate(raw);
        expect(state._recovered).toBeUndefined();
        expect(findNode(state, 'f1')?.parentId).toBe('workspace-root');
        expect(findNode(state, 'f2')?.parentId).toBe('f1');
    });

    it('recovers when an entry native payload is malformed', () => {
        const raw: Record<string, unknown> = JSON.parse(JSON.stringify(createDefaultState()));
        const root = raw.root as Record<string, unknown>;
        (root.children as unknown[]) = [
            { id: 'e1', parentId: 'workspace-root', kind: 'entry', name: 'E', createdAt: NOW, updatedAt: NOW, native: { uid: 'not-a-number' }, sync: null },
        ];
        const state = migrate(raw);
        expect(state._recovered).toEqual(raw);
    });

    it('fills missing sync state with defaults on import of legacy shapes', () => {
        const raw: Record<string, unknown> = JSON.parse(JSON.stringify(createDefaultState()));
        const entry = createEntryNode({ id: 'e1', parentId: 'workspace-root', name: 'E', now: NOW, nativeUid: 3 });
        const entryRaw = JSON.parse(JSON.stringify(entry)) as Record<string, unknown>;
        delete entryRaw.sync;
        (entryRaw as { native: { uid: number } }).native.uid = 3;
        const root = raw.root as Record<string, unknown>;
        (root.children as unknown[]) = [entryRaw];
        const state = migrate(raw);
        const restored = findNode(state, 'e1');
        expect(restored?.kind).toBe('entry');
        if (restored?.kind === 'entry') {
            expect(Object.keys(restored.sync.books)).toEqual([]);
        }
        expect(deepValidateState(state)).toEqual([]);
    });
});

describe('deepValidateState', () => {
    it('reports violations without mutating', () => {
        const state = createDefaultState();
        const folder = createFolderNode({ id: 'f1', parentId: 'workspace-root', name: 'F', now: NOW });
        const entry = createEntryNode({ id: 'e1', parentId: 'f1', name: 'E', now: NOW, nativeUid: 1 });
        folder.children.push(entry);
        state.root.children.push(folder);
        expect(deepValidateState(state)).toEqual([]);

        entry.name = '';
        const violations = deepValidateState(state);
        expect(violations.length).toBeGreaterThan(0);
        expect(violations.some((message) => message.includes('e1'))).toBe(true);
    });

    it('detects book bindings without designation (uid consistency is engine-managed)', () => {
        const state = createDefaultState();
        const folder = createFolderNode({ id: 'f1', parentId: 'workspace-root', name: 'F', now: NOW });
        const entry = createEntryNode({ id: 'e1', parentId: 'f1', name: 'E', now: NOW, nativeUid: 2 });
        folder.children.push(entry);
        folder.book = { bookName: 'Ghost', orphans: [] };
        state.root.children.push(folder);
        const violations = deepValidateState(state);
        expect(violations.some((message) => message.includes('book'))).toBe(true);

        // Per-book uids may legally differ from native.uid under intersection;
        // validation no longer flags them (the sync engine owns consistency).
        folder.book = { bookName: 'Real', orphans: [] };
        folder.isWiRoot = true;
        entry.sync.books['B'] = { uid: 5, hash: null, status: 'in-sync' };
        entry.native.uid = 9;
        expect(deepValidateState(state)).toEqual([]);
    });

    it('index and find helpers resolve nodes across the tree', () => {
        const state = createDefaultState();
        const folder = createFolderNode({ id: 'f1', parentId: 'workspace-root', name: 'F', now: NOW });
        state.root.children.push(folder);
        const index = buildNodeIndex(state.root);
        expect(index.size).toBe(2);
        expect(findNode(state, 'f1')?.name).toBe('F');
        expect(findNode(state, 'nope')).toBeUndefined();
        expect(createImageNode({ id: 'i1', parentId: 'f1', name: 'M', now: NOW }).kind).toBe('image');
    });
});
describe('native character filter normalization', () => {
    const asEntry = (extra: Record<string, unknown>): NativeWorldInfoEntry =>
        ({ uid: 1, key: [], comment: 'x', content: '', ...extra }) as unknown as NativeWorldInfoEntry;

    it('moves legacy flat filter keys into the native object and drops them', () => {
        const entry = normalizeNativeEntry(
            asEntry({ characterFilterNames: ['Alice'], characterFilterTags: ['t1'], characterFilterExclude: true })
        );
        expect(entry.characterFilter).toEqual({ isExclude: true, names: ['Alice'], tags: ['t1'] });
        expect(Object.keys(entry).filter((key) => key.startsWith('characterFilter'))).toEqual(['characterFilter']);
    });

    it('keeps a native filter over leftover legacy keys and stringifies tag ids', () => {
        const entry = normalizeNativeEntry(
            asEntry({ characterFilter: { isExclude: false, names: ['Bob'], tags: [42] }, characterFilterNames: ['Old'] })
        );
        expect(entry.characterFilter).toEqual({ isExclude: false, names: ['Bob'], tags: ['42'] });
    });

    it('resets a malformed filter like the app does on load', () => {
        expect(normalizeNativeEntry(asEntry({ characterFilter: ['bad'] })).characterFilter).toEqual({
            isExclude: false,
            names: [],
            tags: [],
        });
    });
});

describe('legacy filter migration keeps sync hashes consistent', () => {
    it('carries a hash that matched the pre-normalization entry over to the normalized entry', () => {
        const raw: Record<string, unknown> = JSON.parse(JSON.stringify(createDefaultState()));
        const entry = createEntryNode({ id: 'e1', parentId: 'workspace-root', name: 'E', now: NOW, nativeUid: 3 });
        const native = entry.native as unknown as Record<string, unknown>;
        delete native['characterFilter'];
        native['characterFilterNames'] = [];
        native['characterFilterTags'] = [];
        native['characterFilterExclude'] = false;
        const legacyHash = fingerprintEntry(entry.native);
        entry.sync.books = { Book: { uid: 3, hash: legacyHash, status: 'in-sync' } };
        (raw.root as Record<string, unknown>).children = [JSON.parse(JSON.stringify(entry))];

        const restored = findNode(migrate(raw), 'e1');
        if (restored?.kind !== 'entry') {
            throw new Error('expected entry');
        }
        expect(restored.sync.books['Book']?.hash).toBe(fingerprintEntry(restored.native));
        expect(restored.sync.books['Book']?.hash).not.toBe(legacyHash);
    });
});
