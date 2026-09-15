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
    /** Spec 005: assistant profile list and chat/lore context. */
    CONNECTION_PROFILE_LOADED: string;
    CONNECTION_PROFILE_CREATED: string;
    CONNECTION_PROFILE_UPDATED: string;
    CONNECTION_PROFILE_DELETED: string;
    WORLD_INFO_ACTIVATED: string;
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
    /** Native shape (world-info.js): absent or `{ isExclude, names, tags }`. */
    characterFilter?: WorldInfoCharacterFilter;
    addMemo: boolean;
    displayIndex?: number;
    extensions?: Record<string, unknown>;
}

export interface WorldInfoCharacterFilter {
    isExclude: boolean;
    /** Character avatar file names without extension (native getCharaFilename). */
    names: string[];
    /** Tag ids from the app tag list. */
    tags: string[];
}

export interface SillyTavernCharacter {
    name: string;
    avatar: string;
    data?: { extensions?: { world?: string } };
}

export interface SillyTavernTag {
    id: string;
    name: string;
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

/**
 * Connection profiles and the extension request service (spec 005 research R1/R2/R11;
 * derived from context/SillyTavern/public/scripts/extensions/shared.js:388-783,
 * custom-request.js:481-531, extensions/connection-manager/index.js:160-181).
 */
export interface ConnectionProfile {
    id: string;
    name: string;
    /** 'cc' = Chat Completion, 'tc' = Text Completion. */
    mode: 'cc' | 'tc';
    api?: string;
    preset?: string;
    model?: string;
    instruct?: string;
    proxy?: string;
    'api-url'?: string;
    'secret-id'?: string;
    'prompt-post-processing'?: string;
    'reasoning-template'?: string;
    exclude?: string[];
}

export interface LlmRequestMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface ConnectionManagerCustomParams {
    stream?: boolean;
    signal?: AbortSignal | null;
    extractData?: boolean;
    includePreset?: boolean;
    includeInstruct?: boolean;
}

/** Non-streaming result of `sendRequest` with `extractData: true`. */
export interface ExtractedLlmData {
    content: unknown;
    reasoning?: string;
}

export interface LlmStreamChunk {
    text: string;
    state: { reasoning: string };
}

export type LlmStreamFactory = () => AsyncGenerator<LlmStreamChunk>;

export interface ConnectionManagerRequestServiceApi {
    sendRequest(
        profileId: string,
        prompt: LlmRequestMessage[] | string,
        maxTokens: number,
        custom?: ConnectionManagerCustomParams,
        overridePayload?: Record<string, unknown>
    ): Promise<ExtractedLlmData | LlmStreamFactory>;
    getSupportedProfiles(): ConnectionProfile[];
    getProfile(profileId: string): ConnectionProfile;
}

export interface CompletionPresetManager {
    getCompletionPresetByName(name: string): Record<string, unknown> | undefined;
}

export interface SillyTavernChatMessage {
    name: string;
    is_user: boolean;
    is_system?: boolean;
    mes: string;
}

export interface CharacterCardFields {
    description: string;
    personality: string;
    scenario: string;
    persona: string;
    system: string;
    jailbreak: string;
    mesExamples: string;
}

export interface SillyTavernContext {
    eventSource: SillyTavernEventSource;
    eventTypes: SillyTavernEventTypes;
    extensionSettings: Record<string, unknown> & { disabledExtensions?: string[] };
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
    /** Data snapshots: read through getLiveAppContext(), never the memoized context. */
    characters: SillyTavernCharacter[];
    characterId: string | number | undefined;
    tags: SillyTavernTag[];
    chatMetadata?: Record<string, unknown>;
    /** Spec 005 — assistant requests through connection profiles (research R1). */
    ConnectionManagerRequestService?: ConnectionManagerRequestServiceApi;
    getPresetManager?(apiId?: string): CompletionPresetManager | undefined;
    /** Current chat messages (read through getLiveAppContext()). */
    chat: SillyTavernChatMessage[];
    /** Persona name / character name. */
    name1: string;
    name2: string;
    getCharacterCardFields?(): CharacterCardFields;
    /** Global API settings — only the streaming fallback of spec 005 R2 is read. */
    chatCompletionSettings?: Record<string, unknown>;
    textCompletionSettings?: Record<string, unknown>;
}

/**
 * App-bundled libraries (`public/lib.js` → `globalThis.SillyTavern.libs`). Only the
 * members this plugin uses are typed (spec 004 research R3: `yaml@2`).
 */
export interface SillyTavernLibs {
    yaml: {
        parse(text: string): unknown;
        stringify(value: unknown, options?: { lineWidth?: number }): string;
    };
}

export interface SillyTavernGlobal {
    getContext(): SillyTavernContext;
    libs?: SillyTavernLibs;
}

/** File System Access API members missing from TypeScript's lib.dom (spec 004 R1). */
export interface DirectoryPickerOptions {
    id?: string;
    mode?: 'read' | 'readwrite';
    startIn?: FileSystemHandle | 'desktop' | 'documents' | 'downloads';
}

declare global {
    interface Window {
        SillyTavern?: SillyTavernGlobal;
        toastr?: SillyTavernToastr;
        showDirectoryPicker?: (options?: DirectoryPickerOptions) => Promise<FileSystemDirectoryHandle>;
        showOpenFilePicker?: (options?: {
            id?: string;
            multiple?: boolean;
            excludeAcceptAllOption?: boolean;
            types?: Array<{ description?: string; accept: Record<string, string[]> }>;
        }) => Promise<FileSystemFileHandle[]>;
    }
    interface FileSystemHandle {
        queryPermission?(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
        requestPermission?(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
    }
    interface FileSystemDirectoryHandle {
        values(): AsyncIterableIterator<FileSystemFileHandle | FileSystemDirectoryHandle>;
    }
    var SillyTavern: SillyTavernGlobal | undefined;
    var toastr: SillyTavernToastr | undefined;
}

export interface SillyTavernToastr {
    info(message: string, title?: string, overrides?: Record<string, unknown>): void;
    success(message: string, title?: string, overrides?: Record<string, unknown>): void;
    warning(message: string, title?: string, overrides?: Record<string, unknown>): void;
    error(message: string, title?: string, overrides?: Record<string, unknown>): void;
}