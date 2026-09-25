import { useDeferredValue, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { NativeWorldInfoEntry } from '../../global';
import type { SampleFieldMeta, SampleFieldName } from '../../core/fieldSchema';
import { ADVANCED_LAYOUT, FIELD_SCHEMA, selectiveFor } from '../../core/fieldSchema';
import { renderMarkdown, type ImageResolver } from '../../core/preview';
import { clampLayoutSize, LAYOUT_LIMITS } from '../../core/state/layout';
import { useLayout } from '../layoutContext';
import { useDraftField } from '../useDraftField';
import { NodeHeader } from '../NodeHeader';
import { Splitter } from '../Splitter';
import { CharacterFilterControl, MultiSelectControl } from './MultiSelect';

type Values = Record<string, unknown>;
type Strategy = 'constant' | 'normal' | 'vectorized';

const FIELD_MAP = new Map<string, SampleFieldMeta>(
    FIELD_SCHEMA.map((meta) => [meta.name as string, meta])
);

function fieldMeta(name: SampleFieldName): SampleFieldMeta {
    const meta = FIELD_MAP.get(name as string);
    if (!meta) {
        throw new Error(`unmapped field: ${String(name)}`);
    }
    return meta;
}

export type CommitField = (name: keyof NativeWorldInfoEntry, value: unknown) => void;

function InfoIcon({ info, docs }: { info: string; docs?: string }): JSX.Element {
    return (
        <span className="wiw-field-icons">
            <i className="fa-solid fa-circle-info" title={info} aria-label={info} />
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
    const options: ReadonlyArray<{ id: Strategy; icon: string; info: string }> = [
        { id: 'constant', icon: 'fa-circle', info: 'Constant: inserts on every generation without keys' },
        { id: 'normal', icon: 'fa-circle-dot', info: 'Normal: triggered by keys' },
        { id: 'vectorized', icon: 'fa-link', info: 'Vectorized: can be inserted by embedding similarity' },
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
        meta.type === 'multiSelect' ||
        meta.type === 'characterFilter' ||
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
        case 'multiSelect':
            control = (
                <MultiSelectControl
                    options={meta.choices ?? []}
                    value={Array.isArray(value) ? value.map(String) : []}
                    placeholder={meta.placeholder}
                    onChange={onChange}
                />
            );
            break;
        case 'characterFilter':
            control = <CharacterFilterControl value={value} placeholder={meta.placeholder} onChange={onChange} />;
            break;
        case 'json':
            control = (
                <input
                    type="text"
                    readOnly
                    value={JSON.stringify(value ?? {})}
                    title="Passthrough object (managed by the workspace)"
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
                <span className="wiw-field-label">
                    <InfoIcon info={meta.info} docs={meta.docs} />
                    {meta.label}
                </span>
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
    substitute,
}: {
    content: string;
    onContentChange: (next: string) => void;
    resolveImage?: ImageResolver;
    substitute: (text: string) => string;
}): JSX.Element {
    const isMobile = window.matchMedia('(max-width: 900px)').matches;
    const [previewVisible, setPreviewVisible] = useState(!isMobile);
    const { layout, saveLayout } = useLayout();
    const previewRef = useRef<HTMLDivElement | null>(null);
    // The preview trails the textarea: rendering is a full CommonMark parse, and
    // typing must never wait for it (spec 006 R4).
    // Typing stays local and commits shortly after it stops (spec 006 R3).
    const draft = useDraftField(content, onContentChange);
    const deferredContent = useDeferredValue(draft.value);
    const html = useMemo(
        () =>
            renderMarkdown(deferredContent, {
                resolveImage,
                resolvePlaceholder: substitute,
            }),
        [deferredContent, resolveImage, substitute]
    );
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
                    value={draft.value}
                    spellCheck={false}
                    onChange={(event) => draft.onChange(event.target.value)}
                    onBlur={draft.onBlur}
                />
                {previewVisible && !isMobile && (
                    // Sizes in percent of the editor; the preview is on the right, so
                    // dragging left widens it.
                    <Splitter
                        className="wiw-content-splitter"
                        axis="x"
                        title="Drag to resize the preview; double-click to reset"
                        start={() => layout.previewWidth}
                        toDelta={(movement, container) => (-movement / Math.max(container?.clientWidth ?? 1, 1)) * 100}
                        clamp={(width) => clampLayoutSize('previewWidth', width)}
                        preview={(width) => {
                            if (previewRef.current) {
                                previewRef.current.style.flexBasis = `${String(width)}%`;
                            }
                        }}
                        commit={(width) => saveLayout({ previewWidth: width })}
                        onDoubleClick={() => saveLayout({ previewWidth: LAYOUT_LIMITS.previewWidth.fallback })}
                    />
                )}
                {previewVisible && (
                    <div
                        ref={previewRef}
                        className="wiw-md-preview wiw-markdown"
                        style={
                            previewVisible && !isMobile
                                ? { flexBasis: `${String(layout.previewWidth)}%` }
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
    entry,
    banner,
    membershipLine,
    resolveImage,
    substitute,
    onCommitField,
    onCommitName,
    onToggleDisable,
    onDuplicate,
    onDelete,
}: {
    entry: { id: string; native: NativeWorldInfoEntry };
    banner?: ReactNode;
    membershipLine: string;
    resolveImage?: ImageResolver;
    substitute: (text: string) => string;
    onCommitField: CommitField;
    onCommitName(name: string): void;
    onToggleDisable(): void;
    onDuplicate(): void;
    onDelete(): void;
}): JSX.Element {
    const native = entry.native;
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const set = onCommitField;
    const values: Values = native as unknown as Values;
    const strategy: Strategy =
        native.constant === true ? 'constant' : native.vectorized === true ? 'vectorized' : 'normal';
    const setStrategy = (next: Strategy): void => {
        set('constant', next === 'constant');
        set('vectorized', next === 'vectorized');
    };
    // Phones keep only the keys above the content; everything else is under Advanced.
    const isMobile = window.matchMedia('(max-width: 900px)').matches;
    const filterFields = (
        <>
            <FieldControl
                meta={fieldMeta('selectiveLogic')}
                span={2}
                value={native.selectiveLogic}
                onChange={(next) => set('selectiveLogic', next)}
            />
            <FieldControl
                meta={fieldMeta('keysecondary')}
                span={3}
                value={native.keysecondary}
                onChange={(next) => {
                    set('keysecondary', next);
                    set('selective', selectiveFor(next as string[]));
                }}
            />
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
        </>
    );
    const placementFields = (
        <>
            <div className="wiw-field-grid">
                <FieldControl
                    meta={fieldMeta('order')}
                    span={3}
                    value={native.order}
                    onChange={(next) => set('order', next)}
                />
                <FieldControl
                    meta={fieldMeta('position')}
                    span={4}
                    value={native.position}
                    onChange={(next) => set('position', next)}
                />
                <FieldControl
                    meta={fieldMeta('depth')}
                    span={2}
                    value={native.depth}
                    onChange={(next) => set('depth', next)}
                />
                <FieldControl
                    meta={fieldMeta('role')}
                    span={3}
                    value={native.role}
                    onChange={(next) => set('role', next)}
                />
            </div>
            <div className="wiw-field-grid">
                <FieldControl
                    meta={fieldMeta('probability')}
                    span={3}
                    value={native.probability}
                    onChange={(next) => {
                        set('probability', next);
                        set('useProbability', Number(next) !== 100);
                    }}
                />
                <FieldControl
                    meta={fieldMeta('group')}
                    span={4}
                    value={native.group}
                    onChange={(next) => set('group', next)}
                />
                <FieldControl
                    meta={fieldMeta('groupOverride')}
                    span={2}
                    value={native.groupOverride}
                    onChange={(next) => set('groupOverride', next)}
                />
                <FieldControl
                    meta={fieldMeta('groupWeight')}
                    span={3}
                    value={native.groupWeight}
                    onChange={(next) => set('groupWeight', next)}
                />
            </div>
        </>
    );
    return (
        <div className="wiw-editor-card">
                <NodeHeader
                kind="entry"
                icon="fa-book"
                name={native.comment}
                disabled={native.disable}
                onCommitName={onCommitName}
                onToggleDisable={onToggleDisable}
                onDuplicate={onDuplicate}
                onDelete={onDelete}
            />
            {banner}
            <p className="wiw-membership-line">{membershipLine}</p>
            <div className="wiw-field-grid">
                <FieldControl
                    meta={fieldMeta('key')}
                    span={4}
                    value={native.key}
                    onChange={(next) => set('key', next)}
                />
                {!isMobile && filterFields}
            </div>
            <ContentSection
                content={native.content}
                onContentChange={(next) => set('content', next)}
                resolveImage={resolveImage}
                substitute={substitute}
            />
            <section className="wiw-field-group">
                <button
                    type="button"
                    className="wiw-group-header"
                    onClick={() => setAdvancedOpen((prev) => !prev)}
                >
                    <i className={`fa-solid ${advancedOpen ? 'fa-chevron-down' : 'fa-chevron-right'}`} />
                    <span>Advanced</span>
                </button>
                {advancedOpen && (
                    <>
                        <p className="wiw-membership-line">{membershipLine}</p>
                        {isMobile && <div className="wiw-field-grid">{filterFields}</div>}
                        {placementFields}
                        <div className="wiw-field-grid">
                            {ADVANCED_LAYOUT[0]!.fields.map(({ name, span }) => (
                                <FieldControl
                                    key={name as string}
                                    meta={fieldMeta(name)}
                                    span={span}
                                    value={values[name as string]}
                                    onChange={(next) => set(name as keyof NativeWorldInfoEntry, next)}
                                />
                            ))}
                        </div>
                    </>
                )}
            </section>
        </div>
    );
}
