// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { folderAccessFact, fsaAccess, onFolderAccessChanged, resetFolderAccessForTests } from '../../src/adapters/fsaDisk';

/**
 * Spec 009 R6/R7: markdown folders are marked unavailable up front in frames
 * (embedded browsers such as VS Code's) and after the picker refuses with
 * SecurityError — instead of a button that looks normal and does nothing.
 */

function setSecure(value: boolean): void {
    Object.defineProperty(window, 'isSecureContext', { value, configurable: true });
    // jsdom has no IndexedDB; the link store needs one.
    (globalThis as { indexedDB?: unknown }).indexedDB ??= {};
}

afterEach(() => {
    resetFolderAccessForTests();
    delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker;
    vi.restoreAllMocks();
});

describe('folderAccessFact', () => {
    it('insecure page', () => {
        setSecure(false);
        expect(folderAccessFact()).toBe('insecure');
    });

    it('no picker (Firefox, Safari)', () => {
        setSecure(true);
        expect(folderAccessFact()).toBe('no-picker');
        expect(fsaAccess.isSupported()).toBe(false);
    });

    it('inside a frame', () => {
        setSecure(true);
        window.showDirectoryPicker = vi.fn();
        vi.spyOn(window, 'top', 'get').mockReturnValue({} as Window);
        expect(folderAccessFact()).toBe('framed');
        expect(fsaAccess.isSupported()).toBe(false);
    });

    it('a SecurityError from the picker blocks access for the session and notifies', async () => {
        setSecure(true);
        const error = new Error('not allowed here');
        error.name = 'SecurityError';
        window.showDirectoryPicker = vi.fn(() => Promise.reject(error));
        expect(folderAccessFact()).toBe('ok');
        const listener = vi.fn();
        const stop = onFolderAccessChanged(listener);
        await expect(fsaAccess.pick('readwrite')).rejects.toBeDefined();
        expect(folderAccessFact()).toBe('blocked');
        expect(listener).toHaveBeenCalledTimes(1);
        stop();
    });
});
