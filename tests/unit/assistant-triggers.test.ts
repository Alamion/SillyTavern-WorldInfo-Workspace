import { describe, expect, it } from 'vitest';
import { compileTrigger, expandTriggers } from '../../src/core/assistant/triggers';
import { createEntryNode, type EntryNode } from '../../src/core/state/schema';

/** Key-triggered entry selection (spec 005 FR-021a). */

function entry(id: string, keys: string[], content: string): EntryNode {
    const node = createEntryNode({ id, parentId: 'p', name: `Title ${id}`, now: 'now', nativeUid: 1 });
    node.native.key = keys;
    node.native.content = content;
    return node;
}

describe('compileTrigger', () => {
    it('matches plain keys as whole words, case-insensitively, in any script', () => {
        expect(compileTrigger('Harbor')?.test('the harbor gate')).toBe(true);
        expect(compileTrigger('harbor')?.test('harbors')).toBe(false);
        expect(compileTrigger('гавань')?.test('Гавань шумит')).toBe(true);
        expect(compileTrigger('гавань')?.test('гаваньщик')).toBe(false);
    });

    it('supports /regex/flags keys and ignores match-everything triggers', () => {
        expect(compileTrigger('/tavern(s)?/i')?.test('TAVERNS')).toBe(true);
        expect(compileTrigger('/.*/')).toBeNull();
        expect(compileTrigger('a')).toBeNull();
        expect(compileTrigger('/[unclosed/')?.test('/[unclosed/')).toBe(true);
    });
});

describe('expandTriggers', () => {
    const a = entry('a', ['alpha'], 'Mentions beta.');
    const b = entry('b', ['beta'], 'Mentions gamma.');
    const c = entry('c', ['gamma'], 'Mentions alpha again.');
    const d = entry('d', ['delta'], 'Nobody mentions me.');

    it('grows recursively until nothing new matches, without repeats', () => {
        const layers = expandTriggers([a, b, c, d], ['Start from alpha'], []);
        expect(layers.map((layer) => layer.entries.map((item) => item.id))).toEqual([['a'], ['b'], ['c']]);
    });

    it('scans seed entries without returning them', () => {
        const layers = expandTriggers([a, b, c, d], [], [b]);
        expect(layers.flatMap((layer) => layer.entries.map((item) => item.id))).toEqual(['c', 'a']);
    });

    it('matches entry titles', () => {
        const layers = expandTriggers([a, d], ['What about Title d?'], []);
        expect(layers[0]?.entries.map((item) => item.id)).toEqual(['d']);
    });
});
