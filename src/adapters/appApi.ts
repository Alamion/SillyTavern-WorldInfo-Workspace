import type { SillyTavernContext } from '../global';

/**
 * Single accessor for the app API (constitution II). Every module that talks to
 * the host goes through `getAppContext()`; no other module may call
 * `globalThis.SillyTavern.getContext()` directly.
 *
 * The context object is memoized on purpose: the app builds a fresh object on
 * every `getContext()` call, and React components that read it per render would
 * otherwise see a new identity each time (update loops in effects that depend
 * on it). The cached instance exposes stable API-function references.
 */
let cached: SillyTavernContext | null = null;

export function getAppContext(): SillyTavernContext {
    if (!cached) {
        const ctx = window.SillyTavern?.getContext();
        if (!ctx) {
            throw new Error('[WorldInfoWorkspace] SillyTavern.getContext() is not available');
        }
        cached = ctx;
    }
    return cached;
}