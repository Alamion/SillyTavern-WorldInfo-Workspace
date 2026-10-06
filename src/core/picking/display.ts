/**
 * What the reply icon's popup shows for one recorded pick (spec 007 FR-024).
 * Pure: escapes everything, so book and entry names cannot inject markup.
 */

export interface PickRecordView {
    source: 'prepared' | 'fresh' | 'fallback' | 'reused';
    picked: Array<{ book: string; name: string; reason: string; inserted: boolean | null }>;
    ignored: string[];
    durationMs: number;
    failure?: { message: string };
    profileName: string;
}

const SOURCES: Record<PickRecordView['source'], string> = {
    prepared: 'Prepared in the background after the previous reply (no wait).',
    fresh: 'Picked for this reply.',
    fallback: 'The fresh pick did not finish; the earlier pick (or keywords only) was used.',
    reused: 'Continued reply: the pick of the reply it continues.',
};

function escape(text: string): string {
    return text.replace(/[&<>"']/g, (char) => `&#${String(char.charCodeAt(0))};`);
}

export function pickDetailsHtml(record: PickRecordView): string {
    const rows = record.picked.map((entry) => {
        const state =
            entry.inserted === true
                ? '<span class="wiw-badge wiw-badge-ok">in prompt</span>'
                : entry.inserted === false
                  ? '<span class="wiw-badge wiw-badge-warn" title="Picked, but the World Info budget, probability or an inclusion group left it out">not inserted</span>'
                  : '';
        const reason = entry.reason !== '' ? `<div class="wiw-pick-reason">${escape(entry.reason)}</div>` : '';
        return `<li><b>${escape(entry.name)}</b> <span class="wiw-pick-book">${escape(entry.book)}</span> ${state}${reason}</li>`;
    });
    const parts = [
        '<div class="wiw-pick-details">',
        '<h3>Lore picked for this reply</h3>',
        `<p>${escape(SOURCES[record.source])}${record.durationMs > 0 ? ` ${String(Math.round(record.durationMs / 100) / 10)} s` : ''}${record.profileName !== '' ? ` · ${escape(record.profileName)}` : ''}</p>`,
    ];
    if (record.failure) {
        parts.push(`<p class="wiw-pick-failure">${escape(record.failure.message)}</p>`);
    }
    parts.push(
        rows.length > 0 ? `<ul>${rows.join('')}</ul>` : '<p>No entries were picked; keyword activation worked as usual.</p>'
    );
    if (record.ignored.length > 0) {
        parts.push(`<p class="wiw-pick-ignored">Ignored (not in the active books): ${record.ignored.map(escape).join(', ')}</p>`);
    }
    parts.push('</div>');
    return parts.join('');
}
