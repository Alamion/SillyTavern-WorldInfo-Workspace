import { beforeEach, describe, expect, it } from 'vitest';
import {
    createDefaultState,
    createEntryNode,
    createFolderNode,
    createImageNode,
    type WorkspaceState,
} from '../../src/core/state/schema';
import { WorkspaceStore } from '../../src/core/state/store';

const NOW = '2026-09-08T00:00:00.000Z';

function freshState(): WorkspaceState {
    return createDefaultState();
}

describe('WorkspaceStore', () => {
    let store: WorkspaceStore;
    beforeEach(() => {
        store = new WorkspaceStore(freshState());
    });

    it('returns a stable snapshot reference between updates', () => {
        const first = store.getState();
        expect(store.getState()).toBe(first);
        store.update(() => {
            /* no-op mutation */
        });
        expect(store.getState()).not.toBe(first);
        const after = store.getState();
        expect(store.getState()).toBe(after);
    });

    it('gives the update recipe a mutable clone and never touches the previous state', () => {
        const before = store.getState();
        store.update((draft) => {
            draft.root.name = 'Renamed';
        });
        expect(before.root.name).not.toBe('Renamed');
        expect(store.getState().root.name).toBe('Renamed');
    });

    it('notifies subscribers after each update and stops after unsubscribe', () => {
        let calls = 0;
        const unsubscribe = store.subscribe(() => {
            calls += 1;
        });
        store.update(() => undefined);
        expect(calls).toBe(1);
        unsubscribe();
        store.update(() => undefined);
        expect(calls).toBe(1);
    });

    it('update returns the new state so recipes can report results', () => {
        const next = store.update((draft) => {
            draft.settings.sortMode = 'title';
        });
        expect(next.settings.sortMode).toBe('title');
        expect(store.getState().settings.sortMode).toBe('title');
    });

    it('supports node CRUD through recipes', () => {
        const next = store.update((draft) => {
            const folder = createFolderNode({ id: 'f1', parentId: draft.root.id, name: 'F', now: NOW });
            draft.root.children.push(folder);
            folder.children.push(
                createEntryNode({ id: 'e1', parentId: folder.id, name: 'E', now: NOW, nativeUid: 1 })
            );
            folder.children.push(createImageNode({ id: 'i1', parentId: folder.id, name: 'M', now: NOW }));
        });
        expect(next.root.children).toHaveLength(1);
        const folder = next.root.children[0];
        if (folder?.kind === 'folder') {
            expect(folder.children).toHaveLength(2);
        } else {
            expect.unreachable('expected a folder node');
        }
    });

    it('mutations never leak into state passed in at construction', () => {
        const initial = freshState();
        const store2 = new WorkspaceStore(initial);
        store2.update((draft) => {
            draft.root.children.push(
                createFolderNode({ id: 'x', parentId: draft.root.id, name: 'X', now: NOW })
            );
        });
        expect(initial.root.children).toHaveLength(0);
    });
});