import { describe, expect, it, vi } from 'vitest';
import { createImageCaption, NotCaptionableError } from '../../src/adapters/imageCaption';
import { NO_VISION_MESSAGE } from '../../src/core/images/failures';
import { setImageSettings } from '../../src/core/images/settings';
import { createDefaultState, createEntryNode, createFolderNode, createImageNode, findNode, type ImageNode } from '../../src/core/state/schema';
import { WorkspaceStore } from '../../src/core/state/store';
import { FakeLlm } from '../support/fakeLlm';

/**
 * Spec 009 US2–US4 (quickstart I7–I10): prompt drafts, single captions and the
 * folder run against a scripted LLM port. Pictures are "prepared" by a fake.
 */

function setup(options: { recovery?: boolean; unreadable?: string[] } = {}) {
    let state = createDefaultState();
    const folder = createFolderNode({ id: 'f', parentId: state.root.id, name: 'Cities', now: 't' });
    const lore = createEntryNode({ id: 'e1', parentId: 'f', name: 'Cinderhollow', now: 't', nativeUid: 1 });
    lore.native.content = 'A mining town carved into red cliffs.';
    folder.children.push(lore);
    for (const id of ['a', 'b', 'c']) {
        const image = createImageNode({ id, parentId: 'f', name: `Picture ${id}`, now: 't' });
        image.src = `user/images/WorldInfoWorkspace/${id}.png`;
        folder.children.push(image);
    }
    const captioned = createImageNode({ id: 'd', parentId: 'f', name: 'Done', now: 't' });
    captioned.src = 'd.png';
    captioned.caption = 'Already';
    folder.children.push(captioned);
    state.root.children.push(folder);
    state = setImageSettings(state, { captionProfileId: 'p-router', captionModel: 'google/gemma-3-12b-it' });
    state.settings.assistant = { ...(state.settings.assistant ?? {}), profileId: 'p-router' } as typeof state.settings.assistant;
    const store = new WorkspaceStore(state);
    const llm = new FakeLlm();
    const sleeps: number[] = [];
    const caption = createImageCaption({
        store,
        llm,
        preparePicture: async (src) => {
            if (options.unreadable?.some((id) => src.includes(`/${id}.`))) {
                throw new NotCaptionableError('blocked');
            }
            return `data:image/jpeg;base64,${src}`;
        },
        isRecoveryPending: () => options.recovery === true,
        sleep: async (ms) => {
            sleeps.push(ms);
        },
    });
    const image = (id: string) => findNode(store.getState(), id) as ImageNode;
    return { store, llm, caption, image, sleeps };
}

describe('single caption (US3)', () => {
    it('sends the picture with the model override and offers a proposal', async () => {
        const { llm, caption, image } = setup();
        llm.reply("Here's a caption:\n\nA red cliff town.");
        await caption.writeCaption('a');
        expect(llm.requests[0]).toMatchObject({ profileId: 'p-router', model: 'google/gemma-3-12b-it' });
        expect(llm.requests[0]?.messages[0]?.images).toEqual(['data:image/jpeg;base64,user/images/WorldInfoWorkspace/a.png']);
        expect(caption.captionView('a')).toEqual({ running: false, proposal: 'A red cliff town.', error: null });
        expect(image('a').caption).toBe('');
        caption.keepCaption('a', ' A red cliff town at dusk. ');
        expect(image('a').caption).toBe('A red cliff town at dusk.');
        expect(caption.captionView('a').proposal).toBeNull();
    });

    it('a model that cannot see is explained (FR-016)', async () => {
        const { llm, caption } = setup();
        llm.reply("I'm sorry, I can't see the image.");
        await caption.writeCaption('a');
        expect(caption.captionView('a').error).toBe(NO_VISION_MESSAGE);
        llm.fail({ kind: 'empty', message: 'empty', retryable: true });
        await caption.writeCaption('a');
        expect(caption.captionView('a').error).toBe(NO_VISION_MESSAGE);
    });

    it('an unreadable picture is reported without a request', async () => {
        const { llm, caption } = setup({ unreadable: ['a'] });
        await caption.writeCaption('a');
        expect(llm.requests).toHaveLength(0);
        expect(caption.captionView('a').error).toContain('cannot be sent');
    });

    it('settings are not saved during a recovery', () => {
        const { caption } = setup({ recovery: true });
        expect(caption.updateSettings({ captionModel: 'x' })).toBe(false);
        expect(caption.settings().captionModel).toBe('google/gemma-3-12b-it');
    });
});

describe('prompt draft (US2)', () => {
    it('uses the assistant profile by default and returns the cleaned draft with its basis', async () => {
        const { llm, caption } = setup();
        llm.reply('Prompt: "red cliff mining town, lanterns, dusk"');
        const text = await caption.draftPrompt('a', 'at dusk');
        expect(text).toBe('red cliff mining town, lanterns, dusk');
        expect(llm.requests[0]).toMatchObject({ profileId: 'p-router', model: '' });
        expect(llm.requests[0]?.messages[1]?.content).toContain("The user's idea: at dusk");
        expect(caption.draftView('a').basis).toEqual([{ id: 'e1', name: 'Cinderhollow' }]);
    });

    it('a failure is shown and returns null; Stop clears quietly', async () => {
        const { llm, caption } = setup();
        llm.fail({ kind: 'provider', message: 'The provider rejected the request.', retryable: true });
        expect(await caption.draftPrompt('a', '')).toBeNull();
        expect(caption.draftView('a').error).toBe('The provider rejected the request.');
        llm.hang();
        const pending = caption.draftPrompt('a', '');
        caption.stopDraft('a');
        expect(await pending).toBeNull();
        expect(caption.draftView('a')).toEqual({ running: false, basis: null, error: null });
    });
});

describe('folder run (US4)', () => {
    it('captions only the uncaptioned images, one after another, and keeps the chosen ones in one update', async () => {
        const { llm, caption, store, image } = setup();
        expect(caption.countUncaptioned('f')).toBe(3);
        llm.reply('One.').reply('Two.').reply('Three.');
        await caption.startBulk('f');
        const view = caption.bulkView()!;
        expect(view.state).toBe('done');
        expect(view.items.map((item) => [item.imageId, item.state, item.text])).toEqual([
            ['a', 'ready', 'One.'],
            ['b', 'ready', 'Two.'],
            ['c', 'ready', 'Three.'],
        ]);
        const replace = vi.spyOn(store, 'replace');
        expect(caption.keepBulk(new Map([['a', 'One.'], ['c', 'Third, edited.']]))).toBe(2);
        expect(replace).toHaveBeenCalledOnce();
        expect([image('a').caption, image('b').caption, image('c').caption]).toEqual(['One.', '', 'Third, edited.']);
    });

    it('Stop sends nothing more; the rest is skipped', async () => {
        const { llm, caption } = setup();
        llm.reply('One.').hang();
        const run = caption.startBulk('f');
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));
        caption.stopBulk();
        await run;
        expect(llm.requests).toHaveLength(2);
        expect(caption.bulkView()?.state).toBe('stopped');
        expect(caption.bulkView()?.items.map((item) => item.state)).toEqual(['ready', 'skipped', 'skipped']);
    });

    it('rate limits retry twice with the assistant backoff, then fail visibly', async () => {
        const { llm, caption, sleeps } = setup();
        const limited = { kind: 'rate-limit' as const, message: 'Rate limited.', retryable: true };
        llm.fail(limited).reply('One.').fail(limited).fail(limited).fail(limited).reply('Three.');
        await caption.startBulk('f');
        expect(sleeps).toEqual([10000, 10000, 30000]);
        expect(caption.bulkView()?.items.map((item) => item.state)).toEqual(['ready', 'failed', 'ready']);
        expect(caption.bulkView()?.items[1]?.error).toBe('Rate limited.');
    });
});
