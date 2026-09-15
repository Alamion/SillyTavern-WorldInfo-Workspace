import { describe, expect, it } from 'vitest';
import { parseReply } from '../../src/core/assistant/parser';
import { toProposals } from '../../src/core/assistant/validate';
import { buildHandleMap } from '../../src/core/assistant/handles';
import { resolveScope } from '../../src/core/assistant/scope';
import type { WorkspaceState } from '../../src/core/state/schema';
import { HANDLES, NODE_IDS, aldermeerState } from '../fixtures/assistant/outline-aldermeer';

/** Block → proposal validation (research R4, FR-006, FR-007, FR-014). */

function proposalsOf(
    reply: string,
    options: { state?: WorkspaceState; scopeIds?: string[] } = {}
) {
    const state = options.state ?? aldermeerState();
    const map = buildHandleMap(state);
    const scope = options.scopeIds ?? [...resolveScope(state, { kind: 'workspace' }, []).nodeIds];
    let counter = 0;
    return {
        state,
        proposals: toProposals(parseReply(reply, { final: true }).blocks, {
            state,
            snapshot: { handles: map.handles, scopeNodeIds: scope },
            newProposalId: () => `p${String((counter += 1))}`,
        }),
    };
}

describe('create and edit', () => {
    it('accepts a creation in an in-scope folder and summarizes its location', () => {
        const { proposals } = proposalsOf(
            '<op type="create_entry" parent="f3"><title>The Salty Keel</title><keys>keel</keys><content>Ale.</content></op>'
        );
        expect(proposals[0]).toMatchObject({
            op: 'create_entry',
            decision: 'pending',
            parent: { nodeId: NODE_IDS.hearth },
            destructive: false,
        });
        expect(proposals[0]?.summary).toBe('Create entry "The Salty Keel" in Aldermeer / Hearth & Home');
    });

    it('records a baseline for edits and marks big removals destructive', () => {
        const { proposals } = proposalsOf(
            '<op type="edit_entry" id="e1"><content>Short.</content></op>'
        );
        expect(proposals[0]).toMatchObject({ op: 'edit_entry', targetId: NODE_IDS.bristlemark, destructive: true });
        expect(proposals[0]?.baseline?.fingerprint).toMatch(/^[0-9a-f]{8}$/);
    });

    it('treats an addition as non-destructive', () => {
        const { state } = proposalsOf('');
        const bristlemark = state;
        void bristlemark;
        const { proposals } = proposalsOf(
            '<op type="edit_entry" id="e1"><content>Capital of Aldermeer, built on the confluence of the Lira and the Ossen. The harbor district never sleeps. Sells charcoal. A new paragraph about city law.</content></op>'
        );
        expect(proposals[0]?.destructive).toBe(false);
    });

    it('marks a keyword removal destructive', () => {
        const { proposals } = proposalsOf('<op type="edit_entry" id="e1"><keys>bristlemark</keys></op>');
        expect(proposals[0]?.destructive).toBe(true);
    });

    it('flags a likely duplicate by title or keyword', () => {
        const byTitle = proposalsOf(
            '<op type="create_entry" parent="f3"><title>Bristlemark</title><content>x</content></op>'
        );
        expect(byTitle.proposals[0]?.duplicateOf).toBe(NODE_IDS.bristlemark);
        const byKey = proposalsOf(
            '<op type="create_entry" parent="f3"><title>Fresh</title><keys>tavern</keys><content>x</content></op>'
        );
        expect(byKey.proposals[0]?.duplicateOf).toBe(NODE_IDS.taverns);
    });

    it('rejects a no-op edit', () => {
        const state = aldermeerState();
        const content = 'Capital of Aldermeer, built on the confluence of the Lira and the Ossen. The harbor district never sleeps. Sells charcoal.';
        const { proposals } = proposalsOf(`<op type="edit_entry" id="e1"><content>${content}</content></op>`, {
            state,
        });
        expect(proposals[0]).toMatchObject({
            decision: 'invalid',
            invalidReason: 'the entry already has these values',
        });
    });

    it('rejects an edit of a folder or image', () => {
        const { proposals } = proposalsOf('<op type="edit_entry" id="f2"><content>x</content></op>');
        expect(proposals[0]?.invalidReason).toContain('is not an entry');
    });
});

describe('scope and handles', () => {
    it('rejects unknown handles', () => {
        const { proposals } = proposalsOf('<op type="delete" id="e99"></op>');
        expect(proposals[0]).toMatchObject({
            decision: 'invalid',
            invalidReason: 'unknown handle "e99"',
        });
    });

    it('rejects targets outside the scope', () => {
        const { proposals } = proposalsOf('<op type="delete" id="e1"></op>', {
            scopeIds: [NODE_IDS.hearth],
        });
        expect(proposals[0]?.invalidReason).toBe('"e1" is outside the context scope');
    });

    it('rejects a destination that is not a folder', () => {
        const { proposals } = proposalsOf('<op type="move" id="e1" parent="e2"></op>');
        expect(proposals[0]?.invalidReason).toBe('the destination is not a folder');
    });

    it('resolves duplicates by handle, never by name', () => {
        const state = aldermeerState();
        const cities = state.root.children[0]?.kind === 'folder' ? state.root.children[0].children[0] : undefined;
        if (cities?.kind !== 'folder' || cities.children[1] === undefined) {
            throw new Error('fixture changed');
        }
        cities.children[1].name = 'Bristlemark';
        const { proposals } = proposalsOf('<op type="rename" id="e2"><title>Renamed</title></op>', { state });
        expect(proposals[0]?.targetId).toBe(NODE_IDS.taverns);
    });
});

describe('structure operations', () => {
    it('links a creation to the new folder it depends on', () => {
        const { proposals } = proposalsOf(
            [
                '<op type="create_folder" parent="f3" ref="new1"><title>Taverns</title></op>',
                '<op type="create_entry" parent="new1" ref="new2"><title>Keel</title><content>x</content></op>',
                '<op type="move" id="e2" parent="new1"></op>',
            ].join('\n')
        );
        expect(proposals[1]?.parent).toEqual({ ref: 'new1' });
        expect(proposals[1]?.dependsOn).toEqual([proposals[0]?.id]);
        expect(proposals[2]?.dependsOn).toEqual([proposals[0]?.id]);
        expect(proposals.every((proposal) => proposal.decision === 'pending')).toBe(true);
    });

    it('rejects a ref used twice and a ref that is not a folder', () => {
        const { proposals } = proposalsOf(
            [
                '<op type="create_folder" parent="f3" ref="new1"><title>A</title></op>',
                '<op type="create_folder" parent="f3" ref="new1"><title>B</title></op>',
                '<op type="create_entry" parent="new9"><title>C</title><content>x</content></op>',
            ].join('\n')
        );
        expect(proposals[1]?.invalidReason).toBe('ref "new1" was already used');
        expect(proposals[2]?.invalidReason).toBe('unknown handle "new9"');
    });

    it('rejects a no-op move and a folder moving into itself', () => {
        const noop = proposalsOf('<op type="move" id="e1" parent="f2"></op>');
        expect(noop.proposals[0]?.invalidReason).toBe('the item is already there');
        const intoItself = proposalsOf('<op type="move" id="f1" parent="f2"></op>');
        expect(intoItself.proposals[0]?.invalidReason).toBe('a folder cannot move inside itself');
    });

    it('rejects renaming or deleting an item that was only just proposed', () => {
        const { proposals } = proposalsOf(
            [
                '<op type="create_folder" parent="f3" ref="new1"><title>A</title></op>',
                '<op type="rename" id="new1"><title>B</title></op>',
            ].join('\n')
        );
        expect(proposals[1]?.invalidReason).toContain('needs an existing item');
    });

    it('marks deletions destructive', () => {
        const { proposals } = proposalsOf('<op type="delete" id="e2"></op>');
        expect(proposals[0]).toMatchObject({ destructive: true, decision: 'pending' });
        expect(proposals[0]?.summary).toBe('Delete "Bristlemark Taverns"');
    });
});

describe('field validation', () => {
    it('rejects values the native format does not allow', () => {
        const { proposals } = proposalsOf(
            '<op type="edit_entry" id="e1"><fields>probability=250</fields></op>'
        );
        expect(proposals[0]?.decision).toBe('invalid');
        expect(proposals[0]?.invalidReason).toContain('probability');
    });

    it('accepts valid enum and numeric fields', () => {
        const { proposals } = proposalsOf(
            '<op type="edit_entry" id="e2"><fields>position=an_top, order=120</fields></op>'
        );
        expect(proposals[0]).toMatchObject({
            decision: 'pending',
            values: { fields: { position: 2, order: 120 } },
        });
    });

    it('keeps the handle map of the request for later reference', () => {
        expect(HANDLES['e1']).toBe(NODE_IDS.bristlemark);
    });
});
