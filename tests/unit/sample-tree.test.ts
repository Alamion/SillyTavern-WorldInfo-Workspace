import { describe, expect, it } from 'vitest';
import {
    SAMPLE_DATASET,
    type SampleEntryNode,
    type SampleFolderNode,
    type SampleNode,
} from '../../src/core/sample/dataset';
import {
    buildNodeIndex,
    collectWiRoots,
    depthOf,
    findDefaultSelection,
    resolveMemberships,
    sortedChildren,
    wiRootChain,
} from '../../src/core/sample/tree';

const index = buildNodeIndex(SAMPLE_DATASET.root);
const realmRoot = index.get('realm-root') as SampleFolderNode;
const marchesRoot = index.get('marches-root') as SampleFolderNode;
const veskHarrow = index.get('card-vesk-harrow') as SampleEntryNode;
const bristlemark = index.get('card-bristlemark') as SampleEntryNode;
const sandboxEntry = index.get('sandbox-01') as SampleEntryNode;

describe('buildNodeIndex', () => {
    it('indexes every node by id', () => {
        let count = 0;
        const walk = (node: SampleNode): void => {
            count += 1;
            if (node.kind === 'folder') {
                node.children.forEach(walk);
            }
        };
        walk(SAMPLE_DATASET.root);
        expect(index.size).toBe(count);
    });
});

describe('sortedChildren', () => {
    it('returns a copy that cannot mutate the dataset', () => {
        const copy = sortedChildren(realmRoot);
        expect(copy).not.toBe(realmRoot.children);
        copy.pop();
        expect(realmRoot.children.length).toBeGreaterThan(copy.length);
    });
});

describe('depthOf', () => {
    it('counts folder levels from the root', () => {
        expect(depthOf(index, SAMPLE_DATASET.root)).toBe(0);
        expect(depthOf(index, realmRoot)).toBe(1);
        expect(depthOf(index, marchesRoot)).toBe(2);
        expect(depthOf(index, sandboxEntry)).toBe(2);
    });
});

describe('wiRootChain', () => {
    it('lists enclosing WI roots from outer to inner', () => {
        expect(wiRootChain(index, bristlemark)).toEqual([realmRoot]);
        expect(wiRootChain(index, veskHarrow)).toEqual([realmRoot, marchesRoot]);
        expect(wiRootChain(index, sandboxEntry)).toEqual([]);
    });
});

describe('resolveMemberships', () => {
    it('matches the precomputed bookMemberships on every entry', () => {
        for (const node of index.values()) {
            if (node.kind === 'entry') {
                expect(node.bookMemberships).toEqual(resolveMemberships(index, node));
            }
        }
    });

    it('gives nested-root entries both books (world intersection)', () => {
        expect(resolveMemberships(index, veskHarrow)).toEqual([
            'aldermeer-realm',
            'ashen-marches',
        ]);
    });
});

describe('collectWiRoots', () => {
    it('finds every designation at any depth', () => {
        const roots = collectWiRoots(SAMPLE_DATASET.root);
        expect(roots).toEqual([realmRoot, marchesRoot]);
    });
});

describe('findDefaultSelection', () => {
    it('returns the first entry under the first WI root', () => {
        expect(findDefaultSelection(SAMPLE_DATASET.root)).toBe(bristlemark);
    });
});
