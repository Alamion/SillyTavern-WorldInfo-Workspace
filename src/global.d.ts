/**
 * Typed SillyTavern API surface used by this extension.
 *
 * Source of truth: specs/001-workspace-plugin-roadmap/research.md (derived from
 * context/SillyTavern/public/scripts/st-context.js and world-info.js). This file
 * grows per feature; every member is fully typed — `any` is forbidden
 * (constitution III).
 */

export interface SillyTavernEventSource {
    on(event: string, handler: (...args: unknown[]) => void): void;
    emit(event: string, ...args: unknown[]): void;
}

export interface SillyTavernEventTypes {
    APP_READY: string;
}

export interface NativeWorldInfoEntry {
    uid: number;
    key: string[];
    keysecondary: string[];
    comment: string;
    content: string;
    constant: boolean;
    vectorized: boolean;
    selective: boolean;
    selectiveLogic: number;
    probability: number;
    useProbability: boolean;
    disable: boolean;
    order: number;
    position: number;
    depth: number;
    role: number;
    outletName: string;
    ignoreBudget: boolean;
    excludeRecursion: boolean;
    preventRecursion: boolean;
    delayUntilRecursion: number;
    matchPersonaDescription: boolean;
    matchCharacterDescription: boolean;
    matchCharacterPersonality: boolean;
    matchCharacterDepthPrompt: boolean;
    matchScenario: boolean;
    matchCreatorNotes: boolean;
    group: string;
    groupOverride: boolean;
    groupWeight: number;
    scanDepth: number | null;
    caseSensitive: boolean | null;
    matchWholeWords: boolean | null;
    useGroupScoring: boolean | null;
    sticky: number | null;
    cooldown: number | null;
    delay: number | null;
    automationId: string;
    triggers: string[];
    characterFilterNames: string[];
    characterFilterTags: string[];
    characterFilterExclude: boolean;
    addMemo: boolean;
    displayIndex?: number;
    extensions?: Record<string, unknown>;
}

export interface WorldInfoBook {
    name?: string;
    entries: Record<string, NativeWorldInfoEntry>;
    extensions?: Record<string, unknown>;
}

export interface SillyTavernContext {
    eventSource: SillyTavernEventSource;
    eventTypes: SillyTavernEventTypes;
    extensionSettings: Record<string, unknown>;
    saveSettingsDebounced(): void;
    loadWorldInfo(name: string): Promise<WorldInfoBook>;
    saveWorldInfo(name: string, data: WorldInfoBook, immediately?: boolean): void;
    getWorldInfoNames(): string[];
}

declare global {
    interface Window {
        SillyTavern?: { getContext(): SillyTavernContext };
    }
    var SillyTavern: { getContext(): SillyTavernContext } | undefined;
}
