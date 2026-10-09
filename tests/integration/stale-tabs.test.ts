// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    createEntryNode,
    createFolderNode,
    migrate,
    type EntryNode,
    type FolderNode,
    type WorkspaceState,
} from '../../src/core/state/schema';
import { commitEntryField, renameNode } from '../../src/core/tree/operations';
import { contentHash } from '../../src/core/state/staleness';
import { fingerprintEntry } from '../../src/core/sync/fingerprint';
import {
    createSaveGate,
    NOTICE_KEPT,
    NOTICE_LOADED,
    NOTICE_RESTORED,
    type SaveGate,
} from '../../src/adapters/saveGate';
import { buildRig, type Rig } from '../support/fakeHost';
import { diffTree } from '../../src/core/hooks/treeDiff';

/**
 * Stale-tab protection against the REAL store, gate and sync engine (spec 008,
 * quickstart T1–T13). The fake host holds the saved settings file: every app
 * settings save copies the namespace object into it, and "another tab" writes it
 * directly, stamped the way this extension version (or an earlier one) would.
 */

const NOW = '2026-10-09T00:00:00.000Z';
const NS = 'WorldInfoWorkspace';

interface Tab {
    rig: Rig;
    gate: SaveGate;
    notices: string[];
    drafts: { pending: boolean };
    recovery: { pending: boolean };
}

function seed(rig: Rig): void {
    const state = rig.store.getState();
    const root = createFolderNode({ id: 'R', parentId: state.root.id, name: 'Lore', now: NOW });
    root.isWiRoot = true;
    root.book = { bookName: 'Book', orphans: [], tombstones: [] };
    root.expanded = false;
    for (const [id, name, uid] of [['e1', 'Harbor', 5], ['e2', 'Selene', 6]] as const) {
        const entry = createEntryNode({ id, parentId: 'R', name, now: NOW, nativeUid: uid });
        entry.native.content = `${name} text.`;
        entry.sync = { books: { Book: { uid, hash: fingerprintEntry(entry.native), status: 'in-sync' } } };
        root.children.push(entry);
    }
    rig.store.update((draft) => {
        draft.root.children.push(root);
    });
    const entries: Record<string, unknown> = {};
    for (const child of root.children as EntryNode[]) {
        entries[String(child.native.uid)] = structuredClone(child.native);
    }
    rig.host.books.set('Book', { entries } as never);
    void rig.host.updateWorldInfoList();
}

function openTab(): Tab {
    const rig = buildRig();
    seed(rig);
    // The page loaded this payload from the server.
    rig.host.extensionSettings[NS] = rig.store.getState();
    rig.host.serverWorkspace = structuredClone(rig.store.getState());
    const notices: string[] = [];
    const drafts = { pending: false };
    const recovery = { pending: false };
    const gate = createSaveGate({
        store: rig.store,
        readSaved: rig.host.readSaved,
        publish: (state) => {
            rig.host.extensionSettings[NS] = state;
        },
        save: rig.host.saveSettingsDebounced,
        writerId: 'A',
        now: () => Date.now(),
        hasPendingDrafts: () => drafts.pending,
        isRecoveryPending: () => recovery.pending,
        notify: (message) => notices.push(message),
        onReleased: () => void rig.engine.pushPendingNow('released'),
        onLoaded: () => rig.engine.markBooksStale(),
    });
    rig.engine.setGate(gate);
    return { rig, gate, notices, drafts, recovery };
}

const saved = (tab: Tab): WorkspaceState => migrate(structuredClone(tab.rig.host.serverWorkspace));
const entryOf = (state: WorkspaceState, id: string): EntryNode =>
    (state.root.children[0] as FolderNode).children.find((node) => node.id === id) as EntryNode;

/** Another tab of THIS version saved: content changed, marker re-stamped above. */
function writeAsOtherTab(tab: Tab, mutate: (state: WorkspaceState) => void): void {
    const base = saved(tab);
    const previous = base._save;
    delete base._save;
    mutate(base);
    base._save = { rev: (previous?.rev ?? 0) + 1, writer: 'B', at: NOW, hash: contentHash(base) };
    tab.rig.host.serverWorkspace = structuredClone(base);
}

/** An earlier extension version saved: new content, the old marker carried along. */
function writeAsOldVersion(tab: Tab, mutate: (state: WorkspaceState) => void): void {
    const base = saved(tab);
    mutate(base);
    tab.rig.host.serverWorkspace = structuredClone(base);
}

function edit(tab: Tab, id: string, content: string): void {
    tab.rig.store.replace(commitEntryField(tab.rig.store.getState(), id, 'content', content));
}

beforeEach(() => {
    vi.useFakeTimers();
});
afterEach(() => {
    vi.useRealTimers();
});

describe('US1: a tab picks up newer changes when you come back', () => {
    it('loads the newer saved workspace silently with a notice and saves nothing', async () => {
        const tab = openTab();
        writeAsOtherTab(tab, (state) => (entryOf(state, 'e1').native.content = 'Edited in B.'));
        const saves = tab.rig.host.savedSettings;
        expect(await tab.gate.check()).toBe('newer');
        expect(entryOf(tab.rig.store.getState(), 'e1').native.content).toBe('Edited in B.');
        expect(tab.notices).toEqual([NOTICE_LOADED]);
        expect(tab.rig.host.savedSettings).toBe(saves);
    });

    it("an unrelated app save afterwards keeps the other tab's change (SC-001)", async () => {
        const tab = openTab();
        writeAsOtherTab(tab, (state) => (entryOf(state, 'e1').native.content = 'Edited in B.'));
        await tab.gate.check();
        tab.rig.host.saveSettingsDebounced();
        expect(entryOf(saved(tab), 'e1').native.content).toBe('Edited in B.');
    });

    it('keeps the tab expand state, sizes and sort mode; bookkeeping alone never blocks (FR-015)', async () => {
        const tab = openTab();
        tab.rig.store.update((draft) => {
            (draft.root.children[0] as FolderNode).expanded = true;
            draft.settings.sortMode = 'title';
            draft.settings.layout = { treeWidth: 321, treeCollapsed: false, assistantWidth: 400, previewWidth: 50 };
        });
        writeAsOtherTab(tab, (state) => (entryOf(state, 'e2').native.content = 'B again.'));
        expect(await tab.gate.check()).toBe('newer');
        const state = tab.rig.store.getState();
        expect(entryOf(state, 'e2').native.content).toBe('B again.');
        expect((state.root.children[0] as FolderNode).expanded).toBe(true);
        expect(state.settings.sortMode).toBe('title');
        expect(state.settings.layout?.treeWidth).toBe(321);
        expect(tab.gate.conflict()).toBeNull();
    });

    it('does nothing visible when nothing changed elsewhere', async () => {
        const tab = openTab();
        expect(await tab.gate.check()).toBe('unchanged');
        expect(tab.notices).toEqual([]);
    });

    it('a single tab saves as before, each save one revision higher (SC-006)', async () => {
        const tab = openTab();
        edit(tab, 'e1', 'First.');
        await tab.rig.advanceTimers(1100);
        await tab.gate.flush();
        expect(saved(tab)._save?.rev).toBe(1);
        edit(tab, 'e1', 'Second.');
        await tab.rig.advanceTimers(1100);
        await tab.gate.flush();
        expect(saved(tab)._save).toMatchObject({ rev: 2, writer: 'A' });
        expect(entryOf(saved(tab), 'e1').native.content).toBe('Second.');
        expect(tab.notices).toEqual([]);
    });

    it('a load pushes nothing to the books and announces a tree change (FR-010, FR-012, SC-005)', async () => {
        const tab = openTab();
        // B edited Selene AND pushed it: the book and the sync status already agree.
        writeAsOtherTab(tab, (state) => {
            const selene = entryOf(state, 'e2');
            selene.native = { ...selene.native, content: 'Pushed by B.' };
            selene.sync.books['Book'] = { uid: 6, hash: fingerprintEntry(selene.native), status: 'in-sync' };
        });
        const book = tab.rig.host.books.get('Book') as { entries: Record<string, { content: string }> };
        book.entries['6'] = { ...book.entries['6']!, content: 'Pushed by B.' };
        const bookSaves = tab.rig.host.server.size;
        const before = tab.rig.store.getState();
        await tab.gate.check();
        await tab.rig.advanceTimers(1500);
        expect(tab.rig.host.server.size).toBe(bookSaves);
        expect(tab.rig.engine.getReports().size).toBe(0);
        // A store replacement: the settings bridge's store-level diff announces it
        // as tree-changed like any other change (FR-012).
        expect(diffTree(before, tab.rig.store.getState())).toMatchObject([{ change: 'update', node: { nodeId: 'e2' } }]);
    });
});

describe('native books after a load (live 2026-10-09)', () => {
    it("pushes over a book another tab already pushed, although this tab's book cache is stale", async () => {
        const tab = openTab();
        // B edits Selene, pushes the book (the server file changes; THIS tab's app
        // cache keeps the old book) and saves its workspace with in-sync status.
        const pushed = { ...entryOf(tab.rig.store.getState(), 'e2').native, content: 'Pushed by B.' };
        const onDisk = structuredClone(tab.rig.host.books.get('Book')!) as { entries: Record<string, unknown> };
        onDisk.entries['6'] = structuredClone(pushed);
        tab.rig.host.server.set('Book', onDisk as never);
        writeAsOtherTab(tab, (state) => {
            const selene = entryOf(state, 'e2');
            selene.native = structuredClone(pushed);
            selene.sync.books['Book'] = { uid: 6, hash: fingerprintEntry(selene.native), status: 'in-sync' };
        });
        await tab.gate.check(); // A loads B's workspace
        edit(tab, 'e2', 'Then edited in A.');
        await tab.rig.advanceTimers(3000);
        await tab.gate.flush();
        await tab.rig.advanceTimers(2000);
        expect(tab.rig.engine.getReports().size).toBe(0);
        const book = tab.rig.host.server.get('Book') as { entries: Record<string, { content: string }> };
        expect(book.entries['6']?.content).toBe('Then edited in A.');
    });
});

describe('US2: both sides changed — the user decides', () => {
    async function conflicted(): Promise<Tab> {
        const tab = openTab();
        writeAsOtherTab(tab, (state) => (entryOf(state, 'e1').native.content = 'Edited in B.'));
        edit(tab, 'e2', 'Edited in A.');
        await tab.rig.advanceTimers(1100);
        await tab.gate.flush();
        return tab;
    }

    it('saves nothing, keeps the seen copy published, holds the push and lists both sides', async () => {
        const tab = await conflicted();
        expect(tab.gate.conflict()).not.toBeNull();
        expect(entryOf(saved(tab), 'e1').native.content).toBe('Edited in B.');
        expect(entryOf(saved(tab), 'e2').native.content).toBe('Selene text.');
        const published = tab.rig.host.extensionSettings[NS] as WorkspaceState;
        expect(entryOf(published, 'e2').native.content).toBe('Selene text.');
        await tab.rig.advanceTimers(2000);
        const book = tab.rig.host.books.get('Book') as { entries: Record<string, { content: string }> };
        expect(book.entries['6']?.content).toBe('Selene text.');
        const summary = tab.gate.conflict()!.summary;
        expect(summary.mine.lines).toEqual(['Selene — edited']);
        expect(summary.theirs.lines).toEqual(['Harbor — edited']);
    });

    it('"Use the saved version" takes B, drops A\'s edit, and never pushed it', async () => {
        const tab = await conflicted();
        tab.gate.useSaved();
        const state = tab.rig.store.getState();
        expect(entryOf(state, 'e1').native.content).toBe('Edited in B.');
        expect(entryOf(state, 'e2').native.content).toBe('Selene text.');
        expect(tab.gate.conflict()).toBeNull();
        await tab.rig.advanceTimers(2000);
        const book = tab.rig.host.books.get('Book') as { entries: Record<string, { content: string }> };
        expect(book.entries['6']?.content).toBe('Selene text.');
    });

    it('"Keep this version" saves A above both revisions and releases the push', async () => {
        const tab = await conflicted();
        const theirs = saved(tab)._save!.rev;
        edit(tab, 'e2', 'Edited in A, twice.');
        tab.gate.keepMine();
        expect(tab.notices).toContain(NOTICE_KEPT);
        const now = saved(tab);
        expect(now._save!.rev).toBeGreaterThan(theirs);
        expect(entryOf(now, 'e1').native.content).toBe('Harbor text.');
        expect(entryOf(now, 'e2').native.content).toBe('Edited in A, twice.');
        await tab.rig.advanceTimers(2000);
        const book = tab.rig.host.books.get('Book') as { entries: Record<string, { content: string }> };
        expect(book.entries['6']?.content).toBe('Edited in A, twice.');
    });

    it('an earlier extension version (old marker) or an equal revision is a conflict, never silent (FR-008/FR-009)', async () => {
        const old = openTab();
        writeAsOldVersion(old, (state) => (entryOf(state, 'e1').native.content = 'Old bundle.'));
        expect(await old.gate.check()).toBe('conflict');
        expect(entryOf(old.rig.store.getState(), 'e1').native.content).toBe('Harbor text.');

        const equal = openTab();
        edit(equal, 'e2', 'Mine.');
        await equal.rig.advanceTimers(1100);
        await equal.gate.flush(); // rev 1 by A
        writeAsOtherTab(equal, (state) => (entryOf(state, 'e1').native.content = 'B from rev 0.'));
        const theirs = saved(equal);
        theirs._save = { ...theirs._save!, rev: 1 }; // B started from the same base
        theirs._save.hash = contentHash({ ...theirs, _save: undefined });
        equal.rig.host.serverWorkspace = structuredClone(theirs);
        await equal.rig.advanceTimers(6000); // past the grace for our own write
        expect(await equal.gate.check()).toBe('conflict');
    });

    it('a pending field draft counts as an edit: no silent load', async () => {
        const tab = openTab();
        tab.drafts.pending = true;
        writeAsOtherTab(tab, (state) => (entryOf(state, 'e1').native.content = 'Edited in B.'));
        expect(await tab.gate.check()).toBe('conflict');
    });

    it('during a pending recovery a valid saved workspace is offered, never loaded or saved over (FR-011)', async () => {
        const tab = openTab();
        tab.recovery.pending = true;
        writeAsOtherTab(tab, (state) => (entryOf(state, 'e1').native.content = 'Valid from B.'));
        expect(await tab.gate.check()).toBe('conflict');
        expect(tab.gate.conflict()?.recovery).toBe(true);
        expect(entryOf(tab.rig.store.getState(), 'e1').native.content).toBe('Harbor text.');
        tab.gate.useSaved();
        expect(entryOf(tab.rig.store.getState(), 'e1').native.content).toBe('Valid from B.');
    });
});

describe('US3: a newer tab repairs an overwrite by a stale one', () => {
    it('writes its own copy back over an older trusted copy, with a notice (SC-004)', async () => {
        const tab = openTab();
        const stale = saved(tab); // what a stale tab still holds (no marker yet)
        edit(tab, 'e1', 'Newest.');
        await tab.rig.advanceTimers(1100);
        await tab.gate.flush();
        edit(tab, 'e2', 'Newest too.');
        await tab.rig.advanceTimers(1100);
        await tab.gate.flush(); // rev 2
        // The stale tab (this version, rev 1 seen) saves its old namespace for an unrelated reason.
        stale._save = { rev: 1, writer: 'S', at: NOW, hash: contentHash(stale) };
        tab.rig.host.serverWorkspace = structuredClone(stale);
        await tab.rig.advanceTimers(6000); // past our own write grace
        expect(await tab.gate.check()).toBe('older');
        expect(tab.notices).toContain(NOTICE_RESTORED);
        const now = saved(tab);
        expect(now._save!.rev).toBe(3);
        expect(entryOf(now, 'e1').native.content).toBe('Newest.');
    });

    it('a deliberate "Use the saved version" elsewhere is never undone', async () => {
        const tab = openTab();
        writeAsOtherTab(tab, (state) => (entryOf(state, 'e1').native.content = 'B chose this.'));
        await tab.gate.check(); // A loads it: seen = B's marker
        expect(await tab.gate.check()).toBe('unchanged');
        expect(tab.notices).not.toContain(NOTICE_RESTORED);
    });
});

describe('robustness', () => {
    it('a failed check changes nothing (FR-013)', async () => {
        const tab = openTab();
        tab.rig.host.settingsServerDown = true;
        expect(await tab.gate.check()).toBe('failed');
        expect(tab.notices).toEqual([]);
        expect(tab.gate.conflict()).toBeNull();
    });

    it('a save with the server unreachable retries once, then saves as before', async () => {
        const tab = openTab();
        edit(tab, 'e1', 'Offline edit.');
        tab.rig.host.settingsServerDown = true;
        const saves = tab.rig.host.savedSettings;
        // Debounce, a failed check, the retry delay, a second failed check.
        await tab.rig.advanceTimers(6000);
        expect(tab.rig.host.savedSettings).toBe(saves + 1);
        expect(entryOf(saved(tab), 'e1').native.content).toBe('Offline edit.');
    });

    it('renames count as content for the conflict lists', async () => {
        const tab = openTab();
        writeAsOtherTab(tab, (state) => ((state.root.children[0] as FolderNode).name = 'Lore (B)'));
        tab.rig.store.replace(renameNode(tab.rig.store.getState(), 'e1', 'Harbour')!);
        expect(await tab.gate.check()).toBe('conflict');
        expect(tab.gate.conflict()!.summary.theirs.lines).toEqual(['Lore (B) — edited']);
        expect(tab.gate.conflict()!.summary.mine.lines).toEqual(['Harbour — edited']);
    });
});
