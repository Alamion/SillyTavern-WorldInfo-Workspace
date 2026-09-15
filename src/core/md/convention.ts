import type { NativeWorldInfoEntry } from '../../global';
import { stableStringify } from '../sync/fingerprint';
import {
    createDefaultNativeEntry,
    type EntryNode,
    type FolderNode,
    type ImageNode,
    type NodeMarkdownExtras,
} from '../state/schema';
import { compareDiskNames, splitName } from './naming';
import type { YamlCodec } from './ports';

/**
 * Markdown convention v1 (contracts/markdown-convention.md). Pure render/parse of
 * entry files and folder records. Minimal-metadata principle (FR-023): nothing
 * equal to its default is written, ids are never written, and a folder record is
 * rendered only when it carries non-default information.
 */

export const OWNED_PREFIX = 'wi_';

type FieldType = 'boolean' | 'number' | 'string' | 'list' | 'nullable-number' | 'nullable-boolean' | 'number-or-boolean' | 'enum' | 'object' | 'filter';

export interface FieldSpec {
    key: string;
    field: keyof NativeWorldInfoEntry;
    type: FieldType;
    description: string;
    enumNames?: readonly string[];
    invert?: boolean;
}

export const POSITION_NAMES = ['before_char', 'after_char', 'an_top', 'an_bottom', 'at_depth', 'em_top', 'em_bottom', 'outlet'] as const;
export const ROLE_NAMES = ['system', 'user', 'assistant'] as const;
export const LOGIC_NAMES = ['and_any', 'not_all', 'not_any', 'and_all'] as const;

/** Single source for render, parse, and the in-workspace mapping reference (FR-018). */
export const FIELD_SPECS: readonly FieldSpec[] = [
    { key: 'wi_keys', field: 'key', type: 'list', description: 'Primary keywords' },
    { key: 'wi_secondary_keys', field: 'keysecondary', type: 'list', description: 'Secondary keywords' },
    { key: 'wi_selective', field: 'selective', type: 'boolean', description: 'Use secondary keywords' },
    { key: 'wi_selective_logic', field: 'selectiveLogic', type: 'enum', enumNames: LOGIC_NAMES, description: 'Secondary keyword logic' },
    { key: 'wi_enabled', field: 'disable', type: 'boolean', invert: true, description: 'Entry enabled' },
    { key: 'wi_constant', field: 'constant', type: 'boolean', description: 'Always active' },
    { key: 'wi_vectorized', field: 'vectorized', type: 'boolean', description: 'Vector-matched' },
    { key: 'wi_order', field: 'order', type: 'number', description: 'Insertion order' },
    { key: 'wi_position', field: 'position', type: 'enum', enumNames: POSITION_NAMES, description: 'Insertion position' },
    { key: 'wi_depth', field: 'depth', type: 'number', description: 'Depth (at_depth position)' },
    { key: 'wi_role', field: 'role', type: 'enum', enumNames: ROLE_NAMES, description: 'Message role (at_depth position)' },
    { key: 'wi_outlet_name', field: 'outletName', type: 'string', description: 'Outlet name (outlet position)' },
    { key: 'wi_probability', field: 'probability', type: 'number', description: 'Trigger probability 0–100' },
    { key: 'wi_use_probability', field: 'useProbability', type: 'boolean', description: 'Use probability' },
    { key: 'wi_ignore_budget', field: 'ignoreBudget', type: 'boolean', description: 'Ignore token budget' },
    { key: 'wi_exclude_recursion', field: 'excludeRecursion', type: 'boolean', description: 'Non-recursable' },
    { key: 'wi_prevent_recursion', field: 'preventRecursion', type: 'boolean', description: 'Prevent further recursion' },
    { key: 'wi_delay_until_recursion', field: 'delayUntilRecursion', type: 'number-or-boolean', description: 'Delay until recursion (level)' },
    { key: 'wi_match_persona_description', field: 'matchPersonaDescription', type: 'boolean', description: 'Match persona description' },
    { key: 'wi_match_character_description', field: 'matchCharacterDescription', type: 'boolean', description: 'Match character description' },
    { key: 'wi_match_character_personality', field: 'matchCharacterPersonality', type: 'boolean', description: 'Match character personality' },
    { key: 'wi_match_character_depth_prompt', field: 'matchCharacterDepthPrompt', type: 'boolean', description: "Match character's depth prompt" },
    { key: 'wi_match_scenario', field: 'matchScenario', type: 'boolean', description: 'Match scenario' },
    { key: 'wi_match_creator_notes', field: 'matchCreatorNotes', type: 'boolean', description: "Match creator's notes" },
    { key: 'wi_group', field: 'group', type: 'string', description: 'Inclusion group(s)' },
    { key: 'wi_group_override', field: 'groupOverride', type: 'boolean', description: 'Prioritize in group' },
    { key: 'wi_group_weight', field: 'groupWeight', type: 'number', description: 'Group weight' },
    { key: 'wi_scan_depth', field: 'scanDepth', type: 'nullable-number', description: 'Scan depth (null = global)' },
    { key: 'wi_case_sensitive', field: 'caseSensitive', type: 'nullable-boolean', description: 'Case-sensitive (null = global)' },
    { key: 'wi_match_whole_words', field: 'matchWholeWords', type: 'nullable-boolean', description: 'Match whole words (null = global)' },
    { key: 'wi_use_group_scoring', field: 'useGroupScoring', type: 'nullable-boolean', description: 'Group scoring (null = global)' },
    { key: 'wi_sticky', field: 'sticky', type: 'nullable-number', description: 'Sticky turns' },
    { key: 'wi_cooldown', field: 'cooldown', type: 'nullable-number', description: 'Cooldown turns' },
    { key: 'wi_delay', field: 'delay', type: 'nullable-number', description: 'Delay turns' },
    { key: 'wi_automation_id', field: 'automationId', type: 'string', description: 'Automation id' },
    { key: 'wi_triggers', field: 'triggers', type: 'list', description: 'Generation types that trigger the entry' },
    { key: 'wi_character_filter', field: 'characterFilter', type: 'filter', description: '{ exclude, names, tags }' },
    { key: 'wi_add_memo', field: 'addMemo', type: 'boolean', description: 'Show memo as title' },
    { key: 'wi_extensions', field: 'extensions', type: 'object', description: 'Native extension data (verbatim)' },
];

/** Native fields never written: per-book state and fields carried by name/body. */
const NOT_WRITTEN: ReadonlySet<string> = new Set(['uid', 'displayIndex', 'comment', 'content']);

const SPEC_BY_KEY = new Map(FIELD_SPECS.map((spec) => [spec.key, spec]));
const MAPPED_FIELDS: ReadonlySet<string> = new Set(FIELD_SPECS.map((spec) => spec.field as string));

export const TITLE_KEY = 'wi_title';
export const ID_KEY = 'wi_id';
export const NATIVE_KEY = 'wi_native';

export interface EntryFileModel {
    title: string;
    native: NativeWorldInfoEntry;
    md: NodeMarkdownExtras | undefined;
    idHint: string | undefined;
    warnings: string[];
}

export interface FolderRecordImage {
    title?: string;
    caption?: string;
    src?: string;
}

export interface FolderRecordModel {
    title: string | undefined;
    root: boolean;
    book: string | undefined;
    order: string[] | undefined;
    images: Map<string, FolderRecordImage>;
    idHint: string | undefined;
    md: NodeMarkdownExtras | undefined;
    warnings: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sameValue(a: unknown, b: unknown): boolean {
    return stableStringify(a) === stableStringify(b);
}

function hasKeys(record: Record<string, unknown> | undefined): record is Record<string, unknown> {
    return record !== undefined && Object.keys(record).length > 0;
}

function renderField(spec: FieldSpec, value: unknown): unknown {
    if (spec.invert && typeof value === 'boolean') {
        return !value;
    }
    if (spec.type === 'enum' && typeof value === 'number' && spec.enumNames?.[value] !== undefined) {
        return spec.enumNames[value];
    }
    if (spec.type === 'filter' && isPlainObject(value)) {
        return { exclude: value['isExclude'] === true, names: value['names'] ?? [], tags: value['tags'] ?? [] };
    }
    return value;
}

function parseField(spec: FieldSpec, value: unknown): unknown {
    if (spec.invert && typeof value === 'boolean') {
        return !value;
    }
    if (spec.type === 'enum' && typeof value === 'string') {
        const at = spec.enumNames?.indexOf(value) ?? -1;
        // Unknown names are kept as given and surfaced by validation (FR-009).
        return at >= 0 ? at : value;
    }
    if (spec.type === 'filter' && isPlainObject(value)) {
        return {
            isExclude: value['exclude'] === true,
            names: Array.isArray(value['names']) ? value['names'].map(String) : [],
            tags: Array.isArray(value['tags']) ? value['tags'].map(String) : [],
        };
    }
    if (spec.type === 'list' && (typeof value === 'string' || typeof value === 'number')) {
        return [String(value)];
    }
    if (spec.type === 'list' && Array.isArray(value)) {
        return value.map((item) => (typeof item === 'string' ? item : String(item)));
    }
    return value;
}

function frontMatter(owned: Record<string, unknown>, md: NodeMarkdownExtras | undefined): Record<string, unknown> {
    return { ...owned, ...(md?.unknownOwned ?? {}), ...(md?.foreign ?? {}) };
}

export function renderEntryFile(entry: EntryNode, fileStem: string, yaml: YamlCodec): string {
    const defaults = createDefaultNativeEntry(0) as unknown as Record<string, unknown>;
    const native = entry.native as unknown as Record<string, unknown>;
    const owned: Record<string, unknown> = {};
    if (entry.name !== fileStem) {
        owned[TITLE_KEY] = entry.name;
    }
    for (const spec of FIELD_SPECS) {
        const value = native[spec.field];
        if (value === undefined || sameValue(value, defaults[spec.field])) {
            continue;
        }
        if (spec.type === 'object' && isPlainObject(value) && Object.keys(value).length === 0) {
            continue;
        }
        owned[spec.key] = renderField(spec, value);
    }
    const extra: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(native)) {
        if (!MAPPED_FIELDS.has(field) && !NOT_WRITTEN.has(field) && value !== undefined) {
            extra[field] = value;
        }
    }
    if (hasKeys(extra)) {
        owned[NATIVE_KEY] = extra;
    }
    const content = typeof entry.native.content === 'string' ? entry.native.content : '';
    const matter = frontMatter(owned, entry.md);
    if (Object.keys(matter).length === 0) {
        if (entry.md?.rawOnParseError || !startsWithDelimiter(content)) {
            return content;
        }
        // Content that itself begins like front matter needs an explicit empty block.
        return `---\n---\n\n${content}`;
    }
    return `---\n${yaml.stringify(matter)}---\n\n${content}`;
}

function startsWithDelimiter(text: string): boolean {
    return text === '---' || text.startsWith('---\n') || text.startsWith('---\r\n');
}

interface SplitFile {
    matter: string | null;
    body: string;
}

function splitFrontMatter(text: string): SplitFile {
    if (!startsWithDelimiter(text)) {
        return { matter: null, body: text };
    }
    const lines = text.split('\n');
    for (let i = 1; i < lines.length; i++) {
        const line = (lines[i] ?? '').replace(/\r$/, '');
        if (line === '---' || line === '...') {
            const matter = lines.slice(1, i).join('\n');
            let body = lines.slice(i + 1).join('\n');
            if (body.startsWith('\r\n')) {
                body = body.slice(2);
            } else if (body.startsWith('\n')) {
                body = body.slice(1);
            }
            return { matter, body };
        }
    }
    return { matter: null, body: text };
}

function splitKeys(record: Record<string, unknown>, isOwned: (key: string) => boolean): {
    owned: Record<string, unknown>;
    md: NodeMarkdownExtras | undefined;
    unknown: string[];
} {
    const owned: Record<string, unknown> = {};
    const foreign: Record<string, unknown> = {};
    const unknownOwned: Record<string, unknown> = {};
    const unknown: string[] = [];
    for (const [key, value] of Object.entries(record)) {
        if (!key.startsWith(OWNED_PREFIX)) {
            foreign[key] = value;
        } else if (isOwned(key)) {
            owned[key] = value;
        } else {
            unknownOwned[key] = value;
            unknown.push(key);
        }
    }
    const md: NodeMarkdownExtras = {};
    if (hasKeys(foreign)) {
        md.foreign = foreign;
    }
    if (hasKeys(unknownOwned)) {
        md.unknownOwned = unknownOwned;
    }
    return { owned, md: hasKeys(md as Record<string, unknown>) ? md : undefined, unknown };
}

export function parseEntryFile(text: string, fileStem: string, yaml: YamlCodec): EntryFileModel {
    const native = createDefaultNativeEntry(0);
    const warnings: string[] = [];
    const split = splitFrontMatter(text);
    let record: Record<string, unknown> = {};
    if (split.matter !== null) {
        let parsed: unknown;
        try {
            parsed = split.matter.trim() === '' ? {} : yaml.parse(split.matter);
        } catch (error) {
            parsed = error;
        }
        if (parsed === null || parsed === undefined) {
            parsed = {};
        }
        if (!isPlainObject(parsed) || parsed instanceof Error) {
            native.comment = fileStem;
            native.content = text;
            warnings.push('Front matter could not be parsed; the whole file was imported as content.');
            return { title: fileStem, native, md: { rawOnParseError: true }, idHint: undefined, warnings };
        }
        record = parsed;
    }
    const target = native as unknown as Record<string, unknown>;
    const isOwned = (key: string): boolean => key === TITLE_KEY || key === ID_KEY || key === NATIVE_KEY || SPEC_BY_KEY.has(key);
    const { owned, md, unknown } = splitKeys(record, isOwned);
    unknown.forEach((key) => warnings.push(`Unknown key "${key}" preserved.`));
    const nativeExtra = owned[NATIVE_KEY];
    if (isPlainObject(nativeExtra)) {
        for (const [field, value] of Object.entries(nativeExtra)) {
            if (!NOT_WRITTEN.has(field)) {
                target[field] = value;
            }
        }
    }
    for (const spec of FIELD_SPECS) {
        if (spec.key in owned) {
            target[spec.field] = parseField(spec, owned[spec.key]);
        }
    }
    const titleValue = owned[TITLE_KEY];
    const title = typeof titleValue === 'string' && titleValue.trim() !== '' ? titleValue : fileStem;
    native.comment = title;
    native.content = split.body;
    const idValue = owned[ID_KEY];
    return {
        title,
        native,
        md,
        idHint: typeof idValue === 'string' && idValue !== '' ? idValue : undefined,
        warnings,
    };
}

export interface FolderRecordInput {
    folder: FolderNode;
    /** Directory base name, or null for the top folder of a link/export (no title). */
    dirName: string | null;
    /** Disk base names of the children that have paths, keyed by node id. */
    childNames: ReadonlyMap<string, string>;
}

/** Returns null when the folder has only default information (FR-023). */
export function renderFolderRecord(input: FolderRecordInput, yaml: YamlCodec): string | null {
    const { folder, dirName, childNames } = input;
    const owned: Record<string, unknown> = {};
    if (dirName !== null && folder.name !== dirName) {
        owned[TITLE_KEY] = folder.name;
    }
    if (folder.isWiRoot && folder.book) {
        owned['wi_root'] = true;
        owned['wi_book'] = folder.book.bookName;
    }
    // URL-only images take part in the order under their record key (the name).
    const ordered = folder.children
        .map((child) => {
            const name = childNames.get(child.id) ?? (child.kind === 'image' && child.src !== '' ? child.name : undefined);
            return name === undefined ? null : { name, isDir: child.kind === 'folder' };
        })
        .filter((item): item is { name: string; isDir: boolean } => item !== null);
    const sorted = [...ordered].sort(compareDiskNames);
    if (ordered.some((item, i) => item.name !== sorted[i]?.name)) {
        owned['wi_order'] = ordered.map((item) => item.name);
    }
    const images: Record<string, unknown> = {};
    for (const child of folder.children) {
        if (child.kind !== 'image') {
            continue;
        }
        const image = renderImageRecord(child, childNames.get(child.id));
        if (image) {
            images[image.key] = image.value;
        }
    }
    if (hasKeys(images)) {
        owned['wi_images'] = images;
    }
    const matter = frontMatter(owned, folder.md);
    return Object.keys(matter).length === 0 ? null : yaml.stringify(matter);
}

function renderImageRecord(
    image: ImageNode,
    fileName: string | undefined
): { key: string; value: Record<string, unknown> } | null {
    const value: Record<string, unknown> = {};
    if (fileName === undefined) {
        if (image.src === '') {
            return null;
        }
        // URL-only image: the record is the only place it exists on disk.
        value['wi_src'] = image.src;
        if (image.caption !== '') {
            value['wi_caption'] = image.caption;
        }
        return { key: image.name, value };
    }
    if (image.name !== splitName(fileName).stem) {
        value['wi_title'] = image.name;
    }
    if (image.caption !== '') {
        value['wi_caption'] = image.caption;
    }
    return hasKeys(value) ? { key: fileName, value } : null;
}

const FOLDER_OWNED: ReadonlySet<string> = new Set([TITLE_KEY, ID_KEY, 'wi_root', 'wi_book', 'wi_order', 'wi_images']);

export function parseFolderRecord(text: string, yaml: YamlCodec): FolderRecordModel {
    const warnings: string[] = [];
    let parsed: unknown;
    try {
        parsed = text.trim() === '' ? {} : yaml.parse(text);
    } catch {
        parsed = undefined;
        warnings.push('Folder record could not be parsed and was ignored.');
    }
    const record = isPlainObject(parsed) ? parsed : {};
    const { owned, md, unknown } = splitKeys(record, (key) => FOLDER_OWNED.has(key));
    unknown.forEach((key) => warnings.push(`Unknown key "${key}" preserved.`));
    const images = new Map<string, FolderRecordImage>();
    const rawImages = owned['wi_images'];
    if (isPlainObject(rawImages)) {
        for (const [key, value] of Object.entries(rawImages)) {
            if (!isPlainObject(value)) {
                continue;
            }
            images.set(key, {
                title: typeof value['wi_title'] === 'string' ? value['wi_title'] : undefined,
                caption: typeof value['wi_caption'] === 'string' ? value['wi_caption'] : undefined,
                src: typeof value['wi_src'] === 'string' ? value['wi_src'] : undefined,
            });
        }
    }
    const title = owned[TITLE_KEY];
    const book = owned['wi_book'];
    const order = owned['wi_order'];
    const id = owned[ID_KEY];
    return {
        title: typeof title === 'string' && title.trim() !== '' ? title : undefined,
        root: owned['wi_root'] === true,
        book: typeof book === 'string' && book.trim() !== '' ? book : undefined,
        order: Array.isArray(order) ? order.map(String) : undefined,
        images,
        idHint: typeof id === 'string' && id !== '' ? id : undefined,
        md,
        warnings,
    };
}
