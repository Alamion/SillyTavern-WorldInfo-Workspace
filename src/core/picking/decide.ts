/**
 * Which pick a generation uses (clarification 2026-10-07, research R9): a pick
 * prepared in the background after the last reply is used without waiting unless
 * the user's new text names an entry it lacks; then a fresh pick runs.
 */

export type PickDecision = 'skip' | 'reused' | 'prepared' | 'fresh';

export interface DecideInput {
    /** Generation type from the app's interceptor call. */
    type: string;
    /** Chat text written since the prepared pick was made. */
    newText: string;
    prepared: { picked: ReadonlySet<string> } | null;
    /** Ids of active entries whose names or keys appear in a text. */
    mentions: (text: string) => ReadonlySet<string>;
}

export function decidePick(input: DecideInput): PickDecision {
    if (input.type === 'quiet' || input.type === 'impersonate') {
        return 'skip';
    }
    if (input.type === 'continue') {
        return 'reused';
    }
    if (input.prepared === null) {
        return 'fresh';
    }
    for (const id of input.mentions(input.newText)) {
        if (!input.prepared.picked.has(id)) {
            return 'fresh';
        }
    }
    return 'prepared';
}
