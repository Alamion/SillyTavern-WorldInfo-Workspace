import type { NativeWorldInfoEntry } from '../../global';

/**
 * Entry fingerprints for divergence detection (research R6): deterministic
 * key-sorted serialization + FNV-1a (32-bit). Used only for warning decisions —
 * collisions are theoretically possible and disclosed.
 */

export function stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value ?? null);
    }
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`;
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort();
    return `{${keys
        .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
        .join(',')}}`;
}

export function fnv1a(input: string): string {
    // 32-bit FNV-1a over UTF-16 code units — deterministic, dependency-free.
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}

/**
 * Identity-keyed fingerprint memo (spec 006 R6).
 *
 * One push of a 1000-entry book runs three independent full passes that each
 * stringify and hash every entry (divergence analysis, bound-import planning and
 * flatten) — 43 ms of pure re-hashing for a single edited entry. The granularity
 * was already right; nothing cached it.
 *
 * Correct only because structural sharing keeps unchanged entries' `native`
 * objects reference-identical (core/state/sharing.ts): an edit produces a fresh
 * `native`, which is a fresh key, so a stale hash can never be served. A WeakMap
 * lets the memo die with the entry version it describes.
 */
const fingerprintCache = new WeakMap<NativeWorldInfoEntry, string>();

export function fingerprintEntry(entry: NativeWorldInfoEntry): string {
    const cached = fingerprintCache.get(entry);
    if (cached !== undefined) {
        return cached;
    }
    const hash = fnv1a(stableStringify(entry));
    fingerprintCache.set(entry, hash);
    return hash;
}