import { describe, expect, it } from 'vitest';
import { truncateAtSentence } from '../../src/core/assistant/truncate';

/** Sentence-boundary truncation (spec 007 R7). */

describe('truncateAtSentence', () => {
    const text = 'First sentence. Second one! Third? Fourth sentence is longer than the rest.';

    it('cuts at the last sentence end inside the room', () => {
        expect(truncateAtSentence(text, 40)).toEqual({ text: 'First sentence. Second one! Third?', keptShare: 34 / text.length });
    });

    it('treats a blank line and CJK punctuation as sentence ends', () => {
        expect(truncateAtSentence('Para one\n\nPara two goes on', 15)?.text).toBe('Para one');
        expect(truncateAtSentence('第一句。第二句很长很长很长很长', 6)?.text).toBe('第一句。');
    });

    it('returns null when no sentence end fits', () => {
        expect(truncateAtSentence('One very long sentence without any end', 10)).toBeNull();
    });

    it('returns the whole text when it fits', () => {
        expect(truncateAtSentence('Short.', 100)).toEqual({ text: 'Short.', keptShare: 1 });
    });
});
