/**
 * The ONE header-row pattern for every node kind (constitution amendment
 * 1.2.0: one shared system): icon, (entries only) the enable/disable toggle,
 * the name as an editable input, and duplicate/delete buttons at the row end.
 * Images and folders render the same row WITHOUT the toggle — images are not
 * entries.
 */
import { useDraftField } from './useDraftField';

export function NodeHeader({
    kind,
    icon,
    name,
    disabled,
    onCommitName,
    onToggleDisable,
    onDuplicate,
    onDelete,
}: {
    kind: 'folder' | 'entry' | 'image';
    icon: string;
    name: string;
    disabled?: boolean;
    onCommitName(name: string): void;
    onToggleDisable?(): void;
    onDuplicate(): void;
    onDelete(): void;
}): JSX.Element {
    // Renaming stays local and commits shortly after typing stops (spec 006 R3);
    // the caller keys this row by node id, so switching items flushes the draft.
    const nameDraft = useDraftField(name, onCommitName);
    return (
        <div className="wiw-node-header">
            {kind === 'entry' && onToggleDisable ? (
                <button
                    type="button"
                    className={`wiw-entry-state${disabled ? ' wiw-entry-state-disabled' : ''}`}
                    title={
                        disabled
                            ? 'Entry is disabled - click to enable'
                            : 'Entry is enabled - click to disable'
                    }
                    onClick={onToggleDisable}
                >
                    <i className={`fa-solid ${disabled ? 'fa-toggle-off' : 'fa-toggle-on'}`} />
                </button>
            ) : (
                <span className="wiw-node-kind-icon">
                    <i className={`fa-solid ${icon}`} />
                </span>
            )}
            <input
                className="wiw-node-name"
                type="text"
                value={nameDraft.value}
                title="Name"
                onChange={(event) => nameDraft.onChange(event.target.value)}
                onBlur={nameDraft.onBlur}
            />
            <div className="wiw-editor-actions">
                <button
                    type="button"
                    className="wiw-button wiw-icon-button"
                    title={`Duplicate this ${kind}`}
                    onClick={onDuplicate}
                >
                    <i className="fa-solid fa-clone" />
                </button>
                <button
                    type="button"
                    className="wiw-button wiw-icon-button wiw-danger-button"
                    title={`Delete this ${kind}`}
                    onClick={onDelete}
                >
                    <i className="fa-solid fa-trash-can" />
                </button>
            </div>
        </div>
    );
}