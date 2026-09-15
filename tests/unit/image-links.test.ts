import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../../src/core/preview';
import { createDemoState } from '../../src/core/demo/dataset';
import { resolveImageReference } from '../../src/core/tree/imageLinks';
import { buildNodeIndex, type TreeNode } from '../../src/core/state/schema';
import { entryNode, folderNode, imageNode, stateWith } from '../support/mdFixtures';

function tree() {
    const state = stateWith([
        folderNode('geo', 'Geography', [
            imageNode('map', 'Aldermeer map sketch', 'data:image/svg+xml,%3Csvg%2F%3E'),
            folderNode('cities', 'Cities', [entryNode('bristle', 'Bristlemark')]),
        ]),
        folderNode('other', 'Other', [
            imageNode('map-far', 'Aldermeer map sketch', 'https://far/away.png'),
            entryNode('elsewhere', 'Elsewhere'),
        ]),
        imageNode('crest', 'Crest.png', 'user/images/WorldInfoWorkspace/crest.png'),
    ]);
    const index = buildNodeIndex(state.root);
    const resolve = (from: string | null, ref: string) => resolveImageReference(state.root, index, from, ref);
    return { state, resolve };
}

describe('resolveImageReference', () => {
    it('resolves legacy img:<id> references', () => {
        expect(tree().resolve('bristle', 'img:map')).toBe('data:image/svg+xml,%3Csvg%2F%3E');
        expect(tree().resolve('bristle', 'img:missing')).toBeUndefined();
    });

    it('resolves names with spaces, extensions, paths, angle brackets and URI encoding', () => {
        const { resolve } = tree();
        for (const ref of ['Aldermeer map sketch', 'Aldermeer map sketch.svg', 'Geography/Aldermeer map sketch.svg', '<Aldermeer map sketch>', 'Aldermeer%20map%20sketch.svg', 'aldermeer MAP sketch']) {
            expect(resolve('bristle', ref), ref).toBe('data:image/svg+xml,%3Csvg%2F%3E');
        }
        expect(resolve('bristle', 'Crest')).toBe('user/images/WorldInfoWorkspace/crest.png');
    });

    it('prefers the image closest to the entry', () => {
        const { resolve } = tree();
        expect(resolve('elsewhere', 'Aldermeer map sketch')).toBe('https://far/away.png');
        expect(resolve('bristle', 'Aldermeer map sketch')).toBe('data:image/svg+xml,%3Csvg%2F%3E');
    });

    it('passes direct sources through', () => {
        const { resolve } = tree();
        expect(resolve('bristle', 'https://x/y.png')).toBe('https://x/y.png');
        expect(resolve('bristle', 'user/images/a.png')).toBe('user/images/a.png');
    });
});

describe('preview image syntax', () => {
    const { resolve } = tree();
    const render = (source: string): string => renderMarkdown(source, { resolveImage: (ref) => resolve('bristle', ref) });

    it('renders markdown images whose reference contains spaces', () => {
        expect(render('![Aldermeer sketch](Aldermeer map sketch)')).toContain('<img src="data:image/svg+xml');
        expect(render('![Sketch](<Aldermeer map sketch.svg>)')).toContain('<img src="data:image/svg+xml');
    });

    it('renders Obsidian embeds', () => {
        const html = render('![[Aldermeer map sketch.svg|Map]]');
        expect(html).toContain('<img src="data:image/svg+xml');
        expect(html).toContain('alt="Map"');
    });

    it('keeps links working next to images and marks missing images', () => {
        const html = render('![x](Nope) and [docs](https://docs.example)');
        expect(html).toContain('[missing image: Nope]');
        expect(html).toContain('<a href="https://docs.example"');
    });
});

describe('demo dataset image references', () => {
    it('rewrites sample ids to names that resolve after ids are regenerated', () => {
        let n = 0;
        const state = createDemoState(() => `demo-${n++}`);
        const index = buildNodeIndex(state.root);
        const withImages = [...index.values()].filter(
            (node): node is Extract<TreeNode, { kind: 'entry' }> => node.kind === 'entry' && /!\[/.test(node.native.content)
        );
        expect(withImages.length).toBeGreaterThan(0);
        for (const entry of withImages) {
            expect(entry.native.content).not.toMatch(/img:/);
            const html = renderMarkdown(entry.native.content, {
                resolveImage: (ref) => resolveImageReference(state.root, index, entry.id, ref),
            });
            expect(html, entry.name).not.toContain('wiw-md-missing-image');
            expect(html).toContain('<img src=');
        }
    });
});
