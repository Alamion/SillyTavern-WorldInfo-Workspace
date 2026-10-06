import type { NativeWorldInfoEntry } from '../../global';

/**
 * Memory Books (SillyTavern-MemoryBooks, AGPL — its data format only, no code;
 * spec 007 R8). Its entries are ordinary World Info entries recognized from their
 * own fields and title conventions, so the workspace can badge and protect them
 * whether or not the extension is installed.
 */

export type MemoryKind = 'memory' | 'summary' | 'side-prompt' | 'clip';

export interface MemoryBadge {
    kind: MemoryKind;
    label: string;
}

const SIDE_PROMPT = /\(STMB (SidePrompt|Tracker|Scoreboard|Plotpoints)\)\s*$/;
const CLIP = /\[STMB Clip\]\s*$/;
/** "001 - Title" or "[001] - Title" (title format depends on the user's settings). */
const NUMBER_PREFIX = /^\s*\[?\d{1,6}\]?\s*-\s+/;

function record(native: NativeWorldInfoEntry): Record<string, unknown> {
    return native as unknown as Record<string, unknown>;
}

/** True when Memory Books owns the entry (its only "is a memory" test). */
export function isMemoryEntry(native: NativeWorldInfoEntry): boolean {
    return record(native)['stmemorybooks'] === true;
}

export function memoryBadge(native: NativeWorldInfoEntry): MemoryBadge | null {
    const side = SIDE_PROMPT.exec(native.comment);
    if (side) {
        return { kind: 'side-prompt', label: side[1] === 'SidePrompt' ? 'Side prompt' : (side[1] ?? 'Side prompt') };
    }
    if (CLIP.test(native.comment)) {
        return { kind: 'clip', label: 'Clip' };
    }
    if (!isMemoryEntry(native)) {
        return null;
    }
    const tier = record(native)['stmbSummaryTier'];
    if (typeof tier === 'number' && tier > 0) {
        return { kind: 'summary', label: `Tier ${String(tier)}` };
    }
    return { kind: 'memory', label: 'Memory' };
}

/** A rename that removes the numbered prefix Memory Books sorts and numbers by. */
export function losesMemoryNumber(previous: string, next: string): boolean {
    return NUMBER_PREFIX.test(previous) && !NUMBER_PREFIX.test(next);
}
