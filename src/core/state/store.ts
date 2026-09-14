import type { WorkspaceState } from './schema';

/**
 * Framework-free observable store holding the immutable WorkspaceState.
 *
 * `update()` hands the recipe a structured clone; the previous state is never
 * mutated, so `getState()` is a stable snapshot reference between updates —
 * directly compatible with React's `useSyncExternalStore`.
 *
 * `getState` and `subscribe` are instance-bound arrow methods on purpose: they
 * are passed to React's `useSyncExternalStore` as detached references
 * (`useSyncExternalStore(store.subscribe, store.getState)`), where a prototype
 * method would lose its `this`.
 */
export class WorkspaceStore {
    private state: WorkspaceState;
    private readonly listeners = new Set<() => void>();

    constructor(initial: WorkspaceState) {
        this.state = initial;
    }

    getState = (): WorkspaceState => {
        return this.state;
    };

    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };

    /**
     * Applies the recipe to a clone and publishes it. Recipes must not capture
     * the draft beyond the call (the draft becomes the new state by reference).
     */
    update(recipe: (draft: WorkspaceState) => void): WorkspaceState {
        const draft = structuredClone(this.state);
        recipe(draft);
        this.state = draft;
        this.notify();
        return this.state;
    }

    /** Publishes an already-immutable state (result of pure tree operations). */
    replace(next: WorkspaceState): void {
        this.state = next;
        this.notify();
    }

    private notify(): void {
        for (const listener of this.listeners) {
            listener();
        }
    }
}