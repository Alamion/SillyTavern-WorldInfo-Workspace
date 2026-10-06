/**
 * Doom's Enhancement Suite scene tracker (AGPL — its data format only; spec 007
 * R8, R14). The suite stores the tracked scene in the chat metadata; live data
 * keeps `characterThoughts` and `infoBox` as JSON STRINGS. Anything unexpected
 * means "unavailable", never an error.
 */

export interface SceneInfo {
    /** Names of the characters present in the scene. */
    present: string[];
    location?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsed(value: unknown): unknown {
    if (typeof value !== 'string') {
        return value;
    }
    try {
        return JSON.parse(value) as unknown;
    } catch {
        return undefined;
    }
}

function castOf(value: unknown): string[] | null {
    const data = parsed(value);
    const list = Array.isArray(data) ? data : isRecord(data) && Array.isArray(data['characters']) ? data['characters'] : null;
    if (list === null) {
        return null;
    }
    const names = list
        .filter((item): item is Record<string, unknown> => isRecord(item) && typeof item['name'] === 'string')
        .filter((item) => item['present'] !== false)
        .map((item) => String(item['name']).trim())
        .filter((name) => name !== '');
    return names.length > 0 ? names : null;
}

function locationOf(value: unknown): string | undefined {
    const data = parsed(value);
    if (!isRecord(data)) {
        return undefined;
    }
    const location = data['location'];
    if (typeof location === 'string' && location.trim() !== '') {
        return location.trim();
    }
    if (isRecord(location) && typeof location['value'] === 'string' && location['value'].trim() !== '') {
        return location['value'].trim();
    }
    return undefined;
}

export function readScene(chatMetadata: unknown): SceneInfo | null {
    if (!isRecord(chatMetadata) || !isRecord(chatMetadata['dooms_tracker'])) {
        return null;
    }
    const tracker = chatMetadata['dooms_tracker'];
    // The newest generated data first; the committed (accepted) data as fallback.
    for (const key of ['lastGeneratedData', 'committedTrackerData']) {
        const data = tracker[key];
        if (!isRecord(data)) {
            continue;
        }
        const present = castOf(data['characterThoughts']);
        if (present !== null) {
            const location = locationOf(data['infoBox']);
            return location !== undefined ? { present, location } : { present };
        }
    }
    return null;
}
