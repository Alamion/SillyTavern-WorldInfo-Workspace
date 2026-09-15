import { createDefaultNativeEntry } from '../state/schema';
import { FIELD_SPECS, ID_KEY, NATIVE_KEY, TITLE_KEY, type FieldSpec } from './convention';
import { FOLDER_RECORD_NAME, IMAGE_EXTS } from './naming';

/**
 * The in-workspace mapping reference (spec 004 FR-018), built from the same field
 * table the convention uses so the reference can never drift from the behavior.
 */

export interface ReferenceRow {
    key: string;
    meaning: string;
    type: string;
    defaultValue: string;
}

function typeLabel(spec: FieldSpec): string {
    switch (spec.type) {
        case 'enum':
            return `${spec.enumNames?.join(' | ')} (or 0–${(spec.enumNames?.length ?? 1) - 1})`;
        case 'list':
            return 'list of text';
        case 'nullable-number':
            return 'number or null';
        case 'nullable-boolean':
            return 'true / false / null';
        case 'number-or-boolean':
            return 'number or true/false';
        case 'filter':
            return '{ exclude, names, tags }';
        case 'object':
            return 'object (verbatim)';
        default:
            return spec.type;
    }
}

function defaultLabel(spec: FieldSpec): string {
    const value = (createDefaultNativeEntry(0) as unknown as Record<string, unknown>)[spec.field];
    if (spec.invert && typeof value === 'boolean') {
        return String(!value);
    }
    if (spec.type === 'enum' && typeof value === 'number') {
        return spec.enumNames?.[value] ?? String(value);
    }
    if (spec.type === 'filter') {
        return 'no filter';
    }
    if (typeof value === 'string') {
        return value === '' ? '(empty)' : value;
    }
    return JSON.stringify(value);
}

export function entryReferenceRows(): ReferenceRow[] {
    return [
        { key: TITLE_KEY, meaning: 'Entry title (memo)', type: 'text', defaultValue: 'file name' },
        ...FIELD_SPECS.map((spec) => ({
            key: spec.key,
            meaning: spec.description,
            type: typeLabel(spec),
            defaultValue: defaultLabel(spec),
        })),
        { key: NATIVE_KEY, meaning: 'Native fields unknown to this version (verbatim)', type: 'object', defaultValue: '(none)' },
        { key: ID_KEY, meaning: 'Optional identity hint; never written', type: 'text', defaultValue: '(none)' },
        { key: '(body)', meaning: 'Entry content', type: 'markdown', defaultValue: '(empty)' },
    ];
}

export function folderReferenceRows(): ReferenceRow[] {
    return [
        { key: TITLE_KEY, meaning: 'Folder name', type: 'text', defaultValue: 'directory name' },
        { key: 'wi_root', meaning: 'World Info root designation', type: 'true / false', defaultValue: 'false' },
        { key: 'wi_book', meaning: 'Bound native book name (with wi_root)', type: 'text', defaultValue: 'folder name' },
        { key: 'wi_order', meaning: 'Custom child order by file/directory name', type: 'list of names', defaultValue: 'folders first, then by name' },
        { key: 'wi_images.<file>.wi_title', meaning: 'Image item name', type: 'text', defaultValue: 'file name' },
        { key: 'wi_images.<file>.wi_caption', meaning: 'Image caption', type: 'text', defaultValue: '(empty)' },
        { key: 'wi_images.<name>.wi_src', meaning: 'External image URL (no file)', type: 'URL', defaultValue: '(none)' },
    ];
}

export const SCANNER_RULES: readonly string[] = [
    'Every directory is a folder; every .md file is an entry; image files are image items.',
    `Image types: ${IMAGE_EXTS.join(', ')}.`,
    `Folder metadata lives in a hidden ${FOLDER_RECORD_NAME} file, written only when a folder has non-default information.`,
    'Hidden files and folders (such as .obsidian or .git), swap files, and all other file types are ignored and never modified.',
    'All keys are optional: a plain note without front matter is a valid entry with default settings.',
    'Keys without the wi_ prefix (tags, aliases, …) are kept as they are.',
    'Images added from a folder are stored in the app image storage (user/images/WorldInfoWorkspace); SVG and AVIF stay embedded.',
];

export const NAMING_RULES: readonly string[] = [
    'File names come from item names; characters not allowed in file names become "_".',
    'Names that collide (ignoring letter case) get " (2)", " (3)", … — the real name is kept in wi_title.',
    'Existing file names are kept as long as they still match the item name.',
];

export const SAMPLE_ENTRY = `---
wi_keys: [Aldermeer, the river city]
wi_secondary_keys: [bridge]
wi_position: at_depth
wi_depth: 2
wi_order: 120
tags: [kingdom]
---

Aldermeer is a river city built on seven bridges.
`;
