import { useState } from 'react';
import type { AppliedBatch, ProposalBatch } from '../../core/assistant/types';

/**
 * Batch-level actions (spec 005 FR-009, FR-015, FR-017): accept or deny what is
 * still pending, send feedback for the whole batch, and undo an applied batch.
 */
export function BatchBar({
    batch,
    busy,
    forked,
    onAcceptAll,
    onDenyAll,
    onFeedback,
    onUndo,
    onUndoAll,
}: {
    batch: ProposalBatch;
    busy: boolean;
    /** Copied by a fork: its applied changes can only be undone in the original. */
    forked: boolean;
    onAcceptAll: () => void;
    onDenyAll: () => void;
    onFeedback: (text: string) => void;
    onUndo: (appliedBatchId: string) => void;
    onUndoAll: () => void;
}): JSX.Element {
    const [feedback, setFeedback] = useState('');
    const pending = batch.proposals.filter((proposal) => proposal.decision === 'pending');
    const undoable = batch.applied.filter((applied: AppliedBatch) => applied.undone === undefined);
    // Every accept click is its own applied batch: offer the newest one and "all",
    // not one identical button per click (owner report 2026-09-17).
    const last = forked ? undefined : undoable.at(-1);
    const lastNames = (last?.items ?? [])
        .map((item) => batch.proposals.find((proposal) => proposal.id === item.proposalId)?.summary)
        .filter((summary): summary is string => summary !== undefined);
    const undone = batch.applied.flatMap((applied) => (applied.undone !== undefined ? [applied.undone] : []));
    const revertedCount = undone.reduce((sum, item) => sum + item.reverted.length, 0);
    const skippedCount = undone.reduce((sum, item) => sum + item.skipped.length, 0);
    return (
        <div className="wiw-proposal-actions">
            <button
                type="button"
                className="wiw-button"
                disabled={pending.length === 0 || busy}
                onClick={onAcceptAll}
            >
                <i className="fa-solid fa-check-double" /> Accept all pending
            </button>
            <button
                type="button"
                className="wiw-button"
                disabled={pending.length === 0 || busy}
                onClick={onDenyAll}
            >
                <i className="fa-solid fa-xmark" /> Deny all pending
            </button>
            <input
                value={feedback}
                placeholder="Feedback for the whole batch — Enter to send"
                onChange={(event) => setFeedback(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' && feedback.trim() !== '') {
                        onFeedback(feedback.trim());
                        setFeedback('');
                    }
                }}
            />
            <button
                type="button"
                className="wiw-button"
                disabled={feedback.trim() === '' || busy}
                onClick={() => {
                    onFeedback(feedback.trim());
                    setFeedback('');
                }}
            >
                <i className="fa-solid fa-paper-plane" /> Send feedback
            </button>
            {forked && undoable.length > 0 && (
                <span className="wiw-badge" title="Undo is available in the conversation this one was forked from">
                    undo in the original conversation
                </span>
            )}
            {last !== undefined && (
                <button
                    type="button"
                    className="wiw-button"
                    disabled={busy}
                    onClick={() => onUndo(last.id)}
                    title={`Undo the last applied change(s):\n${lastNames.join('\n')}`}
                >
                    <i className="fa-solid fa-rotate-left" /> Undo last
                </button>
            )}
            {!forked && undoable.length > 1 && (
                <button
                    type="button"
                    className="wiw-button"
                    disabled={busy}
                    onClick={onUndoAll}
                    title="Undo every change applied from this reply, newest first"
                >
                    <i className="fa-solid fa-clock-rotate-left" /> Undo all ({String(undoable.length)})
                </button>
            )}
            {undone.length > 0 && (
                <span className="wiw-badge">
                    reverted {String(revertedCount)}
                    {skippedCount > 0 ? `, skipped ${String(skippedCount)}` : ''}
                </span>
            )}
        </div>
    );
}
