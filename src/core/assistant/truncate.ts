/**
 * Sentence-boundary truncation (spec 007 R7): the last entry that does not fit
 * keeps its beginning up to a sentence end instead of being dropped whole.
 */

const SENTENCE_END = /[.!?…](?=\s|$)|[。！？]|\n\s*\n/g;

export interface Truncated {
    text: string;
    /** Kept characters / original characters. */
    keptShare: number;
}

export function truncateAtSentence(text: string, maxChars: number): Truncated | null {
    if (text.length <= maxChars) {
        return { text, keptShare: 1 };
    }
    let cut = -1;
    for (const match of text.matchAll(SENTENCE_END)) {
        const end = match[0].startsWith('\n') ? match.index : match.index + match[0].length;
        if (end > maxChars) {
            break;
        }
        cut = end;
    }
    if (cut <= 0) {
        return null;
    }
    const kept = text.slice(0, cut).trimEnd();
    return { text: kept, keptShare: kept.length / text.length };
}
