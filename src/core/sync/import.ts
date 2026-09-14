import type { WorldInfoBook } from '../../global';
import type { EntryNode, SyncState } from '../state/schema';
import { fingerprintEntry } from './fingerprint';
import { normalizeNativeEntry } from '../state/schema';

/**
 * Native book → workspace mapping (FR-016). Unbound import produces fresh
 * entities; bound re-import produces a per-entry conflict/refresh/addition/
 * deletion plan (FR-015). displayIndex drives child order; empty comments fall
 * back to the first key, then `Entry <uid>`. Books never contain images
 * (workspace-only), so the mapping yields entries exclusively.
 */

function freshSync(bookName: string, uid: number, hash: string | null): SyncState {
    return {
        books: {
            [bookName]: { uid, hash, status: 'in-sync' },
        },
    };
}

export function mapBookToNodes(
    book: WorldInfoBook,
    bookName: string,
    newId: () => string,
    now: string
): EntryNode[] {
    const entries = book.entries ?? {};
    const mapped = Object.keys(entries)
        .map((key) => {
            const entry = entries[key]!;
            const uid = Number(key);
            return { entry, uid };
        })
        .filter((item) => Number.isFinite(item.uid));
    mapped.sort((a, b) => {
        const ai = a.entry.displayIndex ?? a.uid;
        const bi = b.entry.displayIndex ?? b.uid;
        return ai - bi;
    });
    const nodes: EntryNode[] = [];
    for (const { entry: rawEntry, uid } of mapped) {
        const entry = normalizeNativeEntry(rawEntry);
        const copy = structuredClone(entry);
        copy.uid = uid;
        const name =
            (copy.comment ?? '').trim() !== ''
                ? copy.comment
                : (copy.key[0] ?? '').trim() !== ''
                  ? copy.key[0]!.trim()
                  : `Entry ${uid}`;
        copy.comment = name;
        // The native uid IS the import identity: bound re-import matches by it.
        nodes.push({
            id: newId(),
            parentId: '',
            kind: 'entry',
            name,
            createdAt: now,
            updatedAt: now,
            native: copy,
            sync: freshSync(bookName, uid, fingerprintEntry(copy)),
        });
    }
    return nodes;
}

/** Bound re-import: per-entry conflict model (FR-015). */
export interface BoundConflict {
    nodeId: string;
    uid: number;
    nativeEntry: import('../../global').NativeWorldInfoEntry;
    workspaceDirty: boolean;
}

/** Native changed while the workspace copy was clean: refresh in place. */
export interface BoundRefresh {
    nodeId: string;
    uid: number;
    nativeEntry: import('../../global').NativeWorldInfoEntry;
}

export interface BoundAddition {
    uid: number;
    native: import('../../global').NativeWorldInfoEntry;
    name: string;
}

export interface BoundImportPlan {
    /** Both sides changed — user resolves (keep workspace / take native). */
    conflicts: BoundConflict[];
    /** Native changed, workspace copy clean — refreshed in place. */
    refreshes: BoundRefresh[];
    /** Native-only entries — imported into the root on apply. */
    additions: BoundAddition[];
    /** Native entry deleted while the workspace copy was clean — mirrored. */
    deletions: Array<{ nodeId: string; uid: number }>;
}

export interface BoundEntity {
    nodeId: string;
    uid: number | null;
    hash: string | null;
    status: string;
}

/**
 * Bound re-import matching (FR-015, contract §11): entities match native
 * entries by uid; entities whose uid was never recorded (or lost in older
 * imports) fall back to a fingerprint match — same content is the same entry,
 * never a duplicate. Both-changed entries become conflicts the user resolves.
 */
export function planBoundImport(input: {
    book: WorldInfoBook;
    entities: BoundEntity[];
    /** Uids to skip outright: tombstoned deletions and orphan-retained slots. */
    skipUids?: ReadonlySet<number>;
}): BoundImportPlan {
    const entityByUid = new Map<number, BoundEntity>();
    input.entities.forEach((entity) => {
        if (entity.uid !== null) {
            entityByUid.set(entity.uid, entity);
        }
    });
    const unidentified = input.entities.filter(
        (entity) => entity.uid === null && entity.hash !== null
    );
    const conflicts: BoundConflict[] = [];
    const refreshes: BoundRefresh[] = [];
    const additions: BoundAddition[] = [];
    const deletions: Array<{ nodeId: string; uid: number }> = [];
    const skip = input.skipUids ?? new Set<number>();
    const nativeEntries = input.book.entries ?? {};
    const nativeUids = new Set(
        Object.keys(nativeEntries)
            .map((key) => Number(key))
            .filter((uid) => Number.isFinite(uid))
    );
    for (const key of Object.keys(nativeEntries)) {
        const entry = nativeEntries[key]!;
        const uid = Number(key);
        if (skip.has(uid)) {
            continue;
        }
        let entity = entityByUid.get(uid);
        if (!entity) {
            // Fingerprint fallback: re-identify legacy entries whose uid was
            // never recorded (heals data from earlier builds without deleting).
            const nativeHash = fingerprintEntry(entry);
            entity = unidentified.find(
                (candidate) => candidate.hash !== null && candidate.hash === nativeHash
            );
            if (!entity) {
                additions.push({ uid, native: entry, name: entry.comment || `Entry ${uid}` });
                continue;
            }
        }
        const nativeHash = fingerprintEntry(entry);
        if (entity.hash !== null && entity.hash === nativeHash) {
            continue;
        }
        if (entity.status === 'dirty') {
            conflicts.push({ nodeId: entity.nodeId, uid, nativeEntry: entry, workspaceDirty: true });
        } else {
            // Native changed while the workspace copy was clean: refresh silently.
            refreshes.push({ nodeId: entity.nodeId, uid, nativeEntry: entry });
        }
    }
    // Mirror native deletions: a clean entity whose uid no longer exists in the
    // native book was deleted natively — remove it here too (workspace-authoritative:
    // dirty copies survive and re-create on push).
    for (const entity of input.entities) {
        if (
            entity.uid !== null &&
            !skip.has(entity.uid) &&
            !nativeUids.has(entity.uid) &&
            entity.status === 'in-sync' &&
            entity.hash !== null
        ) {
            deletions.push({ nodeId: entity.nodeId, uid: entity.uid });
        }
    }
    return { conflicts, refreshes, additions, deletions };
}