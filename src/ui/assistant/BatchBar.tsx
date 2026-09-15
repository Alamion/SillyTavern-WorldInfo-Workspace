import { useState } from 'react';
import type { AppliedBatch, ProposalBatch } from '../../core/assistant/types';

/**
 * Batch-level actions (spec 005 FR-009, FR-015, FR-017): accept or deny what is
 * still pending, send feedback for the whole batch, and undo an applied batch.
 */
export function BatchBar({
    batch,
    busy,
    onAcceptAll,
    onDenyAll,
    onFeedback,
    onUndo,
}: {
    batch: ProposalBatch;
    busy: boolean;
    onAcceptAll: () => void;
    onDenyAll: () => void;
    onFeedback: (text: string) => void;
    onUndo: (appliedBatchId: string) => void;
}): JSX.Element {
    const [feedback, setFeedback] = useState('');
    const pending = batch.proposals.filter((proposal) => proposal.decision === 'pending');
    const undoable = batch.applied.filter((applied: AppliedBatch) => applied.undone === undefined);
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
            {undoable.map((applied) => (
                <button
                    key={applied.id}
                    type="button"
                    className="wiw-button"
                    disabled={busy}
                    onClick={() => onUndo(applied.id)}
                    title={`Applied ${String(applied.items.length)} change(s)`}
                >
                    <i className="fa-solid fa-rotate-left" /> Undo batch
                </button>
            ))}
            {batch.applied
                .filter((applied) => applied.undone !== undefined)
                .map((applied) => (
                    <span key={applied.id} className="wiw-badge">
                        reverted {String(applied.undone?.reverted.length ?? 0)}
                        {applied.undone !== undefined && applied.undone.skipped.length > 0
                            ? `, skipped ${String(applied.undone.skipped.length)}`
                            : ''}
                    </span>
                ))}
        </div>
    );
}
