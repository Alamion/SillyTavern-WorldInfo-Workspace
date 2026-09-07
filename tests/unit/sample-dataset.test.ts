import { describe, expect, it } from 'vitest';
import {
    SAMPLE_DATASET,
    type SampleEntryNode,
    type SampleFolderNode,
    type SampleNode,
} from '../../src/core/sample/dataset';
import { FIELD_SCHEMA } from '../../src/core/sample/fieldGroups';

function flatten(node: SampleNode): SampleNode[] {
    const out: SampleNode[] = [node];
    if (node.kind === 'folder') {
        for (const child of node.children) {
            out.push(...flatten(child));
        }
    }
    return out;
}

function folderDepth(node: SampleNode): number {
    if (node.kind !== 'folder') {
        return 0;
    }
    return node.children.length === 0
        ? 1
        : Math.max(...node.children.map((c) => folderDepth(c) + 1));
}

const allNodes: SampleNode[] = flatten(SAMPLE_DATASET.root);
const folders = allNodes.filter((n): n is SampleFolderNode => n.kind === 'folder');
const entries = allNodes.filter((n): n is SampleEntryNode => n.kind === 'entry');
const images = allNodes.filter((n) => n.kind === 'image');
const wiRoots = folders.filter((f) => f.isWiRoot);

const EXPECTED_NATIVE_FIELDS: readonly string[] = [
    'uid',
    'key',
    'keysecondary',
    'comment',
    'content',
    'constant',
    'vectorized',
    'selective',
    'selectiveLogic',
    'probability',
    'useProbability',
    'disable',
    'order',
    'position',
    'depth',
    'role',
    'outletName',
    'ignoreBudget',
    'excludeRecursion',
    'preventRecursion',
    'delayUntilRecursion',
    'matchPersonaDescription',
    'matchCharacterDescription',
    'matchCharacterPersonality',
    'matchCharacterDepthPrompt',
    'matchScenario',
    'matchCreatorNotes',
    'group',
    'groupOverride',
    'groupWeight',
    'scanDepth',
    'caseSensitive',
    'matchWholeWords',
    'useGroupScoring',
    'sticky',
    'cooldown',
    'delay',
    'automationId',
    'triggers',
    'characterFilterNames',
    'characterFilterTags',
    'characterFilterExclude',
    'addMemo',
    'displayIndex',
    'extensions',
];

describe('sample dataset structure', () => {
    it('has a single folder root with no parent', () => {
        expect(SAMPLE_DATASET.root.kind).toBe('folder');
        expect(SAMPLE_DATASET.root.parentId).toBeNull();
    });

    it('resolves every parentId bidirectionally with unique ids', () => {
        const ids = new Set<string>();
        for (const node of allNodes) {
            expect(ids.has(node.id)).toBe(false);
            ids.add(node.id);
            if (node.parentId === null) {
                expect(node).toBe(SAMPLE_DATASET.root);
            } else {
                const parent = folders.find((f) => f.children.includes(node));
                expect(parent?.id).toBe(node.parentId);
            }
        }
    });

    it('contains no cycles', () => {
        const visited = new Set<string>();
        const walk = (node: SampleNode): void => {
            expect(visited.has(node.id)).toBe(false);
            visited.add(node.id);
            if (node.kind === 'folder') {
                node.children.forEach(walk);
            }
        };
        walk(SAMPLE_DATASET.root);
        expect(visited.size).toBe(allNodes.length);
    });

    it('uses only the merged entity kinds (folder, entry, image)', () => {
        const kinds = new Set(allNodes.map((n) => n.kind));
        for (const kind of kinds) {
            expect(['folder', 'entry', 'image']).toContain(kind);
        }
    });
});

describe('sample dataset minimums (spec FR-003, iteration 2)', () => {
    it('nests folders at least three levels deep', () => {
        expect(folderDepth(SAMPLE_DATASET.root)).toBeGreaterThanOrEqual(3);
    });

    it('has at least 10 entries, 2 images and 2 WI roots', () => {
        expect(entries.length).toBeGreaterThanOrEqual(10);
        expect(images.length).toBeGreaterThanOrEqual(2);
        expect(wiRoots.length).toBeGreaterThanOrEqual(2);
    });

    it('has at least one WI root nested inside another WI root', () => {
        const parentOf = new Map<string, SampleFolderNode>();
        for (const folder of folders) {
            for (const child of folder.children) {
                if (child.kind === 'folder') {
                    parentOf.set(child.id, folder);
                }
            }
        }
        const nested = wiRoots.some((root) => {
            let cursor: SampleFolderNode | undefined = parentOf.get(root.id);
            while (cursor) {
                if (cursor.isWiRoot) {
                    return true;
                }
                cursor = cursor.parentId !== null ? parentOf.get(cursor.id) : undefined;
            }
            return false;
        });
        expect(nested).toBe(true);
    });
});

describe('sample dataset field coverage (contracts C1, field schema)', () => {
    it('covers every native WI field exactly once in FIELD_SCHEMA', () => {
        const schemaNames = FIELD_SCHEMA.map((f) => f.name as string).sort();
        expect(schemaNames).toEqual([...EXPECTED_NATIVE_FIELDS].sort());
    });

    it('populates every entry with the full native field set', () => {
        for (const entry of entries) {
            for (const field of EXPECTED_NATIVE_FIELDS) {
                expect(
                    Object.keys(entry.fields),
                    `${entry.name} missing ${field}`
                ).toContain(field);
            }
        }
    });
});

describe('sample dataset intersection and edge fixtures', () => {
    it('has at least one entry belonging to two or more books', () => {
        const multi = entries.filter((e) => e.bookMemberships.length >= 2);
        expect(multi.length).toBeGreaterThanOrEqual(1);
        for (const entry of multi) {
            for (const book of entry.bookMemberships) {
                expect(book).not.toBe('');
            }
        }
    });

    it('has at least one folder with 30 or more children', () => {
        const wide = folders.filter((f) => f.children.length >= 30);
        expect(wide.length).toBeGreaterThanOrEqual(1);
    });

    it('has at least one long entry with roughly 2000 words of content', () => {
        const longEntries = entries.filter((e) => e.contentLengthClass === 'long');
        expect(longEntries.length).toBeGreaterThanOrEqual(1);
        for (const entry of longEntries) {
            const words = entry.fields.content.trim().split(/\s+/);
            expect(words.length).toBeGreaterThanOrEqual(1800);
        }
    });

    it('gives every WI root its own settings mock', () => {
        for (const root of wiRoots) {
            expect(root.wiSettings).not.toBeNull();
            expect(root.wiSettings?.bookName).not.toBe('');
        }
    });

    it('carries valid data URIs on every image node', () => {
        for (const node of allNodes) {
            if (node.kind === 'image') {
                expect(node.source.startsWith('data:image/svg+xml,')).toBe(true);
                expect(node.caption).not.toBe('');
            }
        }
    });
});

describe('sample dataset language policy (constitution IX)', () => {
    it('keeps all sample text in the ASCII range', () => {
        const texts: string[] = [];
        for (const node of allNodes) {
            texts.push(node.name);
            if (node.kind === 'entry') {
                texts.push(node.fields.content);
            }
            if (node.kind === 'image') {
                texts.push(node.caption);
            }
        }
        for (const text of texts) {
            const nonAscii = [...text].filter((char) => char.charCodeAt(0) > 126);
            expect(
                nonAscii.join(''),
                `non-ASCII text found: ${text.slice(0, 60)}`
            ).toBe('');
        }
    });
});
