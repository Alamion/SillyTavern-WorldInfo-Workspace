import { createDefaultNativeEntry, findNode, type EntryNode, type FolderNode, type TreeNode, type WorkspaceState } from '../state/schema';
import { FIELD_SPECS, OWNED_PREFIX } from '../md/convention';
import { buildHandleMap, type HandleMap } from './handles';
import { decisionNote, systemPrompt } from './prompts';
import { resolveScope, selectionFolder } from './scope';
import { expandTriggers } from './triggers';
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
 * Builds the request the model sees (research R6): instructions, where the user
 * is in the tree, the outline of the chosen structure, the entries sent in full
 * (selected + key-triggered, or all of them), optional chat sources,
 * conversation history, and the user's request — trimmed to the user's context
 * budget in a documented priority order, with everything left out reported
 * (FR-023).
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

/** Rows of the handled nodes only: the structure and the folders above it. */
function outlineRows(state: WorkspaceState, map: HandleMap): OutlineRow[] {
    const rows: OutlineRow[] = [];
    const walk = (folder: FolderNode, depth: number): void => {
        for (const child of folder.children) {
            const handle = map.byNode.get(child.id);
            if (handle === undefined) {
                continue;
            }
            rows.push({ text: outlineLine(child, handle, depth), depth, kind: child.kind });
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

/** Tells the model where the user is, so new items land in the right folder. */
function locationBlock(
    state: WorkspaceState,
    map: HandleMap,
    selection: readonly string[],
    fallbackFolderId: string | undefined
): string {
    const lines = ['## Where the user is'];
    const describe = (node: TreeNode): string => {
        const handle = map.byNode.get(node.id);
        const path = pathOf(state, node.id);
        return handle !== undefined ? `${handle} (${node.kind}: ${path})` : `${node.kind}: ${path}`;
    };
    const selected = selection
        .map((id) => findNode(state, id))
        .filter((node): node is TreeNode => node !== undefined && node.id !== state.root.id);
    lines.push(
        selected.length > 0
            ? `Selected in the tree: ${selected.map(describe).join(', ')}`
            : 'Nothing is selected in the tree.'
    );
    const folder = selected.length > 0 ? selectionFolder(state, selection) : undefined;
    const currentId =
        folder !== undefined && folder.id !== state.root.id && map.byNode.has(folder.id)
            ? folder.id
            : fallbackFolderId;
    const current = currentId !== undefined ? findNode(state, currentId) : undefined;
    const handle = current ? map.byNode.get(current.id) : undefined;
    if (current && handle !== undefined) {
        lines.push(
            `Current folder: ${handle} (${pathOf(state, current.id)}). Put new items here unless the request names another place or a subfolder of it clearly fits better.`
        );
    } else {
        lines.push('No current folder: put new items in the folder of the structure that fits best.');
    }
    return lines.join('\n');
}

export function buildRequest(input: BuildRequestInput): BuiltRequest {
    const { state, context } = input;
    const scope = resolveScope(state, context.scope, input.selection);
    // Only the chosen structure (and the folders above it) gets handles: the
    // assistant never sees — and so never places or targets — the rest.
    const map = buildHandleMap(state, new Set([...scope.nodeIds, ...scope.ancestorIds]));
    const omitted: OmittedPart[] = [];
    if (scope.dropped.length > 0) {
        omitted.push({
            what: 'item',
            label: 'folders that no longer exist',
            count: scope.dropped.length,
        });
    }

    const budgetTokens = Math.max(500, input.contextTokens - input.responseTokens);
    const systemText = systemPrompt(input.mode, input.instructions);
    const requestText = input.request;
    let used = estimateTokens(systemText) + estimateTokens(requestText);

    // Where the user is — tiny and always sent.
    const fallbackFolder = scope.folderIds.find((id) => id !== state.root.id);
    const locationText = locationBlock(state, map, input.selection, fallbackFolder);
    used += estimateTokens(locationText);

    // Structure outline — collapsed by depth, then folders only, when it is too big.
    let outlineText = '';
    let outlineIncluded = false;
    let outlineItems = 0;
    const rows = outlineRows(state, map);
    const variants: Array<{ rows: OutlineRow[]; omit?: OmittedPart }> = [
        { rows },
        {
            rows: rows.filter((row) => row.depth <= 1),
            omit: { what: 'outline-depth', label: 'structure collapsed below depth 2' },
        },
        {
            rows: rows.filter((row) => row.kind === 'folder'),
            omit: { what: 'outline-depth', label: 'structure reduced to folders' },
        },
    ];
    for (const [index, variant] of variants.entries()) {
        const text = [
            '## Workspace structure',
            '(handle | kind | name — extra; only these items exist for you)',
            ...variant.rows.map((row) => row.text),
        ].join('\n');
        const cost = estimateTokens(text);
        const last = index === variants.length - 1;
        if (used + cost <= budgetTokens * 0.45 || (last && used + cost <= budgetTokens)) {
            used += cost;
            outlineText = text;
            outlineIncluded = true;
            outlineItems = variant.rows.length;
            if (variant.omit) {
                omitted.push(variant.omit);
            }
            break;
        }
    }
    if (!outlineIncluded) {
        omitted.push({ what: 'outline-depth', label: 'structure omitted' });
    }

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
        if (used + cost > budgetTokens * 0.6) {
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

    // Entries in full: the selection first, then key-triggered entries layer by
    // layer (FR-021a) — or, with `all`, every entry of the structure.
    const chat = input.chat;
    const candidates: EntryNode[] = [];
    const collect = (folder: FolderNode): void => {
        for (const child of folder.children) {
            if (child.kind === 'entry' && scope.nodeIds.has(child.id)) {
                candidates.push(child);
            }
            if (child.kind === 'folder') {
                collect(child);
            }
        }
    };
    collect(state.root);
    const selected = new Set(input.selection);
    const activated =
        chat && context.activatedEntries
            ? chat.activated.map((ref) => ({
                  ref,
                  node: candidates.find((entry) => entry.sync.books[ref.bookName]?.uid === ref.uid),
              }))
            : [];
    const seeds = [
        ...candidates.filter((entry) => selected.has(entry.id)),
        ...activated
            .map((item) => item.node)
            .filter((node): node is EntryNode => node !== undefined && !selected.has(node.id)),
    ];
    let triggered: EntryNode[];
    if (context.entryContents === 'all') {
        const seedIds = new Set(seeds.map((entry) => entry.id));
        triggered = candidates.filter((entry) => !seedIds.has(entry.id));
    } else {
        const seedTexts = [requestText, ...input.history.slice(-2).map((message) => message.text)];
        if (chat) {
            if (context.chatMessages > 0) {
                seedTexts.push(...chat.messages.map((message) => message.text));
            }
            if (context.characterCard && chat.card) {
                seedTexts.push(chat.card.description, chat.card.personality, chat.card.scenario);
            }
            if (context.persona && chat.persona) {
                seedTexts.push(chat.persona.description);
            }
        }
        triggered = expandTriggers(candidates, seedTexts, seeds).flatMap((layer) => layer.entries);
    }
    const itemBlocks: string[] = [];
    let seedsDropped = 0;
    let triggeredDropped = 0;
    let triggeredIncluded = 0;
    const sendInFull = (entry: EntryNode, isSeed: boolean): void => {
        const handle = map.byNode.get(entry.id);
        if (handle === undefined) {
            return;
        }
        const block = itemBlock(entry, handle);
        const cost = estimateTokens(block);
        if (used + cost > budgetTokens * 0.9) {
            if (isSeed) {
                seedsDropped += 1;
            } else {
                triggeredDropped += 1;
            }
            return;
        }
        used += cost;
        itemBlocks.push(block);
        if (!isSeed) {
            triggeredIncluded += 1;
        }
    };
    seeds.forEach((entry) => sendInFull(entry, true));
    triggered.forEach((entry) => sendInFull(entry, false));
    if (seedsDropped > 0) {
        omitted.push({ what: 'item', label: 'selected entries sent without content', count: seedsDropped });
    }
    if (triggeredDropped > 0) {
        omitted.push({
            what: 'item',
            label:
                context.entryContents === 'all'
                    ? 'entries sent without content'
                    : 'mentioned entries sent without content',
            count: triggeredDropped,
        });
    }

    // Optional chat sources — the first thing to go when the budget is tight.
    const optional: string[] = [];
    let chatIncluded = 0;
    let cardIncluded = false;
    let personaIncluded = false;
    let activatedIncluded = 0;
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
        if (context.activatedEntries && activated.length > 0) {
            const handles: string[] = [];
            let unmatched = 0;
            for (const item of activated) {
                const handle = item.node ? map.byNode.get(item.node.id) : undefined;
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
                    label: 'activated entries outside the structure',
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
        locationText,
        outlineText,
        itemBlocks.length > 0
            ? [
                  '## Entries in full',
                  '(entries of the structure not listed here were not sent with their content: do not rewrite their content)',
                  ...itemBlocks,
              ].join('\n\n')
            : '',
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
            outlineItems,
            fullItems: itemBlocks.length,
            triggeredItems: triggeredIncluded,
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
