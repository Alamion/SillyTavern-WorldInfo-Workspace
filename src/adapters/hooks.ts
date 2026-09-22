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
            void ctx.eventSource.emit(event, payload);
        } catch (error) {
            debugLog(`hook ${event} failed: ${String(error)}`);
        }
    };
}

/** An emitter that does nothing — for surfaces created without a host context. */
export const noopEmitter: HookEmitter = () => undefined;
