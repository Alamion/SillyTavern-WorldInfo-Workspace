import type { NativeWorldInfoEntry } from '../../global';
import { FIELD_SPECS, OWNED_PREFIX } from '../md/convention';
import type { OperationType, UnparsedBlock } from './types';

/**
 * Tolerant, incremental parser for the assistant protocol (contract:
 * contracts/assistant-protocol.md, research R3). Deliberately NOT an XML parser:
 * content is taken verbatim, unknown attributes are ignored, and every block is
 * parsed on its own so one broken block never discards the rest (FR-027).
 *
 * `parseReply(accumulated)` is called on every streaming chunk with the text so
 * far: an unterminated trailing block is never exposed, and the final call
 * (`final: true`) reports it as truncated.
 */

export interface ParsedBlock {
    type: OperationType;
    attrs: Record<string, string>;
    tags: {
        title?: string;
        keys?: string[];
        secondaryKeys?: string[];
        content?: string;
        fields?: Partial<NativeWorldInfoEntry>;
    };
    raw: string;
}

export interface ParsedReply {
    /** Prose with blocks, reasoning and code fences removed. */
    prose: string;
    blocks: ParsedBlock[];
    unparsed: UnparsedBlock[];
    reasoning: string;
    /** `[[handle]]` references found in the prose. */
    references: string[];
}

const OPERATION_TYPES: ReadonlySet<string> = new Set<OperationType>([
    'create_entry',
    'edit_entry',
    'create_folder',
    'rename',
    'move',
    'delete',
]);

const VALUE_TAGS = ['title', 'keys', 'secondary_keys', 'content', 'fields'] as const;
const EXCERPT_LIMIT = 200;

/** Scalar field rows of the markdown convention, keyed without the `wi_` prefix. */
const SCALAR_FIELDS = new Map(
    FIELD_SPECS.filter(
        (spec) => spec.type !== 'list' && spec.type !== 'object' && spec.type !== 'filter'
    ).map((spec) => [spec.key.slice(OWNED_PREFIX.length), spec])
);

function excerpt(raw: string): string {
    const trimmed = raw.trim().replace(/\s+/g, ' ');
    return trimmed.length > EXCERPT_LIMIT ? `${trimmed.slice(0, EXCERPT_LIMIT)}…` : trimmed;
}

/** Removes `<think>`/`<thinking>` spans and returns them as reasoning. */
function extractReasoning(text: string): { text: string; reasoning: string } {
    const reasoning: string[] = [];
    let rest = text;
    const closed = /<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/gi;
    rest = rest.replace(closed, (_match, inner: string) => {
        reasoning.push(inner.trim());
        return '';
    });
    // An unclosed think span at the very start is a reply that is still thinking.
    const open = /^\s*<think(?:ing)?>([\s\S]*)$/i.exec(rest);
    if (open) {
        reasoning.push((open[1] ?? '').trim());
        rest = '';
    }
    return { text: rest, reasoning: reasoning.filter((item) => item !== '').join('\n\n') };
}

function parseAttributes(head: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    const pattern = /([A-Za-z_][\w-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
    let match = pattern.exec(head);
    while (match !== null) {
        const name = (match[1] ?? '').toLowerCase();
        const value = match[3] ?? match[4] ?? match[5] ?? '';
        // Sloppy quoting ("ref='new1>") leaves the stray quote in the value.
        attrs[name] = value.replace(/^['"]|['"]$/g, '').trim();
        match = pattern.exec(head);
    }
    return attrs;
}

function readTag(body: string, tag: string): string | undefined {
    const open = new RegExp(`<${tag}\\s*>`, 'i').exec(body);
    if (!open || open.index === undefined) {
        return undefined;
    }
    const from = open.index + open[0].length;
    const close = new RegExp(`</${tag}\\s*>`, 'i').exec(body.slice(from));
    // A missing closing tag takes the rest of the block (contract rule 3).
    const value = close ? body.slice(from, from + close.index) : body.slice(from);
    return value;
}

function splitList(value: string): string[] {
    const seen = new Set<string>();
    const items: string[] = [];
    for (const piece of value.split(/[,\n]/)) {
        const item = piece.trim();
        const key = item.toLowerCase();
        if (item !== '' && !seen.has(key)) {
            seen.add(key);
            items.push(item);
        }
    }
    return items;
}

function parseFieldValue(
    name: string,
    raw: string
): { field: keyof NativeWorldInfoEntry; value: unknown } | { error: string } {
    const spec = SCALAR_FIELDS.get(name);
    if (!spec) {
        return { error: `unknown field "${name}"` };
    }
    const text = raw.trim();
    const lower = text.toLowerCase();
    const asBoolean = (): boolean | undefined =>
        ['true', 'yes', 'on'].includes(lower)
            ? true
            : ['false', 'no', 'off'].includes(lower)
              ? false
              : undefined;
    switch (spec.type) {
        case 'boolean': {
            const value = asBoolean();
            if (value === undefined) {
                return { error: `field "${name}" expects true or false` };
            }
            return { field: spec.field, value: spec.invert === true ? !value : value };
        }
        case 'nullable-boolean': {
            if (lower === 'null') {
                return { field: spec.field, value: null };
            }
            const value = asBoolean();
            if (value === undefined) {
                return { error: `field "${name}" expects true, false or null` };
            }
            return { field: spec.field, value };
        }
        case 'number': {
            const value = Number(text);
            if (!Number.isFinite(value)) {
                return { error: `field "${name}" expects a number` };
            }
            return { field: spec.field, value };
        }
        case 'nullable-number': {
            if (lower === 'null') {
                return { field: spec.field, value: null };
            }
            const value = Number(text);
            if (!Number.isFinite(value)) {
                return { error: `field "${name}" expects a number or null` };
            }
            return { field: spec.field, value };
        }
        case 'number-or-boolean': {
            const bool = asBoolean();
            if (bool !== undefined) {
                return { field: spec.field, value: bool ? 1 : 0 };
            }
            const value = Number(text);
            if (!Number.isFinite(value)) {
                return { error: `field "${name}" expects a number or true/false` };
            }
            return { field: spec.field, value };
        }
        case 'enum': {
            const names = spec.enumNames ?? [];
            const byName = names.indexOf(lower);
            if (byName >= 0) {
                return { field: spec.field, value: byName };
            }
            const numeric = Number(text);
            if (Number.isInteger(numeric) && numeric >= 0 && numeric < names.length) {
                return { field: spec.field, value: numeric };
            }
            return { error: `field "${name}" expects one of ${names.join(', ')}` };
        }
        default:
            return { field: spec.field, value: text };
    }
}

function parseFields(
    raw: string
): { fields: Partial<NativeWorldInfoEntry> } | { error: string } {
    const fields: Partial<NativeWorldInfoEntry> = {};
    for (const pair of raw.split(/[,\n]/)) {
        const text = pair.trim();
        if (text === '') {
            continue;
        }
        const at = text.indexOf('=');
        if (at < 0) {
            return { error: `field "${text}" is not name=value` };
        }
        const parsed = parseFieldValue(text.slice(0, at).trim().toLowerCase(), text.slice(at + 1));
        if ('error' in parsed) {
            return { error: parsed.error };
        }
        (fields as Record<string, unknown>)[parsed.field] = parsed.value;
    }
    return { fields };
}

const REQUIRED_ATTRS: Readonly<Record<OperationType, string[]>> = {
    create_entry: ['parent'],
    edit_entry: ['id'],
    create_folder: ['parent'],
    rename: ['id'],
    move: ['id', 'parent'],
    delete: ['id'],
};

function trimContent(value: string): string {
    return value.replace(/^\n/, '').replace(/\n$/, '');
}

function buildBlock(
    typeRaw: string,
    head: string,
    body: string,
    raw: string
): ParsedBlock | UnparsedBlock {
    const type = typeRaw.toLowerCase();
    if (!OPERATION_TYPES.has(type)) {
        return {
            kind: 'malformed-block',
            excerpt: excerpt(raw),
            reason: `unknown operation type "${typeRaw}"`,
        };
    }
    const operation = type as OperationType;
    const attrs = parseAttributes(head);
    const missing = REQUIRED_ATTRS[operation].filter(
        (name) => attrs[name] === undefined || attrs[name] === ''
    );
    if (missing.length > 0) {
        return {
            kind: 'malformed-block',
            excerpt: excerpt(raw),
            reason: `${operation} needs ${missing.join(' and ')}`,
        };
    }
    const tags: ParsedBlock['tags'] = {};
    for (const tag of VALUE_TAGS) {
        const value = readTag(body, tag);
        if (value === undefined) {
            continue;
        }
        if (tag === 'title') {
            tags.title = value.trim();
        } else if (tag === 'keys') {
            tags.keys = splitList(value);
        } else if (tag === 'secondary_keys') {
            tags.secondaryKeys = splitList(value);
        } else if (tag === 'content') {
            tags.content = trimContent(value);
        } else {
            const parsed = parseFields(value);
            if ('error' in parsed) {
                return { kind: 'malformed-block', excerpt: excerpt(raw), reason: parsed.error };
            }
            tags.fields = parsed.fields;
        }
    }
    const needsTitle = operation === 'create_entry' || operation === 'create_folder' || operation === 'rename';
    if (needsTitle && (tags.title === undefined || tags.title === '')) {
        return { kind: 'malformed-block', excerpt: excerpt(raw), reason: `${operation} needs a title` };
    }
    if (operation === 'edit_entry' && Object.keys(tags).length === 0) {
        return {
            kind: 'malformed-block',
            excerpt: excerpt(raw),
            reason: 'edit_entry needs at least one changed value',
        };
    }
    return { type: operation, attrs, tags, raw };
}

/** An operation written as a call with named arguments, e.g. `edit_entry(id='e25', …)`. */
const FUNCTION_CALL_PATTERN = new RegExp(
    `<\\|tool_call_start\\|>|\\b(?:${[...OPERATION_TYPES].join('|')})\\s*\\(\\s*[a-z_]+\\s*=`,
    'i'
);

export function parseReply(text: string, options: { final?: boolean } = {}): ParsedReply {
    const { text: withoutReasoning, reasoning } = extractReasoning(text);
    const blocks: ParsedBlock[] = [];
    const unparsed: UnparsedBlock[] = [];
    const proseParts: string[] = [];
    let cursor = 0;
    const openPattern = /<op\b/gi;
    for (;;) {
        openPattern.lastIndex = cursor;
        const open = openPattern.exec(withoutReasoning);
        if (!open) {
            proseParts.push(withoutReasoning.slice(cursor));
            break;
        }
        proseParts.push(withoutReasoning.slice(cursor, open.index));
        const headEnd = withoutReasoning.indexOf('>', open.index);
        const closeAt = headEnd >= 0 ? withoutReasoning.toLowerCase().indexOf('</op>', headEnd) : -1;
        if (headEnd < 0 || closeAt < 0) {
            // Unterminated block: hidden while streaming, truncated when final.
            if (options.final === true) {
                unparsed.push({
                    kind: 'truncated',
                    excerpt: excerpt(withoutReasoning.slice(open.index)),
                    reason: 'the reply was cut off inside an operation block',
                });
            }
            cursor = withoutReasoning.length;
            break;
        }
        const head = withoutReasoning.slice(open.index, headEnd);
        const body = withoutReasoning.slice(headEnd + 1, closeAt);
        const raw = withoutReasoning.slice(open.index, closeAt + '</op>'.length);
        const typeMatch = /type\s*=\s*["']?([\w-]+)/i.exec(head);
        const built = buildBlock(typeMatch?.[1] ?? '', head, body, raw);
        if ('kind' in built) {
            unparsed.push(built);
        } else {
            blocks.push(built);
        }
        cursor = closeAt + '</op>'.length;
    }
    const prose = proseParts
        .join('')
        // Text Completion models continue the prompt and echo its <workspace> block
        // back (live run 2026-09-22); it is never part of an answer.
        .replace(/<workspace>[\s\S]*?<\/workspace>/gi, '')
        .replace(/<workspace>[\s\S]*$/i, '')
        // Fences around blocks are dropped; fenced prose keeps its own fences.
        .replace(/```[a-zA-Z]*\s*\n?\s*```/g, '')
        // …and so are inline backticks around a block (live run 2026-09-16: "`<op …>`" left "``").
        .replace(/(?<!`)``(?!`)/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    // Tool-trained models routed by a free router wrote the changes as calls
    // (`[create_entry(parent="f7", …)]`) instead of blocks (live run 2026-09-22):
    // reported as broken so the reply offers "Ask to fix" instead of plain prose.
    if (options.final === true && blocks.length === 0 && unparsed.length === 0) {
        const call = FUNCTION_CALL_PATTERN.exec(withoutReasoning);
        if (call) {
            unparsed.push({
                kind: 'malformed-block',
                excerpt: excerpt(withoutReasoning.slice(call.index)),
                reason: 'the changes were written as function calls instead of <op> blocks',
            });
        }
    }
    const references = [...prose.matchAll(/\[\[([A-Za-z0-9_-]+)\]\]/g)].map((match) => match[1] ?? '');
    return { prose, blocks, unparsed, reasoning, references };
}
