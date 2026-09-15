import { createHash } from 'node:crypto';
import YAML from 'yaml';
import {
    DiskError,
    assertRelPath,
    parentPath,
    type DiskEntryInfo,
    type DiskErrorCode,
    type DiskFolder,
    type Digest,
    type ImageStorePort,
    type RelPath,
    type YamlCodec,
} from '../../src/core/md/ports';

/**
 * In-memory DiskFolder (contracts/disk-port.md) with fault injection. Shared by
 * the port contract suite and the markdown unit/integration tests.
 */
export class MemoryDiskFolder implements DiskFolder {
    private files = new Map<RelPath, Uint8Array>();
    private dirs = new Set<RelPath>();
    private writeCount = 0;
    private removeCount = 0;
    private failWriteAt: { n: number; code: DiskErrorCode } | null = null;
    private failRemoveAt: number | null = null;
    writes: RelPath[] = [];
    removals: RelPath[] = [];

    failOnWrite(n: number, code: DiskErrorCode = 'io'): void {
        this.writeCount = 0;
        this.failWriteAt = { n, code };
    }

    failOnRemove(n: number): void {
        this.removeCount = 0;
        this.failRemoveAt = n;
    }

    clearFaults(): void {
        this.failWriteAt = null;
        this.failRemoveAt = null;
    }

    resetLog(): void {
        this.writes = [];
        this.removals = [];
    }

    async list(): Promise<DiskEntryInfo[]> {
        const result: DiskEntryInfo[] = [];
        for (const dir of [...this.dirs].sort()) {
            result.push({ path: dir, kind: 'directory' });
        }
        for (const file of [...this.files.keys()].sort()) {
            result.push({ path: file, kind: 'file' });
        }
        return result;
    }

    async readBytes(path: RelPath): Promise<Uint8Array> {
        assertRelPath(path);
        const data = this.files.get(path);
        if (!data) {
            throw new DiskError('not-found', path);
        }
        return new Uint8Array(data);
    }

    async writeBytes(path: RelPath, data: Uint8Array): Promise<void> {
        assertRelPath(path);
        this.writeCount += 1;
        if (this.failWriteAt && this.writeCount === this.failWriteAt.n) {
            throw new DiskError(this.failWriteAt.code, path, 'injected write failure');
        }
        this.ensureDirs(parentPath(path));
        this.files.set(path, new Uint8Array(data));
        this.writes.push(path);
    }

    async remove(path: RelPath): Promise<void> {
        assertRelPath(path);
        this.removeCount += 1;
        if (this.failRemoveAt !== null && this.removeCount === this.failRemoveAt) {
            throw new DiskError('io', path, 'injected remove failure');
        }
        const prefix = `${path}/`;
        for (const file of [...this.files.keys()]) {
            if (file === path || file.startsWith(prefix)) {
                this.files.delete(file);
            }
        }
        for (const dir of [...this.dirs]) {
            if (dir === path || dir.startsWith(prefix)) {
                this.dirs.delete(dir);
            }
        }
        this.removals.push(path);
    }

    async createDirectory(path: RelPath): Promise<void> {
        assertRelPath(path);
        this.ensureDirs(path);
    }

    /** Test helpers (not part of the port). */
    writeText(path: RelPath, text: string): void {
        this.ensureDirs(parentPath(path));
        this.files.set(path, new TextEncoder().encode(text));
    }

    readText(path: RelPath): string | undefined {
        const data = this.files.get(path);
        return data ? new TextDecoder().decode(data) : undefined;
    }

    has(path: RelPath): boolean {
        return this.files.has(path) || this.dirs.has(path);
    }

    filePaths(): RelPath[] {
        return [...this.files.keys()].sort();
    }

    snapshot(): Record<RelPath, string> {
        const result: Record<RelPath, string> = {};
        for (const [path, data] of [...this.files.entries()].sort(([a], [b]) => a.localeCompare(b))) {
            result[path] = createHash('sha256').update(data).digest('hex');
        }
        return result;
    }

    private ensureDirs(dir: RelPath): void {
        if (dir === '') {
            return;
        }
        const segments = dir.split('/');
        for (let i = 1; i <= segments.length; i++) {
            this.dirs.add(segments.slice(0, i).join('/'));
        }
    }
}

export const nodeDigest: Digest = async (bytes) => createHash('sha256').update(bytes).digest('hex');

export const nodeYaml: YamlCodec = {
    parse: (text) => YAML.parse(text) as unknown,
    stringify: (value) => YAML.stringify(value, { lineWidth: 0 }),
};

export const IMAGE_STORE_PREFIX = 'user/images/WorldInfoWorkspace/';

export class MemoryImageStore implements ImageStorePort {
    stored = new Map<string, Uint8Array>();
    uploads: string[] = [];
    removals: string[] = [];
    private counter = 0;

    async upload(input: { bytes: Uint8Array; ext: string; stem: string }): Promise<string> {
        this.counter += 1;
        const src = `${IMAGE_STORE_PREFIX}${input.stem}-${this.counter}.${input.ext}`;
        this.stored.set(src, new Uint8Array(input.bytes));
        this.uploads.push(src);
        return src;
    }

    async remove(src: string): Promise<void> {
        this.stored.delete(src);
        this.removals.push(src);
    }

    isOwned(src: string): boolean {
        return src.startsWith(IMAGE_STORE_PREFIX);
    }

    accepts(ext: string): boolean {
        return ['bmp', 'png', 'jpg', 'jpeg', 'jfif', 'gif', 'webp'].includes(ext.toLowerCase());
    }
}
