import type { LlmMessage } from '../assistant/types';
import { truncateAtSentence } from '../assistant/truncate';
import { findNode, type EntryNode, type FolderNode, type WorkspaceState } from '../state/schema';
import { getSummary } from '../tree/summary';

/**
 * Prompt drafting (spec 009 US2, research R4): a model writes an image prompt
 * from the lore around the image. The lore is the entries of the image's
 * folder — direct ones first, then those in subfolders — or, when that folder
 * has none, the parent folder's; disabled entries are skipped; the size limit
 * keeps whole entries and cuts the last one at a sentence end.
 */

const CHARS_PER_TOKEN = 3.5;

export interface DraftBasisItem {
    id: string;
    name: string;
}

export interface PromptDraftRequest {
    messages: LlmMessage[];
    basis: DraftBasisItem[];
}

function entriesUnder(folder: FolderNode): EntryNode[] {
    const direct: EntryNode[] = [];
    const nested: EntryNode[] = [];
    const walk = (node: FolderNode, into: EntryNode[]): void => {
        for (const child of node.children) {
            if (child.kind === 'entry') {
                into.push(child);
            } else if (child.kind === 'folder') {
                walk(child, nested);
            }
        }
    };
    for (const child of folder.children) {
        if (child.kind === 'entry') {
            direct.push(child);
        } else if (child.kind === 'folder') {
            walk(child, nested);
        }
    }
    return [...direct, ...nested].filter((entry) => entry.native.disable !== true);
}

function loreEntries(state: WorkspaceState, folder: FolderNode | null): EntryNode[] {
    if (!folder) {
        return [];
    }
    const own = entriesUnder(folder);
    if (own.length > 0 || folder.parentId === null) {
        return own;
    }
    const parent = findNode(state, folder.parentId);
    return parent?.kind === 'folder' ? entriesUnder(parent) : [];
}

function entryBlock(entry: EntryNode, content: string): string {
    const summary = getSummary(entry.native).trim();
    return [`## ${entry.name}`, ...(summary !== '' ? [`Summary: ${summary}`] : []), content.trim()]
        .filter((line) => line !== '')
        .join('\n');
}

export function buildPromptDraftRequest(
    state: WorkspaceState,
    imageId: string,
    options: { idea: string; instruction: string; contextTokens: number }
): PromptDraftRequest | null {
    const image = findNode(state, imageId);
    if (image?.kind !== 'image') {
        return null;
    }
    const parent = image.parentId !== null ? findNode(state, image.parentId) : undefined;
    const entries = loreEntries(state, parent?.kind === 'folder' ? parent : null);
    let budget = Math.floor(options.contextTokens * CHARS_PER_TOKEN);
    const blocks: string[] = [];
    const basis: DraftBasisItem[] = [];
    for (const entry of entries) {
        const whole = entryBlock(entry, entry.native.content);
        if (whole.length + 2 <= budget) {
            blocks.push(whole);
            basis.push({ id: entry.id, name: entry.name });
            budget -= whole.length + 2;
            continue;
        }
        const head = entryBlock(entry, '');
        const cut = truncateAtSentence(entry.native.content, budget - head.length - 3);
        if (cut !== null) {
            blocks.push(entryBlock(entry, cut.text));
            basis.push({ id: entry.id, name: entry.name });
        }
        break;
    }
    const lines = [`Subject: ${image.name}`];
    if (image.caption.trim() !== '') {
        lines.push(`Caption: ${image.caption.trim()}`);
    }
    if (options.idea.trim() !== '') {
        lines.push(`The user's idea: ${options.idea.trim()}`);
    }
    lines.push('', blocks.length > 0 ? `Lore:\n\n${blocks.join('\n\n')}` : 'Lore: none available.');
    return {
        messages: [
            { role: 'system', content: options.instruction },
            { role: 'user', content: lines.join('\n') },
        ],
        basis,
    };
}

/** The prompt from a reply: no fences, quotes, "Prompt:" label or later paragraphs. */
export function cleanPromptReply(reply: string): string {
    let text = reply.trim();
    const fenced = /^```[^\n]*\n([\s\S]*?)\n?```/.exec(text);
    if (fenced?.[1] !== undefined) {
        text = fenced[1].trim();
    }
    text = text.replace(/^(?:\*\*)?(?:image\s+)?prompt(?:\*\*)?\s*:\s*(?:\*\*)?\s*/i, '');
    text = (text.split(/\n\s*\n/)[0] ?? '').trim();
    const quoted = /^["'«“](.*)["'»”]$/s.exec(text);
    if (quoted?.[1] !== undefined) {
        text = quoted[1].trim();
    }
    return text;
}
