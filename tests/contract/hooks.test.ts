import { describe, expect, it } from 'vitest';
import { createMdLink } from '../../src/adapters/mdLink';
import { applyProposals, undoAppliedBatch } from '../../src/adapters/assistantApply';
import type { OperationProposal, ProposalBatch } from '../../src/core/assistant/types';
import type { SyncEngine } from '../../src/adapters/syncEngine';
import type { DiskFolderAccess, StoredLink } from '../../src/core/md/ports';
import type { OperationReport } from '../../src/core/md/report';
import { WorkspaceStore } from '../../src/core/state/store';
import { MemoryDiskFolder, MemoryImageStore, nodeDigest, nodeYaml } from '../support/memoryDisk';
import { entryNode, stateWith } from '../support/mdFixtures';

/**
 * Public interop hooks of the markdown feature (constitution VII, AGENTS.md):
 * `wi-workspace:md-link-changed` { state, folderName } and
 * `wi-workspace:md-synced` { report: OperationReport }. Additive only.
 */
describe('wi-workspace:md-* hooks', () => {
    it('emits link state changes and sync reports with the documented payloads', async () => {
        const folder = new MemoryDiskFolder();
        let stored: StoredLink | null = null;
        const access: DiskFolderAccess = {
            isSupported: () => true,
            pick: async () => ({ folder, name: 'vault', handle: 'h' }),
            pickFiles: async () => null,
            loadLink: async () => stored,
            saveLink: async (link) => {
                stored = structuredClone(link);
            },
            clearLink: async () => {
                stored = null;
            },
            queryAccess: async () => 'granted',
            requestAccess: async () => 'granted',
            open: () => folder,
        };
        const events: Array<{ event: string; payload: unknown }> = [];
        const link = createMdLink({
            store: new WorkspaceStore(stateWith([entryNode('a', 'A', { content: 'x' })])),
            sync: { refreshStructure: () => undefined, recordEntityDeletions: () => undefined, markBooksDirty: () => undefined } as unknown as SyncEngine,
            access,
            imageStore: new MemoryImageStore(),
            digest: nodeDigest,
            yaml: () => nodeYaml,
            decisions: { confirmLink: async () => true, resolveConflicts: async () => new Map(), confirmDeletions: async () => true },
            resolveImage: async () => null,
            designate: async () => undefined,
            newId: () => 'id',
            emit: (event, payload) => events.push({ event, payload }),
        });

        await link.link();
        await link.unlink();

        const changed = events.filter((item) => item.event === 'wi-workspace:md-link-changed').map((item) => item.payload);
        expect(changed).toEqual([
            { state: 'linked', folderName: 'vault' },
            { state: 'none', folderName: null },
        ]);
        const synced = events.filter((item) => item.event === 'wi-workspace:md-synced');
        expect(synced).toHaveLength(1);
        const report = (synced[0]!.payload as { report: OperationReport }).report;
        expect(report.operation).toBe('link');
        expect(report.counts.created).toBe(1);
        expect(Array.isArray(report.lines)).toBe(true);
    });
});

/**
 * Assistant hooks (spec 005 contracts/hooks.md, FR-036). Additive; payloads
 * carry no prompt text, model output or profile data.
 */
describe('wi-workspace:assistant-applied', () => {
    function rig() {
        const state = stateWith([entryNode('e1', 'Alpha', { content: 'first line' })]);
        const store = new WorkspaceStore(state);
        const events: Array<{ event: string; payload: unknown }> = [];
        const sync = {
            refreshStructure: () => undefined,
            recordEntityDeletions: () => undefined,
            markBooksDirty: () => undefined,
        } as unknown as SyncEngine;
        let ids = 0;
        return {
            store,
            events,
            deps: {
                store,
                sync,
                newId: () => `n${String((ids += 1))}`,
                now: () => '2026-09-15T12:00:00.000Z',
                emit: (event: string, payload: unknown) => events.push({ event, payload }),
            },
        };
    }

    function batch(proposals: OperationProposal[]): ProposalBatch {
        return { id: 'b1', proposals, unparsed: [], applied: [] };
    }

    it('emits conversationId, batchId and one summary per applied operation', () => {
        const { store, events, deps } = rig();
        const proposal: OperationProposal = {
            id: 'p1',
            op: 'create_entry',
            parent: { nodeId: store.getState().root.id },
            values: { title: 'Beta', content: 'text' },
            dependsOn: [],
            destructive: false,
            decision: 'pending',
            summary: 'Create entry "Beta"',
        };
        const result = applyProposals(deps, { conversationId: 'c9' }, batch([proposal]), ['p1']);
        expect(events).toHaveLength(1);
        const payload = events[0]?.payload as {
            conversationId: string;
            batchId: string;
            operations: Array<{ op: string; nodeId: string; name: string }>;
        };
        expect(payload.conversationId).toBe('c9');
        expect(payload.batchId).toBe(result.batch.id);
        expect(payload.operations).toEqual([
            { op: 'create_entry', nodeId: result.batch.items[0]?.nodeId, name: 'Beta' },
        ]);
        expect(JSON.stringify(payload)).not.toContain('text');
    });

    it('emits nothing when no operation was applied', () => {
        const { events, deps } = rig();
        const proposal: OperationProposal = {
            id: 'p1',
            op: 'edit_entry',
            targetId: 'missing-node',
            values: { content: 'x' },
            baseline: { updatedAt: 'then', fingerprint: 'deadbeef' },
            dependsOn: [],
            destructive: false,
            decision: 'pending',
            summary: 'Update',
        };
        applyProposals(deps, { conversationId: 'c9' }, batch([proposal]), ['p1']);
        expect(events).toEqual([]);
    });
});

describe('wi-workspace:assistant-undone', () => {
    it('emits reverted and skipped node ids after an undo', () => {
        const state = stateWith([entryNode('e1', 'Alpha', { content: 'first line' })]);
        const store = new WorkspaceStore(state);
        const events: Array<{ event: string; payload: unknown }> = [];
        let ids = 0;
        const deps = {
            store,
            sync: {
                refreshStructure: () => undefined,
                recordEntityDeletions: () => undefined,
                markBooksDirty: () => undefined,
            } as unknown as SyncEngine,
            newId: () => `n${String((ids += 1))}`,
            now: () => '2026-09-15T12:00:00.000Z',
            emit: (event: string, payload: unknown) => events.push({ event, payload }),
        };
        const created: OperationProposal = {
            id: 'p1',
            op: 'create_entry',
            parent: { nodeId: store.getState().root.id },
            values: { title: 'Beta', content: 'text' },
            dependsOn: [],
            destructive: false,
            decision: 'pending',
            summary: 'Create entry "Beta"',
        };
        const applied = applyProposals(deps, { conversationId: 'c3' }, { id: 'b', proposals: [created], unparsed: [], applied: [] }, ['p1']);
        events.length = 0;
        undoAppliedBatch(deps, { conversationId: 'c3' }, applied.batch);
        expect(events).toEqual([
            {
                event: 'wi-workspace:assistant-undone',
                payload: {
                    conversationId: 'c3',
                    batchId: applied.batch.id,
                    reverted: [applied.batch.items[0]?.nodeId],
                    skipped: [],
                },
            },
        ]);
    });
});
