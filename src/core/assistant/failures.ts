import type { AssistantFailure, FailureKind } from './types';

/**
 * Failure classification and retry policy (spec 005 research R7). Free-tier
 * providers rate-limit constantly, so every failure must be readable, and only
 * transient kinds retry automatically — visibly and a bounded number of times
 * (FR-026).
 */

export const MAX_AUTO_RETRIES = 2;
const AUTO_RETRY_DELAYS_MS = [10000, 30000] as const;
const AUTO_RETRY_KINDS: ReadonlySet<FailureKind> = new Set<FailureKind>(['rate-limit', 'network']);

const MESSAGES: Readonly<Record<FailureKind, string>> = {
    'rate-limit': 'The provider is rate-limiting requests right now (temporary).',
    provider: 'The provider rejected the request.',
    network: 'The request could not reach the provider (network problem).',
    timeout: 'The model did not respond in time.',
    aborted: 'The request was stopped.',
    profile: 'The selected connection profile cannot be used.',
    'connection-manager-disabled':
        'The assistant needs the Connection Manager extension. Enable it in Extensions → Manage extensions.',
    empty: 'The model returned an empty reply.',
    truncated: 'The reply was cut off.',
    malformed: 'Part of the reply could not be used.',
};

const NEVER_RETRYABLE: ReadonlySet<FailureKind> = new Set<FailureKind>([
    'connection-manager-disabled',
    'profile',
]);

export function readableMessage(kind: FailureKind): string {
    return MESSAGES[kind];
}

export function describeFailure(
    kind: FailureKind,
    options: { detail?: string } = {}
): AssistantFailure {
    const failure: AssistantFailure = {
        kind,
        message: readableMessage(kind),
        retryable: !NEVER_RETRYABLE.has(kind),
    };
    if (options.detail !== undefined && options.detail !== '') {
        failure.detail = options.detail;
    }
    return failure;
}

/** Unwraps `Error('API request failed', { cause })` chains into readable text. */
function collectText(error: unknown, depth = 0): string {
    if (depth > 4) {
        return '';
    }
    if (typeof error === 'string') {
        return error;
    }
    if (error instanceof Error) {
        const cause = collectText((error as { cause?: unknown }).cause, depth + 1);
        return cause === '' ? error.message : `${error.message}: ${cause}`;
    }
    if (error !== null && typeof error === 'object') {
        const record = error as { message?: unknown; error?: { message?: unknown } };
        if (typeof record.message === 'string') {
            return record.message;
        }
        if (record.error && typeof record.error.message === 'string') {
            return record.error.message;
        }
    }
    return '';
}

function isAbort(error: unknown): boolean {
    return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

export function classifyError(
    error: unknown,
    context: { aborted?: boolean }
): AssistantFailure {
    if (context.aborted === true || isAbort(error)) {
        return describeFailure('aborted');
    }
    const text = collectText(error);
    const kind = kindFromText(text);
    return describeFailure(kind, { detail: text });
}

function kindFromText(text: string): FailureKind {
    if (/Connection Manager is not available/i.test(text)) {
        return 'connection-manager-disabled';
    }
    if (/\b429\b|rate.?limit|quota/i.test(text)) {
        return 'rate-limit';
    }
    if (/failed to fetch|networkerror|network request failed|ERR_NETWORK/i.test(text)) {
        return 'network';
    }
    if (/profile not found|does not support (chat|text) completions|Unknown API type/i.test(text)) {
        return 'profile';
    }
    return 'provider';
}

export function retryPolicy(kind: FailureKind, attempt: number): { delayMs: number } | null {
    if (!AUTO_RETRY_KINDS.has(kind) || attempt >= MAX_AUTO_RETRIES) {
        return null;
    }
    const delayMs = AUTO_RETRY_DELAYS_MS[attempt] ?? AUTO_RETRY_DELAYS_MS[AUTO_RETRY_DELAYS_MS.length - 1];
    return { delayMs: delayMs ?? 30000 };
}
