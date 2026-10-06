/**
 * Pick lines of the picking model (contracts/main-chat-picking.md):
 * `<pick id="e12">short reason</pick>`, one per entry. Tolerant: prose and
 * thinking are ignored, unknown ids are counted, duplicates collapse, and at most
 * `max` picks are kept.
 */

export interface Pick {
    id: string;
    reason: string;
}

const PICK = /<pick\s+id\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>/]+))\s*(?:\/>|>([\s\S]*?)<\/pick\s*>)/gi;

export function parsePicks(text: string, valid: ReadonlySet<string>, max: number): { picks: Pick[]; ignored: string[] } {
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
    return { picks, ignored };
}
