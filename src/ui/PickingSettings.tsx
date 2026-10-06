import { useState } from 'react';
import type { PickingController } from '../adapters/pickingController';
import type { ProfileInfo } from '../core/assistant/ports';
import { PICKING_RANGES, type ChatPickingChoice, type PickingSettings as Settings } from '../core/picking/settings';

/**
 * Main-chat lore picking (spec 007 US5, contracts/ui-contract.md): the global
 * default and the current chat's choice, the profile, and the limits. Off unless
 * the user turns it on — it costs one extra model request per reply.
 */

function NumberField({
    label,
    hint,
    value,
    range,
    disabled,
    onCommit,
}: {
    label: string;
    hint: string;
    value: number;
    range: { min: number; max: number };
    disabled: boolean;
    onCommit: (value: number) => void;
}): JSX.Element {
    const [draft, setDraft] = useState(String(value));
    return (
        <label title={hint}>
            {label}
            <input
                type="number"
                min={range.min}
                max={range.max}
                value={draft}
                disabled={disabled}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={() => {
                    const next = Number(draft);
                    if (Number.isFinite(next)) {
                        onCommit(next);
                    } else {
                        setDraft(String(value));
                    }
                }}
            />
        </label>
    );
}

export function PickingSettings({
    picking,
    profiles,
    assistantProfileName,
    onClose,
}: {
    picking: PickingController;
    profiles: ProfileInfo[];
    assistantProfileName: string | null;
    onClose: () => void;
}): JSX.Element {
    const [settings, setSettings] = useState<Settings>(() => picking.settings());
    const [choice, setChoice] = useState<ChatPickingChoice>(() => picking.chatChoice());
    const [locked, setLocked] = useState(false);
    const status = picking.status();
    const update = (patch: Partial<Settings>): void => {
        if (picking.updateSettings(patch)) {
            setSettings(picking.settings());
        } else {
            setLocked(true);
        }
    };
    const chatOptions: Array<[ChatPickingChoice, string]> = [
        [null, `Use the default (${settings.defaultEnabled ? 'on' : 'off'})`],
        ['on', 'On for this chat'],
        ['off', 'Off for this chat'],
    ];
    return (
        <div className="wiw-overlay" onClick={onClose}>
            <div className="wiw-panel wiw-assistant-settings" onClick={(event) => event.stopPropagation()}>
                <h3>Lore picking (main chat)</h3>
                <p className="wiw-context-hint">
                    Before each reply, a model reads the recent chat and a catalog of the entries in your active
                    lorebooks (summaries, folders) and picks the ones that matter now. They are activated through
                    World Info like keyword matches, so position, depth and budget stay native. Costs one extra request
                    per reply; usually prepared in the background, so replies do not wait.
                </p>
                {locked && (
                    <p className="wiw-banner wiw-banner-warn">
                        Settings can be changed after the workspace recovery banner is resolved.
                    </p>
                )}
                <label className="wiw-checkbox-row">
                    <input
                        type="checkbox"
                        checked={settings.defaultEnabled}
                        onChange={(event) => update({ defaultEnabled: event.target.checked })}
                    />
                    On by default for every chat
                </label>
                <label>
                    This chat
                    <select
                        value={choice ?? ''}
                        onChange={(event) => {
                            const next = event.target.value === '' ? null : (event.target.value as 'on' | 'off');
                            picking.setChatChoice(next);
                            setChoice(next);
                        }}
                    >
                        {chatOptions.map(([value, label]) => (
                            <option key={value ?? 'default'} value={value ?? ''}>
                                {label}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    Connection profile
                    <select
                        value={settings.profileId ?? ''}
                        onChange={(event) => update({ profileId: event.target.value === '' ? null : event.target.value })}
                    >
                        <option value="">Same as the assistant{assistantProfileName ? ` (${assistantProfileName})` : ''}</option>
                        {profiles
                            .filter((profile) => profile.api === 'chat-completion')
                            .map((profile) => (
                                <option key={profile.id} value={profile.id}>
                                    {profile.name}
                                    {profile.model !== '' ? ` · ${profile.model}` : ''}
                                </option>
                            ))}
                    </select>
                </label>
                <div className="wiw-assistant-settings-row">
                    <NumberField
                        label="Wait at most (s)"
                        hint="When a fresh pick is needed, the reply waits at most this long; then it goes ahead with the earlier pick or keywords."
                        value={settings.timeoutSec}
                        range={PICKING_RANGES.timeoutSec}
                        disabled={locked}
                        onCommit={(value) => update({ timeoutSec: value })}
                    />
                    <NumberField
                        label="Chat messages read"
                        hint="How many recent messages the picking model reads."
                        value={settings.chatMessages}
                        range={PICKING_RANGES.chatMessages}
                        disabled={locked}
                        onCommit={(value) => update({ chatMessages: value })}
                    />
                </div>
                <div className="wiw-assistant-settings-row">
                    <NumberField
                        label="Max entries per reply"
                        hint="The most entries one pick may activate."
                        value={settings.maxPicks}
                        range={PICKING_RANGES.maxPicks}
                        disabled={locked}
                        onCommit={(value) => update({ maxPicks: value })}
                    />
                    <NumberField
                        label="Catalog size (tokens)"
                        hint="How much of the lore catalog the picking model sees; larger libraries are narrowed to the entries closest to the chat."
                        value={settings.catalogTokens}
                        range={PICKING_RANGES.catalogTokens}
                        disabled={locked}
                        onCommit={(value) => update({ catalogTokens: value })}
                    />
                </div>
                <p className="wiw-context-hint">
                    {status.enabled ? 'On in this chat' : 'Off in this chat'}
                    {status.activeEntries !== null ? ` · ${String(status.activeEntries)} active entries` : ''}
                    {status.prepared ? ' · a pick is prepared for the next reply' : ''}. Folders can be left out with
                    &quot;Exclude from lore picking&quot; in the folder editor; the book icon on a reply shows what was
                    picked.
                </p>
                <div className="wiw-panel-actions">
                    <button type="button" className="wiw-button" onClick={onClose}>
                        <i className="fa-solid fa-xmark" /> Close
                    </button>
                </div>
            </div>
        </div>
    );
}
