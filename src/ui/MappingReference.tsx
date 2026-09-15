import { NAMING_RULES, SAMPLE_ENTRY, SCANNER_RULES, entryReferenceRows, folderReferenceRows, type ReferenceRow } from '../core/md/reference';
import { notifySuccess } from '../adapters/logger';

/** In-workspace markdown mapping reference (spec 004 FR-018, US4). */

function Table({ rows }: { rows: ReferenceRow[] }): JSX.Element {
    return (
        <table className="wiw-ref-table">
            <thead>
                <tr>
                    <th>Key</th>
                    <th>Meaning</th>
                    <th>Type</th>
                    <th>Default</th>
                </tr>
            </thead>
            <tbody>
                {rows.map((row) => (
                    <tr key={row.key}>
                        <td>
                            <code>{row.key}</code>
                        </td>
                        <td>{row.meaning}</td>
                        <td>{row.type}</td>
                        <td>{row.defaultValue}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

export function MappingReference({ onClose }: { onClose(): void }): JSX.Element {
    const copySample = (): void => {
        void navigator.clipboard?.writeText(SAMPLE_ENTRY).then(() => notifySuccess('Sample entry copied.'));
    };
    return (
        <div className="wiw-overlay" onClick={onClose}>
            <div className="wiw-panel wiw-panel-wide" onClick={(event) => event.stopPropagation()}>
                <h3>Markdown mapping reference</h3>
                <div className="wiw-panel-body wiw-ref-section">
                    <h4>How folders map</h4>
                    <ul>
                        {SCANNER_RULES.map((rule) => (
                            <li key={rule}>{rule}</li>
                        ))}
                    </ul>
                    <h4>Entry file keys (front matter)</h4>
                    <p>Only values that differ from the default are written.</p>
                    <div style={{ overflowX: 'auto' }}>
                        <Table rows={entryReferenceRows()} />
                    </div>
                    <h4>Folder record keys (.wiw-folder.yaml)</h4>
                    <div style={{ overflowX: 'auto' }}>
                        <Table rows={folderReferenceRows()} />
                    </div>
                    <h4>File names</h4>
                    <ul>
                        {NAMING_RULES.map((rule) => (
                            <li key={rule}>{rule}</li>
                        ))}
                    </ul>
                    <h4>Sample entry</h4>
                    <pre>{SAMPLE_ENTRY}</pre>
                </div>
                <div className="wiw-panel-actions">
                    <button type="button" className="wiw-button" onClick={copySample}>
                        <i className="fa-solid fa-copy" /> Copy sample
                    </button>
                    <button type="button" className="wiw-button" onClick={onClose}>
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}
