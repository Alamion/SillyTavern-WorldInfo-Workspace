import { describe, expect, it } from 'vitest';
import { pickDetailsHtml } from '../../src/core/picking/display';

describe('pickDetailsHtml (spec 007 FR-024)', () => {
    it('lists picks with reasons, insertion state, source and ignored names, escaped', () => {
        const html = pickDetailsHtml({
            source: 'fresh',
            picked: [
                { book: 'Book', name: 'Selene <b>', reason: 'named "here"', inserted: true },
                { book: 'Book', name: 'Harbor', reason: '', inserted: false },
            ],
            ignored: ['e9'],
            durationMs: 2300,
            profileName: 'free',
        });
        expect(html).toContain('Picked for this reply. 2.3 s · free');
        expect(html).toContain('Selene &#60;b&#62;');
        expect(html).toContain('named &#34;here&#34;');
        expect(html).toContain('in prompt');
        expect(html).toContain('not inserted');
        expect(html).toContain('Ignored (not in the active books): e9');
    });

    it('explains an empty pick and a fallback', () => {
        const html = pickDetailsHtml({ source: 'fallback', picked: [], ignored: [], durationMs: 0, failure: { message: 'Lore picking timed out.' }, profileName: '' });
        expect(html).toContain('did not finish');
        expect(html).toContain('Lore picking timed out.');
        expect(html).toContain('No entries were picked');
    });
});
