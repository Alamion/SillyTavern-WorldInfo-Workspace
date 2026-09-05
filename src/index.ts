import type { SillyTavernContext } from './global';

const INIT_FLAG = '__worldInfoWorkspaceInitialized';

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
    });
}

initWorkspace();
