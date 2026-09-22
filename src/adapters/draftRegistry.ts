/**
 * Registry of uncommitted text-field drafts (spec 006 R3).
 *
 * Lives at the adapter layer, not inside the React hook, because the flush points
 * are outside React: the sync engine flushes before a generation and the shell
 * flushes when the workspace closes, next to the existing book-push and markdown
 * flushes. `ui/useDraftField.ts` is the only registrar.
 */

export interface DraftSlot {
    /** Commits this field's pending text; a no-op when nothing is pending. */
    flush: () => void;
    hasPending: () => boolean;
}

const slots = new Set<DraftSlot>();

export function registerDraftSlot(slot: DraftSlot): () => void {
    slots.add(slot);
    return () => {
        slots.delete(slot);
    };
}

/**
 * Commits every pending draft immediately. Safe to call at any time.
 * Nothing the user typed may be lost at a flush point.
 */
export function flushDrafts(): void {
    // Copy first — committing re-renders, which may mount or unmount fields.
    for (const slot of [...slots]) {
        slot.flush();
    }
}

/** True while at least one field holds text the store has not seen yet. */
export function hasPendingDrafts(): boolean {
    for (const slot of slots) {
        if (slot.hasPending()) {
            return true;
        }
    }
    return false;
}
