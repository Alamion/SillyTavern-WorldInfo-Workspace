import { useMemo } from 'react';
import { diffLines, pairDiffRows, type DiffRow } from '../core/diff/lineDiff';

/**
 * Shared side-by-side line diff (assistant proposals, markdown sync conflicts, and any
 * later before/after comparison). Styles: `.wiw-diff*` in the shared theme.
 * A side passed as `null` does not exist (e.g. deleted) and shows `missingText`.
 */
export function DiffView({
    before,
    after,
    beforeLabel = 'Before',
    afterLabel = 'After',
    missingText = '(does not exist)',
    compact = false,
}: {
    before: string | null;
    after: string | null;
    beforeLabel?: string;
    afterLabel?: string;
    missingText?: string;
    /** Bounded height for inline use inside lists; otherwise fills its container. */
    compact?: boolean;
}): JSX.Element {
    const rows: DiffRow[] = useMemo(() => pairDiffRows(diffLines(before ?? '', after ?? '')), [before, after]);
    const pane = (side: 'left' | 'right'): JSX.Element => {
        const label = side === 'left' ? beforeLabel : afterLabel;
        const missing = (side === 'left' ? before : after) === null;
        const changedClass = side === 'left' ? ' wiw-diff-removed' : ' wiw-diff-added';
        return (
            <div className="wiw-diff-pane">
                <div className="wiw-diff-pane-title">{label}</div>
                {missing ? (
                    <div className="wiw-diff-line wiw-diff-empty">
                        <pre>{missingText}</pre>
                    </div>
                ) : (
                    rows.map((row, index) => {
                        const text = side === 'left' ? row.left : row.right;
                        return (
                            <div
                                key={index}
                                className={`wiw-diff-line${text === null ? ' wiw-diff-empty' : row.state === 'same' ? '' : changedClass}`}
                            >
                                <pre>{text ?? ''}</pre>
                            </div>
                        );
                    })
                )}
            </div>
        );
    };
    return (
        <div className={`wiw-diff${compact ? ' wiw-diff-compact' : ''}`}>
            {pane('left')}
            {pane('right')}
        </div>
    );
}
