// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NativeWorldInfoEntry, SillyTavernContext, WorldInfoBook } from '../../src/global';
import {
    createDefaultState,
    migrate,
    createEntryNode,
    createFolderNode,
    createImageNode,
} from '../../src/core/state/schema';
import { WorkspaceStore } from '../../src/core/state/store';
import { createWorldInfoAdapter } from '../../src/adapters/worldInfoAdapter';
import { createSyncEngine, type SyncEngine } from '../../src/adapters/syncEngine';
import { fingerprintEntry } from '../../src/core/sync/fingerprint';

/**
 * Integration harness: the REAL sync engine + adapters driven against a host
 * fake that mirrors the app's verified mechanics (research R1):
 * - loadWorldInfo clones on get (StructuredCloneMap cloneOnGet),
 * - saveWorldInfo stores the CALLER'S reference (cloneOnSet: false) and emits
 *   WORLDINFO_UPDATED(name, data) with that same reference,
 * - world_names updates through updateWorldInfoList.
 * No human in the loop: every scenario below is one of the user's manual steps.
 */

const EVENTS = {
    APP_READY: 'app_ready',
    CHAT_CHANGED: 'chat_id_changed',
    GENERATION_STARTED: 'generation_started',
    SETTINGS_LOADED: 'settings_loaded',
    SETTINGS_UPDATED: 'settings_updated',
    EXTENSION_SETTINGS_LOADED: 'extension_settings_loaded',
    WORLDINFO_UPDATED: 'worldinfo_updated',
    WORLDINFO_SETTINGS_UPDATED: 'worldinfo_settings_updated',
} as const;

type Handler = (...args: unknown[]) => void;

class FakeHost {
    books = new Map<string, WorldInfoBook>();
    world_names: string[] = [];
    extensionSettings: Record<string, unknown> = {};
    savedSettings = 0;
    private handlers = new Map<string, Set<Handler>>();

    eventTypes = EVENTS;

    eventSource = {
        on: (event: string, handler: Handler): void => {
            const set = this.handlers.get(event) ?? new Set<Handler>();
            set.add(handler);
            this.handlers.set(event, set);
        },
        makeFirst: (): void => undefined,
        makeLast: (): void => undefined,
        removeListener: (event: string, handler: Handler): void => {
            this.handlers.get(event)?.delete(handler);
        },
        emit: async (event: string, ...args: unknown[]): Promise<void> => {
            for (const handler of [...(this.handlers.get(event) ?? [])]) {
                handler(...args);
            }
        },
    };

    saveSettingsDebounced = (): void => {
        this.savedSettings += 1;
    };

    uuidv4 = (): string => `u-${(this.uuidCounter += 1)}`;
    private uuidCounter = 0;

    getRequestHeaders = (): Record<string, string> => ({});

    // cloneOnGet: true (StructuredCloneMap)
    loadWorldInfo = async (name: string): Promise<WorldInfoBook | null> => {
        const book = this.books.get(name);
        return book ? (structuredClone(book) as WorldInfoBook) : null;
    };

    // cloneOnSet: false — cache keeps the caller's reference; emit same reference
    saveWorldInfo = async (name: string, data: WorldInfoBook): Promise<void> => {
        this.books.set(name, data);
        await this.eventSource.emit(EVENTS.WORLDINFO_UPDATED, name, data);
    };

    updateWorldInfoList = async (): Promise<void> => {
        this.world_names = [...this.books.keys()];
    };

    getWorldInfoNames = (): string[] => [...this.world_names];

    callGenericPopup = async (): Promise<number | null> => 1;
    POPUP_TYPE = { TEXT: 1, CONFIRM: 2, INPUT: 3, DISPLAY: 4, CROP: 5 };
    POPUP_RESULT = { AFFIRMATIVE: 1, NEGATIVE: 0, CANCELLED: null };
    substituteParams = (text: string): string => text;
    powerUserSettings = {};

    /** Simulates a NATIVE editor save (different object reference). */
    async nativeSave(name: string, mutate: (book: WorldInfoBook) => void): Promise<void> {
        const current = await this.loadWorldInfo(name);
        if (!current) {
            throw new Error(`nativeSave: unknown book ${name}`);
        }
        mutate(current);
        this.books.set(name, current); // host cache stores the emitted object
        await this.eventSource.emit(EVENTS.WORLDINFO_UPDATED, name, current);
    }
}

interface Rig {
    host: FakeHost;
    ctx: SillyTavernContext;
    store: WorkspaceStore;
    engine: SyncEngine;
    advanceTimers(ms?: number): Promise<void>;
}

function buildRig(): Rig {
    const host = new FakeHost();
    const ctx = host as unknown as SillyTavernContext;
    const store = new WorkspaceStore(createDefaultState());
    const worldInfo = createWorldInfoAdapter(ctx);
    const engine = createSyncEngine({ ctx, store, worldInfo });
    return {
        host,
        ctx,
        store,
        engine,
        advanceTimers: async (ms = 1100) => {
            await vi.advanceTimersByTimeAsync(ms);
        },
    };
}

const NOW = '2026-09-08T00:00:00.000Z';

/** Adds root 'R' (WI root bound to 'Book') with one in-sync entry (uid 5). */
function seedSyncedRoot(rig: Rig, bookName = 'Book'): string {
    const state = rig.store.getState();
    const root = createFolderNode({ id: 'R', parentId: state.root.id, name: 'Root', now: NOW });
    root.isWiRoot = true;
    root.book = { bookName, orphans: [], tombstones: [] };
    const entry = createEntryNode({ id: 'e1', parentId: 'R', name: 'Alpha', now: NOW, nativeUid: 5 });
    entry.sync = {
        books: {
            [bookName]: { uid: 5, hash: fingerprintEntry(entry.native), status: 'in-sync' },
        },
    };
    root.children.push(entry);
    rig.store.update((draft) => {
        draft.root.children.push(root);
    });
    rig.host.books.set(bookName, {
        entries: { '5': structuredClone(entry.native) },
    });
    void rig.host.updateWorldInfoList();
    return bookName;
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('sync engine integration (FakeWorldHost)', () => {
    it('A: workspace edit reaches the native book (debounced push)', async () => {
        const rig = buildRig();
        seedSyncedRoot(rig);

        rig.store.update((draft) => {
            const node = draft.root.children[0]!;
            if (node.kind === 'folder') {
                const entry = node.children[0]!;
                if (entry.kind === 'entry') {
                    entry.native.content = 'workspace edit';
                    entry.sync.books['Book']!.status = 'dirty';
                }
            }
        });
        await rig.advanceTimers();

        const book = rig.host.books.get('Book')!;
        expect(book.entries['5']?.content).toBe('workspace edit');
        const entry = rig.store.getState().root.children[0]!;
        expect(
            entry.kind === 'folder' &&
                entry.children[0]!.kind === 'entry' &&
                ((entry.children[0] as { sync: { books: Record<string, { status: string }> } }).sync.books['Book']
                    ?.status ?? 'new')
        ).toBe('in-sync');
    });

    it('B: native edit of a clean entry refreshes the workspace silently (no banner)', async () => {
        const rig = buildRig();
        seedSyncedRoot(rig);

        await rig.host.nativeSave('Book', (book) => {
            book.entries['5']!.content = 'native edit';
            book.entries['5']!.comment = 'Renamed natively';
        });
        await rig.advanceTimers();

        const root = rig.store.getState().root.children[0]!;
        const entry =
            root.kind === 'folder'
                ? (root.children[0] as {
                      kind: string;
                      native: { content: string; comment: string };
                      name: string;
                      sync: { books: Record<string, { status: string }> };
                  })
                : null;
        expect(entry?.native.content).toBe('native edit');
        expect(entry?.name).toBe('Renamed natively');
        expect(entry?.sync.books['Book']?.status).toBe('in-sync');
        expect(rig.engine.getReports().size).toBe(0);
    });

    it('C: native ADD is auto-imported with its uid (no duplicates, no banner)', async () => {
        const rig = buildRig();
        seedSyncedRoot(rig);

        const alien = createEntryNode({
            id: 'alien',
            parentId: 'R',
            name: 'Native made',
            now: NOW,
            nativeUid: 9,
        });
        alien.native.comment = 'Native made';
        await rig.host.nativeSave('Book', (book) => {
            book.entries['9'] = structuredClone(alien.native);
        });
        await rig.advanceTimers();

        const root = rig.store.getState().root.children[0]!;
        if (root.kind !== 'folder') {
            throw new Error('expected folder');
        }
        const entries = root.children.filter((node) => node.kind === 'entry');
        expect(entries).toHaveLength(2);
        const uids = entries
            .map((node) => (node.kind === 'entry' ? (node.sync.books['Book']?.uid ?? null) : null))
            .sort();
        expect(uids).toEqual([5, 9]);
        expect(rig.engine.getReports().size).toBe(0);
    });

    it('D: workspace delete is honored — tombstone prevents resurrection, push removes the native copy', async () => {
        const rig = buildRig();
        seedSyncedRoot(rig);

        rig.store.update((draft) => {
            const root = draft.root.children[0]!;
            if (root.kind === 'folder') {
                root.children.splice(0, 1);
            }
        });
        rig.engine.recordEntityDeletions([{ bookName: 'Book', uid: 5 }]);
        rig.engine.markBooksDirty(['Book']);
        await rig.advanceTimers();

        const book = rig.host.books.get('Book')!;
        expect(book.entries['5']).toBeUndefined();
        expect(book.entries).toEqual({});
        const root = rig.store.getState().root.children[0]!;
        expect(root.kind === 'folder' && root.book?.tombstones).toEqual([]);
    });

    it('D2: deletion intent survives the UI delete order (record → replace-from-current)', async () => {
        const rig = buildRig();
        seedSyncedRoot(rig);

        // Fixed UI order: record tombstones (store.update), then replace built
        // from the CURRENT state (thunk-based applyOperation) — never from a
        // stale render snapshot, which would erase the tombstone and let the
        // auto-merge resurrect the deleted entity.
        rig.engine.recordEntityDeletions([{ bookName: 'Book', uid: 5 }]);
        const current = rig.store.getState();
        const currentRoot = current.root.children[0]!;
        if (currentRoot.kind === 'folder') {
            currentRoot.children = currentRoot.children.filter((node) => node.id !== 'e1');
        }
        rig.store.replace(current);

        const root = rig.store.getState().root.children[0]!;
        expect(root.kind === 'folder' && (root.book?.tombstones ?? [])).toEqual([5]);

        rig.engine.markBooksDirty(['Book']);
        await rig.advanceTimers();
        const book = rig.host.books.get('Book')!;
        expect(book.entries['5']).toBeUndefined();
        const after = rig.store.getState().root.children[0]!;
        expect(after.kind === 'folder' && after.children.some((node) => node.id === 'e1')).toBe(false);
    });

    it('E: native delete of a clean entry mirrors into the workspace; dirty copies survive', async () => {
        const rig = buildRig();
        seedSyncedRoot(rig);
        rig.store.update((draft) => {
            const root = draft.root.children[0]!;
            if (root.kind === 'folder') {
                const dirty = createEntryNode({
                    id: 'e2',
                    parentId: 'R',
                    name: 'Dirty',
                    now: NOW,
                    nativeUid: 6,
                });
                dirty.sync = {
                    books: { Book: { uid: 6, hash: 'stale', status: 'dirty' } },
                };
                root.children.push(dirty);
            }
        });

        await rig.host.nativeSave('Book', (book) => {
            delete book.entries['5'];
            delete book.entries['6'];
        });
        await rig.advanceTimers();

        const root = rig.store.getState().root.children[0]!;
        if (root.kind !== 'folder') {
            throw new Error('expected folder');
        }
        const ids = root.children.map((node) => node.id);
        expect(ids).toEqual(['e2']); // clean mirrors out, dirty survives
    });

    it('F: both-sides-edited blocks with a banner (conflict), resolution applies', async () => {
        const rig = buildRig();
        seedSyncedRoot(rig);
        rig.store.update((draft) => {
            const root = draft.root.children[0]!;
            if (root.kind === 'folder') {
                const entry = root.children[0]!;
                if (entry.kind === 'entry') {
                    entry.native.content = 'workspace version';
                    entry.sync.books['Book']!.status = 'dirty';
                }
            }
        });
        await rig.host.nativeSave('Book', (book) => {
            book.entries['5']!.content = 'native version';
        });

        await rig.engine.pushPendingNow('test');
        const report = rig.engine.getReports().get('Book');
        expect(report?.blocked).toBe(true);
        expect(report?.driftedUids).toEqual([5]);

        const plan = await rig.engine.planBoundImportFor('Book');
        expect(plan?.conflicts).toHaveLength(1);
        await rig.engine.applyBoundImport('Book', plan!, new Map([['e1', 'take-native' as const]]));
        const root = rig.store.getState().root.children[0]!;
        const entry = root.kind === 'folder' ? root.children[0] : null;
        expect(entry?.kind === 'entry' && entry.native.content).toBe('native version');
        expect(entry?.kind === 'entry' && entry.sync.books['Book']?.status).toBe('in-sync');
    });

    it('G: adopt merges the native book ONCE — re-import adds nothing (no duplicate folders/entities)', async () => {
        const rig = buildRig();
        const seed = createEntryNode({ id: 't', parentId: 'x', name: 'x', now: NOW, nativeUid: 1 });
        seed.native.comment = 'First';
        rig.host.books.set('Alder', { entries: { '1': structuredClone(seed.native) } });
        await rig.host.updateWorldInfoList();
        rig.store.update((draft) => {
            draft.root.children.push(
                createFolderNode({ id: 'F', parentId: draft.root.id, name: 'Alder', now: NOW })
            );
        });

        await rig.engine.designateRoot('F', 'adopt', 'Alder');
        const plan1 = await rig.engine.planBoundImportFor('Alder');
        await rig.engine.applyBoundImport('Alder', plan1!, new Map());

        const root = rig.store.getState().root.children[0]!;
        if (root.kind !== 'folder') {
            throw new Error('expected folder');
        }
        expect(root.children).toHaveLength(1);
        expect(
            root.children[0]!.kind === 'entry' && root.children[0]!.sync.books['Alder']?.uid
        ).toBe(1);

        // Re-import must be a no-op (identity by uid), not a second folder/copy.
        await rig.engine.importUnboundBook('Alder').catch(() => undefined);
        const roots = rig.store.getState().root.children.filter(
            (node) => node.kind === 'folder' && node.isWiRoot
        );
        expect(roots).toHaveLength(1);
        expect(root.children).toHaveLength(1);
    });

    it('H: raw native entries missing fields (no role) never block the push', async () => {
        const rig = buildRig();
        const bookName = seedSyncedRoot(rig);
        rig.host.books.set(bookName, {
            entries: {
                '5': { uid: 5, key: [], comment: 'Raw', content: 'x' } as unknown as NativeWorldInfoEntry,
            },
        });

        rig.engine.markBooksDirty([bookName]);
        await rig.advanceTimers();

        const book = rig.host.books.get(bookName)!;
        const entry = book.entries['5']!;
        expect((entry as { role?: number }).role).toBe(0);
        expect((entry as { position?: number }).position).toBe(0);
        expect(Object.keys(book.entries)).toEqual(['5']);
    });

    it('I: book file deleted natively (updateWorldInfoList drop) — loadBook gate reports missing, no crash', async () => {
        const rig = buildRig();
        seedSyncedRoot(rig);
        rig.host.books.delete('Book');
        rig.host.world_names = rig.host.world_names.filter((name) => name !== 'Book');

        rig.engine.markBooksDirty(['Book']);
        await rig.advanceTimers();
        expect(rig.store.getState().root.children).toHaveLength(1);
    });

    it('K: workspace-created entity under a fresh root reaches the book (trace regression)', async () => {
        const rig = buildRig();
        const root = createFolderNode({ id: 'R', parentId: 'workspace-root', name: 'The new being', now: NOW });
        rig.store.update((draft) => {
            draft.root.children.push(root);
        });
        rig.host.books.set('Seed', { entries: {} });
        await rig.host.updateWorldInfoList();

        await rig.engine.designateRoot('R', 'create');
        const entry = createEntryNode({
            id: 'e1',
            parentId: 'R',
            name: 'New being',
            now: NOW,
            nativeUid: 900001,
        });
        rig.store.update((draft) => {
            const r = draft.root.children[0]!;
            if (r.kind === 'folder') {
                entry.parentId = r.id;
                r.children.push(entry);
            }
        });
        await rig.advanceTimers();

        const book = rig.host.books.get('The new being')!;
        expect(Object.keys(book.entries).length).toBeGreaterThanOrEqual(1);
        const pushed = Object.values(book.entries)[0]!;
        expect(pushed.role).toBe(0);
        expect(pushed.comment).toBe('New being');
        const after = rig.store.getState().root.children[0]!;
        const child =
            after.kind === 'folder'
                ? (after.children[0] as { sync: { books: Record<string, { status: string }> } })
                : null;
        expect(child?.sync.books['The new being']?.status).toBe('in-sync');
    });

    it('L: native editor re-save with role NaN → silent heal, push proceeds, no banner (trace regression)', async () => {
        const rig = buildRig();
        seedSyncedRoot(rig);

        await rig.host.nativeSave('Book', (book) => {
            (book.entries['5'] as unknown as Record<string, unknown>)['role'] = Number.NaN;
            book.entries['5']!.content = 'edited natively';
        });
        await rig.advanceTimers();

        const root = rig.store.getState().root.children[0]!;
        const entry =
            root.kind === 'folder'
                ? (root.children[0] as { kind: string; native: { role: number; content: string }; sync: { books: Record<string, { status: string }> } })
                : null;
        expect(entry?.native.role).toBe(0); // healed by normalization
        expect(entry?.native.content).toBe('edited natively');
        expect(entry?.sync.books['Book']?.status).toBe('in-sync');
        expect(rig.engine.getReports().size).toBe(0);

        // A workspace write pushes the healed entry back into the book.
        rig.store.update((draft) => {
            const r = draft.root.children[0]!;
            if (r.kind === 'folder') {
                const e = r.children[0]!;
                if (e.kind === 'entry') {
                    e.native.content = 'workspace touch';
                    e.sync.books['Book']!.status = 'dirty';
                }
            }
        });
        await rig.advanceTimers();
        const book = rig.host.books.get('Book')!;
        expect((book.entries['5'] as unknown as { role: number }).role).toBe(0);
    });

    it('N: adopt → first push never wipes the adopted book (merge-under-force regression)', async () => {
        const rig = buildRig();
        const seed = createEntryNode({ id: 't', parentId: 'x', name: 'x', now: NOW, nativeUid: 1 });
        seed.native.comment = 'Native lore';
        rig.host.books.set('Alder', { entries: { '1': structuredClone(seed.native) } });
        await rig.host.updateWorldInfoList();
        rig.store.update((draft) => {
            draft.root.children.push(
                createFolderNode({ id: 'F', parentId: draft.root.id, name: 'Alder', now: NOW })
            );
        });

        await rig.engine.designateRoot('F', 'adopt', 'Alder');
        await rig.advanceTimers();

        const book = rig.host.books.get('Alder')!;
        expect(book.entries['1']).toBeDefined();
        const root = rig.store.getState().root.children[0]!;
        expect(root.kind === 'folder' && root.children).toHaveLength(1);
    });
});

describe('images and nested WI (workspace-only images; two-book intersection)', () => {
    it('M: images are workspace-only — never exported, never counted as entries', async () => {
        const rig = buildRig();
        const root = createFolderNode({ id: 'R', parentId: 'workspace-root', name: 'Root', now: NOW });
        const entry = createEntryNode({ id: 'e1', parentId: 'R', name: 'Text', now: NOW, nativeUid: 1 });
        const image = createImageNode({ id: 'img1', parentId: 'R', name: 'Map', now: NOW });
        image.src = 'https://x/map.png';
        image.caption = 'The Span';
        root.children.push(entry, image);
        rig.store.update((draft) => {
            draft.root.children.push(root);
        });

        await rig.engine.designateRoot('R', 'create');
        await rig.advanceTimers();
        const stateRoot = rig.store.getState().root.children[0]!;
        if (stateRoot.kind !== 'folder') {
            throw new Error('expected folder');
        }
        const bookName = stateRoot.book?.bookName ?? '';
        expect(bookName).not.toBe('');
        const book = rig.host.books.get(bookName);
        expect(book).toBeDefined();
        // ONLY the entry exports; the image is workspace-only.
        const values = Object.values(book!.entries);
        expect(values).toHaveLength(1);
        expect(values[0]!.comment).toBe('Text');

        // Deleting the image does not touch the book at all.
        rig.store.update((draft) => {
            const r = draft.root.children[0]!;
            if (r.kind === 'folder') {
                r.children = r.children.filter((node) => node.id !== 'img1');
            }
        });
        await rig.advanceTimers();
        expect(Object.values(rig.host.books.get(bookName)!.entries)).toHaveLength(1);
    });

    it('M2: nested WI — an entry under a nested root appears in BOTH books and mirrors natively', async () => {
        const rig = buildRig();
        const parent = createFolderNode({ id: 'P', parentId: 'workspace-root', name: 'World', now: NOW });
        const nested = createFolderNode({ id: 'N', parentId: 'P', name: 'Region', now: NOW });
        parent.children.push(nested);
        rig.store.update((draft) => {
            draft.root.children.push(parent);
        });

        await rig.engine.designateRoot('P', 'create');
        await rig.engine.designateRoot('N', 'create');
        const entry = createEntryNode({ id: 'e1', parentId: 'N', name: 'Shared', now: NOW, nativeUid: 900001 });
        rig.store.update((draft) => {
            const n = draft.root.children[0]!;
            if (n.kind === 'folder') {
                const nestedNode = n.children[0]!;
                if (nestedNode.kind === 'folder') {
                    entry.parentId = nestedNode.id;
                    nestedNode.children.push(entry);
                }
            }
        });
        await rig.advanceTimers();

        const parentBook = rig.host.books.get('World')!;
        const nestedBook = rig.host.books.get('Region')!;
        expect(Object.values(parentBook.entries)).toHaveLength(1);
        expect(Object.values(nestedBook.entries)).toHaveLength(1);
        const regionUid = Object.keys(nestedBook.entries)[0]!;

        // Native edit of the shared entry mirrors into the workspace, and both
        // books reflect it after the next workspace-side push.
        await rig.host.nativeSave('Region', (book) => {
            book.entries[regionUid]!.content = 'native edit';
        });
        await rig.advanceTimers();
        rig.store.update((draft) => {
            const n = draft.root.children[0]!;
            if (n.kind === 'folder') {
                const nestedNode = n.children[0]!;
                if (nestedNode.kind === 'folder') {
                    const e = nestedNode.children[0]!;
                    if (e.kind === 'entry') {
                        e.sync.books['World']!.status = 'dirty';
                    }
                }
            }
        });
        await rig.advanceTimers();
        expect(rig.host.books.get('World')!.entries[regionUid]!.content).toBe('native edit');
        expect(rig.host.books.get('Region')!.entries[regionUid]!.content).toBe('native edit');
    });
});

describe('moves across WI boundaries and reload stability', () => {
    it('P: move-in exports the entity; move-out removes it from the book (tombstone)', async () => {
        const rig = buildRig();
        // Root 'R' (WI root) + a plain folder 'Holding' outside it.
        const root = createFolderNode({ id: 'R', parentId: 'workspace-root', name: 'Root', now: NOW });
        const holding = createFolderNode({ id: 'H', parentId: 'workspace-root', name: 'Holding', now: NOW });
        const entry = createEntryNode({ id: 'e1', parentId: 'H', name: 'Nomad', now: NOW, nativeUid: 900001 });
        root.children.push();
        holding.children.push(entry);
        rig.store.update((draft) => {
            draft.root.children.push(root, holding);
        });

        // Designate R as a WI root first (creates + binds an empty book).
        await rig.engine.designateRoot('R', 'create');
        await rig.advanceTimers();

        // Move the entity INTO the root → the book gains it.
        rig.store.update((draft) => {
            const from = draft.root.children[1]!;
            if (from.kind === 'folder') {
                const moved = from.children.splice(0, 1)[0]!;
                moved.parentId = 'R';
                const to = draft.root.children[0]!;
                if (to.kind === 'folder') {
                    to.children.push(moved);
                }
            }
        });
        rig.engine.refreshStructure();
        await rig.advanceTimers();

        const stateRoot = rig.store.getState().root.children[0]!;
        if (stateRoot.kind !== 'folder') {
            throw new Error('expected folder');
        }
        const bookName = stateRoot.book?.bookName ?? '';
        const book = rig.host.books.get(bookName)!;
        expect(Object.values(book.entries)).toHaveLength(1);

        // Move it back OUT → tombstone → the next push removes it.
        rig.store.update((draft) => {
            const from = draft.root.children[0]!;
            if (from.kind === 'folder') {
                const moved = from.children.splice(0, 1)[0]!;
                moved.parentId = 'H';
                const to = draft.root.children[1]!;
                if (to.kind === 'folder') {
                    to.children.push(moved);
                }
            }
        });
        rig.engine.refreshStructure();
        await rig.advanceTimers();
        expect(Object.values(rig.host.books.get(bookName)!.entries)).toHaveLength(0);
        // The entity lives on in the workspace, un-synced.
        const holding2 = rig.store.getState().root.children[1]!;
        expect(holding2.kind === 'folder' && holding2.children).toHaveLength(1);
    });

    it('Q: reload round-trip — migrate(JSON(state)) never triggers recovery (incl. legacy v1 sync)', async () => {
        const rig = buildRig();
        seedSyncedRoot(rig);
        const serialized = JSON.parse(JSON.stringify(rig.store.getState()));

        const migrated = migrate(serialized);
        expect(migrated._recovered).toBeUndefined();
        expect(migrated.root.children).toHaveLength(1);

        // Legacy v1 sync shape must migrate to per-book v2, not fail.
        const legacyRaw = {
            version: 1,
            root: {
                id: 'workspace-root',
                parentId: null,
                kind: 'folder',
                name: 'Workspace',
                createdAt: NOW,
                updatedAt: NOW,
                expanded: true,
                isWiRoot: false,
                book: null,
                children: [
                    {
                        id: 'R',
                        parentId: 'workspace-root',
                        kind: 'folder',
                        name: 'Root',
                        createdAt: NOW,
                        updatedAt: NOW,
                        expanded: true,
                        isWiRoot: true,
                        book: { bookName: 'Book', orphans: [] },
                        children: [
                            {
                                id: 'e1',
                                parentId: 'R',
                                kind: 'entry',
                                name: 'Old',
                                createdAt: NOW,
                                updatedAt: NOW,
                                native: { uid: 5, key: [], comment: 'Old', content: '' },
                                sync: {
                                    bookName: 'Book',
                                    uid: 5,
                                    status: 'in-sync',
                                    lastExportedHash: 'h',
                                    lastExportedAt: NOW,
                                    nativeDrift: false,
                                },
                            },
                        ],
                    },
                ],
            },
            settings: { sortMode: 'custom' },
        };
        const migratedLegacy = migrate(legacyRaw);
        expect(migratedLegacy._recovered).toBeUndefined();
        const legacyEntry = migratedLegacy.root.children[0]!;
        expect(
            legacyEntry.kind === 'folder' &&
                legacyEntry.children[0]!.kind === 'entry' &&
                legacyEntry.children[0]!.sync.books['Book']?.uid
        ).toBe(5);
    });

    it('R: deleting a folder inside a root removes its entries from the parent book', async () => {
        const rig = buildRig();
        const root = createFolderNode({ id: 'R', parentId: 'workspace-root', name: 'Root', now: NOW });
        const folder = createFolderNode({ id: 'F', parentId: 'R', name: 'Group', now: NOW });
        const entry = createEntryNode({ id: 'e1', parentId: 'F', name: 'Doomed', now: NOW, nativeUid: 900001 });
        const keeper = createEntryNode({ id: 'e2', parentId: 'R', name: 'Keeper', now: NOW, nativeUid: 900002 });
        root.children.push(folder, keeper);
        folder.children.push(entry);
        rig.store.update((draft) => {
            draft.root.children.push(root);
        });

        await rig.engine.designateRoot('R', 'create');
        await rig.advanceTimers();
        const stateRoot = rig.store.getState().root.children[0]!;
        if (stateRoot.kind !== 'folder') {
            throw new Error('expected folder');
        }
        const bookName = stateRoot.book?.bookName ?? '';
        expect(Object.values(rig.host.books.get(bookName)!.entries)).toHaveLength(2);

        // The UI delete order: tombstones over the subtree, then bulk delete.
        const deletions: Array<{ bookName: string; uid: number }> = [];
        const doomed = rig.store.getState().root.children[0]!;
        if (doomed.kind === 'folder') {
            const doomedFolder = doomed.children[0]!;
            const walk = (node: typeof doomedFolder): void => {
                if (node.kind === 'entry') {
                    for (const [bookName, bookSync] of Object.entries(node.sync.books)) {
                        if (bookSync.uid !== null) {
                            deletions.push({ bookName, uid: bookSync.uid });
                        }
                    }
                    return;
                }
                if (node.kind === 'folder') {
                    node.children.forEach(walk);
                }
            };
            walk(doomedFolder);
        }
        rig.engine.recordEntityDeletions(deletions);
        rig.store.update((draft) => {
            const r = draft.root.children[0]!;
            if (r.kind === 'folder') {
                r.children = r.children.filter((node) => node.id !== 'F');
            }
        });
        rig.engine.markBooksDirty([bookName]);
        await rig.advanceTimers();

        const book = rig.host.books.get(bookName)!;
        const comments = Object.values(book.entries).map((entry) => entry.comment);
        expect(comments).toEqual(['Keeper']);
    });

    it('S: leftover _recovered from an earlier recovery does not re-trigger the warning', async () => {
        const rig = buildRig();
        seedSyncedRoot(rig);
        const serialized = JSON.parse(JSON.stringify(rig.store.getState()));
        // Simulate the stuck state: a valid payload that carries a stale
        // `_recovered` key from a previous recovery.
        (serialized as { _recovered: unknown })._recovered = { version: 1, root: {} };

        const migrated = migrate(serialized);
        expect(migrated._recovered).toBeUndefined();
        expect(migrated.root.children).toHaveLength(1);
    });
});
