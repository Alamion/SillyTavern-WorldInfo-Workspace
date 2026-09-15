import { FIELD_SPECS, OWNED_PREFIX } from '../../core/md/convention';
import type { EntryNode, TreeNode } from '../../core/state/schema';
import type { OperationProposal, ProposedValues } from '../../core/assistant/types';
import { DiffView } from '../DiffView';

/**
 * Per-field before/after of a proposal (spec 005 FR-008): content as a line diff
 * through the shared DiffView, everything else as one-line rows.
 */

function fieldLabel(field: string): string {
    const spec = FIELD_SPECS.find((item) => item.field === field);
    return spec ? spec.key.slice(OWNED_PREFIX.length) : field;
}

function enumName(field: string, value: unknown): string {
    const spec = FIELD_SPECS.find((item) => item.field === field);
    if (spec?.type === 'enum' && typeof value === 'number') {
        return spec.enumNames?.[value] ?? String(value);
    }
    return Array.isArray(value) ? value.join(', ') : String(value);
}

export function ProposalDiff({
    proposal,
    target,
    onClose,
}: {
    proposal: OperationProposal;
    target: TreeNode | undefined;
    onClose: () => void;
}): JSX.Element {
    const values: ProposedValues = proposal.userEdited ?? proposal.values;
    const entry: EntryNode | undefined = target?.kind === 'entry' ? target : undefined;
    const rows: Array<{ label: string; before: string; after: string }> = [];
    if (values.title !== undefined && target !== undefined && values.title !== target.name) {
        rows.push({ label: 'title', before: target.name, after: values.title });
    }
    if (values.keys !== undefined) {
        rows.push({
            label: 'keys',
            before: entry?.native.key.join(', ') ?? '',
            after: values.keys.join(', '),
        });
    }
    if (values.secondaryKeys !== undefined) {
        rows.push({
            label: 'secondary keys',
            before: entry?.native.keysecondary.join(', ') ?? '',
            after: values.secondaryKeys.join(', '),
        });
    }
    for (const [field, value] of Object.entries(values.fields ?? {})) {
        rows.push({
            label: fieldLabel(field),
            before:
                entry !== undefined
                    ? enumName(field, (entry.native as unknown as Record<string, unknown>)[field])
                    : '',
            after: enumName(field, value),
        });
    }

    return (
        <div className="wiw-overlay" onClick={onClose}>
            <div className="wiw-panel" onClick={(event) => event.stopPropagation()}>
                <h3>{proposal.summary}</h3>
                {rows.length > 0 && (
                    <div className="wiw-panel-body">
                        {rows.map((row) => (
                            <div key={row.label} className="wiw-row">
                                <span>{row.label}</span>
                                <span className="wiw-proposal-path">
                                    {row.before === '' ? '(empty)' : row.before} → {row.after}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
                {values.content !== undefined && (
                    <DiffView before={entry?.native.content ?? null} after={values.content} />
                )}
                <div className="wiw-panel-actions">
                    <button type="button" className="wiw-button" onClick={onClose}>
                        <i className="fa-solid fa-xmark" /> Close
                    </button>
                </div>
            </div>
        </div>
    );
}
