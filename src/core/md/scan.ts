import { parseEntryFile, parseFolderRecord, type EntryFileModel, type FolderRecordModel } from './convention';
import { DecodeError, decodeText } from './hash';
import { ENTRY_EXT, FOLDER_RECORD_NAME, isImageFileName, splitName } from './naming';
import { baseName, parentPath, type Digest, type DiskFolder, type RelPath, type YamlCodec } from './ports';
import type { ReportLine } from './report';
import type { CancelToken } from './cancel';

/**
 * Read-only scan of a markdown folder (spec 004 FR-008, research R4 scanner
 * rules). Never writes. Returns parsed items plus report lines for everything
 * skipped or warned about.
 */

export interface ScannedFolder {
    kind: 'folder';
    path: RelPath;
    parentPath: RelPath | null;
    name: string;
    record: FolderRecordModel | null;
    /** Hash of the record file ('' when the folder has no record). */
    diskHash: string;
}

export interface ScannedEntry {
    kind: 'entry';
    path: RelPath;
    parentPath: RelPath;
    stem: string;
    diskHash: string;
    model: EntryFileModel;
}

export interface ScannedImage {
    kind: 'image';
    path: RelPath;
    parentPath: RelPath;
    fileName: string;
    ext: string;
    diskHash: string;
    bytes: Uint8Array;
}

export type ScannedItem = ScannedFolder | ScannedEntry | ScannedImage;

export interface ScanResult {
    folders: Map<RelPath, ScannedFolder>;
    entries: ScannedEntry[];
    images: ScannedImage[];
    lines: ReportLine[];
}

const YIELD_EVERY = 25;

function isIgnored(path: RelPath): boolean {
    const segments = path.split('/');
    const last = segments[segments.length - 1] ?? '';
    if (last.endsWith('.crswap')) {
        return true;
    }
    return segments.some((segment, index) => {
        if (!segment.startsWith('.')) {
            return false;
        }
        return !(index === segments.length - 1 && segment === FOLDER_RECORD_NAME);
    });
}

export async function scanFolder(
    folder: DiskFolder,
    options: {
        digest: Digest;
        yaml: YamlCodec;
        onProgress?: (done: number, total: number) => void;
        yieldNow?: () => Promise<void>;
        /**
         * Checked between files. A scan has written nothing, so stopping it is
         * always safe (spec 006 FR-003).
         */
        cancel?: CancelToken;
    }
): Promise<ScanResult> {
    const listing = await folder.list();
    const folders = new Map<RelPath, ScannedFolder>();
    const entries: ScannedEntry[] = [];
    const images: ScannedImage[] = [];
    const lines: ReportLine[] = [];
    folders.set('', { kind: 'folder', path: '', parentPath: null, name: '', record: null, diskHash: '' });

    const visible = listing.filter((entry) => !isIgnored(entry.path));
    for (const entry of visible) {
        if (entry.kind === 'directory') {
            folders.set(entry.path, {
                kind: 'folder',
                path: entry.path,
                parentPath: parentPath(entry.path),
                name: baseName(entry.path),
                record: null,
                diskHash: '',
            });
        }
    }
    const files = visible.filter((entry) => entry.kind === 'file');
    let done = 0;

    /**
     * Read + digest concurrently, then APPLY IN THE ORIGINAL ORDER (spec 006 R8).
     * Each file was previously read and hashed one after another — a full
     * round-trip per file. Results are collected into fixed slots so the
     * resulting entry/image/warning order is byte-for-byte what it was.
     */
    const loaded: Array<{ bytes: Uint8Array; hash: string } | { error: unknown } | null> =
        files.map(() => null);
    const READ_CONCURRENCY = 12;
    let cursor = 0;
    const readWorker = async (): Promise<void> => {
        while (cursor < files.length) {
            const at = cursor;
            cursor += 1;
            const file = files[at];
            if (!file) {
                continue;
            }
            const name = baseName(file.path);
            const { ext } = splitName(name);
            options.cancel?.throwIfCancelled();
            const wanted =
                name === FOLDER_RECORD_NAME ||
                ext.toLowerCase() === ENTRY_EXT ||
                isImageFileName(name);
            if (!wanted) {
                continue;
            }
            try {
                const bytes = await folder.readBytes(file.path);
                loaded[at] = { bytes, hash: await options.digest(bytes) };
            } catch (error) {
                loaded[at] = { error };
            }
            done += 1;
            options.onProgress?.(done, files.length);
            if (options.yieldNow && done % YIELD_EVERY === 0) {
                await options.yieldNow();
            }
            options.cancel?.throwIfCancelled();
        }
    };
    await Promise.all(
        Array.from({ length: Math.min(READ_CONCURRENCY, files.length) }, readWorker)
    );

    for (let at = 0; at < files.length; at += 1) {
        const file = files[at];
        if (!file) {
            continue;
        }
        const slot = loaded[at];
        if (slot && 'error' in slot) {
            const error = slot.error;
            lines.push({
                path: file.path,
                outcome: 'skipped',
                message:
                    error instanceof DecodeError
                        ? 'Unreadable: the file is not valid UTF-8 text.'
                        : `Unreadable: ${error instanceof Error ? error.message : String(error)}`,
            });
            continue;
        }
        const name = baseName(file.path);
        const dir = parentPath(file.path);
        const { stem, ext } = splitName(name);
        try {
            if (!slot) {
                lines.push({ path: file.path, outcome: 'skipped', message: 'Not a markdown or image file.' });
            } else if (name === FOLDER_RECORD_NAME) {
                const record = parseFolderRecord(decodeText(slot.bytes), options.yaml);
                const target = folders.get(dir);
                if (target) {
                    target.record = record;
                    target.diskHash = slot.hash;
                }
                record.warnings.forEach((message) => lines.push({ path: file.path, outcome: 'warning', message }));
            } else if (ext.toLowerCase() === ENTRY_EXT) {
                const model = parseEntryFile(decodeText(slot.bytes), stem, options.yaml);
                entries.push({
                    kind: 'entry',
                    path: file.path,
                    parentPath: dir,
                    stem,
                    diskHash: slot.hash,
                    model,
                });
                model.warnings.forEach((message) => lines.push({ path: file.path, outcome: 'warning', message }));
            } else {
                images.push({
                    kind: 'image',
                    path: file.path,
                    parentPath: dir,
                    fileName: name,
                    ext: ext.toLowerCase(),
                    diskHash: slot.hash,
                    bytes: slot.bytes,
                });
            }
        } catch (error) {
            const message =
                error instanceof DecodeError
                    ? 'Unreadable: the file is not valid UTF-8 text.'
                    : `Unreadable: ${error instanceof Error ? error.message : String(error)}`;
            lines.push({ path: file.path, outcome: 'skipped', message });
        }
    }
    return { folders, entries, images, lines };
}
