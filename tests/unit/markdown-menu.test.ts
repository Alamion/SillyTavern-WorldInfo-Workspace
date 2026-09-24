// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { MarkdownControl } from '../../src/ui/MarkdownControl';
import type { MdController } from '../../src/adapters/mdController';

/**
 * The markdown header button toggles its menu. The outside-press handler closes the
 * menu on pointerdown, so a press on the button itself must not count as outside —
 * otherwise the following click would reopen the menu instead of closing it.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;

const noop = (): (() => void) => () => {};
const ui = { busy: null, lastReport: null, pending: null };
const status = { phase: 'none', busy: null, folderName: null, lastSyncAt: null, heldBack: 0, conflicts: 0 };
const md = {
    subscribe: noop,
    getUi: () => ui,
    isSupported: () => true,
    link: { subscribe: noop, getStatus: () => status },
} as unknown as MdController;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    container = document.createElement('div');
    container.className = 'wiw-surface';
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
        root.render(
            createElement(MarkdownControl, {
                md,
                exportScopeId: 'root',
                exportScopeLabel: 'workspace',
                importTargetId: 'root',
                importTargetLabel: 'workspace',
            }),
        );
    });
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

/** A real press: pointerdown (bubbles to window), then click. */
function press(target: Element): void {
    act(() => {
        target.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    act(() => {
        target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
}

const menuButton = (): HTMLButtonElement =>
    container.querySelector('button.wiw-icon-button') as HTMLButtonElement;
const menuOpen = (): boolean => container.querySelector('.wiw-dropdown') !== null;

describe('markdown menu button', () => {
    it('opens the menu on the first press and closes it on the second', () => {
        press(menuButton());
        expect(menuOpen()).toBe(true);
        press(menuButton());
        expect(menuOpen()).toBe(false);
    });

    it('still closes on a press outside the menu', () => {
        press(menuButton());
        press(document.body);
        expect(menuOpen()).toBe(false);
    });
});
