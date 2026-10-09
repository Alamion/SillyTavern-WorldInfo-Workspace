/**
 * The Image Generation extension switches into a special mode (the character,
 * the user, the scene, the last message, a face, a background) when the WHOLE
 * prompt equals one of its trigger words, compared case-insensitively after
 * trimming (stable-diffusion/index.js `triggerWords` / `getGenerationType`).
 * A workspace prompt is always a plain description (spec 009 R1).
 */
export const IMAGE_TRIGGER_WORDS: readonly string[] = ['you', 'me', 'scene', 'raw_last', 'last', 'face', 'background'];

/** Trimmed prompt that can never switch the generation mode; null when empty. */
export function sanitizeGenerationPrompt(prompt: string): string | null {
    const trimmed = prompt.trim();
    if (trimmed === '') {
        return null;
    }
    return IMAGE_TRIGGER_WORDS.includes(trimmed.toLowerCase()) ? `${trimmed}.` : trimmed;
}
