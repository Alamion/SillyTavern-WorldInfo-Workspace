import type { Decision, OperationProposal, OperationType } from './types';

/**
 * Batch planning (research R8): dependency-safe order, blocked proposals, and
 * what an "accept all" actually takes (FR-010, FR-012).
 */

const ORDER: Readonly<Record<OperationType, number>> = {
    create_folder: 0,
    create_entry: 1,
    move: 2,
    rename: 3,
    edit_entry: 4,
    delete: 5,
};

/** Creations before the items that go into them; deletions last. */
export function applyOrder(proposals: readonly OperationProposal[]): OperationProposal[] {
    return [...proposals]
        .map((proposal, index) => ({ proposal, index }))
        .sort((a, b) => {
            const byOp = ORDER[a.proposal.op] - ORDER[b.proposal.op];
            return byOp !== 0 ? byOp : a.index - b.index;
        })
        .map((entry) => entry.proposal);
}

const DEAD: ReadonlySet<Decision> = new Set<Decision>(['denied', 'invalid', 'failed', 'superseded']);

/**
 * Recomputes `blocked` for proposals whose dependencies cannot be applied, and
 * releases them back to `pending` when the dependency is accepted again.
 */
export function withBlocked(proposals: readonly OperationProposal[]): OperationProposal[] {
    const byId = new Map(proposals.map((proposal) => [proposal.id, proposal]));
    return proposals.map((proposal) => {
        if (proposal.decision !== 'pending' && proposal.decision !== 'blocked') {
            return proposal;
        }
        const blocker = proposal.dependsOn
            .map((id) => byId.get(id))
            .find((dependency) => dependency !== undefined && DEAD.has(dependency.decision));
        if (blocker) {
            return {
                ...proposal,
                decision: 'blocked' as Decision,
                blockedReason: `needs "${blocker.summary}"`,
            };
        }
        if (proposal.decision === 'blocked') {
            const next = { ...proposal, decision: 'pending' as Decision };
            delete next.blockedReason;
            return next;
        }
        return proposal;
    });
}

/**
 * Accept-all takes pending, non-destructive proposals whose dependencies are
 * already applied or inside the same selection (FR-009, FR-010).
 */
export function acceptAllSelection(proposals: readonly OperationProposal[]): string[] {
    const candidates = applyOrder(
        proposals.filter((proposal) => proposal.decision === 'pending' && !proposal.destructive)
    );
    const selected = new Set<string>();
    const byId = new Map(proposals.map((proposal) => [proposal.id, proposal]));
    for (const proposal of candidates) {
        const ready = proposal.dependsOn.every((id) => {
            const dependency = byId.get(id);
            return dependency !== undefined && (dependency.decision === 'applied' || selected.has(id));
        });
        if (ready) {
            selected.add(proposal.id);
        }
    }
    return applyOrder(proposals.filter((proposal) => selected.has(proposal.id))).map(
        (proposal) => proposal.id
    );
}
