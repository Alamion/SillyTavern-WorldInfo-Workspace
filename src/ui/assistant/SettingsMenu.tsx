import { useEffect, useState } from 'react';
import type { AssistantSnapshot } from '../../adapters/assistantController';
import { DEFAULT_INSTRUCTIONS } from '../../core/assistant/prompts';
import { tokenLimitProblem } from '../../core/assistant/settingsOps';
import {
    CONTEXT_TOKENS_RANGE,
    RESPONSE_TOKENS_RANGE,
    type AssistantSettings,
} from '../../core/assistant/types';

/**
 * A token limit typed as a whole: saved on blur or Enter, never per keystroke (each
 * intermediate value like "9" was repaired to the default and the field jumped).
 * An unusable value stays in the field with the reason; Escape restores the saved one.
 */
function TokenLimitField({
    label,
    field,
    settings,
    min,
    max,
    disabled,
    onChange,
}: {
    label: string;
    field: 'responseTokens' | 'contextTokens';
    settings: AssistantSettings;
    min: number;
    max: number;
    disabled: boolean;
    onChange: (patch: Partial<AssistantSettings>) => void;
}): JSX.Element {
    const saved = settings[field];
    const [draft, setDraft] = useState(String(saved));
    const [problem, setProblem] = useState<string | null>(null);
    useEffect(() => {
        setDraft(String(saved));
        setProblem(null);
    }, [saved]);
    const commit = (): void => {
        if (draft.trim() === String(saved)) {
            setProblem(null);
            return;
        }
        const value = Number(draft.trim());
        const reason = draft.trim() === '' ? 'Enter a number.' : tokenLimitProblem(field, value, settings);
        setProblem(reason);
        if (reason === null) {
            onChange({ [field]: value });
        }
    };
    return (
        <label>
            {label}
            <input
                type="number"
                min={min}
                max={max}
                value={draft}
                disabled={disabled}
                aria-invalid={problem !== null}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={commit}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                        commit();
                    } else if (event.key === 'Escape') {
                        event.stopPropagation();
                        setDraft(String(saved));
                        setProblem(null);
                    }
                }}
            />
            {problem !== null && <span className="wiw-field-error">{problem}</span>}
        </label>
    );
}

/**
 * Assistant settings (spec 005 FR-018–FR-020, FR-024): which connection profile
 * the assistant uses (independent of the chat), the request limits, and the
 * instructions. Read-only while a workspace recovery is unresolved (FR-035).
 */
export function SettingsMenu({
    snapshot,
    onChange,
    onResetInstructions,
    onClose,
}: {
    snapshot: AssistantSnapshot;
    onChange: (patch: Partial<AssistantSettings>) => void;
    onResetInstructions: () => void;
    onClose: () => void;
}): JSX.Element {
    const { settings, profiles, profile, settingsLocked } = snapshot;
    const [instructions, setInstructions] = useState(settings.instructions ?? DEFAULT_INSTRUCTIONS);
    const chat = profiles.filter((item) => item.api === 'chat-completion');
    const text = profiles.filter((item) => item.api === 'text-completion');
    return (
        <div className="wiw-overlay" onClick={onClose}>
        <div
            className="wiw-panel wiw-assistant-settings"
            onClick={(event) => event.stopPropagation()}
        >
            <h3>AI settings</h3>
            {settingsLocked && (
                <p className="wiw-banner wiw-banner-warn">
                    Assistant settings can be changed after the workspace recovery banner is
                    resolved.
                </p>
            )}
            <label>
                Connection profile
                <select
                    value={settings.profileId ?? ''}
                    disabled={settingsLocked}
                    onChange={(event) =>
                        onChange({ profileId: event.target.value === '' ? null : event.target.value })
                    }
                >
                    <option value="">— none —</option>
                    <optgroup label="Chat Completion">
                        {chat.map((item) => (
                            <option key={item.id} value={item.id}>
                                {item.name}
                                {item.model !== '' ? ` · ${item.model}` : ''}
                                {item.streaming ? ' · streaming' : ''}
                            </option>
                        ))}
                    </optgroup>
                    <optgroup label="Text Completion">
                        {text.map((item) => (
                            <option key={item.id} value={item.id}>
                                {item.name}
                                {item.model !== '' ? ` · ${item.model}` : ''}
                            </option>
                        ))}
                    </optgroup>
                </select>
            </label>
            {profile?.api === 'text-completion' && (
                <p className="wiw-banner wiw-banner-warn">
                    Text Completion profiles are supported on a best-effort basis; proposals may be
                    unreliable.
                    {profile.hasInstructTemplate === false
                        ? ' This profile has no instruct template.'
                        : ''}
                </p>
            )}
            <div className="wiw-assistant-settings-row">
                <TokenLimitField
                    label="Response length (tokens)"
                    field="responseTokens"
                    settings={settings}
                    min={RESPONSE_TOKENS_RANGE.min}
                    max={RESPONSE_TOKENS_RANGE.max}
                    disabled={settingsLocked}
                    onChange={onChange}
                />
                <TokenLimitField
                    label="Context size (tokens)"
                    field="contextTokens"
                    settings={settings}
                    min={CONTEXT_TOKENS_RANGE.min}
                    max={CONTEXT_TOKENS_RANGE.max}
                    disabled={settingsLocked}
                    onChange={onChange}
                />
            </div>
            <label>
                Instructions
                <textarea
                    value={instructions}
                    disabled={settingsLocked}
                    onChange={(event) => setInstructions(event.target.value)}
                    onBlur={() => onChange({ instructions: instructions.trim() === '' ? null : instructions })}
                />
            </label>
            <div className="wiw-notice-actions">
                <button
                    type="button"
                    className="wiw-button"
                    disabled={settingsLocked}
                    onClick={() => {
                        setInstructions(DEFAULT_INSTRUCTIONS);
                        onResetInstructions();
                    }}
                >
                    <i className="fa-solid fa-rotate-left" /> Reset to default
                </button>
            </div>
            <div className="wiw-panel-actions">
                <button type="button" className="wiw-button" onClick={onClose}>
                    <i className="fa-solid fa-xmark" /> Close
                </button>
            </div>
        </div>
        </div>
    );
}
