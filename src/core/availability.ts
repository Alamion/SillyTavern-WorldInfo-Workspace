/**
 * Which functions can run now, and if not, why and what to do (spec 009 US5,
 * FR-017–FR-021, research R6). Pure: the adapter collects the facts. Nothing the
 * core workspace needs is listed here — every feature below is optional.
 * Memory Books, Doom's Enhancement Suite and DeepLore are not listed: their
 * controls only appear while the extension is present, so none can fail silently.
 */

export type FeatureId =
    | 'assistant'
    | 'picking'
    | 'image-prompt'
    | 'image-caption'
    | 'image-generate'
    | 'md-folders';

export type FeatureState =
    | { ok: true }
    | { ok: false; reason: string; fix: string; reload?: boolean };

export type Availability = Record<FeatureId, FeatureState>;

export type ExtensionFact = 'enabled' | 'disabled' | 'missing';

export type FolderAccessFact = 'ok' | 'insecure' | 'no-picker' | 'framed' | 'blocked';

export interface ProfileFact {
    id: string;
    api: 'chat-completion' | 'text-completion';
}

export interface AvailabilityFacts {
    connectionManager: ExtensionFact;
    profiles: ProfileFact[];
    assistantProfileId: string | null;
    /** null = the assistant's profile. */
    pickingProfileId: string | null;
    /** null = none chosen. */
    captionProfileId: string | null;
    /** null = the assistant's profile. */
    promptProfileId: string | null;
    imageGeneration: ExtensionFact;
    /** Image Generation's selected source; '' = none. */
    imageSource: string;
    folderAccess: FolderAccessFact;
}

const OK: FeatureState = { ok: true };

const ENABLE_HINT = 'Extensions → Manage extensions';

function connectionState(facts: AvailabilityFacts): FeatureState {
    if (facts.connectionManager === 'disabled') {
        return {
            ok: false,
            reason: 'Needs the Connection Manager extension, which is disabled.',
            fix: `Enable Connection Manager in ${ENABLE_HINT}.`,
            reload: true,
        };
    }
    if (facts.connectionManager === 'missing') {
        return {
            ok: false,
            reason: 'The Connection Manager extension is not available.',
            fix: 'Update SillyTavern to a version with Connection Manager and enable it.',
            reload: true,
        };
    }
    if (facts.profiles.length === 0) {
        return {
            ok: false,
            reason: 'No connection profile exists yet.',
            fix: 'Create a connection profile in the Connection Manager (the plug icon in the top bar).',
        };
    }
    return OK;
}

function profileState(
    facts: AvailabilityFacts,
    profileId: string | null,
    where: string,
    options: { chatOnly?: boolean } = {}
): FeatureState {
    const connection = connectionState(facts);
    if (!connection.ok) {
        return connection;
    }
    if (profileId === null) {
        return { ok: false, reason: `No connection profile is chosen for ${where}.`, fix: `Choose one in ${settingsOf(where)}.` };
    }
    const profile = facts.profiles.find((item) => item.id === profileId);
    if (!profile) {
        return {
            ok: false,
            reason: `The connection profile chosen for ${where} no longer exists.`,
            fix: `Choose another one in ${settingsOf(where)}.`,
        };
    }
    if (options.chatOnly && profile.api !== 'chat-completion') {
        return {
            ok: false,
            reason: `${capitalize(where)} need a Chat Completion profile; the chosen one is Text Completion.`,
            fix: `Choose a Chat Completion profile with a vision-capable model in ${settingsOf(where)}.`,
        };
    }
    return OK;
}

function settingsOf(where: string): string {
    if (where === 'the assistant') {
        return 'the assistant settings (gear in the assistant panel)';
    }
    if (where === 'lore picking') {
        return 'the lore picking settings';
    }
    return 'Image settings (gear in the image editor)';
}

function capitalize(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function generationState(facts: AvailabilityFacts): FeatureState {
    if (facts.imageGeneration === 'disabled') {
        return {
            ok: false,
            reason: 'Needs the Image Generation extension, which is disabled.',
            fix: `Enable Image Generation in ${ENABLE_HINT}.`,
            reload: true,
        };
    }
    if (facts.imageGeneration === 'missing') {
        return {
            ok: false,
            reason: 'The Image Generation extension is not loaded.',
            fix: `Enable Image Generation in ${ENABLE_HINT}.`,
            reload: true,
        };
    }
    if (facts.imageSource.trim() === '') {
        return {
            ok: false,
            reason: 'No image source is chosen in Image Generation.',
            fix: 'Choose a source and model in Extensions → Image Generation.',
        };
    }
    return OK;
}

const FOLDER_FIX = 'Open SillyTavern in its own tab of a desktop Chromium-based browser (Chrome, Edge, Opera…) over HTTPS or on localhost.';

function folderState(fact: FolderAccessFact): FeatureState {
    switch (fact) {
        case 'ok':
            return OK;
        case 'insecure':
            return { ok: false, reason: 'Markdown folders need a secure page (HTTPS or localhost).', fix: FOLDER_FIX };
        case 'no-picker':
            return { ok: false, reason: 'This browser cannot open folders on disk.', fix: FOLDER_FIX };
        case 'framed':
            return {
                ok: false,
                reason: 'Folder access does not work while SillyTavern is shown inside another page (an embedded browser).',
                fix: FOLDER_FIX,
            };
        case 'blocked':
            return { ok: false, reason: 'The browser refused folder access on this page.', fix: FOLDER_FIX };
    }
}

export function computeAvailability(facts: AvailabilityFacts): Availability {
    return {
        assistant: profileState(facts, facts.assistantProfileId, 'the assistant'),
        picking: profileState(facts, facts.pickingProfileId ?? facts.assistantProfileId, 'lore picking'),
        'image-prompt': profileState(facts, facts.promptProfileId ?? facts.assistantProfileId, 'prompt drafting'),
        'image-caption': profileState(facts, facts.captionProfileId, 'captions', { chatOnly: true }),
        'image-generate': generationState(facts),
        'md-folders': folderState(facts.folderAccess),
    };
}

/** One line for a tooltip; the popup shows reason and fix on separate lines. */
export function describeUnavailable(state: FeatureState): string {
    if (state.ok) {
        return '';
    }
    return `${state.reason} ${state.fix}${state.reload ? ' Reload the page after enabling an extension.' : ''}`;
}
