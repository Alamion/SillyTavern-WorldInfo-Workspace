import { describe, expect, it } from 'vitest';
import { decidePick } from '../../src/core/picking/decide';

/** Prepared vs fresh (clarification 2026-10-07, research R9). */

const mentions = (text: string): Set<string> => new Set(['harbor', 'selene'].filter((name) => text.toLowerCase().includes(name)));

describe('decidePick', () => {
    it('uses the prepared pick when the new text mentions nothing it lacks', () => {
        expect(decidePick({ type: 'normal', newText: 'We walk on.', prepared: { picked: new Set(['harbor']) }, mentions })).toBe('prepared');
        expect(decidePick({ type: 'normal', newText: 'Back to the harbor.', prepared: { picked: new Set(['harbor']) }, mentions })).toBe('prepared');
    });

    it('asks for a fresh pick when the new text names an entry the prepared pick lacks', () => {
        expect(decidePick({ type: 'normal', newText: 'Selene speaks.', prepared: { picked: new Set(['harbor']) }, mentions })).toBe('fresh');
    });

    it('asks for a fresh pick when nothing is prepared', () => {
        expect(decidePick({ type: 'normal', newText: 'Hi', prepared: null, mentions })).toBe('fresh');
    });

    it('reuses the continued message on continue, and skips quiet and impersonate', () => {
        expect(decidePick({ type: 'continue', newText: '', prepared: null, mentions })).toBe('reused');
        expect(decidePick({ type: 'quiet', newText: 'Selene', prepared: null, mentions })).toBe('skip');
        expect(decidePick({ type: 'impersonate', newText: 'Selene', prepared: null, mentions })).toBe('skip');
    });

    it('treats swipe and regenerate like a normal turn', () => {
        expect(decidePick({ type: 'swipe', newText: 'x', prepared: { picked: new Set() }, mentions })).toBe('prepared');
        expect(decidePick({ type: 'regenerate', newText: 'Selene', prepared: { picked: new Set() }, mentions })).toBe('fresh');
    });
});
