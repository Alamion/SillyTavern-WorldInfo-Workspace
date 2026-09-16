import { describe, expect, it } from 'vitest';
import { displayText, replyHtml, statusText } from '../../src/core/assistant/display';
import type { Message } from '../../src/core/assistant/types';

/**
 * Regression tests from the live run on 2026-09-15 (spec 005 T077):
 * - the reply bubble showed raw <op> blocks instead of the prose;
 * - a reasoning model streamed 23 s of thinking while the counter said "0 chars".
 */

function message(overrides: Partial<Message>): Message {
    return {
        conversationId: 'c',
        seq: 1,
        role: 'assistant',
        text: '',
        status: 'received',
        mode: 'propose',
        createdAt: '2026-09-15T12:00:00.000Z',
        ...overrides,
    };
}

describe('displayText', () => {
    it('shows the prose of an assistant reply, never the raw blocks', () => {
        const raw = 'Two taverns.\n\n<op type="create_entry" parent="f9"><title>A</title></op>';
        expect(displayText(message({ text: raw, prose: 'Two taverns.' }))).toBe('Two taverns.');
    });

    it('strips blocks even before the prose was computed', () => {
        const raw = 'Intro.\n<op type="delete" id="e1"></op>\nOutro.';
        expect(displayText(message({ text: raw }))).toBe('Intro.\n\nOutro.');
    });

    it('shows user messages verbatim', () => {
        expect(displayText(message({ role: 'user', text: 'Keep <b>this</b>' }))).toBe('Keep <b>this</b>');
    });
});

describe('statusText', () => {
    const now = Date.parse('2026-09-15T12:00:10.000Z');

    it('shows elapsed seconds while waiting', () => {
        expect(
            statusText(message({ status: 'pending', startedAt: '2026-09-15T12:00:03.000Z' }), now)
        ).toBe('Waiting for the model… 7 s');
    });

    it('counts reasoning characters while the model is still thinking', () => {
        expect(
            statusText(message({ status: 'receiving', text: '', reasoning: 'x'.repeat(420) }), now)
        ).toBe('Thinking… 420 chars');
    });

    it('counts reply characters once the answer streams', () => {
        expect(
            statusText(message({ status: 'receiving', text: 'y'.repeat(812), reasoning: 'x'.repeat(420) }), now)
        ).toBe('Receiving… 812 chars');
    });

    it('is empty for finished messages and says stopped for stopped ones', () => {
        expect(statusText(message({ status: 'received', text: 'done' }), now)).toBeNull();
        expect(statusText(message({ status: 'stopped' }), now)).toBe('Stopped.');
    });
});

describe('replyHtml (live run 2026-09-16)', () => {
    it('keeps markdown around references intact', () => {
        const html = replyHtml('Entries:\n\n- **[[e1]] Bristlemark** — harbor city\n- **[[e2]] Cinderhollow**');
        expect(html).toContain(
            '<li><strong><button type="button" class="wiw-assistant-ref" data-handle="e1">e1</button> Bristlemark</strong> — harbor city</li>'
        );
        expect(html).not.toContain('**');
        expect(html.match(/<li>/g)).toHaveLength(2);
    });

    it('escapes html in prose and ignores malformed references', () => {
        const html = replyHtml('<script>x</script> [[e1 ]] [[f2]]');
        expect(html).toContain('&lt;script&gt;');
        expect(html).toContain('[[e1 ]]');
        expect(html).toContain('data-handle="f2"');
    });
});
