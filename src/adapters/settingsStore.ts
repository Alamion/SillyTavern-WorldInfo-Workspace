import { getAppContext } from './appApi';
import { confirmDialog } from './popups';
import { notifyInfo, notifyWarning } from './logger';
import { createSaveGate, type SaveGate } from './saveGate';
import { readSavedWorkspace } from './savedSettings';
import { hasPendingDrafts } from './draftRegistry';
import type { SaveEvent } from './saveEvents';
import {
    MODULE_NAMESPACE,
    deepValidateState,
    isFreshRecovery,
    migrate,
    type WorkspaceState,
} from '../core/state/schema';
import { WorkspaceStore } from '../core/state/store';
import { createWorldInfoAdapter, type WorldInfoAdapter } from './worldInfoAdapter';
import { createHookEmitter } from './hooks';
import { WI_EVENTS } from '../core/hooks/events';
import { diffTree } from '../core/hooks/treeDiff';
import { createActiveBooksAdapter, type ActiveBooksAdapter } from './activeBooksAdapter';
import { createSyncEngine, type SyncEngine } from './syncEngine';
import { createMdController, type MdController } from './mdController';
import { createAssistantController, type AssistantController } from './assistantController';
import { createLlmClient } from './llmClient';
import { openConversationStore } from './conversationStore';
import { createChatContext } from './chatContext';
import { createInteropSources } from './interopSources';
import { createPickingController, type PickingController } from './pickingController';
import { getLiveAppContext } from './appApi';
import { fsaAccess } from './fsaDisk';
import { createAvailability, type AvailabilityService } from './availability';
import { createImageGeneration, fetchImageBytes, type ImageGeneration } from './imageGeneration';
import { createImageCaption, preparePicture, type ImageCaption } from './imageCaption';
import type { SlashCommandObject } from '../global';
import { createImageStore } from './imageStore';
import { ownedSrcsReleasedBy } from '../core/md/imageRefs';

/**
 * Bridges the pure workspace state into the app's persistence: reads
 * `extensionSettings[MODULE_NAMESPACE]` once at startup, migrates it, keeps the
 * namespace reference pointing at the latest store state before every debounced
 * settings save (research R2), and builds the app-boundary services
 * (world-info adapter, active-books drive, sync engine).
 */
export interface WorkspaceStateServices {
    store: WorkspaceStore;
    worldInfo: WorldInfoAdapter;
    activeBooks: ActiveBooksAdapter;
    sync: SyncEngine;
    md: MdController;
    assistant: AssistantController;
    /** Spec 007: main-chat lore picking (the generation interceptor). */
    picking: PickingController;
    /** Spec 008: stale-tab protection (save gate, conflict banner state). */
    gate: SaveGate;
    /** Spec 009: which optional functions can run now, and why not. */
    availability: AvailabilityService;
    /** Spec 009: picture generation for image items (Image Generation extension). */
    imageGeneration: ImageGeneration;
    /** Spec 009: prompt drafts and captions through connection profiles. */
    imageCaption: ImageCaption;
}

/** Spec 008 clarification: a visible tab nobody touches checks every 2 minutes. */
const STALE_CHECK_INTERVAL_MS = 2 * 60 * 1000;

let services: WorkspaceStateServices | null = null;
const pickRecordedListeners = new Set<(messageId: number) => void>();

/** The message icon (adapters/pickIndicator.ts) listens for newly recorded picks. */
export function onPickRecorded(listener: (messageId: number) => void): () => void {
    pickRecordedListeners.add(listener);
    return () => pickRecordedListeners.delete(listener);
}
/**
 * True while a data recovery is unresolved and the empty fallback has NOT been
 * published: assistant settings must not be saved in that window, because any
 * publish would overwrite the recoverable payload (spec 005 FR-035).
 */
let recoveryPending = false;

export function isRecoveryPending(): boolean {
    return recoveryPending;
}

export function initWorkspaceState(): WorkspaceStateServices {
    if (services) {
        return services;
    }
    const ctx = getAppContext();
    const raw = ctx.extensionSettings[MODULE_NAMESPACE];
    const state: WorkspaceState = migrate(raw);
    const store = new WorkspaceStore(state);
    const recoveredNow = isFreshRecovery(raw, state);
    recoveryPending = recoveredNow;

    const publish = (): void => {
        ctx.extensionSettings[MODULE_NAMESPACE] = store.getState();
    };
    // On recovery the untouched payload stays in the namespace until the user
    // actually edits: any app-wide settings save would otherwise persist the
    // empty fallback over it (settings are shared by every device, and a stale
    // bundle on one device must not wipe the workspace for all of them).
    if (!recoveredNow) {
        publish();
    }

    if (recoveredNow) {
        notifyWarning(
            'Workspace data could not be loaded — an empty workspace is shown. ' +
                'Your data is untouched until you edit; it can be restored from the banner.'
        );
    }

    const worldInfo = createWorldInfoAdapter(ctx);
    const activeBooks = createActiveBooksAdapter();
    const emit = createHookEmitter(ctx);
    const sync = createSyncEngine({ ctx, store, worldInfo, emit });

    // Spec 008: the save gate is the only publisher of the workspace into the app's
    // settings. It compares with the saved copy before saves and pushes, picks up
    // newer work from other tabs, restores over stale overwrites, or asks.
    const gate = createSaveGate({
        store,
        readSaved: () => readSavedWorkspace(ctx),
        publish: (next) => {
            ctx.extensionSettings[MODULE_NAMESPACE] = next;
        },
        save: () => ctx.saveSettingsDebounced(),
        writerId: Math.random().toString(16).slice(2, 10).padEnd(8, '0'),
        now: () => Date.now(),
        hasPendingDrafts,
        isRecoveryPending,
        notify: notifyInfo,
        onReleased: () => void sync.pushPendingNow('conflict-decided'),
        onLoaded: () => {
            // "Use the saved version" during a recovery replaces the fallback.
            recoveryPending = false;
            // The other tab's pushes are newer than this tab's app book cache.
            sync.markBooksStale();
        },
    });
    sync.setGate(gate);
    const checkNow = (): void => {
        void gate.check();
    };
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            checkNow();
        }
    });
    window.addEventListener('focus', checkNow);
    window.setInterval(() => {
        if (document.visibilityState === 'visible') {
            checkNow();
        }
    }, STALE_CHECK_INTERVAL_MS);

    /**
     * Public tree events (FR-007/FR-009). Derived from the store rather than from
     * the mutation sites: `applyTreeChange` is not the universal funnel, so only
     * a store-level diff can guarantee exactly one event per occurrence for every
     * route (spec 006 R9).
     *
     * Coalesced on a microtask because one logical change legitimately publishes
     * more than once — applyTreeChange replaces and then refreshes structure, and
     * undo restores fields one at a time.
     */
    let treeEventBase = store.getState();
    let treeFlushQueued = false;
    store.subscribe(() => {
        if (treeFlushQueued) {
            return;
        }
        treeFlushQueued = true;
        queueMicrotask(() => {
            treeFlushQueued = false;
            const next = store.getState();
            const changes = diffTree(treeEventBase, next);
            treeEventBase = next;
            if (changes.length > 0) {
                emit(WI_EVENTS.treeChanged, { changes });
            }
        });
    });

    const imageStore = createImageStore({ getRequestHeaders: () => ctx.getRequestHeaders() });
    const md = createMdController({
        store,
        sync,
        newId: () => ctx.uuidv4(),
        access: fsaAccess,
        imageStore,
        emit,
    });
    // FR-024: owned stored images nothing references any more are deleted.
    let previousState = store.getState();
    store.subscribe(() => {
        const next = store.getState();
        const released = ownedSrcsReleasedBy(previousState, next, imageStore.isOwned);
        previousState = next;
        for (const src of released) {
            imageStore.remove(src).catch((error: unknown) => {
                notifyWarning(`A stored image could not be deleted (${src}): ${String(error)}`);
            });
        }
    });

    if (fsaAccess.isSupported()) {
        void md.link.init();
    }

    const llm = createLlmClient(() => ctx);
    const assistant = createAssistantController({
        store,
        sync,
        confirm: confirmDialog,
        trackedIds: () => md.link.getStatus().trackedIds,
        llm,
        conversations: openConversationStore(),
        chat: createChatContext(),
        interop: createInteropSources(),
        newId: () => ctx.uuidv4(),
        now: () => new Date().toISOString(),
        isRecoveryPending,
        emit,
    });
    void assistant.init().catch((error: unknown) => {
        notifyWarning(`Assistant conversations could not be loaded: ${String(error)}`);
    });

    const picking = createPickingController({
        context: getLiveAppContext,
        store,
        llm,
        emit,
        notice: notifyWarning,
        now: () => Date.now(),
        onRecorded: (messageId) => pickRecordedListeners.forEach((listener) => listener(messageId)),
        isRecoveryPending,
    });
    picking.start();

    const availability = createAvailability({ context: getLiveAppContext, store });
    availability.start();

    const imageGeneration = createImageGeneration({
        store,
        getImagine: () => {
            const command: unknown = getLiveAppContext().SlashCommandParser?.commands['imagine'];
            return typeof command === 'object' && command !== null && typeof (command as SlashCommandObject).callback === 'function'
                ? (command as SlashCommandObject)
                : null;
        },
        fetchBytes: fetchImageBytes,
        upload: (input) => imageStore.upload(input),
        removeTemporary: (url) => imageStore.removeTemporary(url),
        warn: notifyWarning,
    });

    const imageCaption = createImageCaption({ store, llm, preparePicture, isRecoveryPending });

    services = {
        store,
        worldInfo,
        activeBooks,
        sync,
        md,
        assistant,
        picking,
        gate,
        availability,
        imageGeneration,
        imageCaption,
    };
    return services;
}

export type RestoreOutcome = { ok: true } | { ok: false; issues: string[] };

/**
 * Replaces the workspace with the recovery backup when the current code can load
 * it (e.g. the recovery came from a stale bundle on another device). The backup
 * stays in place when it is still invalid.
 */
export function restoreRecovered(store: WorkspaceStore): RestoreOutcome {
    const backup = store.getState()._recovered;
    if (backup === undefined) {
        return { ok: false, issues: ['no backup is stored'] };
    }
    const candidate: unknown = structuredClone(backup);
    const restored = migrate(candidate);
    if (isFreshRecovery(candidate, restored)) {
        const issues = describeIssues(candidate);
        return { ok: false, issues: issues.length > 0 ? issues : ['backup has an unsupported structure'] };
    }
    store.replace(restored);
    recoveryPending = false;
    return { ok: true };
}

export function discardRecovered(store: WorkspaceStore): void {
    store.update((draft) => {
        delete draft._recovered;
    });
    recoveryPending = false;
}

function describeIssues(candidate: unknown): string[] {
    try {
        return deepValidateState(candidate as WorkspaceState);
    } catch {
        // Structurally broken beyond what the deep validator can walk.
        return [];
    }
}

export function getWorkspaceState(): WorkspaceStateServices {
    if (!services) {
        throw new Error('[WorldInfoWorkspace] workspace state accessed before init');
    }
    return services;
}

export type { SaveEvent };