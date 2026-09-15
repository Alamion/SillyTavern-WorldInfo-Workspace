import { describe, expect, it } from 'vitest';
import {
    assignPaths,
    compareDiskNames,
    imageExtFromSrc,
    imageHasFile,
    sanitizeStem,
} from '../../src/core/md/naming';
import {
    createDefaultState,
    createEntryNode,
    createFolderNode,
    createImageNode,
    type FolderNode,
    type TreeNode,
} from '../../src/core/state/schema';

const NOW = '2026-09-14T00:00:00.000Z';

function folder(id: string, name: string, children: TreeNode[] = []): FolderNode {
    const node = createFolderNode({ id, parentId: 'x', name, now: NOW });
    node.children = children;
    children.forEach((child) => (child.parentId = id));
    return node;
}

function entry(id: string, name: string): TreeNode {
    return createEntryNode({ id, parentId: 'x', name, now: NOW, nativeUid: 1 });
}

function image(id: string, name: string, src: string): TreeNode {
    const node = createImageNode({ id, parentId: 'x', name, now: NOW });
    node.src = src;
    return node;
}

function rootWith(children: TreeNode[]): FolderNode {
    const root = createDefaultState().root;
    root.children = children;
    children.forEach((child) => (child.parentId = root.id));
    return root;
}

describe('sanitizeStem (research R5)', () => {
    it('replaces illegal and control characters', () => {
        expect(sanitizeStem('a<b>c:d"e/f\\g|h?i*j')).toBe('a_b_c_d_e_f_g_h_i_j');
        expect(sanitizeStem('tab\there')).toBe('tab_here');
    });

    it('trims trailing dots and spaces and neutralizes leading dots', () => {
        expect(sanitizeStem('Name. . ')).toBe('Name');
        expect(sanitizeStem('.hidden')).toBe('_hidden');
        expect(sanitizeStem('.wiw-folder')).toBe('_wiw-folder');
    });

    it('suffixes Windows reserved names', () => {
        expect(sanitizeStem('CON')).toBe('CON_');
        expect(sanitizeStem('com1')).toBe('com1_');
        expect(sanitizeStem('Console')).toBe('Console');
    });

    it('caps the length and falls back to Untitled', () => {
        expect(sanitizeStem('x'.repeat(300))).toHaveLength(120);
        expect(sanitizeStem('   ')).toBe('Untitled');
        expect(sanitizeStem('...')).toBe('Untitled');
    });

    it('keeps non-Latin names readable', () => {
        expect(sanitizeStem('Королевство Альдермир')).toBe('Королевство Альдермир');
    });
});

describe('image sources', () => {
    it('derives the extension from data URIs and paths', () => {
        expect(imageExtFromSrc('data:image/png;base64,AAAA')).toBe('png');
        expect(imageExtFromSrc('data:image/jpeg;base64,AAAA')).toBe('jpg');
        expect(imageExtFromSrc('data:image/svg+xml,%3Csvg%3E')).toBe('svg');
        expect(imageExtFromSrc('user/images/WorldInfoWorkspace/map-1.webp')).toBe('webp');
        expect(imageExtFromSrc('/user/images/a.PNG?x=1')).toBe('png');
        expect(imageExtFromSrc('')).toBeNull();
    });

    it('treats only data URIs and same-origin paths as file-backed', () => {
        expect(imageHasFile('data:image/png;base64,AAAA')).toBe(true);
        expect(imageHasFile('user/images/WorldInfoWorkspace/a.png')).toBe(true);
        expect(imageHasFile('https://example.org/a.png')).toBe(false);
        expect(imageHasFile('//cdn.example.org/a.png')).toBe(false);
        expect(imageHasFile('')).toBe(false);
    });
});

describe('compareDiskNames (default order)', () => {
    it('puts folders first, then case-insensitive natural name order', () => {
        const names = [
            { name: 'b.md', isDir: false },
            { name: 'Zeta', isDir: true },
            { name: 'A.md', isDir: false },
            { name: 'alpha', isDir: true },
            { name: 'item 10.md', isDir: false },
            { name: 'item 2.md', isDir: false },
        ];
        expect([...names].sort(compareDiskNames).map((n) => n.name)).toEqual([
            'alpha',
            'Zeta',
            'A.md',
            'b.md',
            'item 2.md',
            'item 10.md',
        ]);
    });
});

describe('assignPaths', () => {
    it('maps folders to directories, entries to .md and file-backed images by extension', () => {
        const root = rootWith([
            folder('f1', 'Kingdoms', [entry('e1', 'Aldermeer'), image('i1', 'Map', 'data:image/png;base64,AA')]),
            image('i2', 'Remote', 'https://example.org/p.png'),
        ]);
        const paths = assignPaths(root, new Map(), '');
        expect(paths.get(root.id)).toBe('');
        expect(paths.get('f1')).toBe('Kingdoms');
        expect(paths.get('e1')).toBe('Kingdoms/Aldermeer.md');
        expect(paths.get('i1')).toBe('Kingdoms/Map.png');
        expect(paths.has('i2')).toBe(false);
    });

    it('resolves case-insensitive and sanitization collisions with (N) suffixes', () => {
        const root = rootWith([entry('e1', 'A/B'), entry('e2', 'a_b'), entry('e3', 'A_B')]);
        const paths = assignPaths(root, new Map(), '');
        expect(paths.get('e1')).toBe('A_B.md');
        expect(paths.get('e2')).toBe('a_b (2).md');
        expect(paths.get('e3')).toBe('A_B (3).md');
    });

    it('does not collide folders with entries of the same stem', () => {
        const root = rootWith([folder('f1', 'Lore'), entry('e1', 'Lore')]);
        const paths = assignPaths(root, new Map(), '');
        expect(paths.get('f1')).toBe('Lore');
        expect(paths.get('e1')).toBe('Lore.md');
    });

    it('keeps previous paths stable (no renaming churn)', () => {
        const root = rootWith([entry('e1', 'Same'), entry('e2', 'Same')]);
        const first = assignPaths(root, new Map(), '');
        // Reversing the child order must not swap the suffixes.
        root.children.reverse();
        const second = assignPaths(root, first, '');
        expect(second.get('e1')).toBe(first.get('e1'));
        expect(second.get('e2')).toBe(first.get('e2'));
    });

    it('keeps a previous user file named exactly like the item', () => {
        const root = rootWith([entry('e1', 'a:b')]);
        expect(assignPaths(root, new Map([['e1', 'a:b.md']]), '').get('e1')).toBe('a:b.md');
        expect(assignPaths(root, new Map(), '').get('e1')).toBe('a_b.md');
    });

    it('drops a stale previous path when the name changed', () => {
        const root = rootWith([entry('e1', 'Renamed')]);
        const paths = assignPaths(root, new Map([['e1', 'Old.md']]), '');
        expect(paths.get('e1')).toBe('Renamed.md');
    });

    it('places a subtree under a base directory', () => {
        const scope = folder('f1', 'Kingdoms', [entry('e1', 'Aldermeer')]);
        const paths = assignPaths(scope, new Map(), 'Kingdoms');
        expect(paths.get('f1')).toBe('Kingdoms');
        expect(paths.get('e1')).toBe('Kingdoms/Aldermeer.md');
    });
});
