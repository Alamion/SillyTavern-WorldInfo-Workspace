import type { ActiveWorldInfoEntry } from '../../global';

/**
 * Objects for the app's forced activation (research R9): the scan inserts the
 * PASSED object, so it must be a complete entry — position, depth, order and the
 * rest come from it. Decorator lines (`@@…`) are what the app's own loader strips
 * from content; disabled entries are never forced.
 */
export function forcedEntries(entries: readonly ActiveWorldInfoEntry[]): ActiveWorldInfoEntry[] {
    return entries
        .filter((entry) => entry.disable !== true)
        .map((entry) => {
            const clone = structuredClone(entry);
            const lines = clone.content.split('\n');
            let first = 0;
            while (first < lines.length && (lines[first] ?? '').startsWith('@@')) {
                first += 1;
            }
            clone.content = lines.slice(first).join('\n');
            clone.decorators = [];
            return clone;
        });
}
