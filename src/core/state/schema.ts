import type { NativeWorldInfoEntry } from '../../global';
import {
    CONTEXT_HEADROOM_TOKENS,
    CONTEXT_TOKENS_RANGE,
    DEFAULT_ASSISTANT_SETTINGS,
    DEFAULT_CONTEXT_SETTINGS,
    RESPONSE_TOKENS_RANGE,
    type AssistantSettings,
    type ContextScope,
    type ContextSettings,
} from '../assistant/types';
import { fingerprintEntry } from '../sync/fingerprint';
import { buildNodeIndex } from './nodeIndex';

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

/**
 * Markdown round-trip extras (spec 004 FR-005): metadata a markdown file or folder
 * record carried that the convention does not own, kept so export writes it back.
 */
export interface NodeMarkdownExtras {
    /** Keys without the `wi_` prefix, in original order. */
    foreign?: Record<string, unknown>;
    /** Unrecognized `wi_*` keys (reported, preserved). */
    unknownOwned?: Record<string, unknown>;
    /** Imported from malformed front matter; the file is not rewritten until edited. */
    rawOnParseError?: boolean;
}

export interface NodeBase {
    id: string;
    parentId: string | null;
    name: string;
    createdAt: string;
    updatedAt: string;
    md?: NodeMarkdownExtras;
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
    /**
     * AI assistant settings (spec 005 FR-035). Optional and additive: payloads
     * written before spec 005 load unchanged, and `getAssistantSettings` fills
     * defaults. Conversations are NOT stored here (they live per device).
     */
    assistant?: AssistantSettings;
    /**
     * Region sizes (2026-09-22). Optional and additive; repaired field by field by
     * `getLayoutSettings` (core/state/layout.ts).
     */
    layout?: LayoutSettings;
}

export interface LayoutSettings {
    /** Structure tree width in px (desktop). */
    treeWidth: number;
    treeCollapsed: boolean;
    /** Assistant panel width in px (desktop). */
    assistantWidth: number;
    /** Markdown preview share of the content editor, in percent. */
    previewWidth: number;
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
        characterFilter: { isExclude: false, names: [], tags: [] },
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
    normalizeCharacterFilter(target);
    return entry;
}

const LEGACY_FILTER_KEYS = ['characterFilterNames', 'characterFilterTags', 'characterFilterExclude'] as const;

/**
 * The native app reads ONLY the `characterFilter` object (world-info.js). Early
 * workspace builds stored three flat keys instead, which never reached the app:
 * their values move into the object (when it has none) and the keys are removed.
 * A malformed object is reset like the app does on load.
 */
function normalizeCharacterFilter(target: Record<string, unknown>): void {
    const stringList = (value: unknown): string[] =>
        Array.isArray(value)
            ? value
                  .filter((item) => typeof item === 'string' || typeof item === 'number')
                  .map((item) => String(item))
            : [];
    const raw = target['characterFilter'];
    const filter =
        typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const normalized = {
        isExclude: filter['isExclude'] === true,
        names: stringList(filter['names']),
        tags: stringList(filter['tags']),
    };
    const hasLegacy = LEGACY_FILTER_KEYS.some((key) => key in target);
    if (hasLegacy && normalized.names.length === 0 && normalized.tags.length === 0 && !normalized.isExclude) {
        normalized.names = stringList(target['characterFilterNames']);
        normalized.tags = stringList(target['characterFilterTags']);
        normalized.isExclude = target['characterFilterExclude'] === true;
    }
    LEGACY_FILTER_KEYS.forEach((key) => delete target[key]);
    target['characterFilter'] = normalized;
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

function repairInt(value: unknown, fallbackValue: number, min: number, max: number): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
        return fallbackValue;
    }
    return value;
}

function repairScope(value: unknown): ContextScope {
    if (!isRecord(value)) {
        return DEFAULT_CONTEXT_SETTINGS.scope;
    }
    if (value.kind === 'workspace' || value.kind === 'selection') {
        return { kind: value.kind };
    }
    if (value.kind === 'folders' && Array.isArray(value.folderIds)) {
        return {
            kind: 'folders',
            folderIds: value.folderIds.filter((id): id is string => typeof id === 'string'),
        };
    }
    return DEFAULT_CONTEXT_SETTINGS.scope;
}

function repairContextSettings(value: unknown): ContextSettings {
    const raw = isRecord(value) ? value : {};
    const bool = (key: keyof ContextSettings, fallbackValue: boolean): boolean =>
        typeof raw[key] === 'boolean' ? (raw[key] as boolean) : fallbackValue;
    return {
        scope: repairScope(raw.scope),
        entryContents: raw.entryContents === 'all' ? 'all' : DEFAULT_CONTEXT_SETTINGS.entryContents,
        chatMessages: repairInt(raw.chatMessages, DEFAULT_CONTEXT_SETTINGS.chatMessages, 0, 200),
        characterCard: bool('characterCard', DEFAULT_CONTEXT_SETTINGS.characterCard),
        persona: bool('persona', DEFAULT_CONTEXT_SETTINGS.persona),
        activatedEntries: bool('activatedEntries', DEFAULT_CONTEXT_SETTINGS.activatedEntries),
    };
}

/**
 * Assistant settings with every field repaired to a usable value (spec 005
 * data-model): a stale or hand-edited payload can never break the panel.
 */
export function getAssistantSettings(state: WorkspaceState): AssistantSettings {
    const raw: unknown = state.settings.assistant;
    const record = isRecord(raw) ? raw : {};
    const responseTokens = repairInt(
        record.responseTokens,
        DEFAULT_ASSISTANT_SETTINGS.responseTokens,
        RESPONSE_TOKENS_RANGE.min,
        RESPONSE_TOKENS_RANGE.max
    );
    let contextTokens = repairInt(
        record.contextTokens,
        DEFAULT_ASSISTANT_SETTINGS.contextTokens,
        CONTEXT_TOKENS_RANGE.min,
        CONTEXT_TOKENS_RANGE.max
    );
    if (contextTokens < responseTokens + CONTEXT_HEADROOM_TOKENS) {
        contextTokens = DEFAULT_ASSISTANT_SETTINGS.contextTokens;
    }
    return {
        profileId: typeof record.profileId === 'string' ? record.profileId : null,
        responseTokens,
        contextTokens,
        instructions:
            typeof record.instructions === 'string' && record.instructions.trim() !== ''
                ? record.instructions
                : null,
        defaultContext: repairContextSettings(record.defaultContext),
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

export { buildNodeIndex };

/**
 * Resolves a node by id with a fresh walk.
 *
 * Deliberately NOT backed by the identity-keyed cache in `nodeIndex.ts`: several
 * call sites (notably `core/md/applyPull.ts`) mutate a state's tree IN PLACE and
 * then look ids up on that same object, where a root-keyed cache would serve a
 * stale index — a node added during the pass would not be found and its change
 * would be silently skipped. Callers that know their state is immutable during a
 * hot loop opt into `getNodeIndex` explicitly instead.
 */
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
    relinkParents(state.root);
    repairMissingSync(state.root);
    const issues = deepValidateState(state);
    if (issues.length > 0) {
        return recover(createDefaultState(), raw);
    }
    // A `_recovered` key carried by a VALID payload is the backup of an earlier
    // recovery. It is kept until the user restores or discards it: stripping it
    // here silently destroyed the only copy of the lost workspace.
    return state;
}

/**
 * True when `migrate` had to recover THIS payload (as opposed to loading a valid
 * payload that still carries an older backup). A valid payload is returned by
 * reference; a recovery always returns a fresh fallback. An absent payload
 * (first run) has nothing to lose and is not a recovery.
 */
export function isFreshRecovery(raw: unknown, state: WorkspaceState): boolean {
    return raw !== undefined && state !== raw;
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

/**
 * `parentId` is a denormalized copy of the nesting, which is the source of
 * truth: a stale link is rewritten, never a reason for recovery. (Real bug: the
 * demo seed grafted children still pointing at the demo's own root id, so every
 * reload of a seeded workspace failed validation and wiped it.)
 */
function relinkParents(root: FolderNode): void {
    root.parentId = null;
    const stack: FolderNode[] = [root];
    while (stack.length > 0) {
        const folder = stack.pop()!;
        for (const child of folder.children) {
            child.parentId = folder.id;
            if (child.kind === 'folder') {
                stack.push(child);
            }
        }
    }
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
        // Hashes that described the pre-normalization entry are carried over,
        // so a pure shape repair never reads as a native change or a conflict.
        const before = fingerprintEntry(node.native);
        normalizeNativeEntry(node.native);
        const after = fingerprintEntry(node.native);
        if (after !== before) {
            for (const bookSync of Object.values(node.sync.books)) {
                if (bookSync.hash === before) {
                    bookSync.hash = after;
                }
            }
        }
    }
}

function recover(fallback: WorkspaceState, raw: unknown): WorkspaceState {
    fallback._recovered = raw;
    return fallback;
}