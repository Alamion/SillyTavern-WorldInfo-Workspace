import type { ContextItem, ContextSnapshot } from '../../core/assistant/types';
import { MenuPanel } from '../formControls';

/**
 * What goes (or went) into one assistant request, and why (spec 007 US1,
 * FR-001–FR-003): every item with its reason and estimated cost, grouped by
 * whether it was sent in full, shortened, or left out.
 */

const KIND_ICONS: Record<ContextItem['kind'], string> = {
    request: 'fa-comment-dots',
    entry: 'fa-file-lines',
    outline: 'fa-sitemap',
    catalog: 'fa-list',
    chat: 'fa-comments',
    card: 'fa-id-card',
    persona: 'fa-user',
    activated: 'fa-bolt',
    source: 'fa-plug',
    history: 'fa-clock-rotate-left',
};

const REASON_LABELS: Record<ContextItem['reason'], string> = {
    selected: 'selected',
    scope: 'in structure',
    key: 'key match',
    recursion: 'recursion',
    fuzzy: 'fuzzy match',
    'catalog-read': 'read from catalog',
    'context-set': 'context set',
    interop: 'other extension',
    option: 'option',
};

const OMIT_LABELS: Record<NonNullable<ContextItem['omitReason']>, string> = {
    budget: 'over budget',
    scope: 'outside the structure',
    unavailable: 'unavailable',
};

function Row({ item }: { item: ContextItem }): JSX.Element {
    const share =
        item.state === 'truncated' && item.keptShare !== undefined ? ` · ${String(Math.round(item.keptShare * 100))} % kept` : '';
    return (
        <li className={`wiw-context-item wiw-context-item-${item.state}`}>
            <i className={`fa-solid ${KIND_ICONS[item.kind]}`} />
            <span className="wiw-context-item-label" title={item.label}>
                {item.label}
            </span>
            <span className="wiw-chip" title={item.detail}>
                {REASON_LABELS[item.reason]}
                {item.detail !== undefined && <span className="wiw-context-item-detail"> · {item.detail}</span>}
            </span>
            <span className="wiw-context-item-cost">
                {item.state === 'omitted' && item.omitReason !== undefined
                    ? OMIT_LABELS[item.omitReason]
                    : `≈${String(item.tokens)}${share}`}
            </span>
        </li>
    );
}

function Group({ title, items }: { title: string; items: ContextItem[] }): JSX.Element | null {
    if (items.length === 0) {
        return null;
    }
    return (
        <section className="wiw-section">
            <h4>
                {title} ({String(items.length)})
            </h4>
            <ul className="wiw-context-items">
                {items.map((item, index) => (
                    <Row key={`${item.kind}-${item.nodeId ?? item.label}-${String(index)}`} item={item} />
                ))}
            </ul>
        </section>
    );
}

export function ContextPreview({
    snapshot,
    budgetTokens,
    title,
    subtitle,
    onClose,
}: {
    snapshot: ContextSnapshot;
    budgetTokens: number;
    title: string;
    subtitle: string;
    onClose: () => void;
}): JSX.Element {
    const items = snapshot.items;
    return (
        <MenuPanel
            title={title}
            intro={subtitle}
            className="wiw-context-preview"
            footerHint={`≈${String(snapshot.estimatedTokens)} of ${String(budgetTokens)} tokens (estimated, ~3.5 characters per token)`}
            footerActions={
                <button type="button" className="wiw-button wiw-button-active" onClick={onClose}>
                    Close
                </button>
            }
            onClose={onClose}
        >
            {items === undefined ? (
                <p className="wiw-hint">
                    This request was sent before item details were recorded: {String(snapshot.included.fullItems)}{' '}
                    entries in full, {snapshot.included.outline ? 'with' : 'without'} the structure, ≈
                    {String(snapshot.estimatedTokens)} tokens.
                </p>
            ) : (
                <>
                    <Group title="Included" items={items.filter((item) => item.state === 'included')} />
                    <Group title="Shortened" items={items.filter((item) => item.state === 'truncated')} />
                    <Group title="Left out" items={items.filter((item) => item.state === 'omitted')} />
                </>
            )}
        </MenuPanel>
    );
}
