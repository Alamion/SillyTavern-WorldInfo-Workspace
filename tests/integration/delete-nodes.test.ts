// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteNodes, describeDeletion } from '../../src/adapters/workspaceActions';
import { createEntryNode, createFolderNode, findNode } from '../../src/core/state/schema';
import { buildRig, type Rig } from '../support/fakeHost';

/**
 * The single delete path shared by the tree UI and the assistant (spec 005
 * T054/T055). Guards the behavior extracted from WorkspaceApp: disclosure,
 * tombstones before the change, the root-book question, no-op on decline.
 */

const NOW = '2026-09-15T12:00:00.000Z';

function seed(rig: Rig): void {
    const state = rig.store.getState();
    const root = createFolderNode({ id: 'R', parentId: state.root.id, name: 'Aldermeer', now: NOW });
    root.isWiRoot = true;
    root.book = { bookName: 'Book', orphans: [], tombstones: [] };
    const folder = createFolderNode({ id: 'F', parentId: 'R', name: 'Cities', now: NOW });
    const entry = createEntryNode({ id: 'E', parentId: 'F', name: 'Bristlemark', now: NOW, nativeUid: 5 });
    entry.sync.books['Book'] = { uid: 5, hash: 'h', status: 'in-sync' };
    folder.children.push(entry);
    root.children.push(folder);
    state.root.children.push(root);
    rig.store.replace(state);
    rig.engine.refreshStructure();
    rig.host.books.set('Book', { entries: { '5': { ...entry.native, uid: 5 } } });
    rig.host.world_names = ['Book'];
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('describeDeletion', () => {
    it('discloses the subtree, the native book and linked files', () => {
        const rig = buildRig();
        seed(rig);
        const description = describeDeletion(rig.store.getState(), ['F'], new Set(['E']));
        expect(description.items.map((item) => item.id)).toEqual(['F', 'E']);
        expect(description.books).toEqual(['Book']);
        expect(description.linkedFiles).toBe(true);
        expect(description.message).toBe(
            'Delete "Cities" and everything inside it? This cannot be undone. Its file(s) in the linked folder will be removed.'
        );
    });

    it('names the native copy of a single synced entry', () => {
        const rig = buildRig();
        seed(rig);
        expect(describeDeletion(rig.store.getState(), ['E']).message).toContain(
            'Its copy in the native book "Book" will be removed at the next sync.'
        );
    });

    it('lists designated roots for the keep-or-delete question', () => {
        const rig = buildRig();
        seed(rig);
        expect(describeDeletion(rig.store.getState(), ['R']).roots).toEqual([
            { nodeId: 'R', bookName: 'Book' },
        ]);
    });
});

describe('deleteNodes', () => {
    it('does nothing when the user declines', async () => {
        const rig = buildRig();
        seed(rig);
        const deleted = await deleteNodes(
            { store: rig.store, sync: rig.engine, confirm: async () => false },
            ['E']
        );
        expect(deleted).toBe(false);
        expect(findNode(rig.store.getState(), 'E')).toBeDefined();
    });

    it('records tombstones and removes the native copy at the next push', async () => {
        const rig = buildRig();
        seed(rig);
        const deleted = await deleteNodes(
            { store: rig.store, sync: rig.engine, confirm: async () => true },
            ['F']
        );
        expect(deleted).toBe(true);
        expect(findNode(rig.store.getState(), 'E')).toBeUndefined();
        const root = findNode(rig.store.getState(), 'R');
        expect(root?.kind === 'folder' && root.book?.tombstones).toEqual([5]);
        await vi.advanceTimersByTimeAsync(1100);
        expect(rig.host.books.get('Book')?.entries['5']).toBeUndefined();
    });

    it('skips the generic prompt when preconfirmed but still asks about root books', async () => {
        const rig = buildRig();
        seed(rig);
        const prompts: string[] = [];
        await deleteNodes(
            {
                store: rig.store,
                sync: rig.engine,
                confirm: async (message) => {
                    prompts.push(message);
                    return false;
                },
            },
            ['R'],
            { preconfirmed: true }
        );
        expect(prompts).toEqual([
            'Also delete the native book "Book"? Cancel = keep the book file in the app.',
        ]);
        expect(findNode(rig.store.getState(), 'R')).toBeUndefined();
    });
});
