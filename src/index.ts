import type { SillyTavernContext } from './global';
import { mountWorkspaceShell } from './adapters/shell';
import { mountWorkspacePrototype } from './ui/mount';

const INIT_FLAG = '__worldInfoWorkspaceInitialized';

function initPrototypeSurface(): void {
    const shell = mountWorkspaceShell();
    if (!shell) {
        return;
    }
    let mounted = false;
    const ensureMounted = (): void => {
        if (!mounted) {
            mountWorkspacePrototype(shell.root);
            mounted = true;
        }
    };
    shell.onOpen(ensureMounted);
    if (shell.isOpen()) {
        ensureMounted();
    }
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

    const ctx: SillyTavernContext = st.getContext();
    ctx.eventSource.on(ctx.eventTypes.APP_READY, () => {
        console.debug('[WorldInfoWorkspace] initialized');
        initPrototypeSurface();
    });
}

initWorkspace();
