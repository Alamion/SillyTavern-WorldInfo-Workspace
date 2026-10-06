import { describe, expect, it } from 'vitest';
import { SUMMARY_KEY, SUMMARY_SOFT_LIMIT, getSummary, isSummaryTooLong, withSummary } from '../../src/core/tree/summary';
import { createDefaultNativeEntry } from '../../src/core/state/schema';
import { fingerprintEntry } from '../../src/core/sync/fingerprint';

describe('entry summary (spec 007 R1)', () => {
    it('reads an absent summary as empty', () => {
        expect(getSummary(createDefaultNativeEntry(1))).toBe('');
    });

    it('stores the trimmed summary under extensions.wiw_summary without touching other extension data', () => {
        const native = createDefaultNativeEntry(1);
        native.extensions = { other: 1 };
        const next = withSummary(native, '  When the harbor matters.  ');
        expect(next.extensions).toEqual({ other: 1, [SUMMARY_KEY]: 'When the harbor matters.' });
        expect(getSummary(next)).toBe('When the harbor matters.');
        expect(native.extensions).toEqual({ other: 1 });
    });

    it('removes the key for a blank summary', () => {
        const native = withSummary(createDefaultNativeEntry(1), 'x');
        const cleared = withSummary(native, '   ');
        expect(cleared.extensions && SUMMARY_KEY in cleared.extensions).toBe(false);
    });

    it('returns the same object when nothing changes', () => {
        const native = withSummary(createDefaultNativeEntry(1), 'x');
        expect(withSummary(native, 'x')).toBe(native);
    });

    it('flags summaries over the soft limit without truncating them', () => {
        const long = 'a'.repeat(SUMMARY_SOFT_LIMIT + 1);
        const native = withSummary(createDefaultNativeEntry(1), long);
        expect(getSummary(native)).toBe(long);
        expect(isSummaryTooLong(getSummary(native))).toBe(true);
        expect(isSummaryTooLong('a'.repeat(SUMMARY_SOFT_LIMIT))).toBe(false);
    });

    it('ignores a non-string stored value', () => {
        const native = createDefaultNativeEntry(1);
        native.extensions = { [SUMMARY_KEY]: 42 };
        expect(getSummary(native)).toBe('');
    });

    it('changes the entry fingerprint (a summary edit pushes like any field)', () => {
        const native = createDefaultNativeEntry(1);
        expect(fingerprintEntry(withSummary(native, 'x'))).not.toBe(fingerprintEntry(native));
    });
});
