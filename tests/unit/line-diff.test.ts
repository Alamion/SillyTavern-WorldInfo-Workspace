import { describe, expect, it } from 'vitest';
import { diffLines, diffSequences, diffWords, pairDiffRows } from '../../src/core/diff/lineDiff';

describe('diffLines', () => {
    it('detects unchanged lines', () => {
        const ops = diffLines('a\nb\nc', 'a\nb\nc');
        expect(ops.every((op) => op.type === 'same')).toBe(true);
    });

    it('detects pure additions', () => {
        const ops = diffLines('a\nc', 'a\nb\nc');
        expect(ops).toEqual([
            { type: 'same', text: 'a' },
            { type: 'added', text: 'b' },
            { type: 'same', text: 'c' },
        ]);
    });

    it('detects pure removals', () => {
        const ops = diffLines('a\nb\nc', 'a\nc');
        expect(ops).toEqual([
            { type: 'same', text: 'a' },
            { type: 'removed', text: 'b' },
            { type: 'same', text: 'c' },
        ]);
    });

    it('detects edits as a remove-add pair', () => {
        const ops = diffLines('keep\nold line', 'keep\nnew line');
        expect(ops).toEqual([
            { type: 'same', text: 'keep' },
            { type: 'removed', text: 'old line' },
            { type: 'added', text: 'new line' },
        ]);
    });

    it('handles empty inputs', () => {
        expect(diffLines('', 'a\nb')).toEqual([
            { type: 'added', text: 'a' },
            { type: 'added', text: 'b' },
        ]);
        expect(diffLines('a\nb', '')).toEqual([
            { type: 'removed', text: 'a' },
            { type: 'removed', text: 'b' },
        ]);
    });
});

describe('pairDiffRows', () => {
    it('pairs removed and added lines into side-by-side rows', () => {
        const ops = diffLines('keep\nold one\nold two', 'keep\nnew one\nnew two\ntail');
        const rows = pairDiffRows(ops);
        expect(rows).toEqual([
            { left: 'keep', right: 'keep', state: 'same', leftNumber: 1, rightNumber: 1 },
            { left: 'old one', right: 'new one', state: 'changed', leftNumber: 2, rightNumber: 2 },
            { left: 'old two', right: 'new two', state: 'changed', leftNumber: 3, rightNumber: 3 },
            { left: null, right: 'tail', state: 'added', leftNumber: null, rightNumber: 4 },
        ]);
    });

    it('keeps lone removals with an empty right side', () => {
        const rows = pairDiffRows(diffLines('a\nb', 'a'));
        expect(rows).toEqual([
            { left: 'a', right: 'a', state: 'same', leftNumber: 1, rightNumber: 1 },
            { left: 'b', right: null, state: 'removed', leftNumber: 2, rightNumber: null },
        ]);
    });
});

describe('diffSequences (Myers, 2026-09-22)', () => {
    /** Rebuilds both sides from the script: it must be a valid edit script. */
    const sides = (ops: Array<{ type: string; item: string }>) => ({
        before: ops.filter((op) => op.type !== 'added').map((op) => op.item).join(''),
        after: ops.filter((op) => op.type !== 'removed').map((op) => op.item).join(''),
    });

    it('produces a minimal, valid script for known cases', () => {
        const ops = diffSequences([...'ABCABBA'], [...'CBABAC']);
        expect(sides(ops)).toEqual({ before: 'ABCABBA', after: 'CBABAC' });
        // The classic example has edit distance 5.
        expect(ops.filter((op) => op.type !== 'same')).toHaveLength(5);
    });

    it('is valid on random inputs and puts removals before additions in each run', () => {
        let seed = 7;
        const random = (): number => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
        for (let round = 0; round < 200; round += 1) {
            const a = Array.from({ length: Math.floor(random() * 12) }, () => 'abc'[Math.floor(random() * 3)] ?? 'a');
            const b = Array.from({ length: Math.floor(random() * 12) }, () => 'abc'[Math.floor(random() * 3)] ?? 'a');
            const ops = diffSequences(a, b);
            expect(sides(ops)).toEqual({ before: a.join(''), after: b.join('') });
            ops.forEach((op, index) => {
                if (op.type === 'removed') {
                    expect(ops[index - 1]?.type).not.toBe('added');
                }
            });
        }
    });

    it('stays fast on long, mostly equal texts', () => {
        const lines = Array.from({ length: 20000 }, (_, index) => `line ${String(index)}`);
        const changed = [...lines];
        changed[10000] = 'edited';
        const started = performance.now();
        const ops = diffLines(lines.join('\n'), changed.join('\n'));
        expect(performance.now() - started).toBeLessThan(500);
        expect(ops.filter((op) => op.type !== 'same')).toHaveLength(2);
    });
});

describe('diffWords', () => {
    it('marks only the changed words of a line pair', () => {
        const { left, right } = diffWords('The old inn stands here.', 'The new inn stands there.');
        expect(left.filter((part) => part.changed).map((part) => part.text)).toEqual(['old', 'here']);
        expect(right.filter((part) => part.changed).map((part) => part.text)).toEqual(['new', 'there']);
        expect(left.map((part) => part.text).join('')).toBe('The old inn stands here.');
    });

    it('keeps whitespace at the edges of a mark unmarked', () => {
        const { right } = diffWords('never sleeps', 'never truly sleeps');
        expect(right).toEqual([
            { text: 'never ', changed: false },
            { text: 'truly', changed: true },
            { text: ' sleeps', changed: false },
        ]);
    });

    it('joins a rewritten phrase into one mark', () => {
        const { right } = diffWords('a b c d', 'a x y d');
        expect(right).toEqual([
            { text: 'a ', changed: false },
            { text: 'x y', changed: true },
            { text: ' d', changed: false },
        ]);
    });
});
