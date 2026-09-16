import { renderMarkdown } from '../preview';
import { parseReply } from './parser';
import type { Message } from './types';

/**
 * What the conversation log shows for a message (spec 005 FR-002). Assistant
 * replies always show prose — operation blocks are rendered as proposal cards,
 * never as raw text (regression from the 2026-09-15 live run).
 */
export function displayText(message: Message): string {
    if (message.role !== 'assistant') {
        return message.text;
    }
    return message.prose ?? parseReply(message.text, {}).prose;
}

/**
 * Request status line. Reasoning models stream thinking before any answer text:
 * the counter follows the reasoning until the reply itself starts (regression
 * from the 2026-09-15 live run, where it said "0 chars" for 23 s).
 */
export function statusText(message: Message, now: number = Date.now()): string | null {
    if (message.status === 'pending') {
        const started = message.startedAt !== undefined ? Date.parse(message.startedAt) : now;
        const seconds = Math.max(0, Math.round((now - started) / 1000));
        return `Waiting for the model… ${String(seconds)} s`;
    }
    if (message.status === 'receiving') {
        if (message.text === '' && (message.reasoning ?? '') !== '') {
            return `Thinking… ${String(message.reasoning?.length ?? 0)} chars`;
        }
        return `Receiving… ${String(message.text.length)} chars`;
    }
    if (message.status === 'stopped') {
        return 'Stopped.';
    }
    return null;
}

const REF_OPEN = '\uE000';
const REF_CLOSE = '\uE001';

/**
 * Reply prose as HTML with `[[handle]]` references as buttons (FR-005). The
 * markdown is rendered ONCE for the whole text: splitting it at references first
 * broke `**[[e1]] Bristlemark**` and list items apart (live run 2026-09-16). The
 * references pass through the renderer as private-use markers it leaves
 * untouched, and become buttons afterwards; clicks are delegated via `data-handle`.
 */
export function replyHtml(text: string): string {
    const marked = text.replace(/\[\[([A-Za-z0-9_-]+)\]\]/g, `${REF_OPEN}$1${REF_CLOSE}`);
    return renderMarkdown(marked).replace(
        new RegExp(`${REF_OPEN}([A-Za-z0-9_-]+)${REF_CLOSE}`, 'g'),
        '<button type="button" class="wiw-assistant-ref" data-handle="$1">$1</button>'
    );
}
