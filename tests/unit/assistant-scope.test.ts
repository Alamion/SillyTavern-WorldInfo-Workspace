import { describe, expect, it } from 'vitest';
import { resolveScope } from '../../src/core/assistant/scope';
import { NODE_IDS, aldermeerState } from '../fixtures/assistant/outline-aldermeer';

describe('resolveScope (spec 005 FR-021)', () => {
    const state = aldermeerState();

    it('uses the selected folder', () => {
        const scope = resolveScope(state, { kind: 'selection' }, [NODE_IDS.cities]);
        expect(scope.folderIds).toEqual([NODE_IDS.cities]);
        expect([...scope.nodeIds]).toEqual([NODE_IDS.cities, NODE_IDS.bristlemark, NODE_IDS.taverns]);
        expect(scope.dropped).toEqual([]);
    });

    it("uses the selected item's parent folder", () => {
        const scope = resolveScope(state, { kind: 'selection' }, [NODE_IDS.bristlemark]);
        expect(scope.folderIds).toEqual([NODE_IDS.cities]);
        expect(scope.nodeIds.has(NODE_IDS.taverns)).toBe(true);
    });

    it('falls back to the workspace root when nothing is selected', () => {
        const scope = resolveScope(state, { kind: 'selection' }, []);
        expect(scope.folderIds).toEqual([state.root.id]);
        expect(scope.nodeIds.has(NODE_IDS.map)).toBe(true);
    });

    it('unions chosen folders and reports missing ones', () => {
        const scope = resolveScope(
            state,
            { kind: 'folders', folderIds: [NODE_IDS.hearth, 'gone', NODE_IDS.cities] },
            []
        );
        expect(scope.folderIds).toEqual([NODE_IDS.hearth, NODE_IDS.cities]);
        expect(scope.dropped).toEqual(['gone']);
        expect(scope.nodeIds.has(NODE_IDS.bristlemark)).toBe(true);
        expect(scope.nodeIds.has(NODE_IDS.map)).toBe(false);
    });

    it('ignores non-folder ids in the folders scope', () => {
        const scope = resolveScope(state, { kind: 'folders', folderIds: [NODE_IDS.bristlemark] }, []);
        expect(scope.folderIds).toEqual([]);
        expect(scope.dropped).toEqual([NODE_IDS.bristlemark]);
    });

    it('takes the whole workspace', () => {
        const scope = resolveScope(state, { kind: 'workspace' }, [NODE_IDS.cities]);
        expect(scope.folderIds).toEqual([state.root.id]);
        // root + Aldermeer + Cities + 2 entries + Hearth & Home + image
        expect(scope.nodeIds.size).toBe(7);
        expect(scope.nodeIds.has(state.root.id)).toBe(true);
    });
});
