import { useState } from 'react';
import type { OperationProposal, ProposedValues } from '../../core/assistant/types';
import { FormField } from '../formControls';

/**
 * Edits a proposal before it is accepted (spec 005 FR-009): the adjusted values
 * are what gets applied.
 */
export function ProposalEditor({
    proposal,
    onSave,
    onClose,
}: {
    proposal: OperationProposal;
    onSave: (values: ProposedValues) => void;
    onClose: () => void;
}): JSX.Element {
    const initial = proposal.userEdited ?? proposal.values;
    const [title, setTitle] = useState(initial.title ?? '');
    const [keys, setKeys] = useState((initial.keys ?? []).join(', '));
    const [secondaryKeys, setSecondaryKeys] = useState((initial.secondaryKeys ?? []).join(', '));
    const [content, setContent] = useState(initial.content ?? '');
    const [summary, setSummary] = useState(initial.summary ?? '');

    const save = (): void => {
        const values: ProposedValues = { ...initial };
        if (initial.title !== undefined || title.trim() !== '') {
            values.title = title.trim();
        }
        if (initial.keys !== undefined || keys.trim() !== '') {
            values.keys = keys
                .split(',')
                .map((key) => key.trim())
                .filter((key) => key !== '');
        }
        if (initial.secondaryKeys !== undefined || secondaryKeys.trim() !== '') {
            values.secondaryKeys = secondaryKeys
                .split(',')
                .map((key) => key.trim())
                .filter((key) => key !== '');
        }
        if (initial.content !== undefined || content !== '') {
            values.content = content;
        }
        if (initial.summary !== undefined || summary.trim() !== '') {
            values.summary = summary.trim();
        }
        onSave(values);
        onClose();
    };

    return (
        <div className="wiw-overlay" onClick={onClose}>
            <div
                className="wiw-panel wiw-form-panel"
                onClick={(event) => event.stopPropagation()}
            >
                <h3>Edit proposal</h3>
                <FormField label="Title">
                    <input value={title} onChange={(event) => setTitle(event.target.value)} />
                </FormField>
                <FormField label="Keywords (comma separated)">
                    <input value={keys} onChange={(event) => setKeys(event.target.value)} />
                </FormField>
                <FormField label="Secondary keywords">
                    <input
                        value={secondaryKeys}
                        onChange={(event) => setSecondaryKeys(event.target.value)}
                    />
                </FormField>
                <FormField label="Summary (when the entry matters)">
                    <input value={summary} onChange={(event) => setSummary(event.target.value)} />
                </FormField>
                <FormField label="Content">
                    <textarea value={content} onChange={(event) => setContent(event.target.value)} />
                </FormField>
                <div className="wiw-panel-actions">
                    <button type="button" className="wiw-button" onClick={save}>
                        <i className="fa-solid fa-check" /> Use these values
                    </button>
                    <button type="button" className="wiw-button" onClick={onClose}>
                        <i className="fa-solid fa-xmark" /> Cancel
                    </button>
                </div>
            </div>
        </div>
    );
}
