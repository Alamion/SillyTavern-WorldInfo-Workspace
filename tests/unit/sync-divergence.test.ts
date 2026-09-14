import { describe, expect, it } from 'vitest';
import type { NativeWorldInfoEntry, WorldInfoBook } from '../../src/global';
import { fingerprintEntry } from '../../src/core/sync/fingerprint';
import { analyzeNativeBook, pushDecision } from '../../src/core/sync/divergence';

function fingerprintOf(entry: NativeWorldInfoEntry): string {
    return fingerprintEntry(entry);
}

function book(entries: Array<{ uid: number; content: string }>): WorldInfoBook {
    const map: WorldInfoBook['entries'] = {};
    for (const item of entries) {
        map[String(item.uid)] = {
            uid: item.uid,
            key: [],
            keysecondary: [],
            comment: '',
            content: item.content,
            constant: false,
            vectorized: false,
            selective: true,
            selectiveLogic: 0,
            probability: 100,
            useProbability: true,
            disable: false,
            order: 100,
            position: 0,
            depth: 4,
            role: 0,
            outletName: '',
            ignoreBudget: false,
            excludeRecursion: false,
            preventRecursion: false,
            delayUntilRecursion: 0,
            matchPersonaDescription: false,
            matchCharacterDescription: false,
            matchCharacterPersonality: false,
            matchCharacterDepthPrompt: false,
            matchScenario: false,
            matchCreatorNotes: false,
            group: '',
            groupOverride: false,
            groupWeight: 100,
            scanDepth: null,
            caseSensitive: null,
            matchWholeWords: null,
            useGroupScoring: null,
            sticky: null,
            cooldown: null,
            delay: null,
            automationId: '',
            triggers: [],
            characterFilterNames: [],
            characterFilterTags: [],
            characterFilterExclude: false,
            addMemo: true,
        };
    }
    return { entries: map };
}

describe('analyzeNativeBook (FR-015)', () => {
    it('reports drifted entries when native content differs from the last export', () => {
        const native = book([{ uid: 5, content: 'changed externally' }]);
        const analysis = analyzeNativeBook({
            book: native,
            entities: [{ nodeId: 'e1', uid: 5, hash: 'stale-hash', status: 'in-sync' }],
            orphanUids: new Set(),
        });
        expect(analysis.driftedUids).toEqual([5]);
        expect(analysis.foreign).toEqual([]);
    });

    it('reports no drift when hashes match', () => {
        const entry = book([{ uid: 5, content: 'same' }]).entries['5']!;
        const native = book([{ uid: 5, content: 'same' }]);
        const analysis = analyzeNativeBook({
            book: native,
            entities: [{ nodeId: 'e1', uid: 5, hash: fingerprintOf(entry), status: 'in-sync' }],
            orphanUids: new Set(),
        });
        expect(analysis.driftedUids).toEqual([]);
    });

    it('detects foreign entries (no workspace entity, not orphaned)', () => {
        const native = book([{ uid: 5, content: 'ws' }, { uid: 9, content: 'alien' }]);
        const analysis = analyzeNativeBook({
            book: native,
            entities: [{ nodeId: 'e1', uid: 5, hash: null, status: 'in-sync' }],
            orphanUids: new Set([7]),
        });
        expect(analysis.foreign.map((entry) => entry.uid)).toEqual([9]);
    });

    it('orphaned uids are not foreign', () => {
        const native = book([{ uid: 7, content: 'retained' }]);
        const analysis = analyzeNativeBook({
            book: native,
            entities: [],
            orphanUids: new Set([7]),
        });
        expect(analysis.foreign).toEqual([]);
    });
});

describe('pushDecision (FR-015, never silent)', () => {
    it('allows clean pushes', () => {
        expect(pushDecision({ drifted: false, foreignCount: 0 }).allowed).toBe(true);
    });

    it('blocks pushes when native drifted or foreign entries exist', () => {
        expect(pushDecision({ drifted: true, foreignCount: 0 }).allowed).toBe(false);
        expect(pushDecision({ drifted: false, foreignCount: 2 }).allowed).toBe(false);
        expect(pushDecision({ drifted: true, foreignCount: 1 }).reason).toBe('drift');
    });
});