import { useState } from 'react';
import type { ConflictDecision, ConflictView } from '../adapters/mdLink';
import { DiffView } from './DiffView';

/**
 * Per-item conflict resolution for the linked folder (spec 004 FR-013,
 * contracts/md-ui-contract.md). Undecided rows are skipped: both sides stay as they are.
 */

const DECISION_LABEL: Record<ConflictDecision, string> = {
    'keep-workspace': 'Keep workspace',
    'keep-disk': 'Keep file',
    skip: 'Skip',
};

const DECISION_ICON: Record<ConflictDecision, string> = {
    'keep-workspace': 'fa-book-atlas',
    'keep-disk': 'fa-file-lines',
    skip: 'fa-forward',
};

const SIDE_LABEL: Record<ConflictView['workspace'], string> = {
    edited: 'edited',
    deleted: 'deleted',
    moved: 'moved',
    created: 'exists',
};

export function ConflictDialog({
    conflicts,
    onApply,
}: {
    conflicts: ConflictView[];
    onApply(decisions: Map<string, ConflictDecision>): void;
}): JSX.Element {
    const [decisions, setDecisions] = useState<Map<string, ConflictDecision>>(new Map());
    const [expanded, setExpanded] = useState<string | null>(null);

    const choose = (key: string, decision: ConflictDecision): void => {
        setDecisions((prev) => new Map(prev).set(key, decision));
    };
    const chooseAll = (decision: ConflictDecision): void => {
        setDecisions(new Map(conflicts.map((conflict) => [conflict.key, decision])));
    };

    return (
        <div className="wiw-overlay">
            <div className="wiw-panel wiw-panel-wide">
                <h3>Resolve conflicts</h3>
                <p>
                    These items changed both in the workspace and in the linked folder. Choose which side to keep;
                    skipped items stay unchanged on both sides until the next Sync.
                </p>
                <div className="wiw-panel-body">
                    {conflicts.map((conflict) => {
                        const chosen = decisions.get(conflict.key);
                        const decision = chosen ?? 'skip';
                        const open = expanded === conflict.key;
                        return (
                            <div key={conflict.key} className={`wiw-diff-row${chosen ? ' wiw-diff-row-decided' : ''}`}>
                                <div className="wiw-diff-head">
                                    <code>{conflict.path === '' ? '(linked folder)' : conflict.path}</code>
                                    <span className="wiw-badge wiw-badge-off">
                                        workspace: {SIDE_LABEL[conflict.workspace]}
                                    </span>
                                    <span className="wiw-badge wiw-badge-off">file: {SIDE_LABEL[conflict.disk]}</span>
                                    {(conflict.workspaceText !== null || conflict.diskText !== null) && (
                                        <button
                                            type="button"
                                            className="wiw-button wiw-icon-button"
                                            title={open ? 'Hide both versions' : 'Show both versions'}
                                            onClick={() => setExpanded(open ? null : conflict.key)}
                                        >
                                            <i className={`fa-solid ${open ? 'fa-chevron-up' : 'fa-chevron-down'}`} />
                                        </button>
                                    )}
                                </div>
                                {open && (
                                    <DiffView
                                        before={conflict.workspace === 'deleted' ? null : conflict.workspaceText}
                                        after={conflict.disk === 'deleted' ? null : (conflict.diskText ?? '(binary file)')}
                                        beforeLabel="Workspace"
                                        afterLabel="File"
                                        missingText="(deleted)"
                                        compact
                                    />
                                )}
                                <div className="wiw-panel-actions">
                                    {(['keep-workspace', 'keep-disk', 'skip'] as const).map((option) => (
                                        <button
                                            key={option}
                                            type="button"
                                            aria-pressed={decision === option}
                                            className={`wiw-button${decision === option ? ' wiw-choice-active' : ''}`}
                                            onClick={() => choose(conflict.key, option)}
                                        >
                                            <i className={`fa-solid ${DECISION_ICON[option]}`} />{' '}
                                            {DECISION_LABEL[option]}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
                <div className="wiw-panel-actions">
                    <button type="button" className="wiw-button" onClick={() => chooseAll('keep-workspace')}>
                        Keep all workspace
                    </button>
                    <button type="button" className="wiw-button" onClick={() => chooseAll('keep-disk')}>
                        Keep all files
                    </button>
                    <button type="button" className="wiw-button" onClick={() => onApply(decisions)}>
                        <i className="fa-solid fa-check" /> Apply
                    </button>
                </div>
            </div>
        </div>
    );
}
