import { describe, expect, it } from 'vitest';
import { forcedEntries } from '../../src/core/picking/forced';
import { createDefaultNativeEntry } from '../../src/core/state/schema';
import type { ActiveWorldInfoEntry } from '../../src/global';

/** Forced-activation objects (research R9: the scan inserts the PASSED object). */

function active(uid: number, fields: Partial<ActiveWorldInfoEntry> = {}): ActiveWorldInfoEntry {
    return { ...createDefaultNativeEntry(uid), world: 'Book', content: `Entry ${String(uid)}.`, position: 4, depth: 2, ...fields };
}

describe('forcedEntries', () => {
    it('passes full clones with world and empty decorators, keeping position and depth', () => {
        const source = active(1);
        const [forced] = forcedEntries([source]);
        expect(forced).toMatchObject({ uid: 1, world: 'Book', decorators: [], position: 4, depth: 2, content: 'Entry 1.' });
        expect(forced).not.toBe(source);
    });

    it('strips leading @@ decorator lines from the content', () => {
        const [forced] = forcedEntries([active(2, { content: '@@depth 3\n@@activate\nReal text.' })]);
        expect(forced?.content).toBe('Real text.');
    });

    it('never forces disabled entries', () => {
        expect(forcedEntries([active(3, { disable: true })])).toEqual([]);
    });
});
