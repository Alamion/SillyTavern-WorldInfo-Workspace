import { useMemo, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import type { SampleEntryNode } from '../../core/sample/dataset';
import type { SampleFieldMeta, SampleFieldName } from '../../core/sample/fieldGroups';
import {
    ADVANCED_LAYOUT,
    FIELD_SCHEMA,
} from '../../core/sample/fieldGroups';
import { renderMarkdown, type ImageResolver } from '../../core/sample/markdown';

type Values = Record<string, unknown>;
type Strategy = 'constant' | 'normal' | 'vectorized';

const FIELD_MAP = new Map<string, SampleFieldMeta>(
    FIELD_SCHEMA.map((meta) => [meta.name, meta])
);

function fieldMeta(name: SampleFieldName): SampleFieldMeta {
    const meta = FIELD_MAP.get(name);
    if (!meta) {
        throw new Error(`unmapped field: ${String(name)}`);
    }
    return meta;
}

function initialValues(card: SampleEntryNode): Values {
    const values: Values = {};
    for (const [key, value] of Object.entries(card.fields)) {
        values[key] = Array.isArray(value) ? [...value] : value;
    }
    return values;
}

function InfoIcon({ info, docs }: { info: string; docs?: string }): JSX.Element {
    return (
        <span className="wiw-field-icons">
            <i
                className="fa-solid fa-circle-info"
                title={info}
                aria-label={info}
            />
            {docs && (
                <a
                    className="wiw-field-docs"
                    href={docs}
                    target="_blank"
                    rel="noreferrer noopener"
                    title="Open the World Info documentation"
                >
                    <i className="fa-solid fa-circle-question" />
                </a>
            )}
        </span>
    );
}

function StringListControl({
    value,
    onChange,
}: {
    value: unknown;
    onChange: (next: string[]) => void;
}): JSX.Element {
    const [draft, setDraft] = useState('');
    const list = Array.isArray(value) ? value.map((item) => String(item)) : [];
    const add = (): void => {
        const trimmed = draft.trim();
        if (trimmed === '') {
            return;
        }
        onChange([...list, trimmed]);
        setDraft('');
    };
    return (
        <div className="wiw-chips">
            {list.map((item, idx) => (
                <span key={`${item}-${idx}`} className="wiw-chip">
                    {item}
                    <button
                        type="button"
                        className="wiw-chip-remove"
                        title="Remove"
                        onClick={() => onChange(list.filter((_, i) => i !== idx))}
                    >
                        <i className="fa-solid fa-circle-xmark" />
                    </button>
                </span>
            ))}
            <input
                className="wiw-chip-input"
                value={draft}
                placeholder="add..."
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                        add();
                    }
                }}
            />
            <button type="button" className="wiw-chip-add" title="Add" onClick={add}>
                <i className="fa-solid fa-plus" />
            </button>
        </div>
    );
}

function ToggleChip({
    label,
    checked,
    info,
    onToggle,
}: {
    label: string;
    checked: boolean;
    info: string;
    onToggle: () => void;
}): JSX.Element {
    return (
        <button
            type="button"
            className={`wiw-toggle-chip${checked ? ' wiw-toggle-on' : ''}`}
            title={info}
            onClick={onToggle}
        >
            <i className={`fa-solid ${checked ? 'fa-circle-check' : 'fa-circle'}`} />
            <span>{label}</span>
        </button>
    );
}

function StrategyControl({
    value,
    onChange,
}: {
    value: Strategy;
    onChange: (next: Strategy) => void;
}): JSX.Element {
    const options: ReadonlyArray<{ id: Strategy; icon: string; label: string; info: string }> = [
        { id: 'constant', icon: 'fa-circle', label: '🔵', info: 'Constant: inserts on every generation without keys' },
        { id: 'normal', icon: 'fa-circle-dot', label: '🟢', info: 'Normal: triggered by keys' },
        { id: 'vectorized', icon: 'fa-link', label: '🔗', info: 'Vectorized: can be inserted by embedding similarity' },
    ];
    return (
        <div className="wiw-strategy">
            {options.map((option) => (
                <button
                    key={option.id}
                    type="button"
                    className={`wiw-strategy-option${value === option.id ? ' wiw-strategy-active' : ''}`}
                    title={option.info}
                    onClick={() => onChange(option.id)}
                >
                    <i className={`fa-solid ${option.icon}`} />
                </button>
            ))}
        </div>
    );
}

export function FieldControl({
    meta,
    span,
    value,
    onChange,
}: {
    meta: SampleFieldMeta;
    span: number;
    value: unknown;
    onChange: (next: unknown) => void;
}): JSX.Element {
    const wide =
        span >= 6 ||
        meta.type === 'stringList' ||
        meta.type === 'json' ||
        meta.type === 'longText' ||
        meta.name === 'comment';
    const style = { gridColumn: `span ${span}` } as CSSProperties;
    let control: JSX.Element;
    switch (meta.type) {
        case 'boolean':
            control = (
                <ToggleChip
                    label={meta.label}
                    checked={Boolean(value)}
                    info={meta.info}
                    onToggle={() => onChange(!value)}
                />
            );
            break;
        case 'nullableBoolean':
            control = (
                <select
                    value={value === null || value === undefined ? '' : String(value)}
                    onChange={(event) =>
                        onChange(event.target.value === '' ? null : event.target.value === 'true')
                    }
                >
                    <option value="">Use global</option>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                </select>
            );
            break;
        case 'number':
            control = (
                <input
                    type="number"
                    value={String(value ?? '')}
                    onChange={(event) =>
                        onChange(event.target.value === '' ? 0 : Number(event.target.value))
                    }
                />
            );
            break;
        case 'nullableNumber':
            control = (
                <input
                    type="text"
                    placeholder="Use global"
                    value={value === null || value === undefined ? '' : String(value)}
                    onChange={(event) =>
                        onChange(event.target.value === '' ? null : Number(event.target.value))
                    }
                />
            );
            break;
        case 'enum':
            control = (
                <select
                    value={String(Number(value))}
                    onChange={(event) => onChange(Number(event.target.value))}
                >
                    {(meta.options ?? []).map((option) => (
                        <option key={option.value} value={option.value}>
                            {option.label}
                        </option>
                    ))}
                </select>
            );
            break;
        case 'stringList':
            control = <StringListControl value={value} onChange={onChange} />;
            break;
        case 'json':
            control = (
                <input
                    type="text"
                    readOnly
                    value={JSON.stringify(value ?? {})}
                    title="Passthrough object (read-only in the prototype)"
                />
            );
            break;
        default:
            control = (
                <input
                    type="text"
                    value={String(value ?? '')}
                    onChange={(event) => onChange(event.target.value)}
                />
            );
    }
    if (meta.type === 'boolean') {
        return (
            <div className="wiw-field wiw-field-chip" style={style}>
                <InfoIcon info={meta.info} docs={meta.docs} />
                {control}
            </div>
        );
    }
    return (
        <div className={`wiw-field${wide ? ' wiw-field-wide' : ''}`} style={style}>
            <span className="wiw-field-label">
                <InfoIcon info={meta.info} docs={meta.docs} />
                {meta.label}
            </span>
            {control}
        </div>
    );
}

function ContentSection({
    content,
    onContentChange,
    resolveImage,
}: {
    content: string;
    onContentChange: (next: string) => void;
    resolveImage?: ImageResolver;
}): JSX.Element {
    const isMobile = window.matchMedia('(max-width: 900px)').matches;
    const [previewVisible, setPreviewVisible] = useState(!isMobile);
    const [previewWidth, setPreviewWidth] = useState(40);
    const [dragging, setDragging] = useState<{ startX: number; startWidth: number } | null>(
        null
    );
    const html = useMemo(() => renderMarkdown(content, resolveImage), [content, resolveImage]);
    const onSplitterDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
        setDragging({ startX: event.clientX, startWidth: previewWidth });
        event.currentTarget.setPointerCapture(event.pointerId);
    };
    const onSplitterMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
        if (!dragging) {
            return;
        }
        const containerWidth =
            event.currentTarget.parentElement?.clientWidth ??
            event.currentTarget.ownerDocument.body.clientWidth;
        const delta = ((event.clientX - dragging.startX) / Math.max(containerWidth, 1)) * 100;
        setPreviewWidth(Math.min(Math.max(dragging.startWidth - delta, 20), 80));
    };
    return (
        <section className="wiw-content-section">
            <header className="wiw-content-header">
                <span className="wiw-content-title">Content</span>
                <button
                    type="button"
                    className="wiw-button"
                    onClick={() => setPreviewVisible((prev) => !prev)}
                >
                    {previewVisible ? 'Hide preview' : 'Show preview'}
                </button>
            </header>
            <div className="wiw-content-body">
                <textarea
                    className="wiw-content-textarea"
                    value={content}
                    spellCheck={false}
                    onChange={(event) => onContentChange(event.target.value)}
                />
                {previewVisible && !isMobile && (
                    <div
                        className="wiw-content-splitter"
                        title="Drag to resize the preview"
                        onPointerDown={onSplitterDown}
                        onPointerMove={onSplitterMove}
                        onPointerUp={() => setDragging(null)}
                    />
                )}
                {previewVisible && (
                    <div
                        className="wiw-md-preview"
                        style={
                            previewVisible && !isMobile
                                ? { flexBasis: `${previewWidth}%` }
                                : undefined
                        }
                        dangerouslySetInnerHTML={{ __html: html }}
                    />
                )}
            </div>
        </section>
    );
}

export function CardEditor({
    card,
    resolveImage,
    onDuplicate,
    onDelete,
}: {
    card: SampleEntryNode;
    resolveImage?: ImageResolver;
    onDuplicate: () => void;
    onDelete: () => void;
}): JSX.Element {
    const [values, setValues] = useState<Values>(() => initialValues(card));
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const set = (name: string, value: unknown): void => {
        setValues((prev) => ({ ...prev, [name]: value }));
    };
    const content = typeof values['content'] === 'string' ? (values['content'] as string) : '';
    const membershipLine =
        card.bookMemberships.length > 0
            ? `Appears in WI books: ${card.bookMemberships.join(', ')}`
            : 'Not part of any WI book (workspace-only entry)';
    const strategy: Strategy =
        values['constant'] === true
            ? 'constant'
            : values['vectorized'] === true
              ? 'vectorized'
              : 'normal';
    const setStrategy = (next: Strategy): void => {
        set('constant', next === 'constant');
        set('vectorized', next === 'vectorized');
    };
    return (
        <div className="wiw-editor-card">
            <div className="wiw-entry-header">
                <button
                    type="button"
                    className={`wiw-entry-state${values['disable'] === true ? ' wiw-entry-state-disabled' : ''}`}
                    title={
                        values['disable'] === true
                            ? 'Entry is disabled - click to enable'
                            : 'Entry is enabled - click to disable'
                    }
                    onClick={() => set('disable', !(values['disable'] === true))}
                >
                    <i className={`fa-solid ${values['disable'] === true ? 'fa-toggle-off' : 'fa-toggle-on'}`} />
                </button>
                <div className="wiw-entry-title">
                    <span className="wiw-field-label">
                        Title / Memo
                        <InfoIcon info={fieldMeta('comment').info} docs={fieldMeta('comment').docs} />
                    </span>
                    <input
                        type="text"
                        value={String(values['comment'] ?? '')}
                        onChange={(event) => set('comment', event.target.value)}
                    />
                </div>
                <div className="wiw-editor-actions">
                    <button
                        type="button"
                        className="wiw-button wiw-icon-button"
                        title="Duplicate this entry"
                        onClick={onDuplicate}
                    >
                        <i className="fa-solid fa-clone" />
                    </button>
                    <button
                        type="button"
                        className="wiw-button wiw-icon-button"
                        title="Delete this entry"
                        onClick={onDelete}
                    >
                        <i className="fa-solid fa-trash-can" />
                    </button>
                </div>
            </div>
            <p className="wiw-membership-line">{membershipLine}</p>
            <div className="wiw-field-grid">
                <FieldControl
                    meta={fieldMeta('key')}
                    span={4}
                    value={values['key']}
                    onChange={(next) => set('key', next)}
                />
                <FieldControl
                    meta={fieldMeta('selectiveLogic')}
                    span={2}
                    value={values['selectiveLogic']}
                    onChange={(next) => set('selectiveLogic', next)}
                />
                <FieldControl
                    meta={fieldMeta('keysecondary')}
                    span={4}
                    value={values['keysecondary']}
                    onChange={(next) => set('keysecondary', next)}
                />
                <FieldControl
                    meta={fieldMeta('selective')}
                    span={2}
                    value={values['selective']}
                    onChange={(next) => set('selective', next)}
                />
            </div>
            <div className="wiw-field-grid">
                <div className="wiw-field" style={{ gridColumn: 'span 3' }}>
                    <span className="wiw-field-label">
                        Strategy
                        <InfoIcon
                            info="Entry activation strategy: constant (always on), normal (triggered by keys), vectorized (embedding similarity)."
                            docs="https://docs.sillytavern.app/usage/core-concepts/worldinfo/#strategy"
                        />
                    </span>
                    <StrategyControl value={strategy} onChange={setStrategy} />
                </div>
                <FieldControl
                    meta={fieldMeta('order')}
                    span={2}
                    value={values['order']}
                    onChange={(next) => set('order', next)}
                />
                <FieldControl
                    meta={fieldMeta('position')}
                    span={3}
                    value={values['position']}
                    onChange={(next) => set('position', next)}
                />
                <FieldControl
                    meta={fieldMeta('depth')}
                    span={1}
                    value={values['depth']}
                    onChange={(next) => set('depth', next)}
                />
                <FieldControl
                    meta={fieldMeta('role')}
                    span={3}
                    value={values['role']}
                    onChange={(next) => set('role', next)}
                />
            </div>
            <div className="wiw-field-grid">
                <FieldControl
                    meta={fieldMeta('probability')}
                    span={3}
                    value={values['probability']}
                    onChange={(next) => {
                        set('probability', next);
                        set('useProbability', Number(next) !== 100);
                    }}
                />
                <FieldControl
                    meta={fieldMeta('group')}
                    span={4}
                    value={values['group']}
                    onChange={(next) => set('group', next)}
                />
                <FieldControl
                    meta={fieldMeta('groupOverride')}
                    span={2}
                    value={values['groupOverride']}
                    onChange={(next) => set('groupOverride', next)}
                />
                <FieldControl
                    meta={fieldMeta('groupWeight')}
                    span={3}
                    value={values['groupWeight']}
                    onChange={(next) => set('groupWeight', next)}
                />
            </div>
            <ContentSection
                content={content}
                onContentChange={(next) => set('content', next)}
                resolveImage={resolveImage}
            />
            <section className="wiw-field-group">
                <button
                    type="button"
                    className="wiw-group-header"
                    onClick={() => setAdvancedOpen((prev) => !prev)}
                >
                    <i
                        className={`fa-solid ${advancedOpen ? 'fa-chevron-down' : 'fa-chevron-right'}`}
                    />
                    <span>Advanced</span>
                </button>
                {advancedOpen && (
                    <>
                        <p className="wiw-membership-line">{membershipLine}</p>
                        <div className="wiw-field-grid">
                            {ADVANCED_LAYOUT[0]!.fields.map(({ name, span }) => (
                                <FieldControl
                                    key={name}
                                    meta={fieldMeta(name)}
                                    span={span}
                                    value={values[name as string]}
                                    onChange={(next) => set(name as string, next)}
                                />
                            ))}
                        </div>
                    </>
                )}
            </section>
        </div>
    );
}
