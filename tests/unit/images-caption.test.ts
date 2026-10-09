import { describe, expect, it } from 'vitest';
import { buildCaptionRequest, cleanCaptionReply, selectUncaptioned } from '../../src/core/images/captionRequest';
import { classifyCaptionFailure, isBlindReply, NO_VISION_MESSAGE } from '../../src/core/images/failures';
import { createDefaultState, createFolderNode, createImageNode, type FolderNode } from '../../src/core/state/schema';

describe('caption requests (spec 009 R3)', () => {
    it('one user message with the instruction and the picture', () => {
        const image = createImageNode({ id: 'i', parentId: 'r', name: 'Cliff town', now: 't' });
        expect(buildCaptionRequest(image, 'data:image/jpeg;base64,AA', 'Describe it.')).toEqual([
            { role: 'user', content: 'Describe it.\n\nPicture name: Cliff town', images: ['data:image/jpeg;base64,AA'] },
        ]);
    });

    it('cleans preambles, labels and quotes', () => {
        expect(cleanCaptionReply("Here's a one-sentence caption for the image:\n\nA red cliff town at dusk.")).toBe(
            'A red cliff town at dusk.'
        );
        expect(cleanCaptionReply('Caption: "A mask split in two."')).toBe('A mask split in two.');
        expect(cleanCaptionReply('  A river map.  ')).toBe('A river map.');
    });
});

describe('caption failures (FR-016)', () => {
    it('empty replies and image-related provider rejections mean no vision', () => {
        expect(classifyCaptionFailure({ kind: 'empty', message: 'x', retryable: true })).toEqual({
            kind: 'no-vision',
            message: NO_VISION_MESSAGE,
        });
        expect(
            classifyCaptionFailure({
                kind: 'provider',
                message: 'The provider rejected the request.',
                detail: '404 No endpoints found that support image input',
                retryable: true,
            }).kind
        ).toBe('no-vision');
        // What the page actually receives for a text-only model on OpenRouter (live 2026-10-09).
        expect(
            classifyCaptionFailure({
                kind: 'provider',
                message: 'The provider rejected the request.',
                detail: 'API request failed: Not Found',
                retryable: true,
            }).kind
        ).toBe('no-vision');
    });

    it('rate limits and network problems are retryable; the rest is passed on', () => {
        expect(classifyCaptionFailure({ kind: 'rate-limit', message: 'slow down', retryable: true }).kind).toBe('retryable');
        expect(classifyCaptionFailure({ kind: 'network', message: 'offline', retryable: true }).kind).toBe('retryable');
        expect(classifyCaptionFailure({ kind: 'provider', message: '402 credits', retryable: true })).toEqual({
            kind: 'other',
            message: '402 credits',
        });
    });

    it('recognizes replies of a model that never saw the picture', () => {
        expect(isBlindReply("I'm sorry, but I can't see the image you attached.")).toBe(true);
        expect(isBlindReply('I am unable to view images.')).toBe(true);
        expect(isBlindReply('A lantern-lit town on a cliff.')).toBe(false);
    });
});

describe('selectUncaptioned (US4)', () => {
    it('images at any depth with a picture and an empty caption, in tree order', () => {
        const state = createDefaultState();
        const folder = createFolderNode({ id: 'f', parentId: state.root.id, name: 'Maps', now: 't' });
        const sub = createFolderNode({ id: 's', parentId: 'f', name: 'Old', now: 't' });
        const a = createImageNode({ id: 'a', parentId: 'f', name: 'A', now: 't' });
        a.src = 'user/images/WorldInfoWorkspace/a.png';
        const b = createImageNode({ id: 'b', parentId: 'f', name: 'B', now: 't' });
        b.src = 'x.png';
        b.caption = 'Has one';
        const c = createImageNode({ id: 'c', parentId: 's', name: 'C', now: 't' });
        c.src = 'c.png';
        c.caption = '   ';
        const d = createImageNode({ id: 'd', parentId: 's', name: 'D', now: 't' });
        sub.children.push(c, d);
        folder.children.push(a, b, sub);
        (state.root as FolderNode).children.push(folder);
        expect(selectUncaptioned(state, 'f').map((image) => image.id)).toEqual(['a', 'c']);
        expect(selectUncaptioned(state, 'a')).toEqual([]);
    });
});
