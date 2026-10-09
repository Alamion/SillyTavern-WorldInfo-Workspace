import { isFreshRecovery, migrate, type SaveMarker, type WorkspaceState } from '../core/state/schema';
import type { WorkspaceStore } from '../core/state/store';
import {
    classify,
    conflictSummary,
    contentHash,
    nextMarker,
    withBookkeeping,
    type ConflictSummary,
    type StalenessKind,
} from '../core/state/staleness';

/**
 * The save gate (spec 008, research R4–R7, contracts/persistence-delta.md).
 *
 * The app saves every tab's whole settings object, last writer wins. This gate is
 * the only place that publishes the workspace into those settings. Before a save
 * (and before native pushes, and at the moments a tab comes back) it reads what the
 * server holds and compares it with the copy this tab last saw:
 *
 * - unchanged → save as usual, with a new marker;
 * - newer elsewhere, no edits here → load it silently (bookkeeping kept);
 * - older than ours (a stale tab saved its old copy) → write ours back;
 * - both changed, or unknown age → publish nothing, hold pushes, ask (banner).
 *
 * Host capabilities are injected so the whole flow runs against a fake server in
 * tests.
 */

export interface SaveGateDeps {
    store: WorkspaceStore;
    /** The saved namespace as the server holds it now (throws when unreachable). */
    readSaved(): Promise<unknown>;
    /** Point the app's settings namespace at a state (the app saves that object). */
    publish(state: WorkspaceState): void;
    /** The app's settings save. */
    save(): void;
    /** Random per page load. */
    writerId: string;
    now(): number;
    hasPendingDrafts(): boolean;
    isRecoveryPending(): boolean;
    notify(message: string): void;
    /** Held native pushes may go on (after a conflict choice). */
    onReleased?(): void;
    /** A saved workspace replaced this tab's (silent load or "Use the saved version"). */
    onLoaded?(): void;
    saveDelayMs?: number;
}

export type GateResult = StalenessKind | 'failed';

export interface GateConflict {
    summary: ConflictSummary;
    /** A data recovery is pending in this tab (FR-011): only "use saved" is offered. */
    recovery: boolean;
}

export interface SaveGate {
    /** Compare with the server now and act on it (FR-003 moments). */
    check(): Promise<GateResult>;
    /** For native pushes: false while a conflict is open (the push waits). */
    ready(): Promise<boolean>;
    conflict(): GateConflict | null;
    useSaved(): void;
    keepMine(): void;
    subscribe(listener: () => void): () => void;
    /** Run a scheduled save now (tests). */
    flush(): Promise<void>;
}

export const NOTICE_LOADED = 'Updated with changes made in another tab or device.';
export const NOTICE_RESTORED = 'Restored the newer workspace from this tab; another tab had saved an older copy.';
export const NOTICE_KEPT = 'Saved this version.';

/** Fetched results this young are reused by checks and pushes (research R6). */
const REUSE_MS = 3000;
/** Our own save travels through the app's debounced save: allow it to land. */
const WRITE_GRACE_MS = 5000;
const RETRY_MS = 2000;

interface Seen {
    state: WorkspaceState;
    hash: string;
    marker: SaveMarker | undefined;
}

type Reason = 'save' | 'check' | 'push';

export function createSaveGate(deps: SaveGateDeps): SaveGate {
    const { store } = deps;
    const listeners = new Set<() => void>();
    const initial = store.getState();
    let seen: Seen = { state: initial, hash: contentHash(initial), marker: initial._save };
    let conflictState: { saved: WorkspaceState; view: GateConflict } | null = null;
    let applying = false;
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    let lastWrite: { marker: SaveMarker; at: number } | null = null;
    let fetched: { at: number; saved: WorkspaceState | null } | null = null;
    let running: Promise<GateResult> = Promise.resolve('unchanged');

    const emit = (): void => listeners.forEach((listener) => listener());

    const localEdits = (): boolean =>
        deps.hasPendingDrafts() || contentHash(store.getState()) !== seen.hash;

    /** The saved workspace, or null when nothing usable is saved (never saved, invalid). */
    const read = async (reuse: boolean): Promise<WorkspaceState | null> => {
        if (reuse && fetched && deps.now() - fetched.at < REUSE_MS) {
            return fetched.saved;
        }
        const raw = await deps.readSaved();
        let saved: WorkspaceState | null = null;
        if (raw !== undefined && raw !== null) {
            const migrated = migrate(raw);
            saved = isFreshRecovery(raw, migrated) ? null : migrated;
        }
        fetched = { at: deps.now(), saved };
        return saved;
    };

    const write = (savedMarker: SaveMarker | undefined): void => {
        const state = store.getState();
        const hash = contentHash(state);
        const marker = nextMarker(seen.marker, savedMarker, deps.writerId, hash, new Date(deps.now()).toISOString());
        const stamped: WorkspaceState = { ...state, _save: marker };
        deps.publish(stamped);
        deps.save();
        seen = { state: stamped, hash, marker };
        lastWrite = { marker, at: deps.now() };
        fetched = null;
    };

    const load = (saved: WorkspaceState, notice: string | null): void => {
        const merged = withBookkeeping(saved, store.getState());
        applying = true;
        try {
            store.replace(merged);
        } finally {
            applying = false;
        }
        deps.publish(merged);
        seen = { state: merged, hash: contentHash(merged), marker: saved._save };
        fetched = null;
        deps.onLoaded?.();
        if (notice !== null) {
            deps.notify(notice);
        }
    };

    const openConflict = (saved: WorkspaceState): void => {
        conflictState = {
            saved,
            view: {
                summary: conflictSummary(seen.state, store.getState(), saved),
                recovery: deps.isRecoveryPending(),
            },
        };
        emit();
    };

    const release = (): void => {
        conflictState = null;
        emit();
        deps.onReleased?.();
    };

    /** Our own save may not have reached the server yet: do not mistake it for staleness. */
    const ownWriteInFlight = (saved: WorkspaceState | null): boolean => {
        if (!lastWrite) {
            return false;
        }
        const landed =
            saved?._save?.writer === lastWrite.marker.writer && saved._save.rev === lastWrite.marker.rev;
        if (landed || deps.now() - lastWrite.at > WRITE_GRACE_MS) {
            lastWrite = null;
            return false;
        }
        return true;
    };

    const act = async (reason: Reason): Promise<GateResult> => {
        let saved: WorkspaceState | null;
        try {
            saved = await read(reason !== 'save');
        } catch {
            return 'failed';
        }
        if (conflictState) {
            // Keep the banner current; nothing is published while it is open.
            if (saved && classify(seen, saved) !== 'unchanged') {
                openConflict(saved);
            }
            return 'conflict';
        }
        if (saved === null || ownWriteInFlight(saved)) {
            if (reason === 'save' && !deps.isRecoveryPending()) {
                write(undefined);
            }
            return 'unchanged';
        }
        const kind = classify(seen, saved);
        if (deps.isRecoveryPending()) {
            // FR-011: a valid saved workspace is offered, never loaded or overwritten.
            if (kind !== 'unchanged') {
                openConflict(saved);
                return 'conflict';
            }
            return kind;
        }
        switch (kind) {
            case 'unchanged':
                if (saved._save && (seen.marker?.rev ?? 0) < saved._save.rev) {
                    seen = { ...seen, marker: saved._save };
                }
                if (reason === 'save') {
                    write(saved._save);
                }
                return kind;
            case 'newer':
                if (localEdits()) {
                    openConflict(saved);
                    return 'conflict';
                }
                load(saved, NOTICE_LOADED);
                return kind;
            case 'older':
                write(saved._save);
                deps.notify(NOTICE_RESTORED);
                return kind;
            case 'conflict':
                openConflict(saved);
                return kind;
        }
    };

    /** One check at a time; later callers wait for the running one, then run theirs. */
    const run = (reason: Reason): Promise<GateResult> => {
        running = running.then(
            () => act(reason),
            () => act(reason)
        );
        return running;
    };

    const runSave = async (): Promise<void> => {
        saveTimer = null;
        if (conflictState) {
            return;
        }
        const result = await run('save');
        if (result !== 'failed') {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
        if ((await run('save')) === 'failed' && !conflictState) {
            // An unreachable server fails the save anyway; behave as before this feature.
            write(seen.marker);
        }
    };

    store.subscribe(() => {
        if (applying) {
            return;
        }
        if (deps.isRecoveryPending()) {
            // Unchanged recovery rule: the first edit persists the fallback (with the
            // raw payload under `_recovered`).
            deps.publish(store.getState());
            deps.save();
            return;
        }
        if (saveTimer !== null) {
            clearTimeout(saveTimer);
        }
        saveTimer = setTimeout(() => void runSave(), deps.saveDelayMs ?? 1000);
    });

    return {
        check: () => run('check'),
        ready: async () => {
            if (conflictState) {
                return false;
            }
            await run('push');
            return conflictState === null;
        },
        conflict: () => conflictState?.view ?? null,
        useSaved: () => {
            if (!conflictState) {
                return;
            }
            load(conflictState.saved, null);
            release();
        },
        keepMine: () => {
            if (!conflictState) {
                return;
            }
            write(conflictState.saved._save);
            deps.notify(NOTICE_KEPT);
            release();
        },
        subscribe: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        flush: async () => {
            if (saveTimer !== null) {
                clearTimeout(saveTimer);
                await runSave();
            }
        },
    };
}
