import { useState } from 'react';
import { renderMarkdown } from '../../core/preview';
import { findNode, type WorkspaceState } from '../../core/state/schema';
import { FIELD_SPECS, OWNED_PREFIX } from '../../core/md/convention';
import type { OperationProposal } from '../../core/assistant/types';
import { ProposalDiff } from './ProposalDiff';
import { ProposalEditor } from './ProposalEditor';

/**
 * One reviewable proposal (spec 005 FR-007–FR-010, FR-013, FR-014, FR-016,
 * FR-017): what it does, where, what it would look like, and the decision
 * buttons. Destructive proposals get their own confirmation.
 */

const OP_ICONS: Readonly<Record<OperationProposal['op'], string>> = {
    create_entry: 'fa-square-plus',
    edit_entry: 'fa-pen-to-square',
    create_folder: 'fa-folder-plus',
    rename: 'fa-tag',
    move: 'fa-right-left',
    delete: 'fa-trash-can',
};

export interface ProposalActions {
    onAccept: (proposalId: string) => void;
    onConfirmDestructive: (proposalId: string) => void;
    onDeny: (proposalId: string) => void;
    onEdit: (proposalId: string, values: OperationProposal['values']) => void;
    onFeedback: (proposalId: string, text: string) => void;
    onRefresh: (proposalId: string) => void;
}

function fieldSummary(proposal: OperationProposal): string {
    const values = proposal.userEdited ?? proposal.values;
    const parts: string[] = [];
    if (values.keys !== undefined) {
        parts.push(`keys: ${values.keys.join(', ')}`);
    }
    for (const [field, value] of Object.entries(values.fields ?? {})) {
        const spec = FIELD_SPECS.find((item) => item.field === field);
        const name = spec ? spec.key.slice(OWNED_PREFIX.length) : field;
        const printed =
            spec?.type === 'enum' && typeof value === 'number'
                ? spec.enumNames?.[value] ?? String(value)
                : String(value);
        parts.push(`${name}=${printed}`);
    }
    return parts.join(' · ');
}

export function ProposalCard({
    proposal,
    state,
    actions,
}: {
    proposal: OperationProposal;
    state: WorkspaceState;
    actions: ProposalActions;
}): JSX.Element {
    const [diffOpen, setDiffOpen] = useState(false);
    const [editorOpen, setEditorOpen] = useState(false);
    const [feedback, setFeedback] = useState<string | null>(null);
    const values = proposal.userEdited ?? proposal.values;
    const target = proposal.targetId !== undefined ? findNode(state, proposal.targetId) : undefined;
    const duplicate = proposal.duplicateOf !== undefined ? findNode(state, proposal.duplicateOf) : undefined;
    const pending = proposal.decision === 'pending';
    // Feedback also revises proposals that could not be used (owner report 2026-09-15).
    const revisable = ['pending', 'invalid', 'blocked', 'stale', 'failed'].includes(proposal.decision);
    const hasDiff = proposal.op === 'edit_entry' || values.content !== undefined;

    return (
        <li
            className={`wiw-proposal-item wiw-proposal-${proposal.decision}`}
            data-destructive-pending={proposal.destructive && pending ? 'true' : undefined}
        >
            <div className="wiw-proposal-row">
                <i className={`fa-solid ${OP_ICONS[proposal.op]} wiw-proposal-op-icon`} title={proposal.op} />
                <span className="wiw-proposal-summary">
                    {proposal.summary}
                    {proposal.userEdited !== undefined && ' (edited)'}
                </span>
                <span className={`wiw-badge ${proposal.decision === 'applied' ? 'wiw-badge-ok' : ''}`}>
                    {proposal.decision}
                </span>
            </div>
            <div className="wiw-bubble-meta">
                {proposal.destructive && <span className="wiw-badge wiw-badge-danger">destructive</span>}
                {duplicate !== undefined && (
                    <span className="wiw-badge wiw-badge-warn">similar to “{duplicate.name}”</span>
                )}
                {proposal.invalidReason !== undefined && (
                    <span className="wiw-badge wiw-badge-danger">{proposal.invalidReason}</span>
                )}
                {proposal.blockedReason !== undefined && (
                    <span className="wiw-badge wiw-badge-warn">{proposal.blockedReason}</span>
                )}
                {proposal.failedReason !== undefined && (
                    <span className="wiw-badge wiw-badge-danger">{proposal.failedReason}</span>
                )}
            </div>
            {(proposal.op === 'create_entry' || proposal.op === 'create_folder') && (
                <>
                    {fieldSummary(proposal) !== '' && (
                        <div className="wiw-proposal-path">{fieldSummary(proposal)}</div>
                    )}
                    {values.content !== undefined && (
                        <div
                            className="wiw-proposal-preview"
                            dangerouslySetInnerHTML={{ __html: renderMarkdown(values.content) }}
                        />
                    )}
                </>
            )}
            <div className="wiw-proposal-actions">
                {proposal.decision === 'stale' ? (
                    <button type="button" className="wiw-button" onClick={() => actions.onRefresh(proposal.id)}>
                        <i className="fa-solid fa-rotate" /> Review again
                    </button>
                ) : proposal.destructive && pending ? (
                    <button
                        type="button"
                        className="wiw-button wiw-danger-button"
                        onClick={() => actions.onConfirmDestructive(proposal.id)}
                    >
                        <i className="fa-solid fa-triangle-exclamation" />{' '}
                        {proposal.op === 'delete' ? 'Confirm delete…' : 'Confirm edit…'}
                    </button>
                ) : (
                    <button
                        type="button"
                        className="wiw-button"
                        disabled={!pending && (proposal.decision !== 'failed' || proposal.destructive)}
                        onClick={() => actions.onAccept(proposal.id)}
                    >
                        <i className="fa-solid fa-check" /> {proposal.decision === 'failed' ? 'Retry' : 'Accept'}
                    </button>
                )}
                <button
                    type="button"
                    className="wiw-button"
                    disabled={!pending}
                    onClick={() => actions.onDeny(proposal.id)}
                >
                    <i className="fa-solid fa-xmark" /> Deny
                </button>
                <button
                    type="button"
                    className="wiw-button"
                    disabled={!pending || proposal.op === 'delete' || proposal.op === 'move'}
                    onClick={() => setEditorOpen(true)}
                >
                    <i className="fa-solid fa-pen" /> Edit
                </button>
                {hasDiff && (
                    <button type="button" className="wiw-button" onClick={() => setDiffOpen(true)}>
                        <i className="fa-solid fa-file-lines" /> Diff
                    </button>
                )}
                <button
                    type="button"
                    className={`wiw-button ${feedback !== null ? 'wiw-button-active' : ''}`}
                    disabled={!revisable}
                    title="Ask the assistant to revise this proposal"
                    onClick={() => setFeedback(feedback === null ? '' : null)}
                >
                    <i className="fa-solid fa-comment-dots" /> Feedback
                </button>
            </div>
            {feedback !== null && (
                <div className="wiw-notice">
                    <span>
                        {proposal.invalidReason !== undefined
                            ? 'Tell the assistant how to fix this proposal (its problem is sent along):'
                            : 'What should change in this proposal?'}
                    </span>
                    <input
                        autoFocus
                        value={feedback}
                        placeholder="e.g. shorter, less purple — Enter to send"
                        onChange={(event) => setFeedback(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' && feedback.trim() !== '') {
                                actions.onFeedback(proposal.id, feedback.trim());
                                setFeedback(null);
                            }
                        }}
                    />
                    <div className="wiw-notice-actions">
                        <button
                            type="button"
                            className="wiw-button"
                            disabled={feedback.trim() === ''}
                            onClick={() => {
                                actions.onFeedback(proposal.id, feedback.trim());
                                setFeedback(null);
                            }}
                        >
                            <i className="fa-solid fa-paper-plane" /> Send feedback
                        </button>
                        <button type="button" className="wiw-button" onClick={() => setFeedback(null)}>
                            Cancel
                        </button>
                    </div>
                </div>
            )}
            {diffOpen && (
                <ProposalDiff proposal={proposal} target={target} onClose={() => setDiffOpen(false)} />
            )}
            {editorOpen && (
                <ProposalEditor
                    proposal={proposal}
                    onSave={(next) => actions.onEdit(proposal.id, next)}
                    onClose={() => setEditorOpen(false)}
                />
            )}
        </li>
    );
}
