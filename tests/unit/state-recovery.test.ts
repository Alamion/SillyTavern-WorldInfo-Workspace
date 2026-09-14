import { describe, expect, it } from 'vitest';
import { discardRecovered, restoreRecovered } from '../../src/adapters/settingsStore';
import {
    createDefaultState,
    createFolderNode,
    isFreshRecovery,
    migrate,
    type WorkspaceState,
} from '../../src/core/state/schema';
import { WorkspaceStore } from '../../src/core/state/store';

const NOW = '2026-09-14T00:00:00.000Z';

function populatedPayload(): Record<string, unknown> {
    const state = createDefaultState();
    state.root.children.push(createFolderNode({ id: 'f1', parentId: state.root.id, name: 'Kept', now: NOW }));
    return JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
}

describe('recovery backup lifecycle', () => {
    it('keeps a backup carried by a valid payload and does not report a fresh recovery', () => {
        const raw = { ...populatedPayload(), _recovered: { version: 99 } };
        const state = migrate(raw);
        expect(state._recovered).toEqual({ version: 99 });
        expect(isFreshRecovery(raw, state)).toBe(false);
    });

    it('reports a fresh recovery only for an invalid present payload', () => {
        const invalid = { version: 99 };
        expect(isFreshRecovery(invalid, migrate(invalid))).toBe(true);
        expect(isFreshRecovery(undefined, migrate(undefined))).toBe(false);
    });

    it('restores a backup that validates and drops the backup key', () => {
        const fallback: WorkspaceState = migrate({ version: 99 });
        fallback._recovered = populatedPayload();
        const store = new WorkspaceStore(fallback);

        expect(restoreRecovered(store)).toEqual({ ok: true });
        expect(store.getState()._recovered).toBeUndefined();
        expect(store.getState().root.children.map((child) => child.name)).toEqual(['Kept']);
    });

    it('keeps a backup that is still invalid and reports why', () => {
        const fallback = migrate({ version: 99 });
        const store = new WorkspaceStore(fallback);

        const outcome = restoreRecovered(store);
        expect(outcome.ok).toBe(false);
        expect(store.getState()._recovered).toEqual({ version: 99 });
        expect(store.getState().root.children).toEqual([]);
    });

    it('discards the backup on request', () => {
        const store = new WorkspaceStore(migrate({ version: 99 }));
        discardRecovered(store);
        expect(store.getState()._recovered).toBeUndefined();
    });
});
