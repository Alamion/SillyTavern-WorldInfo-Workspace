import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../../src/core/preview';

describe('markdown renderer (production port)', () => {
    it('renders headings, quotes, lists and paragraphs', () => {
        const html = renderMarkdown('# Title\n\n> quoted\n\n- item one\n- item two\n\ntext');
        expect(html).toContain('<h3>Title</h3>');
        expect(html).toContain('<blockquote>quoted</blockquote>');
        expect(html).toContain('<li>item one</li>');
        expect(html).toContain('<li>item two</li>');
        expect(html).toContain('<p>text</p>');
    });

    it('renders inline code, emphasis, strong and links', () => {
        const html = renderMarkdown('a `code` **bold** *em* [x](https://e.example)');
        expect(html).toContain('<code>code</code>');
        expect(html).toContain('<strong>bold</strong>');
        expect(html).toContain('<em>em</em>');
        expect(html).toContain('<a href="https://e.example"');
    });

    it('escapes HTML by default', () => {
        expect(renderMarkdown('<script>alert(1)</script>')).not.toContain('<script>');
        expect(renderMarkdown('<script>alert(1)</script>')).toContain('&lt;script&gt;');
    });

    it('renders embedded images and marks missing references', () => {
        const html = renderMarkdown('![Map](img:map-1)', {
            resolveImage: (ref) => (ref === 'img:map-1' ? 'https://x/map.png' : undefined),
        });
        expect(html).toContain('<img src="https://x/map.png"');

        const missing = renderMarkdown('![Map](img:gone)');
        expect(missing).toContain('wiw-md-missing-image');
    });

    it('leaves fenced code blocks unformatted', () => {
        const html = renderMarkdown('```\n**not bold**\n```');
        expect(html).toContain('<pre><code>');
        expect(html).toContain('**not bold**');
    });

    it('resolves app placeholders through the injected hook before escaping', () => {
        const html = renderMarkdown('Hello {{user}} and {{char}}!', {
            resolvePlaceholder: (text) => text.replace('{{user}}', 'Alice').replace('{{char}}', 'Bob'),
        });
        expect(html).toContain('Hello Alice and Bob!');
    });

    it('keeps placeholders as text when no hook is provided', () => {
        const html = renderMarkdown('Hello {{user}}');
        expect(html).toContain('{{user}}');
    });
});