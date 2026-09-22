import { describe, expect, it } from 'vitest';

import { buildScaleDataset, collectNodes, idAt } from '../support/scaleDataset';
import { findPath, withNodeCopied } from '../../src/core/state/sharing';
import { commitEntryField, setExpanded } from '../../src/core/tree/operations';
import type { FolderNode } from '../../src/core/state/schema';

/**
 * Structural sharing (spec 006 R1). The contract is narrow but load-bearing:
 * a mutation copies ONLY the root→target spine, every other subtree keeps its
 * object identity, and the previous state is never observably mutated.
 */

/** Ids along the root→target spine; throws when the node is absent. */
function pathIds(root: FolderNode, nodeId: string): string[] {
    const path = findPath(root, nodeId);
    if (!path) {
        throw new Error(`no path to ${nodeId}`);
    }
    return path.map((node) => node.id);
}

describe('findPath', () => {
    it('returns the chain from root to the target', () => {
        const { state, primaryEntryIds } = buildScaleDataset({
            primaryEntries: 5,
            secondaryEntries: 0,
            looseNodes: 0,
        });
        const targetId = idAt(primaryEntryIds, 2);
        const path = findPath(state.root, targetId);
        if (!path) {
            throw new Error('expected a path');
        }
        expect(path[0]?.id).toBe(state.root.id);
        expect(path[path.length - 1]?.id).toBe(targetId);
        // every step is a child of the previous one
        for (let index = 1; index < path.length; index += 1) {
            const parent = path[index - 1] as FolderNode;
            const child = path[index];
            expect(parent.kind).toBe('folder');
            expect(parent.children.some((candidate) => candidate.id === child?.id)).toBe(true);
        }
    });

    it('returns null for an unknown id', () => {
        const { state } = buildScaleDataset({ primaryEntries: 2, secondaryEntries: 0, looseNodes: 0 });
        expect(findPath(state.root, 'nope')).toBeNull();
    });

    it('returns just the root for the root id', () => {
        const { state } = buildScaleDataset({ primaryEntries: 2, secondaryEntries: 0, looseNodes: 0 });
        expect(findPath(state.root, state.root.id)?.map((node) => node.id)).toEqual([
            state.root.id,
        ]);
    });
});

describe('withNodeCopied', () => {
    it('copies the spine and shares every untouched subtree', () => {
        const { state, primaryEntryIds } = buildScaleDataset({
            primaryEntries: 30,
            secondaryEntries: 10,
            looseNodes: 20,
        });
        const targetId = idAt(primaryEntryIds, 10);
        const result = withNodeCopied(state, targetId);
        if (!result) {
            throw new Error('expected a copy');
        }
        const next = result.state;

        // The spine is fresh...
        expect(next).not.toBe(state);
        expect(next.root).not.toBe(state.root);
        expect(result.node).not.toBe(
            collectNodes(state.root).find((node) => node.id === targetId)
        );

        const spine = new Set(pathIds(state.root, targetId));

        // ...and everything off the spine keeps identity.
        const before = new Map(collectNodes(state.root).map((node) => [node.id, node]));
        let shared = 0;
        for (const node of collectNodes(next.root)) {
            if (spine.has(node.id)) {
                expect(node).not.toBe(before.get(node.id));
            } else {
                expect(node).toBe(before.get(node.id));
                shared += 1;
            }
        }
        expect(shared).toBeGreaterThan(spine.size);
    });

    it('does not mutate the previous state when the copy is written to', () => {
        const { state, primaryEntryIds } = buildScaleDataset({
            primaryEntries: 5,
            secondaryEntries: 0,
            looseNodes: 0,
        });
        const targetId = idAt(primaryEntryIds, 1);
        const original = collectNodes(state.root).find((node) => node.id === targetId);
        const originalContent =
            original?.kind === 'entry' ? original.native.content : '';

        const next = commitEntryField(state, targetId, 'content', 'CHANGED');

        const after = collectNodes(state.root).find((node) => node.id === targetId);
        expect(after?.kind === 'entry' ? after.native.content : '').toBe(originalContent);
        const updated = collectNodes(next.root).find((node) => node.id === targetId);
        expect(updated?.kind === 'entry' ? updated.native.content : '').toBe('CHANGED');
    });

    it('returns null for an unknown id', () => {
        const { state } = buildScaleDataset({ primaryEntries: 2, secondaryEntries: 0, looseNodes: 0 });
        expect(withNodeCopied(state, 'nope')).toBeNull();
    });
});

describe('operations preserve identity off the changed path', () => {
    it('commitEntryField leaves sibling entries reference-identical', () => {
        const { state, primaryEntryIds } = buildScaleDataset({
            primaryEntries: 40,
            secondaryEntries: 5,
            looseNodes: 10,
        });
        const targetId = idAt(primaryEntryIds, 20);
        const next = commitEntryField(state, targetId, 'content', 'edited');

        const before = new Map(collectNodes(state.root).map((node) => [node.id, node]));
        const spine = new Set(pathIds(state.root, targetId));
        for (const node of collectNodes(next.root)) {
            if (!spine.has(node.id)) {
                expect(node).toBe(before.get(node.id));
            }
        }
    });

    it('commitEntryField gives the edited entry a fresh native object', () => {
        const { state, primaryEntryIds } = buildScaleDataset({
            primaryEntries: 5,
            secondaryEntries: 0,
            looseNodes: 0,
        });
        const targetId = idAt(primaryEntryIds, 0);
        const before = collectNodes(state.root).find((n) => n.id === targetId);
        const next = commitEntryField(state, targetId, 'content', 'edited');
        const after = collectNodes(next.root).find((n) => n.id === targetId);
        if (before?.kind !== 'entry' || after?.kind !== 'entry') {
            throw new Error('expected entries');
        }
        // A fresh native object is what makes identity-keyed memoization correct.
        expect(after.native).not.toBe(before.native);
        expect(after.sync).not.toBe(before.sync);
    });

    it('setExpanded copies only the spine', () => {
        const { state } = buildScaleDataset({
            primaryEntries: 20,
            secondaryEntries: 5,
            looseNodes: 10,
        });
        const folderId = state.root.children[0]?.id ?? '';
        const next = setExpanded(state, folderId, false);
        const before = new Map(collectNodes(state.root).map((node) => [node.id, node]));
        const spine = new Set(pathIds(state.root, folderId));
        for (const node of collectNodes(next.root)) {
            if (!spine.has(node.id)) {
                expect(node).toBe(before.get(node.id));
            }
        }
        const folder = next.root.children.find((child) => child.id === folderId);
        expect(folder?.kind === 'folder' ? folder.expanded : true).toBe(false);
    });
});
