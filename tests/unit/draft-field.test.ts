// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { DRAFT_COMMIT_MS, useDraftField } from '../../src/ui/useDraftField';
import { flushDrafts, hasPendingDrafts } from '../../src/adapters/draftRegistry';

/**
 * Draft fields (spec 006 R3). The property that matters is not the debounce but
 * that NOTHING IS EVER LOST: blur, unmount and an explicit flush must all commit
 * pending text.
 */

interface Harness {
    setValue: (next: string) => void;
    blur: () => void;
    shown: () => string;
}

// Tells React this is an act()-aware environment (silences the warning).
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;

let container: HTMLDivElement;
let root: Root;

function render(element: ReactElement): void {
    act(() => {
        root.render(element);
    });
}

function makeField(
    commit: (next: string) => void,
    value: string
): { element: ReactElement; api: Harness } {
    const api: Harness = {
        setValue: () => {},
        blur: () => {},
        shown: () => '',
    };
    function Field(): ReactElement {
        const field = useDraftField(value, commit);
        api.setValue = (next) => act(() => field.onChange(next));
        api.blur = () => act(() => field.onBlur());
        api.shown = () => field.value;
        return createElement('span', null, field.value);
    }
    return { element: createElement(Field), api };
}

beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
        root = createRoot(container);
    });
});

afterEach(() => {
    act(() => {
        root.unmount();
    });
    container.remove();
    vi.useRealTimers();
});

describe('useDraftField', () => {
    it('shows typed text immediately without committing', () => {
        const commit = vi.fn();
        const { element, api } = makeField(commit, 'stored');
        render(element);
        api.setValue('typed');
        expect(api.shown()).toBe('typed');
        expect(commit).not.toHaveBeenCalled();
    });

    it('commits once after the debounce, with the latest text', () => {
        const commit = vi.fn();
        const { element, api } = makeField(commit, 'stored');
        render(element);
        api.setValue('a');
        api.setValue('ab');
        api.setValue('abc');
        expect(commit).not.toHaveBeenCalled();
        act(() => {
            vi.advanceTimersByTime(DRAFT_COMMIT_MS);
        });
        expect(commit).toHaveBeenCalledTimes(1);
        expect(commit).toHaveBeenCalledWith('abc');
    });

    it('commits on blur without waiting for the debounce', () => {
        const commit = vi.fn();
        const { element, api } = makeField(commit, 'stored');
        render(element);
        api.setValue('typed');
        api.blur();
        expect(commit).toHaveBeenCalledWith('typed');
    });

    it('does not commit again when nothing is pending', () => {
        const commit = vi.fn();
        const { element, api } = makeField(commit, 'stored');
        render(element);
        api.setValue('typed');
        api.blur();
        api.blur();
        act(() => {
            vi.advanceTimersByTime(DRAFT_COMMIT_MS * 4);
        });
        expect(commit).toHaveBeenCalledTimes(1);
    });

    it('commits pending text on flushDrafts', () => {
        const commit = vi.fn();
        const { element, api } = makeField(commit, 'stored');
        render(element);
        api.setValue('unsaved');
        expect(hasPendingDrafts()).toBe(true);
        act(() => {
            flushDrafts();
        });
        expect(commit).toHaveBeenCalledWith('unsaved');
        expect(hasPendingDrafts()).toBe(false);
    });

    it('commits pending text when the field unmounts', () => {
        const commit = vi.fn();
        const { element, api } = makeField(commit, 'stored');
        render(element);
        api.setValue('left behind');
        act(() => {
            root.render(createElement('span', null, 'gone'));
        });
        expect(commit).toHaveBeenCalledWith('left behind');
    });

    it('falls back to the stored value once committed', () => {
        const commit = vi.fn();
        const { element, api } = makeField(commit, 'stored');
        render(element);
        api.setValue('typed');
        api.blur();
        expect(api.shown()).toBe('stored');
    });

    it('leaves nothing registered after unmount', () => {
        const commit = vi.fn();
        const { element } = makeField(commit, 'stored');
        render(element);
        act(() => {
            root.render(createElement('span', null, 'gone'));
        });
        expect(hasPendingDrafts()).toBe(false);
        act(() => {
            flushDrafts();
        });
        expect(commit).not.toHaveBeenCalled();
    });
});
