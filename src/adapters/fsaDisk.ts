import {
    DiskError,
    assertRelPath,
    type AccessState,
    type DiskEntryInfo,
    type DiskFolder,
    type DiskFolderAccess,
    type RelPath,
    type StoredLink,
} from '../core/md/ports';

/**
 * Production folder access through the browser File System Access API
 * (spec 004 FR-017, research R1/R2/R8). Browser APIs are isolated in this
 * adapter (constitution II: the app offers no user-folder access). The link
 * (directory handle + sync baseline) lives in IndexedDB, per browser profile.
 */

const DB_NAME = 'WorldInfoWorkspace-md';
const STORE = 'links';
const LINK_KEY = 'default';
const PICKER_ID = 'wiw-md';

function toDiskError(error: unknown, path: RelPath): DiskError {
    if (error instanceof DiskError) {
        return error;
    }
    const name = error instanceof DOMException || error instanceof Error ? error.name : '';
    if (name === 'NotFoundError' || name === 'TypeMismatchError') {
        return new DiskError('not-found', path, String(error));
    }
    if (name === 'NotAllowedError' || name === 'SecurityError') {
        return new DiskError('permission', path, String(error));
    }
    return new DiskError('io', path, String(error));
}

export class FsaDiskFolder implements DiskFolder {
    constructor(private readonly root: FileSystemDirectoryHandle) {}

    private async directory(path: RelPath, create: boolean): Promise<FileSystemDirectoryHandle> {
        let current = this.root;
        if (path === '') {
            return current;
        }
        for (const segment of path.split('/')) {
            current = await current.getDirectoryHandle(segment, { create });
        }
        return current;
    }

    private split(path: RelPath): { dir: RelPath; name: string } {
        const at = path.lastIndexOf('/');
        return at < 0 ? { dir: '', name: path } : { dir: path.slice(0, at), name: path.slice(at + 1) };
    }

    async list(): Promise<DiskEntryInfo[]> {
        const result: DiskEntryInfo[] = [];
        const walk = async (handle: FileSystemDirectoryHandle, prefix: RelPath): Promise<void> => {
            for await (const child of handle.values()) {
                const path = prefix === '' ? child.name : `${prefix}/${child.name}`;
                if (child.kind === 'directory') {
                    result.push({ path, kind: 'directory' });
                    await walk(child, path);
                } else {
                    result.push({ path, kind: 'file' });
                }
            }
        };
        try {
            await walk(this.root, '');
        } catch (error) {
            throw toDiskError(error, '');
        }
        return result;
    }

    async readBytes(path: RelPath): Promise<Uint8Array> {
        assertRelPath(path);
        try {
            const { dir, name } = this.split(path);
            const handle = await (await this.directory(dir, false)).getFileHandle(name);
            const file = await handle.getFile();
            return new Uint8Array(await file.arrayBuffer());
        } catch (error) {
            throw toDiskError(error, path);
        }
    }

    async writeBytes(path: RelPath, data: Uint8Array): Promise<void> {
        assertRelPath(path);
        let writable: FileSystemWritableFileStream | null = null;
        try {
            const { dir, name } = this.split(path);
            const handle = await (await this.directory(dir, true)).getFileHandle(name, { create: true });
            // Writes go to a browser swap file and replace the target on close().
            writable = await handle.createWritable();
            await writable.write(data as unknown as ArrayBuffer);
            await writable.close();
            writable = null;
        } catch (error) {
            if (writable) {
                await writable.abort().catch(() => undefined);
            }
            throw toDiskError(error, path);
        }
    }

    async remove(path: RelPath): Promise<void> {
        assertRelPath(path);
        try {
            const { dir, name } = this.split(path);
            const parent = await this.directory(dir, false);
            await parent.removeEntry(name, { recursive: true });
        } catch (error) {
            const mapped = toDiskError(error, path);
            if (mapped.code !== 'not-found') {
                throw mapped;
            }
        }
    }

    async createDirectory(path: RelPath): Promise<void> {
        assertRelPath(path);
        try {
            await this.directory(path, true);
        } catch (error) {
            throw toDiskError(error, path);
        }
    }
}

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
            request.result.createObjectStore(STORE);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await openDb();
    try {
        return await new Promise<T>((resolve, reject) => {
            const tx = db.transaction(STORE, mode);
            const request = run(tx.objectStore(STORE));
            tx.oncomplete = () => resolve(request.result);
            tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
            tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
        });
    } finally {
        db.close();
    }
}

function isDirectoryHandle(value: unknown): value is FileSystemDirectoryHandle {
    return typeof FileSystemDirectoryHandle !== 'undefined' && value instanceof FileSystemDirectoryHandle;
}

async function permission(
    handle: unknown,
    request: boolean
): Promise<AccessState> {
    if (!isDirectoryHandle(handle)) {
        return 'unavailable';
    }
    try {
        const method = request ? handle.requestPermission : handle.queryPermission;
        if (!method) {
            return 'granted';
        }
        const state = await method.call(handle, { mode: 'readwrite' });
        if (state === 'granted') {
            // A granted handle whose folder was moved/deleted is unusable.
            for await (const entry of handle.values()) {
                void entry;
                break;
            }
        }
        return state;
    } catch (error) {
        const name = error instanceof Error ? error.name : '';
        return name === 'NotAllowedError' || name === 'SecurityError' ? 'prompt' : 'unavailable';
    }
}

export const fsaAccess: DiskFolderAccess = {
    isSupported: () =>
        typeof window !== 'undefined' &&
        window.isSecureContext === true &&
        typeof window.showDirectoryPicker === 'function' &&
        typeof indexedDB !== 'undefined',

    pick: async (mode) => {
        const picker = window.showDirectoryPicker;
        if (!picker) {
            return null;
        }
        try {
            const handle = await picker({ id: PICKER_ID, mode });
            return { folder: new FsaDiskFolder(handle), name: handle.name, handle };
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
                return null;
            }
            throw toDiskError(error, '');
        }
    },

    pickFiles: async () => {
        const picker = window.showOpenFilePicker;
        if (!picker) {
            return null;
        }
        try {
            const handles = await picker({
                id: PICKER_ID,
                multiple: true,
                types: [
                    {
                        description: 'Markdown notes and images',
                        accept: {
                            'text/markdown': ['.md'],
                            'image/*': ['.png', '.jpg', '.jpeg', '.jfif', '.gif', '.webp', '.svg', '.avif', '.bmp'],
                        },
                    },
                ],
            });
            return Promise.all(
                handles.map(async (handle) => {
                    const file = await handle.getFile();
                    return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
                })
            );
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
                return null;
            }
            throw toDiskError(error, '');
        }
    },

    loadLink: async () => {
        const value = await withStore<unknown>('readonly', (store) => store.get(LINK_KEY));
        return (value ?? null) as StoredLink | null;
    },

    saveLink: async (link) => {
        await withStore('readwrite', (store) => store.put(link, LINK_KEY));
    },

    clearLink: async () => {
        await withStore('readwrite', (store) => store.delete(LINK_KEY));
    },

    queryAccess: (link) => permission(link.handle, false),
    requestAccess: (link) => permission(link.handle, true),

    open: (link) => {
        if (!isDirectoryHandle(link.handle)) {
            throw new DiskError('permission', '', 'the stored folder handle is not usable');
        }
        return new FsaDiskFolder(link.handle);
    },
};
