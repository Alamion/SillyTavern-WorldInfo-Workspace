import { createDefaultNativeEntry, findNode, type TreeNode, type WorkspaceState } from '../state/schema';
import { validateName, validateNode } from '../tree/validation';
import { pathOf } from './context';
import type { ParsedBlock } from './parser';
import { findDuplicate, fingerprintValues, isDestructiveEdit } from './rules';
import type {
    ContextSnapshot,
    OperationProposal,
    OperationType,
    ProposedValues,
} from './types';

/**
 * Turns parsed blocks into reviewable proposals (research R4): targets must
 * exist and be in scope, parents must be folders, refs must be declared before
 * use, and every value must satisfy the Phase 1 field validation. An invalid
 * block becomes an `invalid` proposal with a reason — never a silent drop
 * (FR-014).
 */

export interface ValidateInput {
    state: WorkspaceState;
    snapshot: Pick<ContextSnapshot, 'handles' | 'scopeNodeIds'>;
    newProposalId: () => string;
}

interface Resolved {
    nodeId?: string;
    ref?: string;
    error?: string;
}

const NEEDS_TARGET: ReadonlySet<OperationType> = new Set<OperationType>([
    'edit_entry',
    'rename',
    'move',
    'delete',
]);

function valuesOf(block: ParsedBlock): ProposedValues {
    const values: ProposedValues = {};
    if (block.tags.title !== undefined) {
        values.title = block.tags.title;
    }
    if (block.tags.keys !== undefined) {
        values.keys = block.tags.keys;
    }
    if (block.tags.secondaryKeys !== undefined) {
        values.secondaryKeys = block.tags.secondaryKeys;
    }
    if (block.tags.content !== undefined) {
        values.content = block.tags.content;
    }
    if (block.tags.fields !== undefined) {
        values.fields = block.tags.fields;
    }
    return values;
}

/** Field values are validated against the Phase 1 rules on a trial entry. */
function fieldViolations(values: ProposedValues): string | null {
    if (values.fields === undefined) {
        return null;
    }
    const trial: TreeNode = {
        id: 'trial',
        parentId: null,
        kind: 'entry',
        name: values.title ?? 'trial',
        createdAt: 'now',
        updatedAt: 'now',
        native: { ...createDefaultNativeEntry(1), ...values.fields },
        sync: { books: {} },
    };
    const violations = validateNode(trial).filter((violation) => violation.field !== 'name');
    return violations.length > 0
        ? violations.map((violation) => `${violation.field}: ${violation.message}`).join('; ')
        : null;
}

function summaryOf(
    state: WorkspaceState,
    op: OperationType,
    values: ProposedValues,
    targetId: string | undefined,
    parentLabel: string
): string {
    const name = values.title ?? (targetId !== undefined ? findNode(state, targetId)?.name : undefined) ?? 'item';
    switch (op) {
        case 'create_entry':
            return `Create entry "${name}" in ${parentLabel}`;
        case 'create_folder':
            return `Create folder "${name}" in ${parentLabel}`;
        case 'edit_entry':
            return `Update "${name}"`;
        case 'rename': {
            const previous = targetId !== undefined ? findNode(state, targetId)?.name : undefined;
            return `Rename "${previous ?? 'item'}" to "${values.title ?? ''}"`;
        }
        case 'move':
            return `Move "${name}" to ${parentLabel}`;
        default:
            return `Delete "${name}"`;
    }
}

export function toProposals(
    blocks: readonly ParsedBlock[],
    input: ValidateInput
): OperationProposal[] {
    const { state, snapshot } = input;
    const scope = new Set(snapshot.scopeNodeIds);
    const refs = new Map<string, { proposalId: string; kind: 'folder' | 'entry' }>();
    const proposals: OperationProposal[] = [];

    // Refs are collected from the whole reply first: models often reference a new
    // folder before the block that creates it, and an invalid creation must still
    // count as the declaration (its children are then blocked, not "unknown").
    const ids = blocks.map(() => input.newProposalId());
    const duplicateRefs = new Set<number>();
    blocks.forEach((block, index) => {
        const ref = block.attrs['ref'];
        if (ref === undefined || ref === '' || (block.type !== 'create_entry' && block.type !== 'create_folder')) {
            return;
        }
        if (refs.has(ref)) {
            duplicateRefs.add(index);
            return;
        }
        refs.set(ref, {
            proposalId: ids[index] ?? '',
            kind: block.type === 'create_folder' ? 'folder' : 'entry',
        });
    });

    /**
     * `placement` = a parent of a creation or a move destination: any folder of the
     * outline may receive new items (FR-021). Targets of edits, renames, moves and
     * deletions must be inside the scope.
     */
    const resolve = (handle: string | undefined, placement: boolean): Resolved => {
        if (handle === undefined || handle === '') {
            return { error: 'missing target' };
        }
        const byRef = refs.get(handle);
        if (byRef) {
            return { ref: handle };
        }
        const nodeId = snapshot.handles[handle];
        if (nodeId === undefined) {
            return { error: `unknown handle "${handle}"` };
        }
        if (!placement && !scope.has(nodeId)) {
            return { error: `"${handle}" is outside the context scope` };
        }
        return { nodeId };
    };

    for (const [index, block] of blocks.entries()) {
        const id = ids[index] ?? input.newProposalId();
        const values = valuesOf(block);
        const dependsOn: string[] = [];
        let invalidReason: string | undefined;
        let targetId: string | undefined;
        let parent: OperationProposal['parent'];
        let parentLabel = '';

        // Target (edit/rename/move/delete).
        if (NEEDS_TARGET.has(block.type)) {
            const resolved = resolve(block.attrs['id'], false);
            if (resolved.error !== undefined) {
                invalidReason = resolved.error;
            } else if (resolved.ref !== undefined) {
                const declared = refs.get(resolved.ref);
                targetId = undefined;
                if (declared) {
                    dependsOn.push(declared.proposalId);
                }
                if (block.type !== 'move') {
                    invalidReason = `"${resolved.ref}" is a new item; ${block.type} needs an existing item`;
                }
            } else {
                targetId = resolved.nodeId;
                const node = targetId !== undefined ? findNode(state, targetId) : undefined;
                if (!node) {
                    invalidReason = 'the target no longer exists';
                } else if (node.id === state.root.id) {
                    invalidReason = 'the workspace root cannot be changed';
                } else if (block.type === 'edit_entry' && node.kind !== 'entry') {
                    invalidReason = `"${node.name}" is not an entry`;
                }
            }
        }

        // Parent (create/move).
        if (block.type === 'create_entry' || block.type === 'create_folder' || block.type === 'move') {
            const resolved = resolve(block.attrs['parent'], true);
            if (resolved.error !== undefined) {
                invalidReason ??= resolved.error;
            } else if (resolved.ref !== undefined) {
                const declared = refs.get(resolved.ref);
                if (!declared || declared.kind !== 'folder') {
                    invalidReason ??= `"${resolved.ref}" is not a new folder`;
                } else {
                    dependsOn.push(declared.proposalId);
                    parent = { ref: resolved.ref };
                    parentLabel = `the new folder "${resolved.ref}"`;
                }
            } else if (resolved.nodeId !== undefined) {
                const node = findNode(state, resolved.nodeId);
                if (node?.kind !== 'folder') {
                    invalidReason ??= 'the destination is not a folder';
                } else {
                    parent = { nodeId: node.id };
                    parentLabel = pathOf(state, node.id) === '' ? 'the workspace' : pathOf(state, node.id);
                }
            }
        }

        // Values.
        if (invalidReason === undefined && values.title !== undefined) {
            const nameViolation = validateName(values.title);
            if (nameViolation) {
                invalidReason = nameViolation.message;
            }
        }
        if (invalidReason === undefined) {
            const fieldError = fieldViolations(values);
            if (fieldError !== null) {
                invalidReason = fieldError;
            }
        }

        // Operation-specific checks.
        if (invalidReason === undefined && block.type === 'move' && targetId !== undefined) {
            const destination = parent !== undefined && 'nodeId' in parent ? parent.nodeId : undefined;
            const node = findNode(state, targetId);
            if (destination !== undefined && node) {
                if (destination === node.parentId) {
                    invalidReason = 'the item is already there';
                } else if (node.kind === 'folder') {
                    const inside = new Set<string>();
                    const walk = (current: TreeNode): void => {
                        inside.add(current.id);
                        if (current.kind === 'folder') {
                            current.children.forEach(walk);
                        }
                    };
                    walk(node);
                    if (inside.has(destination)) {
                        invalidReason = 'a folder cannot move inside itself';
                    }
                }
            }
        }
        if (invalidReason === undefined && block.type === 'edit_entry' && targetId !== undefined) {
            const node = findNode(state, targetId);
            if (node?.kind === 'entry') {
                const unchanged =
                    (values.content === undefined || values.content === node.native.content) &&
                    (values.title === undefined || values.title === node.name) &&
                    (values.keys === undefined ||
                        values.keys.join('\u0000') === node.native.key.join('\u0000')) &&
                    (values.secondaryKeys === undefined ||
                        values.secondaryKeys.join('\u0000') === node.native.keysecondary.join('\u0000')) &&
                    (values.fields === undefined ||
                        Object.entries(values.fields).every(
                            ([field, value]) =>
                                JSON.stringify((node.native as unknown as Record<string, unknown>)[field]) ===
                                JSON.stringify(value)
                        ));
                if (unchanged) {
                    invalidReason = 'the entry already has these values';
                }
            }
        }

        // Rules: destructive, duplicate, staleness baseline.
        let destructive = block.type === 'delete';
        let duplicateOf: string | undefined;
        let baseline: OperationProposal['baseline'];
        if (invalidReason === undefined) {
            if (block.type === 'edit_entry' && targetId !== undefined) {
                const node = findNode(state, targetId);
                if (node?.kind === 'entry') {
                    destructive = isDestructiveEdit(node, values);
                }
            }
            if (block.type === 'create_entry' && parent !== undefined && 'nodeId' in parent) {
                duplicateOf = findDuplicate(state, parent.nodeId, values);
            }
            if (targetId !== undefined) {
                const node = findNode(state, targetId);
                if (node) {
                    baseline = { updatedAt: node.updatedAt, fingerprint: fingerprintValues(node, values) };
                }
            }
        }

        const ref = block.attrs['ref'];
        if (invalidReason === undefined && duplicateRefs.has(index) && ref !== undefined) {
            invalidReason = `ref "${ref}" was already used`;
        }

        const proposal: OperationProposal = {
            id,
            op: block.type,
            values,
            dependsOn,
            destructive,
            decision: invalidReason === undefined ? 'pending' : 'invalid',
            summary: summaryOf(state, block.type, values, targetId, parentLabel === '' ? 'the workspace' : parentLabel),
        };
        if (targetId !== undefined) {
            proposal.targetId = targetId;
        }
        if (parent !== undefined) {
            proposal.parent = parent;
        }
        if (ref !== undefined && ref !== '') {
            proposal.ref = ref;
        }
        if (baseline !== undefined) {
            proposal.baseline = baseline;
        }
        if (duplicateOf !== undefined) {
            proposal.duplicateOf = duplicateOf;
        }
        if (invalidReason !== undefined) {
            proposal.invalidReason = invalidReason;
        }
        proposals.push(proposal);
    }
    return proposals;
}
