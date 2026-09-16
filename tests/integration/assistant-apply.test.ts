// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyDeletion, applyProposals, undoAppliedBatch } from '../../src/adapters/assistantApply';
import { parseReply } from '../../src/core/assistant/parser';
import { buildHandleMap } from '../../src/core/assistant/handles';
import { toProposals } from '../../src/core/assistant/validate';
import { resolveScope } from '../../src/core/assistant/scope';
import { createFolderNode, createEntryNode, findNode } from '../../src/core/state/schema';
import type { ProposalBatch } from '../../src/core/assistant/types';
import { buildRig, type Rig } from '../support/fakeHost';

/**
 * Accepted proposals must reach the tree and the native books exactly like a
 * manual edit (spec 005 FR-011, FR-028, FR-036) — verified against the real sync
 * engine on the Phase 1 host fake.
 */

const NOW = '2026-09-15T12:00:00.000Z';

function seedRoot(rig: Rig): void {
    const state = rig.store.getState();
    const root = createFolderNode({ id: 'R', parentId: state.root.id, name: 'Aldermeer', now: NOW });
    root.isWiRoot = true;
    root.book = { bookName: 'Book', orphans: [], tombstones: [] };
    const entry = createEntryNode({ id: 'e-bristle', parentId: 'R', name: 'Bristlemark', now: NOW, nativeUid: 5 });
    entry.native.key = ['bristlemark', 'harbor'];
    entry.native.content = 'Capital of Aldermeer on the Lira. The harbor never sleeps. Sells charcoal.';
    entry.sync.books['Book'] = { uid: 5, hash: null, status: 'dirty' };
    root.children.push(entry);
    state.root.children.push(root);
    rig.store.replace(state);
    rig.engine.refreshStructure();
    rig.host.books.set('Book', { entries: {} });
    rig.host.world_names = ['Book'];
}

function batchFrom(rig: Rig, reply: string): ProposalBatch {
    const state = rig.store.getState();
    const map = buildHandleMap(state);
    const scope = resolveScope(state, { kind: 'workspace' }, []);
    let counter = 0;
    const parsed = parseReply(reply, { final: true });
    return {
        id: 'batch-1',
        proposals: toProposals(parsed.blocks, {
            state,
            snapshot: { handles: map.handles, scopeNodeIds: [...scope.nodeIds] },
            newProposalId: () => `p${String((counter += 1))}`,
        }),
        unparsed: parsed.unparsed,
        applied: [],
    };
}

function deps(rig: Rig, events: Array<{ event: string; payload: unknown }>) {
    let ids = 0;
    return {
        store: rig.store,
        sync: rig.engine,
        newId: () => `new-${String((ids += 1))}`,
        now: () => NOW,
        emit: (event: string, payload: unknown) => events.push({ event, payload }),
    };
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('applying entry proposals', () => {
    it('creates an entry that reaches the native book after the push', async () => {
        const rig = buildRig();
        seedRoot(rig);
        const events: Array<{ event: string; payload: unknown }> = [];
        const batch = batchFrom(
            rig,
            '<op type="create_entry" parent="f1"><title>The Salty Keel</title><keys>keel, tavern</keys><content>Ale and stew.</content><fields>order=120</fields></op>'
        );
        const result = applyProposals(deps(rig, events), { conversationId: 'c1' }, batch, [
            batch.proposals[0]?.id ?? '',
        ]);
        expect(result.outcomes[0]).toMatchObject({ status: 'applied' });
        const created = findNode(rig.store.getState(), result.outcomes[0]?.status === 'applied' ? result.outcomes[0].nodeId : '');
        expect(created).toMatchObject({ kind: 'entry', name: 'The Salty Keel' });
        expect(created?.kind === 'entry' && created.native.key).toEqual(['keel', 'tavern']);
        expect(created?.kind === 'entry' && created.native.order).toBe(120);

        await rig.advanceTimers();
        const book = rig.host.books.get('Book');
        const entries = Object.values(book?.entries ?? {});
        expect(entries.map((entry) => entry.comment)).toContain('The Salty Keel');
        expect(entries.find((entry) => entry.comment === 'The Salty Keel')?.content).toBe('Ale and stew.');
    });

    it('applies only the accepted proposals', async () => {
        const rig = buildRig();
        seedRoot(rig);
        const events: Array<{ event: string; payload: unknown }> = [];
        const batch = batchFrom(
            rig,
            [
                '<op type="create_entry" parent="f1"><title>Kept</title><content>a</content></op>',
                '<op type="create_entry" parent="f1"><title>Denied</title><content>b</content></op>',
            ].join('\n')
        );
        applyProposals(deps(rig, events), { conversationId: 'c1' }, batch, [batch.proposals[0]?.id ?? '']);
        const names = rig.store.getState().root.children[0];
        expect(names?.kind === 'folder' && names.children.map((child) => child.name)).toEqual([
            'Bristlemark',
            'Kept',
        ]);
    });

    it('edits only the fields of the proposal and marks the book dirty', async () => {
        const rig = buildRig();
        seedRoot(rig);
        const events: Array<{ event: string; payload: unknown }> = [];
        const batch = batchFrom(
            rig,
            '<op type="edit_entry" id="e1"><content>Capital of Aldermeer on the Lira. The harbor never sleeps.</content></op>'
        );
        applyProposals(deps(rig, events), { conversationId: 'c1' }, batch, [batch.proposals[0]?.id ?? '']);
        const entry = findNode(rig.store.getState(), 'e-bristle');
        expect(entry?.kind === 'entry' && entry.native.content).not.toContain('charcoal');
        expect(entry?.kind === 'entry' && entry.native.key).toEqual(['bristlemark', 'harbor']);
        await rig.advanceTimers();
        expect(rig.host.books.get('Book')?.entries['5']?.content).not.toContain('charcoal');
    });

    it('prefers the user-edited values over the model values', () => {
        const rig = buildRig();
        seedRoot(rig);
        const events: Array<{ event: string; payload: unknown }> = [];
        const batch = batchFrom(
            rig,
            '<op type="create_entry" parent="f1"><title>Model title</title><content>model text</content></op>'
        );
        const proposal = batch.proposals[0];
        if (!proposal) {
            throw new Error('no proposal');
        }
        proposal.userEdited = { title: 'My title', content: 'my text' };
        const result = applyProposals(deps(rig, events), { conversationId: 'c1' }, batch, [proposal.id]);
        const nodeId = result.outcomes[0]?.status === 'applied' ? result.outcomes[0].nodeId : '';
        const created = findNode(rig.store.getState(), nodeId);
        expect(created?.name).toBe('My title');
        expect(created?.kind === 'entry' && created.native.content).toBe('my text');
    });

    it('refuses a stale proposal instead of overwriting a manual edit', () => {
        const rig = buildRig();
        seedRoot(rig);
        const events: Array<{ event: string; payload: unknown }> = [];
        const batch = batchFrom(rig, '<op type="edit_entry" id="e1"><content>assistant text</content></op>');
        // The user edits the same entry after the proposal was made.
        rig.store.update((draft) => {
            const root = draft.root.children[0];
            const entry = root?.kind === 'folder' ? root.children[0] : undefined;
            if (entry?.kind === 'entry') {
                entry.native.content = 'user text';
                entry.updatedAt = '2026-09-15T13:00:00.000Z';
            }
        });
        const result = applyProposals(deps(rig, events), { conversationId: 'c1' }, batch, [
            batch.proposals[0]?.id ?? '',
        ]);
        expect(result.outcomes[0]).toEqual({
            proposalId: batch.proposals[0]?.id,
            status: 'stale',
            reason: 'changed',
        });
        const entry = findNode(rig.store.getState(), 'e-bristle');
        expect(entry?.kind === 'entry' && entry.native.content).toBe('user text');
        expect(events).toEqual([]);
    });

    it('emits the applied hook with the contract payload', () => {
        const rig = buildRig();
        seedRoot(rig);
        const events: Array<{ event: string; payload: unknown }> = [];
        const batch = batchFrom(
            rig,
            '<op type="create_entry" parent="f1"><title>Hooked</title><content>x</content></op>'
        );
        applyProposals(deps(rig, events), { conversationId: 'conv-7' }, batch, [
            batch.proposals[0]?.id ?? '',
        ]);
        expect(events).toHaveLength(1);
        expect(events[0]?.event).toBe('wi-workspace:assistant-applied');
        expect(events[0]?.payload).toMatchObject({
            conversationId: 'conv-7',
            operations: [{ op: 'create_entry', name: 'Hooked' }],
        });
    });

    it('records undo information for creations and edits', () => {
        const rig = buildRig();
        seedRoot(rig);
        const events: Array<{ event: string; payload: unknown }> = [];
        const batch = batchFrom(
            rig,
            [
                '<op type="create_entry" parent="f1"><title>Fresh</title><content>new</content></op>',
                '<op type="edit_entry" id="e1"><keys>bristlemark, harbor, docks</keys></op>',
            ].join('\n')
        );
        const result = applyProposals(
            deps(rig, events),
            { conversationId: 'c1' },
            batch,
            batch.proposals.map((proposal) => proposal.id)
        );
        expect(result.batch.items).toHaveLength(2);
        expect(result.batch.items[0]?.inverse).toEqual({ kind: 'delete-created' });
        expect(result.batch.items[1]?.inverse).toMatchObject({
            kind: 'restore-fields',
            native: { key: ['bristlemark', 'harbor'] },
        });
        expect(result.batch.items[1]?.afterUpdatedAt).toBeDefined();
    });
});

describe('structure operations, deletions and undo (US2)', () => {
    function seedTwoFolders(rig: Rig): void {
        seedRoot(rig);
        const state = rig.store.getState();
        const root = state.root.children[0];
        if (root?.kind !== 'folder') {
            throw new Error('seed failed');
        }
        root.children.push(createFolderNode({ id: 'F-hearth', parentId: 'R', name: 'Hearth', now: NOW }));
        rig.store.replace(state);
        rig.engine.refreshStructure();
    }

    it('creates a folder and moves an entry into it in one accept-all order', async () => {
        const rig = buildRig();
        seedTwoFolders(rig);
        const events: Array<{ event: string; payload: unknown }> = [];
        const batch = batchFrom(
            rig,
            [
                '<op type="create_folder" parent="f2" ref="new1"><title>Cities</title></op>',
                '<op type="move" id="e1" parent="new1"></op>',
            ].join('\n')
        );
        const result = applyProposals(
            deps(rig, events),
            { conversationId: 'c1' },
            batch,
            batch.proposals.map((proposal) => proposal.id)
        );
        expect(result.outcomes.map((outcome) => outcome.status)).toEqual(['applied', 'applied']);
        const moved = findNode(rig.store.getState(), 'e-bristle');
        const parent = moved?.parentId ? findNode(rig.store.getState(), moved.parentId) : undefined;
        expect(parent?.name).toBe('Cities');
        expect(result.batch.items[1]?.inverse).toEqual({ kind: 'restore-position', parentId: 'R', index: 0 });
    });

    it('undoes a new folder together with the items the same batch moved into it (live run 2026-09-16)', () => {
        const rig = buildRig();
        seedTwoFolders(rig);
        const events: Array<{ event: string; payload: unknown }> = [];
        const batch = batchFrom(
            rig,
            [
                '<op type="create_folder" parent="f2" ref="new1"><title>Taverns</title></op>',
                '<op type="move" id="e1" parent="new1"></op>',
            ].join('\n')
        );
        // A real clock: every change gets its own timestamp.
        let tick = Date.parse(NOW);
        const clocked = { ...deps(rig, events), now: () => new Date((tick += 1000)).toISOString() };
        const result = applyProposals(clocked, { conversationId: 'c1' }, batch, batch.proposals.map((proposal) => proposal.id));
        const folderId = result.batch.items[0]?.nodeId ?? '';
        const undone = undoAppliedBatch(clocked, { conversationId: 'c1' }, result.batch);
        expect(undone.skipped).toEqual([]);
        expect(findNode(rig.store.getState(), folderId)).toBeUndefined();
        expect(findNode(rig.store.getState(), 'e-bristle')?.parentId).toBe('R');
    });

    it('puts an entry into a folder accepted by an earlier click (live run 2026-09-16)', () => {
        const rig = buildRig();
        seedTwoFolders(rig);
        const events: Array<{ event: string; payload: unknown }> = [];
        const batch = batchFrom(
            rig,
            [
                '<op type="create_folder" parent="f2" ref="new1"><title>Magic</title></op>',
                '<op type="create_entry" parent="new1"><title>Mirror magic</title><content>a</content></op>',
            ].join('\n')
        );
        const applyDeps = deps(rig, events);
        const [folder, entry] = batch.proposals;
        // Entry first: its folder does not exist yet, and the reason says what to do.
        const early = applyProposals(applyDeps, { conversationId: 'c1' }, batch, [entry?.id ?? '']);
        expect(early.outcomes[0]).toMatchObject({ status: 'failed' });
        expect(early.outcomes[0]).toHaveProperty('reason', expect.stringContaining('Magic'));
        if (entry) {
            entry.decision = 'failed';
        }

        const first = applyProposals(applyDeps, { conversationId: 'c1' }, batch, [folder?.id ?? '']);
        batch.applied.push(first.batch);
        if (folder) {
            folder.decision = 'applied';
        }
        // Retrying the failed entry now lands it inside the new folder.
        const second = applyProposals(applyDeps, { conversationId: 'c1' }, batch, [entry?.id ?? '']);
        expect(second.outcomes[0]).toMatchObject({ status: 'applied' });
        const created = findNode(rig.store.getState(), second.batch.items[0]?.nodeId ?? '');
        expect(created?.parentId).toBe(first.batch.items[0]?.nodeId);
    });

    it('renames an entry and keeps its native copy in sync', async () => {
        const rig = buildRig();
        seedRoot(rig);
        const events: Array<{ event: string; payload: unknown }> = [];
        const batch = batchFrom(rig, '<op type="rename" id="e1"><title>Bristlemark Harbor</title></op>');
        applyProposals(deps(rig, events), { conversationId: 'c1' }, batch, [batch.proposals[0]?.id ?? '']);
        await rig.advanceTimers();
        expect(findNode(rig.store.getState(), 'e-bristle')?.name).toBe('Bristlemark Harbor');
        expect(rig.host.books.get('Book')?.entries['5']?.comment).toBe('Bristlemark Harbor');
    });

    it('deletes through the shared delete path with tombstones, and undo re-inserts it', async () => {
        const rig = buildRig();
        seedRoot(rig);
        await rig.advanceTimers();
        expect(rig.host.books.get('Book')?.entries['5']).toBeDefined();
        const events: Array<{ event: string; payload: unknown }> = [];
        const batch = batchFrom(rig, '<op type="delete" id="e1"></op>');
        const confirmations: string[] = [];
        const result = await applyDeletion(
            {
                ...deps(rig, events),
                confirm: async (message: string) => {
                    confirmations.push(message);
                    return true;
                },
            },
            { conversationId: 'c1' },
            batch,
            batch.proposals[0]?.id ?? ''
        );
        expect(result.outcomes[0]?.status).toBe('applied');
        expect(confirmations[0]).toContain('Delete "Bristlemark"');
        expect(confirmations[0]).toContain('native book "Book"');
        expect(findNode(rig.store.getState(), 'e-bristle')).toBeUndefined();
        await rig.advanceTimers();
        expect(rig.host.books.get('Book')?.entries['5']).toBeUndefined();

        const undone = undoAppliedBatch(deps(rig, events), { conversationId: 'c1' }, result.batch);
        expect(undone.reverted).toEqual(['e-bristle']);
        expect(findNode(rig.store.getState(), 'e-bristle')?.name).toBe('Bristlemark');
        expect(events.map((item) => item.event)).toEqual([
            'wi-workspace:assistant-applied',
            'wi-workspace:assistant-undone',
        ]);
    });

    it('does not delete when the confirmation is declined', async () => {
        const rig = buildRig();
        seedRoot(rig);
        const events: Array<{ event: string; payload: unknown }> = [];
        const batch = batchFrom(rig, '<op type="delete" id="e1"></op>');
        const result = await applyDeletion(
            { ...deps(rig, events), confirm: async () => false },
            { conversationId: 'c1' },
            batch,
            batch.proposals[0]?.id ?? ''
        );
        expect(result.outcomes[0]).toMatchObject({ status: 'failed' });
        expect(findNode(rig.store.getState(), 'e-bristle')).toBeDefined();
        expect(events).toEqual([]);
    });

    it('undo reverts untouched items and skips the one edited since', () => {
        const rig = buildRig();
        seedRoot(rig);
        const events: Array<{ event: string; payload: unknown }> = [];
        const batch = batchFrom(
            rig,
            [
                '<op type="create_entry" parent="f1"><title>Fresh A</title><content>a</content></op>',
                '<op type="create_entry" parent="f1"><title>Fresh B</title><content>b</content></op>',
                '<op type="edit_entry" id="e1"><content>Capital of Aldermeer on the Lira. The harbor never sleeps. Sells charcoal and rope.</content></op>',
            ].join('\n')
        );
        const result = applyProposals(
            deps(rig, events),
            { conversationId: 'c1' },
            batch,
            batch.proposals.map((proposal) => proposal.id)
        );
        const freshB = result.batch.items[1]?.nodeId ?? '';
        // The user edits "Fresh B" after the batch landed.
        rig.store.update((draft) => {
            const node = findNode(draft, freshB);
            if (node) {
                node.name = 'Fresh B (mine)';
                node.updatedAt = '2026-09-15T15:00:00.000Z';
            }
        });
        const undone = undoAppliedBatch(deps(rig, events), { conversationId: 'c1' }, result.batch);
        expect(undone.skipped).toEqual([
            { proposalId: batch.proposals[1]?.id, reason: 'it was edited after the batch was applied' },
        ]);
        expect(findNode(rig.store.getState(), freshB)?.name).toBe('Fresh B (mine)');
        expect(findNode(rig.store.getState(), result.batch.items[0]?.nodeId ?? '')).toBeUndefined();
        const entry = findNode(rig.store.getState(), 'e-bristle');
        expect(entry?.kind === 'entry' && entry.native.content).toBe(
            'Capital of Aldermeer on the Lira. The harbor never sleeps. Sells charcoal.'
        );
    });

    it('never applies an invalid proposal even when asked to', () => {
        const rig = buildRig();
        seedRoot(rig);
        const events: Array<{ event: string; payload: unknown }> = [];
        const batch = batchFrom(rig, '<op type="delete" id="e99"></op>');
        const result = applyProposals(deps(rig, events), { conversationId: 'c1' }, batch, [
            batch.proposals[0]?.id ?? '',
        ]);
        expect(result.outcomes[0]).toMatchObject({ status: 'failed' });
        expect(events).toEqual([]);
    });

    it('stops a batch at the first failure and reports what landed', () => {
        const rig = buildRig();
        seedRoot(rig);
        const events: Array<{ event: string; payload: unknown }> = [];
        const batch = batchFrom(
            rig,
            [
                '<op type="create_entry" parent="f1"><title>Lands</title><content>a</content></op>',
                '<op type="create_entry" parent="new9"><title>Orphan</title><content>b</content></op>',
            ].join('\n')
        );
        // Force the second proposal to look valid but reference a ref never created.
        const second = batch.proposals[1];
        if (second) {
            second.decision = 'pending';
            second.parent = { ref: 'never-created' };
            delete second.invalidReason;
        }
        const result = applyProposals(
            deps(rig, events),
            { conversationId: 'c1' },
            batch,
            batch.proposals.map((proposal) => proposal.id)
        );
        expect(result.outcomes.map((outcome) => outcome.status)).toEqual(['applied', 'failed']);
        expect(result.batch.failed).toMatchObject({ reason: 'the folder it depends on was not created' });
        expect(events[0]?.payload).toMatchObject({
            failed: { op: 'create_entry', reason: 'the folder it depends on was not created' },
        });
    });
});
