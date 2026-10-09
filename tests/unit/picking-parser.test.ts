import { describe, expect, it } from 'vitest';
import { parsePicks } from '../../src/core/picking/pickParser';

/** Pick lines of the picking model (contracts/main-chat-picking.md). */

const VALID = new Set(['e1', 'e2', 'e3']);

describe('parsePicks', () => {
    it('reads pick lines with reasons and ignores prose around them', () => {
        const reply = 'Here you go:\n<pick id="e2">the harbor is mentioned</pick>\n<pick id="e1">Selene appears</pick>\nDone.';
        expect(parsePicks(reply, VALID, 8)).toEqual({
            picks: [
                { id: 'e2', reason: 'the harbor is mentioned' },
                { id: 'e1', reason: 'Selene appears' },
            ],
            ignored: [],
            none: false,
            stray: 'Here you go: Done.',
        });
    });

    it('counts unknown ids as ignored and collapses duplicates', () => {
        const reply = '<pick id="e9">nope</pick><pick id="e1">a</pick><pick id="e1">again</pick>';
        expect(parsePicks(reply, VALID, 8)).toMatchObject({ picks: [{ id: 'e1', reason: 'a' }], ignored: ['e9'] });
    });

    it('keeps at most maxPicks', () => {
        const reply = '<pick id="e1"></pick><pick id="e2"></pick><pick id="e3"></pick>';
        expect(parsePicks(reply, VALID, 2).picks.map((pick) => pick.id)).toEqual(['e1', 'e2']);
    });

    it('accepts single quotes, unquoted ids and self-closing tags, and drops thinking', () => {
        const reply = "<think>maybe e3</think><pick id='e1'/>\n<pick id=e2>x</pick>";
        expect(parsePicks(reply, VALID, 8).picks.map((pick) => pick.id)).toEqual(['e1', 'e2']);
    });

    it('returns no picks for a reply without picks and keeps its stray text', () => {
        expect(parsePicks('None of these matter now.', VALID, 8)).toEqual({
            picks: [],
            ignored: [],
            none: false,
            stray: 'None of these matter now.',
        });
    });

    it('recognises an explicit <none/> as "nothing is needed"', () => {
        for (const reply of ['<none/>', '<none />', '<think>hm</think>\n<NONE></none>']) {
            expect(parsePicks(reply, VALID, 8)).toMatchObject({ picks: [], none: true, stray: '' });
        }
    });

    it('shortens long stray text (live 2026-10-09: a safety classifier answered "User Safety: safe")', () => {
        expect(parsePicks('User Safety: safe', VALID, 8).stray).toBe('User Safety: safe');
        expect(parsePicks('x'.repeat(200), VALID, 8).stray).toHaveLength(81);
    });
});
