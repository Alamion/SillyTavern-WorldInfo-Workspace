import type { TreeNode, WorkspaceState } from './schema';
import { withNodeCopied } from './sharing';

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
     *
     * This still deep-clones, and deliberately so: the recipe is opaque, so there
     * is no way to know which nodes it will touch, and a shared draft would let a
     * recipe write into the previous state. It is NOT on the typing path — edits
     * go through the pure operations in `core/tree/operations.ts` and `replace`,
     * which path-copy (spec 006 R1). Callers that mutate exactly one known node
     * should prefer `updateNode`.
     */
    update(recipe: (draft: WorkspaceState) => void): WorkspaceState {
        const draft = structuredClone(this.state);
        recipe(draft);
        this.state = draft;
        this.notify();
        return this.state;
    }

    /**
     * Mutates ONE node by id, copying only the root→node spine and leaving every
     * other subtree reference-identical. Returns false when the node is gone.
     */
    updateNode(nodeId: string, mutate: (node: TreeNode) => void): boolean {
        const copied = withNodeCopied(this.state, nodeId);
        if (!copied) {
            return false;
        }
        mutate(copied.node);
        this.state = copied.state;
        this.notify();
        return true;
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