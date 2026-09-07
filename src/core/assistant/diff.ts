export type DiffOpType = 'same' | 'removed' | 'added';

export interface DiffOp {
    type: DiffOpType;
    text: string;
}

export interface DiffRow {
    left: string | null;
    right: string | null;
    state: 'same' | 'removed' | 'added' | 'changed';
}

function lcsTable(a: string[], b: string[]): number[][] {
    const table: number[][] = [];
    for (let i = 0; i <= a.length; i += 1) {
        table.push(new Array<number>(b.length + 1).fill(0));
    }
    for (let i = a.length - 1; i >= 0; i -= 1) {
        const row = table[i];
        if (!row) {
            continue;
        }
        for (let j = b.length - 1; j >= 0; j -= 1) {
            const ai = a[i] ?? '';
            const bj = b[j] ?? '';
            const diagonal = table[i + 1]?.[j + 1] ?? 0;
            const down = table[i + 1]?.[j] ?? 0;
            const right = table[i]?.[j + 1] ?? 0;
            row[j] = ai === bj ? diagonal + 1 : Math.max(down, right);
        }
    }
    return table;
}

export function diffLines(before: string, after: string): DiffOp[] {
    const a = before === '' ? [] : before.split('\n');
    const b = after === '' ? [] : after.split('\n');
    const table = lcsTable(a, b);
    const ops: DiffOp[] = [];
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
        const currentA = a[i] ?? '';
        const currentB = b[j] ?? '';
        if (currentA === currentB) {
            ops.push({ type: 'same', text: currentA });
            i += 1;
            j += 1;
        } else if ((table[i + 1]?.[j] ?? 0) >= (table[i]?.[j + 1] ?? 0)) {
            ops.push({ type: 'removed', text: currentA });
            i += 1;
        } else {
            ops.push({ type: 'added', text: currentB });
            j += 1;
        }
    }
    while (i < a.length) {
        ops.push({ type: 'removed', text: a[i] ?? '' });
        i += 1;
    }
    while (j < b.length) {
        ops.push({ type: 'added', text: b[j] ?? '' });
        j += 1;
    }
    return ops;
}

export function pairDiffRows(ops: DiffOp[]): DiffRow[] {
    const rows: DiffRow[] = [];
    let i = 0;
    while (i < ops.length) {
        const op = ops[i];
        if (!op) {
            break;
        }
        if (op.type === 'same') {
            rows.push({ left: op.text, right: op.text, state: 'same' });
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
            });
        }
    }
    return rows;
}
