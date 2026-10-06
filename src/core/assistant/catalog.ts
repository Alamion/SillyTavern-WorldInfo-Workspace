import type { EntryNode, FolderNode, TreeNode, WorkspaceState } from '../state/schema';
import { getNodeIndex } from '../state/nodeIndex';
import { getSummary, SUMMARY_SOFT_LIMIT } from '../tree/summary';
import type { HandleMap } from './handles';

/**
 * The entry catalog of protocol v2 (spec 007 R4): one line per entry — handle,
 * folder path, name, size, summary (or a quoted excerpt) — so a large library can
 * be offered without its text. When even the lines do not fit, the best-ranked
 * entries stay listed and the rest is offered per folder ("open to see").
 */

const CHARS_PER_TOKEN = 3.5;
const EXCERPT_CHARS = 160;
const FOLDER_PREVIEW_NAMES = 3;

function tokensOf(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Folder path of a node, root excluded ("World / Region 0"). */
export function folderPath(state: WorkspaceState, node: { parentId: string | null }): string {
    // The cached index: findNode rebuilds one per call (O(n) per catalog line).
    const index = getNodeIndex(state.root);
    const names: string[] = [];
    let current: TreeNode | undefined = node.parentId !== null ? index.get(node.parentId) : undefined;
    while (current && current.parentId !== null) {
        names.unshift(current.name);
        current = index.get(current.parentId);
    }
    return names.join(' / ');
}

function findNode(state: WorkspaceState, id: string): TreeNode | undefined {
    return id === state.root.id ? state.root : getNodeIndex(state.root).get(id);
}

function description(entry: EntryNode): string {
    const summary = getSummary(entry.native);
    if (summary !== '') {
        return summary.length > SUMMARY_SOFT_LIMIT ? `${summary.slice(0, SUMMARY_SOFT_LIMIT)}… (shortened)` : summary;
    }
    const flat = entry.native.content.replace(/\s+/g, ' ').trim();
    if (flat === '') {
        return '(empty)';
    }
    return `"${flat.length > EXCERPT_CHARS ? `${flat.slice(0, EXCERPT_CHARS)}…` : flat}"`;
}

export function catalogLine(state: WorkspaceState, entry: EntryNode, handle: string): string {
    const size = tokensOf(entry.native.content);
    return `${handle} | ${folderPath(state, entry)} | ${entry.name} | ≈${String(size)} — ${description(entry)}`;
}

const HEADER = [
    '## Catalog',
    '(handle | folder path | name | ≈tokens — summary or "excerpt"; these entries were NOT sent in full)',
    'Before you rely on or change a catalog entry (other than its summary), request it:',
    '<op type="read" ids="e12,e13"></op>',
    'To list the entries of a folder shown as "(folder, N entries …)", use <op type="open" ids="f7"></op>.',
    'After read/open blocks, stop your reply; it continues once the content is provided.',
].join('\n');

export interface Catalog {
    text: string;
    tokens: number;
    /** Entries listed as lines. */
    entryIds: string[];
    /** Folders offered as "open to see" (their entries are not listed). */
    folderIds: string[];
    /** Entries neither listed nor reachable through a listed folder (budget). */
    omitted: number;
}

export interface BuildCatalogInput {
    state: WorkspaceState;
    entries: readonly EntryNode[];
    map: HandleMap;
    budgetTokens: number;
    /** Higher = listed first when the catalog must be narrowed (BM25, scene cast…). */
    rank?: (entry: EntryNode) => number;
}

export function buildCatalog(input: BuildCatalogInput): Catalog {
    const { state, map } = input;
    const listable = input.entries.filter((entry) => !entry.native.disable && map.byNode.has(entry.id));
    const lineOf = (entry: EntryNode): string => catalogLine(state, entry, map.byNode.get(entry.id) ?? '?');
    const lines = listable.map(lineOf);
    const full = [HEADER, ...lines].join('\n');
    if (tokensOf(full) <= input.budgetTokens) {
        return { text: full, tokens: tokensOf(full), entryIds: listable.map((entry) => entry.id), folderIds: [], omitted: 0 };
    }
    // Narrowed: best-ranked entries first, the rest per folder.
    const order = listable.map((entry, index) => ({ entry, index, score: input.rank?.(entry) ?? 0 }));
    order.sort((a, b) => b.score - a.score || a.index - b.index);
    let used = tokensOf(HEADER) + 1;
    const listed: EntryNode[] = [];
    const entryBudget = input.budgetTokens * 0.6;
    for (const { entry } of order) {
        const cost = tokensOf(lineOf(entry)) + 1;
        if (used + cost > entryBudget) {
            break;
        }
        used += cost;
        listed.push(entry);
    }
    const listedIds = new Set(listed.map((entry) => entry.id));
    const byFolder = new Map<string, EntryNode[]>();
    for (const entry of listable) {
        if (!listedIds.has(entry.id) && entry.parentId !== null) {
            byFolder.set(entry.parentId, [...(byFolder.get(entry.parentId) ?? []), entry]);
        }
    }
    const folderLines: string[] = [];
    const folderIds: string[] = [];
    let omitted = 0;
    for (const [folderId, rest] of byFolder) {
        const folder = findNode(state, folderId);
        const handle = map.byNode.get(folderId);
        if (folder?.kind !== 'folder' || handle === undefined) {
            omitted += rest.length;
            continue;
        }
        const names = rest.slice(0, FOLDER_PREVIEW_NAMES).map((entry) => entry.name);
        const more = rest.length > FOLDER_PREVIEW_NAMES ? ', …' : '';
        const path = [folderPath(state, folder), folder.name].filter((part) => part !== '').join(' / ');
        const line = `${handle} | ${path} | (folder, ${String(rest.length)} entries: ${names.join(', ')}${more}) — not listed, open to see`;
        const cost = tokensOf(line) + 1;
        if (used + cost > input.budgetTokens) {
            omitted += rest.length;
            continue;
        }
        used += cost;
        folderLines.push(line);
        folderIds.push(folderId);
    }
    const text = [HEADER, ...listed.map(lineOf), ...folderLines].join('\n');
    return { text, tokens: tokensOf(text), entryIds: listed.map((entry) => entry.id), folderIds, omitted };
}

/** The catalog of one opened folder (all entries below it), for a read round. */
export function folderCatalog(
    state: WorkspaceState,
    folder: FolderNode,
    map: HandleMap,
    budgetTokens: number
): Catalog {
    const entries: EntryNode[] = [];
    const walk = (node: FolderNode): void => {
        for (const child of node.children) {
            if (child.kind === 'entry') {
                entries.push(child);
            } else if (child.kind === 'folder') {
                walk(child);
            }
        }
    };
    walk(folder);
    const lines: string[] = [];
    const entryIds: string[] = [];
    let used = 0;
    let omitted = 0;
    for (const entry of entries) {
        const handle = map.byNode.get(entry.id);
        if (handle === undefined || entry.native.disable) {
            continue;
        }
        const line = catalogLine(state, entry, handle);
        const cost = tokensOf(line) + 1;
        if (used + cost > budgetTokens) {
            omitted += 1;
            continue;
        }
        used += cost;
        lines.push(line);
        entryIds.push(entry.id);
    }
    const path = [folderPath(state, folder), folder.name].filter((part) => part !== '').join(' / ');
    const text = [`## Folder ${map.byNode.get(folder.id) ?? '?'} (${path})`, ...lines].join('\n');
    return { text, tokens: tokensOf(text), entryIds, folderIds: [], omitted };
}
