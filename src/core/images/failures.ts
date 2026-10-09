import type { AssistantFailure } from '../assistant/types';

/**
 * Caption failures (spec 009 FR-016): a model that cannot read pictures is told
 * apart from ordinary provider trouble, so the user knows to pick another model.
 */

export type CaptionFailureKind = 'no-vision' | 'not-captionable' | 'retryable' | 'other';

export interface CaptionFailure {
    kind: CaptionFailureKind;
    message: string;
}

export const NO_VISION_MESSAGE =
    'The model likely does not accept pictures. Choose a vision-capable model (or profile) in Image settings.';

const VISION_ERROR = /\b(image|images|vision|multimodal|modalit(?:y|ies)|image_url)\b/i;
const BLIND_REPLY =
    /\b(?:can(?:no|')t|cannot|unable to|don't|do not)\s+(?:see|view|access|process|open|analy[sz]e|look at)\b[^.]{0,40}\b(?:image|picture|photo|attachment)/i;

/** A reply that describes nothing because the model never saw the picture. */
export function isBlindReply(text: string): boolean {
    return text.trim() === '' || BLIND_REPLY.test(text);
}

export function classifyCaptionFailure(failure: AssistantFailure): CaptionFailure {
    if (failure.kind === 'empty') {
        return { kind: 'no-vision', message: NO_VISION_MESSAGE };
    }
    if (failure.kind === 'rate-limit' || failure.kind === 'network') {
        return { kind: 'retryable', message: failure.message };
    }
    const raw = `${failure.message} ${failure.detail ?? ''}`;
    if (failure.kind === 'provider' && VISION_ERROR.test(raw) && /\b(400|404|not support|unsupported|no endpoints)\b/i.test(raw)) {
        return { kind: 'no-vision', message: NO_VISION_MESSAGE };
    }
    // The app passes only the status text on: OpenRouter's "No endpoints found that
    // support image input" arrives as "Not Found" (live 2026-10-09). An unknown model
    // is a 400 there, so a 404 for a request with a picture means no image support.
    if (failure.kind === 'provider' && /\bnot found\b|\b404\b/i.test(failure.detail ?? '')) {
        return { kind: 'no-vision', message: NO_VISION_MESSAGE };
    }
    return { kind: 'other', message: failure.message };
}
