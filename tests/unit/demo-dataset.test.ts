import { describe, expect, it } from 'vitest';
import { createDefaultState, deepValidateState, findNode, migrate, type TreeNode } from '../../src/core/state/schema';
import { createDemoState } from '../../src/core/demo/dataset';

let counter = 0;
function demoCounter(): number {
    counter += 1;
    return counter;
}

describe('demo dataset (FR-001, research R9)', () => {
    it('produces a schema-valid workspace state', () => {
        const state = createDemoState(() => `id-${demoCounter()}`);
        expect(state.version).toBe(1);
        expect(deepValidateState(state)).toEqual([]);
    });

    it('stays valid after being grafted into the live workspace root and reloaded', () => {
        const live = createDefaultState();
        live.root.children.push(...createDemoState(() => `id-${demoCounter()}`).root.children);
        expect(deepValidateState(live)).toEqual([]);
        const reloaded = migrate(JSON.parse(JSON.stringify(live)));
        expect(reloaded._recovered).toBeUndefined();
        expect(reloaded.root.children.length).toBeGreaterThan(0);
    });

    it('contains at least 3 levels of nesting, 10 entries and 2 images', () => {
        const state = createDemoState(() => `id-${demoCounter()}`);
        let entries = 0;
        let images = 0;
        let maxDepth = 0;
        const walk = (node: TreeNode, depth: number): void => {
            if (node.kind === 'entry') {
                entries += 1;
            }
            if (node.kind === 'image') {
                images += 1;
            }
            maxDepth = Math.max(maxDepth, depth);
            if (node.kind === 'folder') {
                node.children.forEach((child) => walk(child, depth + 1));
            }
        };
        walk(state.root, 0);
        expect(maxDepth).toBeGreaterThanOrEqual(3);
        expect(entries).toBeGreaterThanOrEqual(10);
        expect(images).toBeGreaterThanOrEqual(2);
    });

    it('designates no World Info roots and holds no sync bindings (research R9)', () => {
        const state = createDemoState(() => `id-${demoCounter()}`);
        const walk = (node: TreeNode): void => {
            if (node.kind === 'folder') {
                expect(node.isWiRoot).toBe(false);
                expect(node.book).toBeNull();
                node.children.forEach(walk);
            }
        };
        walk(state.root);
    });

    it('keeps every demo entry with a full native payload and distinct ids', () => {
        const state = createDemoState(() => `id-${demoCounter()}`);
        const ids = new Set<string>();
        const walk = (node: TreeNode): void => {
            expect(ids.has(node.id)).toBe(false);
            ids.add(node.id);
            if (node.kind === 'entry') {
                expect(typeof node.native.uid).toBe('number');
            }
            if (node.kind === 'folder') {
                node.children.forEach(walk);
            }
        };
        walk(state.root);
        expect(findNode(state, state.root.id)?.kind).toBe('folder');
    });
});