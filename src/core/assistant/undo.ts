import { findNode, type TreeNode, type WorkspaceState } from '../state/schema';
import type { AppliedBatch, AppliedItem } from './types';

/**
 * Undo planning for an applied assistant batch (spec 005 FR-015, research R9).
 * Items are reverted in reverse order; anything touched after the batch was
 * applied is SKIPPED with a reason instead of overwriting the later change.
 */

export type UndoStep =
    | { kind: 'delete-created'; proposalId: string; nodeId: string }
    | {
          kind: 'restore-fields';
          proposalId: string;
          nodeId: string;
          name: string;
          native: Record<string, unknown>;
      }
    | { kind: 'restore-name'; proposalId: string; nodeId: string; name: string }
    | {
          kind: 'restore-position';
          proposalId: string;
          nodeId: string;
          parentId: string;
          index: number;
      }
    | {
          kind: 'reinsert';
          proposalId: string;
          nodeId: string;
          parentId: string;
          index: number;
          subtree: TreeNode;
      };

export interface UndoPlan {
    steps: UndoStep[];
    skipped: Array<{ proposalId: string; reason: string }>;
}

function skipReason(state: WorkspaceState, item: AppliedItem): string | null {
    if (item.inverse.kind === 'reinsert') {
        if (findNode(state, item.nodeId) !== undefined) {
            return 'the item exists again';
        }
        return findNode(state, item.inverse.parentId) === undefined
            ? 'its folder no longer exists'
            : null;
    }
    const node = findNode(state, item.nodeId);
    if (node === undefined) {
        return 'the item no longer exists';
    }
    if (node.updatedAt !== item.afterUpdatedAt) {
        return 'it was edited after the batch was applied';
    }
    if (item.inverse.kind === 'delete-created' && node.kind === 'folder' && node.children.length > 0) {
        return 'items were added inside it';
    }
    if (item.inverse.kind === 'restore-position' && findNode(state, item.inverse.parentId) === undefined) {
        return 'its previous folder no longer exists';
    }
    return null;
}

export function planUndo(batch: AppliedBatch, state: WorkspaceState): UndoPlan {
    const steps: UndoStep[] = [];
    const skipped: Array<{ proposalId: string; reason: string }> = [];
    for (const item of [...batch.items].reverse()) {
        const reason = skipReason(state, item);
        if (reason !== null) {
            skipped.push({ proposalId: item.proposalId, reason });
            continue;
        }
        const base = { proposalId: item.proposalId, nodeId: item.nodeId };
        switch (item.inverse.kind) {
            case 'delete-created':
                steps.push({ kind: 'delete-created', ...base });
                break;
            case 'restore-fields':
                steps.push({
                    kind: 'restore-fields',
                    ...base,
                    name: item.inverse.name,
                    native: item.inverse.native as Record<string, unknown>,
                });
                break;
            case 'restore-name':
                steps.push({ kind: 'restore-name', ...base, name: item.inverse.name });
                break;
            case 'restore-position':
                steps.push({
                    kind: 'restore-position',
                    ...base,
                    parentId: item.inverse.parentId,
                    index: item.inverse.index,
                });
                break;
            default:
                steps.push({
                    kind: 'reinsert',
                    ...base,
                    parentId: item.inverse.parentId,
                    index: item.inverse.index,
                    subtree: item.inverse.subtree,
                });
                break;
        }
    }
    return { steps, skipped };
}
