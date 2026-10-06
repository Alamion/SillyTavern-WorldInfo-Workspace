import { describe, expect, it } from 'vitest';
import { losesMemoryNumber, memoryBadge } from '../../src/core/interop/memoryBooks';
import { createDefaultNativeEntry } from '../../src/core/state/schema';

/** Memory Books entries, recognized from their data only (spec 007 R8, R14). */

function native(fields: Record<string, unknown>, comment = 'Entry') {
    return { ...createDefaultNativeEntry(1), comment, ...fields };
}

describe('memoryBadge', () => {
    it('recognizes a memory by its marker field', () => {
        expect(memoryBadge(native({ stmemorybooks: true }, '001 - Arrival'))).toEqual({ kind: 'memory', label: 'Memory' });
    });

    it('recognizes summary tiers', () => {
        expect(memoryBadge(native({ stmemorybooks: true, stmbSummary: true, stmbSummaryTier: 2 }, 'Arc'))).toEqual({
            kind: 'summary',
            label: 'Tier 2',
        });
    });

    it('recognizes side prompts and clips by their title suffix', () => {
        expect(memoryBadge(native({}, 'Plot (STMB SidePrompt)'))?.kind).toBe('side-prompt');
        expect(memoryBadge(native({}, 'Score (STMB Scoreboard)'))?.label).toBe('Scoreboard');
        expect(memoryBadge(native({}, 'Moment [STMB Clip]'))?.kind).toBe('clip');
    });

    it('ignores ordinary entries', () => {
        expect(memoryBadge(native({}, 'Bristlemark'))).toBeNull();
        expect(memoryBadge(native({ stmemorybooks: 'yes' }, 'Odd'))).toBeNull();
    });
});

describe('losesMemoryNumber', () => {
    it('detects a rename that drops the number prefix, with or without brackets', () => {
        expect(losesMemoryNumber('001 - Arrival', 'Arrival')).toBe(true);
        expect(losesMemoryNumber('[002] - Crossing', 'Crossing')).toBe(true);
    });

    it('allows renames that keep a number and names that never had one', () => {
        expect(losesMemoryNumber('001 - Arrival', '001 - The arrival')).toBe(false);
        expect(losesMemoryNumber('[001] - Arrival', '[001] - Night arrival')).toBe(false);
        expect(losesMemoryNumber('Arrival', 'Night arrival')).toBe(false);
    });
});
