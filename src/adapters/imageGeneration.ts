import { sanitizeGenerationPrompt } from '../core/images/sanitize';
import { findNode } from '../core/state/schema';
import type { WorkspaceStore } from '../core/state/store';
import { commitImage } from '../core/tree/operations';
import type { SlashCommandObject } from '../global';

/**
 * Picture generation for image items (spec 009 US1, research R1/R2). The Image
 * Generation extension's own `imagine` command does the work with the user's
 * settings; its callback is called directly so the prompt is never parsed as
 * script. The result stays a temporary file of that extension until Keep, so
 * nothing enters the workspace's storage before the user accepts it.
 */

export interface GenerationView {
    running: { prompt: string } | null;
    candidate: { prompt: string; url: string } | null;
    keeping: boolean;
    error: string | null;
}

const IDLE: GenerationView = { running: null, candidate: null, keeping: false, error: null };

export const NO_PICTURE_MESSAGE = 'Image Generation did not return a picture — see its notification.';

export interface ImageGenerationDeps {
    store: WorkspaceStore;
    /** The registered `imagine` command object, or null when not loaded. */
    getImagine(): SlashCommandObject | null;
    fetchBytes(url: string): Promise<{ bytes: Uint8Array; ext: string }>;
    upload(input: { bytes: Uint8Array; ext: string; stem: string }): Promise<string>;
    /** Deletes a temporary file of the extension (top of user/images/). */
    removeTemporary(url: string): Promise<void>;
    /** Logs a cleanup problem; never shown as a failure of the action. */
    warn(message: string): void;
}

export interface ImageGeneration {
    view(imageId: string): GenerationView;
    subscribe(listener: () => void): () => void;
    generate(imageId: string, prompt: string): Promise<void>;
    stop(imageId: string): void;
    keep(imageId: string): Promise<boolean>;
    discard(imageId: string): void;
}

interface Slot extends GenerationView {
    abort: EventTarget | null;
    aborted: boolean;
}

export function createImageGeneration(deps: ImageGenerationDeps): ImageGeneration {
    const slots = new Map<string, Slot>();
    const views = new Map<string, GenerationView>();
    const listeners = new Set<() => void>();

    const slot = (imageId: string): Slot =>
        slots.get(imageId) ?? { ...IDLE, abort: null, aborted: false };

    const set = (imageId: string, patch: Partial<Slot>): void => {
        const next = { ...slot(imageId), ...patch };
        slots.set(imageId, next);
        views.set(imageId, {
            running: next.running,
            candidate: next.candidate,
            keeping: next.keeping,
            error: next.error,
        });
        listeners.forEach((listener) => listener());
    };

    const dropTemporary = (url: string): void => {
        deps.removeTemporary(url).catch((error: unknown) => {
            deps.warn(`A generated picture could not be removed (${url}): ${String(error)}`);
        });
    };

    const exists = (imageId: string): boolean => findNode(deps.store.getState(), imageId)?.kind === 'image';

    // An item deleted in any way (a folder above it, another tab's load) takes its
    // pending candidate with it; a running request drops its result when it ends.
    deps.store.subscribe(() => {
        for (const [imageId, current] of slots) {
            if (exists(imageId)) {
                continue;
            }
            if (current.candidate) {
                dropTemporary(current.candidate.url);
            }
            if (current.running) {
                current.candidate = null;
                continue;
            }
            slots.delete(imageId);
            views.delete(imageId);
        }
    });

    return {
        view: (imageId) => views.get(imageId) ?? IDLE,

        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },

        async generate(imageId, prompt) {
            if (slot(imageId).running) {
                return;
            }
            const sanitized = sanitizeGenerationPrompt(prompt);
            if (sanitized === null) {
                set(imageId, { error: 'Enter a prompt first.' });
                return;
            }
            const imagine = deps.getImagine();
            if (!imagine) {
                set(imageId, { error: 'The Image Generation extension is not loaded.' });
                return;
            }
            const abort = new EventTarget();
            set(imageId, { running: { prompt: prompt.trim() }, error: null, abort, aborted: false });
            let result: unknown;
            let failure: string | null = null;
            try {
                result = await imagine.callback(
                    { quiet: 'true', gallery: 'false', extend: 'false', multimodal: 'false', _abortController: abort },
                    sanitized
                );
            } catch (error) {
                failure = `Image Generation failed: ${error instanceof Error ? error.message : String(error)}`;
            }
            const current = slot(imageId);
            const url = typeof result === 'string' && result.trim() !== '' ? result.trim() : null;
            if (current.aborted || !exists(imageId)) {
                if (url) {
                    dropTemporary(url);
                }
                if (exists(imageId)) {
                    set(imageId, { running: null, abort: null, aborted: false });
                } else {
                    slots.delete(imageId);
                    views.delete(imageId);
                }
                return;
            }
            if (!url) {
                set(imageId, { running: null, abort: null, error: failure ?? NO_PICTURE_MESSAGE });
                return;
            }
            if (current.candidate) {
                dropTemporary(current.candidate.url);
            }
            set(imageId, { running: null, abort: null, candidate: { prompt: prompt.trim(), url }, error: null });
        },

        stop(imageId) {
            const current = slot(imageId);
            if (!current.running || !current.abort) {
                return;
            }
            current.aborted = true;
            current.abort.dispatchEvent(new Event('abort'));
            set(imageId, { running: null, aborted: true });
        },

        async keep(imageId) {
            const current = slot(imageId);
            const node = findNode(deps.store.getState(), imageId);
            if (!current.candidate || current.keeping || node?.kind !== 'image') {
                return false;
            }
            const candidate = current.candidate;
            set(imageId, { keeping: true, error: null });
            try {
                const { bytes, ext } = await deps.fetchBytes(candidate.url);
                const src = await deps.upload({ bytes, ext, stem: node.name });
                deps.store.replace(commitImage(deps.store.getState(), imageId, { src, prompt: candidate.prompt }));
                dropTemporary(candidate.url);
                set(imageId, { keeping: false, candidate: null });
                return true;
            } catch (error) {
                set(imageId, {
                    keeping: false,
                    error: `The picture could not be stored: ${error instanceof Error ? error.message : String(error)}`,
                });
                return false;
            }
        },

        discard(imageId) {
            const current = slot(imageId);
            if (current.candidate) {
                dropTemporary(current.candidate.url);
            }
            set(imageId, { candidate: null, error: null });
        },
    };
}

const TYPE_EXTENSIONS: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/bmp': 'bmp',
};

/** Reads a same-origin picture (a generated temporary file) as bytes + extension. */
export async function fetchImageBytes(url: string): Promise<{ bytes: Uint8Array; ext: string }> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`the generated picture could not be read (${String(response.status)})`);
    }
    const type = (response.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? '';
    const fromUrl = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(url)?.[1]?.toLowerCase() ?? '';
    const ext = TYPE_EXTENSIONS[type] ?? (fromUrl === 'jpeg' ? 'jpg' : fromUrl) ?? 'png';
    return { bytes: new Uint8Array(await response.arrayBuffer()), ext: ext === '' ? 'png' : ext };
}
