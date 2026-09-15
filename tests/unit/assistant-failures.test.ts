import { describe, expect, it } from 'vitest';

/** `new Error(msg, { cause })` needs ES2022 lib; the project targets lower. */
function wrapped(message: string, causeMessage: string): Error {
    const error = new Error(message);
    Object.assign(error, { cause: new Error(causeMessage) });
    return error;
}
import {
    classifyError,
    describeFailure,
    readableMessage,
    retryPolicy,
    MAX_AUTO_RETRIES,
} from '../../src/core/assistant/failures';

describe('classifyError (research R7)', () => {
    it('classifies rate limits from status text and provider wording', () => {
        expect(classifyError(new Error('Got response status 429'), {}).kind).toBe('rate-limit');
        expect(
            classifyError(
                wrapped(
                    'API request failed',
                    'google/gemma-4-26b-a4b-it:free is temporarily rate-limited upstream'
                ),
                {}
            ).kind
        ).toBe('rate-limit');
        expect(classifyError(new Error('Quota exceeded for this key'), {}).kind).toBe('rate-limit');
    });

    it('classifies aborts, both by error name and by the signal', () => {
        const abort = new Error('The user aborted a request.');
        abort.name = 'AbortError';
        expect(classifyError(abort, {}).kind).toBe('aborted');
        expect(classifyError(new Error('anything'), { aborted: true }).kind).toBe('aborted');
    });

    it('classifies network and profile problems', () => {
        expect(classifyError(new TypeError('Failed to fetch'), {}).kind).toBe('network');
        expect(classifyError(new Error('NetworkError when attempting to fetch'), {}).kind).toBe('network');
        expect(classifyError(new Error('Profile not found'), {}).kind).toBe('profile');
        expect(classifyError(new Error('API type koboldhorde does not support chat completions'), {}).kind).toBe('profile');
        expect(classifyError(new Error('Connection Manager is not available'), {}).kind).toBe(
            'connection-manager-disabled'
        );
    });

    it('falls back to provider with the readable cause message', () => {
        const failure = classifyError(wrapped('API request failed', 'Response not OK: bad model'), {});
        expect(failure.kind).toBe('provider');
        expect(failure.detail).toContain('bad model');
        expect(failure.retryable).toBe(true);
    });

    it('keeps aborted failures out of automatic retries', () => {
        expect(retryPolicy('aborted', 0)).toBeNull();
        expect(retryPolicy('profile', 0)).toBeNull();
        expect(retryPolicy('connection-manager-disabled', 0)).toBeNull();
    });
});

describe('retryPolicy', () => {
    it('retries rate limits and network errors twice with a visible backoff', () => {
        expect(retryPolicy('rate-limit', 0)).toEqual({ delayMs: 10000 });
        expect(retryPolicy('rate-limit', 1)).toEqual({ delayMs: 30000 });
        expect(retryPolicy('rate-limit', MAX_AUTO_RETRIES)).toBeNull();
        expect(retryPolicy('network', 0)).toEqual({ delayMs: 10000 });
    });

    it('never retries automatically for other kinds', () => {
        expect(retryPolicy('provider', 0)).toBeNull();
        expect(retryPolicy('malformed', 0)).toBeNull();
    });
});

describe('readableMessage', () => {
    it('returns an English sentence per kind', () => {
        expect(readableMessage('rate-limit')).toMatch(/rate-limit/i);
        expect(readableMessage('timeout')).toMatch(/did not respond/i);
        expect(readableMessage('empty')).toMatch(/empty/i);
        expect(readableMessage('truncated')).toMatch(/cut off/i);
        expect(readableMessage('malformed')).toMatch(/could not be used/i);
    });

    it('describeFailure builds a failure with the readable message', () => {
        const failure = describeFailure('timeout', { detail: 'no chunk for 90 s' });
        expect(failure).toEqual({
            kind: 'timeout',
            message: readableMessage('timeout'),
            retryable: true,
            detail: 'no chunk for 90 s',
        });
    });
});
