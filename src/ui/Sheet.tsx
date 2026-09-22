import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { usePointerResize } from './Splitter';

/** Snap points as shares of the reachable height. */
const SHEET_SIZES: readonly number[] = [0.14, 0.5, 0.82, 1];
/** Released below this share, the sheet closes. */
const CLOSE_BELOW = 0.1;
const SNAP_MS = 200;

/**
 * Height the sheet may take: from its bottom edge up to the top of the World Info
 * drawer, so the full size covers the whole drawer like the native Worlds/Lorebooks
 * panel (owner report 2026-09-22: it stopped below the workspace header). The
 * sheet stays inside the workspace container (keystroke isolation in mount.tsx)
 * and extends upward past it.
 */
function reachOf(sheet: HTMLElement): number {
    const surface = sheet.parentElement;
    if (!surface) {
        return window.innerHeight;
    }
    const drawer = surface.closest<HTMLElement>('#WorldInfo') ?? surface;
    return Math.max(0, surface.getBoundingClientRect().bottom - drawer.getBoundingClientRect().top);
}

function Sheet({
    onClose,
    children,
}: {
    onClose: () => void;
    children: ReactNode;
}): JSX.Element {
    const [size, setSize] = useState(0.82);
    const [reach, setReach] = useState(0);
    const sheetRef = useRef<HTMLDivElement | null>(null);

    // The reach changes with the on-screen keyboard and rotation.
    useLayoutEffect(() => {
        const sheet = sheetRef.current;
        if (!sheet) {
            return;
        }
        const measure = (): void => setReach(reachOf(sheet));
        measure();
        window.addEventListener('resize', measure);
        const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
        if (sheet.parentElement) {
            observer?.observe(sheet.parentElement);
        }
        return () => {
            window.removeEventListener('resize', measure);
            observer?.disconnect();
        };
    }, []);

    const setHeight = (px: number, animate: boolean): void => {
        const sheet = sheetRef.current;
        if (!sheet) {
            return;
        }
        sheet.classList.toggle('wiw-sheet-snapping', animate);
        sheet.style.height = `${String(Math.round(px))}px`;
    };

    const drag = usePointerResize({
        axis: 'y',
        start: () => sheetRef.current?.getBoundingClientRect().height ?? size * reach,
        // The handle is on the top edge: dragging up grows the sheet.
        toDelta: (movement) => -movement,
        clamp: (height) => Math.min(Math.max(height, 40), reach > 0 ? reach : window.innerHeight),
        preview: (height) => setHeight(height, false),
        commit: (height) => {
            const full = reach > 0 ? reach : window.innerHeight;
            if (height < full * CLOSE_BELOW) {
                onClose();
                return;
            }
            let nearest: number = SHEET_SIZES[0] ?? 0.82;
            for (const candidate of SHEET_SIZES) {
                if (Math.abs(candidate * full - height) < Math.abs(nearest * full - height)) {
                    nearest = candidate;
                }
            }
            // Glide to the snap point instead of jumping there.
            setHeight(nearest * full, true);
            window.setTimeout(() => sheetRef.current?.classList.remove('wiw-sheet-snapping'), SNAP_MS + 50);
            setSize(nearest);
        },
    });

    const full = size >= 1;
    return (
        <div
            className={`wiw-sheet${full ? ' wiw-sheet-full' : ''}`}
            ref={sheetRef}
            style={{ height: reach > 0 ? `${String(Math.round(size * reach))}px` : `${String(Math.round(size * 100))}%` }}
        >
            <div className="wiw-sheet-bar" {...drag}>
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
