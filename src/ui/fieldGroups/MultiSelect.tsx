import { useEffect, useMemo, useRef, useState } from 'react';
import type { WorldInfoCharacterFilter } from '../../global';
import { getLiveAppContext } from '../../adapters/appApi';

export interface MultiSelectOption {
    value: string;
    label: string;
    /** Secondary text (e.g. the avatar file name behind a character name). */
    hint?: string;
    icon?: string;
}

/**
 * Chip-based multi-select with an inline, searchable option list — the React
 * counterpart of the native select2 multi-selects (closeOnSelect: false).
 * Selected values missing from the options (a deleted character, an unknown
 * trigger) stay visible as chips so they can be removed.
 */
export function MultiSelectControl({
    options,
    value,
    placeholder,
    onChange,
    onOpen,
}: {
    options: readonly MultiSelectOption[];
    value: readonly string[];
    placeholder?: string;
    onChange: (next: string[]) => void;
    /** Lets callers refresh live option sources when the list opens. */
    onOpen?: () => void;
}): JSX.Element {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const rootRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const byValue = useMemo(() => new Map(options.map((option) => [option.value, option])), [options]);
    const selected = new Set(value);
    const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase();
        if (needle === '') {
            return options;
        }
        return options.filter(
            (option) =>
                option.label.toLowerCase().includes(needle) || (option.hint ?? '').toLowerCase().includes(needle)
        );
    }, [options, query]);

    useEffect(() => {
        if (!open) {
            return;
        }
        const onPointerDown = (event: PointerEvent): void => {
            if (!(event.target instanceof Node) || !rootRef.current?.contains(event.target)) {
                setOpen(false);
                setQuery('');
            }
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        return () => document.removeEventListener('pointerdown', onPointerDown, true);
    }, [open]);

    const openList = (): void => {
        if (!open) {
            onOpen?.();
            setOpen(true);
        }
    };

    const toggle = (optionValue: string): void => {
        onChange(
            selected.has(optionValue) ? value.filter((item) => item !== optionValue) : [...value, optionValue]
        );
    };

    return (
        <div className="wiw-multiselect" ref={rootRef}>
            <div
                className="wiw-chips wiw-multiselect-field"
                onClick={() => {
                    openList();
                    inputRef.current?.focus();
                }}
            >
                {value.map((item) => {
                    const option = byValue.get(item);
                    return (
                        <span
                            key={item}
                            className={`wiw-chip${option ? '' : ' wiw-chip-unknown'}`}
                            title={option ? (option.hint ?? option.label) : `Unknown value: ${item}`}
                        >
                            {option?.icon && <i className={`fa-solid ${option.icon}`} />}
                            {option?.label ?? item}
                            <button
                                type="button"
                                className="wiw-chip-remove"
                                title="Remove"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    toggle(item);
                                }}
                            >
                                <i className="fa-solid fa-circle-xmark" />
                            </button>
                        </span>
                    );
                })}
                <input
                    ref={inputRef}
                    className="wiw-chip-input"
                    value={query}
                    placeholder={value.length === 0 ? placeholder : ''}
                    onFocus={openList}
                    onChange={(event) => {
                        setQuery(event.target.value);
                        openList();
                    }}
                    onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                            setOpen(false);
                            setQuery('');
                        } else if (event.key === 'Enter') {
                            event.preventDefault();
                            const first = filtered[0];
                            if (first) {
                                toggle(first.value);
                                setQuery('');
                            }
                        } else if (event.key === 'Backspace' && query === '' && value.length > 0) {
                            onChange(value.slice(0, -1));
                        }
                    }}
                />
                {value.length > 0 && (
                    <button
                        type="button"
                        className="wiw-chip-add"
                        title="Clear all"
                        onClick={(event) => {
                            event.stopPropagation();
                            onChange([]);
                        }}
                    >
                        <i className="fa-solid fa-xmark" />
                    </button>
                )}
            </div>
            {open && (
                <div className="wiw-multiselect-list" role="listbox" aria-multiselectable="true">
                    {filtered.length === 0 && <div className="wiw-multiselect-empty">No matches</div>}
                    {filtered.map((option) => {
                        const isSelected = selected.has(option.value);
                        return (
                            <button
                                key={option.value}
                                type="button"
                                role="option"
                                aria-selected={isSelected}
                                className={`wiw-multiselect-option${isSelected ? ' wiw-multiselect-selected' : ''}`}
                                onClick={() => toggle(option.value)}
                            >
                                <i className={`fa-solid ${isSelected ? 'fa-square-check' : 'fa-square'}`} />
                                {option.icon && <i className={`fa-solid ${option.icon}`} />}
                                <span className="wiw-multiselect-label">{option.label}</span>
                                {option.hint && <span className="wiw-multiselect-hint">{option.hint}</span>}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

const CHARACTER_PREFIX = 'character:';
const TAG_PREFIX = 'tag:';

/** Native getCharaFilename: the avatar file name without its extension. */
function characterKey(avatar: string): string {
    return avatar.replace(/\.[^/.]+$/, '');
}

function readCharacterFilterOptions(): MultiSelectOption[] {
    const ctx = getLiveAppContext();
    const characters = (ctx.characters ?? []).map((character) => {
        const key = characterKey(character.avatar);
        return {
            value: `${CHARACTER_PREFIX}${key}`,
            label: character.name || key,
            hint: character.name && character.name !== key ? key : undefined,
            icon: 'fa-user',
        };
    });
    const tags = (ctx.tags ?? []).map((tag) => ({
        value: `${TAG_PREFIX}${String(tag.id)}`,
        label: tag.name,
        icon: 'fa-tag',
    }));
    return [...characters, ...tags];
}

/**
 * One control for the native `characterFilter` object: characters and tags share
 * a single list (native select[name="characterFilter"]); names hold avatar keys,
 * tags hold tag ids; Exclude inverts the filter.
 */
export function CharacterFilterControl({
    value,
    placeholder,
    onChange,
}: {
    value: unknown;
    placeholder?: string;
    onChange: (next: WorldInfoCharacterFilter) => void;
}): JSX.Element {
    const [options, setOptions] = useState<MultiSelectOption[]>(readCharacterFilterOptions);
    const filter = toFilter(value);
    const selectedValues = [
        ...filter.names.map((name) => `${CHARACTER_PREFIX}${name}`),
        ...filter.tags.map((tag) => `${TAG_PREFIX}${tag}`),
    ];
    return (
        <div className="wiw-character-filter">
            <MultiSelectControl
                options={options}
                value={selectedValues}
                placeholder={placeholder}
                onOpen={() => setOptions(readCharacterFilterOptions())}
                onChange={(next) =>
                    onChange({
                        isExclude: filter.isExclude,
                        names: next
                            .filter((item) => item.startsWith(CHARACTER_PREFIX))
                            .map((item) => item.slice(CHARACTER_PREFIX.length)),
                        tags: next
                            .filter((item) => item.startsWith(TAG_PREFIX))
                            .map((item) => item.slice(TAG_PREFIX.length)),
                    })
                }
            />
            <button
                type="button"
                className={`wiw-toggle-chip${filter.isExclude ? ' wiw-toggle-on' : ''}`}
                title="Exclude: the entry never activates for the listed characters and tags"
                onClick={() => onChange({ ...filter, isExclude: !filter.isExclude })}
            >
                <i className={`fa-solid ${filter.isExclude ? 'fa-circle-check' : 'fa-circle'}`} />
                <span>Exclude</span>
            </button>
        </div>
    );
}

function toFilter(value: unknown): WorldInfoCharacterFilter {
    const raw = typeof value === 'object' && value !== null ? (value as Partial<WorldInfoCharacterFilter>) : {};
    return {
        isExclude: raw.isExclude === true,
        names: Array.isArray(raw.names) ? raw.names.map(String) : [],
        tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    };
}
