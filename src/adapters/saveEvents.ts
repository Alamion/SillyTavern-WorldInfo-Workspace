/**
 * Process-wide save-outcome events shared by the persistence adapters. Settings
 * saves go through the app's own `saveSettingsDebounced` and are not interceptable
 * (research R1) — failures there are surfaced by the app itself. Book saves are
 * fully ours: `worldInfoAdapter` emits success/failure here so the UI banner can
 * offer retry (FR-009).
 */
export interface SaveFailureEvent {
    kind: 'failure';
    scope: 'book' | 'settings';
    bookName?: string;
    message: string;
}

export interface SaveSuccessEvent {
    kind: 'success';
    scope: 'book';
    bookName: string;
}

export type SaveEvent = SaveFailureEvent | SaveSuccessEvent;

const listeners = new Set<(event: SaveEvent) => void>();

export function onSaveEvent(listener: (event: SaveEvent) => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function emitSaveEvent(event: SaveEvent): void {
    for (const listener of listeners) {
        listener(event);
    }
}