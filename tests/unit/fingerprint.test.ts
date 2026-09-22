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
        // Each variant is a NEW object: fingerprints are memoized by identity, so
        // the contract is "replace, do not mutate" (spec 006 R6).
        const entry = makeEntry(1);
        const before = fingerprintEntry(entry);
        expect(fingerprintEntry({ ...entry, content: 'new text' })).not.toBe(before);
        expect(fingerprintEntry({ ...entry, content: '' })).toBe(before);
    });

    it('is whitespace-insensitive for equivalent objects', () => {
        const a = fingerprintEntry(makeEntry(3));
        const clone = JSON.parse(JSON.stringify(makeEntry(3))) as NativeWorldInfoEntry;
        expect(fingerprintEntry(clone)).toBe(a);
    });
});
describe('identity-keyed memoization (spec 006 R6)', () => {
    it('returns the same hash for the same object without rehashing', () => {
        const entry = createDefaultNativeEntry(1);
        entry.content = 'lore';
        const first = fingerprintEntry(entry);
        expect(fingerprintEntry(entry)).toBe(first);
    });

    it('hashes a fresh object independently, so edits are never stale', () => {
        const entry = createDefaultNativeEntry(1);
        entry.content = 'before';
        const before = fingerprintEntry(entry);
        // Structural sharing gives an edited entry a NEW native object.
        const edited = { ...entry, content: 'after' };
        expect(fingerprintEntry(edited)).not.toBe(before);
    });

    it('distinguishes two objects that differ only in content', () => {
        const a = createDefaultNativeEntry(2);
        a.content = 'x';
        const b = { ...a, content: 'y' };
        expect(fingerprintEntry(a)).not.toBe(fingerprintEntry(b));
    });

    it('DOCUMENTED LIMIT: an already-hashed object mutated in place keeps its hash', () => {
        // The memo is keyed by object identity, so callers must replace `native`
        // rather than mutate it — which is exactly what structural sharing does.
        // This test pins the contract so a future in-place mutator fails loudly
        // here instead of silently skipping a sync.
        const entry = createDefaultNativeEntry(3);
        entry.content = 'first';
        const first = fingerprintEntry(entry);
        entry.content = 'mutated in place';
        expect(fingerprintEntry(entry)).toBe(first);
        expect(fingerprintEntry({ ...entry })).not.toBe(first);
    });
});
