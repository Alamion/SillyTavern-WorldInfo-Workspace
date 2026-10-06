import { describe, expect, it } from 'vitest';
import { buildCatalog, catalogLine, folderCatalog } from '../../src/core/assistant/catalog';
import { buildHandleMap } from '../../src/core/assistant/handles';
import {
    createDefaultState,
    createEntryNode,
    createFolderNode,
    type EntryNode,
    type FolderNode,
    type WorkspaceState,
} from '../../src/core/state/schema';

/** Catalog lines and folder narrowing (spec 007 R4, contracts/assistant-protocol-v2.md). */

const NOW = '2026-10-07T00:00:00.000Z';

function library(folders: number, perFolder: number): { state: WorkspaceState; entries: EntryNode[] } {
    const state = createDefaultState();
    const world = createFolderNode({ id: 'w', parentId: state.root.id, name: 'World', now: NOW });
    state.root.children.push(world);
    const entries: EntryNode[] = [];
    for (let f = 0; f < folders; f++) {
        const folder = createFolderNode({ id: `f${String(f)}`, parentId: 'w', name: `Region ${String(f)}`, now: NOW });
        world.children.push(folder);
        for (let e = 0; e < perFolder; e++) {
            const entry = createEntryNode({
                id: `e${String(f)}-${String(e)}`,
                parentId: folder.id,
                name: `Place ${String(f)}-${String(e)}`,
                now: NOW,
                nativeUid: f * 100 + e,
            });
            entry.native.content = `The place number ${String(e)} of region ${String(f)}. `.repeat(20);
            folder.children.push(entry);
            entries.push(entry);
        }
    }
    return { state, entries };
}

describe('catalog lines', () => {
    it('uses the summary when there is one and a quoted excerpt otherwise', () => {
        const { state, entries } = library(1, 2);
        const map = buildHandleMap(state);
        const [first, second] = entries as [EntryNode, EntryNode];
        first.native.extensions = { wiw_summary: 'When travellers arrive.' };
        expect(catalogLine(state, first, map.byNode.get(first.id) ?? '?')).toMatch(
            /^e1 \| World \/ Region 0 \| Place 0-0 \| ≈\d+ — When travellers arrive\.$/
        );
        expect(catalogLine(state, second, map.byNode.get(second.id) ?? '?')).toMatch(/— "The place number 1 of region 0\./);
    });

    it('marks over-long summaries as shortened', () => {
        const { state, entries } = library(1, 1);
        const entry = entries[0] as EntryNode;
        entry.native.extensions = { wiw_summary: 'x'.repeat(400) };
        expect(catalogLine(state, entry, 'e1')).toMatch(/x{300}… \(shortened\)$/);
    });
});

describe('buildCatalog', () => {
    it('lists every entry when the catalog fits', () => {
        const { state, entries } = library(2, 3);
        const map = buildHandleMap(state);
        const catalog = buildCatalog({ state, entries, map, budgetTokens: 10000 });
        expect(catalog.entryIds).toHaveLength(6);
        expect(catalog.folderIds).toEqual([]);
        expect(catalog.text).toContain('## Catalog');
        expect(catalog.text).toContain('<op type="read"');
    });

    it('narrows by folder when the entries do not fit, keeping the best-ranked entries', () => {
        const { state, entries } = library(5, 40);
        const map = buildHandleMap(state);
        const favourite = entries[123] as EntryNode;
        const catalog = buildCatalog({
            state,
            entries,
            map,
            budgetTokens: 1500,
            rank: (entry) => (entry.id === favourite.id ? 10 : 0),
        });
        expect(catalog.entryIds[0]).toBe(favourite.id);
        expect(catalog.entryIds.length).toBeLessThan(200);
        expect(catalog.folderIds.length).toBeGreaterThan(0);
        expect(catalog.text).toMatch(/\| \(folder, \d+ entries: Place/);
        expect(catalog.tokens).toBeLessThanOrEqual(1500);
    });

    it('never lists disabled entries', () => {
        const { state, entries } = library(1, 3);
        (entries[1] as EntryNode).native.disable = true;
        const catalog = buildCatalog({ state, entries, map: buildHandleMap(state), budgetTokens: 10000 });
        expect(catalog.entryIds).not.toContain((entries[1] as EntryNode).id);
    });
});

describe('folderCatalog', () => {
    it('lists the entries of an opened folder', () => {
        const { state } = library(2, 3);
        const map = buildHandleMap(state);
        const folder = (state.root.children[0] as FolderNode).children[1] as FolderNode;
        const opened = folderCatalog(state, folder, map, 10000);
        expect(opened.entryIds).toEqual(['e1-0', 'e1-1', 'e1-2']);
        expect(opened.text).toContain('Region 1');
    });
});
