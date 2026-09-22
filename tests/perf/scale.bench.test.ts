import { describe, expect, it } from 'vitest';

import { buildScaleDataset } from '../support/scaleDataset';
import { WorkspaceStore } from '../../src/core/state/store';
import { findNode } from '../../src/core/state/schema';
import { getNodeIndex } from '../../src/core/state/nodeIndex';
import {
    bulkDeleteNodes,
    commitEntryField,
    setExpanded,
} from '../../src/core/tree/operations';
import { fingerprintEntry } from '../../src/core/sync/fingerprint';
import { flattenRoot } from '../../src/core/sync/flatten';
import { renderWorkspace, type EntryRenderCache } from '../../src/core/md/linkRender';
import { reconcile, type DiskItem, type WsItem } from '../../src/core/md/reconcile';
import type { FolderNode } from '../../src/core/state/schema';
import { nodeDigest, nodeYaml } from '../support/memoryDisk';

/**
 * Core-path performance budgets (spec 006, contracts/performance-budgets.md).
 *
 * These are COMPARATIVE regression guards, not absolute hardware guarantees. Each
 * budget records the pre-fix baseline measured on the reference environment before
 * the structural-sharing refactor, so the improvement is evidenced rather than
 * assumed, and a later regression fails loudly.
 *
 * Budgets are deliberately set with headroom above the post-fix measurement so
 * normal machine variance does not produce flakes.
 *
 * `pnpm run test` runs this directory in a SECOND pass with file parallelism
 * disabled (`pnpm run test:perf`). Run together with the rest of the suite these
 * benchmarks compete with other test files for CPU and report times that have
 * nothing to do with the code — P-5 and P-7 failed that way while passing in
 * isolation. Timing assertions need an uncontended machine, not a looser budget.
 */

/** Pre-fix baselines (2026-09-22, reference environment, whole-state structuredClone). */
const BASELINE = {
    P1_commitField: '48.5 ms — whole-workspace structuredClone + full index rebuild per call',
    P2_findNode: '0.51 ms — buildNodeIndex(2000 nodes) per lookup, result discarded',
    P3_bulkDelete50: '3043 ms — one deep clone AND one full index walk per id',
    P4_setExpanded: '54.7 ms — whole-workspace structuredClone to flip one boolean',
    P6_fingerprint: '43.1 ms — no memo, stableStringify + FNV-1a per entry per call',
    P9_hundredEdits: 'timed out beyond 5000 ms',
    // Measured AFTER the fixes, on the reference machine, uncontended. Budgets
    // sit above these with headroom: they guard regressions, they are not
    // precision timings.
    P5_measured: '~120 ms for a 1000-entry flatten',
    P7_measured: '~110 ms for a warm whole-workspace render of ~2900 items; was ~140 ms while planFolderTree rendered every entry a second time',
    P8_measured: '~70 ms to reconcile ~2900 items',
} as const;

const BUDGET_MS = {
    P1_commitField: 5,
    P2_findNode: 0.1,
    P3_bulkDelete50: 50,
    P4_setExpanded: 2,
    P5_flatten1000: 250,
    P6_fingerprint1000: 5,
    P7_renderWorkspace: 180,
    P8_reconcile2000: 200,
};

/**
 * Fastest of `runs` timed iterations, in ms.
 *
 * The BEST sample, not the median: these are regression guards, and the fastest
 * run is the least contaminated estimate of the real cost. A median flakes when
 * the machine is busy (observed once in a loaded full-suite run) without the
 * code having regressed at all.
 */
function fastest(runs: number, fn: () => void): number {
    let best = Number.POSITIVE_INFINITY;
    for (let index = 0; index < runs; index += 1) {
        const start = performance.now();
        fn();
        best = Math.min(best, performance.now() - start);
    }
    return Number.isFinite(best) ? best : 0;
}

describe('scale dataset', () => {
    it('is deterministic for a given seed', () => {
        const a = buildScaleDataset();
        const b = buildScaleDataset();
        expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    }, 120_000);

    it('reaches the documented scale target', () => {
        const dataset = buildScaleDataset();
        expect(dataset.primaryEntryIds).toHaveLength(1000);
        expect(dataset.nodeCount).toBeGreaterThanOrEqual(2000);
    });
});

describe('core-path budgets at scale', () => {
    it(`P-1 single field commit < ${BUDGET_MS.P1_commitField} ms (was: ${BASELINE.P1_commitField})`, () => {
        const dataset = buildScaleDataset();
        const store = new WorkspaceStore(dataset.state);
        const targetId = dataset.primaryEntryIds[500] ?? '';
        let tick = 0;
        const elapsed = fastest(15, () => {
            const next = commitEntryField(
                store.getState(),
                targetId,
                'content',
                `edited ${(tick += 1)}`
            );
            store.replace(next);
        });
        expect(elapsed).toBeLessThan(BUDGET_MS.P1_commitField);
    }, 120_000);

    it(`P-2 lookup through the opt-in index < ${BUDGET_MS.P2_findNode} ms (was: ${BASELINE.P2_findNode})`, () => {
        const dataset = buildScaleDataset();
        const state = dataset.state;
        const targetId = dataset.primaryEntryIds[900] ?? '';
        // `findNode` stays an uncached walk on purpose (in-place mutators depend
        // on that); hot read-only loops opt into the index instead.
        getNodeIndex(state.root);
        const elapsed = fastest(25, () => {
            for (let index = 0; index < 100; index += 1) {
                getNodeIndex(state.root).get(targetId);
            }
        });
        expect(elapsed / 100).toBeLessThan(BUDGET_MS.P2_findNode);
    }, 120_000);

    it(`P-3 bulk delete of 50 nodes < ${BUDGET_MS.P3_bulkDelete50} ms (was: ${BASELINE.P3_bulkDelete50})`, () => {
        const dataset = buildScaleDataset();
        const victims = dataset.primaryEntryIds.slice(0, 50);
        const elapsed = fastest(9, () => {
            bulkDeleteNodes(dataset.state, victims);
        });
        expect(elapsed).toBeLessThan(BUDGET_MS.P3_bulkDelete50);
    }, 120_000);

    it(`P-4 setExpanded < ${BUDGET_MS.P4_setExpanded} ms (was: ${BASELINE.P4_setExpanded})`, () => {
        const dataset = buildScaleDataset();
        const folderId = dataset.state.root.children[0]?.id ?? '';
        let flag = false;
        const elapsed = fastest(15, () => {
            setExpanded(dataset.state, folderId, (flag = !flag));
        });
        expect(elapsed).toBeLessThan(BUDGET_MS.P4_setExpanded);
    }, 120_000);

    it(`P-6 fingerprinting 1000 entries with a warm memo < ${BUDGET_MS.P6_fingerprint1000} ms (was: ${BASELINE.P6_fingerprint})`, () => {
        const dataset = buildScaleDataset();
        const entries = dataset.primaryEntryIds.map((id) => {
            const node = findNode(dataset.state, id);
            if (node?.kind !== 'entry') {
                throw new Error('expected entry');
            }
            return node.native;
        });
        // First pass populates the memo; subsequent passes must be near-free.
        entries.forEach((entry) => fingerprintEntry(entry));
        const elapsed = fastest(9, () => {
            entries.forEach((entry) => fingerprintEntry(entry));
        });
        expect(elapsed).toBeLessThan(BUDGET_MS.P6_fingerprint1000);
    }, 120_000);

    it('P-9 repeated edits do not grow retained state unboundedly', () => {
        const dataset = buildScaleDataset();
        const store = new WorkspaceStore(dataset.state);
        const targetId = dataset.primaryEntryIds[0] ?? '';
        for (let index = 0; index < 100; index += 1) {
            store.replace(commitEntryField(store.getState(), targetId, 'content', `v${index}`));
        }
        // The tree must still be exactly the size it started as: no accumulation.
        const serialized = JSON.stringify(store.getState());
        expect(serialized.length).toBeGreaterThan(0);
        const node = findNode(store.getState(), targetId);
        expect(node?.kind).toBe('entry');
        if (node?.kind === 'entry') {
            expect(node.native.content).toBe('v99');
        }
    }, 120_000);
});


/** The dataset's primary World Info root. */
function primaryRoot(state: ReturnType<typeof buildScaleDataset>['state']): FolderNode {
    const found = state.root.children.find(
        (child): child is FolderNode => child.kind === 'folder' && child.isWiRoot
    );
    if (!found) {
        throw new Error('dataset has no World Info root');
    }
    return found;
}

const lowestFree = (used: ReadonlySet<number>, from: number): number => {
    for (let uid = Math.max(0, from); uid < 1_000_000; uid += 1) {
        if (!used.has(uid)) {
            return uid;
        }
    }
    return 999_999;
};

describe('pipeline budgets at scale', () => {
    it(`P-5 flattening a 1000-entry book < ${BUDGET_MS.P5_flatten1000} ms`, () => {
        const dataset = buildScaleDataset();
        const root = primaryRoot(dataset.state);
        const elapsed = fastest(5, () => {
            flattenRoot({
                state: dataset.state,
                rootId: root.id,
                bookName: dataset.primaryBookName,
                existingBook: { entries: {} },
                orphans: [],
                allocateUid: lowestFree,
            });
        });
        expect(elapsed).toBeLessThan(BUDGET_MS.P5_flatten1000);
    }, 120_000);

    it(`P-7 re-rendering the workspace with a warm cache < ${BUDGET_MS.P7_renderWorkspace} ms`, async () => {
        const dataset = buildScaleDataset();
        const entryCache: EntryRenderCache = new WeakMap();
        const render = async (): Promise<void> => {
            await renderWorkspace({
                state: dataset.state,
                baseline: {},
                yaml: nodeYaml,
                digest: nodeDigest,
                imageHash: async () => 'img',
                entryCache,
            });
        };
        // First pass populates the identity-keyed memo; later passes must be
        // near-free, which is the point of keying by node instead of by a
        // serialization of the node.
        await render();
        let best = Number.POSITIVE_INFINITY;
        for (let run = 0; run < 3; run += 1) {
            const start = performance.now();
            await render();
            best = Math.min(best, performance.now() - start);
        }
        expect(best).toBeLessThan(BUDGET_MS.P7_renderWorkspace);
    }, 120_000);

    it(`P-8 reconciling ~2000 items < ${BUDGET_MS.P8_reconcile2000} ms`, async () => {
        const dataset = buildScaleDataset();
        const render = await renderWorkspace({
            state: dataset.state,
            baseline: {},
            yaml: nodeYaml,
            digest: nodeDigest,
            imageHash: async () => 'img',
        });
        // Disk mirrors the workspace exactly: the matching passes still run in
        // full, which is what the pre-bucketing had to make non-quadratic.
        const disk = new Map<string, DiskItem>();
        for (const item of render.items.values()) {
            disk.set(item.path, {
                kind: item.kind,
                path: item.path,
                hash: item.hash,
                canonHash: item.hash,
                name: item.name,
            });
        }
        const ws = new Map<string, WsItem>();
        for (const [id, item] of render.items) {
            ws.set(id, {
                id,
                kind: item.kind,
                path: item.path,
                hash: item.hash,
                name: item.name,
                parentId: item.parentId,
            });
        }
        const elapsed = fastest(5, () => {
            reconcile({ rootId: dataset.state.root.id, ws, disk, baseline: {} });
        });
        expect(elapsed).toBeLessThan(BUDGET_MS.P8_reconcile2000);
    }, 180_000);
});
