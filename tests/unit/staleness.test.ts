import { describe, expect, it } from 'vitest';
import {
    classify,
    conflictSummary,
    contentHash,
    markerTrusted,
    nextMarker,
    withBookkeeping,
} from '../../src/core/state/staleness';
import {
    createDefaultState,
    createEntryNode,
    createFolderNode,
    createImageNode,
    type EntryNode,
    type FolderNode,
    type SaveMarker,
    type WorkspaceState,
} from '../../src/core/state/schema';

/**
 * Stale-tab protection (spec 008, research R2/R3): what counts as content, when a
 * marker can be trusted, and how a saved payload compares with a tab's last seen copy.
 */

function sample(): WorkspaceState {
    const state = createDefaultState();
    const lore = createFolderNode({ id: 'f1', parentId: state.root.id, name: 'Lore', now: 't' });
    lore.isWiRoot = true;
    lore.book = { bookName: 'Lore', orphans: [], tombstones: [] };
    const entry = createEntryNode({ id: 'e1', parentId: 'f1', name: 'Harbor', now: 't', nativeUid: 3 });
    entry.native.content = 'Ships.';
    entry.sync.books['Lore'] = { uid: 3, hash: 'aaaa', status: 'in-sync' };
    const image = createImageNode({ id: 'i1', parentId: 'f1', name: 'Map', now: 't' });
    image.caption = 'A map';
    lore.children = [entry, image];
    state.root.children = [lore];
    return state;
}

const clone = (state: WorkspaceState): WorkspaceState => structuredClone(state);
const folder = (state: WorkspaceState): FolderNode => state.root.children[0] as FolderNode;
const entry = (state: WorkspaceState): EntryNode => folder(state).children[0] as EntryNode;

function stamped(state: WorkspaceState, rev: number, writer = 'w'): WorkspaceState {
    return { ...state, _save: { rev, writer, at: 'now', hash: contentHash(state) } };
}

describe('contentHash: bookkeeping is not content (FR-015)', () => {
    const base = sample();
    const same = (mutate: (state: WorkspaceState) => void): void => {
        const next = clone(base);
        mutate(next);
        expect(contentHash(next)).toBe(contentHash(base));
    };
    const differs = (mutate: (state: WorkspaceState) => void): void => {
        const next = clone(base);
        mutate(next);
        expect(contentHash(next)).not.toBe(contentHash(base));
    };

    it('ignores expand state, layout, sort mode, sync status, tombstones, native uid and markers', () => {
        same((s) => (folder(s).expanded = !folder(s).expanded));
        same((s) => (s.settings.layout = { treeWidth: 400, treeCollapsed: true, assistantWidth: 300, previewWidth: 40 }));
        same((s) => (s.settings.sortMode = 'title'));
        same((s) => (entry(s).sync.books['Lore'] = { uid: 9, hash: 'bbbb', status: 'dirty' }));
        same((s) => (folder(s).book!.tombstones = [4, 5]));
        same((s) => (entry(s).native.uid = 42));
        same((s) => (s._save = { rev: 7, writer: 'x', at: 'y', hash: 'z' }));
        same((s) => (s._recovered = { anything: true }));
    });

    it('sees every content change', () => {
        differs((s) => (folder(s).name = 'Lore 2'));
        differs((s) => (entry(s).native.content = 'Boats.'));
        differs((s) => (entry(s).native.key = ['harbor']));
        differs((s) => (entry(s).native.extensions = { wiw_summary: 'When ships matter.' }));
        differs((s) => folder(s).children.reverse());
        differs((s) => folder(s).children.pop());
        differs((s) => ((folder(s).children[1] as { caption: string }).caption = 'Old map'));
        differs((s) => (s.settings.assistant = { profileId: 'p' } as never));
        differs((s) => (s.settings.picking = { defaultEnabled: true }));
        differs((s) => (folder(s).isWiRoot = false));
    });

    it('is memoized per state object', () => {
        const state = sample();
        const first = contentHash(state);
        expect(contentHash(state)).toBe(first);
        expect(contentHash(clone(state))).toBe(first);
    });
});

describe('markerTrusted', () => {
    it('trusts a marker whose hash matches the payload content', () => {
        expect(markerTrusted(stamped(sample(), 1))).toBe(true);
    });

    it('distrusts a missing marker or one carried along with changed content (earlier version)', () => {
        expect(markerTrusted(sample())).toBe(false);
        // A payload parsed from the server is made of fresh objects.
        const carried = clone(stamped(sample(), 1));
        entry(carried).native.content = 'Changed by an old bundle.';
        expect(markerTrusted(carried)).toBe(false);
    });
});

describe('classify (research R2)', () => {
    const seenState = stamped(sample(), 5);
    const seen = { hash: contentHash(seenState), marker: seenState._save };
    const edited = (rev: number | null): WorkspaceState => {
        const next = clone(seenState);
        entry(next).native.content = 'Edited elsewhere.';
        delete next._save;
        return rev === null ? next : stamped(next, rev);
    };

    it('same content is unchanged, whatever the marker says', () => {
        const sameContent = clone(seenState);
        delete sameContent._save;
        expect(classify(seen, stamped(sameContent, 9))).toBe('unchanged');
        expect(classify(seen, sameContent)).toBe('unchanged');
    });

    it('a trusted higher revision is newer, a lower one older, an equal one a conflict', () => {
        expect(classify(seen, edited(6))).toBe('newer');
        expect(classify(seen, edited(4))).toBe('older');
        expect(classify(seen, edited(5))).toBe('conflict');
    });

    it('changed content without a usable marker is a conflict (unknown age, FR-008/FR-009)', () => {
        expect(classify(seen, edited(null))).toBe('conflict');
        const carried = edited(null);
        carried._save = seenState._save;
        expect(classify(seen, carried)).toBe('conflict');
    });

    it('a tab that never saw a marker treats any trusted marker as newer', () => {
        expect(classify({ hash: contentHash(sample()), marker: undefined }, edited(1))).toBe('newer');
    });
});

describe('nextMarker', () => {
    it('goes above both revisions and records writer, time and hash', () => {
        const seen: SaveMarker = { rev: 4, writer: 'a', at: 'x', hash: 'h' };
        const saved: SaveMarker = { rev: 7, writer: 'b', at: 'y', hash: 'g' };
        expect(nextMarker(seen, saved, 'me', 'hash', '2026-10-09T00:00:00.000Z')).toEqual({
            rev: 8,
            writer: 'me',
            at: '2026-10-09T00:00:00.000Z',
            hash: 'hash',
        });
        expect(nextMarker(undefined, undefined, 'me', 'h', 't').rev).toBe(1);
    });
});

describe('withBookkeeping', () => {
    it('keeps the tab expand state by node id, its layout and sort mode, and the rest of the loaded state', () => {
        const tab = sample();
        folder(tab).expanded = true;
        tab.settings.sortMode = 'title';
        tab.settings.layout = { treeWidth: 333, treeCollapsed: false, assistantWidth: 444, previewWidth: 50 };
        const loaded = sample();
        folder(loaded).expanded = false;
        entry(loaded).native.content = 'From elsewhere.';
        entry(loaded).sync.books['Lore'] = { uid: 3, hash: 'cccc', status: 'in-sync' };
        const merged = withBookkeeping(loaded, tab);
        expect(merged).not.toBe(loaded);
        expect(folder(merged).expanded).toBe(true);
        expect(merged.settings.sortMode).toBe('title');
        expect(merged.settings.layout?.treeWidth).toBe(333);
        expect(entry(merged).native.content).toBe('From elsewhere.');
        expect(entry(merged).sync.books['Lore']?.hash).toBe('cccc');
        expect(folder(loaded).expanded).toBe(false);
    });
});

describe('conflictSummary (FR-016)', () => {
    it('labels added, removed and edited items once each, settings as one line, bookkeeping never', () => {
        const seenState = sample();
        const mine = clone(seenState);
        entry(mine).native.content = 'Mine.';
        folder(mine).expanded = !folder(mine).expanded;
        folder(mine).children.push(createEntryNode({ id: 'e9', parentId: 'f1', name: 'New one', now: 't', nativeUid: 9 }));
        mine.settings.picking = { defaultEnabled: true };
        const theirs = clone(seenState);
        folder(theirs).children = folder(theirs).children.filter((node) => node.id !== 'i1');
        const summary = conflictSummary(seenState, mine, theirs);
        expect(summary.mine.lines).toEqual(['Harbor — edited', 'New one — added', 'Lore picking settings — changed']);
        expect(summary.theirs.lines).toEqual(['Map — removed']);
        expect(summary.mine.more).toBe(0);
    });

    it('lists at most 10 per side and counts the rest', () => {
        const seenState = sample();
        const mine = clone(seenState);
        for (let i = 0; i < 13; i++) {
            folder(mine).children.push(
                createEntryNode({ id: `n${String(i)}`, parentId: 'f1', name: `N${String(i)}`, now: 't', nativeUid: 20 + i })
            );
        }
        const summary = conflictSummary(seenState, mine, clone(seenState));
        expect(summary.mine.lines).toHaveLength(10);
        expect(summary.mine.more).toBe(3);
        expect(summary.theirs).toEqual({ lines: [], more: 0 });
    });
});
