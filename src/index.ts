import { getAppContext } from './adapters/appApi';
import { debugLog } from './adapters/logger';
import { initWorkspaceState, type WorkspaceStateServices } from './adapters/settingsStore';
import { mountWorkspaceShell } from './adapters/shell';
import { mountWorkspaceSurface } from './ui/mount';

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
    shell.onOpen(ensureMounted);
    if (shell.isOpen()) {
        ensureMounted();
    }
    // FR-009 flush point: pending book pushes complete before the panel closes.
    shell.onClose(() => {
        void services.sync.pushPendingNow('panel-close');
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
        debugLog(`workspace v${'0.2.0'} ready`);
        const services = initWorkspaceState();
        initSurface(services);
    });
}

initWorkspace();
