// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NativeWorldInfoEntry } from '../../src/global';
import { createEntryNode, createFolderNode, migrate, type EntryNode, type FolderNode } from '../../src/core/state/schema';
import { commitEntryField, commitEntrySummary } from '../../src/core/tree/operations';
import { getSummary, SUMMARY_KEY } from '../../src/core/tree/summary';
import { fingerprintEntry } from '../../src/core/sync/fingerprint';
import { parseEntryFile, renderEntryFile } from '../../src/core/md/convention';
import { buildRig, type Rig } from '../support/fakeHost';
import { nodeYaml as yaml } from '../support/memoryDisk';

/**
 * Summary round-trip matrix (spec 007 R13 / SC-003 — owner: test thoroughly).
 * The summary lives in `extensions.wiw_summary` of the native entry, so every path
 * that carries a native entry must carry it unchanged.
 */

const NOW = '2026-10-07T00:00:00.000Z';

function seed(rig: Rig): void {
    const state = rig.store.getState();
    const root = createFolderNode({ id: 'R', parentId: state.root.id, name: 'Root', now: NOW });
    root.isWiRoot = true;
    root.book = { bookName: 'Book', orphans: [], tombstones: [] };
    const entry = createEntryNode({ id: 'e1', parentId: 'R', name: 'Alpha', now: NOW, nativeUid: 5 });
    entry.native.content = 'Alpha content.';
    entry.sync = { books: { Book: { uid: 5, hash: fingerprintEntry(entry.native), status: 'in-sync' } } };
    root.children.push(entry);
    rig.store.update((draft) => {
        draft.root.children.push(root);
    });
    rig.host.books.set('Book', { entries: { '5': structuredClone(entry.native) } });
    void rig.host.updateWorldInfoList();
}

function workspaceEntry(rig: Rig): EntryNode {
    const root = rig.store.getState().root.children[0] as FolderNode;
    return root.children[0] as EntryNode;
}

function nativeEntry(rig: Rig): NativeWorldInfoEntry {
    return rig.host.books.get('Book')!.entries['5']!;
}

async function setSummary(rig: Rig, text: string): Promise<void> {
    rig.store.replace(commitEntrySummary(rig.store.getState(), 'e1', text));
    await rig.advanceTimers();
}

/**
 * The app's character-card round trip (src/endpoints/characters.js
 * convertWorldInfoToCharacterBook spreads `entry.extensions`; world-info.js
 * convertCharacterBook keeps `extensions: entry.extensions ?? {}`), reduced to
 * the fields that decide whether the summary survives.
 */
function viaCharacterCard(entry: NativeWorldInfoEntry): Record<string, unknown> {
    const cardEntry = {
        keys: entry.key,
        content: entry.content,
        extensions: { ...entry.extensions, position: entry.position, display_index: entry.displayIndex },
    };
    return { extensions: cardEntry.extensions ?? {} };
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('summary round trip (spec 007 SC-003)', () => {
    it('S1: an editor edit survives a reload (persisted payload → migrate)', async () => {
        const rig = buildRig();
        seed(rig);
        await setSummary(rig, 'When Alpha matters.');
        const reloaded = migrate(JSON.parse(JSON.stringify(rig.store.getState())));
        const entry = (reloaded.root.children[0] as FolderNode).children[0] as EntryNode;
        expect(getSummary(entry.native)).toBe('When Alpha matters.');
    });

    it('S2: a push writes extensions.wiw_summary into the native entry and nothing else changes', async () => {
        const rig = buildRig();
        seed(rig);
        const before = structuredClone(nativeEntry(rig));
        await setSummary(rig, 'When Alpha matters.');
        const after = nativeEntry(rig);
        expect(after.extensions?.[SUMMARY_KEY]).toBe('When Alpha matters.');
        expect({ ...after, extensions: undefined, displayIndex: undefined }).toEqual({
            ...before,
            extensions: undefined,
            displayIndex: undefined,
        });
        expect(workspaceEntry(rig).sync.books['Book']?.status).toBe('in-sync');
    });

    it('S3: a native edit of another field keeps the summary on both sides', async () => {
        const rig = buildRig();
        seed(rig);
        await setSummary(rig, 'Keep me.');
        await rig.host.nativeSave('Book', (book) => {
            book.entries['5']!.content = 'Edited natively.';
        });
        await rig.advanceTimers();
        expect(workspaceEntry(rig).native.content).toBe('Edited natively.');
        expect(getSummary(workspaceEntry(rig).native)).toBe('Keep me.');
        expect(nativeEntry(rig).extensions?.[SUMMARY_KEY]).toBe('Keep me.');
    });

    it('S4: a native edit of the summary is pulled like any clean-side change', async () => {
        const rig = buildRig();
        seed(rig);
        await setSummary(rig, 'Old.');
        await rig.host.nativeSave('Book', (book) => {
            book.entries['5']!.extensions = { ...book.entries['5']!.extensions, [SUMMARY_KEY]: 'New from native.' };
        });
        await rig.advanceTimers();
        expect(getSummary(workspaceEntry(rig).native)).toBe('New from native.');
        expect(rig.engine.getReports().size).toBe(0);
    });

    it('S5: a workspace edit of another field keeps the summary in the next push', async () => {
        const rig = buildRig();
        seed(rig);
        await setSummary(rig, 'Stay.');
        rig.store.replace(commitEntryField(rig.store.getState(), 'e1', 'content', 'New content.'));
        await rig.advanceTimers();
        expect(nativeEntry(rig).content).toBe('New content.');
        expect(nativeEntry(rig).extensions?.[SUMMARY_KEY]).toBe('Stay.');
    });

    it('S6: markdown export → import keeps the summary', async () => {
        const rig = buildRig();
        seed(rig);
        await setSummary(rig, 'Exported.');
        const text = renderEntryFile(workspaceEntry(rig), 'Alpha', yaml);
        expect(text).toContain('wi_summary: Exported.');
        expect(getSummary(parseEntryFile(text, 'Alpha', yaml).native)).toBe('Exported.');
    });

    it('S7: an on-disk edit of wi_summary is read back', () => {
        const text = '---\nwi_summary: Edited on disk.\n---\n\nAlpha content.';
        expect(getSummary(parseEntryFile(text, 'Alpha', yaml).native)).toBe('Edited on disk.');
    });

    it('S8: the character-card round trip keeps the summary (extensions object, not a top-level key)', async () => {
        const rig = buildRig();
        seed(rig);
        await setSummary(rig, 'Card.');
        expect(viaCharacterCard(nativeEntry(rig)).extensions).toMatchObject({ [SUMMARY_KEY]: 'Card.' });
    });

    it('S9: clearing the summary removes the key from the native entry', async () => {
        const rig = buildRig();
        seed(rig);
        await setSummary(rig, 'Temp.');
        await setSummary(rig, '');
        expect(nativeEntry(rig).extensions && SUMMARY_KEY in nativeEntry(rig).extensions!).toBe(false);
    });
});
