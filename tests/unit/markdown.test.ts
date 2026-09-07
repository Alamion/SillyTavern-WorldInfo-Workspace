import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../../src/core/sample/markdown';

const MAP_URI = 'data:image/svg+xml,%3Csvg%3E%3C/svg%3E';

describe('renderMarkdown', () => {
    it('escapes html to prevent injection', () => {
        const html = renderMarkdown('<script>alert(1)</script>');
        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;script&gt;');
    });

    it('renders headings with a two-level offset', () => {
        expect(renderMarkdown('# Title')).toContain('<h3>Title</h3>');
        expect(renderMarkdown('### Sub')).toContain('<h5>Sub</h5>');
    });

    it('renders bold, italic and inline code', () => {
        const html = renderMarkdown('a **big** *small* `tick` day');
        expect(html).toContain('<strong>big</strong>');
        expect(html).toContain('<em>small</em>');
        expect(html).toContain('<code>tick</code>');
    });

    it('renders lists and blockquotes', () => {
        const html = renderMarkdown('- one\n- two\n\n> quoted');
        expect(html).toContain('<ul>');
        expect(html).toContain('<li>one</li>');
        expect(html).toContain('<blockquote>quoted</blockquote>');
    });

    it('renders fenced code blocks verbatim', () => {
        const html = renderMarkdown('before\n```\n<b>raw</b>\n```\n');
        expect(html).toContain('<pre><code>');
        expect(html).toContain('&lt;b&gt;raw&lt;/b&gt;');
    });

    it('resolves image references through the resolver', () => {
        const html = renderMarkdown('![Map](img:map)', (ref) =>
            ref === 'img:map' ? MAP_URI : undefined
        );
        expect(html).toContain(`<img src="${MAP_URI}" alt="Map" />`);
    });

    it('marks unresolved image references instead of dropping them', () => {
        const html = renderMarkdown('![Map](img:nowhere)');
        expect(html).toContain('missing image: img:nowhere');
    });

    it('renders links with safe rel attributes', () => {
        const html = renderMarkdown('[docs](https://example.com)');
        expect(html).toContain('<a href="https://example.com"');
        expect(html).toContain('rel="noreferrer noopener"');
    });
});
