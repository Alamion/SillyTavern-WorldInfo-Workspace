import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';

const SHEET_SIZES: readonly number[] = [0.14, 0.5, 0.82, 1];

function Sheet({
    onClose,
    children,
}: {
    onClose: () => void;
    children: ReactNode;
}): JSX.Element {
    const [size, setSize] = useState(0.82);
    const sheetRef = useRef<HTMLDivElement | null>(null);
    const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);

    const onBarDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
        dragRef.current = {
            startY: event.clientY,
            startHeight: (sheetRef.current?.parentElement?.clientHeight ?? window.innerHeight) * size,
        };
        try {
            event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
            // capture is best-effort; drag still works while the pointer is down
        }
    };

    const onBarMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
        const drag = dragRef.current;
        if (!drag || !sheetRef.current) {
            return;
        }
        const height = Math.min(
            Math.max(drag.startHeight + (drag.startY - event.clientY), 40),
            sheetRef.current.parentElement?.clientHeight ?? window.innerHeight
        );
        sheetRef.current.style.height = `${height}px`;
    };

    const onBarUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
        const drag = dragRef.current;
        if (!drag) {
            return;
        }
        dragRef.current = null;
        const parentHeight = sheetRef.current?.parentElement?.clientHeight ?? window.innerHeight;
        const finalHeight = Math.max(0, drag.startHeight + (drag.startY - event.clientY));
        if (finalHeight < parentHeight * 0.1) {
            onClose();
            return;
        }
        let nearest: number = SHEET_SIZES[0] ?? 0.82;
        let bestDelta = Number.POSITIVE_INFINITY;
        for (const candidate of SHEET_SIZES) {
            const delta = Math.abs(candidate * parentHeight - finalHeight);
            if (delta < bestDelta) {
                bestDelta = delta;
                nearest = candidate;
            }
        }
        if (sheetRef.current) {
            sheetRef.current.style.height = '';
        }
        setSize(nearest);
    };

    const full = size >= 1;
    return (
        <div
            className={`wiw-sheet${full ? ' wiw-sheet-full' : ''}`}
            ref={sheetRef}
            style={{ height: `${Math.round(size * 100)}%` }}
        >
            <div
                className="wiw-sheet-bar"
                onPointerDown={onBarDown}
                onPointerMove={onBarMove}
                onPointerUp={onBarUp}
                onPointerCancel={() => {
                    dragRef.current = null;
                }}
            >
                <span className="wiw-sheet-handle" />
                <button
                    type="button"
                    className="wiw-button"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={onClose}
                >
                    <i className="fa-solid fa-xmark" />
                </button>
            </div>
            <div className="wiw-sheet-content">{children}</div>
        </div>
    );
}

export default Sheet;
