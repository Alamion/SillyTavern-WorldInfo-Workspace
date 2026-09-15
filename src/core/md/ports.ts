/**
 * Ports of the markdown module (spec 004, contracts/disk-port.md). Core logic in
 * `src/core/md/` depends only on these interfaces; implementations live in
 * `src/adapters/` (production) and `tests/support/` (fakes). Keeping folder access
 * behind a port is what lets other access mechanisms be added later (FR-022).
 */

/** Relative POSIX-style path inside the picked folder, e.g. "Kingdoms/Aldermeer.md". */
export type RelPath = string;

export interface DiskEntryInfo {
    path: RelPath;
    kind: 'file' | 'directory';
}

export interface DiskFolder {
    /** Recursive listing of every descendant; filtering is the scanner's job. */
    list(): Promise<DiskEntryInfo[]>;
    readBytes(path: RelPath): Promise<Uint8Array>;
    /** Atomic replace from a reader's perspective; creates missing parent directories. */
    writeBytes(path: RelPath, data: Uint8Array): Promise<void>;
    /** Removes a file, or a directory recursively. A missing path is a no-op. */
    remove(path: RelPath): Promise<void>;
    createDirectory(path: RelPath): Promise<void>;
}

export type AccessState = 'granted' | 'prompt' | 'denied' | 'unavailable';

export type DiskErrorCode = 'not-found' | 'permission' | 'io' | 'invalid-path';

export class DiskError extends Error {
    readonly code: DiskErrorCode;
    readonly path: RelPath;

    constructor(code: DiskErrorCode, path: RelPath, message?: string) {
        super(message ?? `${code}: ${path}`);
        this.name = 'DiskError';
        this.code = code;
        this.path = path;
    }
}

/** Rejects paths that could escape the folder (port guarantee 5). */
export function assertRelPath(path: RelPath): void {
    if (
        path === '' ||
        path.startsWith('/') ||
        path.includes('\\') ||
        path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
    ) {
        throw new DiskError('invalid-path', path, `invalid relative path: "${path}"`);
    }
}

export function parentPath(path: RelPath): RelPath {
    const at = path.lastIndexOf('/');
    return at < 0 ? '' : path.slice(0, at);
}

export function baseName(path: RelPath): string {
    const at = path.lastIndexOf('/');
    return at < 0 ? path : path.slice(at + 1);
}

export function joinPath(dir: RelPath, name: string): RelPath {
    return dir === '' ? name : `${dir}/${name}`;
}

export type MdItemKind = 'folder' | 'entry' | 'image';

/** Per-item state of both sides at the last successful sync (data-model.md). */
export interface BaselineItem {
    id: string;
    kind: MdItemKind;
    /** Entry file, image file, or folder directory; null for URL-only images. */
    path: RelPath | null;
    /** Hash of the canonical rendering from the workspace side. */
    wsHash: string;
    /** Hash of what was last read from / written to disk. */
    diskHash: string;
}

export interface StoredLink {
    formatVersion: 1;
    /** Opaque access handle (FSA: FileSystemDirectoryHandle). */
    handle: unknown;
    folderName: string;
    workspaceRootId: string;
    linkedAt: string;
    lastSyncAt: string | null;
    baseline: Record<string, BaselineItem>;
}

export interface DiskFolderAccess {
    /** False when the environment cannot provide folders at all. */
    isSupported(): boolean;
    /** Opens the picker (user gesture required). null when the user cancels. */
    pick(mode: 'read' | 'readwrite'): Promise<{ folder: DiskFolder; name: string; handle: unknown } | null>;
    /** Opens a multi-file picker for markdown and image files. null when cancelled. */
    pickFiles(): Promise<Array<{ name: string; bytes: Uint8Array }> | null>;
    loadLink(): Promise<StoredLink | null>;
    saveLink(link: StoredLink): Promise<void>;
    clearLink(): Promise<void>;
    queryAccess(link: StoredLink): Promise<AccessState>;
    /** Must be called within transient user activation. */
    requestAccess(link: StoredLink): Promise<AccessState>;
    open(link: StoredLink): DiskFolder;
}

export interface YamlCodec {
    parse(text: string): unknown;
    stringify(value: unknown): string;
}

/** SHA-256 over bytes, hex encoded. Injected so core stays free of browser globals. */
export type Digest = (bytes: Uint8Array) => Promise<string>;

/** App image storage (spec 004 FR-024, research R6). */
export interface ImageStorePort {
    /** Stores bytes and returns the `src` to reference them by. */
    upload(input: { bytes: Uint8Array; ext: string; stem: string }): Promise<string>;
    /** Deletes an owned stored image; a missing file is not an error. */
    remove(src: string): Promise<void>;
    /** True for `src` values this plugin owns in the app image storage. */
    isOwned(src: string): boolean;
    /** True when the storage accepts this file extension (lower-case, no dot). */
    accepts(ext: string): boolean;
}
