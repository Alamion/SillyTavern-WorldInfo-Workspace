import { bytesToBase64 } from '../core/md/dataUri';
import type { ImageStorePort } from '../core/md/ports';

/**
 * App image storage (spec 004 FR-024, research R6): the user image folder the
 * built-in Gallery uses (`user/images/<subfolder>/`), reached through the app's
 * own `/api/images/upload` and `/api/images/delete` endpoints. The app helper
 * `saveBase64AsFile` (public/scripts/utils.js) wraps the same upload endpoint but
 * is not exposed by `getContext()`, so this adapter mirrors it (constitution II:
 * documented app endpoint, isolated in one adapter). No server plugin involved.
 */

export const IMAGE_SUBFOLDER = 'WorldInfoWorkspace';
const OWNED_PREFIX = `user/images/${IMAGE_SUBFOLDER}/`;
/** The app's MEDIA_EXTENSIONS image subset (src/constants.js). */
const ACCEPTED: ReadonlySet<string> = new Set(['bmp', 'png', 'jpg', 'jpeg', 'jfif', 'gif', 'webp']);

function normalize(src: string): string {
    return src.replace(/^\/+/, '');
}

function randomSuffix(): string {
    return Math.random().toString(36).slice(2, 8).padEnd(6, '0');
}

export function createImageStore(deps: {
    getRequestHeaders: () => Record<string, string>;
    fetchFn?: typeof fetch;
}): ImageStorePort {
    const fetchFn = deps.fetchFn ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
    return {
        accepts: (ext) => ACCEPTED.has(ext.toLowerCase()),

        isOwned: (src) => normalize(src).startsWith(OWNED_PREFIX),

        upload: async ({ bytes, ext, stem }) => {
            // The endpoint silently overwrites an existing name: keep names unique.
            const safeStem = stem.replace(/[^\p{L}\p{N} _-]+/gu, '_').slice(0, 60) || 'image';
            const response = await fetchFn('/api/images/upload', {
                method: 'POST',
                headers: deps.getRequestHeaders(),
                body: JSON.stringify({
                    image: bytesToBase64(bytes),
                    format: ext.toLowerCase(),
                    ch_name: IMAGE_SUBFOLDER,
                    filename: `${safeStem}-${randomSuffix()}`,
                }),
            });
            if (!response.ok) {
                let message = `upload failed (${response.status})`;
                try {
                    const body = (await response.json()) as { error?: string };
                    message = body.error ?? message;
                } catch {
                    // Non-JSON error body: keep the status message.
                }
                throw new Error(message);
            }
            const body = (await response.json()) as { path?: unknown };
            if (typeof body.path !== 'string' || body.path === '') {
                throw new Error('upload returned no path');
            }
            return normalize(body.path);
        },

        remove: async (src) => {
            const path = normalize(src);
            if (!path.startsWith(OWNED_PREFIX)) {
                return;
            }
            const response = await fetchFn('/api/images/delete', {
                method: 'POST',
                headers: deps.getRequestHeaders(),
                body: JSON.stringify({ path }),
            });
            if (!response.ok && response.status !== 404) {
                throw new Error(`delete failed (${response.status})`);
            }
        },
    };
}
