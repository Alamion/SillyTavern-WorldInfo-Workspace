import type { NativeWorldInfoEntry, WorldInfoBook } from '../../global';
export type EntitySyncStatus = 'new' | 'in-sync' | 'dirty';
import { fingerprintEntry } from './fingerprint';

/**
 * Divergence analysis and push guards (FR-015 — never silent in either
 * direction). Pure module; the sync engine feeds it live book data and the
 * workspace entity bookkeeping, then surfaces results in the UI.
 */

export interface EntitySyncRef {
    nodeId: string;
    uid: number | null;
    hash: string | null;
    status: EntitySyncStatus | 'orphaned';
}

export interface BookAnalysis {
    /** Native entries differing from the entity's last-exported fingerprint. */
    driftedUids: number[];
    /** Entries whose uid matches no workspace entity and no orphan row. */
    foreign: NativeWorldInfoEntry[];
}

export function analyzeNativeBook(input: {
    book: WorldInfoBook;
    entities: EntitySyncRef[];
    orphanUids: ReadonlySet<number>;
}): BookAnalysis {
    const entities = Array.isArray(input.entities) ? input.entities : [];
    const orphanUids = input.orphanUids instanceof Set ? input.orphanUids : new Set<number>();
    const byUid = new Map<number, EntitySyncRef>();
    entities.forEach((entity) => {
        if (entity.uid !== null) {
            byUid.set(entity.uid, entity);
        }
    });
    const driftedUids: number[] = [];
    const foreign: NativeWorldInfoEntry[] = [];
    const nativeEntries = input.book.entries ?? {};
    for (const key of Object.keys(nativeEntries)) {
        const entry = nativeEntries[key];
        if (!entry) {
            continue;
        }
        const uid = Number(key);
        const entity = byUid.get(uid);
        if (entity) {
            if (entity.hash !== null && fingerprintEntry(entry) !== entity.hash) {
                driftedUids.push(uid);
            }
            continue;
        }
        if (!orphanUids.has(uid)) {
            foreign.push(entry);
        }
    }
    return { driftedUids, foreign };
}

export interface PushDecision {
    allowed: boolean;
    reason?: 'drift' | 'foreign';
}

export function pushDecision(status: { drifted: boolean; foreignCount: number }): PushDecision {
    if (status.drifted) {
        return { allowed: false, reason: 'drift' };
    }
    if (status.foreignCount > 0) {
        return { allowed: false, reason: 'foreign' };
    }
    return { allowed: true };
}