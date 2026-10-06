import type { WorkspaceState } from '../state/schema';

/**
 * Main-chat lore picking settings (spec 007 data-model.md), repaired field by
 * field like the assistant settings; never saved while a recovery is pending.
 */
export interface PickingSettings {
    defaultEnabled: boolean;
    /** null = the assistant's profile. */
    profileId: string | null;
    timeoutSec: number;
    chatMessages: number;
    maxPicks: number;
    catalogTokens: number;
}

export const DEFAULT_PICKING_SETTINGS: PickingSettings = {
    defaultEnabled: false,
    profileId: null,
    timeoutSec: 20,
    chatMessages: 6,
    maxPicks: 8,
    catalogTokens: 4000,
};

export const PICKING_RANGES = {
    timeoutSec: { min: 5, max: 120 },
    chatMessages: { min: 1, max: 30 },
    maxPicks: { min: 1, max: 30 },
    catalogTokens: { min: 500, max: 32000 },
} as const;

function int(value: unknown, fallback: number, range: { min: number; max: number }): number {
    return typeof value === 'number' && Number.isFinite(value)
        ? Math.min(range.max, Math.max(range.min, Math.round(value)))
        : fallback;
}

export function repairPickingSettings(value: unknown): PickingSettings {
    const raw = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
    return {
        defaultEnabled: raw['defaultEnabled'] === true,
        profileId: typeof raw['profileId'] === 'string' && raw['profileId'] !== '' ? raw['profileId'] : null,
        timeoutSec: int(raw['timeoutSec'], DEFAULT_PICKING_SETTINGS.timeoutSec, PICKING_RANGES.timeoutSec),
        chatMessages: int(raw['chatMessages'], DEFAULT_PICKING_SETTINGS.chatMessages, PICKING_RANGES.chatMessages),
        maxPicks: int(raw['maxPicks'], DEFAULT_PICKING_SETTINGS.maxPicks, PICKING_RANGES.maxPicks),
        catalogTokens: int(raw['catalogTokens'], DEFAULT_PICKING_SETTINGS.catalogTokens, PICKING_RANGES.catalogTokens),
    };
}

export function getPickingSettings(state: WorkspaceState): PickingSettings {
    return repairPickingSettings(state.settings.picking);
}

export function setPickingSettings(state: WorkspaceState, patch: Partial<PickingSettings>): WorkspaceState {
    return {
        ...state,
        settings: { ...state.settings, picking: repairPickingSettings({ ...getPickingSettings(state), ...patch }) },
    };
}

/** Per chat: 'on' / 'off' in the chat metadata; absent = the global default. */
export type ChatPickingChoice = 'on' | 'off' | null;

export function isPickingOn(settings: PickingSettings, choice: ChatPickingChoice): boolean {
    return choice === null ? settings.defaultEnabled : choice === 'on';
}
