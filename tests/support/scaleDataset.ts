import {
    createDefaultState,
    createEntryNode,
    createFolderNode,
    createImageNode,
    type EntryNode,
    type FolderNode,
    type TreeNode,
    type WorkspaceState,
} from '../../src/core/state/schema';

/**
 * Seeded, deterministic scale dataset for the perf budgets (spec 006,
 * contracts/performance-budgets.md). Test-only: never shipped, never user-facing —
 * the Aldermeer demo dataset stays the user-facing sample.
 *
 * The same options always produce a byte-identical state, so budgets measured on
 * different runs (and before/after a refactor) are comparable.
 */

export interface ScaleDatasetOptions {
    /** Entries inside the primary World Info root book. */
    primaryEntries?: number;
    /** Entries inside a second, smaller book (exercises multi-book paths). */
    secondaryEntries?: number;
    /** Plain folders/notes outside any book, to reach the node target. */
    looseNodes?: number;
    /** Nesting depth of the generated folder chains. */
    depth?: number;
    /** Average content length in characters. */
    contentChars?: number;
    seed?: number;
}

export interface ScaleDataset {
    state: WorkspaceState;
    primaryBookName: string;
    secondaryBookName: string;
    /** Ids of every entry in the primary book, in creation order. */
    primaryEntryIds: string[];
    nodeCount: number;
}

const DEFAULTS: Required<ScaleDatasetOptions> = {
    primaryEntries: 1000,
    secondaryEntries: 200,
    looseNodes: 800,
    depth: 5,
    contentChars: 600,
    seed: 20260922,
};

/** Mulberry32 — small, fast, fully deterministic from a 32-bit seed. */
function makeRandom(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const WORDS = [
    'aldermeer', 'harbor', 'ledger', 'salt', 'oath', 'lantern', 'quay', 'tide',
    'guild', 'cipher', 'marsh', 'relic', 'warden', 'ember', 'hollow', 'compact',
    'silt', 'beacon', 'anchor', 'verdict', 'reef', 'clerk', 'mantle', 'bell',
];

function makeText(rand: () => number, chars: number): string {
    const parts: string[] = [];
    let length = 0;
    while (length < chars) {
        const word = WORDS[Math.floor(rand() * WORDS.length)] ?? 'lore';
        parts.push(word);
        length += word.length + 1;
        if (parts.length % 12 === 0) {
            parts.push('\n\n');
        }
    }
    return parts.join(' ').trim();
}

/**
 * Builds the dataset. Ids are sequential and stable (`sc-<n>`) so a test can
 * address a specific node without walking the tree.
 */
export function buildScaleDataset(options: ScaleDatasetOptions = {}): ScaleDataset {
    const config = { ...DEFAULTS, ...options };
    const rand = makeRandom(config.seed);
    const now = '2026-09-22T00:00:00.000Z';
    const state = createDefaultState('sc-root');
    // createDefaultState stamps the current time; pin it so the dataset is
    // byte-identical across runs (budgets must be comparable).
    state.root.createdAt = now;
    state.root.updatedAt = now;
    state.root.expanded = true;

    let counter = 0;
    const nextId = (): string => `sc-${++counter}`;
    let nodeCount = 1; // the root itself

    const attach = (parent: FolderNode, node: TreeNode): void => {
        parent.children.push(node);
        nodeCount += 1;
    };

    /** Creates a chain of nested folders and returns the deepest one. */
    const makeChain = (parent: FolderNode, levels: number, label: string): FolderNode => {
        let current = parent;
        for (let level = 0; level < levels; level += 1) {
            const folder = createFolderNode({
                id: nextId(),
                parentId: current.id,
                name: `${label} ${level + 1}`,
                now,
            });
            folder.expanded = true;
            attach(current, folder);
            current = folder;
        }
        return current;
    };

    const fillBook = (bookName: string, count: number, label: string): string[] => {
        const rootFolder = createFolderNode({
            id: nextId(),
            parentId: state.root.id,
            name: label,
            now,
        });
        rootFolder.expanded = true;
        rootFolder.isWiRoot = true;
        rootFolder.book = { bookName, orphans: [] };
        attach(state.root, rootFolder);

        const ids: string[] = [];
        // Spread entries over nested subfolders so ancestor walks are realistic.
        const perFolder = Math.max(1, Math.ceil(count / Math.max(1, config.depth * 4)));
        let target = rootFolder;
        for (let index = 0; index < count; index += 1) {
            if (index % perFolder === 0) {
                target = makeChain(rootFolder, Math.max(1, config.depth - 2), `${label} sub`);
            }
            const entry = createEntryNode({
                id: nextId(),
                parentId: target.id,
                name: `${label} entry ${index + 1}`,
                now,
                nativeUid: index,
            });
            entry.native.content = makeText(rand, config.contentChars);
            entry.native.key = [
                WORDS[Math.floor(rand() * WORDS.length)] ?? 'lore',
                `${label.toLowerCase()}-${index}`,
            ];
            entry.sync.books[bookName] = { uid: index, hash: null, status: 'dirty' };
            attach(target, entry);
            ids.push(entry.id);
        }
        return ids;
    };

    const primaryBookName = 'Scale Primary';
    const secondaryBookName = 'Scale Secondary';
    const primaryEntryIds = fillBook(primaryBookName, config.primaryEntries, 'Primary');
    fillBook(secondaryBookName, config.secondaryEntries, 'Secondary');

    // Loose folders, notes and images outside any book.
    const looseRoot = createFolderNode({
        id: nextId(),
        parentId: state.root.id,
        name: 'Notes',
        now,
    });
    looseRoot.expanded = true;
    attach(state.root, looseRoot);
    let looseTarget = looseRoot;
    for (let index = 0; index < config.looseNodes; index += 1) {
        if (index % 40 === 0) {
            looseTarget = makeChain(looseRoot, Math.max(1, config.depth - 3), 'Notes sub');
        }
        if (index % 10 === 9) {
            const image = createImageNode({
                id: nextId(),
                parentId: looseTarget.id,
                name: `Image ${index + 1}`,
                now,
            });
            image.src = `img:sc-${index}`;
            image.caption = makeText(rand, 40);
            attach(looseTarget, image);
            continue;
        }
        const note = createEntryNode({
            id: nextId(),
            parentId: looseTarget.id,
            name: `Note ${index + 1}`,
            now,
            nativeUid: index,
        });
        note.native.content = makeText(rand, Math.floor(config.contentChars / 2));
        attach(looseTarget, note);
    }

    return { state, primaryBookName, secondaryBookName, primaryEntryIds, nodeCount };
}

/** Reads an id at a position, failing loudly instead of yielding undefined. */
export function idAt(ids: readonly string[], index: number): string {
    const id = ids[index];
    if (id === undefined) {
        throw new Error(`no id at index ${index}`);
    }
    return id;
}

/** Collects every node of a state (test helper for assertions over the whole tree). */
export function collectNodes(node: TreeNode, out: TreeNode[] = []): TreeNode[] {
    out.push(node);
    if (node.kind === 'folder') {
        for (const child of node.children) {
            collectNodes(child, out);
        }
    }
    return out;
}

/** Finds the first entry node in a state (test helper). */
export function firstEntry(state: WorkspaceState): EntryNode {
    const found = collectNodes(state.root).find((node): node is EntryNode => node.kind === 'entry');
    if (!found) {
        throw new Error('dataset has no entry');
    }
    return found;
}
