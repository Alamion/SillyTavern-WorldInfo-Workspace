// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { NumberField, OptionRow } from '../../src/ui/formControls';

/**
 * Shared form controls (AGENTS.md "Style system"). The lore picking panel shipped
 * with white number fields on a dark theme and a centered checkbox because its
 * controls were themed only inside the assistant; these tests keep the shared
 * pieces honest.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
        root = createRoot(container);
    });
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

function type(input: HTMLInputElement, value: string): void {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

function blur(input: HTMLInputElement): void {
    act(() => {
        input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
}

describe('NumberField', () => {
    const renderField = (onCommit: (value: number) => void, problem?: (value: number) => string | null) => {
        act(() => {
            root.render(createElement(NumberField, { label: 'Wait', value: 20, min: 5, max: 120, onCommit, problem }));
        });
        return container.querySelector('input')!;
    };

    it('commits a valid number on blur, not per keystroke', () => {
        const onCommit = vi.fn();
        const input = renderField(onCommit);
        type(input, '3');
        type(input, '30');
        expect(onCommit).not.toHaveBeenCalled();
        blur(input);
        expect(onCommit).toHaveBeenCalledExactlyOnceWith(30);
    });

    it('keeps an out-of-range value with its reason and does not commit', () => {
        const onCommit = vi.fn();
        const input = renderField(onCommit);
        type(input, '500');
        blur(input);
        expect(onCommit).not.toHaveBeenCalled();
        expect(input.value).toBe('500');
        expect(container.querySelector('.wiw-field-error')?.textContent).toBe('Use 5–120.');
    });

    it('uses the caller reason when given and restores the saved value on Escape', () => {
        const onCommit = vi.fn();
        const input = renderField(onCommit, (value) => (value === 40 ? 'Too close to the limit.' : null));
        type(input, '40');
        blur(input);
        expect(container.querySelector('.wiw-field-error')?.textContent).toBe('Too close to the limit.');
        act(() => {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
        expect(input.value).toBe('20');
        expect(container.querySelector('.wiw-field-error')).toBeNull();
        expect(onCommit).not.toHaveBeenCalled();
    });
});

describe('OptionRow', () => {
    it('is one clickable row: control first, title and hint beside it', () => {
        const onChange = vi.fn();
        act(() => {
            root.render(
                createElement(OptionRow, { type: 'checkbox', checked: false, title: 'On', hint: 'Why', onChange })
            );
        });
        const row = container.querySelector('label.wiw-option')!;
        expect(row.firstElementChild?.tagName).toBe('INPUT');
        expect(row.querySelector('.wiw-option-title')?.textContent).toBe('On');
        expect(row.querySelector('.wiw-hint')?.textContent).toBe('Why');
        act(() => (row.querySelector('.wiw-option-title') as HTMLElement).click());
        expect(onChange).toHaveBeenCalledWith(true);
    });
});

describe('style system guards', () => {
    const read = (path: string): string => readFileSync(resolve(__dirname, '../..', path), 'utf8');

    it('themes form controls for the whole workspace, not one region', () => {
        const theme = read('src/styles/wiw-theme.scss');
        const shared = /\.wiw-root\s*:where\(([^{]+)\)\s*\{/.exec(theme)?.[1] ?? '';
        for (const control of ["input[type='text']", "input[type='number']", 'select', 'textarea']) {
            expect(shared).toContain(control);
        }
        // The assistant-only block was the trap: a panel outside it got white fields.
        expect(theme).not.toMatch(/^\.wiw-assistant \{\s*input\[type='text'\]/m);
    });

    it('gives every workspace header button its own icon', () => {
        const app = read('src/ui/WorkspaceApp.tsx');
        const header = app.slice(app.indexOf('<header className="wiw-header">'), app.indexOf('</header>'));
        const icons = [...header.matchAll(/fa-solid (fa-[a-z-]+)/g)].map((match) => match[1]);
        expect(icons.length).toBeGreaterThanOrEqual(4);
        expect(new Set(icons).size).toBe(icons.length);
    });
});
