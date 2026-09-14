import { getAppContext } from './appApi';
import { notifyWarning } from './logger';
import { emitSaveEvent, type SaveEvent } from './saveEvents';
import {
    MODULE_NAMESPACE,
    migrate,
    type WorkspaceState,
} from '../core/state/schema';
import { WorkspaceStore } from '../core/state/store';
import { createWorldInfoAdapter, type WorldInfoAdapter } from './worldInfoAdapter';
import { createActiveBooksAdapter, type ActiveBooksAdapter } from './activeBooksAdapter';
import { createSyncEngine, type SyncEngine } from './syncEngine';

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
}

let services: WorkspaceStateServices | null = null;

export function initWorkspaceState(): WorkspaceStateServices {
    if (services) {
        return services;
    }
    const ctx = getAppContext();
    const raw = ctx.extensionSettings[MODULE_NAMESPACE];
    const state: WorkspaceState = migrate(raw);
    const store = new WorkspaceStore(state);

    const publish = (): void => {
        ctx.extensionSettings[MODULE_NAMESPACE] = store.getState();
    };
    publish();
    store.subscribe(() => {
        publish();
        ctx.saveSettingsDebounced();
    });

    if (state._recovered !== undefined) {
        emitSaveEvent({
            kind: 'failure',
            scope: 'settings',
            message:
                'Persisted workspace data was invalid; a fresh workspace was created. ' +
                'The previous payload is preserved in settings under "_recovered".',
        });
        notifyWarning(
            'Workspace data could not be restored — a fresh workspace was created. ' +
                'The old payload is kept under _recovered in the extension settings.'
        );
    }

    const worldInfo = createWorldInfoAdapter(ctx);
    const activeBooks = createActiveBooksAdapter();
    const sync = createSyncEngine({ ctx, store, worldInfo });

    services = { store, worldInfo, activeBooks, sync };
    return services;
}

export function getWorkspaceState(): WorkspaceStateServices {
    if (!services) {
        throw new Error('[WorldInfoWorkspace] workspace state accessed before init');
    }
    return services;
}

export type { SaveEvent };