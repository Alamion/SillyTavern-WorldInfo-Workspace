const BODY_CLASS = 'wiw-active';
const DRAWER_SELECTOR = '#WorldInfo';
const MOUNTED_WITNESS = 'data-wiw-mounted';
const ROOT_CLASS = 'wiw-root';
const MODULE_TAG = '[WorldInfoWorkspace]';

export interface WorkspaceShell {
    root: HTMLElement;
    isOpen(): boolean;
    onOpen(handler: () => void): void;
    onClose(handler: () => void): void;
}

function isDrawerOpen(drawer: Element): boolean {
    if (drawer.classList.contains('closedDrawer')) {
        return false;
    }
    if (drawer.classList.contains('openDrawer')) {
        return true;
    }
    return !(drawer.getAttribute('style') ?? '').includes('display: none');
}

export function mountWorkspaceShell(): WorkspaceShell | null {
    const drawer = document.querySelector(DRAWER_SELECTOR);
    if (!drawer) {
        console.warn(
            `${MODULE_TAG} host drawer ${DRAWER_SELECTOR} not found; prototype unavailable`
        );
        return null;
    }
    if (drawer.hasAttribute(MOUNTED_WITNESS)) {
        console.warn(`${MODULE_TAG} shell already mounted; skipping duplicate init`);
        return null;
    }

    const root = document.createElement('div');
    root.className = ROOT_CLASS;
    drawer.appendChild(root);
    drawer.setAttribute(MOUNTED_WITNESS, 'true');
    document.body.classList.add(BODY_CLASS);

    const openHandlers: Array<() => void> = [];
    const closeHandlers: Array<() => void> = [];
    let open = isDrawerOpen(drawer);

    const observer = new MutationObserver(() => {
        const nowOpen = isDrawerOpen(drawer);
        if (nowOpen === open) {
            return;
        }
        open = nowOpen;
        const handlers = nowOpen ? openHandlers : closeHandlers;
        handlers.forEach((handler) => handler());
    });
    observer.observe(drawer, { attributes: true, attributeFilter: ['class', 'style'] });
    window.addEventListener('beforeunload', () => observer.disconnect(), { once: true });

    return {
        root,
        isOpen: () => open,
        onOpen: (handler) => openHandlers.push(handler),
        onClose: (handler) => closeHandlers.push(handler),
    };
}
