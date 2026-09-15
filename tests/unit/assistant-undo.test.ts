import { describe, expect, it } from 'vitest';
import { planUndo } from '../../src/core/assistant/undo';
import { createFolderNode, findNode } from '../../src/core/state/schema';
import type { AppliedBatch } from '../../src/core/assistant/types';
import { NODE_IDS, aldermeerState } from '../fixtures/assistant/outline-aldermeer';

/** Undo planning with skip detection (research R9, FR-015). */

const NOW = '2026-09-15T12:00:00.000Z';

function batch(items: AppliedBatch['items']): AppliedBatch {
    return { id: 'a1', appliedAt: NOW, items };
}

describe('planUndo', () => {
    it('reverts in reverse order and covers every inverse kind', () => {
        const state = aldermeerState();
        const removed = createFolderNode({ id: 'gone', parentId: NODE_IDS.aldermeer, name: 'Gone', now: NOW });
        const plan = planUndo(
            batch([
                { proposalId: 'p1', op: 'create_folder', nodeId: NODE_IDS.hearth, afterUpdatedAt: NOW, inverse: { kind: 'delete-created' } },
                { proposalId: 'p2', op: 'rename', nodeId: NODE_IDS.cities, afterUpdatedAt: NOW, inverse: { kind: 'restore-name', name: 'Old' } },
                { proposalId: 'p3', op: 'move', nodeId: NODE_IDS.taverns, afterUpdatedAt: NOW, inverse: { kind: 'restore-position', parentId: NODE_IDS.aldermeer, index: 0 } },
                { proposalId: 'p4', op: 'edit_entry', nodeId: NODE_IDS.bristlemark, afterUpdatedAt: NOW, inverse: { kind: 'restore-fields', name: 'Bristlemark', native: { content: 'old' } } },
                { proposalId: 'p5', op: 'delete', nodeId: 'gone', afterUpdatedAt: NOW, inverse: { kind: 'reinsert', parentId: NODE_IDS.aldermeer, index: 1, subtree: removed } },
            ]),
            state
        );
        expect(plan.skipped).toEqual([]);
        expect(plan.steps.map((step) => step.kind)).toEqual([
            'reinsert',
            'restore-fields',
            'restore-position',
            'restore-name',
            'delete-created',
        ]);
    });

    it('skips an item edited after the batch was applied', () => {
        const state = aldermeerState();
        const entry = findNode(state, NODE_IDS.bristlemark);
        if (entry) {
            entry.updatedAt = '2026-09-15T13:00:00.000Z';
        }
        const plan = planUndo(
            batch([
                { proposalId: 'p1', op: 'edit_entry', nodeId: NODE_IDS.bristlemark, afterUpdatedAt: NOW, inverse: { kind: 'restore-fields', name: 'Bristlemark', native: {} } },
                { proposalId: 'p2', op: 'rename', nodeId: NODE_IDS.cities, afterUpdatedAt: NOW, inverse: { kind: 'restore-name', name: 'Old' } },
            ]),
            state
        );
        expect(plan.skipped).toEqual([
            { proposalId: 'p1', reason: 'it was edited after the batch was applied' },
        ]);
        expect(plan.steps.map((step) => step.proposalId)).toEqual(['p2']);
    });

    it('skips items that no longer exist or lost their folder', () => {
        const state = aldermeerState();
        const removed = createFolderNode({ id: 'gone', parentId: 'missing-parent', name: 'Gone', now: NOW });
        const plan = planUndo(
            batch([
                { proposalId: 'p1', op: 'rename', nodeId: 'deleted-meanwhile', afterUpdatedAt: NOW, inverse: { kind: 'restore-name', name: 'x' } },
                { proposalId: 'p2', op: 'delete', nodeId: 'gone', afterUpdatedAt: NOW, inverse: { kind: 'reinsert', parentId: 'missing-parent', index: 0, subtree: removed } },
                { proposalId: 'p3', op: 'move', nodeId: NODE_IDS.taverns, afterUpdatedAt: NOW, inverse: { kind: 'restore-position', parentId: 'missing-parent', index: 0 } },
            ]),
            state
        );
        expect(plan.skipped.map((item) => item.reason)).toEqual([
            'its previous folder no longer exists',
            'its folder no longer exists',
            'the item no longer exists',
        ]);
        expect(plan.steps).toEqual([]);
    });

    it('does not delete a created folder that received new items', () => {
        const state = aldermeerState();
        const plan = planUndo(
            batch([
                { proposalId: 'p1', op: 'create_folder', nodeId: NODE_IDS.cities, afterUpdatedAt: NOW, inverse: { kind: 'delete-created' } },
            ]),
            state
        );
        expect(plan.skipped[0]?.reason).toBe('items were added inside it');
    });
});
