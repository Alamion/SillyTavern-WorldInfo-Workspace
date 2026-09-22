import { debugLog } from './logger';
import type { SillyTavernContext } from '../global';

/**
 * The one place `wi-workspace:*` events leave the plugin (spec 006 R9).
 *
 * Replaces two duplicated inline lambdas in `settingsStore.ts`. The injectable
 * `(event, payload) => void` shape is kept deliberately: the contract tests
 * collect events through exactly that seam.
 *
 * CONTAINMENT (FR-010):
 * - never awaited, so a slow subscriber cannot block a workspace operation. The
 *   host's `eventSource.emit` is async and awaits each listener; awaiting it
 *   here would hand a subscriber the power to stall an edit.
 * - wrapped in try/catch, so a synchronous throw cannot escape either. The host
 *   already catches per listener, but nothing in our code would contain a throw
 *   from `eventSource` itself.
 */

export type HookEmitter = (event: string, payload: unknown) => void;

export function createHookEmitter(ctx: SillyTavernContext): HookEmitter {
    return (event, payload) => {
        try {
            const pending: unknown = ctx.eventSource.emit(event, payload);
            // NOT awaited — a slow subscriber must not stall an edit — but the
            // rejection IS handled. Discarding it with `void` produced an
            // unhandled promise rejection, which is not "contained" in any
            // useful sense: it surfaces as a console error and can trip the
            // host's error reporting.
            if (pending instanceof Promise) {
                pending.catch((error: unknown) => {
                    debugLog(`hook ${event} subscriber rejected: ${String(error)}`);
                });
            }
        } catch (error) {
            debugLog(`hook ${event} failed: ${String(error)}`);
        }
    };
}

/** An emitter that does nothing — for surfaces created without a host context. */
export const noopEmitter: HookEmitter = () => undefined;
