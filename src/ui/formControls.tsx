import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { describeUnavailable, type FeatureId, type FeatureState } from '../core/availability';
import type { AvailabilityService } from '../adapters/availability';
import { messageDialog } from '../adapters/popups';

/**
 * Shared form controls for panels and menus (AGENTS.md "Style system"): every
 * settings or edit surface builds its fields from these, so layout and theming
 * are decided once. Styles: `wiw-theme.scss` (form controls, `.wiw-form-*`,
 * `.wiw-option*`, `.wiw-section`).
 *
 * - `OptionRow`: a checkbox or radio with its title and hint as one clickable row.
 * - `FormField`: label text above one control (select, text, textarea).
 * - `NumberField`: a number typed as a whole — committed on blur or Enter, never
 *   per keystroke; an unusable value stays with its reason; Escape restores.
 * - `FormSection`: a titled group (small uppercase heading + optional hint).
 * - `GatedButton` + `useFeature`: a function whose optional dependency is missing
 *   (spec 009 FR-017/FR-018) keeps its place, shows a warning badge and explains
 *   what to enable when activated — never a faded control without a reason.
 */

export function OptionRow({
    type,
    checked,
    disabled,
    title,
    hint,
    tooltip,
    onChange,
    children,
}: {
    type: 'radio' | 'checkbox';
    checked: boolean;
    disabled?: boolean;
    title: string;
    hint?: string;
    tooltip?: string;
    onChange: (checked: boolean) => void;
    /** Extra inline content after the title (e.g. a count input). */
    children?: ReactNode;
}): JSX.Element {
    return (
        <label className={`wiw-option${checked ? ' wiw-option-checked' : ''}`} title={tooltip}>
            <input
                type={type}
                checked={checked}
                disabled={disabled}
                onChange={(event) => onChange(event.target.checked)}
            />
            <span className="wiw-option-text">
                <span className="wiw-option-title">
                    {title}
                    {children}
                </span>
                {hint !== undefined && <span className="wiw-hint">{hint}</span>}
            </span>
        </label>
    );
}

export function FormField({
    label,
    hint,
    children,
}: {
    label: string;
    hint?: string;
    children: ReactNode;
}): JSX.Element {
    return (
        <label className="wiw-form-field" title={hint}>
            {label}
            {children}
        </label>
    );
}

export function NumberField({
    label,
    hint,
    value,
    min,
    max,
    disabled,
    problem,
    onCommit,
}: {
    label: string;
    hint?: string;
    value: number;
    min: number;
    max: number;
    disabled?: boolean;
    /** Why a typed value cannot be saved; defaults to the min–max range. */
    problem?: (value: number) => string | null;
    onCommit: (value: number) => void;
}): JSX.Element {
    const [draft, setDraft] = useState(String(value));
    const [reason, setReason] = useState<string | null>(null);
    useEffect(() => {
        setDraft(String(value));
        setReason(null);
    }, [value]);
    const commit = (): void => {
        const text = draft.trim();
        if (text === String(value)) {
            setReason(null);
            return;
        }
        const next = Number(text);
        const found =
            text === '' || !Number.isFinite(next)
                ? 'Enter a number.'
                : (problem?.(next) ??
                  (next < min || next > max ? `Use ${String(min)}–${String(max)}.` : null));
        setReason(found);
        if (found === null) {
            onCommit(next);
        }
    };
    return (
        <label className="wiw-form-field" title={hint}>
            {label}
            <input
                type="number"
                min={min}
                max={max}
                value={draft}
                disabled={disabled}
                aria-invalid={reason !== null}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={commit}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                        commit();
                    } else if (event.key === 'Escape') {
                        event.stopPropagation();
                        setDraft(String(value));
                        setReason(null);
                    }
                }}
            />
            {reason !== null && <span className="wiw-field-error">{reason}</span>}
        </label>
    );
}

export function FormSection({
    title,
    hint,
    children,
}: {
    title: string;
    hint?: ReactNode;
    children: ReactNode;
}): JSX.Element {
    return (
        <section className="wiw-section">
            <h4>{title}</h4>
            {hint !== undefined && <p className="wiw-hint">{hint}</p>}
            {children}
        </section>
    );
}

/**
 * A menu-like overlay panel: title with a close button, an optional intro line, a
 * scrolling body of FormSections, and a footer (hint on the left, actions on the
 * right). The assistant context menu, the context preview and the lore picking
 * settings use it; a new menu should too.
 */
export function MenuPanel({
    title,
    intro,
    className,
    footerHint,
    footerActions,
    onClose,
    children,
}: {
    title: string;
    intro?: ReactNode;
    /** Extra class on the panel for surface-specific sizing. */
    className?: string;
    footerHint?: ReactNode;
    /** Defaults to a single "Done" button. */
    footerActions?: ReactNode;
    onClose: () => void;
    children: ReactNode;
}): JSX.Element {
    return (
        <div className="wiw-overlay" onClick={onClose}>
            <div
                className={`wiw-panel wiw-menu-panel${className !== undefined ? ` ${className}` : ''}`}
                role="dialog"
                aria-label={title}
                onClick={(event) => event.stopPropagation()}
            >
                <div className="wiw-menu-header">
                    <h3>{title}</h3>
                    <button type="button" className="wiw-button wiw-icon-button" title="Close" onClick={onClose}>
                        <i className="fa-solid fa-xmark" />
                    </button>
                </div>
                {intro !== undefined && <p>{intro}</p>}
                <div className="wiw-menu-body">{children}</div>
                <div className="wiw-menu-footer">
                    <span className="wiw-hint">{footerHint}</span>
                    <span className="wiw-menu-footer-actions">
                        {footerActions ?? (
                            <button type="button" className="wiw-button wiw-button-active" onClick={onClose}>
                                Done
                            </button>
                        )}
                    </span>
                </div>
            </div>
        </div>
    );
}

/** The current availability of one feature; re-renders when it changes. */
export function useFeature(service: AvailabilityService, id: FeatureId): FeatureState {
    return useSyncExternalStore(service.subscribe, () => service.feature(id));
}

/** Explains why a function cannot run (click, tap or keyboard on a gated control). */
export function explainUnavailable(state: FeatureState): void {
    if (state.ok) {
        return;
    }
    const lines = [state.reason, state.fix];
    if (state.reload === true) {
        lines.push('Reload the page after enabling an extension.');
    }
    void messageDialog('Not available', lines);
}

/**
 * A button for a function with an optional dependency. While the dependency is
 * missing the button stays visible with a warning badge; activating it explains
 * what to enable instead of running the action.
 */
export function GatedButton({
    state,
    onClick,
    className = 'wiw-button',
    title,
    disabled,
    children,
    explain = explainUnavailable,
}: {
    state: FeatureState;
    onClick: () => void;
    className?: string;
    title?: string;
    /** Disabled for a reason of its own (e.g. an empty prompt); ignored while unavailable. */
    disabled?: boolean;
    children: ReactNode;
    explain?: (state: FeatureState) => void;
}): JSX.Element {
    if (!state.ok) {
        return (
            <button
                type="button"
                className={`${className} wiw-unavailable`}
                aria-disabled="true"
                title={describeUnavailable(state)}
                onClick={(event) => {
                    event.stopPropagation();
                    explain(state);
                }}
            >
                {children}
                <i className="fa-solid fa-triangle-exclamation wiw-unavailable-badge" aria-hidden="true" />
            </button>
        );
    }
    return (
        <button type="button" className={className} title={title} disabled={disabled} onClick={onClick}>
            {children}
        </button>
    );
}
