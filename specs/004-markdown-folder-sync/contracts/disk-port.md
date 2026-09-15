# Contract — Disk Folder Port

The only surface through which markdown logic touches files (spec FR-022, research R1).
Core modules (`src/core/md/*`) depend on this interface only; implementations live in
`src/adapters/`.

```ts
/** Relative POSIX-style path inside the linked/picked folder, e.g. "Kingdoms/Aldermeer.md". */
type RelPath = string;

interface DiskEntryInfo {
    path: RelPath;
    kind: 'file' | 'directory';
}

interface DiskFolder {
    /** Recursive listing; excludes nothing (filtering is the scanner's job). */
    list(): Promise<DiskEntryInfo[]>;
    readBytes(path: RelPath): Promise<Uint8Array>;
    /** Atomic replace from a reader's perspective; creates missing parent directories. */
    writeBytes(path: RelPath, data: Uint8Array): Promise<void>;
    /** Removes a file, or a directory recursively. Missing path = no-op. */
    remove(path: RelPath): Promise<void>;
    createDirectory(path: RelPath): Promise<void>;
}

type AccessState = 'granted' | 'prompt' | 'denied' | 'unavailable';

interface DiskFolderAccess {
    /** False when the environment cannot provide folders at all (R1 gate). */
    isSupported(): boolean;
    /** Opens the picker (user gesture required). null when the user cancels. */
    pick(mode: 'read' | 'readwrite'): Promise<{ folder: DiskFolder; name: string } | null>;
    /** Link persistence (per browser profile). */
    loadLink(): Promise<StoredLink | null>;
    saveLink(link: StoredLink): Promise<void>;
    clearLink(): Promise<void>;
    queryAccess(link: StoredLink): Promise<AccessState>;
    /** Must be called within transient user activation. */
    requestAccess(link: StoredLink): Promise<AccessState>;
    open(link: StoredLink): DiskFolder;
}
```

`StoredLink` shape: [data-model.md](../data-model.md#storedlink).

## Behavioral guarantees (tested by the shared port suite)

1. `writeBytes` then `readBytes` returns identical bytes; a failed write leaves the
   previous content intact (FSA: swap file + `close()`; memory: replace on success).
2. `writeBytes("a/b/c.md")` creates `a/` and `a/b/` when missing.
3. `remove` of a directory removes all descendants; removing a missing path resolves.
4. `list` returns every descendant exactly once, directories included, with `/`
   separators and no leading `./`.
5. Paths containing `..`, a leading `/`, or empty segments are rejected with an error
   (never escape the folder).
6. Errors are thrown as `DiskError { code: 'not-found' | 'permission' | 'io' | 'invalid-path', path }`
   so the link manager can distinguish lost access from I/O failures.

## Implementations

| Implementation | Where | Use |
|----------------|-------|-----|
| `FsaDiskFolder` / `fsaAccess` | `src/adapters/fsaDisk.ts` | Production (File System Access API + IndexedDB link store) |
| `MemoryDiskFolder` | `tests/support/memoryDisk.ts` | Unit/integration tests; supports fault injection (fail the N-th write) |

Future: a server-plugin port (option B) or an upload/download port (option C) implement
the same interfaces.
