import { describe, expect, it } from 'vitest';
import { applyContextSet, deleteContextSet, renameContextSet, saveContextSet } from '../../src/core/assistant/contextSets';
import { DEFAULT_CONTEXT_SETTINGS, type ContextSet } from '../../src/core/assistant/types';
import { aldermeerState, NODE_IDS } from '../fixtures/assistant/outline-aldermeer';

/** Named context sets (spec 007 R6). */

const CONTEXT = { ...DEFAULT_CONTEXT_SETTINGS, scope: { kind: 'folders' as const, folderIds: [NODE_IDS.cities] }, fuzzy: true };

describe('context sets', () => {
    it('saves a copy of the context under a new name', () => {
        const result = saveContextSet([], 'Factions', CONTEXT, () => 's1');
        expect(result).toEqual({ sets: [{ id: 's1', name: 'Factions', context: CONTEXT }] });
        if ('sets' in result) {
            expect(result.sets[0]?.context).not.toBe(CONTEXT);
        }
    });

    it('overwrites a set with the same name (case-insensitive) instead of duplicating', () => {
        const first = saveContextSet([], 'Factions', CONTEXT, () => 's1');
        const sets = 'sets' in first ? first.sets : [];
        const second = saveContextSet(sets, ' factions ', { ...CONTEXT, fuzzy: false }, () => 's2');
        expect('sets' in second && second.sets).toEqual([{ id: 's1', name: 'Factions', context: { ...CONTEXT, fuzzy: false } }]);
    });

    it('rejects empty and over-long names and the 51st set', () => {
        expect(saveContextSet([], '  ', CONTEXT, () => 'x')).toEqual({ error: 'Give the set a name.' });
        expect(saveContextSet([], 'x'.repeat(61), CONTEXT, () => 'x')).toEqual({ error: 'Names are at most 60 characters.' });
        const full: ContextSet[] = Array.from({ length: 50 }, (_, i) => ({ id: `s${String(i)}`, name: `Set ${String(i)}`, context: CONTEXT }));
        expect(saveContextSet(full, 'One more', CONTEXT, () => 'x')).toEqual({ error: 'At most 50 context sets can be saved.' });
    });

    it('renames and deletes', () => {
        const sets: ContextSet[] = [{ id: 's1', name: 'A', context: CONTEXT }, { id: 's2', name: 'B', context: CONTEXT }];
        expect(renameContextSet(sets, 's1', 'B')).toEqual({ error: 'A set with this name already exists.' });
        expect('sets' in renameContextSet(sets, 's1', 'C') && renameContextSet(sets, 's1', 'C')).toMatchObject({ sets: [{ name: 'C' }, { name: 'B' }] });
        expect(deleteContextSet(sets, 's1').map((set) => set.id)).toEqual(['s2']);
    });

    it('applies a copy and reports folders that no longer exist', () => {
        const set: ContextSet = { id: 's1', name: 'A', context: { ...CONTEXT, scope: { kind: 'folders', folderIds: [NODE_IDS.cities, 'gone'] } } };
        const applied = applyContextSet(set, aldermeerState());
        expect(applied.missing).toBe(1);
        expect(applied.context.scope).toEqual({ kind: 'folders', folderIds: [NODE_IDS.cities] });
        expect(applied.context).not.toBe(set.context);
    });
});
