/**
 * Live content preview (FR-010): the Phase 0 renderer promoted to production,
 * extended with a placeholder-resolution hook. Pure module — the adapter injects
 * app `substituteParams`; without it, placeholders stay as visible text.
 *
 * Deliberately NOT delegated to the app's showdown (`SillyTavern.libs.showdown`,
 * reviewed 2026-09-22): the preview needs workspace image references (`img:`,
 * `![[…]]`), placeholders and the assistant's reference markers, and this module
 * stays pure and tested in Vitest.
 *
 * Coverage (edge-case review 2026-09-22): CommonMark/GFM blocks — ATX and setext
 * headings, rules, fenced code (``` and ~~~, info string), quotes with lazy
 * continuation, tight/loose/nested/task lists, pipe tables — and inline code spans,
 * backslash escapes, entities, emphasis with flanking rules, links with titles and
 * balanced parentheses, autolinks and bare URLs; Obsidian wikilinks, embeds,
 * `==highlights==` and callouts. Raw HTML is always escaped; links only for
 * http(s), mailto, anchors and relative paths.
 */

export interface PreviewOptions {
    /** Resolve a workspace image reference to a concrete source URL. */
    resolveImage?: (ref: string) => string | undefined;
    /** Resolve app-wide placeholders ({{user}}, {{char}}, …) to real values. */
    resolvePlaceholder?: (text: string) => string;
}

export type ImageResolver = (ref: string) => string | undefined;

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** Like `escapeHtml`, but written entities (`&nbsp;`, `&#169;`) stay entities. */
function escapeText(text: string): string {
    return text
        .replace(/&(?!#\d{1,7};|#[xX][0-9a-fA-F]{1,6};|[A-Za-z][A-Za-z0-9]{1,31};)/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function unescapeHtml(text: string): string {
    return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

function applyPlaceholder(text: string, options: PreviewOptions): string {
    if (!options.resolvePlaceholder) {
        return text;
    }
    return options.resolvePlaceholder(text);
}

/**
 * Link targets the preview turns into links: web and mail links, in-page anchors
 * and relative paths. Any other scheme (`javascript:`, `data:`, `vbscript:`, …)
 * stays plain text — preview content comes from imports and AI replies too.
 */
function safeHref(href: string): boolean {
    // Browsers ignore control characters and whitespace inside a scheme.
    const compact = [...href].filter((char) => char.charCodeAt(0) > 0x20 && char.charCodeAt(0) !== 0x7f).join('');
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(compact);
    return scheme === null || ['http', 'https', 'mailto'].includes((scheme[1] ?? '').toLowerCase());
}

/** Image sources the preview loads: web, app-relative, blob and `data:image/…`. */
function safeImageSource(source: string): boolean {
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(source.trim());
    if (scheme === null) {
        return true;
    }
    const name = (scheme[1] ?? '').toLowerCase();
    return name === 'http' || name === 'https' || name === 'blob' || /^data:image\//i.test(source.trim());
}

// ---------------------------------------------------------------------------
// Inline
// ---------------------------------------------------------------------------

const STASH_OPEN = '\uE010';
const STASH_CLOSE = '\uE011';
const WORD = '[\\p{L}\\p{N}_]';

/**
 * Emphasis needs non-space content next to its markers (`** x **` is text), and a
 * marker never borrows a character from a longer run (`**` is not two `*`).
 */
function emphasis(html: string): string {
    const span = (marker: string, char: string, tag: string, wordBound = false): [RegExp, string] => {
        const before = wordBound ? `(?<!${WORD}|${char})` : `(?<!${char})`;
        const after = wordBound ? `(?!${WORD}|${char})` : `(?!${char})`;
        return [new RegExp(`${before}${marker}(?=[^\\s${char}])(.+?)(?<=[^\\s${char}])${marker}${after}`, 'gu'), tag];
    };
    const rules: Array<[RegExp, string]> = [
        span('\\*\\*\\*', '\\*', 'em><strong'),
        span('\\*\\*', '\\*', 'strong'),
        span('__', '_', 'strong', true),
        span('\\*', '\\*', 'em'),
        span('_', '_', 'em', true),
        span('~~', '~', 'del'),
        span('==', '=', 'mark'),
    ];
    let out = html;
    for (const [pattern, tag] of rules) {
        const closing = tag
            .split('><')
            .reverse()
            .map((name) => `</${name}>`)
            .join('');
        out = out.replace(pattern, (_match, inner: string) => `<${tag}>${inner}${closing}`);
    }
    return out;
}

/** An anchor with a fully escaped href: entities in a target are never decoded. */
function anchor(href: string, label: string, title?: string): string {
    const escaped = escapeHtml(href);
    const titleAttribute = title !== undefined && title !== '' ? ` title="${escapeHtml(title)}"` : '';
    // In-page anchors stay in the page; everything else opens a new tab.
    return href.startsWith('#')
        ? `<a href="${escaped}"${titleAttribute}>${label}</a>`
        : `<a href="${escaped}"${titleAttribute} target="_blank" rel="noreferrer noopener">${label}</a>`;
}

/** Characters a backslash makes literal (CommonMark ASCII punctuation). */
const ESCAPABLE = /\\([!-/:-@[-`{-~])/g;
/** A link destination: no spaces, parentheses only balanced (`Foo_(bar)`). */
const DESTINATION = '(?:[^()\\s]|\\([^()\\s]*\\))+';
const TITLE = '(?:\\s+&quot;(.*?)&quot;)?';
const LINK = new RegExp(`\\[([^\\]]+)\\]\\((&lt;.*?&gt;|${DESTINATION})${TITLE}\\)`, 'g');
/** Image references may contain spaces (`![a](Aldermeer map sketch)`) and balanced parentheses. */
const IMAGE = new RegExp(`!\\[([^\\]]*)\\]\\((&lt;.+?&gt;|(?:[^()]|\\([^()]*\\))+?)${TITLE}\\)`, 'g');
const BARE_URL = /\b(?:https?:\/\/|mailto:)(?:(?!&quot;|&lt;|&gt;)[^\s<\uE010\uE011])+/g;

/** Trailing punctuation is not part of a bare URL; a `)` only when unbalanced. */
function trimUrl(url: string): string {
    let end = url.length;
    for (;;) {
        const last = url[end - 1] ?? '';
        const body = url.slice(0, end);
        if (/[.,;:!?'"\]*_~]/.test(last)) {
            end -= 1;
        } else if (last === ')' && (body.match(/\)/g)?.length ?? 0) > (body.match(/\(/g)?.length ?? 0)) {
            end -= 1;
        } else {
            return url.slice(0, end);
        }
    }
}

/** Inline markup of text outside code spans. */
function renderText(text: string, options: PreviewOptions): string {
    // Finished HTML (escapes, images, links) is parked behind markers so later
    // rules — bare-URL links, emphasis — never touch it.
    const stash: string[] = [];
    const keep = (html: string): string => `${STASH_OPEN}${String(stash.push(html) - 1)}${STASH_CLOSE}`;
    let out = applyPlaceholder(text, options).replace(ESCAPABLE, (_match, char: string) => keep(escapeHtml(char)));
    out = escapeText(out);

    const embed = (alt: string, escapedRef: string): string => {
        const ref = unescapeHtml(escapedRef).trim();
        const source = options.resolveImage?.(ref) ?? undefined;
        if (source !== undefined && safeImageSource(source)) {
            return keep(`<img src="${escapeHtml(source)}" alt="${alt}" />`);
        }
        return keep(`<span class="wiw-md-missing-image">[missing image: ${escapeHtml(ref)}]</span>`);
    };
    // Markdown images: `![alt](ref)`, `![alt](<ref with spaces>)`, `![alt](ref "title")`.
    out = out.replace(IMAGE, (_match, alt: string, ref: string) => embed(alt, ref.replace(/^&lt;(.*)&gt;$/, '$1')));
    // Obsidian embeds: `![[name]]`, `![[name|alt]]`.
    out = out.replace(/!\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_match, ref: string, alt?: string) =>
        embed(alt ?? '', ref)
    );
    out = out.replace(LINK, (match: string, label: string, destination: string, title?: string) => {
        const href = unescapeHtml(destination.replace(/^&lt;(.*)&gt;$/, '$1'));
        return safeHref(href) ? keep(anchor(href, emphasis(label), title !== undefined ? unescapeHtml(title) : undefined)) : label;
    });
    // Autolinks: `<https://…>`, `<user@example.com>`.
    out = out.replace(/&lt;((?:https?:\/\/|mailto:)[^\s<>]*?)&gt;/g, (_match, url: string) =>
        keep(anchor(unescapeHtml(url), url))
    );
    out = out.replace(/&lt;([\w.+-]+@[\w-]+(?:\.[\w-]+)+)&gt;/g, (_match, mail: string) =>
        keep(anchor(`mailto:${mail}`, mail))
    );
    out = out.replace(BARE_URL, (match: string) => {
        const url = trimUrl(match);
        return `${keep(anchor(unescapeHtml(url), url))}${match.slice(url.length)}`;
    });
    // Obsidian wikilinks: the alias, or the target as written.
    out = out.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target: string, alias?: string) =>
        keep(`<span class="wiw-md-wikilink" title="${target}">${alias ?? target}</span>`)
    );
    out = emphasis(out);
    const restore = new RegExp(`${STASH_OPEN}(\\d+)${STASH_CLOSE}`, 'g');
    // Stashed HTML may itself contain markers (a link label with an escape).
    while (out.includes(STASH_OPEN)) {
        out = out.replace(restore, (_match, index: string) => stash[Number(index)] ?? '');
    }
    return out;
}

/**
 * Code spans are literal — no placeholders, no markup. A span opens with a run
 * of backticks and closes with a run of the same length (``a ` b``).
 */
function renderInline(text: string, options: PreviewOptions): string {
    let html = '';
    let plain = '';
    let index = 0;
    while (index < text.length) {
        const run = /^`+/.exec(text.slice(index));
        if (!run) {
            plain += text[index] ?? '';
            index += 1;
            continue;
        }
        const ticks = run[0];
        const close = new RegExp(`(?<!\`)${ticks}(?!\`)`).exec(text.slice(index + ticks.length));
        if (!close) {
            plain += ticks;
            index += ticks.length;
            continue;
        }
        let code = text.slice(index + ticks.length, index + ticks.length + close.index).replace(/\n/g, ' ');
        if (/^ .*[^ ].* $/.test(code)) {
            code = code.slice(1, -1);
        }
        html += `${renderText(plain, options)}<code>${escapeHtml(code)}</code>`;
        plain = '';
        index += ticks.length + close.index + ticks.length;
    }
    return html + renderText(plain, options);
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

const ATX_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const LIST_ITEM = /^(\s*)([-*+]|(\d{1,9})[.)])(?:[ \t]+(.*))?$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const RULE = /^ {0,3}([-*_])([ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}>/;
const TASK = /^\[([ xX])\][ \t]+(.*)$/;

/** Headings start at h3 inside the editor and assistant (# → h3 … ≥ #### → h6). */
function headingTag(level: number): string {
    return `h${String(Math.min(level + 2, 6))}`;
}

interface ListItem {
    indent: number;
    ordered: boolean;
    start: number;
    text: string;
}

/** Tab = 4 columns, as in CommonMark. */
function indentOf(whitespace: string): number {
    return whitespace.replace(/\t/g, '    ').length;
}

function renderListItem(text: string, options: PreviewOptions): string {
    const task = TASK.exec(text);
    if (!task) {
        return `<li>${renderInline(text, options)}`;
    }
    const checked = task[1] !== ' ' ? ' checked' : '';
    return `<li class="wiw-md-task"><input type="checkbox" disabled${checked} /> ${renderInline(task[2] ?? '', options)}`;
}

/** Nested ordered/unordered lists from indentation. */
function renderList(items: readonly ListItem[], options: PreviewOptions): string {
    const html: string[] = [];
    const stack: Array<{ indent: number; tag: 'ul' | 'ol' }> = [];
    for (const item of items) {
        const tag = item.ordered ? 'ol' : 'ul';
        let top = stack.at(-1);
        while (top && item.indent < top.indent) {
            html.push(`</li></${top.tag}>`);
            stack.pop();
            top = stack.at(-1);
        }
        if (top && item.indent === top.indent && top.tag !== tag) {
            html.push(`</li></${top.tag}>`);
            stack.pop();
            top = stack.at(-1);
        }
        if (!top || item.indent > top.indent) {
            html.push(item.ordered && item.start !== 1 ? `<ol start="${String(item.start)}">` : `<${tag}>`);
            stack.push({ indent: item.indent, tag });
        } else {
            html.push('</li>');
        }
        html.push(renderListItem(item.text, options));
    }
    for (const level of stack.reverse()) {
        html.push(`</li></${level.tag}>`);
    }
    return html.join('');
}

/** Cells of a table row; `\|` is a literal pipe. */
function splitRow(line: string): string[] {
    return line
        .trim()
        .replace(/^\|/, '')
        .replace(/(?<!\\)\|$/, '')
        .split(/(?<!\\)\|/)
        .map((cell) => cell.trim().replace(/\\\|/g, '|'));
}

function renderTable(lines: readonly string[], options: PreviewOptions): string {
    const [head = '', separator = '', ...body] = lines;
    const aligns = splitRow(separator).map((cell) =>
        cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : cell.startsWith(':') ? 'left' : ''
    );
    const cells = (line: string, tag: 'th' | 'td'): string =>
        splitRow(line)
            .map((cell, index) => {
                const align = aligns[index] ?? '';
                return `<${tag}${align !== '' ? ` style="text-align: ${align}"` : ''}>${renderInline(cell, options)}</${tag}>`;
            })
            .join('');
    return [
        '<table>',
        `<thead><tr>${cells(head, 'th')}</tr></thead>`,
        body.length > 0 ? `<tbody>${body.map((line) => `<tr>${cells(line, 'td')}</tr>`).join('')}</tbody>` : '',
        '</table>',
    ].join('');
}

function isTableStart(line: string, next: string | undefined): boolean {
    return line.includes('|') && TABLE_SEPARATOR.test(next ?? '');
}

/** Whether a line opens a block other than a paragraph (ends a lazy quote line). */
function startsBlock(line: string, next: string | undefined): boolean {
    return (
        ATX_HEADING.test(line) ||
        RULE.test(line) ||
        QUOTE.test(line) ||
        LIST_ITEM.test(line) ||
        isTableStart(line, next)
    );
}

/** Obsidian callout: `> [!note] Title` → a titled, typed quote. */
function renderQuote(quoted: string[], options: PreviewOptions): string {
    const callout = /^\[!([\w-]+)\][+-]?[ \t]*(.*)$/.exec(quoted[0] ?? '');
    if (!callout) {
        return `<blockquote>${renderBlock(quoted.join('\n'), options)}</blockquote>`;
    }
    const type = (callout[1] ?? 'note').toLowerCase();
    const title = callout[2] !== undefined && callout[2] !== '' ? callout[2] : type.charAt(0).toUpperCase() + type.slice(1);
    const body = renderBlock(quoted.slice(1).join('\n'), options);
    return `<blockquote class="wiw-md-callout wiw-md-callout-${escapeHtml(type)}"><p class="wiw-md-callout-title">${renderInline(title, options)}</p>${body !== '' ? `\n${body}` : ''}</blockquote>`;
}

/**
 * Block structure of text without fences. Every line of a paragraph stays its
 * own `<p>`, as before (lore text uses single newlines).
 */
function renderBlock(block: string, options: PreviewOptions): string {
    const lines = block.split('\n');
    const html: string[] = [];
    let index = 0;
    while (index < lines.length) {
        const line = lines[index] ?? '';
        const next = lines[index + 1];
        const heading = ATX_HEADING.exec(line);
        if (line.trim() === '') {
            index += 1;
        } else if (heading) {
            const tag = headingTag((heading[1] ?? '#').length);
            html.push(`<${tag}>${renderInline(heading[2] ?? '', options)}</${tag}>`);
            index += 1;
        } else if (RULE.test(line)) {
            html.push('<hr />');
            index += 1;
        } else if (QUOTE.test(line)) {
            const quoted: string[] = [];
            while (index < lines.length) {
                const current = lines[index] ?? '';
                if (QUOTE.test(current)) {
                    quoted.push(current.replace(/^ {0,3}>[ \t]?/, ''));
                } else if (
                    // Lazy continuation: a plain line right after quoted text.
                    current.trim() !== '' &&
                    (quoted.at(-1) ?? '').trim() !== '' &&
                    !startsBlock(current, lines[index + 1])
                ) {
                    quoted.push(current);
                } else {
                    break;
                }
                index += 1;
            }
            html.push(renderQuote(quoted, options));
        } else if (isTableStart(line, next)) {
            const rows: string[] = [];
            while (index < lines.length && (lines[index] ?? '').includes('|')) {
                rows.push(lines[index] ?? '');
                index += 1;
            }
            html.push(renderTable(rows, options));
        } else if (LIST_ITEM.test(line)) {
            const items: ListItem[] = [];
            while (index < lines.length) {
                const current = lines[index] ?? '';
                const match = LIST_ITEM.exec(current);
                const previous = items.at(-1);
                if (match && !RULE.test(current)) {
                    items.push({
                        indent: indentOf(match[1] ?? ''),
                        ordered: match[3] !== undefined,
                        start: match[3] !== undefined ? Number(match[3]) : 1,
                        text: match[4] ?? '',
                    });
                } else if (previous && /^\s+\S/.test(current)) {
                    // An indented continuation line belongs to the item above.
                    previous.text += ` ${current.trim()}`;
                } else if (current.trim() === '') {
                    // A loose list: blank lines between items keep one list.
                    let ahead = index + 1;
                    while (ahead < lines.length && (lines[ahead] ?? '').trim() === '') {
                        ahead += 1;
                    }
                    const following = lines[ahead] ?? '';
                    if (!LIST_ITEM.test(following) || RULE.test(following)) {
                        break;
                    }
                    index = ahead;
                    continue;
                } else {
                    break;
                }
                index += 1;
            }
            html.push(renderList(items, options));
        } else if (next !== undefined && SETEXT.test(next) && next.trim() !== '') {
            // `Title` over `===` / `---`.
            const tag = headingTag(next.trim().startsWith('=') ? 1 : 2);
            html.push(`<${tag}>${renderInline(line.trim(), options)}</${tag}>`);
            index += 2;
        } else {
            html.push(`<p>${renderInline(line, options)}</p>`);
            index += 1;
        }
    }
    return html.join('\n');
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\s`]*)[^`]*$/;

export function renderMarkdown(source: string, options: PreviewOptions = {}): string {
    const lines = source.replace(/\r\n?/g, '\n').split('\n');
    const html: string[] = [];
    let text: string[] = [];
    const flushText = (): void => {
        // HTML comments are notes for the author, hidden as in any markdown viewer.
        const visible = text.join('\n').replace(/<!--[\s\S]*?-->/g, '');
        if (visible.trim() !== '') {
            html.push(renderBlock(visible, options));
        }
        text = [];
    };
    let index = 0;
    while (index < lines.length) {
        const line = lines[index] ?? '';
        const open = FENCE_OPEN.exec(line);
        if (!open) {
            text.push(line);
            index += 1;
            continue;
        }
        flushText();
        const marker = open[1] ?? '```';
        const close = new RegExp(`^ {0,3}${marker.charAt(0) === '`' ? '`' : '~'}{${String(marker.length)},}[ \\t]*$`);
        const code: string[] = [];
        index += 1;
        // An unclosed fence runs to the end, as in CommonMark.
        while (index < lines.length && !close.test(lines[index] ?? '')) {
            code.push(lines[index] ?? '');
            index += 1;
        }
        index += 1;
        const language = open[2] ?? '';
        html.push(
            `<pre><code${language !== '' ? ` class="language-${escapeHtml(language)}"` : ''}>${escapeHtml(code.join('\n'))}</code></pre>`
        );
    }
    flushText();
    return html.join('\n');
}
