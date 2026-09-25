// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import {
    installViewportScrollGuard,
    KEYBOARD_CLOSE_GROWTH_PX,
    type ViewportHost,
} from '../../src/adapters/viewportScrollGuard';

/**
 * Mobile keyboard vs a host layout whose document is taller than the screen
 * (AstraProjecta): the browser scrolls the `overflow: hidden` root to show the focused
 * field, and nothing the user can do scrolls it back. The guard restores the root.
 */

interface Harness {
    container: HTMLElement;
    field: HTMLTextAreaElement;
    outside: HTMLInputElement;
    /** What the browser does when the keyboard opens over the field. */
    keyboardOpens(scrollY: number): void;
    keyboardCloses(): void;
    resize(height: number): void;
    scrollY(): number;
}

function setup(rootOverflow: string): Harness {
    document.body.innerHTML = '<div id="c"><textarea></textarea><input id="in"></div><input id="out">';
    const container = document.getElementById('c') as HTMLElement;
    let position = { x: 0, y: 0 };
    const viewport = new EventTarget() as EventTarget & { height: number };
    viewport.height = 844;
    const host: ViewportHost = {
        document,
        scrollPosition: () => position,
        scrollTo: (x, y) => {
            position = { x, y };
        },
        overflowY: (element) => (element === document.body ? rootOverflow : 'visible'),
        visualViewport: viewport,
    };
    installViewportScrollGuard(container, host);
    const resize = (height: number): void => {
        viewport.height = height;
        viewport.dispatchEvent(new Event('resize'));
    };
    return {
        container,
        field: container.querySelector('textarea') as HTMLTextAreaElement,
        outside: document.getElementById('out') as HTMLInputElement,
        keyboardOpens: (scrollY) => {
            resize(844 - 380);
            position = { x: 0, y: scrollY };
        },
        keyboardCloses: () => resize(844),
        resize,
        scrollY: () => position.y,
    };
}

describe('viewport scroll guard', () => {
    let h: Harness;

    describe('root not user-scrollable', () => {
        beforeEach(() => {
            h = setup('hidden');
        });

        it('restores the root when the keyboard closes and the field keeps focus', () => {
            h.field.focus();
            h.keyboardOpens(400);
            expect(h.scrollY()).toBe(400);
            h.keyboardCloses();
            expect(h.scrollY()).toBe(0);
            expect(document.activeElement).toBe(h.field);
        });

        it('restores the root when focus leaves the workspace', () => {
            h.field.focus();
            h.keyboardOpens(400);
            h.outside.focus();
            expect(h.scrollY()).toBe(0);
        });

        it('keeps the scroll while focus moves between workspace fields', () => {
            h.field.focus();
            h.keyboardOpens(400);
            (h.container.querySelector('#in') as HTMLInputElement).focus();
            expect(h.scrollY()).toBe(400);
        });

        it('ignores small viewport growth while typing', () => {
            h.field.focus();
            h.keyboardOpens(400);
            h.resize(844 - 380 + KEYBOARD_CLOSE_GROWTH_PX - 1);
            expect(h.scrollY()).toBe(400);
        });
    });

    it('never touches a root the user can scroll', () => {
        h = setup('auto');
        h.field.focus();
        h.keyboardOpens(400);
        h.keyboardCloses();
        h.outside.focus();
        expect(h.scrollY()).toBe(400);
    });
});
