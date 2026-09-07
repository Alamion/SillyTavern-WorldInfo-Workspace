export type ImageResolver = (ref: string) => string | undefined;

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function renderInline(text: string, resolveImage?: ImageResolver): string {
    let out = escapeHtml(text);
    out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
    out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_match, alt: string, ref: string) => {
        const decoded = (alt ?? '').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
        const source = resolveImage?.(decoded.length > 0 ? ref : ref) ?? undefined;
        if (source) {
            return `<img src="${escapeHtml(source)}" alt="${decoded}" />`;
        }
        return `<span class="wiw-md-missing-image">[missing image: ${escapeHtml(ref)}]</span>`;
    });
    out = out.replace(
        /\[([^\]]+)\]\(([^)\s]+)\)/g,
        '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>'
    );
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    return out;
}

function renderBlock(block: string, resolveImage?: ImageResolver): string {
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
            html.push(`<h${level + 2}>${renderInline(heading[2] ?? '', resolveImage)}</h${level + 2}>`);
        } else if (quote) {
            closeList();
            html.push(`<blockquote>${renderInline(quote[1] ?? '', resolveImage)}</blockquote>`);
        } else if (list) {
            if (!listOpen) {
                html.push('<ul>');
                listOpen = true;
            }
            html.push(`<li>${renderInline(list[1] ?? '', resolveImage)}</li>`);
        } else if (line.trim() === '') {
            closeList();
        } else {
            closeList();
            html.push(`<p>${renderInline(line, resolveImage)}</p>`);
        }
    }
    closeList();
    return html.join('\n');
}

export function renderMarkdown(source: string, resolveImage?: ImageResolver): string {
    const fenced = source.split(/```/);
    const html: string[] = [];
    fenced.forEach((chunk, i) => {
        if (i % 2 === 1) {
            html.push(`<pre><code>${escapeHtml(chunk.replace(/^\n|\n$/g, ''))}</code></pre>`);
        } else if (chunk.length > 0) {
            html.push(renderBlock(chunk, resolveImage));
        }
    });
    return html.join('\n');
}
