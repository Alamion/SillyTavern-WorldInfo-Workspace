import { describe, expect, it } from 'vitest';
import { readScene } from '../../src/core/interop/doomsTracker';

/** Doom's Enhancement Suite scene data (spec 007 R8, R14: JSON strings inside the tracker). */

const thoughts = (items: unknown[]) => JSON.stringify(items);

describe('readScene', () => {
    it('reads the present cast and the location from JSON strings (as stored live)', () => {
        const meta = {
            dooms_tracker: {
                lastGeneratedData: {
                    characterThoughts: thoughts([{ name: 'Seraphina', thoughts: '…' }, { name: 'Selene', present: false }]),
                    infoBox: JSON.stringify({ location: { value: 'Lunar Temple' } }),
                },
                committedTrackerData: { characterThoughts: null, infoBox: null },
            },
        };
        expect(readScene(meta)).toEqual({ present: ['Seraphina'], location: 'Lunar Temple' });
    });

    it('accepts arrays and objects as well as strings, and falls back to the committed data', () => {
        const meta = {
            dooms_tracker: {
                lastGeneratedData: { characterThoughts: null },
                committedTrackerData: { characterThoughts: [{ name: 'Ann' }], infoBox: { location: 'Harbor' } },
            },
        };
        expect(readScene(meta)).toEqual({ present: ['Ann'], location: 'Harbor' });
    });

    it('is unavailable before any tracker run (only known characters)', () => {
        expect(readScene({ dooms_tracker: { knownCharacters: { Ann: {} } } })).toBeNull();
    });

    it('is unavailable for malformed data, never throwing', () => {
        expect(readScene({ dooms_tracker: { lastGeneratedData: { characterThoughts: '{broken' } } })).toBeNull();
        expect(readScene(undefined)).toBeNull();
        expect(readScene({ dooms_tracker: 'x' })).toBeNull();
    });
});
