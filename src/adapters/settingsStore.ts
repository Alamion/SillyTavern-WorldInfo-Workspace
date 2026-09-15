import { getAppContext } from './appApi';
import { confirmDialog } from './popups';
import { notifyWarning } from './logger';
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
import { createActiveBooksAdapter, type ActiveBooksAdapter } from './activeBooksAdapter';
import { createSyncEngine, type SyncEngine } from './syncEngine';
import { createMdController, type MdController } from './mdController';
import { createAssistantController, type AssistantController } from './assistantController';
import { createLlmClient } from './llmClient';
import { openConversationStore } from './conversationStore';
import { createChatContext } from './chatContext';
import { fsaAccess } from './fsaDisk';
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
}

let services: WorkspaceStateServices | null = null;
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
    store.subscribe(() => {
        publish();
        ctx.saveSettingsDebounced();
    });

    if (recoveredNow) {
        notifyWarning(
            'Workspace data could not be loaded — an empty workspace is shown. ' +
                'Your data is untouched until you edit; it can be restored from the banner.'
        );
    }

    const worldInfo = createWorldInfoAdapter(ctx);
    const activeBooks = createActiveBooksAdapter();
    const sync = createSyncEngine({ ctx, store, worldInfo });

    const imageStore = createImageStore({ getRequestHeaders: () => ctx.getRequestHeaders() });
    const md = createMdController({
        store,
        sync,
        newId: () => ctx.uuidv4(),
        access: fsaAccess,
        imageStore,
        emit: (event, payload) => void ctx.eventSource.emit(event, payload),
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

    const assistant = createAssistantController({
        store,
        sync,
        confirm: confirmDialog,
        trackedIds: () => md.link.getStatus().trackedIds,
        llm: createLlmClient(() => ctx),
        conversations: openConversationStore(),
        chat: createChatContext(),
        newId: () => ctx.uuidv4(),
        now: () => new Date().toISOString(),
        isRecoveryPending,
        emit: (event, payload) => void ctx.eventSource.emit(event, payload),
    });
    void assistant.init().catch((error: unknown) => {
        notifyWarning(`Assistant conversations could not be loaded: ${String(error)}`);
    });

    services = { store, worldInfo, activeBooks, sync, md, assistant };
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