import { describe, expect, it } from 'vitest';
import { diffLines, pairDiffRows } from '../../src/core/assistant/diff';

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
            { left: 'keep', right: 'keep', state: 'same' },
            { left: 'old one', right: 'new one', state: 'changed' },
            { left: 'old two', right: 'new two', state: 'changed' },
            { left: null, right: 'tail', state: 'added' },
        ]);
    });

    it('keeps lone removals with an empty right side', () => {
        const rows = pairDiffRows(diffLines('a\nb', 'a'));
        expect(rows).toEqual([
            { left: 'a', right: 'a', state: 'same' },
            { left: 'b', right: null, state: 'removed' },
        ]);
    });
});
