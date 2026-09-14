import { describe, expect, it } from 'vitest';
import { createDefaultState, createEntryNode, createFolderNode, findNode } from '../../src/core/state/schema';
import { commitEntryField } from '../../src/core/tree/operations';

function stateWithSyncedEntry() {
    const state = createDefaultState();
    const root = createFolderNode({ id: 'R', parentId: state.root.id, name: 'Root', now: '2026-09-08T00:00:00.000Z' });
    root.isWiRoot = true;
    root.book = { bookName: 'Book', orphans: [] };
    const entry = createEntryNode({ id: 'e1', parentId: 'R', name: 'E', now: '2026-09-08T00:00:00.000Z', nativeUid: 3 });
    entry.sync = {
        books: { Root: { uid: 3, hash: 'abc', status: 'in-sync' } },
    };
    root.children.push(entry);
    state.root.children.push(root);
    return state;
}

describe('field commits (US2, FR-007/FR-009)', () => {
    it('updates the native field and marks in-sync entities dirty', () => {
        const state = stateWithSyncedEntry();
        const next = commitEntryField(state, 'e1', 'content', 'new text');
        const entry = findNode(next, 'e1');
        if (entry?.kind !== 'entry') {
            throw new Error('expected entry');
        }
        expect(entry.native.content).toBe('new text');
        expect(entry.sync.books['Root']?.status).toBe('dirty');
        expect(entry.updatedAt > '2026-09-08T00:00:00.000Z').toBe(true);
    });

    it('keeps comment and name as one value on commit', () => {
        const state = stateWithSyncedEntry();
        const next = commitEntryField(state, 'e1', 'comment', 'Renamed');
        const entry = findNode(next, 'e1');
        expect(entry?.name).toBe('Renamed');
        expect(entry?.kind === 'entry' && entry.native.comment).toBe('Renamed');
        expect(entry?.kind === 'entry' && entry.sync.books['Root']?.status).toBe('dirty');
    });

    it('rapid successive commits coalesce to the final value', () => {
        let state = stateWithSyncedEntry();
        state = commitEntryField(state, 'e1', 'content', 'one');
        state = commitEntryField(state, 'e1', 'content', 'two');
        state = commitEntryField(state, 'e1', 'content', 'three');
        const entry = findNode(state, 'e1');
        expect(entry?.kind === 'entry' && entry.native.content).toBe('three');
        expect(entry?.kind === 'entry' && entry.sync.books['Root']?.status).toBe('dirty');
    });

    it('never flips orphaned status on edit', () => {
        const state = stateWithSyncedEntry();
        const entry = findNode(state, 'e1');
        if (entry?.kind !== 'entry') {
            throw new Error('expected entry');
        }
        delete entry.sync.books['Root'];
        const next = commitEntryField(state, 'e1', 'content', 'edit');
        const after = findNode(next, 'e1');
        expect(after?.kind === 'entry' && Object.keys(after.sync.books)).toEqual([]);
        expect(after?.kind === 'entry' && after.native.content).toBe('edit');
        expect(after?.kind === 'entry' && after.native.content).toBe('edit');
    });
});
