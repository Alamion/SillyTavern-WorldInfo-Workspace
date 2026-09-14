import type { NativeWorldInfoEntry } from '../global';

export type SampleFieldName = keyof NativeWorldInfoEntry;

export type SampleFieldType =
    | 'text'
    | 'number'
    | 'boolean'
    | 'nullableBoolean'
    | 'nullableNumber'
    | 'stringList'
    | 'enum'
    | 'json'
    | 'longText';

export interface SampleFieldOption {
    value: number;
    label: string;
}

export interface SampleFieldMeta {
    name: SampleFieldName;
    type: SampleFieldType;
    label: string;
    info: string;
    docs?: string;
    options?: readonly SampleFieldOption[];
}

export interface SampleLayoutField {
    name: SampleFieldName;
    span: number;
}

export interface SampleEditorSection {
    id: string;
    title: string;
    fields: readonly SampleLayoutField[];
}

const DOCS_BASE = 'https://docs.sillytavern.app/usage/core-concepts/worldinfo/';

function docs(anchor: string): string {
    return `${DOCS_BASE}#${anchor}`;
}

export const FIELD_SCHEMA: readonly SampleFieldMeta[] = [
    {
        name: 'uid',
        type: 'number',
        label: 'UID',
        info: 'Unique entry id inside its book; the workspace reassigns free ids on export.',
    },
    {
        name: 'comment',
        type: 'text',
        label: 'Title / Memo',
        info: 'Label for your convenience; not used by the AI or trigger logic.',
        docs: docs('entry-title--memo'),
    },
    {
        name: 'content',
        type: 'longText',
        label: 'Content',
        info: 'The text inserted into the prompt when the entry activates. Markdown is rendered in the preview.',
    },
    {
        name: 'key',
        type: 'stringList',
        label: 'Keys',
        info: 'Primary keywords that trigger this entry. Regex in /slashes/ is supported.',
        docs: docs('key'),
    },
    {
        name: 'keysecondary',
        type: 'stringList',
        label: 'Optional filter',
        info: 'Additional keywords combined with the primary keys via the selective logic.',
        docs: docs('optional-filter'),
    },
    {
        name: 'selectiveLogic',
        type: 'enum',
        label: 'Logic',
        info: 'How the optional filter combines with the primary keys.',
        docs: docs('optional-filter'),
        options: [
            { value: 0, label: 'AND ANY' },
            { value: 3, label: 'AND ALL' },
            { value: 2, label: 'NOT ANY' },
            { value: 1, label: 'NOT ALL' },
        ],
    },
    {
        name: 'constant',
        type: 'boolean',
        label: 'Constant',
        info: 'Blue circle: inserts on every generation without needing keys.',
        docs: docs('strategy'),
    },
    {
        name: 'vectorized',
        type: 'boolean',
        label: 'Vectorized',
        info: 'Chain link: allows insertion by embedding similarity (Vector Storage).',
        docs: docs('vector-storage-matching'),
    },
    {
        name: 'selective',
        type: 'boolean',
        label: 'Selective',
        info: 'Enables the secondary key filter.',
    },
    {
        name: 'disable',
        type: 'boolean',
        label: 'Disabled',
        info: 'Entry is skipped entirely while disabled.',
    },
    {
        name: 'order',
        type: 'number',
        label: 'Order',
        info: 'Priority among activated entries; higher numbers land closer to the end of the context.',
        docs: docs('insertion-order'),
    },
    {
        name: 'position',
        type: 'enum',
        label: 'Position',
        info: 'Where in the prompt the entry is inserted.',
        docs: docs('insertion-position'),
        options: [
            { value: 0, label: 'Before Char Defs' },
            { value: 1, label: 'After Char Defs' },
            { value: 2, label: 'Top of AN' },
            { value: 3, label: 'Bottom of AN' },
            { value: 4, label: '@ Depth' },
            { value: 5, label: 'Before Example Messages' },
            { value: 6, label: 'After Example Messages' },
            { value: 7, label: 'Outlet' },
        ],
    },
    {
        name: 'depth',
        type: 'number',
        label: 'Depth',
        info: 'Used by the @ Depth position: 0 is the bottom of the prompt.',
        docs: docs('insertion-position'),
    },
    {
        name: 'role',
        type: 'enum',
        label: 'Role',
        info: 'Message role for @ Depth entries.',
        docs: docs('insertion-position'),
        options: [
            { value: 0, label: 'System' },
            { value: 1, label: 'User' },
            { value: 2, label: 'Assistant' },
        ],
    },
    {
        name: 'outletName',
        type: 'text',
        label: 'Outlet name',
        info: 'Named outlet for manual insertion via the {{outlet::Name}} macro.',
        docs: docs('outlet-name'),
    },
    {
        name: 'ignoreBudget',
        type: 'boolean',
        label: 'Ignore budget',
        info: 'Insert this entry even when the World Info token budget is exhausted.',
    },
    {
        name: 'probability',
        type: 'number',
        label: 'Trigger %',
        info: 'Chance that an activated entry is actually inserted (100 = always).',
        docs: docs('probability-trigger'),
    },
    {
        name: 'useProbability',
        type: 'boolean',
        label: 'Use probability',
        info: 'Enables the trigger chance roll.',
    },
    {
        name: 'group',
        type: 'text',
        label: 'Inclusion group',
        info: 'Entries sharing a group label compete; only one is inserted.',
        docs: docs('inclusion-group'),
    },
    {
        name: 'groupOverride',
        type: 'boolean',
        label: 'Prioritize inclusion',
        info: 'Pick deterministically by Order instead of rolling Group Weight.',
        docs: docs('prioritize-inclusion'),
    },
    {
        name: 'groupWeight',
        type: 'number',
        label: 'Group weight',
        info: 'Weight used for the random pick within an inclusion group.',
        docs: docs('inclusion-group'),
    },
    {
        name: 'excludeRecursion',
        type: 'boolean',
        label: 'Non-recursable',
        info: 'This entry cannot be activated by other entries.',
        docs: docs('recursive-scanning'),
    },
    {
        name: 'preventRecursion',
        type: 'boolean',
        label: 'Prevent further recursion',
        info: 'This entry cannot trigger other entries.',
        docs: docs('recursive-scanning'),
    },
    {
        name: 'delayUntilRecursion',
        type: 'number',
        label: 'Delay until recursion',
        info: 'Only activated during recursive checks, grouped by level.',
        docs: docs('recursive-scanning'),
    },
    {
        name: 'matchPersonaDescription',
        type: 'boolean',
        label: 'Persona description',
        info: 'Match keys against the active persona description.',
        docs: docs('additional-matching-sources'),
    },
    {
        name: 'matchCharacterDescription',
        type: 'boolean',
        label: 'Character description',
        info: 'Match keys against the character description.',
        docs: docs('additional-matching-sources'),
    },
    {
        name: 'matchCharacterPersonality',
        type: 'boolean',
        label: 'Personality',
        info: 'Match keys against the character personality summary.',
        docs: docs('additional-matching-sources'),
    },
    {
        name: 'matchCharacterDepthPrompt',
        type: 'boolean',
        label: 'Character note',
        info: 'Match keys against the character note.',
        docs: docs('additional-matching-sources'),
    },
    {
        name: 'matchScenario',
        type: 'boolean',
        label: 'Scenario',
        info: 'Match keys against the character scenario.',
        docs: docs('additional-matching-sources'),
    },
    {
        name: 'matchCreatorNotes',
        type: 'boolean',
        label: 'Creator notes',
        info: 'Match keys against the creator notes.',
        docs: docs('additional-matching-sources'),
    },
    {
        name: 'scanDepth',
        type: 'nullableNumber',
        label: 'Scan depth',
        info: 'Per-entry override of how many messages are scanned; empty inherits the global setting.',
        docs: docs('scan-depth'),
    },
    {
        name: 'caseSensitive',
        type: 'nullableBoolean',
        label: 'Case sensitive',
        info: 'Per-entry override; empty inherits the global setting.',
        docs: docs('case-sensitive-keys'),
    },
    {
        name: 'matchWholeWords',
        type: 'nullableBoolean',
        label: 'Match whole words',
        info: 'Per-entry override; empty inherits the global setting.',
        docs: docs('match-whole-words'),
    },
    {
        name: 'useGroupScoring',
        type: 'nullableBoolean',
        label: 'Use group scoring',
        info: 'Per-entry override; empty inherits the global setting.',
        docs: docs('use-group-scoring'),
    },
    {
        name: 'sticky',
        type: 'nullableNumber',
        label: 'Sticky',
        info: 'Stays active for N messages after activation; empty disables.',
        docs: docs('timed-effects'),
    },
    {
        name: 'cooldown',
        type: 'nullableNumber',
        label: 'Cooldown',
        info: 'Cannot re-activate for N messages after activation; empty disables.',
        docs: docs('timed-effects'),
    },
    {
        name: 'delay',
        type: 'nullableNumber',
        label: 'Delay',
        info: 'Cannot activate until N messages exist in the chat; empty disables.',
        docs: docs('timed-effects'),
    },
    {
        name: 'automationId',
        type: 'text',
        label: 'Automation ID',
        info: 'Links the entry to Quick Replies STscript automation.',
        docs: docs('automation-id'),
    },
    {
        name: 'triggers',
        type: 'stringList',
        label: 'Triggers',
        info: 'Generation types this entry may activate for; empty means all.',
        docs: docs('triggers'),
    },
    {
        name: 'characterFilterNames',
        type: 'stringList',
        label: 'Character filter',
        info: 'Character names the entry can (or cannot) activate for.',
        docs: docs('character-filter'),
    },
    {
        name: 'characterFilterTags',
        type: 'stringList',
        label: 'Character tags',
        info: 'Character tags the entry can (or cannot) activate for.',
        docs: docs('character-filter'),
    },
    {
        name: 'characterFilterExclude',
        type: 'boolean',
        label: 'Exclude mode',
        info: 'Inverts the character filter into a blacklist.',
        docs: docs('character-filter'),
    },
    {
        name: 'addMemo',
        type: 'boolean',
        label: 'Add memo',
        info: 'Shows the title/memo field in lists.',
    },
    {
        name: 'displayIndex',
        type: 'number',
        label: 'Display index',
        info: 'Render order hint persisted with the book.',
    },
    {
        name: 'extensions',
        type: 'json',
        label: 'Extensions',
        info: 'Passthrough object; unknown metadata survives round-trips here.',
    },
];


export const ADVANCED_LAYOUT: readonly SampleEditorSection[] = [
    {
        id: 'advanced',
        title: 'Advanced',
        fields: [
            { name: 'scanDepth', span: 3 },
            { name: 'caseSensitive', span: 3 },
            { name: 'matchWholeWords', span: 3 },
            { name: 'useGroupScoring', span: 3 },
            { name: 'automationId', span: 6 },
            { name: 'triggers', span: 6 },
            { name: 'excludeRecursion', span: 3 },
            { name: 'preventRecursion', span: 3 },
            { name: 'delayUntilRecursion', span: 3 },
            { name: 'sticky', span: 3 },
            { name: 'cooldown', span: 3 },
            { name: 'delay', span: 3 },
            { name: 'characterFilterNames', span: 4 },
            { name: 'characterFilterTags', span: 4 },
            { name: 'characterFilterExclude', span: 4 },
            { name: 'addMemo', span: 2 },
            { name: 'uid', span: 2 },
            { name: 'displayIndex', span: 2 },
            { name: 'extensions', span: 6 },
        ],
    },
];


