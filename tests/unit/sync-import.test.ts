import { describe, expect, it } from 'vitest';
import type { NativeWorldInfoEntry, WorldInfoBook } from '../../src/global';
import { fingerprintEntry } from '../../src/core/sync/fingerprint';
import {
    createDefaultState,
    createFolderNode,
    deepValidateState,
    findNode,
} from '../../src/core/state/schema';
import { mapBookToNodes, planBoundImport } from '../../src/core/sync/import';

const NOW = '2026-09-08T00:00:00.000Z';

function nativeEntry(
    uid: number,
    comment: string,
    overrides?: { content?: string; displayIndex?: number; image?: { src: string; caption: string } }
): NativeWorldInfoEntry {
    const entry: NativeWorldInfoEntry = {
        uid,
        key: [],
        keysecondary: [],
        comment,
        content: overrides?.content ?? '',
        constant: false,
        vectorized: false,
        selective: true,
        selectiveLogic: 0,
        probability: 100,
        useProbability: true,
        disable: false,
        order: 100,
        position: 0,
        depth: 4,
        role: 0,
        outletName: '',
        ignoreBudget: false,
        excludeRecursion: false,
        preventRecursion: false,
        delayUntilRecursion: 0,
        matchPersonaDescription: false,
        matchCharacterDescription: false,
        matchCharacterPersonality: false,
        matchCharacterDepthPrompt: false,
        matchScenario: false,
        matchCreatorNotes: false,
        group: '',
        groupOverride: false,
        groupWeight: 100,
        scanDepth: null,
        caseSensitive: null,
        matchWholeWords: null,
        useGroupScoring: null,
        sticky: null,
        cooldown: null,
        delay: null,
        automationId: '',
        triggers: [],
        characterFilterNames: [],
        characterFilterTags: [],
        characterFilterExclude: false,
        addMemo: true,
        displayIndex: overrides?.displayIndex,
    };
    if (overrides?.image) {
        entry.content = `![${overrides.image.caption}](${overrides.image.src})`;
        entry.extensions = {
            wiw: { v: 1, kind: 'image', src: overrides.image.src, caption: overrides.image.caption },
        };
    }
    return entry;
}

function bookOf(entries: NativeWorldInfoEntry[]): WorldInfoBook {
    const map: WorldInfoBook['entries'] = {};
    for (const entry of entries) {
        map[String(entry.uid)] = entry;
    }
    return { entries: map };
}

describe('mapBookToNodes (FR-016)', () => {
    it('maps native entries to nodes preserving fields, uid and name', () => {
        const book = bookOf([
            nativeEntry(1, 'Riverborn', { content: 'river folk', displayIndex: 0 }),
            nativeEntry(2, 'Bridge Ward', { displayIndex: 1 }),
        ]);
        const nodes = mapBookToNodes(book, 'Imported', () => 'n-new', NOW);
        expect(nodes).toHaveLength(2);
        const first = nodes[0];
        if (first?.kind !== 'entry') {
            throw new Error('expected entry node');
        }
        expect(first.native.uid).toBe(1);
        expect(first.native.comment).toBe('Riverborn');
        expect(first.native.content).toBe('river folk');
        expect(first.name).toBe('Riverborn');
        // The native uid IS the import identity (bound re-import matches by it).
        expect(first.sync.books['Imported']?.uid).toBe(1);
    });

    it('falls back to Entry <uid> for empty comments', () => {
        const book = bookOf([nativeEntry(4, '')]);
        const nodes = mapBookToNodes(book, 'B', () => 'n1', NOW);
        expect(nodes[0]?.name).toBe('Entry 4');
    });

    it('orders children by displayIndex', () => {
        const book = bookOf([
            nativeEntry(1, 'second', { displayIndex: 5 }),
            nativeEntry(2, 'first', { displayIndex: 2 }),
        ]);
        const nodes = mapBookToNodes(book, 'B', () => 'n1', NOW);
        expect(nodes.map((node) => node.name)).toEqual(['first', 'second']);
    });

    it('imports image-marked entries as ordinary entries (books never contain images)', () => {
        const book = bookOf([
            nativeEntry(1, 'Map', { image: { src: 'https://x/map.png', caption: 'The Verdant Span' } }),
            nativeEntry(2, 'Looks like an image', { content: '![alt](https://y/pic.png)' }),
        ]);
        const nodes = mapBookToNodes(book, 'B', () => 'n1', NOW);
        // Images are workspace-only: every book entry is an entry node now.
        expect(nodes.every((node) => node.kind === 'entry')).toBe(true);
        const marker = nodes[0]?.kind === 'entry' ? nodes[0].native : null;
        expect((marker?.extensions as Record<string, unknown> | undefined)?.['wiw']).toBeDefined();
    });

    it('mapped children keep the whole state valid when attached to a root', () => {
        const state = createDefaultState();
        const folder = createFolderNode({ id: 'F', parentId: state.root.id, name: 'Imported', now: NOW });
        const nodes = mapBookToNodes(bookOf([nativeEntry(3, 'X')]), 'Imported', () => 'n1', NOW);
        folder.children.push(
            ...nodes.map((node) => ({ ...node, parentId: folder.id }))
        );
        folder.isWiRoot = true;
        folder.book = { bookName: 'Imported', orphans: [] };
        state.root.children.push(folder);
        expect(deepValidateState(state)).toEqual([]);
        const mapped = findNode(state, 'n1');
        expect(mapped?.kind).toBe('entry');
    });
});

describe('planBoundImport (FR-016 divergence flow)', () => {
    it('reports per-entry conflicts when both sides changed', () => {
        const book = bookOf([nativeEntry(5, 'native version', { content: 'native text' })]);
        const plan = planBoundImport({
            book,
            entities: [{ nodeId: 'e1', uid: 5, hash: 'different-hash', status: 'dirty' }],
        });
        expect(plan.conflicts).toHaveLength(1);
        expect(plan.conflicts[0]?.nativeEntry.uid).toBe(5);
        expect(plan.conflicts[0]?.nativeEntry.uid).toBe(5);
    });

    it('treats matching hashes as clean', () => {
        const book = bookOf([nativeEntry(5, 'same')]);
        const plan = planBoundImport({
            book,
            entities: [
                { nodeId: 'e1', uid: 5, hash: fingerprintEntry(book.entries['5']!), status: 'in-sync' },
            ],
        });
        expect(plan.conflicts).toHaveLength(0);
        expect(plan.additions).toEqual([]);
    });

    it('skips tombstoned uids (FR-021 removal intent) and mirrors native deletions', () => {
        const book = bookOf([nativeEntry(5, 'ws'), nativeEntry(9, 'alien')]);
        const plan = planBoundImport({
            book,
            entities: [{ nodeId: 'e1', uid: 5, hash: fingerprintEntry(book.entries['5']!), status: 'in-sync' }],
            skipUids: new Set([9]),
        });
        expect(plan.additions).toEqual([]);

        const missingNative = bookOf([nativeEntry(5, 'ws')]);
        const mirror = planBoundImport({
            book: missingNative,
            entities: [
                { nodeId: 'e1', uid: 5, hash: fingerprintEntry(missingNative.entries['5']!), status: 'in-sync' },
                { nodeId: 'e2', uid: 6, hash: 'x', status: 'in-sync' },
            ],
        });
        // uid 6 exists in the workspace but no longer in the native book.
        expect(mirror.deletions).toEqual([{ nodeId: 'e2', uid: 6 }]);
    });

    it('collects native-only entries as additions', () => {
        const book = bookOf([nativeEntry(5, 'ws'), nativeEntry(9, 'alien')]);
        const plan = planBoundImport({
            book,
            entities: [
                { nodeId: 'e1', uid: 5, hash: fingerprintEntry(book.entries['5']!), status: 'in-sync' },
            ],
        });
        expect(plan.additions.map((node) => node.native.uid)).toEqual([9]);
    });
});
