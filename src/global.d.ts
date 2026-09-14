/**
 * Typed SillyTavern API surface used by this extension.
 *
 * Source of truth: specs/001-workspace-plugin-roadmap/research.md and
 * specs/003-core-workspace-mvp/research.md R1 (derived from
 * context/SillyTavern/public/scripts/st-context.js and world-info.js). This file
 * grows per feature; every member is fully typed — `any` is forbidden
 * (constitution III).
 */

export interface SillyTavernEventSource {
    on(event: string, handler: (...args: unknown[]) => void): void;
    makeFirst(event: string, handler: (...args: unknown[]) => void): void;
    makeLast(event: string, handler: (...args: unknown[]) => void): void;
    removeListener(event: string, handler: (...args: unknown[]) => void): void;
    emit(event: string, ...args: unknown[]): Promise<void>;
}

export interface SillyTavernEventTypes {
    APP_READY: string;
    CHAT_CHANGED: string;
    GENERATION_STARTED: string;
    SETTINGS_LOADED: string;
    SETTINGS_UPDATED: string;
    EXTENSION_SETTINGS_LOADED: string;
    WORLDINFO_UPDATED: string;
    WORLDINFO_SETTINGS_UPDATED: string;
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

export interface SillyTavernSubstituteParamsOptions {
    name1Override?: string;
    name2Override?: string;
    original?: string;
    groupOverride?: string;
    replaceCharacterCard?: boolean;
    dynamicMacros?: Record<string, string | number | boolean>;
    postProcessFn?: (value: string) => string;
}

export interface SillyTavernPopupType {
    TEXT: 1;
    CONFIRM: 2;
    INPUT: 3;
    DISPLAY: 4;
    CROP: 5;
}

export interface SillyTavernPopupResult {
    AFFIRMATIVE: 1;
    NEGATIVE: 0;
    CANCELLED: null;
    CUSTOM1: 1001;
    CUSTOM2: 1002;
    CUSTOM3: 1003;
    CUSTOM4: 1004;
    CUSTOM5: 1005;
    CUSTOM6: 1006;
    CUSTOM7: 1007;
    CUSTOM8: 1008;
    CUSTOM9: 1009;
}

export interface SillyTavernContext {
    eventSource: SillyTavernEventSource;
    eventTypes: SillyTavernEventTypes;
    extensionSettings: Record<string, unknown>;
    saveSettingsDebounced(): void;
    uuidv4(): string;
    getRequestHeaders(options?: { omitContentType?: boolean }): Record<string, string>;
    loadWorldInfo(name: string): Promise<WorldInfoBook | null | undefined>;
    saveWorldInfo(name: string, data: WorldInfoBook, immediately?: boolean): Promise<void>;
    updateWorldInfoList(): Promise<void>;
    getWorldInfoNames(): string[];
    callGenericPopup(
        content: string | HTMLElement,
        type: number,
        inputValue?: string,
        popupOptions?: Record<string, unknown>
    ): Promise<number | string | boolean | null>;
    POPUP_TYPE: SillyTavernPopupType;
    POPUP_RESULT: SillyTavernPopupResult;
    substituteParams(
        content: string,
        options?: SillyTavernSubstituteParamsOptions
    ): string;
    powerUserSettings: Record<string, unknown>;
}

declare global {
    interface Window {
        SillyTavern?: { getContext(): SillyTavernContext };
        toastr?: SillyTavernToastr;
    }
    var SillyTavern: { getContext(): SillyTavernContext } | undefined;
    var toastr: SillyTavernToastr | undefined;
}

export interface SillyTavernToastr {
    info(message: string, title?: string, overrides?: Record<string, unknown>): void;
    success(message: string, title?: string, overrides?: Record<string, unknown>): void;
    warning(message: string, title?: string, overrides?: Record<string, unknown>): void;
    error(message: string, title?: string, overrides?: Record<string, unknown>): void;
}