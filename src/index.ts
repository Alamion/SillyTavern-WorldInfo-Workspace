import { getAppContext } from './adapters/appApi';
import { debugLog } from './adapters/logger';
import { initWorkspaceState, type WorkspaceStateServices } from './adapters/settingsStore';
import { mountWorkspaceShell } from './adapters/shell';
import { mountWorkspaceSurface } from './ui/mount';
import { flushDrafts } from './adapters/draftRegistry';
import { createHookEmitter } from './adapters/hooks';
import { WI_EVENTS } from './core/hooks/events';

const INIT_FLAG = '__worldInfoWorkspaceInitialized';

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
        debugLog(`workspace v${'0.3.0'} ready`);
        const services = initWorkspaceState();
        initSurface(services);
    });
}

initWorkspace();
