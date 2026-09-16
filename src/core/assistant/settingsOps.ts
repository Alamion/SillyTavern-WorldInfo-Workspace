import { getAssistantSettings, type WorkspaceState } from '../state/schema';
import {
    CONTEXT_HEADROOM_TOKENS,
    CONTEXT_TOKENS_RANGE,
    RESPONSE_TOKENS_RANGE,
    type AssistantSettings,
} from './types';

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

/**
 * Why a typed request limit cannot be saved, or null when it can. The settings
 * repair silently falls back to defaults, so the form checks first and explains
 * (live run 2026-09-16: typing "3000" with a 4000-token response became 16000).
 */
export function tokenLimitProblem(
    field: 'responseTokens' | 'contextTokens',
    value: number,
    current: Pick<AssistantSettings, 'responseTokens' | 'contextTokens'>
): string | null {
    if (!Number.isInteger(value)) {
        return 'Enter a whole number.';
    }
    if (field === 'responseTokens') {
        if (value < RESPONSE_TOKENS_RANGE.min || value > RESPONSE_TOKENS_RANGE.max) {
            return `Response length must be between ${String(RESPONSE_TOKENS_RANGE.min)} and ${String(RESPONSE_TOKENS_RANGE.max)}.`;
        }
        if (current.contextTokens < value + CONTEXT_HEADROOM_TOKENS) {
            return `The context size (${String(current.contextTokens)}) must stay at least ${String(CONTEXT_HEADROOM_TOKENS)} above the response length: raise it first.`;
        }
        return null;
    }
    if (value < CONTEXT_TOKENS_RANGE.min || value > CONTEXT_TOKENS_RANGE.max) {
        return `Context size must be between ${String(CONTEXT_TOKENS_RANGE.min)} and ${String(CONTEXT_TOKENS_RANGE.max)}.`;
    }
    const minimum = current.responseTokens + CONTEXT_HEADROOM_TOKENS;
    if (value < minimum) {
        return `Context size must be at least the response length + ${String(CONTEXT_HEADROOM_TOKENS)} (${String(minimum)}).`;
    }
    return null;
}
