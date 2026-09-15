import { describe, expect, it } from 'vitest';
import { decisionNote } from '../../src/core/assistant/prompts';
import type { OperationProposal, ProposalBatch } from '../../src/core/assistant/types';

/** Decision memory fed back to the model (spec 005 FR-033). */

function proposal(id: string, decision: OperationProposal['decision'], title?: string): OperationProposal {
    return {
        id,
        op: 'create_entry',
        values: title !== undefined ? { title } : {},
        dependsOn: [],
        destructive: false,
        decision,
        summary: id,
    };
}

function batch(proposals: OperationProposal[]): ProposalBatch {
    return { id: 'b', proposals, unparsed: [], applied: [] };
}

describe('decisionNote', () => {
    it('lists accepted, undone and denied proposals', () => {
        expect(
            decisionNote(
                batch([
                    proposal('a', 'applied', 'The Salty Keel'),
                    proposal('b', 'denied', 'The Hearthfire Inn'),
                    proposal('c', 'reverted', 'Temporary'),
                ])
            )
        ).toBe(
            'Decisions on your previous proposals: accepted create_entry "The Salty Keel"; ' +
                'accepted then undone create_entry "Temporary"; ' +
                'denied create_entry "The Hearthfire Inn" (do not propose again unless asked).'
        );
    });

    it('uses the user-edited title when there is one', () => {
        const edited = proposal('a', 'applied', 'Model title');
        edited.userEdited = { title: 'My title' };
        expect(decisionNote(batch([edited]))).toContain('"My title"');
    });

    it('counts superseded proposals as denied', () => {
        expect(decisionNote(batch([proposal('a', 'superseded', 'Old idea')]))).toContain(
            'denied create_entry "Old idea"'
        );
    });

    it('returns null when nothing was decided', () => {
        expect(decisionNote(batch([proposal('a', 'pending'), proposal('b', 'invalid')]))).toBeNull();
        expect(decisionNote(batch([]))).toBeNull();
        expect(decisionNote(undefined)).toBeNull();
    });
});
