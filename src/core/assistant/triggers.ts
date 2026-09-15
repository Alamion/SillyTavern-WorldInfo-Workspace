import type { EntryNode } from '../state/schema';

/**
 * Key-triggered entry selection for the assistant context (spec 005 FR-021a).
 * An entry's primary keys and its title are its triggers, as in World Info
 * scanning: plain keys match as whole words, case-insensitively; `/pattern/flags`
 * keys are regular expressions. Starting from seed texts (the request, the chat,
 * the selected entries) every matched entry's content is scanned in turn, so
 * the set grows recursively until nothing new matches.
 */

export type TriggerMatcher = (text: string) => boolean;

const REGEX_KEY = /^\/(.+)\/([a-z]*)$/s;
const MIN_PLAIN_LENGTH = 2;

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Compiles one trigger; returns null for triggers that would match everything. */
export function compileTrigger(trigger: string): RegExp | null {
    const value = trigger.trim();
    const regex = REGEX_KEY.exec(value);
    if (regex) {
        try {
            const flags = [...new Set(`${regex[2] ?? ''}`.replace(/[gy]/g, ''))].join('');
            const compiled = new RegExp(regex[1] ?? '', flags);
            return compiled.test('') ? null : compiled;
        } catch {
            // An invalid pattern is matched literally, like any other key.
        }
    }
    if (value.length < MIN_PLAIN_LENGTH) {
        return null;
    }
    return new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(value)}(?![\\p{L}\\p{N}_])`, 'iu');
}

export function matcherFor(entry: EntryNode): TriggerMatcher {
    const patterns = [...entry.native.key, entry.name]
        .map(compileTrigger)
        .filter((pattern): pattern is RegExp => pattern !== null);
    return (text) => patterns.some((pattern) => pattern.test(text));
}

export interface TriggerLayer {
    /** Entries first matched at this depth (0 = matched by the seed texts). */
    entries: EntryNode[];
}

/**
 * Expands the triggered set breadth-first. `seeds` are entries included
 * unconditionally (the user's selection); their content is scanned like the
 * seed texts. Returns the layers in order, seeds excluded.
 */
export function expandTriggers(
    candidates: readonly EntryNode[],
    seedTexts: readonly string[],
    seeds: readonly EntryNode[]
): TriggerLayer[] {
    const matchers = new Map(candidates.map((entry) => [entry.id, matcherFor(entry)]));
    const taken = new Set(seeds.map((entry) => entry.id));
    const layers: TriggerLayer[] = [];
    let texts = [...seedTexts, ...seeds.map((entry) => entry.native.content)].filter(
        (text) => text.trim() !== ''
    );
    while (texts.length > 0) {
        const scan = texts.join('\n');
        const matched = candidates.filter(
            (entry) => !taken.has(entry.id) && matchers.get(entry.id)?.(scan) === true
        );
        if (matched.length === 0) {
            break;
        }
        matched.forEach((entry) => taken.add(entry.id));
        layers.push({ entries: matched });
        texts = matched.map((entry) => entry.native.content);
    }
    return layers;
}
