import type { Message, ReplyVariant } from './types';

/**
 * Reply versions ("swipes") and forks (owner request 2026-09-16). Pure helpers:
 * the shown version lives in the message's own fields — everything that reads a
 * reply keeps working — and `variants` keeps every version for switching.
 */

function variantOf(message: Message): ReplyVariant {
    const variant: ReplyVariant = {
        text: message.text,
        status: message.status,
        createdAt: message.createdAt,
    };
    if (message.prose !== undefined) variant.prose = message.prose;
    if (message.reasoning !== undefined) variant.reasoning = message.reasoning;
    if (message.failure !== undefined) variant.failure = message.failure;
    if (message.origin !== undefined) variant.origin = message.origin;
    if (message.context !== undefined) variant.context = message.context;
    if (message.batch !== undefined) variant.batch = message.batch;
    if (message.startedAt !== undefined) variant.startedAt = message.startedAt;
    return variant;
}

function withVariantFields(message: Message, variant: ReplyVariant): Message {
    const next: Message = { ...message, ...variant };
    for (const key of ['prose', 'reasoning', 'failure', 'origin', 'context', 'batch', 'startedAt'] as const) {
        if (variant[key] === undefined) {
            delete next[key];
        }
    }
    return next;
}

export function variantCount(message: Message): number {
    return Math.max(1, message.variants?.length ?? 0);
}

export function variantIndex(message: Message): number {
    return message.variantIndex ?? 0;
}

/** Every version with the shown one refreshed from the message's own fields. */
function syncedVariants(message: Message): ReplyVariant[] {
    const variants = [...(message.variants ?? [])];
    variants[variantIndex(message)] = variantOf(message);
    return variants;
}

/** Shows another stored version; out-of-range indexes leave the message unchanged. */
export function showVariant(message: Message, index: number): Message {
    const variants = syncedVariants(message);
    const target = variants[index];
    if (!target || index === variantIndex(message)) {
        return message;
    }
    return { ...withVariantFields(message, target), variants, variantIndex: index };
}

/** A version that holds nothing worth keeping: an empty failed or stopped attempt. */
function isDisposable(message: Message): boolean {
    return message.text.trim() === '' && (message.batch?.applied.length ?? 0) === 0;
}

/**
 * Starts a new, empty version to generate into. The current one is kept unless
 * it is an empty attempt, which is replaced instead of piling up.
 */
export function withNewVariant(message: Message, now: string): Message {
    const variants = syncedVariants(message);
    if (isDisposable(message)) {
        variants.splice(variantIndex(message), 1);
    }
    const fresh: ReplyVariant = { text: '', status: 'pending', createdAt: now };
    variants.push(fresh);
    return {
        ...withVariantFields(message, fresh),
        variants,
        variantIndex: variants.length - 1,
        retryAttempt: 0,
        retryAt: undefined,
    };
}

/**
 * A message copied into a fork. Proposals and decisions come along; undo records
 * stay usable only in the original, so the same change is never undone twice.
 */
export function forkedMessage(message: Message, conversationId: string, originalId: string): Message {
    const copy: Message = { ...structuredClone(message), conversationId };
    if (copy.status === 'retry-wait') {
        copy.status = 'failed';
        delete copy.retryAt;
    }
    copy.forkedFrom = message.forkedFrom ?? originalId;
    return copy;
}
