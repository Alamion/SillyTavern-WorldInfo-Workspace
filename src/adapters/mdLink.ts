import { applyPull } from '../core/md/applyPull';
import { bytesToDataUri } from '../core/md/dataUri';
import { decodeText, textBytes } from '../core/md/hash';
import { describeDisk, recordPath, renderWorkspace, type WorkspaceRender, type WsRenderItem } from '../core/md/linkRender';
import { EXT_MIME } from '../core/md/naming';
import {
    DiskError,
    type AccessState,
    type BaselineItem,
    type Digest,
    type DiskFolder,
    type DiskFolderAccess,
    type ImageStorePort,
    type MdItemKind,
    type RelPath,
    type StoredLink,
    type YamlCodec,
} from '../core/md/ports';
import { NO_RECORD, reconcile, type Conflict, type DiskItem, type ReconcileResult } from '../core/md/reconcile';
import { createReportBuilder, type OperationReport, type ReportBuilder } from '../core/md/report';
import { scanFolder, type ScanResult } from '../core/md/scan';
import type { WorkspaceState } from '../core/state/schema';
import type { WorkspaceStore } from '../core/state/store';
import type { SyncEngine } from './syncEngine';
import { applyTreeChange, collectEntityDeletions } from './workspaceActions';

/**
 * Link manager for the whole-workspace markdown folder (spec 004 US3,
 * FR-010..FR-016, FR-020/FR-021). Hybrid sync: workspace edits are pushed to disk
 * automatically (debounced); disk changes are pulled on Sync and when the
 * workspace is opened. The baseline (last synced state of both sides) lives with
 * the link in the access port's storage, per browser profile.
 */

export type LinkPhase = 'none' | 'loading' | 'needs-reconnect' | 'unavailable' | 'linked';

export interface LinkStatus {
    phase: LinkPhase;
    folderName: string | null;
    lastSyncAt: string | null;
    /** Workspace edits not written because the file changed on disk (conflicts at next Sync). */
    heldBack: number;
    /** Conflicts skipped at the last Sync. */
    conflicts: number;
    busy: { label: string; done: number; total: number } | null;
    /** Workspace ids currently tracked in the linked folder (delete disclosure). */
    trackedIds: ReadonlySet<string>;
}

export type ConflictDecision = 'keep-workspace' | 'keep-disk' | 'skip';

export interface ConflictView extends Conflict {
    key: string;
    name: string;
    workspaceText: string | null;
    diskText: string | null;
}

export interface LinkDecisions {
    /** Initial link / re-link into a non-empty folder. */
    confirmLink(summary: { folderName: string; matched: number; imported: number; written: number; conflicts: number }): Promise<boolean>;
    resolveConflicts(conflicts: ConflictView[]): Promise<Map<string, ConflictDecision>>;
    confirmDeletions(items: Array<{ id: string; path: RelPath; name: string; syncedBooks: string[] }>): Promise<boolean>;
}

export interface MdLinkDeps {
    store: WorkspaceStore;
    sync: SyncEngine;
    access: DiskFolderAccess;
    imageStore: ImageStorePort;
    digest: Digest;
    yaml: () => YamlCodec;
    decisions: LinkDecisions;
    resolveImage: (src: string) => Promise<Uint8Array | null>;
    designate: (folderId: string, bookName: string | undefined) => Promise<void>;
    newId: () => string;
    placeholderUid?: () => number;
    emit?: (event: string, payload: unknown) => void;
    onReport?: (report: OperationReport) => void;
    onError?: (message: string) => void;
    debounceMs?: number;
    now?: () => string;
}

export interface MdLink {
    getStatus(): LinkStatus;
    subscribe(listener: () => void): () => void;
    /** Loads a stored link (startup). */
    init(): Promise<void>;
    link(): Promise<void>;
    relink(): Promise<void>;
    unlink(): Promise<void>;
    syncNow(): Promise<OperationReport | null>;
    onWorkspaceOpened(options: { userActivation: boolean }): Promise<void>;
    reconnect(): Promise<void>;
    /** Flushes a pending debounced push (tests, panel close). */
    flush(): Promise<void>;
    dispose(): void;
}

const MISSING = '<missing>';
const YIELD_EVERY = 25;

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function createMdLink(deps: MdLinkDeps): MdLink {
    const now = deps.now ?? (() => new Date().toISOString());
    const placeholderUid = deps.placeholderUid ?? (() => 900000 + Math.floor(Math.random() * 90000));
    const debounceMs = deps.debounceMs ?? 1000;
    const listeners = new Set<() => void>();
    const imageHashCache = new Map<string, string | null>();
    const entryCache = new Map<string, { text: string; hash: string }>();
    /** State the last complete push rendered; unchanged state → nothing to do. */
    let lastPushedState: unknown = null;
    let link: StoredLink | null = null;
    let status: LinkStatus = {
        phase: 'none',
        folderName: null,
        lastSyncAt: null,
        heldBack: 0,
        conflicts: 0,
        busy: null,
        trackedIds: new Set(),
    };
    let pushTimer: ReturnType<typeof setTimeout> | null = null;
    let running: Promise<unknown> | null = null;
    let pushAgain = false;
    const forced = new Set<string>();

    const setStatus = (patch: Partial<LinkStatus>): void => {
        const previousPhase = status.phase;
        status = { ...status, ...patch };
        if (link) {
            status.trackedIds = new Set(Object.keys(link.baseline));
        }
        listeners.forEach((listener) => listener());
        if (patch.phase !== undefined && patch.phase !== previousPhase) {
            deps.emit?.('wi-workspace:md-link-changed', { state: status.phase, folderName: status.folderName });
        }
    };

    const imageHash = async (src: string): Promise<string | null> => {
        if (imageHashCache.has(src)) {
            return imageHashCache.get(src)!;
        }
        const bytes = await deps.resolveImage(src);
        const hash = bytes ? await deps.digest(bytes) : null;
        imageHashCache.set(src, hash);
        return hash;
    };

    const folderOf = (current: StoredLink): DiskFolder => deps.access.open(current);

    const readHash = async (folder: DiskFolder, path: RelPath): Promise<string | null> => {
        try {
            return await deps.digest(await folder.readBytes(path));
        } catch (error) {
            if (error instanceof DiskError && error.code === 'not-found') {
                return null;
            }
            throw error;
        }
    };

    const persist = async (): Promise<void> => {
        if (link) {
            await deps.access.saveLink(link);
        }
    };

    /** Serializes operations (pull, push, link) so they never interleave. */
    const exclusive = async <T>(run: () => Promise<T>): Promise<T> => {
        while (running) {
            await running.catch(() => undefined);
        }
        const promise = run();
        running = promise;
        try {
            return await promise;
        } finally {
            running = null;
        }
    };

    // ---------------------------------------------------------------- push

    const push = async (report?: ReportBuilder): Promise<void> => {
        if (!link || status.phase !== 'linked') {
            return;
        }
        const current = link;
        const folder = folderOf(current);
        const state = deps.store.getState();
        if (!report && state === lastPushedState && forced.size === 0 && status.heldBack === 0) {
            return;
        }
        const render = await renderWorkspace({
            state,
            baseline: current.baseline,
            yaml: deps.yaml(),
            digest: deps.digest,
            imageHash,
            entryCache,
        });
        let held = 0;
        const oldDirs = new Set<RelPath>();
        const ordered = [...render.items.values()].sort((a, b) => {
            if ((a.kind === 'folder') !== (b.kind === 'folder')) {
                return a.kind === 'folder' ? -1 : 1;
            }
            return a.path.split('/').length - b.path.split('/').length;
        });
        let done = 0;
        for (const item of ordered) {
            const base = current.baseline[item.id];
            const isForced = forced.has(item.id);
            if (base && !isForced && base.wsHash === item.hash && base.path === item.path) {
                continue;
            }
            const checkPath = item.kind === 'folder' ? recordPath(base?.path ?? item.path) : (base?.path ?? item.path);
            let onDisk: string | null;
            try {
                onDisk = base?.path === null && item.kind === 'image' ? null : await readHash(folder, checkPath);
            } catch (error) {
                report?.add(item.path, 'warning', `Could not read: ${errorText(error)}`);
                continue;
            }
            const effective = item.kind === 'folder' ? (onDisk ?? NO_RECORD) : onDisk;
            const ok = isForced
                ? true
                : base
                  ? effective === base.diskHash || (effective === null && base.diskHash === MISSING)
                  : effective === null || effective === NO_RECORD || effective === item.hash;
            if (!ok) {
                held += 1;
                report?.add(item.path, 'conflict', 'Changed on disk and in the workspace — resolve with Sync.');
                continue;
            }
            try {
                const diskHash = await writeItem(folder, item, report, base);
                if (diskHash === undefined) {
                    continue;
                }
                if (base && base.path !== null && base.path !== item.path) {
                    if (item.kind === 'folder') {
                        oldDirs.add(base.path);
                        if (onDisk !== null) {
                            await folder.remove(recordPath(base.path));
                        }
                    } else {
                        await folder.remove(base.path);
                        report?.add(item.path, 'moved', `Moved from ${base.path}.`);
                    }
                }
                current.baseline[item.id] = { id: item.id, kind: item.kind, path: item.path, wsHash: item.hash, diskHash };
                forced.delete(item.id);
            } catch (error) {
                report?.add(item.path, 'warning', `Write failed: ${errorText(error)}`);
                deps.onError?.(`Writing ${item.path} failed: ${errorText(error)}`);
                if (error instanceof DiskError && error.code === 'permission') {
                    setStatus({ phase: 'needs-reconnect' });
                    break;
                }
            }
            done += 1;
            if (done % YIELD_EVERY === 0) {
                await persist();
            }
        }

        // Items deleted in the workspace: remove their files when unchanged on disk.
        const removed = Object.values(current.baseline)
            .filter((base) => !render.items.has(base.id) && base.id !== state.root.id)
            .sort((a, b) => (b.path ?? '').split('/').length - (a.path ?? '').split('/').length)
            .sort((a, b) => (a.kind === 'folder' ? 1 : 0) - (b.kind === 'folder' ? 1 : 0));
        for (const base of removed) {
            if (base.path === null) {
                delete current.baseline[base.id];
                continue;
            }
            try {
                if (base.kind === 'folder') {
                    const record = await readHash(folder, recordPath(base.path));
                    if ((record ?? NO_RECORD) !== base.diskHash && base.diskHash !== MISSING) {
                        held += 1;
                        report?.add(base.path, 'conflict', 'Folder record changed on disk; not removed.');
                        continue;
                    }
                    if (record !== null) {
                        await folder.remove(recordPath(base.path));
                    }
                    oldDirs.add(base.path);
                } else {
                    const onDisk = await readHash(folder, base.path);
                    if (onDisk !== null && onDisk !== base.diskHash) {
                        held += 1;
                        report?.add(base.path, 'conflict', 'Changed on disk; not removed.');
                        continue;
                    }
                    if (onDisk !== null) {
                        await folder.remove(base.path);
                        report?.add(base.path, 'deleted');
                    }
                }
                delete current.baseline[base.id];
            } catch (error) {
                report?.add(base.path, 'warning', `Remove failed: ${errorText(error)}`);
            }
        }

        // Directories left empty by moves/deletions (foreign files keep them alive).
        if (oldDirs.size > 0) {
            const listing = await folder.list();
            const liveDirs = new Set(
                Object.values(current.baseline)
                    .filter((base) => base.kind === 'folder' && base.path !== null)
                    .map((base) => base.path!)
            );
            for (const dir of [...oldDirs].sort((a, b) => b.length - a.length)) {
                if (liveDirs.has(dir)) {
                    continue;
                }
                const prefix = `${dir}/`;
                const hasContent = listing.some((entry) => entry.path.startsWith(prefix) && entry.kind === 'file');
                if (!hasContent) {
                    await folder.remove(dir);
                    report?.add(dir, 'deleted');
                }
            }
        }
        await persist();
        lastPushedState = state;
        if (held !== status.heldBack) {
            setStatus({ heldBack: held });
        }
    };

    /** Writes one item; returns the disk hash to record, or undefined when skipped. */
    const writeItem = async (
        folder: DiskFolder,
        item: WsRenderItem,
        report: ReportBuilder | undefined,
        base: BaselineItem | undefined
    ): Promise<string | undefined> => {
        const verb = base ? 'updated' : 'created';
        if (item.kind === 'folder') {
            if (item.path !== '') {
                await folder.createDirectory(item.path);
            }
            if (item.text === null) {
                const existing = await readHash(folder, recordPath(item.path));
                if (existing !== null && base) {
                    await folder.remove(recordPath(item.path));
                    report?.add(recordPath(item.path), 'deleted');
                }
                return NO_RECORD;
            }
            const bytes = textBytes(item.text);
            await folder.writeBytes(recordPath(item.path), bytes);
            report?.add(recordPath(item.path), verb);
            return deps.digest(bytes);
        }
        if (item.kind === 'entry') {
            const bytes = textBytes(item.text ?? '');
            await folder.writeBytes(item.path, bytes);
            report?.add(item.path, verb);
            return deps.digest(bytes);
        }
        const bytes = await deps.resolveImage(item.src ?? '');
        if (!bytes) {
            report?.add(item.path, 'warning', 'The image could not be read; no file was written.');
            return undefined;
        }
        await folder.writeBytes(item.path, bytes);
        report?.add(item.path, verb);
        return deps.digest(bytes);
    };

    const schedulePush = (): void => {
        if (status.phase !== 'linked') {
            return;
        }
        if (pushTimer !== null) {
            clearTimeout(pushTimer);
        }
        pushTimer = setTimeout(() => {
            pushTimer = null;
            if (running) {
                pushAgain = true;
                return;
            }
            void exclusive(() => push()).catch((error) => deps.onError?.(`Writing to the linked folder failed: ${errorText(error)}`));
        }, debounceMs);
    };

    const unsubscribeStore = deps.store.subscribe(schedulePush);

    // ---------------------------------------------------------------- pull

    const conflictViews = async (
        conflicts: Conflict[],
        render: WorkspaceRender,
        folder: DiskFolder,
        disk: Map<RelPath, DiskItem>
    ): Promise<ConflictView[]> => {
        const views: ConflictView[] = [];
        for (const conflict of conflicts) {
            const ws = render.items.get(conflict.id);
            let diskText: string | null = null;
            if (conflict.kind !== 'image' && conflict.disk !== 'deleted') {
                try {
                    diskText = decodeText(await folder.readBytes(conflict.kind === 'folder' ? recordPath(conflict.path) : conflict.path));
                } catch {
                    diskText = null;
                }
            }
            views.push({
                ...conflict,
                key: `${conflict.id}|${conflict.path}`,
                name: ws?.name ?? disk.get(conflict.path)?.name ?? conflict.path,
                workspaceText: conflict.workspace === 'deleted' ? null : (ws?.text ?? null),
                diskText,
            });
        }
        return views;
    };

    interface PullOptions {
        initial: boolean;
    }

    const pull = async (options: PullOptions): Promise<OperationReport | null> => {
        if (!link) {
            return null;
        }
        const current = link;
        const report = createReportBuilder(options.initial ? 'link' : 'sync');
        const folder = folderOf(current);
        setStatus({ busy: { label: 'Reading folder', done: 0, total: 0 } });
        const scan: ScanResult = await scanFolder(folder, {
            digest: deps.digest,
            yaml: deps.yaml(),
            onProgress: (done, total) => setStatus({ busy: { label: 'Reading folder', done, total } }),
            yieldNow: () => new Promise((resolve) => setTimeout(resolve, 0)),
        });
        scan.lines.forEach((line) => report.add(line.path, line.outcome, line.message));
        const disk = await describeDisk({ scan, yaml: deps.yaml(), digest: deps.digest });
        const stateBefore = deps.store.getState();
        const render = await renderWorkspace({
            state: stateBefore,
            baseline: current.baseline,
            yaml: deps.yaml(),
            digest: deps.digest,
            imageHash,
            entryCache,
        });
        const result: ReconcileResult = reconcile({ rootId: stateBefore.root.id, ws: render.items, disk, baseline: current.baseline });
        result.warnings.forEach((warning) => report.add(warning.path, 'warning', warning.message));

        if (options.initial && disk.size > 1) {
            const written = [...render.items.keys()].filter((id) => !result.matches.has(id)).length;
            const proceed = await deps.decisions.confirmLink({
                folderName: current.folderName,
                matched: result.adopt.length,
                imported: result.toWorkspace.filter((change) => change.type === 'create').length,
                written,
                conflicts: result.conflicts.length,
            });
            if (!proceed) {
                setStatus({ busy: null });
                return null;
            }
        }

        const changes = [...result.toWorkspace];
        const deletions: string[] = [];
        let skipped = 0;

        if (result.conflicts.length > 0) {
            setStatus({ busy: null });
            const decisions = await deps.decisions.resolveConflicts(await conflictViews(result.conflicts, render, folder, disk));
            for (const conflict of result.conflicts) {
                const decision = decisions.get(`${conflict.id}|${conflict.path}`) ?? 'skip';
                const base = current.baseline[conflict.id];
                const diskItem = disk.get(conflict.path);
                if (decision === 'skip') {
                    skipped += 1;
                    report.add(conflict.path, 'conflict', 'Skipped — both sides unchanged.');
                    continue;
                }
                if (decision === 'keep-disk') {
                    if (conflict.disk === 'deleted') {
                        deletions.push(conflict.id);
                    } else if (conflict.workspace === 'deleted') {
                        changes.push({ type: 'create', path: conflict.path, kind: conflict.kind, parentPath: conflict.path.includes('/') ? conflict.path.slice(0, conflict.path.lastIndexOf('/')) : '' });
                        delete current.baseline[conflict.id];
                    } else {
                        if (conflict.disk === 'moved' || (base && base.path !== conflict.path)) {
                            changes.push({
                                type: 'move',
                                id: conflict.id,
                                path: conflict.path,
                                kind: conflict.kind,
                                parentPath: conflict.path.includes('/') ? conflict.path.slice(0, conflict.path.lastIndexOf('/')) : '',
                                name: diskItem?.name ?? conflict.path,
                            });
                        }
                        if (conflict.disk !== 'moved') {
                            changes.push({ type: 'update', id: conflict.id, path: conflict.path, kind: conflict.kind });
                        }
                    }
                } else {
                    // keep-workspace: the push overwrites/moves/removes the disk side.
                    const diskHash = diskItem ? diskItem.hash : MISSING;
                    current.baseline[conflict.id] = {
                        id: conflict.id,
                        kind: conflict.kind,
                        path: conflict.path,
                        wsHash: '',
                        diskHash,
                    };
                    forced.add(conflict.id);
                }
            }
        }

        if (result.pendingDeletions.length > 0) {
            setStatus({ busy: null });
            const items = result.pendingDeletions.map((item) => {
                const ws = render.items.get(item.id);
                return { id: item.id, path: item.path, name: ws?.name ?? item.path, syncedBooks: syncedBooksOf(stateBefore, item.id) };
            });
            const confirmed = await deps.decisions.confirmDeletions(items);
            for (const item of result.pendingDeletions) {
                if (confirmed) {
                    deletions.push(item.id);
                } else {
                    // Keep the item: its file is written again by the push.
                    const base = current.baseline[item.id];
                    if (base) {
                        base.diskHash = MISSING;
                        base.wsHash = '';
                    }
                    report.add(item.path, 'preserved', 'Deletion declined — the file will be written again.');
                }
            }
        }

        // Image files flowing into the workspace are stored in the app image storage.
        setStatus({ busy: { label: 'Applying changes', done: 0, total: changes.length } });
        const imageSrcByPath = new Map<RelPath, string>();
        for (const change of changes) {
            if (change.kind !== 'image' || change.type === 'move') {
                continue;
            }
            const image = scan.images.find((candidate) => candidate.path === change.path);
            if (!image) {
                continue;
            }
            if (deps.imageStore.accepts(image.ext)) {
                try {
                    imageSrcByPath.set(change.path, await deps.imageStore.upload({ bytes: image.bytes, ext: image.ext, stem: image.fileName.replace(/\.[^.]+$/, '') }));
                    continue;
                } catch (error) {
                    report.add(change.path, 'warning', `Embedded: the app image storage refused it (${errorText(error)}).`);
                }
            }
            imageSrcByPath.set(change.path, bytesToDataUri(image.bytes, EXT_MIME[image.ext] ?? 'application/octet-stream'));
        }

        const matchedPaths = new Map<string, RelPath>();
        for (const [id, match] of result.matches) {
            matchedPaths.set(id, match.path);
        }
        if (changes.length > 0 || deletions.length > 0) {
            const applied = applyPull({
                state: deps.store.getState(),
                scan,
                matchedPaths,
                changes,
                deletions,
                imageSrcByPath,
                newId: deps.newId,
                placeholderUid,
            });
            applied.lines.forEach((line) => report.add(line.path, line.outcome, line.message));
            const { deletions: deletionIntents, books } = collectEntityDeletions(applied.deletedNodes);
            const updatedBooks = new Set<string>(books);
            for (const id of applied.appliedIds.keys()) {
                for (const book of syncedBooksOf(applied.state, id)) {
                    updatedBooks.add(book);
                }
            }
            applyTreeChange(
                { store: deps.store, sync: deps.sync },
                () => applied.state,
                { structure: true, deletions: deletionIntents, books: [...updatedBooks] }
            );
            for (const id of deletions) {
                delete current.baseline[id];
            }
            for (const request of applied.rootRequests) {
                try {
                    await deps.designate(request.folderId, request.bookName);
                } catch (error) {
                    report.add('', 'warning', `A World Info root could not be restored: ${errorText(error)}`);
                }
            }
            // Baseline for items whose workspace content now mirrors disk.
            const after = await renderWorkspace({
                state: deps.store.getState(),
                baseline: withPaths(current.baseline, applied.appliedIds),
                yaml: deps.yaml(),
                digest: deps.digest,
                imageHash,
                entryCache,
            });
            for (const [id, path] of applied.appliedIds) {
                const item = after.items.get(id);
                const diskItem = disk.get(path);
                if (item && diskItem) {
                    current.baseline[id] = { id, kind: item.kind, path, wsHash: item.hash, diskHash: diskItem.hash };
                }
            }
        }

        // Equal pairs (and matched paths of untouched items) become the new baseline.
        for (const item of result.adopt) {
            const ws = render.items.get(item.id);
            const diskItem = disk.get(item.path);
            if (ws && diskItem) {
                current.baseline[item.id] = { id: item.id, kind: item.kind, path: item.path, wsHash: ws.hash, diskHash: diskItem.hash };
            }
        }
        current.lastSyncAt = now();
        await persist();
        setStatus({ busy: { label: 'Writing files', done: 0, total: 0 }, lastSyncAt: current.lastSyncAt, conflicts: skipped });
        await push(report);
        setStatus({ busy: null });
        const finished = report.finish();
        deps.emit?.('wi-workspace:md-synced', { report: finished });
        deps.onReport?.(finished);
        return finished;
    };

    const withPaths = (
        baseline: Record<string, BaselineItem>,
        applied: ReadonlyMap<string, RelPath>
    ): Record<string, BaselineItem> => {
        const copy: Record<string, BaselineItem> = { ...baseline };
        for (const [id, path] of applied) {
            const kind: MdItemKind = baseline[id]?.kind ?? 'entry';
            copy[id] = { id, kind, path, wsHash: '', diskHash: '' };
        }
        return copy;
    };

    const guarded = async <T>(label: string, run: () => Promise<T>): Promise<T | null> => {
        try {
            return await exclusive(run);
        } catch (error) {
            setStatus({ busy: null });
            if (error instanceof DiskError && error.code === 'permission') {
                setStatus({ phase: 'needs-reconnect' });
            } else if (error instanceof DiskError && error.code === 'not-found') {
                setStatus({ phase: 'unavailable' });
            }
            deps.onError?.(`${label} failed: ${errorText(error)}`);
            return null;
        } finally {
            if (pushAgain) {
                pushAgain = false;
                schedulePush();
            }
        }
    };

    const startLink = async (): Promise<void> => {
        let picked: Awaited<ReturnType<DiskFolderAccess['pick']>>;
        try {
            picked = await deps.access.pick('readwrite');
        } catch (error) {
            deps.onError?.(`The folder could not be opened: ${errorText(error)}`);
            return;
        }
        if (!picked) {
            return;
        }
        const previous = link;
        link = {
            formatVersion: 1,
            handle: picked.handle,
            folderName: picked.name,
            workspaceRootId: deps.store.getState().root.id,
            linkedAt: now(),
            lastSyncAt: null,
            baseline: {},
        };
        setStatus({ phase: 'linked', folderName: picked.name, lastSyncAt: null, heldBack: 0, conflicts: 0 });
        const report = await guarded('Linking the folder', () => pull({ initial: true }));
        if (report === null) {
            link = previous;
            if (previous) {
                setStatus({ phase: 'linked', folderName: previous.folderName, lastSyncAt: previous.lastSyncAt });
            } else {
                setStatus({ phase: 'none', folderName: null, lastSyncAt: null });
            }
        }
    };

    const accessAndPull = async (userActivation: boolean): Promise<void> => {
        if (!link) {
            return;
        }
        let state: AccessState = await deps.access.queryAccess(link);
        if (state === 'prompt' && userActivation) {
            state = await deps.access.requestAccess(link);
        }
        if (state === 'granted') {
            setStatus({ phase: 'linked' });
            await guarded('Syncing the linked folder', () => pull({ initial: false }));
        } else if (state === 'prompt') {
            setStatus({ phase: 'needs-reconnect' });
        } else {
            setStatus({ phase: 'unavailable' });
        }
    };

    return {
        getStatus: () => status,
        subscribe: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        init: async () => {
            setStatus({ phase: 'loading' });
            try {
                const stored = await deps.access.loadLink();
                if (!stored) {
                    setStatus({ phase: 'none' });
                    return;
                }
                if (stored.workspaceRootId !== deps.store.getState().root.id) {
                    stored.baseline = {};
                }
                link = stored;
                const access = await deps.access.queryAccess(stored);
                setStatus({
                    phase: access === 'granted' ? 'linked' : access === 'prompt' ? 'needs-reconnect' : 'unavailable',
                    folderName: stored.folderName,
                    lastSyncAt: stored.lastSyncAt,
                });
            } catch (error) {
                setStatus({ phase: 'none' });
                deps.onError?.(`The stored folder link could not be loaded: ${errorText(error)}`);
            }
        },
        link: startLink,
        relink: startLink,
        unlink: async () => {
            if (pushTimer !== null) {
                clearTimeout(pushTimer);
                pushTimer = null;
            }
            await exclusive(async () => {
                link = null;
                forced.clear();
                await deps.access.clearLink();
            });
            setStatus({ phase: 'none', folderName: null, lastSyncAt: null, heldBack: 0, conflicts: 0, trackedIds: new Set() });
        },
        syncNow: async () => {
            if (!link) {
                return null;
            }
            if (status.phase !== 'linked') {
                await accessAndPull(true);
                return null;
            }
            return guarded('Syncing the linked folder', () => pull({ initial: false }));
        },
        onWorkspaceOpened: async ({ userActivation }) => {
            if (status.busy) {
                return;
            }
            await accessAndPull(userActivation);
        },
        reconnect: () => accessAndPull(true),
        flush: async () => {
            if (pushTimer !== null) {
                clearTimeout(pushTimer);
                pushTimer = null;
                await guarded('Writing to the linked folder', () => push());
            } else if (running) {
                await running.catch(() => undefined);
            }
        },
        dispose: () => {
            unsubscribeStore();
            if (pushTimer !== null) {
                clearTimeout(pushTimer);
            }
        },
    };
}

function syncedBooksOf(state: WorkspaceState, id: string): string[] {
    const stack = [state.root as WorkspaceState['root'] | WorkspaceState['root']['children'][number]];
    while (stack.length > 0) {
        const node = stack.pop()!;
        if (node.id === id) {
            return node.kind === 'entry' ? Object.keys(node.sync.books) : [];
        }
        if (node.kind === 'folder') {
            stack.push(...node.children);
        }
    }
    return [];
}
