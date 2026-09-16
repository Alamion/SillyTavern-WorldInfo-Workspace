import { findNode, type EntryNode, type WorkspaceState } from '../core/state/schema';
import { deleteSubtree as deleteSubtreeById } from '../core/tree/operations';
import type { WorkspaceStore } from '../core/state/store';
import {
    commitEntryField,
    createChild,
    insertSubtree,
    moveNode,
    renameNode,
} from '../core/tree/operations';
import { planUndo } from '../core/assistant/undo';
import { deleteNodes } from './workspaceActions';
import { stalenessOf } from '../core/assistant/rules';
import type {
    AppliedBatch,
    AppliedBatchUndone,
    AppliedItem,
    OperationProposal,
    ProposalBatch,
    ProposedValues,
} from '../core/assistant/types';
import { applyTreeChange } from './workspaceActions';
import type { SyncEngine } from './syncEngine';

/**
 * Applies accepted proposals (spec 005 FR-011, FR-012, FR-028). Every mutation
 * goes through the Phase 1 pure tree operations and `applyTreeChange`, so
 * persistence, native World Info sync, the markdown link and interop events
 * behave exactly as for a manual edit. Nothing is applied that the user did not
 * accept, and a failure stops the batch and reports what landed.
 */

export interface ApplyDeps {
    store: WorkspaceStore;
    sync: SyncEngine;
    newId: () => string;
    now: () => string;
    emit?: (event: string, payload: unknown) => void;
}

export interface AppliedOperationSummary {
    op: OperationProposal['op'];
    nodeId: string;
    name: string;
}

export type ApplyOutcome =
    | { proposalId: string; status: 'applied'; nodeId: string }
    | { proposalId: string; status: 'stale'; reason: 'missing' | 'changed' }
    | { proposalId: string; status: 'failed'; reason: string };

export interface ApplyResult {
    batch: AppliedBatch;
    outcomes: ApplyOutcome[];
}

function effectiveValues(proposal: OperationProposal): ProposedValues {
    return proposal.userEdited ?? proposal.values;
}

/** Books the entry belongs to must be re-pushed after a field change. */
function entryOf(state: WorkspaceState, nodeId: string): EntryNode | undefined {
    const node = findNode(state, nodeId);
    return node?.kind === 'entry' ? node : undefined;
}

function booksOf(node: ReturnType<typeof findNode>): string[] {
    return node?.kind === 'entry' ? Object.keys(node.sync.books) : [];
}

function indexInParent(state: WorkspaceState, nodeId: string): number {
    const node = findNode(state, nodeId);
    const parent = node?.parentId !== null && node?.parentId !== undefined ? findNode(state, node.parentId) : undefined;
    if (parent?.kind !== 'folder') {
        return 0;
    }
    return Math.max(0, parent.children.findIndex((child) => child.id === nodeId));
}

function fieldEntries(values: ProposedValues): Array<[string, unknown]> {
    const fields: Array<[string, unknown]> = [];
    if (values.keys !== undefined) {
        fields.push(['key', values.keys]);
    }
    if (values.secondaryKeys !== undefined) {
        fields.push(['keysecondary', values.secondaryKeys]);
    }
    if (values.content !== undefined) {
        fields.push(['content', values.content]);
    }
    for (const [field, value] of Object.entries(values.fields ?? {})) {
        fields.push([field, value]);
    }
    return fields;
}

export function applyProposals(
    deps: ApplyDeps,
    context: { conversationId: string },
    batch: ProposalBatch,
    proposalIds: readonly string[]
): ApplyResult {
    const accepted = batch.proposals.filter((proposal) => proposalIds.includes(proposal.id));
    const items: AppliedItem[] = [];
    const outcomes: ApplyOutcome[] = [];
    const summaries: AppliedOperationSummary[] = [];
    // Creations accepted earlier (a separate click) still resolve their refs.
    const createdByRef = new Map<string, string>();
    for (const earlier of batch.applied.filter((item) => item.undone === undefined)) {
        for (const item of earlier.items) {
            const creation = batch.proposals.find((proposal) => proposal.id === item.proposalId);
            if (
                creation?.ref !== undefined &&
                creation.decision === 'applied' &&
                findNode(deps.store.getState(), item.nodeId) !== undefined
            ) {
                createdByRef.set(creation.ref, item.nodeId);
            }
        }
    }
    let failed: AppliedBatch['failed'];
    let failedOp: OperationProposal['op'] | undefined;

    for (const proposal of accepted) {
        // Only reviewable proposals can land (FR-014, FR-028); a failed one may be retried.
        if (!['pending', 'accepted', 'failed'].includes(proposal.decision)) {
            outcomes.push({
                proposalId: proposal.id,
                status: 'failed',
                reason: proposal.invalidReason ?? `the proposal is ${proposal.decision}`,
            });
            continue;
        }
        const stale = stalenessOf(deps.store.getState(), proposal);
        if (stale !== null) {
            outcomes.push({ proposalId: proposal.id, status: 'stale', reason: stale });
            continue;
        }
        const values = effectiveValues(proposal);
        const parentId =
            proposal.parent === undefined
                ? undefined
                : 'nodeId' in proposal.parent
                  ? proposal.parent.nodeId
                  : createdByRef.get(proposal.parent.ref);
        if (proposal.parent !== undefined && parentId === undefined) {
            const ref = 'ref' in proposal.parent ? proposal.parent.ref : undefined;
            const folder = batch.proposals.find((item) => item.ref !== undefined && item.ref === ref);
            const reason =
                folder !== undefined
                    ? `the folder it goes into is not created: apply "${folder.summary}" first, then accept this again`
                    : 'the folder it depends on was not created';
            outcomes.push({ proposalId: proposal.id, status: 'failed', reason });
            failed = { proposalId: proposal.id, reason };
            failedOp = proposal.op;
            break;
        }

        let appliedNodeId: string | null = null;
        let item: AppliedItem | null = null;

        if (proposal.op === 'create_entry' || proposal.op === 'create_folder') {
            const id = deps.newId();
            const kind = proposal.op === 'create_entry' ? 'entry' : 'folder';
            const ok = applyTreeChange(
                deps,
                (current) => createChild(current, parentId ?? current.root.id, kind, values.title ?? 'New item', () => id),
                { structure: true }
            );
            if (!ok) {
                outcomes.push({ proposalId: proposal.id, status: 'failed', reason: 'the item could not be created' });
                failed = { proposalId: proposal.id, reason: 'the item could not be created' };
                failedOp = proposal.op;
                break;
            }
            if (proposal.op === 'create_entry') {
                for (const [field, value] of fieldEntries(values)) {
                    applyTreeChange(deps, (current) => commitEntryField(current, id, field, value), {
                        books: Object.keys(entryOf(deps.store.getState(), id)?.sync.books ?? {}),
                    });
                }
            }
            appliedNodeId = id;
            item = {
                proposalId: proposal.id,
                op: proposal.op,
                nodeId: id,
                afterUpdatedAt: findNode(deps.store.getState(), id)?.updatedAt ?? deps.now(),
                inverse: { kind: 'delete-created' },
            };
            if (proposal.ref !== undefined) {
                createdByRef.set(proposal.ref, id);
            }
        } else if (proposal.op === 'edit_entry' && proposal.targetId !== undefined) {
            const before = entryOf(deps.store.getState(), proposal.targetId);
            if (!before) {
                outcomes.push({ proposalId: proposal.id, status: 'stale', reason: 'missing' });
                continue;
            }
            const previousName = before.name;
            const previousNative: Record<string, unknown> = {};
            for (const [field] of fieldEntries(values)) {
                previousNative[field] = (before.native as unknown as Record<string, unknown>)[field];
            }
            const books = Object.keys(before.sync.books);
            if (values.title !== undefined && values.title !== previousName) {
                applyTreeChange(deps, (current) => renameNode(current, before.id, values.title ?? previousName), {
                    books,
                });
            }
            for (const [field, value] of fieldEntries(values)) {
                applyTreeChange(deps, (current) => commitEntryField(current, before.id, field, value), { books });
            }
            appliedNodeId = before.id;
            item = {
                proposalId: proposal.id,
                op: proposal.op,
                nodeId: before.id,
                afterUpdatedAt: findNode(deps.store.getState(), before.id)?.updatedAt ?? deps.now(),
                inverse: { kind: 'restore-fields', name: previousName, native: previousNative },
            };
        } else if (proposal.op === 'rename' && proposal.targetId !== undefined) {
            const before = findNode(deps.store.getState(), proposal.targetId);
            if (!before) {
                outcomes.push({ proposalId: proposal.id, status: 'stale', reason: 'missing' });
                continue;
            }
            const previousName = before.name;
            const ok = applyTreeChange(
                deps,
                (current) => renameNode(current, before.id, values.title ?? previousName),
                { books: booksOf(before) }
            );
            if (!ok) {
                outcomes.push({ proposalId: proposal.id, status: 'failed', reason: 'the item could not be renamed' });
                failed = { proposalId: proposal.id, reason: 'the item could not be renamed' };
                failedOp = proposal.op;
                break;
            }
            appliedNodeId = before.id;
            item = {
                proposalId: proposal.id,
                op: proposal.op,
                nodeId: before.id,
                afterUpdatedAt: findNode(deps.store.getState(), before.id)?.updatedAt ?? deps.now(),
                inverse: { kind: 'restore-name', name: previousName },
            };
        } else if (proposal.op === 'move' && proposal.targetId !== undefined && parentId !== undefined) {
            const state = deps.store.getState();
            const before = findNode(state, proposal.targetId);
            const previousParentId = before?.parentId ?? null;
            const previousIndex = indexInParent(state, proposal.targetId);
            if (!before || previousParentId === null) {
                outcomes.push({ proposalId: proposal.id, status: 'stale', reason: 'missing' });
                continue;
            }
            const ok = applyTreeChange(deps, (current) => moveNode(current, before.id, parentId), {
                structure: true,
                books: booksOf(before),
            });
            if (!ok) {
                outcomes.push({ proposalId: proposal.id, status: 'failed', reason: 'the item could not be moved' });
                failed = { proposalId: proposal.id, reason: 'the item could not be moved' };
                failedOp = proposal.op;
                break;
            }
            appliedNodeId = before.id;
            item = {
                proposalId: proposal.id,
                op: proposal.op,
                nodeId: before.id,
                afterUpdatedAt: findNode(deps.store.getState(), before.id)?.updatedAt ?? deps.now(),
                inverse: { kind: 'restore-position', parentId: previousParentId, index: previousIndex },
            };
        } else {
            outcomes.push({
                proposalId: proposal.id,
                status: 'failed',
                reason: `operation ${proposal.op} cannot be applied here`,
            });
            failed = { proposalId: proposal.id, reason: `operation ${proposal.op} cannot be applied here` };
            failedOp = proposal.op;
            break;
        }

        if (item !== null && appliedNodeId !== null) {
            items.push(item);
            outcomes.push({ proposalId: proposal.id, status: 'applied', nodeId: appliedNodeId });
            summaries.push({
                op: proposal.op,
                nodeId: appliedNodeId,
                name: findNode(deps.store.getState(), appliedNodeId)?.name ?? values.title ?? '',
            });
        }
    }

    const applied: AppliedBatch = {
        id: deps.newId(),
        appliedAt: deps.now(),
        items,
        ...(failed !== undefined ? { failed } : {}),
    };
    // Nothing is emitted when a failed apply landed no operation at all
    // (contracts/hooks.md).
    if (summaries.length > 0) {
        deps.emit?.('wi-workspace:assistant-applied', {
            conversationId: context.conversationId,
            batchId: applied.id,
            operations: summaries,
            ...(failed !== undefined && failedOp !== undefined
                ? { failed: { op: failedOp, reason: failed.reason } }
                : {}),
        });
    }
    return { batch: applied, outcomes };
}


/**
 * Applies accepted DELETE proposals through the shared delete path, so
 * tombstones, the root-book question and the linked-folder note behave exactly
 * as in the tree UI (spec 005 FR-010, FR-011).
 */
export async function applyDeletion(
    deps: ApplyDeps & { confirm: (message: string) => Promise<boolean>; trackedIds?: () => ReadonlySet<string> },
    context: { conversationId: string },
    batch: ProposalBatch,
    proposalId: string
): Promise<ApplyResult> {
    const proposal = batch.proposals.find((item) => item.id === proposalId);
    const outcomes: ApplyOutcome[] = [];
    const items: AppliedItem[] = [];
    if (!proposal || proposal.targetId === undefined) {
        return { batch: { id: deps.newId(), appliedAt: deps.now(), items }, outcomes };
    }
    const state = deps.store.getState();
    const node = findNode(state, proposal.targetId);
    if (!node) {
        outcomes.push({ proposalId, status: 'stale', reason: 'missing' });
        return { batch: { id: deps.newId(), appliedAt: deps.now(), items }, outcomes };
    }
    const parentId = node.parentId;
    const index = indexInParent(state, node.id);
    const subtree = structuredClone(node);
    const deleted = await deleteNodes(
        {
            store: deps.store,
            sync: deps.sync,
            confirm: deps.confirm,
            ...(deps.trackedIds !== undefined ? { trackedIds: deps.trackedIds } : {}),
        },
        [node.id]
    );
    if (!deleted) {
        outcomes.push({ proposalId, status: 'failed', reason: 'the deletion was not confirmed' });
        return { batch: { id: deps.newId(), appliedAt: deps.now(), items }, outcomes };
    }
    if (parentId !== null) {
        items.push({
            proposalId,
            op: 'delete',
            nodeId: node.id,
            afterUpdatedAt: deps.now(),
            inverse: { kind: 'reinsert', parentId, index, subtree },
        });
    }
    outcomes.push({ proposalId, status: 'applied', nodeId: node.id });
    const applied: AppliedBatch = { id: deps.newId(), appliedAt: deps.now(), items };
    deps.emit?.('wi-workspace:assistant-applied', {
        conversationId: context.conversationId,
        batchId: applied.id,
        operations: [{ op: 'delete', nodeId: node.id, name: node.name }],
    });
    return { batch: applied, outcomes };
}

/**
 * Reverts an applied batch (spec 005 FR-015): items edited since are skipped and
 * reported, never overwritten.
 */
export function undoAppliedBatch(
    deps: ApplyDeps,
    context: { conversationId: string },
    applied: AppliedBatch
): AppliedBatchUndone {
    const plan = planUndo(applied, deps.store.getState());
    const reverted: string[] = [];
    const skipped = [...plan.skipped];
    for (const step of plan.steps) {
        let ok = false;
        if (step.kind === 'delete-created') {
            const node = findNode(deps.store.getState(), step.nodeId);
            const books = booksOf(node);
            const deletions = node?.kind === 'entry'
                ? Object.entries(node.sync.books)
                      .filter(([, value]) => value.uid !== null)
                      .map(([bookName, value]) => ({ bookName, uid: value.uid ?? 0 }))
                : [];
            ok = applyTreeChange(deps, (current) => deleteSubtreeById(current, step.nodeId), {
                structure: true,
                books,
                deletions,
            });
        } else if (step.kind === 'restore-fields') {
            ok = applyTreeChange(deps, (current) => renameNode(current, step.nodeId, step.name), {
                books: booksOf(findNode(deps.store.getState(), step.nodeId)),
            });
            for (const [field, value] of Object.entries(step.native)) {
                applyTreeChange(deps, (current) => commitEntryField(current, step.nodeId, field, value), {
                    books: booksOf(findNode(deps.store.getState(), step.nodeId)),
                });
            }
            ok = true;
        } else if (step.kind === 'restore-name') {
            ok = applyTreeChange(deps, (current) => renameNode(current, step.nodeId, step.name), {
                books: booksOf(findNode(deps.store.getState(), step.nodeId)),
            });
        } else if (step.kind === 'restore-position') {
            ok = applyTreeChange(
                deps,
                (current) => moveNode(current, step.nodeId, step.parentId, step.index),
                { structure: true }
            );
        } else {
            ok = applyTreeChange(
                deps,
                (current) => insertSubtree(current, step.parentId, step.index, step.subtree),
                { structure: true }
            );
        }
        if (ok) {
            reverted.push(step.nodeId);
        } else {
            skipped.push({ proposalId: step.proposalId, reason: 'the change could not be reverted' });
        }
    }
    const undone: AppliedBatchUndone = { at: deps.now(), reverted, skipped };
    if (reverted.length > 0) {
        deps.emit?.('wi-workspace:assistant-undone', {
            conversationId: context.conversationId,
            batchId: applied.id,
            reverted,
            skipped: skipped.map((item) => item.proposalId),
        });
    }
    return undone;
}
