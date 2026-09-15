import { createDefaultNativeEntry, findNode, type EntryNode, type FolderNode, type TreeNode, type WorkspaceState } from '../state/schema';
import { FIELD_SPECS, OWNED_PREFIX } from '../md/convention';
import { buildHandleMap, type HandleMap } from './handles';
import { decisionNote, systemPrompt } from './prompts';
import { resolveScope } from './scope';
import type {
    ActivatedEntryRef,
    CharacterCardView,
    ChatMessageView,
    PersonaView,
} from './ports';
import type {
    AssistantMode,
    ContextSettings,
    ContextSnapshot,
    LlmMessage,
    Message,
    OmittedPart,
} from './types';

/**
 * Builds the request the model sees (research R6): instructions, the tree
 * outline, the in-scope items in full, optional chat sources, conversation
 * history, and the user's request — trimmed to the user's context budget in a
 * documented priority order, with everything left out reported (FR-023).
 */

/** Conservative characters-per-token estimate (the app tokenizer follows the MAIN api). */
const CHARS_PER_TOKEN = 3.5;

export function estimateTokens(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export interface BuildRequestInput {
    state: WorkspaceState;
    mode: AssistantMode;
    instructions: string | null;
    context: ContextSettings;
    selection: readonly string[];
    request: string;
    history: readonly Message[];
    contextTokens: number;
    responseTokens: number;
    chat?: {
        messages: ChatMessageView[];
        card: CharacterCardView | null;
        persona: PersonaView | null;
        activated: ActivatedEntryRef[];
    };
}

export interface BuiltRequest {
    messages: LlmMessage[];
    snapshot: ContextSnapshot;
}

const SCALAR_SPECS = FIELD_SPECS.filter(
    (spec) => spec.type !== 'object' && spec.type !== 'filter'
);
const DEFAULT_ENTRY = createDefaultNativeEntry(0);

function fieldLines(entry: EntryNode): string[] {
    const lines: string[] = [];
    for (const spec of SCALAR_SPECS) {
        if (spec.field === 'key' || spec.field === 'keysecondary') {
            continue;
        }
        const value = entry.native[spec.field];
        const fallback = DEFAULT_ENTRY[spec.field];
        if (value === undefined || JSON.stringify(value) === JSON.stringify(fallback)) {
            continue;
        }
        const name = spec.key.slice(OWNED_PREFIX.length);
        if (spec.type === 'enum' && typeof value === 'number') {
            lines.push(`${name}=${spec.enumNames?.[value] ?? String(value)}`);
            continue;
        }
        if (spec.type === 'boolean' && typeof value === 'boolean') {
            lines.push(`${name}=${String(spec.invert === true ? !value : value)}`);
            continue;
        }
        if (Array.isArray(value)) {
            lines.push(`${name}=${value.join(', ')}`);
            continue;
        }
        lines.push(`${name}=${String(value)}`);
    }
    return lines;
}

function outlineLine(node: TreeNode, handle: string, depth: number): string {
    const indent = '  '.repeat(depth);
    if (node.kind === 'folder') {
        const root = node.isWiRoot ? ' — World Info root' : '';
        return `${indent}${handle} | folder | ${node.name}${root}`;
    }
    if (node.kind === 'image') {
        const caption = node.caption !== '' ? ` — caption: ${node.caption}` : '';
        return `${indent}${handle} | image | ${node.name}${caption}`;
    }
    const keys = node.native.key.length > 0 ? ` — keys: ${node.native.key.join(', ')}` : '';
    return `${indent}${handle} | entry | ${node.name}${keys}`;
}

interface OutlineRow {
    text: string;
    depth: number;
    kind: TreeNode['kind'];
}

function outlineRows(state: WorkspaceState, map: HandleMap): OutlineRow[] {
    const rows: OutlineRow[] = [];
    const walk = (folder: FolderNode, depth: number): void => {
        for (const child of folder.children) {
            const handle = map.byNode.get(child.id);
            if (handle !== undefined) {
                rows.push({ text: outlineLine(child, handle, depth), depth, kind: child.kind });
            }
            if (child.kind === 'folder') {
                walk(child, depth + 1);
            }
        }
    };
    walk(state.root, 0);
    return rows;
}

function itemBlock(node: TreeNode, handle: string): string {
    if (node.kind === 'folder') {
        return `[${handle}] folder "${node.name}"`;
    }
    if (node.kind === 'image') {
        return `[${handle}] image "${node.name}"${node.caption !== '' ? `\ncaption: ${node.caption}` : ''}`;
    }
    const parts = [`[${handle}] ${node.name}`];
    if (node.native.key.length > 0) {
        parts.push(`keys: ${node.native.key.join(', ')}`);
    }
    if (node.native.keysecondary.length > 0) {
        parts.push(`secondary keys: ${node.native.keysecondary.join(', ')}`);
    }
    const fields = fieldLines(node);
    if (fields.length > 0) {
        parts.push(`fields: ${fields.join(', ')}`);
    }
    parts.push(`content:\n${node.native.content}`);
    return parts.join('\n');
}

function pathOf(state: WorkspaceState, nodeId: string): string {
    const names: string[] = [];
    let current = findNode(state, nodeId);
    while (current && current.parentId !== null) {
        names.unshift(current.name);
        current = findNode(state, current.parentId);
    }
    return names.join(' / ');
}

function chatBlock(messages: ChatMessageView[]): string {
    return ['## Current chat', ...messages.map((message) => `${message.name}: ${message.text}`)].join('\n');
}

export function buildRequest(input: BuildRequestInput): BuiltRequest {
    const { state, context } = input;
    const scope = resolveScope(state, context.scope, input.selection);
    const map = buildHandleMap(state);
    const omitted: OmittedPart[] = [];
    if (scope.dropped.length > 0) {
        omitted.push({
            what: 'item',
            label: 'folders that no longer exist',
            count: scope.dropped.length,
        });
    }

    // In-scope items, user-selected first (they are the last to be trimmed).
    const selected = new Set(input.selection);
    const inScope: TreeNode[] = [];
    const collect = (folder: FolderNode): void => {
        for (const child of folder.children) {
            if (scope.nodeIds.has(child.id)) {
                inScope.push(child);
            }
            if (child.kind === 'folder') {
                collect(child);
            }
        }
    };
    collect(state.root);
    const ordered = [
        ...inScope.filter((node) => selected.has(node.id)),
        ...inScope.filter((node) => !selected.has(node.id)),
    ].filter((node) => node.kind !== 'folder');

    const budgetTokens = Math.max(500, input.contextTokens - input.responseTokens);
    const systemText = systemPrompt(input.mode, input.instructions);
    const requestText = input.request;
    let used = estimateTokens(systemText) + estimateTokens(requestText);

    // History: most recent first, older turns are trimmed first.
    const historyMessages: LlmMessage[] = [];
    const historyCandidates = [...input.history].reverse();
    let historyDropped = 0;
    for (const message of historyCandidates) {
        if (message.text.trim() === '') {
            continue;
        }
        const role = message.role === 'assistant' ? 'assistant' : message.role === 'note' ? 'system' : 'user';
        const note = message.role === 'assistant' ? decisionNote(message.batch) : null;
        const cost = estimateTokens(message.text) + (note !== null ? estimateTokens(note) : 0);
        if (used + cost > budgetTokens * 0.5) {
            historyDropped += 1;
            continue;
        }
        used += cost;
        // Decision notes follow the reply they are about (FR-033).
        if (note !== null) {
            historyMessages.unshift({ role: 'system', content: note });
        }
        historyMessages.unshift({ role, content: message.text });
    }
    if (historyDropped > 0) {
        omitted.push({ what: 'history', label: 'older conversation turns', count: historyDropped });
    }

    // Items in full — largest dropped first once the budget is reached.
    const itemBlocks: string[] = [];
    let itemsDropped = 0;
    for (const node of ordered) {
        const handle = map.byNode.get(node.id);
        if (handle === undefined) {
            continue;
        }
        const block = itemBlock(node, handle);
        const cost = estimateTokens(block);
        if (used + cost > budgetTokens * 0.85) {
            itemsDropped += 1;
            continue;
        }
        used += cost;
        itemBlocks.push(block);
    }
    if (itemsDropped > 0) {
        omitted.push({
            what: 'item',
            label: 'in-scope items sent as outline only',
            count: itemsDropped,
        });
    }

    // Outline — collapsed by depth, then folders only, when the budget is tight.
    let outlineText = '';
    let outlineIncluded = false;
    if (context.includeOutline) {
        const rows = outlineRows(state, map);
        const variants: Array<{ rows: OutlineRow[]; omit?: OmittedPart }> = [
            { rows },
            {
                rows: rows.filter((row) => row.depth <= 1),
                omit: { what: 'outline-depth', label: 'outline collapsed below depth 2' },
            },
            {
                rows: rows.filter((row) => row.kind === 'folder'),
                omit: { what: 'outline-depth', label: 'outline reduced to folders' },
            },
        ];
        for (const variant of variants) {
            const text = ['## Workspace outline', '(handle | kind | name — extra)', ...variant.rows.map((row) => row.text)].join('\n');
            const cost = estimateTokens(text);
            if (used + cost <= budgetTokens * 0.95 || variant === variants[variants.length - 1]) {
                if (used + cost <= budgetTokens) {
                    used += cost;
                    outlineText = text;
                    outlineIncluded = true;
                    if (variant.omit) {
                        omitted.push(variant.omit);
                    }
                }
                break;
            }
        }
        if (!outlineIncluded) {
            omitted.push({ what: 'outline-depth', label: 'outline omitted' });
        }
    }

    // Optional chat sources — the first thing to go when the budget is tight.
    const optional: string[] = [];
    let chatIncluded = 0;
    let cardIncluded = false;
    let personaIncluded = false;
    let activatedIncluded = 0;
    const chat = input.chat;
    if (chat) {
        if (context.characterCard && chat.card) {
            const block = [
                '## Character card',
                `name: ${chat.card.name}`,
                chat.card.description,
                chat.card.personality,
                chat.card.scenario,
            ]
                .filter((part) => part.trim() !== '')
                .join('\n');
            const cost = estimateTokens(block);
            if (used + cost <= budgetTokens) {
                used += cost;
                optional.push(block);
                cardIncluded = true;
            } else {
                omitted.push({ what: 'chat', label: 'character card' });
            }
        }
        if (context.persona && chat.persona) {
            const block = ['## User persona', `name: ${chat.persona.name}`, chat.persona.description].join('\n');
            const cost = estimateTokens(block);
            if (used + cost <= budgetTokens) {
                used += cost;
                optional.push(block);
                personaIncluded = true;
            } else {
                omitted.push({ what: 'chat', label: 'persona description' });
            }
        }
        if (context.activatedEntries && chat.activated.length > 0) {
            const handles: string[] = [];
            let unmatched = 0;
            for (const ref of chat.activated) {
                const node = ordered.find(
                    (item) => item.kind === 'entry' && item.sync.books[ref.bookName]?.uid === ref.uid
                );
                const handle = node ? map.byNode.get(node.id) : undefined;
                if (handle !== undefined) {
                    handles.push(handle);
                } else {
                    unmatched += 1;
                }
            }
            if (handles.length > 0) {
                const block = `## Entries the app activated in the current chat\n${handles.join(', ')}`;
                const cost = estimateTokens(block);
                if (used + cost <= budgetTokens) {
                    used += cost;
                    optional.push(block);
                    activatedIncluded = handles.length;
                }
            }
            if (unmatched > 0) {
                omitted.push({
                    what: 'chat',
                    label: 'activated entries not in the workspace',
                    count: unmatched,
                });
            }
        }
        if (context.chatMessages > 0 && chat.messages.length > 0) {
            const kept = [...chat.messages];
            let dropped = 0;
            while (kept.length > 0) {
                const cost = estimateTokens(chatBlock(kept));
                if (used + cost <= budgetTokens) {
                    used += cost;
                    optional.push(chatBlock(kept));
                    chatIncluded = kept.length;
                    break;
                }
                kept.shift();
                dropped += 1;
            }
            if (dropped > 0) {
                omitted.push({ what: 'chat', label: 'oldest chat messages', count: dropped });
            }
        }
    }

    const workspaceParts = [
        outlineText,
        itemBlocks.length > 0 ? ['## Items in scope', ...itemBlocks].join('\n\n') : '',
        ...optional,
    ].filter((part) => part !== '');

    const messages: LlmMessage[] = [
        { role: 'system', content: systemText },
        ...(workspaceParts.length > 0
            ? [{ role: 'system' as const, content: workspaceParts.join('\n\n') }]
            : []),
        ...historyMessages,
        { role: 'user', content: requestText },
    ];

    const snapshot: ContextSnapshot = {
        handles: map.handles,
        scopeNodeIds: [...scope.nodeIds],
        included: {
            outline: outlineIncluded,
            fullItems: itemBlocks.length,
            chatMessages: chatIncluded,
            characterCard: cardIncluded,
            persona: personaIncluded,
            activatedEntries: activatedIncluded,
        },
        omitted,
        estimatedTokens: used,
        requestMessages: messages,
    };
    return { messages, snapshot };
}

/** Tree path of a node, for proposal summaries (FR-007). */
export { pathOf };
