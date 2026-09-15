import { describe, expect, it } from 'vitest';
import { createMdLink } from '../../src/adapters/mdLink';
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
