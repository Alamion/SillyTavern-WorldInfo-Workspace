/**
 * Live content preview (FR-010): the Phase 0 renderer promoted to production,
 * extended with a placeholder-resolution hook. Pure module — the adapter injects
 * app `substituteParams`; without it, placeholders stay as visible text.
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

function unescapeHtml(text: string): string {
    return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

function applyPlaceholder(text: string, options: PreviewOptions): string {
    if (!options.resolvePlaceholder) {
        return text;
    }
    return options.resolvePlaceholder(text);
}

function renderInline(text: string, options: PreviewOptions): string {
    let out = escapeHtml(applyPlaceholder(text, options));
    out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
    const embed = (alt: string, escapedRef: string): string => {
        const ref = unescapeHtml(escapedRef);
        const source = options.resolveImage?.(ref) ?? undefined;
        if (source) {
            return `<img src="${escapeHtml(source)}" alt="${alt}" />`;
        }
        return `<span class="wiw-md-missing-image">[missing image: ${escapedRef}]</span>`;
    };
    // Markdown images: `![alt](ref)`, `![alt](<ref with spaces>)`, refs may contain spaces.
    out = out.replace(/!\[([^\]]*)\]\((&lt;.+?&gt;|[^)]+)\)/g, (_match, alt: string, ref: string) =>
        embed(alt ?? '', ref.replace(/^&lt;(.*)&gt;$/, '$1'))
    );
    // Obsidian embeds: `![[name]]`, `![[name|alt]]`.
    out = out.replace(/!\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_match, ref: string, alt?: string) =>
        embed(alt ?? '', ref)
    );
    out = out.replace(
        /\[([^\]]+)\]\(([^)\s]+)\)/g,
        '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>'
    );
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    return out;
}

function renderBlock(block: string, options: PreviewOptions): string {
    const lines = block.split('\n');
    const html: string[] = [];
    let listOpen = false;
    const closeList = (): void => {
        if (listOpen) {
            html.push('</ul>');
            listOpen = false;
        }
    };
    for (const line of lines) {
        const heading = /^(#{1,4})\s+(.*)$/.exec(line);
        const quote = /^>\s?(.*)$/.exec(line);
        const list = /^-\s+(.*)$/.exec(line);
        if (heading) {
            closeList();
            const level = (heading[1] ?? '#').length;
            html.push(`<h${level + 2}>${renderInline(heading[2] ?? '', options)}</h${level + 2}>`);
        } else if (quote) {
            closeList();
            html.push(`<blockquote>${renderInline(quote[1] ?? '', options)}</blockquote>`);
        } else if (list) {
            if (!listOpen) {
                html.push('<ul>');
                listOpen = true;
            }
            html.push(`<li>${renderInline(list[1] ?? '', options)}</li>`);
        } else if (line.trim() === '') {
            closeList();
        } else {
            closeList();
            html.push(`<p>${renderInline(line, options)}</p>`);
        }
    }
    closeList();
    return html.join('\n');
}

export function renderMarkdown(source: string, options: PreviewOptions = {}): string {
    const fenced = source.split(/```/);
    const html: string[] = [];
    fenced.forEach((chunk, i) => {
        if (i % 2 === 1) {
            html.push(`<pre><code>${escapeHtml(chunk.replace(/^\n|\n$/g, ''))}</code></pre>`);
        } else if (chunk.length > 0) {
            html.push(renderBlock(chunk, options));
        }
    });
    return html.join('\n');
}