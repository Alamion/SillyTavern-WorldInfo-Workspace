import { getAppContext } from './adapters/appApi';
import { debugLog } from './adapters/logger';
import { initWorkspaceState, type WorkspaceStateServices } from './adapters/settingsStore';
import { mountWorkspaceShell } from './adapters/shell';
import { mountWorkspaceSurface } from './ui/mount';
import { flushDrafts } from './adapters/draftRegistry';
import { createHookEmitter } from './adapters/hooks';
import { WI_EVENTS } from './core/hooks/events';
import { onPickRecorded } from './adapters/settingsStore';
import { mountPickIndicator } from './adapters/pickIndicator';
import type { GenerateInterceptor } from './global';

const INIT_FLAG = '__worldInfoWorkspaceInitialized';

let pickInterceptor: GenerateInterceptor | null = null;

/**
 * Main-chat lore picking (spec 007 US5): the manifest names this global as the
 * generation interceptor. It is registered at load, before the services exist;
 * until then (and whenever picking is off) it returns at once.
 */
(globalThis as Record<string, unknown>)['wiwPickInterceptor'] = (async (chat, contextSize, abort, type) => {
    if (pickInterceptor !== null) {
        await pickInterceptor(chat, contextSize, abort, type);
    }
}) satisfies GenerateInterceptor;

function initSurface(services: WorkspaceStateServices): void {
    const shell = mountWorkspaceShell();
    if (!shell) {
        return;
    }
    let mounted = false;
    const ensureMounted = (): void => {
        if (!mounted) {
            mountWorkspaceSurface(shell.root, services);
            mounted = true;
        }
    };

    /**
     * Public visibility hooks (spec 006 FR-007). Deduped against the last
     * announced state: the drawer transition and the Workspace/native mode
     * switch both reach here, and opening the drawer already in workspace mode
     * fires both onOpen and onWorkspaceShown.
     */
    const emit = createHookEmitter(getAppContext());
    let announced: 'shown' | 'hidden' = 'hidden';
    const announceVisibility = (): void => {
        const visible = shell.isOpen() && shell.isWorkspaceMode();
        const next = visible ? 'shown' : 'hidden';
        if (next === announced) {
            return;
        }
        announced = next;
        emit(visible ? WI_EVENTS.workspaceShown : WI_EVENTS.workspaceHidden, {
            mode: shell.isWorkspaceMode() ? 'workspace' : 'native',
        });
    };

    shell.onOpen(() => {
        ensureMounted();
        announceVisibility();
    });
    if (shell.isOpen()) {
        // Already open at init: this path does not go through onOpen.
        ensureMounted();
        announceVisibility();
    }
    // FR-009 flush point: pending book pushes complete before the panel closes.
    // Uncommitted field drafts are committed FIRST, so the pushes that follow
    // carry the last thing the user typed (spec 006 R3).
    shell.onClose(() => {
        flushDrafts();
        announceVisibility();
        void services.sync.pushPendingNow('panel-close');
        void services.md.link.flush();
    });
    // Spec 004 FR-010: changes made in the linked folder are pulled when the
    // workspace is shown (the handler runs inside the click, keeping user activation).
    shell.onModeChange(announceVisibility);
    shell.onWorkspaceShown(() => {
        announceVisibility();
        // Spec 008: pick up work saved by another tab or device before editing here.
        void services.gate.check();
        // Spec 009: extensions and profiles may have changed while the workspace was away.
        services.availability.refresh();
        void services.md.link.onWorkspaceOpened({ userActivation: navigator.userActivation?.isActive ?? true });
    });
}

export function initWorkspace(): void {
    const scope = globalThis as { [INIT_FLAG]?: boolean };
    if (scope[INIT_FLAG]) {
        return;
    }
    scope[INIT_FLAG] = true;

    const st = globalThis.SillyTavern;
    if (!st) {
        throw new Error('[WorldInfoWorkspace] globalThis.SillyTavern is not available');
    }

    const ctx = getAppContext();
    ctx.eventSource.on(ctx.eventTypes.APP_READY, () => {
        debugLog('workspace ready');
        const services = initWorkspaceState();
        pickInterceptor = services.picking.interceptor;
        mountPickIndicator(services.picking, onPickRecorded);
        initSurface(services);
    });
}

initWorkspace();
