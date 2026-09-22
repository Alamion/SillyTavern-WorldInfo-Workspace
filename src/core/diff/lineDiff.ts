/**
 * Diffs shared by every before/after view (assistant proposals, markdown conflicts,
 * …) and by the destructive-edit rule. Pure module.
 *
 * Myers' O((N+M)·D) algorithm (2026-09-22, replacing a full LCS table): time and
 * memory grow with the number of differences D, not with N·M, so two long,
 * mostly equal texts stay cheap.
 */
export type DiffOpType = 'same' | 'removed' | 'added';

export interface DiffOp {
    type: DiffOpType;
    text: string;
}

/** One piece of a changed line; `changed` = the words that differ. */
export interface DiffSegment {
    text: string;
    changed: boolean;
}

export interface DiffRow {
    left: string | null;
    right: string | null;
    state: 'same' | 'removed' | 'added' | 'changed';
    /** 1-based line numbers; null on the side where the row has no line. */
    leftNumber: number | null;
    rightNumber: number | null;
}

/**
 * Shortest edit script between two sequences. Within every changed run the
 * removals come before the additions, so paired views can line them up.
 */
export function diffSequences<T>(a: readonly T[], b: readonly T[]): Array<{ type: DiffOpType; item: T }> {
    const n = a.length;
    const m = b.length;
    const max = n + m;
    const offset = max + 1;
    const v = new Array<number>(2 * max + 3).fill(0);
    // trace[d] = the V entries for diagonals -d..d after step d (only that slice is kept).
    const trace: number[][] = [];
    let found = max === 0;
    for (let d = 0; d <= max && !found; d += 1) {
        for (let k = -d; k <= d; k += 2) {
            const down = k === -d || (k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0));
            let x = down ? (v[offset + k + 1] ?? 0) : (v[offset + k - 1] ?? 0) + 1;
            let y = x - k;
            while (x < n && y < m && a[x] === b[y]) {
                x += 1;
                y += 1;
            }
            v[offset + k] = x;
            if (x >= n && y >= m) {
                found = true;
                break;
            }
        }
        trace.push(v.slice(offset - d, offset + d + 1));
    }

    // Walk back from the end through the kept slices.
    const reversed: Array<{ type: DiffOpType; item: T }> = [];
    let x = n;
    let y = m;
    for (let d = trace.length - 1; d >= 0; d -= 1) {
        const k = x - y;
        const at = (step: number, diagonal: number): number => trace[step]?.[diagonal + step] ?? 0;
        if (d === 0) {
            while (x > 0 && y > 0) {
                x -= 1;
                y -= 1;
                reversed.push({ type: 'same', item: a[x] as T });
            }
            break;
        }
        const down = k === -d || (k !== d && at(d - 1, k - 1) < at(d - 1, k + 1));
        const previousK = down ? k + 1 : k - 1;
        const previousX = at(d - 1, previousK);
        const previousY = previousX - previousK;
        while (x > previousX && y > previousY) {
            x -= 1;
            y -= 1;
            reversed.push({ type: 'same', item: a[x] as T });
        }
        if (down) {
            y -= 1;
            reversed.push({ type: 'added', item: b[y] as T });
        } else {
            x -= 1;
            reversed.push({ type: 'removed', item: a[x] as T });
        }
    }
    const ops = reversed.reverse();

    // Removals first inside each changed run.
    const ordered: Array<{ type: DiffOpType; item: T }> = [];
    let index = 0;
    while (index < ops.length) {
        const op = ops[index];
        if (!op) {
            break;
        }
        if (op.type === 'same') {
            ordered.push(op);
            index += 1;
            continue;
        }
        const run: Array<{ type: DiffOpType; item: T }> = [];
        while (index < ops.length && ops[index]?.type !== 'same') {
            run.push(ops[index] as { type: DiffOpType; item: T });
            index += 1;
        }
        ordered.push(...run.filter((item) => item.type === 'removed'), ...run.filter((item) => item.type === 'added'));
    }
    return ordered;
}

export function diffLines(before: string, after: string): DiffOp[] {
    const a = before === '' ? [] : before.split('\n');
    const b = after === '' ? [] : after.split('\n');
    return diffSequences(a, b).map((op) => ({ type: op.type, text: op.item }));
}

/** Token count above which a word diff is not attempted (memory grows with D²). */
export const WORD_DIFF_LIMIT = 8000;

/** Words, runs of whitespace and single punctuation marks. */
export function tokenizeWords(text: string): string[] {
    return text.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? [];
}

function merged(segments: DiffSegment[]): DiffSegment[] {
    const out: DiffSegment[] = [];
    for (const segment of segments) {
        const previous = out.at(-1);
        if (previous && previous.changed === segment.changed) {
            previous.text += segment.text;
        } else {
            out.push({ ...segment });
        }
    }
    return out;
}

/**
 * Word-level highlight of one changed line pair. Whitespace between two changed
 * words counts as changed, so a rewritten phrase reads as one mark.
 */
export function diffWords(before: string, after: string): { left: DiffSegment[]; right: DiffSegment[] } {
    const beforeTokens = tokenizeWords(before);
    const afterTokens = tokenizeWords(after);
    if (beforeTokens.length + afterTokens.length > WORD_DIFF_LIMIT) {
        // A huge rewritten paragraph: marking it whole is cheaper and just as readable.
        return { left: [{ text: before, changed: true }], right: [{ text: after, changed: true }] };
    }
    const ops = diffSequences(beforeTokens, afterTokens);
    const left: DiffSegment[] = [];
    const right: DiffSegment[] = [];
    for (const op of ops) {
        if (op.type !== 'added') {
            left.push({ text: op.item, changed: op.type === 'removed' });
        }
        if (op.type !== 'removed') {
            right.push({ text: op.item, changed: op.type === 'added' });
        }
    }
    const bridge = (segments: DiffSegment[]): DiffSegment[] =>
        segments.map((segment, index) =>
            !segment.changed &&
            segment.text.trim() === '' &&
            segments[index - 1]?.changed === true &&
            segments[index + 1]?.changed === true
                ? { ...segment, changed: true }
                : segment
        );
    // Whitespace at the edges of a mark stays unmarked ("truly " → "truly").
    const trimmed = (segments: DiffSegment[]): DiffSegment[] =>
        merged(
            merged(bridge(segments)).flatMap((segment) => {
                const edges = /^(\s*)([\s\S]*?)(\s*)$/.exec(segment.text);
                if (!segment.changed || !edges || (edges[2] ?? '') === '') {
                    return [segment];
                }
                return [
                    { text: edges[1] ?? '', changed: false },
                    { text: edges[2] ?? '', changed: true },
                    { text: edges[3] ?? '', changed: false },
                ].filter((part) => part.text !== '');
            })
        );
    return { left: trimmed(left), right: trimmed(right) };
}

export function pairDiffRows(ops: DiffOp[]): DiffRow[] {
    const rows: DiffRow[] = [];
    let leftNumber = 0;
    let rightNumber = 0;
    let i = 0;
    while (i < ops.length) {
        const op = ops[i];
        if (!op) {
            break;
        }
        if (op.type === 'same') {
            leftNumber += 1;
            rightNumber += 1;
            rows.push({ left: op.text, right: op.text, state: 'same', leftNumber, rightNumber });
            i += 1;
            continue;
        }
        const removed: string[] = [];
        while (i < ops.length && ops[i]?.type === 'removed') {
            removed.push(ops[i]?.text ?? '');
            i += 1;
        }
        const added: string[] = [];
        while (i < ops.length && ops[i]?.type === 'added') {
            added.push(ops[i]?.text ?? '');
            i += 1;
        }
        const pairs = Math.max(removed.length, added.length);
        for (let k = 0; k < pairs; k += 1) {
            const left = k < removed.length ? (removed[k] ?? '') : null;
            const right = k < added.length ? (added[k] ?? '') : null;
            rows.push({
                left,
                right,
                state:
                    left !== null && right !== null
                        ? 'changed'
                        : left !== null
                          ? 'removed'
                          : 'added',
                leftNumber: left !== null ? (leftNumber += 1) : null,
                rightNumber: right !== null ? (rightNumber += 1) : null,
            });
        }
    }
    return rows;
}
