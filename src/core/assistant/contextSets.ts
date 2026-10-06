import { findNode, type WorkspaceState } from '../state/schema';
import type { ContextSet, ContextSettings } from './types';

/**
 * Named context sets (spec 007 FR-011, research R6): saved copies of a
 * conversation's context choices. Applying copies the values — later edits of a
 * set never change past requests.
 */

export const MAX_SETS = 50;
const MAX_NAME = 60;

type Result = { sets: ContextSet[] } | { error: string };

function sameName(a: string, b: string): boolean {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function nameError(name: string): string | null {
    const trimmed = name.trim();
    if (trimmed === '') {
        return 'Give the set a name.';
    }
    if (trimmed.length > MAX_NAME) {
        return `Names are at most ${String(MAX_NAME)} characters.`;
    }
    return null;
}

/** Saves under `name`; an existing set with that name is overwritten. */
export function saveContextSet(
    sets: readonly ContextSet[],
    name: string,
    context: ContextSettings,
    newId: () => string
): Result {
    const error = nameError(name);
    if (error !== null) {
        return { error };
    }
    const copy = structuredClone(context);
    const existing = sets.find((set) => sameName(set.name, name));
    if (existing) {
        return { sets: sets.map((set) => (set.id === existing.id ? { ...set, context: copy } : set)) };
    }
    if (sets.length >= MAX_SETS) {
        return { error: `At most ${String(MAX_SETS)} context sets can be saved.` };
    }
    return { sets: [...sets, { id: newId(), name: name.trim(), context: copy }] };
}

export function renameContextSet(sets: readonly ContextSet[], id: string, name: string): Result {
    const error = nameError(name);
    if (error !== null) {
        return { error };
    }
    if (sets.some((set) => set.id !== id && sameName(set.name, name))) {
        return { error: 'A set with this name already exists.' };
    }
    return { sets: sets.map((set) => (set.id === id ? { ...set, name: name.trim() } : set)) };
}

export function deleteContextSet(sets: readonly ContextSet[], id: string): ContextSet[] {
    return sets.filter((set) => set.id !== id);
}

/** The set's context for a conversation; folders that no longer exist are dropped and counted. */
export function applyContextSet(set: ContextSet, state: WorkspaceState): { context: ContextSettings; missing: number } {
    const context = structuredClone(set.context);
    let missing = 0;
    if (context.scope.kind === 'folders') {
        const kept = context.scope.folderIds.filter((id) => findNode(state, id)?.kind === 'folder');
        missing = context.scope.folderIds.length - kept.length;
        context.scope = { kind: 'folders', folderIds: kept };
    }
    return { context, missing };
}
