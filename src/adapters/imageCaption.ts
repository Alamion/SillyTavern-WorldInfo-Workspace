import { retryPolicy } from '../core/assistant/failures';
import type { LlmEvent, LlmPort } from '../core/assistant/ports';
import type { AssistantFailure, LlmMessage } from '../core/assistant/types';
import { buildCaptionRequest, cleanCaptionReply, selectUncaptioned } from '../core/images/captionRequest';
import { buildPromptDraftRequest, cleanPromptReply, type DraftBasisItem } from '../core/images/draftRequest';
import { classifyCaptionFailure, isBlindReply, NO_VISION_MESSAGE } from '../core/images/failures';
import { getImageSettings, setImageSettings, type ImageSettings } from '../core/images/settings';
import { findNode, getAssistantSettings } from '../core/state/schema';
import type { WorkspaceStore } from '../core/state/store';
import { commitImage } from '../core/tree/operations';

/**
 * Model-written text for image items (spec 009 US2–US4): prompt drafts from the
 * lore around an image, captions from the picture itself, and one reviewed run
 * over every uncaptioned image of a folder. Requests go through the LLM port
 * (Connection Manager profiles); nothing is stored before the user keeps it.
 */

const CAPTION_TOKENS = 400;
const PROMPT_TOKENS = 600;

export interface DraftView {
    running: boolean;
    basis: DraftBasisItem[] | null;
    error: string | null;
}

export interface CaptionView {
    running: boolean;
    proposal: string | null;
    error: string | null;
}

export type BulkItemState = 'waiting' | 'running' | 'ready' | 'failed' | 'skipped';

export interface BulkItem {
    imageId: string;
    name: string;
    src: string;
    state: BulkItemState;
    text: string;
    error: string | null;
}

export interface BulkView {
    folderId: string;
    folderName: string;
    items: BulkItem[];
    state: 'running' | 'stopped' | 'done';
    /** Seconds until an automatic retry after a rate limit, if waiting. */
    retryIn: number | null;
}

export interface ImageCaptionDeps {
    store: WorkspaceStore;
    llm: LlmPort;
    /** Scaled JPEG data URL of a picture; throws NotCaptionableError when it cannot be read. */
    preparePicture(src: string): Promise<string>;
    isRecoveryPending(): boolean;
    /** Injected for tests (fake timers). */
    sleep?(ms: number, signal: AbortSignal): Promise<void>;
}

export interface ImageCaption {
    settings(): ImageSettings;
    /** False while a data recovery is pending (settings are not saved then). */
    updateSettings(patch: Partial<ImageSettings>): boolean;
    subscribe(listener: () => void): () => void;

    draftView(imageId: string): DraftView;
    /** The cleaned draft, or null on failure/stop (the view holds the reason). */
    draftPrompt(imageId: string, idea: string): Promise<string | null>;
    stopDraft(imageId: string): void;

    captionView(imageId: string): CaptionView;
    writeCaption(imageId: string): Promise<void>;
    stopCaption(imageId: string): void;
    keepCaption(imageId: string, text: string): void;
    discardCaption(imageId: string): void;

    bulkView(): BulkView | null;
    countUncaptioned(folderId: string): number;
    startBulk(folderId: string): Promise<void>;
    stopBulk(): void;
    /** Applies the given captions in ONE store update; returns how many were stored. */
    keepBulk(captions: ReadonlyMap<string, string>): number;
    closeBulk(): void;
}

export class NotCaptionableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'NotCaptionableError';
    }
}

type RunResult = { ok: true; text: string } | { ok: false; failure: AssistantFailure };

const IDLE_DRAFT: DraftView = { running: false, basis: null, error: null };
const IDLE_CAPTION: CaptionView = { running: false, proposal: null, error: null };

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        signal.addEventListener(
            'abort',
            () => {
                clearTimeout(timer);
                resolve();
            },
            { once: true }
        );
    });
}

export function createImageCaption(deps: ImageCaptionDeps): ImageCaption {
    const listeners = new Set<() => void>();
    const drafts = new Map<string, DraftView>();
    const captions = new Map<string, CaptionView>();
    const controllers = new Map<string, AbortController>();
    let bulk: BulkView | null = null;
    let bulkController: AbortController | null = null;
    const sleep = deps.sleep ?? defaultSleep;

    const notify = (): void => listeners.forEach((listener) => listener());
    const setDraft = (imageId: string, view: DraftView): void => {
        drafts.set(imageId, view);
        notify();
    };
    const setCaption = (imageId: string, view: CaptionView): void => {
        captions.set(imageId, view);
        notify();
    };
    const setBulk = (next: BulkView | null): void => {
        bulk = next;
        notify();
    };

    const settings = (): ImageSettings => getImageSettings(deps.store.getState());

    const run = (profileId: string, model: string, messages: LlmMessage[], maxTokens: number, signal: AbortSignal): Promise<RunResult> =>
        new Promise((resolve) => {
            void deps.llm.run({ profileId, messages, maxTokens, signal, model }, (event: LlmEvent) => {
                if (event.type === 'done') {
                    resolve({ ok: true, text: event.text });
                } else if (event.type === 'failed') {
                    resolve({ ok: false, failure: event.failure });
                }
            });
        });

    /** One caption request for one image: the picture, the model, the cleanup. */
    const captionOnce = async (imageId: string, signal: AbortSignal): Promise<{ text: string } | { error: string; retryable: boolean }> => {
        const image = findNode(deps.store.getState(), imageId);
        const current = settings();
        if (image?.kind !== 'image' || image.src.trim() === '') {
            return { error: 'The item has no picture.', retryable: false };
        }
        if (current.captionProfileId === null) {
            return { error: 'Choose a caption profile in Image settings.', retryable: false };
        }
        let picture: string;
        try {
            picture = await deps.preparePicture(image.src);
        } catch (error) {
            return {
                error: `This picture cannot be sent for a caption: ${error instanceof Error ? error.message : String(error)}`,
                retryable: false,
            };
        }
        const result = await run(
            current.captionProfileId,
            current.captionModel,
            buildCaptionRequest(image, picture, current.captionInstruction),
            CAPTION_TOKENS,
            signal
        );
        if (!result.ok) {
            if (result.failure.kind === 'aborted') {
                return { error: 'Stopped.', retryable: false };
            }
            const classified = classifyCaptionFailure(result.failure);
            return { error: classified.message, retryable: classified.kind === 'retryable' };
        }
        const text = cleanCaptionReply(result.text);
        if (isBlindReply(text)) {
            return { error: NO_VISION_MESSAGE, retryable: false };
        }
        return { text };
    };

    return {
        settings,
        updateSettings(patch) {
            if (deps.isRecoveryPending()) {
                return false;
            }
            deps.store.replace(setImageSettings(deps.store.getState(), patch));
            return true;
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },

        draftView: (imageId) => drafts.get(imageId) ?? IDLE_DRAFT,

        async draftPrompt(imageId, idea) {
            if (drafts.get(imageId)?.running === true) {
                return null;
            }
            const state = deps.store.getState();
            const current = settings();
            const profileId = current.promptProfileId ?? getAssistantSettings(state).profileId;
            if (profileId === null) {
                setDraft(imageId, { running: false, basis: null, error: 'Choose a profile for prompt drafting in Image settings.' });
                return null;
            }
            const request = buildPromptDraftRequest(state, imageId, {
                idea,
                instruction: current.promptInstruction,
                contextTokens: current.promptContextTokens,
            });
            if (!request) {
                return null;
            }
            const controller = new AbortController();
            controllers.set(`draft:${imageId}`, controller);
            setDraft(imageId, { running: true, basis: null, error: null });
            const result = await run(profileId, current.promptModel, request.messages, PROMPT_TOKENS, controller.signal);
            controllers.delete(`draft:${imageId}`);
            if (!result.ok) {
                setDraft(imageId, {
                    running: false,
                    basis: null,
                    error: result.failure.kind === 'aborted' ? null : result.failure.message,
                });
                return null;
            }
            const text = cleanPromptReply(result.text);
            if (text === '') {
                setDraft(imageId, { running: false, basis: null, error: 'The model returned no prompt.' });
                return null;
            }
            setDraft(imageId, { running: false, basis: request.basis, error: null });
            return text;
        },

        stopDraft(imageId) {
            controllers.get(`draft:${imageId}`)?.abort();
        },

        captionView: (imageId) => captions.get(imageId) ?? IDLE_CAPTION,

        async writeCaption(imageId) {
            if (captions.get(imageId)?.running === true) {
                return;
            }
            const controller = new AbortController();
            controllers.set(`caption:${imageId}`, controller);
            setCaption(imageId, { running: true, proposal: null, error: null });
            const outcome = await captionOnce(imageId, controller.signal);
            controllers.delete(`caption:${imageId}`);
            if (controller.signal.aborted) {
                setCaption(imageId, IDLE_CAPTION);
                return;
            }
            setCaption(
                imageId,
                'text' in outcome
                    ? { running: false, proposal: outcome.text, error: null }
                    : { running: false, proposal: null, error: outcome.error }
            );
        },

        stopCaption(imageId) {
            controllers.get(`caption:${imageId}`)?.abort();
        },

        keepCaption(imageId, text) {
            deps.store.replace(commitImage(deps.store.getState(), imageId, { caption: text.trim() }));
            setCaption(imageId, IDLE_CAPTION);
        },

        discardCaption(imageId) {
            setCaption(imageId, IDLE_CAPTION);
        },

        bulkView: () => bulk,

        countUncaptioned: (folderId) => selectUncaptioned(deps.store.getState(), folderId).length,

        async startBulk(folderId) {
            if (bulk?.state === 'running') {
                return;
            }
            const state = deps.store.getState();
            const folder = findNode(state, folderId);
            const targets = selectUncaptioned(state, folderId);
            if (folder?.kind !== 'folder' || targets.length === 0) {
                return;
            }
            const controller = new AbortController();
            bulkController = controller;
            let view: BulkView = {
                folderId,
                folderName: folder.name,
                items: targets.map((image) => ({
                    imageId: image.id,
                    name: image.name,
                    src: image.src,
                    state: 'waiting',
                    text: '',
                    error: null,
                })),
                state: 'running',
                retryIn: null,
            };
            const update = (index: number, patch: Partial<BulkItem>, extra: Partial<BulkView> = {}): void => {
                view = {
                    ...view,
                    ...extra,
                    items: view.items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
                };
                setBulk(view);
            };
            setBulk(view);
            for (let index = 0; index < view.items.length; index += 1) {
                if (controller.signal.aborted) {
                    break;
                }
                const item = view.items[index]!;
                update(index, { state: 'running' });
                let attempt = 0;
                for (;;) {
                    const outcome = await captionOnce(item.imageId, controller.signal);
                    if (controller.signal.aborted) {
                        update(index, { state: 'skipped', error: null });
                        break;
                    }
                    if ('text' in outcome) {
                        update(index, { state: 'ready', text: outcome.text, error: null });
                        break;
                    }
                    const retry = outcome.retryable ? retryPolicy('rate-limit', attempt) : null;
                    if (!retry) {
                        update(index, { state: 'failed', error: outcome.error });
                        break;
                    }
                    attempt += 1;
                    update(index, { error: `${outcome.error} Retrying…` }, { retryIn: Math.round(retry.delayMs / 1000) });
                    await sleep(retry.delayMs, controller.signal);
                    update(index, {}, { retryIn: null });
                }
            }
            const stopped = controller.signal.aborted;
            view = {
                ...view,
                retryIn: null,
                state: stopped ? 'stopped' : 'done',
                items: view.items.map((item) => (item.state === 'waiting' || item.state === 'running' ? { ...item, state: 'skipped' } : item)),
            };
            bulkController = null;
            setBulk(view);
        },

        stopBulk() {
            bulkController?.abort();
        },

        keepBulk(chosen) {
            let next = deps.store.getState();
            let kept = 0;
            for (const [imageId, text] of chosen) {
                if (text.trim() === '' || findNode(next, imageId)?.kind !== 'image') {
                    continue;
                }
                next = commitImage(next, imageId, { caption: text.trim() });
                kept += 1;
            }
            if (kept > 0) {
                deps.store.replace(next);
            }
            return kept;
        },

        closeBulk() {
            bulkController?.abort();
            setBulk(null);
        },
    };
}

/**
 * Reads a picture and returns a JPEG data URL at most 1024 px on its long side
 * (research R3): stored files and data URIs work; other sites only when they
 * allow reading. SVGs are drawn into the canvas like any picture.
 */
export async function preparePicture(src: string): Promise<string> {
    const url = /^(data:|https?:|blob:)/i.test(src) ? src : `/${src.replace(/^\/+/, '')}`;
    let blob: Blob;
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(String(response.status));
        }
        blob = await response.blob();
    } catch {
        throw new NotCaptionableError('the picture could not be read (another site may not allow it).');
    }
    const objectUrl = URL.createObjectURL(blob);
    try {
        const image = new Image();
        image.decoding = 'async';
        image.src = objectUrl;
        await image.decode();
        const width = image.naturalWidth || 1024;
        const height = image.naturalHeight || 1024;
        const scale = Math.min(1, 1024 / Math.max(width, height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const context = canvas.getContext('2d');
        if (!context) {
            throw new NotCaptionableError('the browser could not draw the picture.');
        }
        // Transparent areas would turn black in a JPEG.
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', 0.85);
    } catch (error) {
        if (error instanceof NotCaptionableError) {
            throw error;
        }
        throw new NotCaptionableError('the picture could not be decoded.');
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}
