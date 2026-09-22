import { useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

/**
 * Pointer-drag resizing shared by every splitter and the mobile sheet (2026-09-22:
 * three copies of the same handlers became one).
 *
 * The drag never re-renders React: `preview` writes the size straight to the DOM
 * on every pointermove, and `commit` hands the final value to state once, on
 * release. (Re-rendering the whole workspace per pointermove made dragging stutter
 * on slow machines.)
 */
export interface PointerResizeOptions {
    axis: 'x' | 'y';
    /** Size when the drag starts, in the caller's unit. */
    start: () => number;
    /**
     * Pointer movement (px, positive = right/down) → change of the size. Defaults to
     * the movement itself; pass e.g. `(px) => -px` for a handle on the far edge.
     */
    toDelta?: (movement: number, container: HTMLElement | null) => number;
    /** Keeps the size within limits (the container is the handle's parent). */
    clamp: (size: number, container: HTMLElement | null) => number;
    /** Applies a size to the DOM during the drag. */
    preview: (size: number) => void;
    /** Stores the final size once the pointer is released. */
    commit: (size: number, unclamped: number) => void;
    /**
     * Ends the drag early when the unclamped size falls below `at`
     * (e.g. collapsing the tree); `commit` is not called then.
     */
    collapse?: { at: number; onCollapse: () => void };
}

export interface PointerResizeHandlers {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
}

interface Drag {
    origin: number;
    start: number;
    size: number;
    unclamped: number;
    container: HTMLElement | null;
}

export function usePointerResize(options: PointerResizeOptions): PointerResizeHandlers {
    // Latest options without re-creating handlers mid-drag.
    const optionsRef = useRef(options);
    optionsRef.current = options;
    const dragRef = useRef<Drag | null>(null);

    const position = (event: ReactPointerEvent<HTMLElement>): number =>
        optionsRef.current.axis === 'x' ? event.clientX : event.clientY;

    const end = (event: ReactPointerEvent<HTMLElement>): void => {
        try {
            event.currentTarget.releasePointerCapture(event.pointerId);
        } catch {
            // capture may already be gone
        }
        dragRef.current = null;
    };

    return {
        onPointerDown(event) {
            if (event.button !== 0) {
                return;
            }
            const start = optionsRef.current.start();
            dragRef.current = {
                origin: position(event),
                start,
                size: start,
                unclamped: start,
                container: event.currentTarget.parentElement,
            };
            try {
                event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
                // capture is best-effort; the drag works while the pointer is down
            }
        },
        onPointerMove(event) {
            const drag = dragRef.current;
            if (!drag) {
                return;
            }
            const current = optionsRef.current;
            const movement = position(event) - drag.origin;
            const unclamped = drag.start + (current.toDelta ? current.toDelta(movement, drag.container) : movement);
            if (current.collapse && unclamped < current.collapse.at) {
                end(event);
                current.collapse.onCollapse();
                return;
            }
            drag.unclamped = unclamped;
            drag.size = current.clamp(unclamped, drag.container);
            current.preview(drag.size);
        },
        onPointerUp(event) {
            const drag = dragRef.current;
            if (!drag) {
                return;
            }
            end(event);
            if (drag.unclamped !== drag.start) {
                optionsRef.current.commit(drag.size, drag.unclamped);
            }
        },
        onPointerCancel(event) {
            const drag = dragRef.current;
            if (!drag) {
                return;
            }
            end(event);
            // Put the committed size back.
            optionsRef.current.preview(drag.start);
        },
    };
}

/** A vertical or horizontal drag handle between two regions. */
export function Splitter({
    className = 'wiw-splitter',
    title,
    onDoubleClick,
    ...options
}: PointerResizeOptions & {
    className?: string;
    title?: string;
    onDoubleClick?: () => void;
}): JSX.Element {
    const handlers = usePointerResize(options);
    return (
        <div
            className={className}
            role="separator"
            aria-orientation={options.axis === 'x' ? 'vertical' : 'horizontal'}
            title={title}
            onDoubleClick={onDoubleClick}
            {...handlers}
        />
    );
}
