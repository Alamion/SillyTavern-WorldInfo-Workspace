import type { LayoutSettings, WorkspaceState } from './schema';

/**
 * Region sizes that survive a reload (2026-09-22: they reset on every page load).
 * Pure module. Stored in the workspace settings like the sort mode; the caller
 * decides whether saving is allowed (never while a data recovery is pending).
 */

export const LAYOUT_LIMITS = {
    treeWidth: { min: 140, max: 640, fallback: 300 },
    assistantWidth: { min: 260, max: 2000, fallback: 360 },
    previewWidth: { min: 20, max: 80, fallback: 40 },
} as const;

/** Below this drag width the tree collapses instead of shrinking further. */
export const TREE_COLLAPSE_BELOW = 120;

/** The assistant never takes more than this share of the workspace width. */
export const ASSISTANT_MAX_SHARE = 0.6;

type SizeKey = keyof typeof LAYOUT_LIMITS;

function clampSize(key: SizeKey, value: unknown): number {
    const limits = LAYOUT_LIMITS[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return limits.fallback;
    }
    return Math.round(Math.min(Math.max(value, limits.min), limits.max));
}

export function getLayoutSettings(state: WorkspaceState): LayoutSettings {
    const raw: unknown = state.settings.layout;
    const record = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    return {
        treeWidth: clampSize('treeWidth', record['treeWidth']),
        treeCollapsed: record['treeCollapsed'] === true,
        assistantWidth: clampSize('assistantWidth', record['assistantWidth']),
        previewWidth: clampSize('previewWidth', record['previewWidth']),
    };
}

/** A NEW state with the repaired layout patched in; unchanged values keep the state. */
export function setLayoutSettings(state: WorkspaceState, patch: Partial<LayoutSettings>): WorkspaceState {
    const current = getLayoutSettings(state);
    const merged = { ...current, ...patch };
    const next = structuredClone(state);
    next.settings.layout = merged;
    next.settings.layout = getLayoutSettings(next);
    const same = (Object.keys(current) as Array<keyof LayoutSettings>).every(
        (key) => current[key] === next.settings.layout?.[key]
    );
    return same && state.settings.layout !== undefined ? state : next;
}

/** Clamps a dragged size; the assistant's maximum also depends on the workspace width. */
export function clampLayoutSize(key: SizeKey, value: number, containerWidth?: number): number {
    const clamped = clampSize(key, value);
    if (key === 'assistantWidth' && containerWidth !== undefined && containerWidth > 0) {
        return Math.round(
            Math.min(clamped, Math.max(LAYOUT_LIMITS.assistantWidth.min, containerWidth * ASSISTANT_MAX_SHARE))
        );
    }
    return clamped;
}
