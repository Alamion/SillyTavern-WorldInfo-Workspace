import { getAssistantSettings, type WorkspaceState } from '../state/schema';
import type { AssistantSettings } from './types';

/**
 * Pure assistant-settings update (spec 005 FR-035): returns a NEW state with the
 * repaired settings patched, like every other tree operation. The caller decides
 * whether saving is allowed at all (see `canSaveAssistantSettings`).
 */
export function setAssistantSettings(
    state: WorkspaceState,
    patch: Partial<AssistantSettings>
): WorkspaceState {
    const next = structuredClone(state);
    next.settings.assistant = { ...getAssistantSettings(state), ...patch };
    // Re-run the repair so an out-of-range patch cannot be persisted.
    next.settings.assistant = getAssistantSettings(next);
    return next;
}

/**
 * Assistant settings live inside the published workspace payload, and the app
 * store publishes on every change. While an unresolved data recovery is pending,
 * writing them would publish the empty fallback over the recoverable payload —
 * so settings stay read-only until the user restores or discards (FR-035).
 */
export function canSaveAssistantSettings(recoveryPending: boolean): boolean {
    return !recoveryPending;
}
