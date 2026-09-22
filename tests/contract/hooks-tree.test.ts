import { describe, expect, it } from 'vitest';

import { WI_EVENTS } from '../../src/core/hooks/events';
import { diffTree } from '../../src/core/hooks/treeDiff';
import { createHookEmitter } from '../../src/adapters/hooks';
import type { SillyTavernContext } from '../../src/global';
import { WorkspaceStore } from '../../src/core/state/store';
import {
    bulkSetDisable,
    commitEntryField,
    createChild,
    deleteSubtree,
    moveNode,
    renameNode,
    setExpanded,
} from '../../src/core/tree/operations';
import { entryNode, folderNode, imageNode, stateWith } from '../support/mdFixtures';

/**
 * Public tree hook (constitution VII, spec 006 contracts/hooks.md):
 * `wi-workspace:tree-changed` { changes: [{ change, node }] }.
 *
 * The payload is derived by diffing two published states, because
 * `applyTreeChange` is NOT the universal funnel — nine UI routes, markdown
 * import and every native-sync mutation bypass it, and FR-009 demands exactly
 * one event per occurrence regardless of route.
 */

function base() {
    return stateWith([
        folderNode('f', 'Folder', [entryNode('a', 'A', { content: 'alpha' })]),
        entryNode('b', 'B', { content: 'beta' }),
        imageNode('i', 'I', 'user/images/WorldInfoWorkspace/i.png'),
    ]);
}

describe('wi-workspace:tree-changed payloads', () => {
    it('reports a create with the documented node shape', () => {
        const before = base();
        const after = createChild(before, 'f', 'entry', 'New', () => 'new-1');
        if (!after) {
            throw new Error('create rejected');
        }
        const changes = diffTree(before, after);
        expect(changes).toEqual([
            {
                change: 'create',
                node: {
                    nodeId: 'new-1',
                    kind: 'entry',
                    name: 'New',
                    parentId: 'f',
                    bookName: null,
                },
            },
        ]);
    });

    it('reports a rename', () => {
        const before = base();
        const after = renameNode(before, 'b', 'Renamed');
        if (!after) {
            throw new Error('rename rejected');
        }
        const changes = diffTree(before, after);
        expect(changes.map((change) => change.change)).toEqual(['rename', 'update']);
        expect(changes[0]?.node.nodeId).toBe('b');
        expect(changes[0]?.node.name).toBe('Renamed');
    });

    it('reports a move with the new parent', () => {
        const before = base();
        const after = moveNode(before, 'b', 'f');
        if (!after) {
            throw new Error('move rejected');
        }
        const changes = diffTree(before, after);
        expect(changes).toEqual([
            {
                change: 'move',
                node: { nodeId: 'b', kind: 'entry', name: 'B', parentId: 'f', bookName: null },
            },
        ]);
    });

    it('reports a delete', () => {
        const before = base();
        const after = deleteSubtree(before, 'b');
        const changes = diffTree(before, after);
        expect(changes).toEqual([
            {
                change: 'delete',
                node: {
                    nodeId: 'b',
                    kind: 'entry',
                    name: 'B',
                    parentId: 'workspace-root',
                    bookName: null,
                },
            },
        ]);
    });

    it('reports a content update', () => {
        const before = base();
        const after = commitEntryField(before, 'a', 'content', 'changed');
        const changes = diffTree(before, after);
        expect(changes).toEqual([
            {
                change: 'update',
                node: { nodeId: 'a', kind: 'entry', name: 'A', parentId: 'f', bookName: null },
            },
        ]);
    });

    it('reports one change per affected node for a bulk action', () => {
        const before = base();
        const after = bulkSetDisable(before, ['a', 'b'], true);
        const changes = diffTree(before, after);
        expect(changes).toHaveLength(2);
        expect(changes.every((change) => change.change === 'update')).toBe(true);
        expect(changes.map((change) => change.node.nodeId).sort()).toEqual(['a', 'b']);
    });

    it('carries the nearest World Info book name', () => {
        const before = stateWith([folderNode('root-f', 'Book', [entryNode('x', 'X', {})])]);
        const withBook = structuredClone(before);
        const folder = withBook.root.children[0];
        if (folder?.kind !== 'folder') {
            throw new Error('fixture changed');
        }
        folder.isWiRoot = true;
        folder.book = { bookName: 'My Book', orphans: [] };
        const after = commitEntryField(withBook, 'x', 'content', 'lore');
        const changes = diffTree(withBook, after);
        expect(changes[0]?.node.bookName).toBe('My Book');
    });
});

describe('wi-workspace:tree-changed does not fire for bookkeeping', () => {
    it('ignores an identical state', () => {
        const state = base();
        expect(diffTree(state, state)).toEqual([]);
    });

    it('ignores folder expand/collapse', () => {
        const before = base();
        const after = setExpanded(before, 'f', true);
        expect(diffTree(before, after)).toEqual([]);
    });

    it('ignores sync status and hash changes', () => {
        const before = base();
        const after = structuredClone(before);
        const folder = after.root.children[0];
        const node = folder?.kind === 'folder' ? folder.children[0] : undefined;
        if (node?.kind !== 'entry') {
            throw new Error('fixture changed');
        }
        node.sync.books['Book'] = { uid: 4, hash: 'deadbeef', status: 'in-sync' };
        expect(diffTree(before, after)).toEqual([]);
    });

    it('ignores the uid assigned by a push', () => {
        const before = base();
        const after = structuredClone(before);
        const folder = after.root.children[0];
        const node = folder?.kind === 'folder' ? folder.children[0] : undefined;
        if (node?.kind !== 'entry') {
            throw new Error('fixture changed');
        }
        node.native = { ...node.native, uid: 77, displayIndex: 3 };
        expect(diffTree(before, after)).toEqual([]);
    });

    it('ignores settings-only changes', () => {
        const before = base();
        const after = { ...before, settings: { ...before.settings, sortMode: 'title' as const } };
        expect(diffTree(before, after)).toEqual([]);
    });
});

describe('tree-changed payloads carry no content', () => {
    it('never includes entry text, only identity', () => {
        const before = base();
        const after = commitEntryField(before, 'a', 'content', 'secret lore text');
        const payload = JSON.stringify({ changes: diffTree(before, after) });
        expect(payload).not.toContain('secret lore text');
        expect(payload).not.toContain('alpha');
    });
});

describe('hook emitter containment (FR-010)', () => {
    function ctxWith(emit: () => Promise<void>): SillyTavernContext {
        return { eventSource: { emit } } as unknown as SillyTavernContext;
    }

    it('does not await the host, so a slow subscriber cannot block', () => {
        let resolved = false;
        const emitter = createHookEmitter(
            ctxWith(
                () =>
                    new Promise<void>((resolve) => {
                        setTimeout(() => {
                            resolved = true;
                            resolve();
                        }, 50);
                    })
            )
        );
        emitter(WI_EVENTS.treeChanged, { changes: [] });
        // Returned before the subscriber finished.
        expect(resolved).toBe(false);
    });

    it('contains a synchronous throw', () => {
        const emitter = createHookEmitter(
            ctxWith(() => {
                throw new Error('subscriber exploded');
            })
        );
        expect(() => emitter(WI_EVENTS.treeChanged, { changes: [] })).not.toThrow();
    });

    it('contains a rejected promise instead of leaking an unhandled rejection', async () => {
        const unhandled: unknown[] = [];
        const onUnhandled = (event: PromiseRejectionEvent): void => {
            unhandled.push(event.reason);
        };
        process.on('unhandledRejection', onUnhandled as unknown as NodeJS.UnhandledRejectionListener);
        try {
            const emitter = createHookEmitter(ctxWith(() => Promise.reject(new Error('nope'))));
            expect(() => emitter(WI_EVENTS.treeChanged, { changes: [] })).not.toThrow();
            // Let the microtask queue drain so an unhandled rejection would surface.
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(unhandled).toEqual([]);
        } finally {
            process.off('unhandledRejection', onUnhandled as unknown as NodeJS.UnhandledRejectionListener);
        }
    });
});

describe('store-level derivation covers routes that bypass applyTreeChange', () => {
    it('sees a raw store.replace, which the UI uses for most edits', () => {
        const store = new WorkspaceStore(base());
        const before = store.getState();
        // WorkspaceApp.applyOperation does exactly this — no applyTreeChange.
        store.replace(commitEntryField(before, 'a', 'content', 'edited'));
        expect(diffTree(before, store.getState())).toHaveLength(1);
    });

    it('sees a store.update draft, which the sync engine and import use', () => {
        const store = new WorkspaceStore(base());
        const before = store.getState();
        store.update((draft) => {
            draft.root.children.push(
                entryNode('imported', 'Imported', { content: 'from a book' })
            );
        });
        const changes = diffTree(before, store.getState());
        expect(changes).toEqual([
            {
                change: 'create',
                node: {
                    nodeId: 'imported',
                    kind: 'entry',
                    name: 'Imported',
                    parentId: 'workspace-root',
                    bookName: null,
                },
            },
        ]);
    });
});

describe('documented surface matches the emitted surface (SC-010)', () => {
    it('every event name the code can emit is declared in WI_EVENTS', async () => {
        const sources = [
            'src/adapters/settingsStore.ts',
            'src/adapters/syncEngine.ts',
            'src/adapters/mdLink.ts',
            'src/adapters/assistantApply.ts',
            'src/index.ts',
        ];
        const declared = new Set<string>(Object.values(WI_EVENTS));
        const fs = await import('node:fs/promises');
        const found = new Set<string>();
        for (const file of sources) {
            const text = await fs.readFile(new URL(`../../${file}`, import.meta.url), 'utf8');
            for (const match of text.matchAll(/'(wi-workspace:[a-z-]+)'/g)) {
                found.add(match[1]!);
            }
        }
        for (const name of found) {
            expect(declared).toContain(name);
        }
    });

    it('declares exactly the events documented in contracts/hooks.md', async () => {
        const fs = await import('node:fs/promises');
        const doc = await fs.readFile(
            new URL('../../specs/006-hardening-interop/contracts/hooks.md', import.meta.url),
            'utf8'
        );
        const documented = new Set(
            [...doc.matchAll(/`(wi-workspace:[a-z-]+)`/g)].map((match) => match[1]!)
        );
        const declared = new Set<string>(Object.values(WI_EVENTS));
        expect([...declared].sort()).toEqual([...documented].sort());
    });
});
