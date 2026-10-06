import type { NativeWorldInfoEntry } from '../../global';

/**
 * Entry summary — "when does this entry matter" (spec 007 R1). Stored inside the
 * native entry's `extensions` object: the native app ignores and preserves it, and
 * it survives embedding a book into a character card (top-level keys do not).
 */
export const SUMMARY_KEY = 'wiw_summary';

/** Soft limit: longer summaries are flagged, never truncated or blocked. */
export const SUMMARY_SOFT_LIMIT = 300;

export function getSummary(native: NativeWorldInfoEntry): string {
    const value = native.extensions?.[SUMMARY_KEY];
    return typeof value === 'string' ? value : '';
}

export function isSummaryTooLong(summary: string): boolean {
    return summary.length > SUMMARY_SOFT_LIMIT;
}

/**
 * Returns the entry with the summary set (trimmed) or removed (blank). The input is
 * never mutated; an unchanged value returns the same object (structural sharing).
 */
export function withSummary(native: NativeWorldInfoEntry, summary: string): NativeWorldInfoEntry {
    const next = summary.trim();
    if (next === getSummary(native) && (next !== '' || !native.extensions || !(SUMMARY_KEY in native.extensions))) {
        return native;
    }
    const extensions: Record<string, unknown> = { ...(native.extensions ?? {}) };
    if (next === '') {
        delete extensions[SUMMARY_KEY];
    } else {
        extensions[SUMMARY_KEY] = next;
    }
    return { ...native, extensions };
}
