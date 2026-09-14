import type { NativeWorldInfoEntry } from '../../global';

/**
 * Persisted workspace schema (v1) — shape contract in
 * specs/003-core-workspace-mvp/contracts/persistence-schema.md; sync semantics in
 * specs/003-core-workspace-mvp/data-model.md. Pure module: no app imports. UUIDs
 * are injected by callers (the adapter passes app `uuidv4`) to keep this file pure.
 */

export const MODULE_NAMESPACE = 'WorldInfoWorkspace';
export const SCHEMA_VERSION = 1;
export const ROOT_ID = 'workspace-root';

export type NodeKind = 'folder' | 'entry' | 'image';
export type SortMode = 'custom' | 'title' | 'position' | 'depth' | 'order' | 'trigger';

export interface NodeBase {
    id: string;
    parentId: string | null;
    name: string;
    createdAt: string;
    updatedAt: string;
}

export interface OrphanedEntry {
    uid: number;
    name: string;
}

export interface BookBinding {
    /** The actual native book name — opaque handle assigned once (FR-023). */
    bookName: string;
    /** Native entries retained in the book whose entities moved out (FR-018). */
    orphans: OrphanedEntry[];
    /**
     * Uids of entries deleted from the workspace while their native copy
     * existed (FR-021): removal intent until the next push fulfills it —
     * prevents the auto-merge from resurrecting deleted entities.
     */
    tombstones?: number[];
}

/**
 * Per-book sync info. An entity can live in SEVERAL books at once (nested WI
 * roots — world intersection by design), so uid/hash/status are keyed by book
 * name. uid may be null until the first export assigns a free slot.
 */
export interface BookSync {
    uid: number | null;
    hash: string | null;
    status: 'in-sync' | 'dirty';
}

export interface SyncState {
    books: Record<string, BookSync>;
}

export interface FolderNode extends NodeBase {
    kind: 'folder';
    expanded: boolean;
    isWiRoot: boolean;
    book: BookBinding | null;
    children: TreeNode[];
}

export interface EntryNode extends NodeBase {
    kind: 'entry';
    native: NativeWorldInfoEntry;
    sync: SyncState;
}

export interface ImageNode extends NodeBase {
    kind: 'image';
    src: string;
    caption: string;
    sync: SyncState;
}

export type TreeNode = FolderNode | EntryNode | ImageNode;

export interface WorkspaceSettings {
    sortMode: SortMode;
}

export interface WorkspaceState {
    version: 1;
    root: FolderNode;
    settings: WorkspaceSettings;
    /** Set by migrate() when the persisted payload could not be restored. */
    _recovered?: unknown;
}

export function createDefaultNativeEntry(uid: number): NativeWorldInfoEntry {
    return {
        uid,
        key: [],
        keysecondary: [],
        comment: '',
        content: '',
        constant: false,
        vectorized: false,
        selective: true,
        selectiveLogic: 0,
        probability: 100,
        useProbability: true,
        disable: false,
        order: 100,
        position: 0,
        depth: 4,
        role: 0,
        outletName: '',
        ignoreBudget: false,
        excludeRecursion: false,
        preventRecursion: false,
        delayUntilRecursion: 0,
        matchPersonaDescription: false,
        matchCharacterDescription: false,
        matchCharacterPersonality: false,
        matchCharacterDepthPrompt: false,
        matchScenario: false,
        matchCreatorNotes: false,
        group: '',
        groupOverride: false,
        groupWeight: 100,
        scanDepth: null,
        caseSensitive: null,
        matchWholeWords: null,
        useGroupScoring: null,
        sticky: null,
        cooldown: null,
        delay: null,
        automationId: '',
        triggers: [],
        characterFilterNames: [],
        characterFilterTags: [],
        characterFilterExclude: false,
        addMemo: true,
        displayIndex: uid,
        extensions: {},
    };
}

/**
 * Fills MISSING native fields from the template defaults — additive only,
 * existing values are never touched (mirrors the app's
 * addMissingWorldInfoFields, world-info.js:2104). Books from other tools may
 * lack newer fields; without this, imported entries would fail validation on
 * fields the native app itself does not constrain.
 */
export function normalizeNativeEntry(entry: NativeWorldInfoEntry): NativeWorldInfoEntry {
    const template = createDefaultNativeEntry(0);
    const target = entry as unknown as Record<string, unknown>;
    const source = template as unknown as Record<string, unknown>;
    for (const key of Object.keys(source)) {
        if (target[key] === undefined) {
            target[key] = source[key];
        }
    }
    // The native app writes enum/range values it never constrains itself (a
    // stale editor select can persist NaN). Mirroring the app-at-load behavior:
    // repair values the native format does not allow, additively in spirit —
    // only on native-side data, never on workspace edits (those are surfaced
    // and publish-blocked per FR-010).
    if (!Number.isInteger(target['role']) || (target['role'] as number) < 0 || (target['role'] as number) > 2) {
        target['role'] = 0;
    }
    if (!Number.isInteger(target['position']) || (target['position'] as number) < 0 || (target['position'] as number) > 7) {
        target['position'] = 0;
    }
    if (!Number.isInteger(target['selectiveLogic']) || (target['selectiveLogic'] as number) < 0 || (target['selectiveLogic'] as number) > 3) {
        target['selectiveLogic'] = 0;
    }
    if (typeof target['probability'] !== 'number' || !Number.isFinite(target['probability'])) {
        target['probability'] = 100;
    }
    if (typeof target['depth'] !== 'number' || !Number.isFinite(target['depth']) || (target['depth'] as number) < 0) {
        target['depth'] = 4;
    }
    if (typeof target['order'] !== 'number' || !Number.isFinite(target['order'])) {
        target['order'] = 100;
    }
    if (!Array.isArray(target['key'])) {
        target['key'] = [];
    }
    if (!Array.isArray(target['keysecondary'])) {
        target['keysecondary'] = [];
    }
    if (!Array.isArray(target['triggers'])) {
        target['triggers'] = [];
    }
    return entry;
}

export function createDefaultSyncState(): SyncState {
    return { books: {} };
}

export function createDefaultState(newRootId: string = ROOT_ID): WorkspaceState {
    const now = new Date().toISOString();
    return {
        version: 1,
        root: {
            id: newRootId,
            parentId: null,
            kind: 'folder',
            name: 'Workspace',
            createdAt: now,
            updatedAt: now,
            expanded: true,
            isWiRoot: false,
            book: null,
            children: [],
        },
        settings: { sortMode: 'custom' },
    };
}

export function createFolderNode(input: {
    id: string;
    parentId: string;
    name: string;
    now: string;
}): FolderNode {
    return {
        id: input.id,
        parentId: input.parentId,
        kind: 'folder',
        name: input.name,
        createdAt: input.now,
        updatedAt: input.now,
        expanded: false,
        isWiRoot: false,
        book: null,
        children: [],
    };
}

export function createEntryNode(input: {
    id: string;
    parentId: string;
    name: string;
    now: string;
    nativeUid: number;
}): EntryNode {
    const native = createDefaultNativeEntry(input.nativeUid);
    native.comment = input.name;
    return {
        id: input.id,
        parentId: input.parentId,
        kind: 'entry',
        name: input.name,
        createdAt: input.now,
        updatedAt: input.now,
        native,
        sync: createDefaultSyncState(),
    };
}

export function createImageNode(input: {
    id: string;
    parentId: string;
    name: string;
    now: string;
}): ImageNode {
    return {
        id: input.id,
        parentId: input.parentId,
        kind: 'image',
        name: input.name,
        createdAt: input.now,
        updatedAt: input.now,
        src: '',
        caption: '',
        sync: createDefaultSyncState(),
    };
}

export function buildNodeIndex(root: TreeNode): Map<string, TreeNode> {
    const index = new Map<string, TreeNode>();
    const walk = (node: TreeNode): void => {
        index.set(node.id, node);
        if (node.kind === 'folder') {
            node.children.forEach(walk);
        }
    };
    walk(root);
    return index;
}

export function findNode(state: WorkspaceState, nodeId: string): TreeNode | undefined {
    if (nodeId === state.root.id) {
        return state.root;
    }
    return buildNodeIndex(state.root).get(nodeId);
}

export function isFolderNode(node: TreeNode | undefined): node is FolderNode {
    return node?.kind === 'folder';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

/**
 * Full invariant check per contracts/persistence-schema.md. Returns human-readable
 * violation messages; the state is never mutated by validation.
 */
export function deepValidateState(state: WorkspaceState): string[] {
    const issues: string[] = [];
    if (state.version !== 1) {
        issues.push(`state version ${String(state.version)} is not 1`);
        return issues;
    }
    if (state.root.parentId !== null || state.root.kind !== 'folder') {
        issues.push('root must be a folder with parentId null');
        return issues;
    }
    const seen = new Set<string>();
    const bookOwners = new Map<string, string>();
    const walk = (node: TreeNode, ancestors: Set<string>): void => {
        if (seen.has(node.id)) {
            issues.push(`${node.id}: duplicate id`);
            return;
        }
        seen.add(node.id);
        if (typeof node.name !== 'string' || node.name.trim() === '') {
            issues.push(`${node.id}: name must be a non-empty string`);
        }
        if (node.kind === 'folder') {
            checkBookInvariants(node, bookOwners, issues);
            const nextAncestors = new Set(ancestors);
            nextAncestors.add(node.id);
            node.children.forEach((child) => {
                if (child.parentId !== node.id) {
                    issues.push(`${child.id}: parent link does not point at ${node.id}`);
                }
                if (nextAncestors.has(child.id)) {
                    issues.push(`${child.id}: cycle detected`);
                    return;
                }
                walk(child, nextAncestors);
            });
        } else {
            checkSyncInvariants(node, issues);
        }
    };
    walk(state.root, new Set());
    return issues;
}

function checkBookInvariants(
    node: FolderNode,
    bookOwners: Map<string, string>,
    issues: string[]
): void {
    if (node.book !== null && !node.isWiRoot) {
        issues.push(`${node.id}: book binding present without root designation`);
    }
    if (node.book === null) {
        return;
    }
    if (node.book.bookName.trim() === '') {
        issues.push(`${node.id}: book binding has empty name`);
    }
    const owner = bookOwners.get(node.book.bookName);
    if (owner) {
        issues.push(`${node.id}: book name "${node.book.bookName}" already bound by ${owner}`);
    } else {
        bookOwners.set(node.book.bookName, node.id);
    }
    if (!Array.isArray(node.book.orphans)) {
        issues.push(`${node.id}: book orphans must be an array`);
    }
}

function checkSyncInvariants(node: EntryNode | ImageNode, issues: string[]): void {
    if (node.kind === 'entry') {
        if (!isRecord(node.native) || typeof (node.native as Record<string, unknown>).uid !== 'number') {
            issues.push(`${node.id}: entry native payload malformed`);
            return;
        }
    }
    if (!node.sync || typeof node.sync.books !== 'object' || node.sync.books === null) {
        issues.push(`${node.id}: sync state missing`);
        return;
    }

}

function bookShapeOk(book: unknown): boolean {
    return (
        isRecord(book) &&
        typeof book.bookName === 'string' &&
        book.bookName.trim() !== '' &&
        Array.isArray(book.orphans)
    );
}

/**
 * Structural, non-destructive validation for the persisted payload. Unknown keys
 * anywhere inside the namespace are preserved (the validated payload is returned
 * as-is). Missing sync blocks are repaired additively (defaults); any structural
 * violation routes the WHOLE payload to recovery — never a silent partial repair
 * (contract: recovery keeps the raw payload under `_recovered`).
 */
export function migrate(raw: unknown): WorkspaceState {
    const fallback = createDefaultState();
    if (!isRecord(raw) || raw.version !== SCHEMA_VERSION) {
        return recover(fallback, raw);
    }
    const candidate = raw as Record<string, unknown>;
    if (!isRecord(candidate.root) || !isRecord(candidate.settings)) {
        return recover(fallback, raw);
    }
    if (!subtreeShapeOk(candidate.root)) {
        return recover(fallback, raw);
    }
    const state = raw as unknown as WorkspaceState;
    repairMissingSync(state.root);
    const issues = deepValidateState(state);
    if (issues.length > 0) {
        return recover(createDefaultState(), raw);
    }
    // A leftover `_recovered` key from an earlier recovery is stale garbage: it
    // was surfaced in ITS session (one-session contract). Carrying it forward
    // would re-trigger the recovery warning on every reload.
    delete (state as { _recovered?: unknown })._recovered;
    return state;
}

function subtreeShapeOk(root: Record<string, unknown>): boolean {
    if (root.kind !== 'folder' || !Array.isArray(root.children)) {
        return false;
    }
    if (root.book !== undefined && root.book !== null && !bookShapeOk(root.book)) {
        return false;
    }
    const stack: unknown[] = [...root.children];
    while (stack.length > 0) {
        const current = stack.pop();
        if (!isRecord(current)) {
            return false;
        }
        const raw = current as Record<string, unknown>;
        if (typeof raw.id !== 'string' || raw.id === '') {
            return false;
        }
        if (typeof raw.name !== 'string' || raw.name.trim() === '') {
            return false;
        }
        if (raw.kind !== 'folder' && raw.kind !== 'entry' && raw.kind !== 'image') {
            return false;
        }
        if (raw.kind === 'folder') {
            if (raw.book !== undefined && raw.book !== null && !bookShapeOk(raw.book)) {
                return false;
            }
            if (!Array.isArray(raw.children)) {
                return false;
            }
            stack.push(...raw.children);
        }
        if (raw.kind === 'entry') {
            if (
                !isRecord(raw.native) ||
                typeof (raw.native as Record<string, unknown>).uid !== 'number'
            ) {
                return false;
            }
        }
    }
    return true;
}

function repairMissingSync(node: TreeNode): void {
    if (node.kind === 'folder') {
        node.children.forEach(repairMissingSync);
        return;
    }
    if (!isRecord(node.sync)) {
        node.sync = createDefaultSyncState();
    }
    if (node.kind === 'entry') {
        const sync = node.sync as unknown as Record<string, unknown>;
        // v1 → v2 migration: the single-book sync shape (bookName/uid/status/…)
        // becomes the per-book books map. Without this, legacy data failed
        // validation on EVERY reload and triggered recovery.
        if (sync['books'] === undefined || !isRecord(sync['books'])) {
            const legacyBook = typeof sync['bookName'] === 'string' ? sync['bookName'] : null;
            const legacyUid = typeof sync['uid'] === 'number' ? sync['uid'] : null;
            const legacyHash =
                typeof sync['lastExportedHash'] === 'string' ? sync['lastExportedHash'] : null;
            const legacyState = sync['status'];
            if (legacyBook !== null && legacyState !== 'orphaned') {
                // The orphan flow already recorded the row in the root binding;
                // the per-book slot starts empty (export happens after resolve).
                sync['books'] = {
                    [legacyBook]: {
                        uid: legacyUid,
                        hash: legacyHash,
                        status: legacyState === 'dirty' ? 'dirty' : 'in-sync',
                    },
                };
            } else {
                sync['books'] = {};
            }
            delete sync['bookName'];
            delete sync['uid'];
            delete sync['status'];
            delete sync['lastExportedHash'];
            delete sync['lastExportedAt'];
            delete sync['nativeDrift'];
        }
        // Heal entries persisted before import normalization existed: fill
        // missing native fields additively (same rule as import — research R1).
        normalizeNativeEntry(node.native);
    }
}

function recover(fallback: WorkspaceState, raw: unknown): WorkspaceState {
    fallback._recovered = raw;
    return fallback;
}