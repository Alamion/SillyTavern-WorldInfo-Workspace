import { describe, expect, it } from 'vitest';

import { buildScaleDataset, idAt } from '../support/scaleDataset';
import { buildNodeIndex, getNodeIndex } from '../../src/core/state/nodeIndex';
import { findNode } from '../../src/core/state/schema';
import { commitEntryField } from '../../src/core/tree/operations';

/**
 * Identity-keyed node index (spec 006 R2). The cache can never go stale by
 * construction: it is keyed by the root OBJECT, so a new root is a cache miss.
 */

describe('getNodeIndex', () => {
    it('returns the same index object for the same root', () => {
        const { state } = buildScaleDataset({ primaryEntries: 10, secondaryEntries: 0, looseNodes: 5 });
        expect(getNodeIndex(state.root)).toBe(getNodeIndex(state.root));
    });

    it('indexes every node including the root', () => {
        const { state, primaryEntryIds } = buildScaleDataset({
            primaryEntries: 10,
            secondaryEntries: 3,
            looseNodes: 5,
        });
        const index = getNodeIndex(state.root);
        expect(index.get(state.root.id)?.id).toBe(state.root.id);
        for (const id of primaryEntryIds) {
            expect(index.get(id)?.id).toBe(id);
        }
    });

    it('misses for a new root object, so it cannot go stale', () => {
        const { state, primaryEntryIds } = buildScaleDataset({
            primaryEntries: 10,
            secondaryEntries: 0,
            looseNodes: 0,
        });
        const first = getNodeIndex(state.root);
        const next = commitEntryField(state, idAt(primaryEntryIds, 0), 'content', 'edited');
        const second = getNodeIndex(next.root);
        expect(second).not.toBe(first);
        const node = second.get(idAt(primaryEntryIds, 0));
        expect(node?.kind === 'entry' ? node.native.content : '').toBe('edited');
    });

    it('buildNodeIndex stays available and uncached', () => {
        const { state } = buildScaleDataset({ primaryEntries: 3, secondaryEntries: 0, looseNodes: 0 });
        expect(buildNodeIndex(state.root)).not.toBe(buildNodeIndex(state.root));
    });
});

describe('findNode', () => {
    it('resolves nodes through the cached index', () => {
        const { state, primaryEntryIds } = buildScaleDataset({
            primaryEntries: 10,
            secondaryEntries: 0,
            looseNodes: 5,
        });
        expect(findNode(state, idAt(primaryEntryIds, 4))?.id).toBe(idAt(primaryEntryIds, 4));
        expect(findNode(state, state.root.id)?.id).toBe(state.root.id);
        expect(findNode(state, 'missing')).toBeUndefined();
    });

    it('reflects the state it is given, not a cached older one', () => {
        const { state, primaryEntryIds } = buildScaleDataset({
            primaryEntries: 5,
            secondaryEntries: 0,
            looseNodes: 0,
        });
        const targetId = idAt(primaryEntryIds, 2);
        findNode(state, targetId);
        const next = commitEntryField(state, targetId, 'content', 'fresh');
        const before = findNode(state, targetId);
        const after = findNode(next, targetId);
        expect(before?.kind === 'entry' ? before.native.content : '').not.toBe('fresh');
        expect(after?.kind === 'entry' ? after.native.content : '').toBe('fresh');
    });
});
