import { debugLog, notifyWarning } from './logger';
import { emitSaveEvent } from './saveEvents';
import { confirmDialog } from './popups';
import type { WorldInfoBook } from '../global';
import type { WorkspaceStore } from '../core/state/store';
import {
    buildNodeIndex,
    findNode,
    type EntryNode,
    type FolderNode,
    type TreeNode,
    type WorkspaceState,
} from '../core/state/schema';
import type { WorldInfoAdapter } from './worldInfoAdapter';
import { flattenRoot } from '../core/sync/flatten';
import { analyzeNativeBook } from '../core/sync/divergence';
import { mapBookToNodes, planBoundImport, type BoundImportPlan } from '../core/sync/import';
import { fingerprintEntry } from '../core/sync/fingerprint';
import { nameInUse } from '../core/sync/bookNaming';
import { normalizeNativeEntry } from '../core/state/schema';
import { nameEquals } from '../core/sync/bookNaming';

/**
 * Sync orchestration (FR-013..FR-019, FR-021): dirty tracking -> engine-side
 * 1000 ms debounce -> book push through the app save pipeline; flush on
 * GENERATION_STARTED / panel close; self-save discrimination by reference
 * identity (the cache stores the outbound payload uncloned); divergence reports
 * for the UI; orphan bookkeeping (FR-018); book lifecycle (FR-019/FR-022/FR-023);
 * import flows (FR-016).
 */

export interface DivergenceReport {
    bookName: string;
    driftedUids: number[];
    foreign: Array<{ uid: number; name: string }>;
    blocked: boolean;
    /** Publish-block reasons: invalid entities must be fixed in the editor. */
    validationReasons?: string[];
}

export type OrphanMode = 'remove' | 'keep';
export type ImportResolution = 'keep-workspace' | 'take-native';

export interface SyncEngineInput {
    ctx: import('../global').SillyTavernContext;
    store: WorkspaceStore;
    worldInfo: WorldInfoAdapter;
}

export interface SyncEngine {
    refreshStructure(): void;
    markBooksDirty(books: readonly string[]): void;
    recordEntityDeletions(deletions: ReadonlyArray<{ bookName: string; uid: number }>): void;
    pushPendingNow(reason?: string): Promise<void>;
    getReports(): ReadonlyMap<string, DivergenceReport>;
    dismissReport(bookName: string): void;
    subscribe(listener: () => void): () => void;
    overridePush(bookName: string): Promise<void>;
    resolveOrphan(bookName: string, uid: number, mode: OrphanMode): Promise<void>;
    matchBookForAdopt(proposedName: string): string | null;
    isBookBound(bookName: string): boolean;
    designateRoot(folderId: string, mode: 'create' | 'adopt', bookName?: string): Promise<void>;
    undesignateRoot(folderId: string): void;
    renameRootBook(folderId: string, newBase: string): Promise<void>;
    deleteRootBook(folderId: string, mode: 'keep' | 'delete'): Promise<void>;
    importUnboundBook(bookName: string, parentFolderId?: string): Promise<void>;
    planBoundImportFor(bookName: string): Promise<BoundImportPlan | null>;
    importBookFile(file: File, parentFolderId: string): Promise<void>;
    applyBoundImport(
        bookName: string,
        plan: BoundImportPlan,
        resolutions: ReadonlyMap<string, ImportResolution>
    ): Promise<void>;
}

const PUSH_DEBOUNCE_MS = 1000;
const PLACEHOLDER_UID_BASE = 900000;
const MAX_UID = 1000000;

let placeholderSeed = 0;
function nextPlaceholderUid(): number {
    placeholderSeed += 1;
    return PLACEHOLDER_UID_BASE + placeholderSeed;
}

/**
 * Lowest free uid, scanning from `from` instead of restarting at 0 (spec 006 R7).
 * Callers assigning many uids in one pass thread the returned value back in, which
 * turns a first push or import of a 1000-entry book from O(n^2) into O(n).
 */
function allocateLowestUid(used: ReadonlySet<number>, from = 0): number {
    for (let uid = Math.max(0, from); uid < MAX_UID; uid++) {
        if (!used.has(uid)) {
            return uid;
        }
    }
    return MAX_UID - 1;
}

function rootsWithBooks(state: WorkspaceState): FolderNode[] {
    const roots: FolderNode[] = [];
    const walk = (node: TreeNode): void => {
        if (node.kind !== 'folder') {
            return;
        }
        if (node.isWiRoot && node.book) {
            roots.push(node);
        }
        node.children.forEach(walk);
    };
    walk(state.root);
    return roots;
}

/**
 * Entities under a folder already in hand. Prefer this over `entitiesOfRoot`
 * wherever the node is known: that variant pays an O(n) `findNode` first, which
 * compounded badly in loops (spec 006 R7).
 */
function entitiesOfFolder(root: FolderNode): EntryNode[] {
    // Images are workspace-only organizational items — they never sync.
    const found: EntryNode[] = [];
    const walk = (node: TreeNode): void => {
        if (node.kind === 'folder') {
            node.children.forEach(walk);
            return;
        }
        if (node.kind === 'entry') {
            found.push(node);
        }
    };
    walk(root);
    return found;
}

function entitiesOfRoot(state: WorkspaceState, rootId: string): EntryNode[] {
    const root = findNode(state, rootId);
    if (root?.kind !== 'folder') {
        return [];
    }
    return entitiesOfFolder(root);
}

interface EntitySyncRef {
    nodeId: string;
    uid: number | null;
    hash: string | null;
    status: 'new' | 'in-sync' | 'dirty';
}

/** Per-book refs: an entity's uid/hash/status in THAT book (v2 model). */
function entityRefs(entities: EntryNode[], bookName: string): EntitySyncRef[] {
    return entities.map((entity) => {
        const bookSync = entity.sync.books[bookName];
        return {
            nodeId: entity.id,
            uid: bookSync?.uid ?? null,
            hash: bookSync?.hash ?? null,
            status: bookSync?.status ?? 'new',
        };
    });
}

function isEntityDirtyForBook(entity: EntryNode, bookName: string): boolean {
    const bookSync = entity.sync.books[bookName];
    return bookSync === undefined || bookSync.status === 'dirty';
}

function emitBookFailure(bookName: string, message: string): void {
    emitSaveEvent({ kind: 'failure', scope: 'book', bookName, message });
}

export function createSyncEngine(input: SyncEngineInput): SyncEngine {
    const { store, worldInfo } = input;
    const ctx = input.ctx;
    const reports = new Map<string, DivergenceReport>();
    const listeners = new Set<() => void>();
    const pendingBooks = new Set<string>();
    let pushTimer: number | null = null;

    const notify = (): void => {
        listeners.forEach((listener) => listener());
    };

    const refreshStructure = (): void => {
        // Books whose membership changed (move-in via dirty entities, move-out
        // via tombstones) must be queued for the next push: dirtyBooksOf only
        // sees entities that still sit beneath a root.
        const touchedBooks = new Set<string>();
        store.update((draft) => {
            const index = buildNodeIndex(draft.root);
            const roots = rootsWithBooks(draft);
            for (const node of index.values()) {
                if (node.kind !== 'entry') {
                    continue; // images are workspace-only; folders have no sync
                }
                const entity = node;
                // Books the entity currently sits beneath (nearest roots on the
                // parent chain — nested roots included, world intersection).
                const enclosing = new Set<string>();
                let cursor: TreeNode | undefined =
                    entity.parentId !== null ? index.get(entity.parentId) : undefined;
                while (cursor) {
                    if (cursor.kind === 'folder' && cursor.isWiRoot && cursor.book) {
                        enclosing.add(cursor.book.bookName);
                    }
                    cursor = cursor.parentId !== null ? index.get(cursor.parentId) : undefined;
                }
                // 1) Books the entity no longer sits beneath: record removal
                // intent (tombstone, FR-021 semantics) so the next push removes
                // the native copy — moving out of a root deletes it there.
                for (const bookName of Object.keys(entity.sync.books)) {
                    if (enclosing.has(bookName)) {
                        continue;
                    }
                    const oldRoot = roots.find(
                        (candidate) => candidate.book?.bookName === bookName
                    );
                    const uid = entity.sync.books[bookName]?.uid ?? entity.native.uid;
                    if (oldRoot?.book) {
                        if (uid !== null && !oldRoot.book.tombstones?.includes(uid)) {
                            const tombstones = oldRoot.book.tombstones ?? (oldRoot.book.tombstones = []);
                            tombstones.push(uid);
                        }
                    }
                    touchedBooks.add(bookName);
                    delete entity.sync.books[bookName];
                    entity.updatedAt = new Date().toISOString();
                }
                // 2) New enclosing books without sync info → export on push.
                for (const bookName of enclosing) {
                    if (entity.sync.books[bookName] === undefined) {
                        entity.sync.books[bookName] = {
                            uid: null,
                            hash: null,
                            status: 'dirty',
                        };
                        touchedBooks.add(bookName);
                    }
                }
            }
            // 3) Tombstones of returned entities are dropped: the entity is
            // under its root again and will be re-exported on push (a kept
            // tombstone would delete the freshly written entry).
            for (const root of roots) {
                if (!root.book?.tombstones?.length) {
                    continue;
                }
                // entitiesOfRoot used to be called INSIDE this predicate, i.e.
                // once per tombstone, each time walking the whole tree (spec 006
                // R7). Compute the live uid set once per root instead.
                const liveUids = new Set<number>();
                for (const candidate of entitiesOfFolder(root)) {
                    liveUids.add(candidate.native.uid);
                }
                root.book.tombstones = root.book.tombstones.filter(
                    (uid) => !liveUids.has(uid)
                );
            }
            for (const bookName of touchedBooks) {
                pendingBooks.add(bookName);
            }
        });
        if (touchedBooks.size > 0) {
            schedulePush();
        }
    };

    const dirtyBooksOf = (state: WorkspaceState): Set<string> => {
        const dirty = new Set(pendingBooks);
        for (const root of rootsWithBooks(state)) {
            if (!root.book) {
                continue;
            }
            const bookName = root.book.bookName;
            const needs = entitiesOfFolder(root).some((entity) =>
                isEntityDirtyForBook(entity, bookName)
            );
            if (needs) {
                dirty.add(bookName);
            }
        }
        return dirty;
    };

    const pushBook = async (
    bookName: string,
    options: { force?: boolean; merged?: boolean } = {}
): Promise<void> => {
    const force = options.force === true;
    debugLog(`push ${bookName}: start (force=${String(force)}, merged=${String(options.merged === true)})`);
    let alreadyMerged = options.merged === true;
        const state = store.getState();
        const root = rootsWithBooks(state).find((candidate) => candidate.book?.bookName === bookName);
        if (!root?.book) {
            pendingBooks.delete(bookName);
            return;
        }
        const current = await worldInfo.loadBook(bookName);
        if (!current) {
            emitBookFailure(bookName, `Native book "${bookName}" is missing from the app's book list.`);
            pendingBooks.delete(bookName);
            return;
        }
        if (!alreadyMerged && worldInfo.isUnsentOwnWrite(bookName, current)) {
            // Retry after a failed save: the app cached our unsent payload, so the
            // "native" book is our own last write — nothing to merge or conflict.
            debugLog(`push ${bookName}: retrying an unsent write`);
            alreadyMerged = true;
        }
        const entities = entitiesOfRoot(state, root.id);
        const analysis = analyzeNativeBook({
            book: current,
            entities: entityRefs(entities, bookName),
            orphanUids: new Set(root.book.orphans.map((orphan) => orphan.uid)),
        });
        if (!alreadyMerged) {
            // FR-015 refined (2026-09-08 owner feedback): clean-side divergence is
            // merged SILENTLY before writing — refreshes, additions AND native
            // deletions. Force ("push anyway") bypasses only CONFLICT blocking,
            // never the merge itself: an adopted/empty workspace root must pull
            // native content before its first flatten (otherwise the push would
            // wipe the book).
            const skipUids = new Set<number>([
                ...root.book.orphans.map((orphan) => orphan.uid),
                ...(root.book.tombstones ?? []),
            ]);
            const plan = planBoundImport({
                book: current,
                entities: entityRefs(entities, bookName),
                skipUids,
            });
            debugLog(
                `push ${bookName}: plan c=${plan.conflicts.length} r=${plan.refreshes.length} a=${plan.additions.length} d=${plan.deletions.length}`
            );
            if (plan.conflicts.length > 0 && !force) {
                reports.set(bookName, {
                    bookName,
                    driftedUids: analysis.driftedUids,
                    foreign: analysis.foreign.map((entry) => ({
                        uid: entry.uid,
                        name: entry.comment || `Entry ${entry.uid}`,
                    })),
                    blocked: true,
                });
                pendingBooks.delete(bookName);
                notify();
                return;
            }
            if (
                plan.conflicts.length === 0 &&
                (plan.refreshes.length > 0 ||
                    plan.additions.length > 0 ||
                    plan.deletions.length > 0)
            ) {
                debugLog(`push ${bookName}: merging plan before write`);
                applyPlanInternal(bookName, plan);
                return await pushBook(bookName, { force, merged: true });
            }
        }
        const result = flattenRoot({
            state,
            rootId: root.id,
            bookName,
            existingBook: current,
            orphans: root.book.orphans,
            allocateUid: allocateLowestUid,
        });
        if (result.skipped.length > 0) {
            // Publish-block (FR-010): invalid entities are never exported and
            // the book is never partially emptied. Divergence force does NOT
            // bypass this — the entities must be fixed in the editor.
            const reasons = result.skipped.map(
                (row) => `${row.nodeId}: ${row.reason}`
            );
            reports.set(bookName, {
                bookName,
                driftedUids: analysis.driftedUids,
                foreign: analysis.foreign.map((entry) => ({
                    uid: entry.uid,
                    name: entry.comment || `Entry ${entry.uid}`,
                })),
                blocked: true,
                validationReasons: reasons,
            });
            debugLog(`push ${bookName}: BLOCKED by validation`);
            emitBookFailure(
                bookName,
                `${result.skipped.length} invalid item(s) block the push for "${bookName}": ${result.skipped[0]!.reason}`
            );
            pendingBooks.delete(bookName);
            notify();
            return;
        }
        debugLog(
            `push ${bookName}: writing ${Object.keys(result.entries).length} entries (skipped ${result.skipped.length})`
        );
        try {
            await worldInfo.saveBook(bookName, result.book, true);
        } catch {
            pendingBooks.add(bookName);
            notify();
            return;
        }
        const byNode = new Map(result.exported.map((row) => [row.nodeId, row]));
        // One update, not two: this used to publish twice per push, costing a
        // second whole-state clone and a second store notification for a single
        // logical outcome (spec 006 R7).
        store.update((draft) => {
            const nextRoot = findNode(draft, root.id);
            if (nextRoot?.kind !== 'folder' || !nextRoot.book) {
                return;
            }
            for (const entity of entitiesOfFolder(nextRoot)) {
                const row = byNode.get(entity.id);
                if (!row) {
                    continue;
                }
                entity.sync.books[bookName] = {
                    uid: row.uid,
                    hash: row.hash,
                    status: 'in-sync',
                };
                // Replace rather than mutate: fingerprints are memoized by object
                // identity (core/sync/fingerprint.ts).
                entity.native = { ...entity.native, uid: row.uid };
            }
            // FR-021 fulfilled: the flattened save removed the tombstoned uids.
            nextRoot.book.tombstones = [];
        });
        pendingBooks.delete(bookName);
        reports.delete(bookName);
        notify();
    };

    const pushPendingNow = async (reason?: string): Promise<void> => {
        void reason;
        const books = [...dirtyBooksOf(store.getState())];
        for (const bookName of books) {
            await pushBook(bookName);
        }
    };

    const schedulePush = (): void => {
        if (pushTimer !== null) {
            window.clearTimeout(pushTimer);
        }
        pushTimer = window.setTimeout(() => {
            pushTimer = null;
            void pushPendingNow('debounced');
        }, PUSH_DEBOUNCE_MS);
    };

    const handleExternalUpdate = (bookName: string, book: WorldInfoBook): void => {
        debugLog(`external change: ${bookName}`);
        const state = store.getState();
        const root = rootsWithBooks(state).find(
            (candidate) => candidate.book?.bookName === bookName
        );
        if (!root?.book) {
            return;
        }
        const plan = planBoundImport({
            book,
            entities: entityRefs(entitiesOfRoot(state, root.id), bookName),
            skipUids: new Set<number>([
                ...root.book.orphans.map((orphan) => orphan.uid),
                ...(root.book.tombstones ?? []),
            ]),
        });
        if (plan.conflicts.length > 0) {
            // Genuine conflict (both sides changed): banner + resolution flow.
            reports.set(bookName, {
                bookName,
                driftedUids: plan.conflicts.map((conflict) => conflict.uid),
                foreign: plan.additions.map((addition) => ({
                    uid: addition.uid,
                    name: addition.name,
                })),
                blocked: true,
            });
            notifyWarning(
                `Native book "${bookName}" conflicts with unexported workspace edits.`
            );
            notify();
            return;
        }
        if (
            plan.refreshes.length === 0 &&
            plan.additions.length === 0 &&
            plan.deletions.length === 0
        ) {
            return;
        }
        // Nothing the workspace disagrees with: mirror the native change silently.
        applyPlanInternal(bookName, plan);
    };

    ctx.eventSource.on(ctx.eventTypes.WORLDINFO_UPDATED, (name, data) => {
        const bookName = typeof name === 'string' ? name : '';
        if (!bookName || data === worldInfo.getLastOutbound(bookName)) {
            return; // self-save or malformed payload
        }
        handleExternalUpdate(bookName, data as WorldInfoBook);
    });
    ctx.eventSource.on(ctx.eventTypes.GENERATION_STARTED, () => {
        void pushPendingNow('generation');
    });
    store.subscribe(schedulePush);

    const engineRef: { current: SyncEngine } = { current: undefined as unknown as SyncEngine };

    const applyPlanInternal = (bookName: string, plan: BoundImportPlan): void => {
        store.update((draft) => {
            const index = buildNodeIndex(draft.root);
            const root = rootsWithBooks(draft).find(
                (candidate) => candidate.book?.bookName === bookName
            );
            const now = new Date().toISOString();
            for (const addition of plan.additions) {
                const single = { entries: { [String(addition.uid)]: addition.native } };
                const nodes = mapBookToNodes(single, bookName, () => ctx.uuidv4(), now);
                if (root) {
                    for (const node of nodes) {
                        node.parentId = root.id;
                        node.sync = {
                            books: {
                                [bookName]: {
                                    uid: node.sync.books[bookName]?.uid ?? null,
                                    hash: fingerprintEntry(addition.native),
                                    status: 'in-sync',
                                },
                            },
                        };
                        root.children.push(node);
                    }
                }
            }
            for (const refresh of plan.refreshes) {
                const node = index.get(refresh.nodeId);
                if (!node || node.kind === 'folder') {
                    continue;
                }
                const native = normalizeNativeEntry(structuredClone(refresh.nativeEntry));
                node.sync.books[bookName] = {
                    uid: refresh.uid,
                    hash: fingerprintEntry(native),
                    status: 'in-sync',
                };
                node.updatedAt = now;
                if (node.kind === 'entry') {
                    node.native = native;
                    node.name = native.comment || node.name;
                }
            }
            for (const deletion of plan.deletions) {
                const node = index.get(deletion.nodeId);
                if (!node || node.kind === 'folder' || node.parentId === null) {
                    continue;
                }
                detachSubtreeInDraft(draft, deletion.nodeId);
            }
        });
        notify();
    };

    const engine: SyncEngine = {
        refreshStructure,
        markBooksDirty: (books: readonly string[]): void => {
            books.forEach((book) => {
                if (book) {
                    pendingBooks.add(book);
                }
            });
            schedulePush();
        },
        pushPendingNow,
        recordEntityDeletions: (deletions: ReadonlyArray<{ bookName: string; uid: number }>): void => {
            if (deletions.length === 0) {
                return;
            }
            store.update((draft) => {
                for (const deletion of deletions) {
                    const root = rootsWithBooks(draft).find(
                        (candidate) => candidate.book?.bookName === deletion.bookName
                    );
                    if (!root?.book) {
                        continue;
                    }
                    const tombstones = root.book.tombstones ?? (root.book.tombstones = []);
                    if (!tombstones.includes(deletion.uid)) {
                        tombstones.push(deletion.uid);
                    }
                }
            });
        },
        getReports: () => reports,
        dismissReport: (bookName: string): void => {
            reports.delete(bookName);
            notify();
        },
        subscribe: (listener: () => void): (() => void) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        overridePush: async (bookName: string): Promise<void> => {
            reports.delete(bookName);
            await pushBook(bookName, { force: true });
        },
        resolveOrphan: async (bookName: string, uid: number, mode: OrphanMode): Promise<void> => {
            store.update((draft) => {
                const root = rootsWithBooks(draft).find(
                    (candidate) => candidate.book?.bookName === bookName
                );
                if (!root?.book) {
                    return;
                }
                const at = root.book.orphans.findIndex((orphan) => orphan.uid === uid);
                if (at < 0) {
                    return;
                }
                if (mode === 'keep') {
                    return;
                }
                root.book.orphans.splice(at, 1);
                for (const node of buildNodeIndex(draft.root).values()) {
                    if (node.kind !== 'entry') {
                        continue;
                    }
                    const bookSync = node.sync.books[bookName];
                    if (bookSync !== undefined && bookSync.uid === uid) {
                        delete node.sync.books[bookName];
                        node.updatedAt = new Date().toISOString();
                        node.native.uid = nextPlaceholderUid();
                    }
                }
            });
            pendingBooks.add(bookName);
            reports.delete(bookName);
            await pushPendingNow('orphan-resolved');
        },
        matchBookForAdopt: (proposedName: string): string | null => {
            const bound = new Set(rootsWithBooks(store.getState()).map((root) => root.book?.bookName ?? ''));
            return (
                worldInfo.listBooks().find(
                    (name) => nameEquals(name, proposedName) && !bound.has(name)
                ) ?? null
            );
        },
        isBookBound: (bookName: string): boolean => {
            return rootsWithBooks(store.getState()).some(
                (candidate) => candidate.book?.bookName === bookName
            );
        },
        designateRoot: async (folderId, mode, bookName): Promise<void> => {
            const folder = findNode(store.getState(), folderId);
            if (folder?.kind !== 'folder' || folder.isWiRoot) {
                return;
            }
            let boundName: string | null = null;
            if (mode === 'adopt' && bookName) {
                boundName = bookName;
            } else {
                // `bookName` in create mode is only a proposal (markdown import
                // restores the recorded book name); collisions still resolve.
                const created = await worldInfo.createBook(bookName ?? folder.name);
                if (!created) {
                    return;
                }
                boundName = created.bookName;
            }
            store.update((draft) => {
                const target = findNode(draft, folderId);
                if (target?.kind === 'folder') {
                    target.isWiRoot = true;
                    target.book = { bookName: boundName!, orphans: [] };
                    target.expanded = true;
                }
            });
            refreshStructure();
            await pushBook(boundName!, { force: true });
        },
        undesignateRoot: (folderId: string): void => {
            store.update((draft) => {
                const target = findNode(draft, folderId);
                if (target?.kind === 'folder' && target.isWiRoot) {
                    target.isWiRoot = false;
                    target.book = null;
                    resetEntitySync(draft, folderId);
                }
            });
            notify();
        },
        renameRootBook: async (folderId, newBase): Promise<void> => {
            const folder = findNode(store.getState(), folderId);
            if (folder?.kind !== 'folder' || !folder.book) {
                return;
            }
            const result = await worldInfo.renameBook(folder.book.bookName, newBase);
            if (!result) {
                return;
            }
            store.update((draft) => {
                const target = findNode(draft, folderId);
                if (target?.kind === 'folder' && target.book) {
                    target.book.bookName = result.bookName;
                }
            });
        },
        deleteRootBook: async (folderId, mode): Promise<void> => {
            const folder = findNode(store.getState(), folderId);
            if (folder?.kind !== 'folder' || !folder.book) {
                return;
            }
            const bookName = folder.book.bookName;
            if (mode === 'delete') {
                await worldInfo.deleteBook(bookName);
            }
            store.update((draft) => {
                const target = findNode(draft, folderId);
                if (target?.kind === 'folder') {
                    target.isWiRoot = false;
                    target.book = null;
                    resetEntitySync(draft, folderId);
                }
            });
            notify();
        },
        importUnboundBook: async (bookName: string, parentFolderId?: string): Promise<void> => {
            if (engineRef.current.isBookBound(bookName)) {
                // Bound books go through the import plan; a second folder bound
                // to the same book would violate the one-binding invariant.
                notifyWarning(
                    `"${bookName}" is already imported into the workspace - use the import resolution instead.`
                );
                return;
            }
            const book = await worldInfo.loadBook(bookName);
            if (!book) {
                notifyWarning(`Could not load "${bookName}".`);
                return;
            }
            const hashes = new Map<number, string>();
            for (const key of Object.keys(book.entries ?? {})) {
                const entry = book.entries[key];
                if (entry) {
                    hashes.set(Number(key), fingerprintEntry(entry));
                }
            }
            const now = new Date().toISOString();
            store.update((draft) => {
                const folderId = ctx.uuidv4();
                const requestedParent = parentFolderId ? findNode(draft, parentFolderId) : undefined;
                const parent: FolderNode = requestedParent?.kind === 'folder' ? requestedParent : draft.root;
                const folder: FolderNode = {
                    id: folderId,
                    parentId: parent.id,
                    kind: 'folder',
                    name: bookName,
                    createdAt: now,
                    updatedAt: now,
                    expanded: true,
                    isWiRoot: true,
                    book: { bookName, orphans: [] },
                    children: [],
                };
                const nodes = mapBookToNodes(book, bookName, () => ctx.uuidv4(), now);
                for (const node of nodes) {
                    node.parentId = folderId;
                    const uid = node.sync.books[bookName]?.uid ?? null;
                    node.sync = {
                        books: {
                            [bookName]: {
                                uid,
                                hash: uid !== null ? (hashes.get(uid) ?? null) : null,
                                status: 'in-sync',
                            },
                        },
                    };
                    folder.children.push(node);
                }
                parent.children.push(folder);
                parent.expanded = true;
            });
            // Imported under another WI root: the entries also join the
            // enclosing books, which must be queued for a push.
            engineRef.current.refreshStructure();
            await worldInfo.refreshBooks();
        },
        importBookFile: async (file: File, parentFolderId: string): Promise<void> => {
            const base = file.name.replace(/\.[^.]+$/, '').trim();
            if (base === '') {
                notifyWarning('The file has no importable name.');
                return;
            }
            if (nameInUse(worldInfo.listBooks(), base)) {
                const confirmed = await confirmDialog(
                    `A book named "${base}" already exists. Importing will REPLACE its native file with this file's contents. Continue?`
                );
                if (!confirmed) {
                    return;
                }
            }
            const uploaded = await worldInfo.uploadBook(file);
            if (!uploaded) {
                notifyWarning(`Failed to import "${file.name}" (is it a valid world info file?).`);
                return;
            }
            await engineRef.current.importUnboundBook(uploaded.name, parentFolderId);
        },
        planBoundImportFor: async (bookName: string): Promise<BoundImportPlan | null> => {
            const book = await worldInfo.loadBook(bookName);
            if (!book) {
                return null;
            }
            const state = store.getState();
            const root = rootsWithBooks(state).find(
                (candidate) => candidate.book?.bookName === bookName
            );
            if (!root) {
                return { conflicts: [], refreshes: [], additions: [], deletions: [] };
            }
            return planBoundImport({
                book,
                entities: entityRefs(entitiesOfRoot(state, root.id), bookName),
            });
        },
        applyBoundImport: async (bookName, plan, resolutions): Promise<void> => {
            store.update((draft) => {
                const index = buildNodeIndex(draft.root);
                for (const conflict of plan.conflicts) {
                    const decision = resolutions.get(conflict.nodeId) ?? 'keep-workspace';
                    const node = index.get(conflict.nodeId);
                    if (!node || node.kind === 'folder') {
                        continue;
                    }
                    if (decision === 'take-native' && node.kind === 'entry') {
                        node.native = normalizeNativeEntry(structuredClone(conflict.nativeEntry));
                        node.name = conflict.nativeEntry.comment || node.name;
                        node.sync.books[bookName] = {
                            uid: conflict.uid,
                            hash: fingerprintEntry(conflict.nativeEntry),
                            status: 'in-sync',
                        };
                    } else {
                        const bookSync = node.sync.books[bookName];
                        if (bookSync) {
                            bookSync.status = 'dirty';
                        }
                    }
                    node.updatedAt = new Date().toISOString();
                }
            });
            applyPlanInternal(bookName, plan);
        },
    };

    engineRef.current = engine;

    return engine;
}

function detachSubtreeInDraft(state: WorkspaceState, nodeId: string): void {
    const walk = (folder: FolderNode): boolean => {
        const at = folder.children.findIndex((child) => child.id === nodeId);
        if (at >= 0) {
            folder.children.splice(at, 1);
            return true;
        }
        return folder.children.some((child) => child.kind === 'folder' && walk(child));
    };
    walk(state.root);
}

function resetEntitySync(state: WorkspaceState, folderId: string): void {
    for (const entity of entitiesOfRoot(state, folderId)) {
        entity.sync.books = {};
        entity.native.uid = nextPlaceholderUid();
    }
}
