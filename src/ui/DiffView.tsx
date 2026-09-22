import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { diffLines, diffWords, pairDiffRows, type DiffRow, type DiffSegment } from '../core/diff/lineDiff';

/**
 * Shared before/after line diff (assistant proposals, markdown sync conflicts, and any
 * later comparison). Styles: `.wiw-diff*` in the shared theme.
 * A side passed as `null` does not exist (e.g. deleted) and shows `missingText`.
 *
 * Layout (2026-09-22): one scroll container whose rows hold BOTH sides, so a line
 * that wraps on one side keeps its partner level (two separately scrolled panes
 * drifted apart). Narrow containers — the assistant panel, phones — get a unified
 * view instead (removed lines, then their replacements). Every line has a number
 * and a +/− marker; changed lines highlight the words that differ.
 */

/** Below this width the side-by-side columns are too narrow to read. */
const SPLIT_MIN_WIDTH = 560;

function useIsNarrow(ref: React.RefObject<HTMLElement>): boolean {
    const [narrow, setNarrow] = useState(false);
    useLayoutEffect(() => {
        const element = ref.current;
        if (!element) {
            return;
        }
        const measure = (): void => setNarrow(element.clientWidth > 0 && element.clientWidth < SPLIT_MIN_WIDTH);
        measure();
        if (typeof ResizeObserver === 'undefined') {
            return;
        }
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, [ref]);
    return narrow;
}

function Segments({ segments, className }: { segments: DiffSegment[]; className: string }): JSX.Element {
    return (
        <>
            {segments.map((segment, index) =>
                segment.changed ? (
                    <mark key={index} className={className}>
                        {segment.text}
                    </mark>
                ) : (
                    <span key={index}>{segment.text}</span>
                )
            )}
        </>
    );
}

type Side = 'removed' | 'added' | 'same' | 'empty';

/** One side of a line: number, marker and text (with word marks when given). */
function Cell({
    number,
    side,
    text,
    segments,
}: {
    number: number | null;
    side: Side;
    text: string | null;
    segments?: DiffSegment[];
}): JSX.Element {
    const marker = side === 'removed' ? '−' : side === 'added' ? '+' : '';
    return (
        <>
            <span className={`wiw-diff-number wiw-diff-${side}`}>{number ?? ''}</span>
            <span className={`wiw-diff-marker wiw-diff-${side}`} aria-hidden="true">
                {marker}
            </span>
            <pre className={`wiw-diff-text wiw-diff-${side}`}>
                {segments ? (
                    <Segments segments={segments} className={`wiw-diff-word-${side}`} />
                ) : (
                    (text ?? '')
                )}
            </pre>
        </>
    );
}

interface PreparedRow extends DiffRow {
    words?: { left: DiffSegment[]; right: DiffSegment[] };
}

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
    const ref = useRef<HTMLDivElement>(null);
    const narrow = useIsNarrow(ref);
    const rows: PreparedRow[] = useMemo(
        () =>
            pairDiffRows(diffLines(before ?? '', after ?? '')).map((row) =>
                row.state === 'changed' && row.left !== null && row.right !== null
                    ? { ...row, words: diffWords(row.left, row.right) }
                    : row
            ),
        [before, after]
    );
    const className = `wiw-diff${compact ? ' wiw-diff-compact' : ''}${narrow ? ' wiw-diff-unified' : ''}`;

    if (before === null || after === null) {
        // One side does not exist: a single column of the side that does.
        const present = before ?? after ?? '';
        const side: Side = before === null ? 'added' : 'removed';
        const lines = present === '' ? [] : present.split('\n');
        return (
            <div className={`${className} wiw-diff-unified`} ref={ref}>
                <div className="wiw-diff-title">
                    {before === null ? `${beforeLabel}: ${missingText}` : `${afterLabel}: ${missingText}`}
                </div>
                {lines.map((line, index) => (
                    <div key={index} className="wiw-diff-line">
                        <Cell number={index + 1} side={side} text={line} />
                    </div>
                ))}
            </div>
        );
    }

    if (narrow) {
        return (
            <div className={className} ref={ref}>
                <div className="wiw-diff-title">
                    <span className="wiw-diff-removed">− {beforeLabel}</span>{' '}
                    <span className="wiw-diff-added">+ {afterLabel}</span>
                </div>
                {rows.map((row, index) => {
                    const lines: JSX.Element[] = [];
                    if (row.state === 'same') {
                        lines.push(
                            <div key={`${String(index)}s`} className="wiw-diff-line">
                                <Cell number={row.rightNumber} side="same" text={row.right} />
                            </div>
                        );
                        return lines;
                    }
                    if (row.left !== null) {
                        lines.push(
                            <div key={`${String(index)}l`} className="wiw-diff-line">
                                <Cell number={row.leftNumber} side="removed" text={row.left} segments={row.words?.left} />
                            </div>
                        );
                    }
                    if (row.right !== null) {
                        lines.push(
                            <div key={`${String(index)}r`} className="wiw-diff-line">
                                <Cell number={row.rightNumber} side="added" text={row.right} segments={row.words?.right} />
                            </div>
                        );
                    }
                    return lines;
                })}
            </div>
        );
    }

    return (
        <div className={`${className} wiw-diff-split`} ref={ref}>
            <div className="wiw-diff-line wiw-diff-title">
                <span className="wiw-diff-heading">{beforeLabel}</span>
                <span className="wiw-diff-heading">{afterLabel}</span>
            </div>
            {rows.map((row, index) => (
                <div key={index} className="wiw-diff-line">
                    <Cell
                        number={row.leftNumber}
                        side={row.left === null ? 'empty' : row.state === 'same' ? 'same' : 'removed'}
                        text={row.left}
                        segments={row.words?.left}
                    />
                    <Cell
                        number={row.rightNumber}
                        side={row.right === null ? 'empty' : row.state === 'same' ? 'same' : 'added'}
                        text={row.right}
                        segments={row.words?.right}
                    />
                </div>
            ))}
        </div>
    );
}
