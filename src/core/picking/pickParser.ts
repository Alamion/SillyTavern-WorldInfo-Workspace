/**
 * Pick lines of the picking model (contracts/main-chat-picking.md):
 * `<pick id="e12">short reason</pick>`, one per entry, or `<none/>` when nothing is
 * needed. Tolerant: thinking is ignored, unknown ids are counted, duplicates
 * collapse, and at most `max` picks are kept. Text outside picks is returned
 * (shortened) so a reply in another format can be shown as a failure instead of
 * passing for "nothing needed" (live 2026-10-09: a router sent the request to a
 * safety classifier that answered "User Safety: safe").
 */

export interface Pick {
    id: string;
    reason: string;
}

const NONE = /<none\s*\/?>(?:\s*<\/none\s*>)?/gi;
const STRAY_LIMIT = 80;
const PICK = /<pick\s+id\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>/]+))\s*(?:\/>|>([\s\S]*?)<\/pick\s*>)/gi;

export interface ParsedPicks {
    picks: Pick[];
    ignored: string[];
    /** The model said explicitly that nothing is needed. */
    none: boolean;
    /** Visible text outside pick and none tags, shortened. */
    stray: string;
}

export function parsePicks(text: string, valid: ReadonlySet<string>, max: number): ParsedPicks {
    const visible = text.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '');
    const picks: Pick[] = [];
    const ignored: string[] = [];
    const seen = new Set<string>();
    for (const match of visible.matchAll(PICK)) {
        const id = (match[1] ?? match[2] ?? match[3] ?? '').trim();
        if (id === '' || seen.has(id)) {
            continue;
        }
        seen.add(id);
        if (!valid.has(id)) {
            ignored.push(id);
            continue;
        }
        if (picks.length < max) {
            picks.push({ id, reason: (match[4] ?? '').replace(/\s+/g, ' ').trim() });
        }
    }
    const none = NONE.test(visible);
    NONE.lastIndex = 0;
    const rest = visible.replace(PICK, ' ').replace(NONE, ' ').replace(/\s+/g, ' ').trim();
    const stray = rest.length > STRAY_LIMIT ? `${rest.slice(0, STRAY_LIMIT)}…` : rest;
    return { picks, ignored, none, stray };
}
