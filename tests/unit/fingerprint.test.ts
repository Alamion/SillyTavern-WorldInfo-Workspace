import { describe, expect, it } from 'vitest';
import type { NativeWorldInfoEntry } from '../../src/global';
import { createDefaultNativeEntry } from '../../src/core/state/schema';
import { fingerprintEntry, stableStringify } from '../../src/core/sync/fingerprint';

function makeEntry(uid: number): NativeWorldInfoEntry {
    const entry = createDefaultNativeEntry(uid);
    entry.comment = 'Riverborn';
    entry.key = ['river'];
    return entry;
}

describe('fingerprint (research R6)', () => {
    it('serializes objects deterministically regardless of key order', () => {
        const a = stableStringify({ b: 1, a: 2 });
        const b = stableStringify({ a: 2, b: 1 });
        expect(a).toBe(b);
        expect(a).toContain('"a":2');
    });

    it('treats arrays in order and keeps undefined out', () => {
        expect(stableStringify([3, 1])).not.toBe(stableStringify([1, 3]));
        expect(stableStringify({ x: undefined, y: 1 })).toBe(stableStringify({ y: 1 }));
    });

    it('fingerprints are stable and include the uid', () => {
        const one = fingerprintEntry(makeEntry(7));
        const two = fingerprintEntry(makeEntry(7));
        expect(one).toBe(two);
        const other = fingerprintEntry(makeEntry(8));
        expect(other).not.toBe(one);
    });

    it('fingerprints change when any field changes', () => {
        const entry = makeEntry(1);
        const before = fingerprintEntry(entry);
        entry.content = 'new text';
        expect(fingerprintEntry(entry)).not.toBe(before);
        entry.content = '';
        expect(fingerprintEntry(entry)).toBe(before);
    });

    it('is whitespace-insensitive for equivalent objects', () => {
        const a = fingerprintEntry(makeEntry(3));
        const clone = JSON.parse(JSON.stringify(makeEntry(3))) as NativeWorldInfoEntry;
        expect(fingerprintEntry(clone)).toBe(a);
    });
});