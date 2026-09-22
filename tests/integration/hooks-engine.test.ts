// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEntryNode, createFolderNode } from '../../src/core/state/schema';
import { commitEntryField } from '../../src/core/tree/operations';
import { fingerprintEntry } from '../../src/core/sync/fingerprint';
import { buildRig, type Rig } from '../support/fakeHost';
import { WI_EVENTS, type BookPushedPayload, type RootChangedPayload } from '../../src/core/hooks/events';

/**
 * Public book-push and root-designation hooks against the REAL sync engine
 * (spec 006 contracts/hooks.md, FR-007/FR-009). Emission lives at the engine's
 * terminal paths and inside its five root-lifecycle methods, so every caller —
 * the UI toggle, the markdown restore and the delete flow alike — produces
 * exactly one event.
 */

const NOW = '2026-09-08T00:00:00.000Z';

function pushes(rig: Rig): BookPushedPayload[] {
    return rig.events
        .filter((item) => item.event === WI_EVENTS.bookPushed)
        .map((item) => item.payload as BookPushedPayload);
}

function roots(rig: Rig): RootChangedPayload[] {
    return rig.events
        .filter((item) => item.event === WI_EVENTS.rootChanged)
        .map((item) => item.payload as RootChangedPayload);
}

function seedSyncedRoot(rig: Rig, bookName = 'Book'): string {
    const state = rig.store.getState();
    const root = createFolderNode({ id: 'R', parentId: state.root.id, name: 'Root', now: NOW });
    root.isWiRoot = true;
    root.book = { bookName, orphans: [], tombstones: [] };
    const entry = createEntryNode({ id: 'e1', parentId: 'R', name: 'Alpha', now: NOW, nativeUid: 5 });
    entry.sync = {
        books: { [bookName]: { uid: 5, hash: fingerprintEntry(entry.native), status: 'in-sync' } },
    };
    root.children.push(entry);
    rig.store.update((draft) => {
        draft.root.children.push(root);
    });
    rig.host.books.set(bookName, { entries: { '5': structuredClone(entry.native) } });
    void rig.host.updateWorldInfoList();
    return bookName;
}

let rig: Rig;

beforeEach(() => {
    vi.useFakeTimers();
    rig = buildRig();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('wi-workspace:book-pushed', () => {
    it('announces a successful push once, with counts', async () => {
        const bookName = seedSyncedRoot(rig);
        rig.store.replace(commitEntryField(rig.store.getState(), 'e1', 'content', 'edited'));
        await rig.engine.pushPendingNow('test');

        const emitted = pushes(rig);
        expect(emitted).toHaveLength(1);
        expect(emitted[0]?.bookName).toBe(bookName);
        expect(emitted[0]?.rootId).toBe('R');
        expect(emitted[0]?.outcome).toBe('success');
        expect(emitted[0]?.exported).toBe(1);
        expect(emitted[0]?.skipped).toEqual([]);
    });

    it('announces a failed save without claiming success', async () => {
        seedSyncedRoot(rig);
        rig.store.replace(commitEntryField(rig.store.getState(), 'e1', 'content', 'edited'));
        rig.host.offline = true;
        await rig.engine.pushPendingNow('test');

        const emitted = pushes(rig);
        expect(emitted).toHaveLength(1);
        expect(emitted[0]?.outcome).toBe('save-failed');
        expect(emitted[0]?.reason).toContain('NetworkError');
    });

    it('carries no entry content', async () => {
        seedSyncedRoot(rig);
        rig.store.replace(
            commitEntryField(rig.store.getState(), 'e1', 'content', 'secret lore text')
        );
        await rig.engine.pushPendingNow('test');
        expect(JSON.stringify(pushes(rig))).not.toContain('secret lore text');
    });
});

describe('wi-workspace:root-changed', () => {
    it('announces designation once, with the resolved book name', async () => {
        const state = rig.store.getState();
        rig.store.update((draft) => {
            draft.root.children.push(
                createFolderNode({ id: 'F', parentId: state.root.id, name: 'Lore', now: NOW })
            );
        });
        await rig.engine.designateRoot('F', 'create');

        const emitted = roots(rig);
        expect(emitted).toHaveLength(1);
        expect(emitted[0]?.folderId).toBe('F');
        expect(emitted[0]?.folderName).toBe('Lore');
        expect(emitted[0]?.action).toBe('designated');
        expect(typeof emitted[0]?.bookName).toBe('string');
    });

    it('announces undesignation with a null book', () => {
        seedSyncedRoot(rig);
        rig.engine.undesignateRoot('R');

        const emitted = roots(rig);
        expect(emitted).toEqual([
            { folderId: 'R', folderName: 'Root', bookName: null, action: 'undesignated' },
        ]);
    });

    it('stays silent when the folder is already a root', async () => {
        seedSyncedRoot(rig);
        await rig.engine.designateRoot('R', 'create');
        expect(roots(rig)).toEqual([]);
    });

    it('stays silent when the folder does not exist', () => {
        rig.engine.undesignateRoot('nope');
        expect(roots(rig)).toEqual([]);
    });
});
