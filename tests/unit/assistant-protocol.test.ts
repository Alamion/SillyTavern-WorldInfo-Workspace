import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseReply } from '../../src/core/assistant/parser';
import { toProposals } from '../../src/core/assistant/validate';
import { buildHandleMap } from '../../src/core/assistant/handles';
import { resolveScope } from '../../src/core/assistant/scope';
import { aldermeerState } from '../fixtures/assistant/outline-aldermeer';

/**
 * Parser rules 1–8 of contracts/assistant-protocol.md, driven by the recorded
 * live reply and hand-made hostile cases.
 */

const FIXTURES = join(__dirname, '..', 'fixtures', 'assistant');
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');

describe('recorded live reply (research R3 probe)', () => {
    const parsed = parseReply(fixture('probe-2026-09-15-router.txt'), { final: true });

    it('finds all five operations with their attributes', () => {
        expect(parsed.blocks.map((block) => block.type)).toEqual([
            'create_folder',
            'move',
            'create_entry',
            'create_entry',
            'edit_entry',
        ]);
        expect(parsed.blocks[0]?.attrs).toMatchObject({ parent: 'f3', ref: 'new1' });
        expect(parsed.blocks[1]?.attrs).toMatchObject({ id: 'e2', parent: 'new1' });
        expect(parsed.blocks[4]?.attrs).toMatchObject({ id: 'e1' });
        expect(parsed.unparsed).toEqual([]);
    });

    it('reads titles, keys and verbatim content', () => {
        expect(parsed.blocks[0]?.tags.title).toBe('Taverns');
        expect(parsed.blocks[2]?.tags.keys).toEqual(['salty keel', 'tavern', 'harbor', 'alehouse']);
        expect(parsed.blocks[2]?.tags.content).toContain('A bustling waterfront tavern');
        expect(parsed.blocks[2]?.tags.content?.startsWith('\n')).toBe(false);
        expect(parsed.blocks[4]?.tags.content).toBe(
            'Capital of Aldermeer, built on the confluence of the Lira and the Ossen. The harbor district never sleeps.'
        );
    });

    it('keeps the prose and drops the blocks from it', () => {
        expect(parsed.prose).toContain('I\'ll work through this step by step');
        expect(parsed.prose).toContain('That completes all four parts');
        expect(parsed.prose).not.toContain('<op');
    });

    it('is identical for every chunk split of the same text', () => {
        const text = fixture('probe-2026-09-15-router.txt');
        for (const size of [1, 7, 64, 500]) {
            let accumulated = '';
            let last = parseReply('', {});
            for (let at = 0; at < text.length; at += size) {
                accumulated += text.slice(at, at + size);
                last = parseReply(accumulated, {});
                // A partially received block is never exposed.
                expect(last.blocks.every((block) => block.raw.endsWith('</op>'))).toBe(true);
            }
            const final = parseReply(accumulated, { final: true });
            expect(final.blocks).toEqual(parsed.blocks);
            expect(final.prose).toEqual(parsed.prose);
            expect(last.blocks.length).toBeLessThanOrEqual(final.blocks.length);
        }
    });
});

describe('tolerance', () => {
    it('reports a cut-off trailing block only when the reply is final', () => {
        const text = fixture('truncated.txt');
        expect(parseReply(text, {}).unparsed).toEqual([]);
        const final = parseReply(text, { final: true });
        expect(final.blocks).toHaveLength(1);
        expect(final.unparsed[0]).toMatchObject({ kind: 'truncated' });
        expect(final.unparsed[0]?.excerpt.length).toBeLessThanOrEqual(201);
    });

    it('drops inline backticks wrapped around a block (live run 2026-09-16)', () => {
        const parsed = parseReply('Removing `Cinder hollow`.\n\n`<op type="edit_entry" id="e2"><keys>Cinderhollow</keys></op>`', {
            final: true,
        });
        expect(parsed.blocks).toHaveLength(1);
        expect(parsed.prose).toBe('Removing `Cinder hollow`.');
    });

    it('recognizes fenced blocks and drops the fences from prose', () => {
        const parsed = parseReply(fixture('fenced.txt'), { final: true });
        expect(parsed.blocks.map((block) => block.type)).toEqual(['create_folder', 'rename']);
        expect(parsed.prose).not.toContain('```');
        expect(parsed.prose).toContain('Sure — here are the changes:');
    });

    it('moves think spans into reasoning and keeps content verbatim', () => {
        const parsed = parseReply(fixture('think.txt'), { final: true });
        expect(parsed.reasoning).toContain('Hearth & Home (f3) is the obvious parent');
        expect(parsed.prose).not.toContain('<think>');
        expect(parsed.blocks[0]?.tags.title).toBe('The Salty Keel & Anchor');
        expect(parsed.blocks[0]?.tags.content).toBe(
            'Ale & stew, served under <lantern light> that never goes out.'
        );
    });

    it('treats an unclosed think span at the start as reasoning only', () => {
        const parsed = parseReply('<think>still weighing the options', {});
        expect(parsed.reasoning).toBe('still weighing the options');
        expect(parsed.prose).toBe('');
        expect(parsed.blocks).toEqual([]);
    });

    it('rejects an unknown field but keeps the other block', () => {
        const parsed = parseReply(fixture('unknown-field.txt'), { final: true });
        expect(parsed.unparsed[0]).toMatchObject({
            kind: 'malformed-block',
            reason: 'unknown field "sideways"',
        });
        expect(parsed.blocks).toHaveLength(1);
        expect(parsed.blocks[0]?.tags.fields).toEqual({ position: 4, depth: 2 });
    });

    it('tolerates sloppy attribute quoting', () => {
        const parsed = parseReply(fixture('broken-quotes.txt'), { final: true });
        expect(parsed.blocks).toHaveLength(2);
        expect(parsed.blocks[0]).toMatchObject({
            type: 'create_entry',
            attrs: { parent: 'f3', ref: 'new1' },
        });
    });

    it('ignores stray closing tags in prose', () => {
        const parsed = parseReply(fixture('garbage.txt'), { final: true });
        expect(parsed.blocks).toEqual([]);
        expect(parsed.unparsed).toEqual([]);
        expect(parsed.prose).toContain('nothing needs to change');
    });

    it('reports unknown types and missing attributes per block', () => {
        const parsed = parseReply(
            [
                '<op type="teleport" id="e1"></op>',
                '<op type="move" id="e1"></op>',
                '<op type="rename" id="e1"></op>',
                '<op type="edit_entry" id="e1"><content>fresh</content></op>',
            ].join('\n\n'),
            { final: true }
        );
        expect(parsed.unparsed.map((item) => item.reason)).toEqual([
            'unknown operation type "teleport"',
            'move needs parent',
            'rename needs a title',
        ]);
        expect(parsed.blocks).toHaveLength(1);
    });

    it('parses enum names, booleans and null in fields', () => {
        const parsed = parseReply(
            '<op type="edit_entry" id="e1"><fields>position=at_depth, role=assistant, constant=yes, enabled=no, sticky=null, order=120</fields></op>',
            { final: true }
        );
        expect(parsed.blocks[0]?.tags.fields).toEqual({
            position: 4,
            role: 2,
            constant: true,
            disable: true,
            sticky: null,
            order: 120,
        });
    });

    it('de-duplicates keys case-insensitively and keeps the first spelling', () => {
        const parsed = parseReply(
            '<op type="create_entry" parent="f1"><title>T</title><keys>Tavern, tavern\nale</keys></op>',
            { final: true }
        );
        expect(parsed.blocks[0]?.tags.keys).toEqual(['Tavern', 'ale']);
    });

    it('collects prose references', () => {
        const parsed = parseReply('See [[e1]] and [[f2]] for context.', { final: true });
        expect(parsed.references).toEqual(['e1', 'f2']);
    });
});

describe('performance', () => {
    it('parses and validates a 50-operation reply quickly (plan performance goal)', () => {
        const blocks = Array.from(
            { length: 50 },
            (_unused, index) =>
                `<op type="create_entry" parent="f1" ref="new${String(index)}">` +
                `<title>Entry ${String(index)}</title><keys>a${String(index)}, b</keys>` +
                `<content>\n${'Lore text. '.repeat(40)}\n</content></op>`
        ).join('\n\nProse between blocks.\n\n');
        const state = aldermeerState();
        const map = buildHandleMap(state);
        const scope = [...resolveScope(state, { kind: 'workspace' }, []).nodeIds];
        let counter = 0;
        const started = performance.now();
        const parsed = parseReply(blocks, { final: true });
        const proposals = toProposals(parsed.blocks, {
            state,
            snapshot: { handles: map.handles, scopeNodeIds: scope },
            newProposalId: () => `p${String((counter += 1))}`,
        });
        const elapsed = performance.now() - started;
        expect(parsed.blocks).toHaveLength(50);
        expect(proposals.filter((proposal) => proposal.decision === 'pending')).toHaveLength(50);
        expect(elapsed).toBeLessThan(50);
    });
});
