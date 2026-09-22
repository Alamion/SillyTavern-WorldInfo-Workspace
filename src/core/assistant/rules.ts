import { diffLines, diffSequences } from '../diff/lineDiff';
import { findNode, type EntryNode, type TreeNode, type WorkspaceState } from '../state/schema';
import type { OperationProposal, ProposedValues } from './types';

/**
 * Proposal rules (research R8): what counts as destructive (FR-010), what looks
 * like a duplicate (FR-016), and whether a proposal went stale since it was
 * made (FR-013).
 */

const WORD_LIMIT = 4000;

/**
 * Characters of `before` that `after` no longer contains, compared WORD by word
 * (a line diff would count a whole rewritten paragraph as removed even when the
 * edit only appended a sentence). Very long texts fall back to the shared line
 * diff to keep the comparison cheap.
 */
function removedCharacters(before: string, after: string): number {
    const beforeWords = before.split(/(\s+)/).filter((part) => part.trim() !== '');
    const afterWords = after.split(/(\s+)/).filter((part) => part.trim() !== '');
    const ops =
        beforeWords.length > WORD_LIMIT || afterWords.length > WORD_LIMIT
            ? diffLines(before, after).map((op) => ({ type: op.type, item: op.text }))
            : diffSequences(beforeWords, afterWords);
    return ops.filter((op) => op.type === 'removed').reduce((sum, op) => sum + op.item.length, 0);
}

/**
 * Destructive = a deletion, more than half the content removed, or any keyword
 * dropped (owner clarification 2026-09-15). Additions are never destructive.
 */
export function isDestructiveEdit(before: EntryNode, values: ProposedValues): boolean {
    if (values.content !== undefined) {
        const previous = before.native.content;
        if (previous.trim() !== '') {
            const removed = removedCharacters(previous, values.content);
            if (removed > previous.length / 2) {
                return true;
            }
        }
    }
    const keywordsRemoved = (previous: string[], next: string[] | undefined): boolean => {
        if (next === undefined) {
            return false;
        }
        const kept = new Set(next.map((key) => key.toLowerCase()));
        return previous.some((key) => !kept.has(key.toLowerCase()));
    };
    return (
        keywordsRemoved(before.native.key, values.keys) ||
        keywordsRemoved(before.native.keysecondary, values.secondaryKeys)
    );
}

/** World Info root a node belongs to, or null - the duplicate search scope. */
function rootOf(state: WorkspaceState, nodeId: string): string | null {
    let current = findNode(state, nodeId);
    while (current) {
        if (current.kind === 'folder' && current.isWiRoot) {
            return current.id;
        }
        current = current.parentId !== null ? findNode(state, current.parentId) : undefined;
    }
    return null;
}

function entriesUnder(state: WorkspaceState, folderId: string | null): EntryNode[] {
    const start = folderId === null ? state.root : findNode(state, folderId);
    const entries: EntryNode[] = [];
    const walk = (node: TreeNode): void => {
        if (node.kind === 'entry') {
            entries.push(node);
            return;
        }
        if (node.kind === 'folder') {
            node.children.forEach(walk);
        }
    };
    if (start) {
        walk(start);
    }
    return entries;
}

/**
 * A proposed creation that matches an existing entry's title or shares a primary
 * keyword inside the same World Info root (entries outside any root are compared
 * against the whole workspace).
 */
export function findDuplicate(
    state: WorkspaceState,
    parentId: string,
    values: ProposedValues
): string | undefined {
    const title = values.title?.trim().toLowerCase();
    const keys = new Set((values.keys ?? []).map((key) => key.toLowerCase()));
    const root = rootOf(state, parentId);
    for (const entry of entriesUnder(state, root)) {
        if (title !== undefined && title !== '' && entry.name.trim().toLowerCase() === title) {
            return entry.id;
        }
        if (entry.native.key.some((key) => keys.has(key.toLowerCase()))) {
            return entry.id;
        }
    }
    return undefined;
}

const SEPARATOR = '|#|';

/** Fingerprint over the values a proposal touches (FNV-1a, like the sync hashes). */
export function fingerprintValues(node: TreeNode, values: ProposedValues): string {
    const parts: string[] = [node.name];
    if (node.kind === 'entry') {
        if (values.content !== undefined) {
            parts.push(node.native.content);
        }
        if (values.keys !== undefined) {
            parts.push(node.native.key.join(SEPARATOR));
        }
        if (values.secondaryKeys !== undefined) {
            parts.push(node.native.keysecondary.join(SEPARATOR));
        }
        if (values.fields !== undefined) {
            for (const field of Object.keys(values.fields)) {
                const current = (node.native as unknown as Record<string, unknown>)[field];
                parts.push(`${field}=${JSON.stringify(current)}`);
            }
        }
    }
    let hash = 0x811c9dc5;
    for (const text of parts.join(SEPARATOR)) {
        hash ^= text.charCodeAt(0);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}

export type StaleReason = 'missing' | 'changed' | null;

/** The target changed (or vanished) since the proposal was parsed (FR-013). */
export function stalenessOf(state: WorkspaceState, proposal: OperationProposal): StaleReason {
    if (proposal.targetId === undefined || proposal.baseline === undefined) {
        return null;
    }
    const node = findNode(state, proposal.targetId);
    if (!node) {
        return 'missing';
    }
    const values = proposal.userEdited ?? proposal.values;
    if (
        node.updatedAt !== proposal.baseline.updatedAt ||
        fingerprintValues(node, values) !== proposal.baseline.fingerprint
    ) {
        return 'changed';
    }
    return null;
}
