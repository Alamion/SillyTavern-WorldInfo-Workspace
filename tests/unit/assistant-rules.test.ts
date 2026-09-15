import { describe, expect, it } from 'vitest';
import {
    findDuplicate,
    fingerprintValues,
    isDestructiveEdit,
    stalenessOf,
} from '../../src/core/assistant/rules';
import { findNode } from '../../src/core/state/schema';
import type { OperationProposal } from '../../src/core/assistant/types';
import { NODE_IDS, aldermeerState } from '../fixtures/assistant/outline-aldermeer';

/** Destructive / duplicate / staleness rules (research R8, FR-010, FR-013, FR-016). */

function entry(state = aldermeerState(), id: string = NODE_IDS.bristlemark) {
    const node = findNode(state, id);
    if (node?.kind !== 'entry') {
        throw new Error('fixture changed');
    }
    return node;
}

describe('isDestructiveEdit', () => {
    it('is false for additions and rewording that keeps most of the text', () => {
        const node = entry();
        expect(
            isDestructiveEdit(node, { content: `${node.native.content} A new sentence about city law.` })
        ).toBe(false);
        expect(
            isDestructiveEdit(node, {
                content: node.native.content.replace('never sleeps', 'never rests'),
            })
        ).toBe(false);
    });

    it('is true when more than half the content disappears', () => {
        const node = entry();
        expect(isDestructiveEdit(node, { content: 'Capital of Aldermeer.' })).toBe(true);
    });

    it('is false at exactly half removed, true just past it', () => {
        const node = entry();
        node.native.content = Array.from({ length: 10 }, (_unused, index) => `word${String(index)}`).join(' ');
        const half = node.native.content.split(' ').slice(0, 5).join(' ');
        expect(isDestructiveEdit(node, { content: half })).toBe(false);
        expect(isDestructiveEdit(node, { content: half.split(' ').slice(0, 4).join(' ') })).toBe(true);
    });

    it('is true when a primary or secondary keyword is removed', () => {
        const node = entry();
        node.native.keysecondary = ['docks'];
        expect(isDestructiveEdit(node, { keys: ['bristlemark'] })).toBe(true);
        expect(isDestructiveEdit(node, { keys: ['bristlemark', 'HARBOR CITY'] })).toBe(false);
        expect(isDestructiveEdit(node, { secondaryKeys: [] })).toBe(true);
    });

    it('ignores fields and titles', () => {
        expect(isDestructiveEdit(entry(), { title: 'New name', fields: { order: 10 } })).toBe(false);
    });
});

describe('findDuplicate', () => {
    it('matches a title inside the same World Info root', () => {
        const state = aldermeerState();
        expect(findDuplicate(state, NODE_IDS.hearth, { title: 'bristlemark' })).toBe(
            NODE_IDS.bristlemark
        );
    });

    it('matches a shared primary keyword', () => {
        const state = aldermeerState();
        expect(findDuplicate(state, NODE_IDS.cities, { title: 'Fresh', keys: ['ALEHOUSE'] })).toBe(
            NODE_IDS.taverns
        );
    });

    it('returns undefined for a genuinely new entry', () => {
        const state = aldermeerState();
        expect(
            findDuplicate(state, NODE_IDS.hearth, { title: 'Hearth Bread', keys: ['bread'] })
        ).toBeUndefined();
    });

    it('compares against the whole workspace outside any root', () => {
        const state = aldermeerState();
        const outside = state.root;
        expect(findDuplicate(state, outside.id, { title: 'Bristlemark' })).toBe(NODE_IDS.bristlemark);
    });
});

describe('stalenessOf', () => {
    const proposalFor = (state = aldermeerState()): OperationProposal => {
        const node = entry(state);
        return {
            id: 'p1',
            op: 'edit_entry',
            targetId: node.id,
            values: { content: 'Fresh text.' },
            baseline: { updatedAt: node.updatedAt, fingerprint: fingerprintValues(node, { content: 'x' }) },
            dependsOn: [],
            destructive: false,
            decision: 'pending',
            summary: 'Update',
        };
    };

    it('is null while the target is untouched', () => {
        const state = aldermeerState();
        expect(stalenessOf(state, proposalFor(state))).toBeNull();
    });

    it('detects a changed target', () => {
        const state = aldermeerState();
        const proposal = proposalFor(state);
        const node = entry(state);
        node.native.content = 'someone edited this';
        node.updatedAt = '2026-09-15T13:00:00.000Z';
        expect(stalenessOf(state, proposal)).toBe('changed');
    });

    it('detects a deleted target', () => {
        const state = aldermeerState();
        const proposal = proposalFor(state);
        const cities = findNode(state, NODE_IDS.cities);
        if (cities?.kind !== 'folder') {
            throw new Error('fixture changed');
        }
        cities.children = cities.children.filter((child) => child.id !== NODE_IDS.bristlemark);
        expect(stalenessOf(state, proposal)).toBe('missing');
    });

    it('has nothing to check for creations', () => {
        const state = aldermeerState();
        expect(
            stalenessOf(state, {
                id: 'p2',
                op: 'create_entry',
                values: { title: 'New' },
                dependsOn: [],
                destructive: false,
                decision: 'pending',
                summary: 'Create',
            })
        ).toBeNull();
    });
});
