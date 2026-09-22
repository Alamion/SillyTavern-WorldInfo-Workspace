import { useCallback, useEffect, useRef, useState } from 'react';

import { registerDraftSlot, type DraftSlot } from '../adapters/draftRegistry';

/**
 * Local draft for a text field, committed on a short debounce and on blur
 * (spec 006 R3).
 *
 * Editing commits on change (a Phase 1 trustworthiness decision), which means a
 * store write, a five-way notify fan-out, and sync plus markdown scheduling per
 * character. The draft keeps typing local and commits shortly after it stops.
 *
 * NOTHING MAY BE LOST. A pending draft is committed when the field blurs, when
 * the component unmounts, and when `flushDrafts()` is called — which the shell
 * does before generation and on workspace close, next to the existing sync and
 * markdown flushes.
 */

export const DRAFT_COMMIT_MS = 250;

export interface DraftField {
    /** What the input displays: the draft while typing, else the store value. */
    value: string;
    onChange: (next: string) => void;
    onBlur: () => void;
}

/**
 * `commit` is read through a ref, so a field that re-renders with a new callback
 * still commits through the latest one — and a flush during unmount commits
 * through the callback belonging to the item being left.
 *
 * Callers must give the editing surface a `key` tied to the item id, so moving to
 * another item remounts the field: that unmount commits the outgoing draft and
 * starts the new item with a clean one.
 */
export function useDraftField(
    value: string,
    commit: (next: string) => void,
    delay: number = DRAFT_COMMIT_MS
): DraftField {
    const [draft, setDraft] = useState<string | null>(null);
    const draftRef = useRef<string | null>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const commitRef = useRef(commit);
    commitRef.current = commit;

    const flush = useCallback((): void => {
        if (timerRef.current !== null) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        const pending = draftRef.current;
        if (pending === null) {
            return;
        }
        draftRef.current = null;
        setDraft(null);
        commitRef.current(pending);
    }, []);

    const slotRef = useRef<DraftSlot | null>(null);
    if (slotRef.current === null) {
        slotRef.current = {
            flush: () => {},
            hasPending: () => draftRef.current !== null,
        };
    }
    slotRef.current.flush = flush;

    useEffect(() => {
        const slot = slotRef.current;
        if (!slot) {
            return undefined;
        }
        const unregister = registerDraftSlot(slot);
        return () => {
            unregister();
            // Leaving the field must not drop what was typed into it.
            slot.flush();
        };
    }, []);

    const onChange = useCallback(
        (next: string): void => {
            draftRef.current = next;
            setDraft(next);
            if (timerRef.current !== null) {
                clearTimeout(timerRef.current);
            }
            timerRef.current = setTimeout(() => {
                timerRef.current = null;
                flush();
            }, delay);
        },
        [delay, flush]
    );

    return { value: draft ?? value, onChange, onBlur: flush };
}
