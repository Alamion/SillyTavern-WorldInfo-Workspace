import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../../src/core/preview';

describe('markdown renderer (production port)', () => {
    it('renders headings, quotes, lists and paragraphs', () => {
        const html = renderMarkdown('# Title\n\n> quoted\n\n- item one\n- item two\n\ntext');
        expect(html).toContain('<h3>Title</h3>');
        expect(html).toContain('<blockquote><p>quoted</p></blockquote>');
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

    describe('block structure (2026-09-22)', () => {
        it('renders ordered lists with their start number', () => {
            const html = renderMarkdown('3. third\n4. fourth');
            expect(html).toBe('<ol start="3"><li>third</li><li>fourth</li></ol>');
        });

        it('nests lists by indentation and switches list types', () => {
            const html = renderMarkdown('- a\n  1. a1\n  2. a2\n- b\n    - b1\n  continued');
            expect(html).toBe(
                '<ul><li>a<ol><li>a1</li><li>a2</li></ol></li><li>b<ul><li>b1 continued</li></ul></li></ul>'
            );
        });

        it('renders pipe tables with alignment', () => {
            const html = renderMarkdown('| Name | Age |\n|:-----|----:|\n| Ada | **36** |');
            expect(html).toContain('<thead><tr><th style="text-align: left">Name</th><th style="text-align: right">Age</th></tr></thead>');
            expect(html).toContain('<td style="text-align: right"><strong>36</strong></td>');
        });

        it('keeps a multi-line quote together and renders its inner blocks', () => {
            const html = renderMarkdown('> first\n> - item\n>\n> > nested');
            expect(html).toBe(
                '<blockquote><p>first</p>\n<ul><li>item</li></ul>\n<blockquote><p>nested</p></blockquote></blockquote>'
            );
        });

        it('renders strikethrough and rules', () => {
            expect(renderMarkdown('~~gone~~')).toBe('<p><del>gone</del></p>');
            expect(renderMarkdown('a\n\n---\n\nb')).toContain('<hr />');
        });
    });

    describe('link safety (2026-09-22)', () => {
        it.each([
            'javascript:alert(1)',
            'JavaScript:alert(1)',
            'data:text/html;base64,PHNjcmlwdD4=',
            'vbscript:msgbox',
        ])('does not link %s', (href) => {
            const html = renderMarkdown(`[click](${href})`);
            expect(html).not.toContain('<a');
            expect(html).toContain('click');
        });

        it.each(['https://e.example', 'http://e.example', 'mailto:a@e.example', '#top', 'notes/page.md'])(
            'links %s',
            (href) => {
                expect(renderMarkdown(`[x](${href})`)).toContain(`<a href="${href}"`);
            }
        );
    });

    describe('Markdown demo entry review (2026-09-22)', () => {
        it('drops the info string of a code fence', () => {
            expect(renderMarkdown('```python\nprint(1)\n```')).toBe('<pre><code class="language-python">print(1)</code></pre>');
            expect(renderMarkdown('```\nplain\n```')).toBe('<pre><code>plain</code></pre>');
        });

        it('hides HTML comments', () => {
            expect(renderMarkdown('text <!-- note -->\n<!--\nmulti\n-->\nafter')).toBe('<p>text </p>\n<p>after</p>');
        });

        it('links bare web and mail addresses without trailing punctuation', () => {
            const html = renderMarkdown('See https://a.example/x?a=1&b=2. Or mailto:u@e.example, not ftp://f.example');
            expect(html).toContain('<a href="https://a.example/x?a=1&amp;b=2" target="_blank" rel="noreferrer noopener">https://a.example/x?a=1&amp;b=2</a>.');
            expect(html).toContain('>mailto:u@e.example</a>,');
            expect(html).not.toContain('href="ftp');
        });

        it('keeps anchors in the page and markup inside link labels', () => {
            expect(renderMarkdown('[go](#top)')).toBe('<p><a href="#top">go</a></p>');
            expect(renderMarkdown('[**b**](https://e.example)')).toContain('><strong>b</strong></a>');
        });

        it('leaves code spans literal: no placeholders, no emphasis', () => {
            const html = renderMarkdown('`{{user}} *x*` {{user}}', {
                resolvePlaceholder: (text) => text.replace(/\{\{user\}\}/g, 'Ada'),
            });
            expect(html).toBe('<p><code>{{user}} *x*</code> Ada</p>');
        });
    });

    describe('edge cases (2026-09-22 review)', () => {
        const render = (source: string): string => renderMarkdown(source);

        it('reads Windows line endings', () => {
            expect(render('# T\r\n- a\r\n- b')).toBe('<h3>T</h3>\n<ul><li>a</li><li>b</li></ul>');
        });

        it('renders all heading forms', () => {
            expect(render('##### Five\n###### Six')).toBe('<h6>Five</h6>\n<h6>Six</h6>');
            expect(render('## Closed ##')).toBe('<h4>Closed</h4>');
            expect(render('Title\n===\nSub\n---')).toBe('<h3>Title</h3>\n<h4>Sub</h4>');
            expect(render('#tag')).toBe('<p>#tag</p>');
        });

        it('applies emphasis only with flanking markers', () => {
            expect(render('_em_ __strong__ snake_case_name ***both***')).toBe(
                '<p><em>em</em> <strong>strong</strong> snake_case_name <em><strong>both</strong></em></p>'
            );
            expect(render('**a *b* c** ==mark==')).toBe('<p><strong>a <em>b</em> c</strong> <mark>mark</mark></p>');
            expect(render('** not bold ** and *not em *')).toBe('<p>** not bold ** and *not em *</p>');
        });

        it('honours backslash escapes and written entities', () => {
            expect(render('\\*not em\\* a\\_b 2 \\< 3')).toBe('<p>*not em* a_b 2 &lt; 3</p>');
            expect(render('a&nbsp;b &copy; &#169; & c')).toBe('<p>a&nbsp;b &copy; &#169; &amp; c</p>');
        });

        it('renders code spans of any backtick length', () => {
            expect(render('``a ` b`` and ` x `')).toBe('<p><code>a ` b</code> and <code>x</code></p>');
        });

        it('renders ~~~ fences and keeps unclosed fences as code', () => {
            expect(render('~~~\n**x**\n~~~')).toBe('<pre><code>**x**</code></pre>');
            expect(render('a\n```\nno end')).toBe('<p>a</p>\n<pre><code>no end</code></pre>');
            expect(render('inline ```x``` code')).toBe('<p>inline <code>x</code> code</p>');
        });

        it('keeps loose lists together and renders task items', () => {
            expect(render('1. one\n\n2. two')).toBe('<ol><li>one</li><li>two</li></ol>');
            expect(render('- [ ] todo\n- [x] done')).toBe(
                '<ul><li class="wiw-md-task"><input type="checkbox" disabled /> todo</li><li class="wiw-md-task"><input type="checkbox" disabled checked /> done</li></ul>'
            );
        });

        it('handles table variants', () => {
            expect(render('a | b\n--- | ---\n1 | 2')).toContain('<td>1</td><td>2</td>');
            expect(render('| a | b |\n|---|---|\n| x \\| y | z |')).toContain('<td>x | y</td><td>z</td>');
            expect(render('this | is not a table')).toBe('<p>this | is not a table</p>');
        });

        it('continues a quote lazily and renders callouts', () => {
            expect(render('> quoted\ncontinued')).toBe('<blockquote><p>quoted</p>\n<p>continued</p></blockquote>');
            expect(render('> [!warning]\n> careful')).toBe(
                '<blockquote class="wiw-md-callout wiw-md-callout-warning"><p class="wiw-md-callout-title">Warning</p>\n<p>careful</p></blockquote>'
            );
        });

        it('links with titles, balanced parentheses and autolinks', () => {
            expect(render('[w](https://e.example/Foo_(bar) "T")')).toBe(
                '<p><a href="https://e.example/Foo_(bar)" title="T" target="_blank" rel="noreferrer noopener">w</a></p>'
            );
            expect(render('(see https://e.example/Foo_(bar)).')).toContain('>https://e.example/Foo_(bar)</a>).');
            expect(render('<https://e.example> <u@e.example>')).toBe(
                '<p><a href="https://e.example" target="_blank" rel="noreferrer noopener">https://e.example</a> <a href="mailto:u@e.example" target="_blank" rel="noreferrer noopener">u@e.example</a></p>'
            );
        });

        it('shows Obsidian wikilinks by alias or target', () => {
            expect(render('[[Note]] [[Note|Alias]]')).toBe(
                '<p><span class="wiw-md-wikilink" title="Note">Note</span> <span class="wiw-md-wikilink" title="Note">Alias</span></p>'
            );
        });

        it('never produces executable links, images or attributes', () => {
            expect(render('[x](&#106;avascript:alert(1))')).toContain('href="&amp;#106;avascript:alert(1)"');
            expect(render('[x](<javascript:alert(1)>)')).toBe('<p>x</p>');
            expect(render('<javascript:alert(1)>')).not.toContain('<a');
            expect(render('<img src=x onerror=alert(1)>')).toBe('<p>&lt;img src=x onerror=alert(1)&gt;</p>');
            expect(render('[x](https://e.example "t\\" onerror=\\"x")')).not.toMatch(/ onerror="/);
            const any = { resolveImage: (ref: string) => ref };
            expect(renderMarkdown('![x](javascript:alert(1))', any)).not.toContain('<img');
            expect(renderMarkdown('![x](data:text/html,x)', any)).not.toContain('<img');
            expect(renderMarkdown('![x](data:image/png;base64,AAA)', any)).toContain('<img src="data:image/png;base64,AAA"');
            expect(renderMarkdown('![x](https://e.example/Foo_(1).png)', any)).toContain('src="https://e.example/Foo_(1).png"');
        });
    });
});
