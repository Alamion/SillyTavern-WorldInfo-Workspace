import type { NativeWorldInfoEntry, WorldInfoBook } from '../../global';
import {
    findNode,
    type EntryNode,
    type OrphanedEntry,
    type TreeNode,
    type WorkspaceState,
} from '../state/schema';
import { validateNode } from '../tree/validation';
import { fingerprintEntry } from './fingerprint';

/**
 * Flattens a designated root's subtree into its native book payload (FR-013/
 * FR-014). Pure. Nested designations are traversed as ordinary folders — their
 * entities legitimately appear in the parent book too (world intersection).
 * Orphaned native entries (FR-018) are retained; invalid entities are skipped
 * with a visible reason (FR-010 publish-block), never silently coerced.
 */
export interface FlattenInput {
    state: WorkspaceState;
    rootId: string;
    /** The book being flattened — uid allocation is per book (nested WI). */
    bookName: string;
    existingBook: WorldInfoBook;
    orphans: OrphanedEntry[];
    /** Assigns a fresh uid from the book's free pool (0..999999). */
    allocateUid(used: ReadonlySet<number>): number;
}

export interface FlattenSkipped {
    nodeId: string;
    reason: string;
}

export interface FlattenExported {
    nodeId: string;
    uid: number;
    hash: string;
}

export interface FlattenResult {
    book: WorldInfoBook;
    entries: Record<string, NativeWorldInfoEntry>;
    exported: FlattenExported[];
    skipped: FlattenSkipped[];
}

export function flattenRoot(input: FlattenInput): FlattenResult {
    const root = findNode(input.state, input.rootId);
    if (root?.kind !== 'folder' || !root.isWiRoot) {
        return {
            book: { ...input.existingBook, entries: {} },
            entries: {},
            exported: [],
            skipped: [],
        };
    }
    const orphans = Array.isArray(input.orphans) ? input.orphans : [];

    // Pass 1: collect the subtree's exportable nodes and their claimed uids.
    // Images (and folders) are workspace-only organizational items — they never
    // export to the native book (owner decision 2026-09-08, reversing the
    // Phase 0 merged-export model).
    const nodes: EntryNode[] = [];
    const uidClaims = new Map<number, number>();
    const collect = (node: TreeNode): void => {
        if (node.kind === 'folder') {
            node.children.forEach(collect);
            return;
        }
        if (node.kind === 'image') {
            return;
        }
        nodes.push(node);
        const bookSync = node.sync.books[input.bookName];
        if (bookSync?.uid !== null && bookSync?.uid !== undefined && Number.isFinite(bookSync.uid)) {
            uidClaims.set(bookSync.uid, (uidClaims.get(bookSync.uid) ?? 0) + 1);
        }
    };
    collect(root);

    // The book's occupied uids (native entries not owned by this walk) stay taken.
    const used = new Set<number>();
    for (const key of Object.keys(input.existingBook.entries ?? {})) {
        const uid = Number(key);
        if (Number.isFinite(uid)) {
            used.add(uid);
        }
    }
    for (const orphan of orphans) {
        used.add(orphan.uid);
    }
    // A node keeps its uid only when exclusively claimed and inside the pool.
    const keepIds = new Set<string>();
    for (const node of nodes) {
        const uid = node.sync.books[input.bookName]?.uid;
        if (uid !== undefined && uid !== null && uidClaims.get(uid) === 1 && uid >= 0 && uid <= 999999) {
            keepIds.add(node.id);
        }
    }

    const entries: Record<string, NativeWorldInfoEntry> = {};
    const exported: FlattenExported[] = [];
    const skipped: FlattenSkipped[] = [];

    const writeNode = (node: EntryNode): void => {
        const violations = validateNode(node);
        if (violations.length > 0) {
            skipped.push({ nodeId: node.id, reason: violations[0]!.message });
            return;
        }
        let uid: number;
        const ownSync = node.sync.books[input.bookName];
        if (ownSync !== undefined && keepIds.has(node.id) && ownSync.uid !== null) {
            uid = ownSync.uid;
        } else {
            uid = input.allocateUid(used);
        }
        used.add(uid);
        const native = structuredClone(node.native);
        native.uid = uid;
        native.comment = node.name;
        native.displayIndex = exported.length;
        entries[String(uid)] = native;
        exported.push({ nodeId: node.id, uid, hash: fingerprintEntry(native) });
    };
    nodes.forEach(writeNode);

    // FR-018 retention: orphaned native entries stay in the book until resolved.
    for (const orphan of orphans) {
        const entry = input.existingBook.entries?.[String(orphan.uid)];
        if (entry) {
            entries[String(orphan.uid)] = structuredClone(entry);
        }
    }

    const book: WorldInfoBook = { ...input.existingBook, entries };
    return { book, entries, exported, skipped };
}