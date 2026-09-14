/**
 * Book-name resolution (FR-023), mirroring the app's own `getFreeWorldName`
 * (world-info.js:4311-4321) and `checkOverwriteExistingData` comparison:
 * strip a trailing " (N)", then take the first free "Base (N)" comparing names
 * case- and accent-insensitively. Sanitization happens through the adapter.
 */

const MAX_INDEX = 99999;

export function stripTrailingIndex(name: string): string {
    return name.replace(/\s*\(\d+\)$/, '');
}

export function nameEquals(a: string, b: string): boolean {
    const fold = (value: string): string =>
        value
            .normalize('NFD')
            .replace(/\p{Diacritic}/gu, '')
            .toLowerCase();
    return fold(a) === fold(b);
}

export function nameInUse(existing: readonly string[], candidate: string): boolean {
    return existing.some((name) => nameEquals(name, candidate));
}

export function findFreeName(existing: readonly string[], base: string): string | null {
    if (!nameInUse(existing, base)) {
        return base;
    }
    const stripped = stripTrailingIndex(base);
    for (let index = 1; index < MAX_INDEX; index++) {
        const candidate = `${stripped} (${index})`;
        if (!nameInUse(existing, candidate)) {
            return candidate;
        }
    }
    return null;
}

/**
 * Sanitize via the app's own endpoint (injected by the adapter), then resolve
 * the first free name against the current book list.
 */
export async function resolveFreeBookName(
    base: string,
    existing: readonly string[],
    sanitize: (name: string) => Promise<string>
): Promise<string | null> {
    const sanitized = await sanitize(base);
    if (!nameInUse(existing, sanitized)) {
        return sanitized;
    }
    return findFreeName(existing, stripTrailingIndex(sanitized));
}