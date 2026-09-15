import { describe, expect, it } from 'vitest';
import { acceptAllSelection, applyOrder, withBlocked } from '../../src/core/assistant/plan';
import type { OperationProposal } from '../../src/core/assistant/types';

/** Batch planning (research R8, FR-010, FR-012). */

function proposal(
    id: string,
    op: OperationProposal['op'],
    options: Partial<OperationProposal> = {}
): OperationProposal {
    return {
        id,
        op,
        values: {},
        dependsOn: [],
        destructive: op === 'delete',
        decision: 'pending',
        summary: `${op} ${id}`,
        ...options,
    };
}

describe('applyOrder', () => {
    it('creates folders first and deletes last, keeping reply order within a kind', () => {
        const ordered = applyOrder([
            proposal('d', 'delete'),
            proposal('e2', 'create_entry'),
            proposal('m', 'move'),
            proposal('f', 'create_folder'),
            proposal('e1', 'create_entry'),
            proposal('r', 'rename'),
            proposal('x', 'edit_entry'),
        ]);
        expect(ordered.map((item) => item.id)).toEqual(['f', 'e2', 'e1', 'm', 'r', 'x', 'd']);
    });
});

describe('withBlocked', () => {
    it('blocks dependents of a denied proposal and names the dependency', () => {
        const result = withBlocked([
            proposal('f', 'create_folder', { decision: 'denied', summary: 'Create folder "Taverns"' }),
            proposal('e', 'create_entry', { dependsOn: ['f'] }),
        ]);
        expect(result[1]).toMatchObject({
            decision: 'blocked',
            blockedReason: 'needs "Create folder "Taverns""',
        });
    });

    it('releases a blocked proposal once the dependency is pending again', () => {
        const blocked = withBlocked([
            proposal('f', 'create_folder', { decision: 'invalid' }),
            proposal('e', 'create_entry', { dependsOn: ['f'] }),
        ]);
        const released = withBlocked([
            { ...(blocked[0] as OperationProposal), decision: 'pending' },
            blocked[1] as OperationProposal,
        ]);
        expect(released[1]?.decision).toBe('pending');
        expect(released[1]?.blockedReason).toBeUndefined();
    });

    it('leaves decided proposals alone', () => {
        const result = withBlocked([
            proposal('f', 'create_folder', { decision: 'failed' }),
            proposal('e', 'create_entry', { dependsOn: ['f'], decision: 'applied' }),
        ]);
        expect(result[1]?.decision).toBe('applied');
    });
});

describe('acceptAllSelection', () => {
    it('takes pending non-destructive proposals in apply order', () => {
        const selection = acceptAllSelection([
            proposal('d', 'delete'),
            proposal('e', 'create_entry', { dependsOn: ['f'] }),
            proposal('f', 'create_folder'),
            proposal('x', 'edit_entry', { destructive: true }),
            proposal('n', 'rename', { decision: 'denied' }),
        ]);
        expect(selection).toEqual(['f', 'e']);
    });

    it('accepts dependents of an already applied proposal', () => {
        const selection = acceptAllSelection([
            proposal('f', 'create_folder', { decision: 'applied' }),
            proposal('e', 'create_entry', { dependsOn: ['f'] }),
        ]);
        expect(selection).toEqual(['e']);
    });

    it('skips dependents whose dependency is not part of the selection', () => {
        const selection = acceptAllSelection([
            proposal('f', 'create_folder', { destructive: true }),
            proposal('e', 'create_entry', { dependsOn: ['f'] }),
        ]);
        expect(selection).toEqual([]);
    });
});
