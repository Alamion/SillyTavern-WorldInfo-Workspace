import { useState } from 'react';
import { DiffView } from './DiffView';

const BEFORE =
    'Capital of Aldermeer, built on the confluence of the Lira and the Ossen.\nThe harbor district never sleeps; grain, wool, and resin come down the rivers.\nSells charcoal. The Bridgehold watch answers to the guilds.';
const AFTER =
    'Capital of Aldermeer, built on the confluence of the Lira and the Ossen.\nThe harbor district never sleeps; grain, wool, smoked fish, and iron come down the rivers.\n\n### City law\n- Harbor traffic answers to the **Bridgehold** watch, not the guilds.\n- Every barge files a manifest; the archivists keep copies forever.';

const OP_ICONS: Readonly<Record<string, string>> = {
    'create-card': 'fa-square-plus',
    'edit-card': 'fa-pen-to-square',
    'delete-node': 'fa-trash-can',
    'create-folder': 'fa-folder-plus',
    'delete-folder': 'fa-folder-minus',
    'move-node': 'fa-right-left',
    'rename-node': 'fa-tag',
};

function opIcon(op: string): string {
    return OP_ICONS[op] ?? 'fa-circle-dot';
}

interface ProposalItem {
    id: string;
    op: string;
    target: string;
    summary: string;
    before?: string;
    after?: string;
}

const PROPOSALS: readonly ProposalItem[] = [
    {
        id: 'p1',
        op: 'create-card',
        target: 'Hearth & Home',
        summary: 'Create card "Aldermeer Hearth Bread" (keys: bread, hearth)',
    },
    {
        id: 'p2',
        op: 'create-card',
        target: 'Hearth & Home',
        summary: 'Create card "The Lanternwright Guild" (keys: lantern, guild)',
    },
    {
        id: 'p3',
        op: 'create-card',
        target: 'Hearth & Home',
        summary: 'Create card "Festival of First Frost" (keys: festival, frost)',
    },
    {
        id: 'p4',
        op: 'edit-card',
        target: 'Bristlemark',
        summary: 'Update "Bristlemark" - rework harbor and add a city-law section',
        before: BEFORE,
        after: AFTER,
    },
];

type Decision = 'pending' | 'accepted' | 'denied';

const INITIAL_DECISIONS: Record<string, Decision> = Object.fromEntries(
    PROPOSALS.map((proposal) => [proposal.id, 'pending' as Decision])
);

function DiffModal({
    title,
    before,
    after,
    onClose,
}: {
    title: string;
    before: string;
    after: string;
    onClose: () => void;
}): JSX.Element {
    return (
        <div className="wiw-modal">
            <div className="wiw-modal-card">
                <header className="wiw-modal-header">
                    <span className="wiw-modal-title">Diff: {title}</span>
                    <button type="button" className="wiw-button" onClick={onClose}>
                        <i className="fa-solid fa-xmark" /> Close
                    </button>
                </header>
                <DiffView before={before} after={after} />
            </div>
        </div>
    );
}

export function AssistantPanel(): JSX.Element {
    const [decisions, setDecisions] = useState<Record<string, Decision>>(INITIAL_DECISIONS);
    const [openDiff, setOpenDiff] = useState<string | null>(null);
    const decide = (id: string, decision: Decision): void => {
        setDecisions((prev) => ({ ...prev, [id]: decision }));
    };
    const decideAllPending = (decision: Decision): void => {
        setDecisions((prev) => {
            const next = { ...prev };
            for (const key of Object.keys(next)) {
                if (next[key] === 'pending') {
                    next[key] = decision;
                }
            }
            return next;
        });
    };
    const pendingCount = PROPOSALS.filter((p) => decisions[p.id] === 'pending').length;
    const diffProposal = openDiff !== null ? PROPOSALS.find((p) => p.id === openDiff) : undefined;
    return (
        <div className="wiw-assistant">
            <div className="wiw-assistant-toolbar">
                <span className="wiw-mock-note">MOCK - no AI calls</span>
                <button
                    type="button"
                    className="wiw-button"
                    disabled
                    title="Future: connection profile, context to send, max context, custom prompt"
                >
                    <i className="fa-solid fa-gear" /> AI settings
                </button>
            </div>
            <div className="wiw-bubble wiw-bubble-user">
                <p className="wiw-bubble-text">
                    Fill a new folder with 3 cards about everyday Aldermeer life, then rework
                    the harbor paragraph in Bristlemark.
                </p>
            </div>
            <div className="wiw-bubble wiw-bubble-assistant">
                <p className="wiw-bubble-text">
                    Proposed batch ({PROPOSALS.length} operations, {pendingCount} pending):
                </p>
                <div className="wiw-proposals">
                    <ul className="wiw-proposal-list">
                        {PROPOSALS.map((proposal) => {
                            const decision = decisions[proposal.id];
                            const hasDiff =
                                proposal.before !== undefined && proposal.after !== undefined;
                            return (
                                <li
                                    key={proposal.id}
                                    className={`wiw-proposal-item wiw-proposal-${decision}`}
                                >
                                    <div className="wiw-proposal-row">
                                        <i
                                            className={`fa-solid ${opIcon(proposal.op)} wiw-proposal-op-icon`}
                                            title={proposal.op}
                                        />
                                        <span className="wiw-proposal-summary">
                                            {proposal.summary}
                                        </span>
                                        <span className={`wiw-decision wiw-decision-${decision}`}>
                                            {decision}
                                        </span>
                                    </div>
                                    <div className="wiw-proposal-actions">
                                        <button
                                            type="button"
                                            className="wiw-button"
                                            disabled={decision !== 'pending'}
                                            onClick={() => decide(proposal.id, 'accepted')}
                                        >
                                            <i className="fa-solid fa-check" /> Accept
                                        </button>
                                        <button
                                            type="button"
                                            className="wiw-button"
                                            disabled={decision !== 'pending'}
                                            onClick={() => decide(proposal.id, 'denied')}
                                        >
                                            <i className="fa-solid fa-xmark" /> Deny
                                        </button>
                                        {hasDiff && (
                                            <button
                                                type="button"
                                                className="wiw-button"
                                                onClick={() => setOpenDiff(proposal.id)}
                                            >
                                                <i className="fa-solid fa-file-lines" /> Diff
                                            </button>
                                        )}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                    <div className="wiw-proposal-actions">
                        <button
                            type="button"
                            className="wiw-button"
                            disabled={pendingCount === 0}
                            onClick={() => decideAllPending('accepted')}
                        >
                            Accept all pending
                        </button>
                        <button
                            type="button"
                            className="wiw-button"
                            disabled={pendingCount === 0}
                            onClick={() => decideAllPending('denied')}
                        >
                            Deny all pending
                        </button>
                    </div>
                </div>
            </div>
            {diffProposal && diffProposal.before !== undefined && diffProposal.after !== undefined && (
                <DiffModal
                    title={diffProposal.target}
                    before={diffProposal.before}
                    after={diffProposal.after}
                    onClose={() => setOpenDiff(null)}
                />
            )}
        </div>
    );
}
