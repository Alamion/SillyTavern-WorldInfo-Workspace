import { describe, expect, it } from 'vitest';
import {
    FIELD_SPECS,
    parseEntryFile,
    parseFolderRecord,
    renderEntryFile,
    renderFolderRecord,
} from '../../src/core/md/convention';
import {
    createEntryNode,
    createFolderNode,
    createImageNode,
    type EntryNode,
} from '../../src/core/state/schema';
import { nodeYaml as yaml } from '../support/memoryDisk';

const NOW = '2026-09-14T00:00:00.000Z';

function entry(name = 'Aldermeer'): EntryNode {
    return createEntryNode({ id: 'e1', parentId: 'f1', name, now: NOW, nativeUid: 7 });
}

function roundTrip(node: EntryNode, stem = node.name): EntryNode['native'] {
    const text = renderEntryFile(node, stem, yaml);
    return parseEntryFile(text, stem, yaml).native;
}

describe('entry files — minimal metadata (FR-023)', () => {
    it('writes no front matter for an all-default entry named like its file', () => {
        const node = entry();
        node.native.content = 'Aldermeer is a river city.';
        expect(renderEntryFile(node, 'Aldermeer', yaml)).toBe('Aldermeer is a river city.');
    });

    it('never writes ids, uids, or display indexes', () => {
        const node = entry();
        node.native.key = ['river'];
        node.native.displayIndex = 3;
        const text = renderEntryFile(node, 'Aldermeer', yaml);
        expect(text).not.toMatch(/wi_id|uid|displayIndex|e1/);
    });

    it('writes only non-default fields', () => {
        const node = entry();
        node.native.order = 120;
        const text = renderEntryFile(node, 'Aldermeer', yaml);
        expect(text).toBe('---\nwi_order: 120\n---\n\n');
    });
});

describe('entry files — round trip', () => {
    it('round-trips every mapped field with non-default values', () => {
        const node = entry();
        const n = node.native as unknown as Record<string, unknown>;
        n['key'] = ['Aldermeer', 'the river city'];
        n['keysecondary'] = ['bridge'];
        n['selective'] = false;
        n['selectiveLogic'] = 1;
        n['disable'] = true;
        n['constant'] = true;
        n['vectorized'] = true;
        n['order'] = 5;
        n['position'] = 4;
        n['depth'] = 2;
        n['role'] = 2;
        n['outletName'] = 'side';
        n['probability'] = 40;
        n['useProbability'] = false;
        n['ignoreBudget'] = true;
        n['excludeRecursion'] = true;
        n['preventRecursion'] = true;
        n['delayUntilRecursion'] = 2;
        n['matchPersonaDescription'] = true;
        n['matchCharacterDescription'] = true;
        n['matchCharacterPersonality'] = true;
        n['matchCharacterDepthPrompt'] = true;
        n['matchScenario'] = true;
        n['matchCreatorNotes'] = true;
        n['group'] = 'cities';
        n['groupOverride'] = true;
        n['groupWeight'] = 30;
        n['scanDepth'] = 3;
        n['caseSensitive'] = true;
        n['matchWholeWords'] = false;
        n['useGroupScoring'] = true;
        n['sticky'] = 1;
        n['cooldown'] = 2;
        n['delay'] = 3;
        n['automationId'] = 'auto';
        n['triggers'] = ['normal', 'continue'];
        n['characterFilter'] = { isExclude: true, names: ['Seraphina'], tags: ['t1'] };
        n['addMemo'] = false;
        n['extensions'] = { other: { a: 1 } };
        n['content'] = 'Body';
        const text = renderEntryFile(node, 'Aldermeer', yaml);
        expect(text).toContain('wi_position: at_depth');
        expect(text).toContain('wi_role: assistant');
        expect(text).toContain('wi_selective_logic: not_all');
        expect(text).toContain('wi_enabled: false');
        const parsed = parseEntryFile(text, 'Aldermeer', yaml).native as unknown as Record<string, unknown>;
        for (const spec of FIELD_SPECS) {
            expect(parsed[spec.field], spec.key).toEqual(n[spec.field]);
        }
        expect(parsed['content']).toBe('Body');
        expect(parsed['comment']).toBe('Aldermeer');
    });

    it('accepts native numbers for enum keys and keeps unknown enum names as given', () => {
        const numeric = parseEntryFile('---\nwi_position: 4\nwi_role: 1\n---\n\nx', 'A', yaml).native;
        expect(numeric.position).toBe(4);
        expect(numeric.role).toBe(1);
        const invalid = parseEntryFile('---\nwi_position: sideways\nwi_probability: 250\n---\n', 'A', yaml).native;
        expect(invalid.position as unknown).toBe('sideways');
        expect(invalid.probability).toBe(250);
    });

    it('carries unknown native fields through wi_native', () => {
        const node = entry();
        (node.native as unknown as Record<string, unknown>)['futureField'] = { x: 1 };
        const text = renderEntryFile(node, 'Aldermeer', yaml);
        expect(text).toContain('wi_native:');
        expect((roundTrip(node) as unknown as Record<string, unknown>)['futureField']).toEqual({ x: 1 });
    });

    it('writes wi_title only when the name differs from the stem', () => {
        const node = entry('A/B');
        const text = renderEntryFile(node, 'A_B', yaml);
        expect(text).toContain('wi_title: A/B');
        expect(parseEntryFile(text, 'A_B', yaml).title).toBe('A/B');
        expect(renderEntryFile(entry('Plain'), 'Plain', yaml)).toBe('');
    });

    it('preserves the body exactly (blank-line rule, CRLF, leading newlines, empty)', () => {
        for (const content of ['', '\nstarts with newline', 'line1\r\nline2\r\n', '---\nlooks like matter']) {
            const node = entry();
            node.native.content = content;
            node.native.order = 1;
            expect(roundTrip(node).content).toBe(content);
            node.native.order = 100;
            expect(roundTrip(node).content).toBe(content);
        }
    });
});

describe('entry files — hand-written input', () => {
    it('treats a file without front matter as an entry with defaults', () => {
        const model = parseEntryFile('# Notes\nPlain text', 'Notes', yaml);
        expect(model.title).toBe('Notes');
        expect(model.native.content).toBe('# Notes\nPlain text');
        expect(model.native.key).toEqual([]);
        expect(model.md).toBeUndefined();
    });

    it('preserves foreign and unknown owned keys and writes them back after owned keys', () => {
        const text = '---\ntags: [kingdom]\nwi_keys: [river]\naliases: [Alder]\nwi_future: 1\n---\n\nBody';
        const model = parseEntryFile(text, 'Aldermeer', yaml);
        expect(model.md?.foreign).toEqual({ tags: ['kingdom'], aliases: ['Alder'] });
        expect(model.md?.unknownOwned).toEqual({ wi_future: 1 });
        expect(model.warnings.some((w) => w.includes('wi_future'))).toBe(true);
        const node = entry();
        node.native = model.native;
        node.md = model.md;
        const rendered = renderEntryFile(node, 'Aldermeer', yaml);
        expect(rendered).toBe('---\nwi_keys:\n  - river\nwi_future: 1\ntags:\n  - kingdom\naliases:\n  - Alder\n---\n\nBody');
    });

    it('imports malformed front matter as content and does not rewrite it', () => {
        const text = '---\nwi_keys: [unclosed\n---\nBody';
        const model = parseEntryFile(text, 'Broken', yaml);
        expect(model.native.content).toBe(text);
        expect(model.md?.rawOnParseError).toBe(true);
        expect(model.warnings).toHaveLength(1);
        const node = entry('Broken');
        node.native = model.native;
        node.md = model.md;
        expect(renderEntryFile(node, 'Broken', yaml)).toBe(text);
    });

    it('parses wi_id as a hint only', () => {
        const model = parseEntryFile('---\nwi_id: abc\n---\n\nx', 'A', yaml);
        expect(model.idHint).toBe('abc');
        const node = entry('A');
        node.native = model.native;
        node.md = model.md;
        expect(renderEntryFile(node, 'A', yaml)).toBe('x');
    });

    it('accepts a single string for list keys', () => {
        expect(parseEntryFile('---\nwi_keys: dragon\n---\n', 'A', yaml).native.key).toEqual(['dragon']);
    });
});

describe('folder records', () => {
    it('renders nothing for an all-default folder', () => {
        const folder = createFolderNode({ id: 'f1', parentId: 'r', name: 'Houses', now: NOW });
        const a = createEntryNode({ id: 'a', parentId: 'f1', name: 'A', now: NOW, nativeUid: 1 });
        const b = createEntryNode({ id: 'b', parentId: 'f1', name: 'B', now: NOW, nativeUid: 2 });
        folder.children = [a, b];
        const names = new Map([
            ['a', 'A.md'],
            ['b', 'B.md'],
        ]);
        expect(renderFolderRecord({ folder, dirName: 'Houses', childNames: names }, yaml)).toBeNull();
    });

    it('renders only non-default designation, order, title and image metadata', () => {
        const folder = createFolderNode({ id: 'f1', parentId: 'r', name: 'Kingdoms: East', now: NOW });
        folder.isWiRoot = true;
        folder.book = { bookName: 'Kingdoms East', orphans: [] };
        const b = createEntryNode({ id: 'b', parentId: 'f1', name: 'B', now: NOW, nativeUid: 2 });
        const a = createEntryNode({ id: 'a', parentId: 'f1', name: 'A', now: NOW, nativeUid: 1 });
        const map = createImageNode({ id: 'i', parentId: 'f1', name: 'Map — old', now: NOW });
        map.src = 'data:image/png;base64,AA';
        map.caption = 'Old survey';
        const remote = createImageNode({ id: 'u', parentId: 'f1', name: 'Remote', now: NOW });
        remote.src = 'https://example.org/p.png';
        folder.children = [b, a, map, remote];
        const names = new Map([
            ['b', 'B.md'],
            ['a', 'A.md'],
            ['i', 'Map — old.png'],
        ]);
        const text = renderFolderRecord({ folder, dirName: 'Kingdoms_ East', childNames: names }, yaml);
        const model = parseFolderRecord(text!, yaml);
        expect(model.title).toBe('Kingdoms: East');
        expect(model.root).toBe(true);
        expect(model.book).toBe('Kingdoms East');
        expect(model.order).toEqual(['B.md', 'A.md', 'Map — old.png', 'Remote']);
        expect(model.images.get('Map — old.png')).toEqual({ title: undefined, caption: 'Old survey', src: undefined });
        expect(model.images.get('Remote')).toEqual({ title: undefined, caption: undefined, src: 'https://example.org/p.png' });
    });

    it('omits the title for the top folder and preserves foreign keys', () => {
        const folder = createFolderNode({ id: 'r', parentId: 'x', name: 'Workspace', now: NOW });
        folder.md = { foreign: { cssclass: 'lore' } };
        const text = renderFolderRecord({ folder, dirName: null, childNames: new Map() }, yaml);
        expect(text).toBe('cssclass: lore\n');
        expect(parseFolderRecord(text!, yaml).md?.foreign).toEqual({ cssclass: 'lore' });
    });

    it('ignores an unparseable record with a warning', () => {
        const model = parseFolderRecord('wi_root: [', yaml);
        expect(model.root).toBe(false);
        expect(model.warnings).toHaveLength(1);
    });
});
