import { describe, expect, it } from 'vitest';
import { ownedSrcsReleasedBy } from '../../src/core/md/imageRefs';
import { bulkDeleteNodes, commitImage, deleteSubtree } from '../../src/core/tree/operations';
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
