import { useState } from 'react';
import type { PickingController } from '../adapters/pickingController';
import type { ProfileInfo } from '../core/assistant/ports';
import type { FeatureState } from '../core/availability';
import { PICKING_RANGES, type ChatPickingChoice, type PickingSettings as Settings } from '../core/picking/settings';
import { FormField, FormSection, MenuPanel, NumberField, OptionRow } from './formControls';

/**
 * Main-chat lore picking (spec 007 US5, contracts/ui-contract.md): the global
 * default and the current chat's choice, the profile, and the limits. Off unless
 * the user turns it on — it costs one extra model request per reply.
 */
export function PickingSettings({
    picking,
    profiles,
    assistantProfileName,
    onClose,
    availability,
}: {
    /** Spec 009: why picking cannot run now (shown above the options). */
    availability: FeatureState;
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
    const chooseForChat = (next: ChatPickingChoice): void => {
        picking.setChatChoice(next);
        setChoice(next);
    };
    const chatOptions: Array<[ChatPickingChoice, string]> = [
        [null, `Use the default (${settings.defaultEnabled ? 'on' : 'off'})`],
        ['on', 'On for this chat'],
        ['off', 'Off for this chat'],
    ];
    return (
        <MenuPanel
            title="Lore picking (main chat)"
            intro="Before each reply, a model reads the recent chat and a catalog of the entries in your active lorebooks (summaries, folders) and picks the ones that matter now. They are activated through World Info like keyword matches, so position, depth and budget stay native."
            footerHint={`${status.enabled ? 'On in this chat' : 'Off in this chat'}${
                status.activeEntries !== null ? ` · ${String(status.activeEntries)} active entries` : ''
            }${status.prepared ? ' · a pick is prepared for the next reply' : ''}`}
            onClose={onClose}
        >
            {!availability.ok && (
                <p className="wiw-banner wiw-banner-warn">
                    <i className="fa-solid fa-triangle-exclamation" /> {availability.reason} {availability.fix}
                    {availability.reload === true ? ' Reload the page after enabling an extension.' : ''}
                </p>
            )}
            {locked && (
                <p className="wiw-banner wiw-banner-warn">
                    Settings can be changed after the workspace recovery banner is resolved.
                </p>
            )}
            <FormSection
                title="When"
                hint="Costs one extra request per reply; usually prepared in the background, so replies do not wait."
            >
                <OptionRow
                    type="checkbox"
                    checked={settings.defaultEnabled}
                    disabled={locked}
                    title="On by default for every chat"
                    onChange={(checked) => update({ defaultEnabled: checked })}
                />
            </FormSection>
            <FormSection title="This chat">
                {chatOptions.map(([value, label]) => (
                    <OptionRow
                        key={value ?? 'default'}
                        type="radio"
                        checked={choice === value}
                        title={label}
                        onChange={() => chooseForChat(value)}
                    />
                ))}
            </FormSection>
            <FormSection title="Model">
                <FormField label="Connection profile">
                    <select
                        value={settings.profileId ?? ''}
                        disabled={locked}
                        onChange={(event) => update({ profileId: event.target.value === '' ? null : event.target.value })}
                    >
                        <option value="">
                            Same as the assistant{assistantProfileName ? ` (${assistantProfileName})` : ''}
                        </option>
                        {profiles
                            .filter((profile) => profile.api === 'chat-completion')
                            .map((profile) => (
                                <option key={profile.id} value={profile.id}>
                                    {profile.name}
                                    {profile.model !== '' ? ` · ${profile.model}` : ''}
                                </option>
                            ))}
                    </select>
                </FormField>
            </FormSection>
            <FormSection
                title="Limits"
                hint={
                    <>
                        Folders can be left out with &quot;Exclude from lore picking&quot; in the folder editor; the
                        reader icon on a reply shows what was picked.
                    </>
                }
            >
                <div className="wiw-form-row">
                    <NumberField
                        label="Wait at most (s)"
                        hint="When a fresh pick is needed, the reply waits at most this long; then it goes ahead with the earlier pick or keywords."
                        value={settings.timeoutSec}
                        min={PICKING_RANGES.timeoutSec.min}
                        max={PICKING_RANGES.timeoutSec.max}
                        disabled={locked}
                        onCommit={(value) => update({ timeoutSec: value })}
                    />
                    <NumberField
                        label="Chat messages read"
                        hint="How many recent messages the picking model reads."
                        value={settings.chatMessages}
                        min={PICKING_RANGES.chatMessages.min}
                        max={PICKING_RANGES.chatMessages.max}
                        disabled={locked}
                        onCommit={(value) => update({ chatMessages: value })}
                    />
                </div>
                <div className="wiw-form-row">
                    <NumberField
                        label="Max entries per reply"
                        hint="The most entries one pick may activate."
                        value={settings.maxPicks}
                        min={PICKING_RANGES.maxPicks.min}
                        max={PICKING_RANGES.maxPicks.max}
                        disabled={locked}
                        onCommit={(value) => update({ maxPicks: value })}
                    />
                    <NumberField
                        label="Catalog size (tokens)"
                        hint="How much of the lore catalog the picking model sees; larger libraries are narrowed to the entries closest to the chat."
                        value={settings.catalogTokens}
                        min={PICKING_RANGES.catalogTokens.min}
                        max={PICKING_RANGES.catalogTokens.max}
                        disabled={locked}
                        onCommit={(value) => update({ catalogTokens: value })}
                    />
                </div>
            </FormSection>
        </MenuPanel>
    );
}
