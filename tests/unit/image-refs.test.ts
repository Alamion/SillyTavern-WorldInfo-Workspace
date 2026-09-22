import { describe, expect, it } from 'vitest';
import { ownedSrcsReleasedBy } from '../../src/core/md/imageRefs';
import { bulkDeleteNodes, commitImage, deleteSubtree, moveNode } from '../../src/core/tree/operations';
import { folderNode, imageNode, stateWith } from '../support/mdFixtures';

const OWNED = 'user/images/WorldInfoWorkspace/';
const isOwned = (src: string): boolean => src.startsWith(OWNED);

function state() {
    return stateWith([
        imageNode('a', 'A', `${OWNED}a.png`),
        imageNode('a-copy', 'A copy', `${OWNED}a.png`),
        imageNode('b', 'B', `${OWNED}b.png`),
        imageNode('ext', 'Ext', 'https://example.org/x.png'),
        folderNode('f', 'F', [imageNode('c', 'C', `${OWNED}c.png`)]),
    ]);
}

describe('ownedSrcsReleasedBy (FR-024)', () => {
    it('releases the file of a deleted item that nothing else references', () => {
        const before = state();
        expect(ownedSrcsReleasedBy(before, deleteSubtree(before, 'b'), isOwned)).toEqual([`${OWNED}b.png`]);
    });

    it('keeps a file while a duplicated item still references it', () => {
        const before = state();
        const afterOne = deleteSubtree(before, 'a');
        expect(ownedSrcsReleasedBy(before, afterOne, isOwned)).toEqual([]);
        expect(ownedSrcsReleasedBy(afterOne, deleteSubtree(afterOne, 'a-copy'), isOwned)).toEqual([`${OWNED}a.png`]);
    });

    it('releases on source replacement and folder/bulk deletion, never foreign sources', () => {
        const before = state();
        expect(ownedSrcsReleasedBy(before, commitImage(before, 'b', { src: 'data:image/png;base64,AA' }), isOwned)).toEqual([
            `${OWNED}b.png`,
        ]);
        expect(ownedSrcsReleasedBy(before, bulkDeleteNodes(before, ['f', 'ext']), isOwned)).toEqual([`${OWNED}c.png`]);
    });

    it('returns nothing when the tree did not change', () => {
        const before = state();
        expect(ownedSrcsReleasedBy(before, before, isOwned)).toEqual([]);
    });
});

describe('identity-aware scanning (spec 006 R1)', () => {
    it('does not release an image that only MOVED to another folder', () => {
        const before = state();
        const after = moveNode(before, 'b', 'f');
        if (!after) {
            throw new Error('move rejected');
        }
        expect(ownedSrcsReleasedBy(before, after, isOwned)).toEqual([]);
    });

    it('still releases a deleted image when an unrelated subtree is shared', () => {
        const before = state();
        const after = deleteSubtree(before, 'b');
        expect(ownedSrcsReleasedBy(before, after, isOwned)).toEqual([`${OWNED}b.png`]);
    });

    it('keeps a file that a second item still references', () => {
        const before = state();
        const after = deleteSubtree(before, 'a');
        expect(ownedSrcsReleasedBy(before, after, isOwned)).toEqual([]);
    });

    it('returns nothing when an edit touches no images at all', () => {
        const before = state();
        const after = commitImage(before, 'ext', { caption: 'changed' });
        expect(ownedSrcsReleasedBy(before, after, isOwned)).toEqual([]);
    });
});
