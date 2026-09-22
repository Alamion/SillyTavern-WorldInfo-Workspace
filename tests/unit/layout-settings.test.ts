import { describe, expect, it } from 'vitest';
import { clampLayoutSize, getLayoutSettings, LAYOUT_LIMITS, setLayoutSettings } from '../../src/core/state/layout';
import { createDefaultState, migrate } from '../../src/core/state/schema';

/** Region sizes kept across reloads (2026-09-22). */

describe('layout settings', () => {
    it('fills defaults for payloads written before the layout existed', () => {
        expect(getLayoutSettings(createDefaultState())).toEqual({
            treeWidth: LAYOUT_LIMITS.treeWidth.fallback,
            treeCollapsed: false,
            assistantWidth: LAYOUT_LIMITS.assistantWidth.fallback,
            previewWidth: LAYOUT_LIMITS.previewWidth.fallback,
        });
    });

    it('repairs hand-edited or stale values field by field', () => {
        const state = createDefaultState();
        (state.settings as unknown as Record<string, unknown>)['layout'] = {
            treeWidth: 9999,
            treeCollapsed: 'yes',
            assistantWidth: 'wide',
            previewWidth: 55.4,
        };
        expect(getLayoutSettings(state)).toEqual({
            treeWidth: LAYOUT_LIMITS.treeWidth.max,
            treeCollapsed: false,
            assistantWidth: LAYOUT_LIMITS.assistantWidth.fallback,
            previewWidth: 55,
        });
    });

    it('patches a new state and survives a reload through migrate', () => {
        const state = createDefaultState();
        const next = setLayoutSettings(state, { treeWidth: 420, treeCollapsed: true });
        expect(next).not.toBe(state);
        expect(state.settings.layout).toBeUndefined();
        const reloaded = migrate(JSON.parse(JSON.stringify(next)));
        expect(getLayoutSettings(reloaded)).toMatchObject({ treeWidth: 420, treeCollapsed: true });
    });

    it('returns the same state when nothing changes', () => {
        const once = setLayoutSettings(createDefaultState(), { treeWidth: 420 });
        expect(setLayoutSettings(once, { treeWidth: 420 })).toBe(once);
    });

    it('limits the assistant to a share of the workspace width', () => {
        expect(clampLayoutSize('assistantWidth', 900, 1000)).toBe(600);
        expect(clampLayoutSize('assistantWidth', 100, 1000)).toBe(LAYOUT_LIMITS.assistantWidth.min);
        expect(clampLayoutSize('treeWidth', 50)).toBe(LAYOUT_LIMITS.treeWidth.min);
    });
});
