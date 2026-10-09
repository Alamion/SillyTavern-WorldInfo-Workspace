import type { WorkspaceState } from '../state/schema';

/**
 * Image settings (spec 009 data-model.md), repaired field by field like the
 * picking settings; never saved while a recovery is pending. Pictures themselves
 * are generated with the Image Generation extension's own settings.
 */
export interface ImageSettings {
    /** Captions: chat-completion profile with a vision model; null = none chosen. */
    captionProfileId: string | null;
    /** '' = the profile's model. */
    captionModel: string;
    captionInstruction: string;
    /** Prompt drafting: null = the assistant's profile. */
    promptProfileId: string | null;
    promptModel: string;
    promptInstruction: string;
    /** Lore sent for a prompt draft, in tokens (~3.5 chars each). */
    promptContextTokens: number;
}

export const DEFAULT_CAPTION_INSTRUCTION =
    'Describe this picture in one or two sentences for a lore library: what it shows, notable details, mood. No preamble.';

export const DEFAULT_PROMPT_INSTRUCTION =
    'Write one image-generation prompt (comma-separated visual description, under 80 words) for a picture of the subject, ' +
    'using concrete visual details from the lore. No names the model cannot draw, no story, no quotes. ' +
    'Reply with the prompt only.';

export const DEFAULT_IMAGE_SETTINGS: ImageSettings = {
    captionProfileId: null,
    captionModel: '',
    captionInstruction: DEFAULT_CAPTION_INSTRUCTION,
    promptProfileId: null,
    promptModel: '',
    promptInstruction: DEFAULT_PROMPT_INSTRUCTION,
    promptContextTokens: 2000,
};

export const PROMPT_CONTEXT_RANGE = { min: 200, max: 16000 } as const;

function id(value: unknown): string | null {
    return typeof value === 'string' && value !== '' ? value : null;
}

function text(value: unknown, fallback: string): string {
    return typeof value === 'string' && value.trim() !== '' ? value : fallback;
}

export function repairImageSettings(value: unknown): ImageSettings {
    const raw = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
    const tokens = raw['promptContextTokens'];
    return {
        captionProfileId: id(raw['captionProfileId']),
        captionModel: typeof raw['captionModel'] === 'string' ? raw['captionModel'].trim() : '',
        captionInstruction: text(raw['captionInstruction'], DEFAULT_CAPTION_INSTRUCTION),
        promptProfileId: id(raw['promptProfileId']),
        promptModel: typeof raw['promptModel'] === 'string' ? raw['promptModel'].trim() : '',
        promptInstruction: text(raw['promptInstruction'], DEFAULT_PROMPT_INSTRUCTION),
        promptContextTokens:
            typeof tokens === 'number' && Number.isFinite(tokens)
                ? Math.min(PROMPT_CONTEXT_RANGE.max, Math.max(PROMPT_CONTEXT_RANGE.min, Math.round(tokens)))
                : DEFAULT_IMAGE_SETTINGS.promptContextTokens,
    };
}

export function getImageSettings(state: WorkspaceState): ImageSettings {
    return repairImageSettings(state.settings.images);
}

export function setImageSettings(state: WorkspaceState, patch: Partial<ImageSettings>): WorkspaceState {
    return {
        ...state,
        settings: { ...state.settings, images: repairImageSettings({ ...getImageSettings(state), ...patch }) },
    };
}
