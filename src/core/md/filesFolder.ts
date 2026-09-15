import { DiskError, assertRelPath, type DiskEntryInfo, type DiskFolder, type RelPath } from './ports';

/**
 * Read-only DiskFolder over individually picked files (spec 004: "Import files…"),
 * so single notes and images reuse the folder scan/import pipeline unchanged.
 */
export function createFilesFolder(files: ReadonlyArray<{ name: string; bytes: Uint8Array }>): DiskFolder {
    const byPath = new Map<RelPath, Uint8Array>();
    for (const file of files) {
        let name = file.name;
        const dot = name.lastIndexOf('.');
        for (let n = 2; byPath.has(name); n++) {
            name = dot > 0 ? `${file.name.slice(0, dot)} (${n})${file.name.slice(dot)}` : `${file.name} (${n})`;
        }
        byPath.set(name, file.bytes);
    }
    const readOnly = (path: RelPath): never => {
        throw new DiskError('permission', path, 'picked files are read-only');
    };
    return {
        list: async (): Promise<DiskEntryInfo[]> => [...byPath.keys()].map((path) => ({ path, kind: 'file' })),
        readBytes: async (path) => {
            assertRelPath(path);
            const bytes = byPath.get(path);
            if (!bytes) {
                throw new DiskError('not-found', path);
            }
            return bytes;
        },
        writeBytes: async (path) => readOnly(path),
        remove: async (path) => readOnly(path),
        createDirectory: async (path) => readOnly(path),
    };
}
