import { describe, expect, it, vi } from 'vitest';
import { createImageGeneration, NO_PICTURE_MESSAGE } from '../../src/adapters/imageGeneration';
import { createDefaultState, createFolderNode, createImageNode, findNode, type ImageNode } from '../../src/core/state/schema';
import { WorkspaceStore } from '../../src/core/state/store';
import { bulkDeleteNodes } from '../../src/core/tree/operations';

/**
 * Spec 009 US1 (quickstart I1–I6): the generation adapter against a fake
 * `imagine` command and a fake image server. The fake server lists every file
 * under user/images/ so the file lifecycle (SC-002) is checked directly.
 */

function setup(options: { result?: (call: number) => string | Promise<string> } = {}) {
    const state = createDefaultState();
    const folder = createFolderNode({ id: 'f1', parentId: state.root.id, name: 'Cinderhollow', now: 't' });
    const image = createImageNode({ id: 'i1', parentId: 'f1', name: 'Cliff town', now: 't' });
    folder.children.push(image);
    state.root.children.push(folder);
    const store = new WorkspaceStore(state);
    const files = new Set<string>();
    const calls: Array<{ args: Record<string, unknown>; prompt: string }> = [];
    let count = 0;
    const imagine = {
        callback: vi.fn(async (args: Record<string, unknown>, prompt: string) => {
            calls.push({ args, prompt });
            count += 1;
            const url = await (options.result ?? ((n: number) => `/user/images/gen-${String(n)}.jpg`))(count);
            if (url !== '') {
                files.add(url.replace(/^\//, ''));
            }
            return url;
        }),
    };
    let uploads = 0;
    const generation = createImageGeneration({
        store,
        getImagine: () => imagine,
        fetchBytes: async (url) => {
            if (!files.has(url.replace(/^\//, ''))) {
                throw new Error('404');
            }
            return { bytes: new Uint8Array([1, 2, 3]), ext: 'jpg' };
        },
        upload: async ({ stem, ext }) => {
            uploads += 1;
            const path = `user/images/WorldInfoWorkspace/${stem}-${String(uploads)}.${ext}`;
            files.add(path);
            return path;
        },
        removeTemporary: async (url) => {
            files.delete(url.replace(/^\//, ''));
        },
        warn: () => undefined,
    });
    const image_ = (): ImageNode => findNode(store.getState(), 'i1') as ImageNode;
    return { store, generation, files, calls, imagine, image: image_ };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('image generation (spec 009 US1)', () => {
    it('calls imagine quietly, outside the gallery, without prompt extension', async () => {
        const { generation, calls } = setup();
        await generation.generate('i1', '  a mining town carved into a red cliff | /echo hi ');
        expect(calls[0]?.args).toMatchObject({ quiet: 'true', gallery: 'false', extend: 'false', multimodal: 'false' });
        expect(calls[0]?.args['_abortController']).toBeInstanceOf(EventTarget);
        expect(calls[0]?.prompt).toBe('a mining town carved into a red cliff | /echo hi');
    });

    it('a lone trigger word is sent as a plain prompt (I5)', async () => {
        const { generation, calls } = setup();
        await generation.generate('i1', 'you');
        expect(calls[0]?.prompt).toBe('you.');
    });

    it('offers a candidate; Keep stores it in our storage with the prompt and removes the temp file (I1, I2)', async () => {
        const { generation, files, image } = setup();
        await generation.generate('i1', 'red cliff');
        expect(generation.view('i1').candidate).toEqual({ prompt: 'red cliff', url: '/user/images/gen-1.jpg' });
        expect(image().src).toBe('');
        expect([...files].some((file) => file.startsWith('user/images/WorldInfoWorkspace/'))).toBe(false);
        expect(await generation.keep('i1')).toBe(true);
        await flush();
        expect(image().src).toBe('user/images/WorldInfoWorkspace/Cliff town-1.jpg');
        expect(image().prompt).toBe('red cliff');
        expect([...files]).toEqual(['user/images/WorldInfoWorkspace/Cliff town-1.jpg']);
        expect(generation.view('i1').candidate).toBeNull();
    });

    it('Discard leaves the item and the storage unchanged (I3, SC-002)', async () => {
        const { generation, files, image, store } = setup();
        const before = store.getState();
        await generation.generate('i1', 'red cliff');
        generation.discard('i1');
        await flush();
        expect(files.size).toBe(0);
        expect(store.getState()).toBe(before);
        expect(image().src).toBe('');
    });

    it('a new candidate replaces and removes the previous one', async () => {
        const { generation, files } = setup();
        await generation.generate('i1', 'one');
        await generation.generate('i1', 'two');
        await flush();
        expect([...files]).toEqual(['user/images/gen-2.jpg']);
        expect(generation.view('i1').candidate?.prompt).toBe('two');
    });

    it('an empty result is reported and changes nothing', async () => {
        const { generation, image } = setup({ result: () => '' });
        await generation.generate('i1', 'red cliff');
        expect(generation.view('i1')).toMatchObject({ candidate: null, running: null, error: NO_PICTURE_MESSAGE });
        expect(image().src).toBe('');
    });

    it('Stop aborts the request and drops a late result (I6)', async () => {
        let release: (url: string) => void = () => undefined;
        const { generation, files, calls } = setup({ result: () => new Promise<string>((resolve) => (release = resolve)) });
        const aborted = vi.fn();
        const pending = generation.generate('i1', 'red cliff');
        await flush();
        (calls[0]?.args['_abortController'] as EventTarget).addEventListener('abort', aborted);
        generation.stop('i1');
        expect(aborted).toHaveBeenCalledOnce();
        expect(generation.view('i1').running).toBeNull();
        release('/user/images/late.jpg');
        await pending;
        await flush();
        expect(generation.view('i1').candidate).toBeNull();
        expect(files.size).toBe(0);
    });

    it('deleting the item removes a pending candidate file', async () => {
        const { generation, files, store } = setup();
        await generation.generate('i1', 'red cliff');
        store.replace(bulkDeleteNodes(store.getState(), ['f1']) ?? store.getState());
        await flush();
        expect(files.size).toBe(0);
        expect(generation.view('i1').candidate).toBeNull();
    });

    it('a kept replacement leaves the old owned file to the existing cleanup', async () => {
        const { generation, image } = setup();
        await generation.generate('i1', 'one');
        await generation.keep('i1');
        const first = image().src;
        await generation.generate('i1', 'two');
        await generation.keep('i1');
        expect(image().src).not.toBe(first);
        expect(image().prompt).toBe('two');
    });
});
