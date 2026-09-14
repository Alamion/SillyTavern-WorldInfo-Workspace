import { describe, expect, it } from 'vitest';
import {
    createDefaultState,
    createEntryNode,
    createFolderNode,
    createImageNode,
    type EntryNode,
    type TreeNode,
} from '../../src/core/state/schema';
import { validateName, validateNode, validateTree } from '../../src/core/tree/validation';

const NOW = '2026-09-08T00:00:00.000Z';

function makeEntry(id: string, name: string): EntryNode {
    return createEntryNode({ id, parentId: 'f', name, now: NOW, nativeUid: 1 });
}

function asEntry(node: TreeNode): EntryNode {
    if (node.kind !== 'entry') {
        throw new Error('expected an entry node');
    }
    return node;
}

describe('name validation', () => {
    it('rejects blank-after-trim names', () => {
        expect(validateName('')).not.toBeNull();
        expect(validateName('   ')).not.toBeNull();
        expect(validateName('Aldermeer')).toBeNull();
    });
});

describe('native field rules (violations returned, never coerced)', () => {
    it('flags probability outside 0..100', () => {
        const node = asEntry(makeEntry('e1', 'E'));
        node.native.probability = 101;
        expect(validateNode(node).some((v) => v.field === 'probability')).toBe(true);
        node.native.probability = -1;
        expect(validateNode(node).some((v) => v.field === 'probability')).toBe(true);
    });

    it('flags negative depth and out-of-range position/role/selectiveLogic', () => {
        const node = asEntry(makeEntry('e1', 'E'));
        node.native.depth = -1;
        node.native.position = 9;
        node.native.role = 5;
        node.native.selectiveLogic = 4;
        const violations = validateNode(node);
        expect(violations.map((v) => v.field).sort()).toEqual(['depth', 'position', 'role', 'selectiveLogic']);
    });

    it('requires outletName when position is outlet', () => {
        const node = asEntry(makeEntry('e1', 'E'));
        node.native.position = 7;
        expect(validateNode(node).some((v) => v.field === 'outletName')).toBe(true);
        node.native.outletName = 'MyOutlet';
        expect(validateNode(node).some((v) => v.field === 'outletName')).toBe(false);
    });

    it('flags negative timed effects and bad groupWeight', () => {
        const node = asEntry(makeEntry('e1', 'E'));
        node.native.sticky = -3;
        node.native.cooldown = -1;
        node.native.delay = -2;
        node.native.groupWeight = 150;
        const violations = validateNode(node);
        expect(violations.some((v) => v.field === 'sticky')).toBe(true);
        expect(violations.some((v) => v.field === 'cooldown')).toBe(true);
        expect(violations.some((v) => v.field === 'delay')).toBe(true);
        expect(violations.some((v) => v.field === 'groupWeight')).toBe(true);
    });

    it('flags triggers outside the generation type set', () => {
        const node = asEntry(makeEntry('e1', 'E'));
        node.native.triggers = ['normal', 'quiet', 'bogus'];
        expect(validateNode(node).some((v) => v.field === 'triggers')).toBe(true);
        node.native.triggers = ['normal', 'continue', 'impersonate', 'swipe', 'regenerate', 'quiet'];
        expect(validateNode(node).some((v) => v.field === 'triggers')).toBe(false);
    });

    it('validates image names and folder book names', () => {
        const image = createImageNode({ id: 'i1', parentId: 'f', name: '', now: NOW });
        expect(validateNode(image).some((v) => v.field === 'name')).toBe(true);
        const folder = createFolderNode({ id: 'f1', parentId: 'f', name: 'F', now: NOW });
        folder.book = { bookName: '   ', orphans: [] };
        expect(validateNode(folder).some((v) => v.field === 'bookName')).toBe(true);
    });

    it('validates a whole tree and reports node ids', () => {
        const state = createDefaultState();
        const folder = createFolderNode({ id: 'f1', parentId: state.root.id, name: 'F', now: NOW });
        const bad = asEntry(makeEntry('e1', 'E'));
        bad.native.probability = -5;
        folder.children.push(bad);
        state.root.children.push(folder);
        expect(validateTree(state)).toEqual([
            { nodeId: 'e1', field: 'probability', message: expect.any(String) },
        ]);
    });
});