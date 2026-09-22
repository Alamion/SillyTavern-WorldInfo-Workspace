import { describe, expect, it } from 'vitest';

import { buildScaleDataset, idAt } from '../support/scaleDataset';
import { flattenRoot } from '../../src/core/sync/flatten';
import { fingerprintEntry } from '../../src/core/sync/fingerprint';
import { commitEntryField } from '../../src/core/tree/operations';
import { findNode, type FolderNode } from '../../src/core/state/schema';
import { diffTree } from '../../src/core/hooks/treeDiff';

/**
 * Scale changes DURATION, never OUTCOME (spec 006 SC-004).
 *
 * The Phase 2 and 3 work introduced structural sharing, identity-keyed
 * memoization and a uid cursor — all of which are only legitimate if the results
 * are byte-for-byte what the small-input path produces. These tests run the same
 * shapes at two very different sizes and compare normalized output.
 */

function wiRoot(state: ReturnType<typeof buildScaleDataset>['state']): FolderNode {
    const found = state.root.children.find(
        (child): child is FolderNode => child.kind === 'folder' && child.isWiRoot
    );
    if (!found) {
        throw new Error('dataset has no World Info root');
    }
    return found;
}

/** Flattens a dataset's primary book with the production uid allocator. */
function flattenPrimary(size: number) {
    const dataset = buildScaleDataset({
        primaryEntries: size,
        secondaryEntries: 0,
        looseNodes: 0,
        contentChars: 120,
    });
    const root = wiRoot(dataset.state);
    const result = flattenRoot({
        state: dataset.state,
        rootId: root.id,
        bookName: dataset.primaryBookName,
        existingBook: { entries: {} },
        orphans: [],
        allocateUid: (used, from) => {
            for (let uid = Math.max(0, from); uid < 1_000_000; uid += 1) {
                if (!used.has(uid)) {
                    return uid;
                }
            }
            return 999_999;
        },
    });
    return { dataset, result };
}

describe('flatten is scale-invariant', () => {
    it('assigns the same uid sequence at 10 and at 1000 entries', () => {
        const small = flattenPrimary(10);
        const large = flattenPrimary(1000);
        const smallUids = small.result.exported.map((row) => row.uid);
        const largeHead = large.result.exported.slice(0, 10).map((row) => row.uid);
        expect(largeHead).toEqual(smallUids);
        // The cursor optimization must not create gaps.
        const allUids = large.result.exported.map((row) => row.uid);
        expect(allUids).toEqual([...allUids].sort((a, b) => a - b));
        expect(new Set(allUids).size).toBe(allUids.length);
    });

    it('produces one native entry per exported node and skips nothing', () => {
        for (const size of [10, 1000]) {
            const { result } = flattenPrimary(size);
            expect(result.exported).toHaveLength(size);
            expect(result.skipped).toEqual([]);
            expect(Object.keys(result.entries)).toHaveLength(size);
        }
    });

    it('gives an entry the same hash regardless of how many siblings it has', () => {
        const small = flattenPrimary(10);
        const large = flattenPrimary(1000);
        // Same seed, so entry N has identical content in both datasets.
        for (let index = 0; index < 10; index += 1) {
            expect(large.result.exported[index]?.hash).toBe(small.result.exported[index]?.hash);
        }
    });
});

describe('the fingerprint memo cannot change a hash', () => {
    it('matches an uncached hash of the same value', () => {
        const { state, primaryEntryIds } = buildScaleDataset({
            primaryEntries: 50,
            secondaryEntries: 0,
            looseNodes: 0,
        });
        const node = findNode(state, idAt(primaryEntryIds, 7));
        if (node?.kind !== 'entry') {
            throw new Error('expected an entry');
        }
        const memoized = fingerprintEntry(node.native);
        // A structurally identical but distinct object cannot hit the memo.
        const uncached = fingerprintEntry(structuredClone(node.native));
        expect(uncached).toBe(memoized);
    });
});

describe('tree events are scale-invariant', () => {
    it('reports exactly one change for one edit, at any size', () => {
        for (const size of [10, 1000]) {
            const dataset = buildScaleDataset({
                primaryEntries: size,
                secondaryEntries: 0,
                looseNodes: 0,
                contentChars: 120,
            });
            const targetId = idAt(dataset.primaryEntryIds, Math.floor(size / 2));
            const after = commitEntryField(dataset.state, targetId, 'content', 'edited');
            const changes = diffTree(dataset.state, after);
            expect(changes).toHaveLength(1);
            expect(changes[0]?.change).toBe('update');
            expect(changes[0]?.node.nodeId).toBe(targetId);
        }
    });
});

describe('structural sharing is scale-invariant', () => {
    it('leaves every untouched entry reference-identical, at any size', () => {
        for (const size of [10, 1000]) {
            const dataset = buildScaleDataset({
                primaryEntries: size,
                secondaryEntries: 0,
                looseNodes: 0,
                contentChars: 120,
            });
            const targetId = idAt(dataset.primaryEntryIds, 0);
            const after = commitEntryField(dataset.state, targetId, 'content', 'edited');
            let shared = 0;
            for (const id of dataset.primaryEntryIds.slice(1)) {
                if (findNode(dataset.state, id) === findNode(after, id)) {
                    shared += 1;
                }
            }
            expect(shared).toBe(size - 1);
        }
    });
});
