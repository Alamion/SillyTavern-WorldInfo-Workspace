import { useState } from 'react';
import type { OperationReport as Report, ReportOutcome } from '../core/md/report';

/** Operation report modal (spec 004 FR-019, contracts/md-ui-contract.md). */

const OUTCOME_META: Record<ReportOutcome, { icon: string; tone: string; label: string }> = {
    created: { icon: 'fa-plus', tone: 'wiw-outcome-ok', label: 'created' },
    updated: { icon: 'fa-pen', tone: 'wiw-outcome-ok', label: 'updated' },
    moved: { icon: 'fa-right-long', tone: 'wiw-outcome-ok', label: 'moved' },
    deleted: { icon: 'fa-trash-can', tone: 'wiw-outcome-warn', label: 'deleted' },
    skipped: { icon: 'fa-forward', tone: '', label: 'skipped' },
    preserved: { icon: 'fa-shield-halved', tone: '', label: 'preserved' },
    conflict: { icon: 'fa-code-branch', tone: 'wiw-outcome-bad', label: 'conflicts' },
    warning: { icon: 'fa-triangle-exclamation', tone: 'wiw-outcome-warn', label: 'warnings' },
};

const TITLES: Record<Report['operation'], string> = {
    import: 'Import report',
    export: 'Export report',
    sync: 'Sync report',
    link: 'Link report',
};

export function OperationReport({ report, onClose }: { report: Report; onClose(): void }): JSX.Element {
    const [showAll, setShowAll] = useState(false);
    const unchanged = new Set<ReportOutcome>(['skipped']);
    const visible = showAll ? report.lines : report.lines.filter((line) => !unchanged.has(line.outcome));
    const outcomes = (Object.keys(OUTCOME_META) as ReportOutcome[]).filter((outcome) => report.counts[outcome] > 0);
    return (
        <div className="wiw-overlay" onClick={onClose}>
            <div className="wiw-panel wiw-panel-wide" onClick={(event) => event.stopPropagation()}>
                <h3>{TITLES[report.operation]}</h3>
                <div className="wiw-report-counts">
                    {outcomes.length === 0 ? (
                        <span className="wiw-badge wiw-badge-off">nothing changed</span>
                    ) : (
                        outcomes.map((outcome) => (
                            <span key={outcome} className={`wiw-badge wiw-badge-off ${OUTCOME_META[outcome].tone}`}>
                                <i className={`fa-solid ${OUTCOME_META[outcome].icon}`} /> {report.counts[outcome]}{' '}
                                {OUTCOME_META[outcome].label}
                            </span>
                        ))
                    )}
                </div>
                <div className="wiw-panel-body">
                    {visible.length === 0 ? (
                        <p>No files were changed.</p>
                    ) : (
                        visible.map((line, index) => (
                            <div key={`${line.path}-${index}`} className="wiw-report-row">
                                <i
                                    className={`fa-solid ${OUTCOME_META[line.outcome].icon} ${OUTCOME_META[line.outcome].tone}`}
                                    title={line.outcome}
                                />
                                <code>{line.path === '' ? '(folder)' : line.path}</code>
                                {line.message && <small>{line.message}</small>}
                            </div>
                        ))
                    )}
                </div>
                <div className="wiw-panel-actions">
                    {report.counts.skipped > 0 && (
                        <button type="button" className="wiw-button" onClick={() => setShowAll((prev) => !prev)}>
                            {showAll ? 'Hide unchanged' : `Show unchanged (${report.counts.skipped})`}
                        </button>
                    )}
                    <button type="button" className="wiw-button" onClick={onClose}>
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}
