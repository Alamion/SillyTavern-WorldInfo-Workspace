import { describe, expect, it } from 'vitest';
import { NO_RECORD, reconcile, type DiskItem, type WsItem } from '../../src/core/md/reconcile';
import type { BaselineItem, MdItemKind } from '../../src/core/md/ports';

const ROOT = 'root';

function ws(items: Array<[id: string, kind: MdItemKind, path: string, hash: string]>): Map<string, WsItem> {
    const map = new Map<string, WsItem>([[ROOT, { id: ROOT, kind: 'folder', path: '', parentId: null, name: 'Workspace', hash: NO_RECORD }]]);
    for (const [id, kind, path, hash] of items) {
        map.set(id, { id, kind, path, parentId: ROOT, name: path, hash });
    }
    return map;
}

function disk(items: Array<[path: string, kind: MdItemKind, hash: string, canon?: string, extra?: Partial<DiskItem>]>): Map<string, DiskItem> {
    const map = new Map<string, DiskItem>([['', { kind: 'folder', path: '', hash: NO_RECORD, canonHash: NO_RECORD, name: '' }]]);
    for (const [path, kind, hash, canon, extra] of items) {
        map.set(path, { kind, path, hash, canonHash: canon ?? hash, name: path.split('/').pop()!.replace(/\.md$/, ''), ...extra });
    }
    return map;
}

function base(items: Array<[id: string, kind: MdItemKind, path: string | null, wsHash: string, diskHash: string]>): Record<string, BaselineItem> {
    const record: Record<string, BaselineItem> = {
        [ROOT]: { id: ROOT, kind: 'folder', path: '', wsHash: NO_RECORD, diskHash: NO_RECORD },
    };
    for (const [id, kind, path, wsHash, diskHash] of items) {
        record[id] = { id, kind, path, wsHash, diskHash };
    }
    return record;
}

const run = (w: Map<string, WsItem>, d: Map<string, DiskItem>, b: Record<string, BaselineItem>) =>
    reconcile({ rootId: ROOT, ws: w, disk: d, baseline: b });

describe('reconcile — decision table (research R7)', () => {
    it('same / same → nothing', () => {
        const result = run(ws([['e', 'entry', 'A.md', 'w1']]), disk([['A.md', 'entry', 'd1']]), base([['e', 'entry', 'A.md', 'w1', 'd1']]));
        expect(result.toWorkspace).toEqual([]);
        expect(result.conflicts).toEqual([]);
        expect(result.pendingDeletions).toEqual([]);
    });

    it('disk changed only → update the workspace', () => {
        const result = run(ws([['e', 'entry', 'A.md', 'w1']]), disk([['A.md', 'entry', 'd2']]), base([['e', 'entry', 'A.md', 'w1', 'd1']]));
        expect(result.toWorkspace).toEqual([{ type: 'update', id: 'e', path: 'A.md', kind: 'entry' }]);
    });

    it('workspace changed only → left to the push (no pull action)', () => {
        const result = run(ws([['e', 'entry', 'A.md', 'w2']]), disk([['A.md', 'entry', 'd1']]), base([['e', 'entry', 'A.md', 'w1', 'd1']]));
        expect(result.toWorkspace).toEqual([]);
        expect(result.conflicts).toEqual([]);
    });

    it('both changed → conflict, unless the canonical forms are equal', () => {
        const b = base([['e', 'entry', 'A.md', 'w1', 'd1']]);
        const conflict = run(ws([['e', 'entry', 'A.md', 'w2']]), disk([['A.md', 'entry', 'd2', 'c2']]), b);
        expect(conflict.conflicts).toEqual([{ id: 'e', kind: 'entry', path: 'A.md', workspace: 'edited', disk: 'edited' }]);
        const equal = run(ws([['e', 'entry', 'A.md', 'same']]), disk([['A.md', 'entry', 'd2', 'same']]), b);
        expect(equal.conflicts).toEqual([]);
        expect(equal.adopt).toEqual([{ id: 'e', path: 'A.md', kind: 'entry' }]);
    });

    it('same / missing → pending deletion; changed / missing → conflict', () => {
        const b = base([['e', 'entry', 'A.md', 'w1', 'd1']]);
        expect(run(ws([['e', 'entry', 'A.md', 'w1']]), disk([]), b).pendingDeletions).toEqual([{ id: 'e', path: 'A.md', kind: 'entry' }]);
        expect(run(ws([['e', 'entry', 'A.md', 'w2']]), disk([]), b).conflicts).toEqual([
            { id: 'e', kind: 'entry', path: 'A.md', workspace: 'edited', disk: 'deleted' },
        ]);
    });

    it('missing / same → push removes; missing / changed → conflict', () => {
        const b = base([['e', 'entry', 'A.md', 'w1', 'd1']]);
        const removed = run(ws([]), disk([['A.md', 'entry', 'd1']]), b);
        expect(removed.conflicts).toEqual([]);
        expect(removed.toWorkspace).toEqual([]);
        expect(run(ws([]), disk([['A.md', 'entry', 'd2']]), b).conflicts).toEqual([
            { id: 'e', kind: 'entry', path: 'A.md', workspace: 'deleted', disk: 'edited' },
        ]);
    });

    it('unclaimed disk items become creations, parents first', () => {
        const result = run(ws([]), disk([['Sub/New.md', 'entry', 'n'], ['Sub', 'folder', NO_RECORD]]), base([]));
        expect(result.toWorkspace).toEqual([
            { type: 'create', path: 'Sub', kind: 'folder', parentPath: '' },
            { type: 'create', path: 'Sub/New.md', kind: 'entry', parentPath: 'Sub' },
        ]);
    });
});

describe('reconcile — identity without ids (FR-003)', () => {
    it('detects an unchanged file renamed on disk as a move', () => {
        const result = run(ws([['e', 'entry', 'A.md', 'w1']]), disk([['B.md', 'entry', 'd1']]), base([['e', 'entry', 'A.md', 'w1', 'd1']]));
        expect(result.matches.get('e')).toEqual({ path: 'B.md', via: 'content-move' });
        expect(result.toWorkspace).toEqual([{ type: 'move', id: 'e', path: 'B.md', kind: 'entry', parentPath: '', name: 'B' }]);
        expect(result.pendingDeletions).toEqual([]);
    });

    it('turns rename + edit into deletion + creation (deletion confirmed by the user)', () => {
        const result = run(ws([['e', 'entry', 'A.md', 'w1']]), disk([['B.md', 'entry', 'd2']]), base([['e', 'entry', 'A.md', 'w1', 'd1']]));
        expect(result.pendingDeletions).toEqual([{ id: 'e', path: 'A.md', kind: 'entry' }]);
        expect(result.toWorkspace).toEqual([{ type: 'create', path: 'B.md', kind: 'entry', parentPath: '' }]);
    });

    it('falls back to delete + create when content matches are ambiguous', () => {
        const b = base([
            ['e1', 'entry', 'A.md', 'w', 'same'],
            ['e2', 'entry', 'B.md', 'w', 'same'],
        ]);
        const result = run(ws([['e1', 'entry', 'A.md', 'w'], ['e2', 'entry', 'B.md', 'w']]), disk([['C.md', 'entry', 'same'], ['D.md', 'entry', 'same']]), b);
        expect(result.matches.has('e1')).toBe(false);
        expect(result.pendingDeletions).toHaveLength(2);
    });

    it('honors a unique wi_id hint', () => {
        const result = run(
            ws([['e', 'entry', 'A.md', 'w1']]),
            disk([['Elsewhere.md', 'entry', 'd9', 'd9', { idHint: 'e' }]]),
            base([['e', 'entry', 'A.md', 'w1', 'd1']])
        );
        expect(result.matches.get('e')).toEqual({ path: 'Elsewhere.md', via: 'wi_id' });
        expect(result.toWorkspace).toContainEqual({ type: 'update', id: 'e', path: 'Elsewhere.md', kind: 'entry' });
    });

    it('moves a renamed directory with its descendants', () => {
        const b = base([
            ['f', 'folder', 'Old', NO_RECORD, NO_RECORD],
            ['e1', 'entry', 'Old/A.md', 'w1', 'd1'],
            ['e2', 'entry', 'Old/B.md', 'w2', 'd2x'],
        ]);
        const result = run(
            ws([['f', 'folder', 'Old', NO_RECORD], ['e1', 'entry', 'Old/A.md', 'w1'], ['e2', 'entry', 'Old/B.md', 'w2']]),
            disk([['New', 'folder', NO_RECORD], ['New/A.md', 'entry', 'd1'], ['New/B.md', 'entry', 'd2y']]),
            b
        );
        expect(result.matches.get('f')).toEqual({ path: 'New', via: 'folder-move' });
        expect(result.matches.get('e2')).toEqual({ path: 'New/B.md', via: 'folder-move' });
        expect(result.toWorkspace).toContainEqual({ type: 'move', id: 'f', path: 'New', kind: 'folder', parentPath: '', name: 'New' });
        expect(result.toWorkspace).toContainEqual({ type: 'update', id: 'e2', path: 'New/B.md', kind: 'entry' });
        expect(result.pendingDeletions).toEqual([]);
        expect(result.toWorkspace.filter((change) => change.type === 'create')).toEqual([]);
    });

    it('treats different moves on both sides as a conflict', () => {
        const result = run(ws([['e', 'entry', 'WsName.md', 'w1']]), disk([['DiskName.md', 'entry', 'd1']]), base([['e', 'entry', 'A.md', 'w1', 'd1']]));
        expect(result.conflicts).toEqual([{ id: 'e', kind: 'entry', path: 'DiskName.md', workspace: 'moved', disk: 'moved' }]);
    });
});

describe('reconcile — initial link without baseline (R9)', () => {
    it('adopts equal pairs, conflicts different ones, and creates one-sided items', () => {
        const result = run(
            ws([['same', 'entry', 'Same.md', 'h'], ['diff', 'entry', 'Diff.md', 'w'], ['wsOnly', 'entry', 'Only.md', 'x']]),
            disk([['Same.md', 'entry', 'raw', 'h'], ['Diff.md', 'entry', 'raw2', 'other'], ['DiskOnly.md', 'entry', 'y']]),
            {}
        );
        expect(result.adopt).toContainEqual({ id: 'same', path: 'Same.md', kind: 'entry' });
        expect(result.conflicts).toEqual([{ id: 'diff', kind: 'entry', path: 'Diff.md', workspace: 'created', disk: 'created' }]);
        expect(result.toWorkspace).toEqual([{ type: 'create', path: 'DiskOnly.md', kind: 'entry', parentPath: '' }]);
    });

    it('takes a disk folder record when the workspace folder has only defaults, and vice versa', () => {
        const takeDisk = run(ws([['f', 'folder', 'F', NO_RECORD]]), disk([['F', 'folder', 'rec', 'rec']]), {});
        expect(takeDisk.toWorkspace).toEqual([{ type: 'update', id: 'f', path: 'F', kind: 'folder' }]);
        const keepWs = run(ws([['f', 'folder', 'F', 'wsrec']]), disk([['F', 'folder', NO_RECORD]]), {});
        expect(keepWs.toWorkspace).toEqual([]);
        expect(keepWs.conflicts).toEqual([]);
    });

    it('links a plain vault imported earlier without any action (FR-023)', () => {
        const result = run(
            ws([['a', 'entry', 'A.md', 'ha'], ['s', 'folder', 'Sub', NO_RECORD], ['b', 'entry', 'Sub/B.md', 'hb']]),
            disk([['A.md', 'entry', 'ha'], ['Sub', 'folder', NO_RECORD], ['Sub/B.md', 'entry', 'rawb', 'hb']]),
            {}
        );
        expect(result.toWorkspace).toEqual([]);
        expect(result.conflicts).toEqual([]);
        expect(result.adopt.map((item) => item.id).sort()).toEqual(['a', 'b', 'root', 's']);
    });
});
