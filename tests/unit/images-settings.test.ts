import { describe, expect, it } from 'vitest';
import {
    DEFAULT_CAPTION_INSTRUCTION,
    DEFAULT_IMAGE_SETTINGS,
    getImageSettings,
    repairImageSettings,
    setImageSettings,
} from '../../src/core/images/settings';
import { createDefaultState, migrate } from '../../src/core/state/schema';

describe('image settings (spec 009 data-model)', () => {
    it('defaults when absent or invalid', () => {
        expect(repairImageSettings(undefined)).toEqual(DEFAULT_IMAGE_SETTINGS);
        expect(repairImageSettings('nope')).toEqual(DEFAULT_IMAGE_SETTINGS);
        expect(getImageSettings(createDefaultState())).toEqual(DEFAULT_IMAGE_SETTINGS);
    });

    it('repairs field by field', () => {
        const repaired = repairImageSettings({
            captionProfileId: 42,
            captionModel: '  google/gemma-3-12b-it ',
            captionInstruction: '   ',
            promptProfileId: 'p1',
            promptModel: 7,
            promptContextTokens: 99999,
        });
        expect(repaired).toMatchObject({
            captionProfileId: null,
            captionModel: 'google/gemma-3-12b-it',
            captionInstruction: DEFAULT_CAPTION_INSTRUCTION,
            promptProfileId: 'p1',
            promptModel: '',
            promptContextTokens: 16000,
        });
        expect(repairImageSettings({ promptContextTokens: 5 }).promptContextTokens).toBe(200);
        expect(repairImageSettings({ promptContextTokens: Number.NaN }).promptContextTokens).toBe(2000);
    });

    it('setImageSettings merges a patch and keeps the rest', () => {
        const state = setImageSettings(createDefaultState(), { captionProfileId: 'cap' });
        const next = setImageSettings(state, { captionModel: 'm' });
        expect(getImageSettings(next)).toMatchObject({ captionProfileId: 'cap', captionModel: 'm' });
    });
});

describe('ImageNode.prompt migration (spec 009 persistence delta)', () => {
    const payload = (prompt: unknown) => {
        const state = createDefaultState();
        const image: Record<string, unknown> = {
            id: 'img1',
            parentId: state.root.id,
            kind: 'image',
            name: 'Cliff town',
            createdAt: 'x',
            updatedAt: 'x',
            src: '',
            caption: '',
            sync: { books: {} },
        };
        if (prompt !== undefined) {
            image.prompt = prompt;
        }
        return JSON.parse(JSON.stringify({ ...state, root: { ...state.root, children: [image] }, settings: { ...state.settings, images: { captionModel: 'm' } } })) as unknown;
    };

    it('keeps a string prompt, drops a non-string one, leaves absent absent', () => {
        const kept = migrate(payload('red cliff at dusk'));
        expect(kept.root.children[0]).toMatchObject({ prompt: 'red cliff at dusk' });
        expect(getImageSettings(kept).captionModel).toBe('m');
        const dropped = migrate(payload(12));
        expect('prompt' in dropped.root.children[0]!).toBe(false);
        const absent = migrate(payload(undefined));
        expect('prompt' in absent.root.children[0]!).toBe(false);
        expect(absent._recovered).toBeUndefined();
    });
});
