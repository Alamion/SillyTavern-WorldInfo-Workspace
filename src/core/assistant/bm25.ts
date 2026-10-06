import type { NativeWorldInfoEntry } from '../../global';
import type { EntryNode } from '../state/schema';

/** What ranking needs from an entry: workspace nodes and native book entries both fit. */
export type RankableEntry = Pick<EntryNode, 'id' | 'name' | 'native'>;
import { getSummary } from '../tree/summary';

/**
 * Local fuzzy matching (spec 007 R5): BM25 over an entry's name, keys, summary
 * and content, with Unicode word tokens and a light prefix stem (words of five or
 * more letters compare on their first five), so "forged" finds an entry keyed
 * "forge". No model, no embeddings; documents are memoized per entry version.
 */

const STEM = 5;
const K1 = 1.2;
const B = 0.75;
/** Name, keys and summary say what an entry is about: they count three times. */
const HEAD_WEIGHT = 3;

export function tokenize(text: string): string[] {
    const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
    return words.filter((word) => word.length >= 2).map((word) => (word.length >= STEM ? word.slice(0, STEM) : word));
}

interface Doc {
    tf: Map<string, number>;
    length: number;
}

// Keyed by the native object (a new object per edit — structural sharing) and the name.
const docCache = new WeakMap<NativeWorldInfoEntry, { name: string; doc: Doc }>();

function docOf(entry: RankableEntry): Doc {
    const cached = docCache.get(entry.native);
    if (cached !== undefined && cached.name === entry.name) {
        return cached.doc;
    }
    const tf = new Map<string, number>();
    let length = 0;
    const add = (text: string, weight: number): void => {
        for (const token of tokenize(text)) {
            tf.set(token, (tf.get(token) ?? 0) + weight);
            length += weight;
        }
    };
    add([entry.name, ...entry.native.key, getSummary(entry.native)].join(' '), HEAD_WEIGHT);
    add(entry.native.content, 1);
    const doc = { tf, length };
    docCache.set(entry.native, { name: entry.name, doc });
    return doc;
}

interface Scored<T extends RankableEntry> {
    entry: T;
    score: number;
    terms: string[];
}

function scoreEntries<T extends RankableEntry>(entries: readonly T[], queries: readonly string[]): Array<Scored<T>> {
    const queryTerms = [...new Set(queries.flatMap(tokenize))];
    if (queryTerms.length === 0 || entries.length === 0) {
        return entries.map((entry) => ({ entry, score: 0, terms: [] }));
    }
    const docs = entries.map(docOf);
    const total = docs.reduce((sum, doc) => sum + doc.length, 0);
    const avgLength = total / docs.length || 1;
    const df = new Map<string, number>();
    for (const term of queryTerms) {
        df.set(term, docs.reduce((count, doc) => count + (doc.tf.has(term) ? 1 : 0), 0));
    }
    const n = docs.length;
    return entries.map((entry, index) => {
        const doc = docs[index] as Doc;
        let score = 0;
        const terms: string[] = [];
        for (const term of queryTerms) {
            const freq = doc.tf.get(term);
            const docFreq = df.get(term) ?? 0;
            if (freq === undefined || docFreq === 0) {
                continue;
            }
            // A term in every document says nothing about relevance.
            const idf = Math.log(1 + (n - docFreq + 0.5) / (docFreq + 0.5));
            if (docFreq === n && n > 1) {
                continue;
            }
            score += (idf * freq * (K1 + 1)) / (freq + K1 * (1 - B + (B * doc.length) / avgLength));
            terms.push(term);
        }
        return { entry, score, terms };
    });
}

/** Relevance of every entry to the query texts (0 = no shared term). */
export function rankEntries(entries: readonly RankableEntry[], queries: readonly string[]): Map<string, number> {
    return new Map(scoreEntries(entries, queries).map((item) => [item.entry.id, item.score]));
}

export interface FuzzyOptions {
    /** Entries already chosen (selected, key-triggered): never returned. */
    exclude: ReadonlySet<string>;
    /** At most this many additions (default 5). */
    cap?: number;
    /** Minimum score relative to the best match (default 0.5). */
    threshold?: number;
}

/** Entries that share words with the query texts, best first (R5: cap 5, ≥ 0.5 of the best). */
export function fuzzyMatches<T extends RankableEntry>(
    entries: readonly T[],
    queries: readonly string[],
    options: FuzzyOptions
): Array<{ entry: T; score: number; terms: string[] }> {
    const scored = scoreEntries(entries, queries).filter((item) => item.score > 0);
    const best = Math.max(0, ...scored.map((item) => item.score));
    const threshold = (options.threshold ?? 0.5) * best;
    return scored
        .filter((item) => !options.exclude.has(item.entry.id) && item.score >= threshold)
        .sort((a, b) => b.score - a.score)
        .slice(0, options.cap ?? 5);
}
