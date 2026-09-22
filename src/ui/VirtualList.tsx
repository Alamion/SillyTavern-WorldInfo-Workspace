import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';

/**
 * Fixed-row windowing (spec 006 R5).
 *
 * Expanding a 1000-entry folder put 1000 rows in the DOM. Memoized rows stopped
 * them re-rendering, but creating and laying them out still costs on every
 * expand. This renders only the visible slice plus an overscan, with spacer
 * elements standing in for the rest.
 *
 * Hand-rolled rather than a dependency: the requirement is a fixed-height window
 * over a list, and this project owns its markdown renderer and diff for the same
 * reason.
 *
 * Rows MUST be uniform height — `.wiw-tree-row` is a single line
 * (`white-space: nowrap` + ellipsis), and the real height is measured from the
 * first rendered row rather than assumed. Below `threshold` items nothing is
 * virtualized at all, so ordinary workspaces behave exactly as before.
 */

export interface VirtualListProps<T> {
    items: readonly T[];
    /** The scrolling ancestor. */
    scrollRef: RefObject<HTMLElement | null>;
    keyOf: (item: T, index: number) => string;
    renderItem: (item: T, index: number) => ReactNode;
    /** Render everything below this many items. */
    threshold?: number;
    overscan?: number;
    estimatedRowHeight?: number;
}

interface Range {
    start: number;
    end: number;
}

export function VirtualList<T>({
    items,
    scrollRef,
    keyOf,
    renderItem,
    threshold = 200,
    overscan = 10,
    estimatedRowHeight = 24,
}: VirtualListProps<T>): JSX.Element {
    const wrapRef = useRef<HTMLDivElement>(null);
    const rowHeightRef = useRef(estimatedRowHeight);
    const [range, setRange] = useState<Range>({ start: 0, end: items.length });
    const virtual = items.length > threshold;

    // Measure before paint so the first windowed frame uses the real height.
    useLayoutEffect(() => {
        const row = wrapRef.current?.querySelector<HTMLElement>('[data-vrow]');
        if (row && row.offsetHeight > 0) {
            rowHeightRef.current = row.offsetHeight;
        }
    });

    useEffect(() => {
        if (!virtual) {
            setRange((prev) =>
                prev.start === 0 && prev.end === items.length
                    ? prev
                    : { start: 0, end: items.length }
            );
            return undefined;
        }
        const scroller = scrollRef.current;
        const wrap = wrapRef.current;
        if (!scroller || !wrap) {
            return undefined;
        }
        const recompute = (): void => {
            const rowHeight = Math.max(1, rowHeightRef.current);
            // Distance from the top of the scrollable content to this list.
            const offset =
                wrap.getBoundingClientRect().top -
                scroller.getBoundingClientRect().top +
                scroller.scrollTop;
            const firstVisible = Math.floor((scroller.scrollTop - offset) / rowHeight);
            const visibleCount = Math.ceil(scroller.clientHeight / rowHeight);
            const start = Math.max(0, firstVisible - overscan);
            const end = Math.min(items.length, Math.max(start, firstVisible + visibleCount + overscan));
            setRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
        };
        recompute();
        scroller.addEventListener('scroll', recompute, { passive: true });
        const observer = new ResizeObserver(recompute);
        observer.observe(scroller);
        return () => {
            scroller.removeEventListener('scroll', recompute);
            observer.disconnect();
        };
    }, [virtual, items.length, scrollRef, overscan]);

    const start = virtual ? Math.min(range.start, items.length) : 0;
    const end = virtual ? Math.min(range.end, items.length) : items.length;
    const rowHeight = rowHeightRef.current;
    // Items are rendered WITHOUT a wrapper element — a per-row div would add a
    // DOM level under `.wiw-tree` and change layout. Each rendered row carries
    // `data-vrow` itself, which is what the height measurement looks for.
    const slice: ReactNode[] = [];
    for (let index = start; index < end; index += 1) {
        const item = items[index];
        if (item === undefined) {
            continue;
        }
        slice.push(<Fragment key={keyOf(item, index)}>{renderItem(item, index)}</Fragment>);
    }

    return (
        <div ref={wrapRef}>
            {virtual && start > 0 && <div style={{ height: `${start * rowHeight}px` }} />}
            {slice}
            {virtual && end < items.length && (
                <div style={{ height: `${(items.length - end) * rowHeight}px` }} />
            )}
        </div>
    );
}
