import { notifyWarning } from './logger';

/**
 * Host drawer composition (constitution II: the documented last-resort DOM
 * path, isolated here). The workspace and the native Worlds/Lorebooks editor
 * coexist as modes of the same drawer:
 *
 * - The root container is appended into `#WorldInfo` once; visibility is driven
 *   by the `body.wiw-active` class (workspace mode) vs the native `#wi-holder`.
 * - The DEFAULT mode is the native Worlds/Lorebooks editor (owner decision,
 *   2026-09-08): a "Workspace" button is inserted into the native editor's book
 *   row to switch over, and the workspace header carries a "Worlds/Lorebooks"
 *   button to switch back.
 * - Open/close detection stays a MutationObserver on the drawer's class/style
 *   attributes; the host keeps pin/autoclose/programmatic opens.
 */

const BODY_CLASS = 'wiw-active';
const DRAWER_SELECTOR = '#WorldInfo';
const HOLDER_SELECTOR = '#wi-holder';
const CREATE_BUTTON_SELECTOR = '#world_create_button';
const MOUNTED_WITNESS = 'data-wiw-mounted';
const NATIVE_BUTTON_CLASS = 'wiw-native-open';
const ROOT_CLASS = 'wiw-root';

export interface WorkspaceShell {
    root: HTMLElement;
    isOpen(): boolean;
    isWorkspaceMode(): boolean;
    setWorkspaceMode(on: boolean): void;
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

function buildNativeToggleButton(onActivate: () => void): HTMLElement {
    const button = document.createElement('div');
    button.id = 'wiw_open_workspace';
    button.className = `menu_button menu_button_icon ${NATIVE_BUTTON_CLASS}`;
    button.title = 'Open the World Info Workspace';
    const icon = document.createElement('i');
    icon.className = 'fa-solid fa-book-atlas';
    const label = document.createElement('span');
    label.textContent = 'Workspace';
    button.append(icon, label);
    button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        onActivate();
    });
    return button;
}

let activeMode: 'native' | 'workspace' = 'native';

function applyMode(on: boolean): void {
    activeMode = on ? 'workspace' : 'native';
    document.body.classList.toggle(BODY_CLASS, on);
}

export function mountWorkspaceShell(): WorkspaceShell | null {
    const drawer = document.querySelector(DRAWER_SELECTOR);
    if (!drawer) {
        notifyWarning(`host drawer ${DRAWER_SELECTOR} not found; workspace unavailable`);
        return null;
    }
    if (drawer.hasAttribute(MOUNTED_WITNESS)) {
        notifyWarning('shell already mounted; skipping duplicate init');
        return null;
    }

    const root = document.createElement('div');
    root.className = ROOT_CLASS;
    drawer.appendChild(root);
    drawer.setAttribute(MOUNTED_WITNESS, 'true');

    // Default mode is the native Worlds/Lorebooks editor (owner decision).
    applyMode(false);

    // Insert the mode toggle into the native editor's book row.
    const holder = document.querySelector(HOLDER_SELECTOR);
    const createButton = document.querySelector(CREATE_BUTTON_SELECTOR);
    const anchor: Element | null = createButton ?? holder;
    if (anchor?.parentElement) {
        const toggle = buildNativeToggleButton(() => applyMode(true));
        anchor.parentElement.insertBefore(toggle, anchor);
    } else {
        notifyWarning('native book row not found; the Workspace switch is unavailable');
    }

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
        isWorkspaceMode: () => activeMode === 'workspace',
        setWorkspaceMode: (on: boolean) => applyMode(on),
        onOpen: (handler) => openHandlers.push(handler),
        onClose: (handler) => closeHandlers.push(handler),
    };
}

/** Switches the drawer surface to the native Worlds/Lorebooks editor. */
export function openNativeMode(): void {
    applyMode(false);
}