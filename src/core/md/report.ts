/** Operation reports shown after every import/export/sync (spec 004 FR-019). */

export type ReportOperation = 'import' | 'export' | 'sync' | 'link';
export type ReportOutcome =
    | 'created'
    | 'updated'
    | 'moved'
    | 'deleted'
    | 'skipped'
    | 'preserved'
    | 'conflict'
    | 'warning';

export interface ReportLine {
    path: string;
    outcome: ReportOutcome;
    message?: string;
}

export type ReportCounts = Record<ReportOutcome, number>;

export interface OperationReport {
    operation: ReportOperation;
    startedAt: string;
    finishedAt: string;
    counts: ReportCounts;
    lines: ReportLine[];
}

export interface ReportBuilder {
    add(path: string, outcome: ReportOutcome, message?: string): void;
    lines(): readonly ReportLine[];
    finish(): OperationReport;
}

export function emptyCounts(): ReportCounts {
    return { created: 0, updated: 0, moved: 0, deleted: 0, skipped: 0, preserved: 0, conflict: 0, warning: 0 };
}

export function createReportBuilder(operation: ReportOperation, now: () => string = () => new Date().toISOString()): ReportBuilder {
    const startedAt = now();
    const lines: ReportLine[] = [];
    return {
        add: (path, outcome, message) => {
            lines.push(message === undefined ? { path, outcome } : { path, outcome, message });
        },
        lines: () => lines,
        finish: () => {
            const counts = emptyCounts();
            lines.forEach((line) => (counts[line.outcome] += 1));
            return { operation, startedAt, finishedAt: now(), counts, lines: [...lines] };
        },
    };
}
