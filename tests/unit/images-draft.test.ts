import { describe, expect, it } from 'vitest';
import { buildPromptDraftRequest, cleanPromptReply } from '../../src/core/images/draftRequest';
import {
    createDefaultState,
    createEntryNode,
    createFolderNode,
    createImageNode,
    type FolderNode,
    type WorkspaceState,
} from '../../src/core/state/schema';
import { withSummary } from '../../src/core/tree/summary';

function entry(id: string, parent: string, name: string, content: string, extra: { summary?: string; disable?: boolean } = {}) {
    const node = createEntryNode({ id, parentId: parent, name, now: 't', nativeUid: Number(id.replace(/\D/g, '')) || 1 });
    node.native.content = content;
    node.native.disable = extra.disable === true;
    if (extra.summary !== undefined) {
        node.native = withSummary(node.native, extra.summary);
    }
    return node;
}

function world(): WorkspaceState {
    const state = createDefaultState();
    const geography = createFolderNode({ id: 'g', parentId: state.root.id, name: 'Geography', now: 't' });
    const cities = createFolderNode({ id: 'c', parentId: 'g', name: 'Cities', now: 't' });
    const districts = createFolderNode({ id: 'd', parentId: 'c', name: 'Districts', now: 't' });
    districts.children.push(entry('e3', 'd', 'Lantern Row', 'Lanterns everywhere.'));
    cities.children.push(
        districts,
        entry('e1', 'c', 'Cinderhollow', 'A mining town carved into red cliffs. Lanterns burn at dusk.', { summary: 'Cliff mining town.' }),
        entry('e2', 'c', 'Old mine', 'Closed.', { disable: true }),
        createImageNode({ id: 'i1', parentId: 'c', name: 'Cliff town', now: 't' })
    );
    const empty = createFolderNode({ id: 'x', parentId: 'g', name: 'Pictures', now: 't' });
    empty.children.push(createImageNode({ id: 'i2', parentId: 'x', name: 'Overview', now: 't' }));
    geography.children.push(entry('e4', 'g', 'The Lira', 'A river.'), cities, empty);
    (state.root as FolderNode).children.push(geography);
    return state;
}

const options = { idea: '', instruction: 'Write a prompt.', contextTokens: 2000 };

describe('buildPromptDraftRequest (spec 009 R4)', () => {
    it('direct entries first, then subfolders; disabled skipped; summary included', () => {
        const request = buildPromptDraftRequest(world(), 'i1', { ...options, idea: 'at night' })!;
        expect(request.basis.map((item) => item.name)).toEqual(['Cinderhollow', 'Lantern Row']);
        expect(request.messages[0]).toEqual({ role: 'system', content: 'Write a prompt.' });
        const user = request.messages[1]!.content;
        expect(user).toContain('Subject: Cliff town');
        expect(user).toContain("The user's idea: at night");
        expect(user).toContain('## Cinderhollow\nSummary: Cliff mining town.\nA mining town');
        expect(user.indexOf('Cinderhollow')).toBeLessThan(user.indexOf('Lantern Row'));
        expect(user).not.toContain('Old mine');
    });

    it("uses the parent folder's entries when the image's folder has none", () => {
        const request = buildPromptDraftRequest(world(), 'i2', options)!;
        expect(request.basis.map((item) => item.name)).toEqual(['The Lira', 'Lantern Row', 'Cinderhollow']);
    });

    it('cuts the last entry at a sentence end within the size limit', () => {
        const request = buildPromptDraftRequest(world(), 'i1', { ...options, contextTokens: 30 })!;
        // 30 tokens ≈ 105 chars: the header + first sentence of Cinderhollow fit, nothing after.
        expect(request.basis.map((item) => item.name)).toEqual(['Cinderhollow']);
        expect(request.messages[1]!.content).toContain('red cliffs.');
        expect(request.messages[1]!.content).not.toContain('Lanterns burn');
    });

    it('caption is included; no lore says so', () => {
        const state = createDefaultState();
        const image = createImageNode({ id: 'i9', parentId: state.root.id, name: 'Lonely', now: 't' });
        image.caption = 'A tower.';
        (state.root as FolderNode).children.push(image);
        const request = buildPromptDraftRequest(state, 'i9', options)!;
        expect(request.messages[1]!.content).toContain('Caption: A tower.');
        expect(request.messages[1]!.content).toContain('Lore: none available.');
        expect(request.basis).toEqual([]);
    });

    it('unknown or non-image id → null', () => {
        expect(buildPromptDraftRequest(world(), 'e1', options)).toBeNull();
        expect(buildPromptDraftRequest(world(), 'nope', options)).toBeNull();
    });
});

describe('cleanPromptReply', () => {
    it('strips fences, labels, quotes and later paragraphs', () => {
        expect(cleanPromptReply('```\nred cliff, lanterns\n```')).toBe('red cliff, lanterns');
        expect(cleanPromptReply('Prompt: red cliff, dusk')).toBe('red cliff, dusk');
        expect(cleanPromptReply('**Image prompt:** red cliff')).toBe('red cliff');
        expect(cleanPromptReply('"red cliff, dusk"\n\nThis prompt shows the town.')).toBe('red cliff, dusk');
        expect(cleanPromptReply('  plain text  ')).toBe('plain text');
    });
});
