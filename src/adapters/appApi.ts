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

/**
 * A fresh context for DATA reads (characters, tags, current character id): the
 * app copies these values into each new context object and reassigns some of
 * them (tags on settings load), so the memoized instance goes stale.
 */
export function getLiveAppContext(): SillyTavernContext {
    const ctx = window.SillyTavern?.getContext();
    if (!ctx) {
        throw new Error('[WorldInfoWorkspace] SillyTavern.getContext() is not available');
    }
    return ctx;
}


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
/**
 * Whether Enter sends in a text input, as in the app's chat: the user's "Send on
 * Enter" setting, whose Auto mode never sends on phones and tablets — Enter is
 * their only way to start a new line (owner request 2026-09-22).
 */
export function sendsOnEnter(): boolean {
    try {
        const decide = getAppContext().shouldSendOnEnter;
        if (typeof decide === 'function') {
            return decide();
        }
    } catch {
        // no app context: fall through to the pointer check
    }
    return !(typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches);
}
