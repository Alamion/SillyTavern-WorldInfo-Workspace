import { buildNodeIndex, createEntryNode, type TreeNode, type WorkspaceState } from '../state/schema';
import { renderEntryFile } from './convention';
import { planFolderTree } from './exportPlan';
import { hashText } from './hash';
import { FOLDER_RECORD_NAME, splitName } from './naming';
import { baseName, type BaselineItem, type Digest, type MdItemKind, type RelPath, type YamlCodec } from './ports';
import { NO_RECORD, type DiskItem, type WsItem } from './reconcile';
import type { ScanResult } from './scan';

/**
 * Link-side renderings (spec 004 US3): the whole workspace as items with
 * canonical hashes, and the disk scan as comparable items. Pure apart from the
 * injected digest and image byte resolver.
 */

export interface WsRenderItem extends WsItem {
    /** Entry file text or folder record text (null: folder without record). */
    text: string | null;
    /** Image source (bytes resolved by the caller). */
    src?: string;
}

export interface WorkspaceRender {
    items: Map<string, WsRenderItem>;
    urlOnlyImageIds: string[];
}

export type ImageBytesHash = (src: string) => Promise<string | null>;

export function baselinePaths(baseline: Readonly<Record<string, BaselineItem>>): Map<string, RelPath> {
    const paths = new Map<string, RelPath>();
    for (const item of Object.values(baseline)) {
        if (item.path !== null) {
            paths.set(item.id, item.path);
        }
    }
    return paths;
}

/**
 * Memo of entry renderings, keyed by the entry NODE (spec 006 R8).
 *
 * The key used to be `stableStringify([stem, name, native, md])` — a full
 * serialization of every entry just to look one up, so the cache cost what it
 * saved. Structural sharing keeps unedited entries reference-identical, so the
 * node itself is a correct key: an edit produces a new node and misses. A
 * WeakMap needs no size cap, since entries die with their state version.
 */
export type EntryRenderCache = WeakMap<TreeNode, { stem: string; text: string; hash: string }>;

/** Runs `task` over `items` with at most `limit` in flight. */
async function mapWithConcurrency<T>(
    items: readonly T[],
    limit: number,
    task: (item: T) => Promise<void>
): Promise<void> {
    let next = 0;
    const workers: Promise<void>[] = [];
    const run = async (): Promise<void> => {
        while (next < items.length) {
            const item = items[next];
            next += 1;
            if (item !== undefined) {
                await task(item);
            }
        }
    };
    for (let index = 0; index < Math.min(limit, items.length); index += 1) {
        workers.push(run());
    }
    await Promise.all(workers);
}

export async function renderWorkspace(input: {
    state: WorkspaceState;
    baseline: Readonly<Record<string, BaselineItem>>;
    yaml: YamlCodec;
    digest: Digest;
    imageHash: ImageBytesHash;
    /** Memo of entry renderings (auto-push renders on every typing pause). */
    entryCache?: EntryRenderCache;
}): Promise<WorkspaceRender> {
    const { state } = input;
    const plan = planFolderTree(state.root, '', true, input.yaml, baselinePaths(input.baseline));
    const index = buildNodeIndex(state.root);
    const items = new Map<string, WsRenderItem>();
    const recordByFolder = new Map<string, string>();
    for (const file of plan.files) {
        if (file.kind === 'record') {
            recordByFolder.set(file.nodeId, file.text);
        }
    }
    // Hashing is a WebCrypto round-trip per item; doing them one after another
    // meant up to 2000 sequential awaits per push (spec 006 R8).
    await mapWithConcurrency([...plan.paths], 12, async ([id, path]) => {
        const node = index.get(id);
        if (!node) {
            return;
        }
        const base = { id, kind: node.kind as MdItemKind, path, parentId: node.parentId, name: node.name };
        if (node.kind === 'folder') {
            const text = recordByFolder.get(id) ?? null;
            items.set(id, {
                ...base,
                text,
                hash: text === null ? NO_RECORD : await hashText(text, input.digest),
            });
            return;
        }
        if (node.kind === 'entry') {
            const stem = splitName(baseName(path)).stem;
            const cached = input.entryCache?.get(node);
            if (cached && cached.stem === stem) {
                items.set(id, { ...base, text: cached.text, hash: cached.hash });
                return;
            }
            const text = renderEntryFile(node, stem, input.yaml);
            const fresh = { stem, text, hash: await hashText(text, input.digest) };
            input.entryCache?.set(node, fresh);
            items.set(id, { ...base, text: fresh.text, hash: fresh.hash });
            return;
        }
        const hash = await input.imageHash(node.src);
        items.set(id, { ...base, text: null, src: node.src, hash: hash ?? `unresolved:${node.src}` });
    });
    return { items, urlOnlyImageIds: plan.urlOnlyImageIds };
}

/** Disk items comparable with the workspace render (canonical entry hashes). */
export async function describeDisk(input: {
    scan: ScanResult;
    yaml: YamlCodec;
    digest: Digest;
}): Promise<Map<RelPath, DiskItem>> {
    const items = new Map<RelPath, DiskItem>();
    for (const folder of input.scan.folders.values()) {
        const hash = folder.diskHash === '' ? NO_RECORD : folder.diskHash;
        items.set(folder.path, {
            kind: 'folder',
            path: folder.path,
            hash,
            canonHash: hash,
            name: folder.record?.title ?? folder.name,
            idHint: folder.record?.idHint,
        });
    }
    for (const entry of input.scan.entries) {
        const probe = createEntryNode({ id: 'probe', parentId: 'probe', name: entry.model.title, now: '', nativeUid: 0 });
        probe.native = entry.model.native;
        probe.md = entry.model.md;
        const canonical = renderEntryFile(probe, entry.stem, input.yaml);
        items.set(entry.path, {
            kind: 'entry',
            path: entry.path,
            hash: entry.diskHash,
            canonHash: await hashText(canonical, input.digest),
            name: entry.model.title,
            idHint: entry.model.idHint,
        });
    }
    for (const image of input.scan.images) {
        const record = input.scan.folders.get(image.parentPath)?.record?.images.get(image.fileName);
        items.set(image.path, {
            kind: 'image',
            path: image.path,
            hash: image.diskHash,
            canonHash: image.diskHash,
            name: record?.title ?? splitName(image.fileName).stem,
        });
    }
    return items;
}

export function recordPath(folderPath: RelPath): RelPath {
    return folderPath === '' ? FOLDER_RECORD_NAME : `${folderPath}/${FOLDER_RECORD_NAME}`;
}

export function kindOf(node: TreeNode): MdItemKind {
    return node.kind;
}
