import { describe, expect, it } from 'vitest';
import { createImageResolver } from '../../src/adapters/mdExport';
import { createMdLink, type ConflictDecision, type ConflictView, type MdLink } from '../../src/adapters/mdLink';
import type { SyncEngine } from '../../src/adapters/syncEngine';
import type { AccessState, DiskFolderAccess, StoredLink } from '../../src/core/md/ports';
import { commitEntryField, createChild, deleteSubtree, moveNode, renameNode } from '../../src/core/tree/operations';
import { findNode, type EntryNode, type FolderNode, type WorkspaceState } from '../../src/core/state/schema';
import { WorkspaceStore } from '../../src/core/state/store';
import { MemoryDiskFolder, MemoryImageStore, nodeDigest as digest, nodeYaml } from '../support/memoryDisk';
import { entryNode, folderNode, stateWith } from '../support/mdFixtures';

/**
 * Link manager scenarios (quickstart S5–S11) against an in-memory folder, the real
 * store, a scripted access port and a sync-engine stub recording hook calls.
 */

class FakeAccess implements DiskFolderAccess {
    stored: StoredLink | null = null;
    access: AccessState = 'granted';
    requested = 0;
    constructor(public folder: MemoryDiskFolder, public name = 'vault') {}
    isSupported = (): boolean => true;
    pick = async () => ({ folder: this.folder, name: this.name, handle: 'handle' });
    pickFiles = async () => null;
    loadLink = async () => (this.stored ? structuredClone(this.stored) : null);
    saveLink = async (link: StoredLink) => {
        this.stored = structuredClone(link);
    };
    clearLink = async () => {
        this.stored = null;
    };
    queryAccess = async () => this.access;
    requestAccess = async () => {
        this.requested += 1;
        if (this.access === 'prompt') {
            this.access = 'granted';
        }
        return this.access;
    };
    open = () => this.folder;
}

function syncStub() {
    const calls: string[] = [];
    const stub = {
        refreshStructure: () => calls.push('refreshStructure'),
        recordEntityDeletions: () => calls.push('recordEntityDeletions'),
        markBooksDirty: (books: readonly string[]) => calls.push(`markBooksDirty:${books.join(',')}`),
    } as unknown as SyncEngine;
    return { stub, calls };
}

interface Harness {
    store: WorkspaceStore;
    folder: MemoryDiskFolder;
    access: FakeAccess;
    link: MdLink;
    calls: string[];
    decisions: { conflicts: ConflictView[][]; deletions: number; decide: ConflictDecision; confirmDeletes: boolean };
    edit(op: (state: WorkspaceState) => WorkspaceState | null): Promise<void>;
}

let seq = 0;

function harness(initial: WorkspaceState, folder = new MemoryDiskFolder()): Harness {
    const store = new WorkspaceStore(initial);
    const access = new FakeAccess(folder);
    const { stub, calls } = syncStub();
    const decisions = { conflicts: [] as ConflictView[][], deletions: 0, decide: 'skip' as ConflictDecision, confirmDeletes: true };
    const link = createMdLink({
        store,
        sync: stub,
        access,
        imageStore: new MemoryImageStore(),
        digest,
        yaml: () => nodeYaml,
        decisions: {
            confirmLink: async () => true,
            resolveConflicts: async (views) => {
                decisions.conflicts.push(views);
                return new Map(views.map((view) => [view.key, decisions.decide]));
            },
            confirmDeletions: async () => {
                decisions.deletions += 1;
                return decisions.confirmDeletes;
            },
        },
        resolveImage: createImageResolver((async () => new Response(null, { status: 404 })) as typeof fetch),
        designate: async () => undefined,
        newId: () => `new-${++seq}`,
        debounceMs: 10_000,
    });
    return {
        store,
        folder,
        access,
        link,
        calls,
        decisions,
        edit: async (op) => {
            const next = op(store.getState());
            if (next) {
                store.replace(next);
            }
            await link.flush();
        },
    };
}

function workspace(): WorkspaceState {
    return stateWith([
        folderNode('kingdoms', 'Kingdoms', [
            entryNode('alder', 'Aldermeer', { key: ['river'], content: 'River city.' }),
            entryNode('varn', 'House Varn', { content: 'Nobles.' }),
        ]),
        entryNode('notes', 'Notes', { content: 'Plain notes.' }),
    ]);
}

const entry = (state: WorkspaceState, id: string): EntryNode => findNode(state, id) as EntryNode;

describe('md link — auto-push (US3 sc. 2)', () => {
    it('writes the workspace into an empty folder and then mirrors edits without a Sync', async () => {
        const h = harness(workspace());
        await h.link.link();
        expect(h.folder.filePaths()).toEqual(['Kingdoms/Aldermeer.md', 'Kingdoms/House Varn.md', 'Notes.md']);
        expect(h.access.stored?.baseline['alder']?.path).toBe('Kingdoms/Aldermeer.md');

        await h.edit((s) => commitEntryField(s, 'alder', 'content', 'Rewritten.'));
        expect(h.folder.readText('Kingdoms/Aldermeer.md')).toBe('---\nwi_keys:\n  - river\n---\n\nRewritten.');

        await h.edit((s) => renameNode(s, 'varn', 'House Varnholt'));
        expect(h.folder.has('Kingdoms/House Varn.md')).toBe(false);
        expect(h.folder.readText('Kingdoms/House Varnholt.md')).toBe('Nobles.');

        await h.edit((s) => moveNode(s, 'notes', 'kingdoms'));
        expect(h.folder.has('Notes.md')).toBe(false);
        expect(h.folder.has('Kingdoms/Notes.md')).toBe(true);

        await h.edit((s) => createChild(s, 'kingdoms', 'entry', 'Fresh', () => 'fresh'));
        expect(h.folder.readText('Kingdoms/Fresh.md')).toBe('');

        await h.edit((s) => deleteSubtree(s, 'alder'));
        expect(h.folder.has('Kingdoms/Aldermeer.md')).toBe(false);
    });

    it('moves a renamed folder and removes the old directory', async () => {
        const h = harness(workspace());
        await h.link.link();
        await h.edit((s) => renameNode(s, 'kingdoms', 'Realms'));
        expect(h.folder.filePaths()).toEqual(['Notes.md', 'Realms/Aldermeer.md', 'Realms/House Varn.md']);
        expect(h.folder.has('Kingdoms')).toBe(false);
    });
});

describe('md link — pull (US3 sc. 1, 3)', () => {
    it('applies disk edits, renames, moves and new files on Sync, keeping identity', async () => {
        const h = harness(workspace());
        await h.link.link();
        h.folder.writeText('Kingdoms/Aldermeer.md', '---\nwi_keys: [river, bridge]\n---\n\nEdited in Obsidian.');
        const varn = h.folder.readText('Kingdoms/House Varn.md')!;
        await h.folder.remove('Kingdoms/House Varn.md');
        h.folder.writeText('Kingdoms/Varn family.md', varn);
        const notes = h.folder.readText('Notes.md')!;
        await h.folder.remove('Notes.md');
        h.folder.writeText('Kingdoms/Notes.md', notes);
        h.folder.writeText('Kingdoms/Brand new.md', 'Created on disk.');
        h.folder.resetLog();

        const report = await h.link.syncNow();

        const state = h.store.getState();
        expect(entry(state, 'alder').native.content).toBe('Edited in Obsidian.');
        expect(entry(state, 'alder').native.key).toEqual(['river', 'bridge']);
        expect(entry(state, 'varn').name).toBe('Varn family');
        expect(findNode(state, 'notes')?.parentId).toBe('kingdoms');
        const kingdoms = findNode(state, 'kingdoms') as FolderNode;
        const created = kingdoms.children.find((child) => child.name === 'Brand new');
        expect(created?.kind).toBe('entry');
        expect(h.decisions.deletions).toBe(0);
        // Files arriving from disk are never rewritten by the pull itself.
        expect(h.folder.writes).toEqual([]);
        expect(report?.counts.created).toBeGreaterThanOrEqual(1);
        expect(h.calls).toContain('refreshStructure');
    });

    it('keeps the default order after a rename on disk (no record invented)', async () => {
        const h = harness(workspace());
        await h.link.link();
        const text = h.folder.readText('Kingdoms/Aldermeer.md')!;
        await h.folder.remove('Kingdoms/Aldermeer.md');
        h.folder.writeText('Kingdoms/Zeta city.md', text);
        h.folder.resetLog();
        await h.link.syncNow();
        const kingdoms = findNode(h.store.getState(), 'kingdoms') as FolderNode;
        expect(kingdoms.children.map((child) => child.name)).toEqual(['House Varn', 'Zeta city']);
        expect(h.folder.writes).toEqual([]);
    });

    it('pulls on workspace open', async () => {
        const h = harness(workspace());
        await h.link.link();
        h.folder.writeText('Notes.md', 'Changed while closed.');
        await h.link.onWorkspaceOpened({ userActivation: false });
        expect(entry(h.store.getState(), 'notes').native.content).toBe('Changed while closed.');
    });
});

describe('md link — conflicts and deletions (US3 sc. 4–6)', () => {
    it('holds back an auto-write over a disk change and resolves it per decision', async () => {
        for (const decide of ['skip', 'keep-disk', 'keep-workspace'] as const) {
            const h = harness(workspace());
            await h.link.link();
            h.folder.writeText('Notes.md', 'Disk version.');
            await h.edit((s) => commitEntryField(s, 'notes', 'content', 'Workspace version.'));
            expect(h.folder.readText('Notes.md')).toBe('Disk version.');
            expect(h.link.getStatus().heldBack).toBe(1);

            h.decisions.decide = decide;
            await h.link.syncNow();
            expect(h.decisions.conflicts[0]).toHaveLength(1);
            const content = entry(h.store.getState(), 'notes').native.content;
            const file = h.folder.readText('Notes.md');
            if (decide === 'skip') {
                expect([content, file]).toEqual(['Workspace version.', 'Disk version.']);
            } else if (decide === 'keep-disk') {
                expect([content, file]).toEqual(['Disk version.', 'Disk version.']);
            } else {
                expect([content, file]).toEqual(['Workspace version.', 'Workspace version.']);
            }
        }
    });

    it('confirms disk deletions; declining writes the files again', async () => {
        const declined = harness(workspace());
        await declined.link.link();
        await declined.folder.remove('Kingdoms');
        declined.decisions.confirmDeletes = false;
        await declined.link.syncNow();
        expect(declined.decisions.deletions).toBe(1);
        expect(findNode(declined.store.getState(), 'kingdoms')).toBeDefined();
        expect(declined.folder.filePaths()).toEqual(['Kingdoms/Aldermeer.md', 'Kingdoms/House Varn.md', 'Notes.md']);

        const confirmed = harness(workspace());
        await confirmed.link.link();
        await confirmed.folder.remove('Kingdoms');
        await confirmed.link.syncNow();
        expect(findNode(confirmed.store.getState(), 'kingdoms')).toBeUndefined();
        expect(findNode(confirmed.store.getState(), 'alder')).toBeUndefined();
        expect(confirmed.folder.filePaths()).toEqual(['Notes.md']);
    });
});

describe('md link — idempotence, access, plain vaults', () => {
    it('changes nothing on repeated syncs without edits (SC-005)', async () => {
        const h = harness(workspace());
        await h.link.link();
        const snapshot = h.folder.snapshot();
        let updates = 0;
        h.store.subscribe(() => (updates += 1));
        h.folder.resetLog();
        await h.link.syncNow();
        await h.link.syncNow();
        expect(h.folder.writes).toEqual([]);
        expect(h.folder.removals).toEqual([]);
        expect(h.folder.snapshot()).toEqual(snapshot);
        expect(updates).toBe(0);
    });

    it('waits for a reconnect when access needs confirmation', async () => {
        const h = harness(workspace());
        await h.link.link();
        h.access.access = 'prompt';
        h.folder.writeText('Notes.md', 'Offline edit.');
        await h.link.onWorkspaceOpened({ userActivation: false });
        expect(h.link.getStatus().phase).toBe('needs-reconnect');
        expect(entry(h.store.getState(), 'notes').native.content).toBe('Plain notes.');
        await h.link.reconnect();
        expect(h.access.requested).toBe(1);
        expect(h.link.getStatus().phase).toBe('linked');
        expect(entry(h.store.getState(), 'notes').native.content).toBe('Offline edit.');
    });

    it('restores the stored link after a restart', async () => {
        const h = harness(workspace());
        await h.link.link();
        const again = createMdLink({
            store: h.store,
            sync: syncStub().stub,
            access: h.access,
            imageStore: new MemoryImageStore(),
            digest,
            yaml: () => nodeYaml,
            decisions: { confirmLink: async () => true, resolveConflicts: async () => new Map(), confirmDeletions: async () => true },
            resolveImage: async () => null,
            designate: async () => undefined,
            newId: () => `r-${++seq}`,
        });
        await again.init();
        expect(again.getStatus()).toMatchObject({ phase: 'linked', folderName: 'vault' });
        h.folder.resetLog();
        await again.syncNow();
        expect(h.folder.writes).toEqual([]);
    });

    it('links a plain vault and leaves every file untouched (FR-023)', async () => {
        const folder = new MemoryDiskFolder();
        folder.writeText('A note.md', '# Heading\nText');
        folder.writeText('Sub/Other.md', '---\ntags: [x]\n---\nBody without blank line');
        folder.writeText('.obsidian/workspace.json', '{}');
        const before = folder.snapshot();
        const h = harness(stateWith([]), folder);
        await h.link.link();
        await h.link.syncNow();
        await h.link.syncNow();
        expect(folder.snapshot()).toEqual(before);
        const root = h.store.getState().root;
        expect(root.children.map((child) => child.name).sort()).toEqual(['A note', 'Sub']);
    });
});

describe('md link — interruption (FR-016)', () => {
    it('completes after a failed write on the next sync', async () => {
        const reference = harness(workspace());
        await reference.link.link();
        const expected = reference.folder.snapshot();

        for (let n = 1; n <= 4; n++) {
            const h = harness(workspace());
            h.folder.failOnWrite(n);
            await h.link.link();
            h.folder.clearFaults();
            await h.link.syncNow();
            expect(h.folder.snapshot(), `failure at write ${n}`).toEqual(expected);
        }
    });
});

describe('md link — scale (SC-006)', () => {
    it('links 300 nested entries and syncs 50 disk edits with visible progress', async () => {
        const folders = Array.from({ length: 10 }, (_, f) =>
            folderNode(
                `f${f}`,
                `Region ${f}`,
                Array.from({ length: 30 }, (_, e) => entryNode(`e${f}-${e}`, `Entry ${f}-${e}`, { content: `Body ${f}-${e}`, key: [`k${e}`] }))
            )
        );
        const h = harness(stateWith(folders));
        await h.link.link();
        expect(h.folder.filePaths()).toHaveLength(300);

        for (let i = 0; i < 50; i++) {
            const f = i % 10;
            const e = Math.floor(i / 10);
            h.folder.writeText(`Region ${f}/Entry ${f}-${e}.md`, `---\nwi_keys: [k${e}]\n---\n\nEdited ${i}`);
        }
        const progress: number[] = [];
        const off = h.link.subscribe(() => {
            const busy = h.link.getStatus().busy;
            if (busy && busy.label === 'Reading folder' && busy.total > 0) {
                progress.push(busy.done);
            }
        });
        const started = Date.now();
        await h.link.syncNow();
        off();
        expect(Date.now() - started).toBeLessThan(3000);
        expect(progress.length).toBeGreaterThanOrEqual(300 / 25);
        for (let i = 0; i < 50; i++) {
            const f = i % 10;
            const e = Math.floor(i / 10);
            expect(entry(h.store.getState(), `e${f}-${e}`).native.content).toBe(`Edited ${i}`);
        }
    });
});
