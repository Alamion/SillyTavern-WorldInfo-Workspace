import { describe, expect, it } from 'vitest';
import { fuzzyMatches, rankEntries, tokenize } from '../../src/core/assistant/bm25';
import { createEntryNode, type EntryNode } from '../../src/core/state/schema';

/** Local fuzzy matching (spec 007 R5). */

const NOW = '2026-10-07T00:00:00.000Z';
let uid = 0;
function entry(name: string, keys: string[], content: string, summary?: string): EntryNode {
    const node = createEntryNode({ id: `n-${name}`, parentId: 'f', name, now: NOW, nativeUid: (uid += 1) });
    node.native.key = keys;
    node.native.content = content;
    if (summary !== undefined) {
        node.native.extensions = { wiw_summary: summary };
    }
    return node;
}

const LIBRARY = [
    entry('Smithy', ['forge'], 'Hammers ring all day in the smithy.'),
    entry('Harbor', ['harbor', 'docks'], 'Ships unload salt and timber at the docks.'),
    entry('Seal Office', ['seal office'], 'Clerks stamp every contract.', 'Where official seals are kept.'),
    entry('Bakery', ['bread'], 'Warm loaves at dawn.'),
];

describe('tokenize', () => {
    it('lower-cases Unicode words and stems long words to five letters', () => {
        expect(tokenize('Forged SEALS, Гавань и кузница!')).toEqual(['forge', 'seals', 'гаван', 'кузни']);
    });

    it('drops one-letter tokens', () => {
        expect(tokenize('a b cd')).toEqual(['cd']);
    });
});

describe('fuzzyMatches', () => {
    it('finds an entry by a word form its key does not match', () => {
        const matches = fuzzyMatches(LIBRARY, ['who forged the seal?'], { exclude: new Set() });
        expect(matches.map((match) => match.entry.name)).toEqual(expect.arrayContaining(['Smithy', 'Seal Office']));
        expect(matches.find((match) => match.entry.name === 'Smithy')?.terms).toContain('forge');
    });

    it('never returns entries without any shared term', () => {
        const matches = fuzzyMatches(LIBRARY, ['who forged the seal?'], { exclude: new Set() });
        expect(matches.map((match) => match.entry.name)).not.toContain('Bakery');
    });

    it('respects the exclusion set and the cap', () => {
        const matches = fuzzyMatches(LIBRARY, ['forge seal harbor docks bread'], {
            exclude: new Set(['n-Smithy']),
            cap: 2,
            threshold: 0,
        });
        expect(matches).toHaveLength(2);
        expect(matches.map((match) => match.entry.id)).not.toContain('n-Smithy');
    });

    it('builds and scores 1000 entries quickly (memoized documents)', () => {
        const many = Array.from({ length: 1000 }, (_, i) =>
            entry(`Place ${String(i)}`, [`place${String(i)}`], 'harbor salt timber ledger '.repeat(30))
        );
        fuzzyMatches(many, ['harbor ledger'], { exclude: new Set() });
        const start = performance.now();
        fuzzyMatches(many, ['harbor ledger timber'], { exclude: new Set() });
        expect(performance.now() - start).toBeLessThan(100);
    });
});

describe('rankEntries', () => {
    it('scores entries against query texts (higher = more relevant)', () => {
        const scores = rankEntries(LIBRARY, ['ships at the docks']);
        expect((scores.get('n-Harbor') ?? 0) > (scores.get('n-Bakery') ?? 0)).toBe(true);
    });
});
