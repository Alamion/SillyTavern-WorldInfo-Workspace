import { MODULE_NAMESPACE } from '../core/state/schema';
import type { SillyTavernContext } from '../global';

/**
 * Reads the workspace as the server holds it right now (spec 008 research R1).
 * `/api/settings/get` is the only app endpoint returning the saved settings file;
 * the server reads the file on every call, so it reflects the last write by any
 * tab or device. Measured on `dev`: ~430 KB, ~10 ms locally.
 *
 * Throws on a failed request or an unreadable answer: the caller treats that as
 * "no decision" (FR-013).
 */
export async function readSavedWorkspace(ctx: SillyTavernContext): Promise<unknown> {
    const response = await fetch('/api/settings/get', {
        method: 'POST',
        headers: ctx.getRequestHeaders(),
        body: '{}',
    });
    if (!response.ok) {
        throw new Error(`settings request failed (${String(response.status)})`);
    }
    const body = (await response.json()) as { settings?: unknown };
    if (typeof body.settings !== 'string') {
        throw new Error('settings answer without a settings file');
    }
    const settings = JSON.parse(body.settings) as { extension_settings?: Record<string, unknown> };
    return settings.extension_settings?.[MODULE_NAMESPACE];
}
