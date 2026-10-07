import { useState } from 'react';
import type { AssistantSnapshot } from '../../adapters/assistantController';
import { DEFAULT_INSTRUCTIONS } from '../../core/assistant/prompts';
import { tokenLimitProblem } from '../../core/assistant/settingsOps';
import {
    CONTEXT_TOKENS_RANGE,
    RESPONSE_TOKENS_RANGE,
    type AssistantSettings,
} from '../../core/assistant/types';
import { FormField, NumberField } from '../formControls';

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
            className="wiw-panel wiw-form-panel"
            onClick={(event) => event.stopPropagation()}
        >
            <h3>AI settings</h3>
            {settingsLocked && (
                <p className="wiw-banner wiw-banner-warn">
                    Assistant settings can be changed after the workspace recovery banner is
                    resolved.
                </p>
            )}
            <FormField label="Connection profile">
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
            </FormField>
            {profile?.api === 'text-completion' && (
                <p className="wiw-banner wiw-banner-warn">
                    Text Completion profiles are supported on a best-effort basis; proposals may be
                    unreliable.
                    {profile.hasInstructTemplate === false
                        ? ' This profile has no instruct template.'
                        : ''}
                </p>
            )}
            <div className="wiw-form-row">
                <NumberField
                    label="Response length (tokens)"
                    value={settings.responseTokens}
                    min={RESPONSE_TOKENS_RANGE.min}
                    max={RESPONSE_TOKENS_RANGE.max}
                    disabled={settingsLocked}
                    problem={(value) => tokenLimitProblem('responseTokens', value, settings)}
                    onCommit={(value) => onChange({ responseTokens: value })}
                />
                <NumberField
                    label="Context size (tokens)"
                    value={settings.contextTokens}
                    min={CONTEXT_TOKENS_RANGE.min}
                    max={CONTEXT_TOKENS_RANGE.max}
                    disabled={settingsLocked}
                    problem={(value) => tokenLimitProblem('contextTokens', value, settings)}
                    onCommit={(value) => onChange({ contextTokens: value })}
                />
            </div>
            <FormField label="Instructions">
                <textarea
                    value={instructions}
                    disabled={settingsLocked}
                    onChange={(event) => setInstructions(event.target.value)}
                    onBlur={() => onChange({ instructions: instructions.trim() === '' ? null : instructions })}
                />
            </FormField>
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
