import { FOLDER_RECORD_NAME, ENTRY_EXT, isImageFileName, splitName } from './naming';
import { DiskError, type DiskEntryInfo, type DiskFolder, type RelPath } from './ports';

/**
 * Read-only views over a picked folder for the import selection (spec 004): import the
 * folder itself as one workspace folder, or only some of its top-level items.
 */

export interface TopLevelItem {
    name: string;
    kind: 'folder' | 'entry' | 'image';
}

/** Importable top-level items of a picked folder (hidden entries and other files skipped). */
export async function listTopLevel(folder: DiskFolder): Promise<TopLevelItem[]> {
    const items: TopLevelItem[] = [];
    for (const entry of await folder.list()) {
        if (entry.path.includes('/') || entry.path.startsWith('.')) {
            continue;
        }
        if (entry.kind === 'directory') {
            items.push({ name: entry.path, kind: 'folder' });
        } else if (splitName(entry.path).ext.toLowerCase() === ENTRY_EXT) {
            items.push({ name: entry.path, kind: 'entry' });
        } else if (isImageFileName(entry.path) && entry.path !== FOLDER_RECORD_NAME) {
            items.push({ name: entry.path, kind: 'image' });
        }
    }
    const rank = { folder: 0, entry: 1, image: 1 };
    return items.sort((a, b) => rank[a.kind] - rank[b.kind] || a.name.localeCompare(b.name, undefined, { numeric: true }));
}

function readOnly(path: RelPath): never {
    throw new DiskError('permission', path, 'import views are read-only');
}

/** Presents `folder` as the single directory `name/` (import the picked folder itself). */
export function wrapAsDirectory(folder: DiskFolder, name: string): DiskFolder {
    const prefix = `${name}/`;
    const inner = (path: RelPath): RelPath => {
        if (!path.startsWith(prefix)) {
            throw new DiskError('not-found', path);
        }
        return path.slice(prefix.length);
    };
    return {
        list: async (): Promise<DiskEntryInfo[]> => [
            { path: name, kind: 'directory' },
            ...(await folder.list()).map((entry) => ({ ...entry, path: `${prefix}${entry.path}` })),
        ],
        readBytes: (path) => folder.readBytes(inner(path)),
        writeBytes: async (path) => readOnly(path),
        remove: async (path) => readOnly(path),
        createDirectory: async (path) => readOnly(path),
    };
}

/** Only the chosen top-level items (and everything inside chosen folders). */
export function selectTopLevel(folder: DiskFolder, names: ReadonlySet<string>): DiskFolder {
    const allowed = (path: RelPath): boolean => names.has(path.split('/')[0] ?? '');
    return {
        list: async () => (await folder.list()).filter((entry) => allowed(entry.path)),
        readBytes: (path) => (allowed(path) ? folder.readBytes(path) : Promise.reject(new DiskError('not-found', path))),
        writeBytes: async (path) => readOnly(path),
        remove: async (path) => readOnly(path),
        createDirectory: async (path) => readOnly(path),
    };
}
