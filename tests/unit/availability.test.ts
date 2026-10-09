import { describe, expect, it } from 'vitest';
import { computeAvailability, describeUnavailable, type AvailabilityFacts } from '../../src/core/availability';

const ready: AvailabilityFacts = {
    connectionManager: 'enabled',
    profiles: [
        { id: 'cc', api: 'chat-completion' },
        { id: 'tc', api: 'text-completion' },
    ],
    assistantProfileId: 'cc',
    pickingProfileId: null,
    captionProfileId: 'cc',
    promptProfileId: null,
    imageGeneration: 'enabled',
    imageSource: 'openrouter',
    folderAccess: 'ok',
};

const with_ = (patch: Partial<AvailabilityFacts>) => computeAvailability({ ...ready, ...patch });

describe('computeAvailability (spec 009 R6)', () => {
    it('everything ready', () => {
        const all = computeAvailability(ready);
        expect(Object.values(all).every((state) => state.ok)).toBe(true);
    });

    it('Connection Manager disabled marks every profile feature, with reload', () => {
        const all = with_({ connectionManager: 'disabled' });
        for (const id of ['assistant', 'picking', 'image-prompt', 'image-caption'] as const) {
            expect(all[id]).toMatchObject({ ok: false, reload: true });
            expect(describeUnavailable(all[id])).toContain('Connection Manager');
        }
        expect(all['image-generate'].ok).toBe(true);
        expect(all['md-folders'].ok).toBe(true);
    });

    it('Connection Manager missing differs from disabled', () => {
        expect(with_({ connectionManager: 'missing' }).assistant).toMatchObject({ ok: false, reason: expect.stringContaining('not available') });
    });

    it('no profiles at all', () => {
        expect(with_({ profiles: [] }).assistant).toMatchObject({ ok: false, reason: 'No connection profile exists yet.' });
    });

    it('chosen profile missing or none chosen', () => {
        expect(with_({ assistantProfileId: 'gone' }).assistant).toMatchObject({ ok: false, reason: expect.stringContaining('no longer exists') });
        expect(with_({ assistantProfileId: null }).assistant).toMatchObject({ ok: false, reason: expect.stringContaining('No connection profile is chosen') });
    });

    it('picking and prompt drafting fall back to the assistant profile', () => {
        expect(with_({ assistantProfileId: null }).picking.ok).toBe(false);
        expect(with_({ assistantProfileId: null, pickingProfileId: 'cc' }).picking.ok).toBe(true);
        expect(with_({ assistantProfileId: null })['image-prompt'].ok).toBe(false);
        expect(with_({ assistantProfileId: null, promptProfileId: 'tc' })['image-prompt'].ok).toBe(true);
    });

    it('captions need their own chat-completion profile', () => {
        expect(with_({ captionProfileId: null })['image-caption']).toMatchObject({ ok: false, fix: expect.stringContaining('Image settings') });
        expect(with_({ captionProfileId: 'tc' })['image-caption']).toMatchObject({ ok: false, reason: expect.stringContaining('Chat Completion') });
    });

    it('image generation: disabled, missing, no source', () => {
        expect(with_({ imageGeneration: 'disabled' })['image-generate']).toMatchObject({ ok: false, reload: true });
        expect(with_({ imageGeneration: 'missing' })['image-generate']).toMatchObject({ ok: false, reload: true });
        expect(with_({ imageSource: '' })['image-generate']).toMatchObject({ ok: false, reason: expect.stringContaining('source') });
    });

    it('folder access: every failure has its own reason', () => {
        const reasons = (['insecure', 'no-picker', 'framed', 'blocked'] as const).map((fact) => {
            const state = with_({ folderAccess: fact })['md-folders'];
            expect(state.ok).toBe(false);
            return state.ok ? '' : state.reason;
        });
        expect(new Set(reasons).size).toBe(4);
        expect(reasons[2]).toContain('inside another page');
    });

    it('describeUnavailable joins reason, fix and the reload note', () => {
        expect(describeUnavailable({ ok: true })).toBe('');
        expect(describeUnavailable({ ok: false, reason: 'R.', fix: 'F.', reload: true })).toBe(
            'R. F. Reload the page after enabling an extension.'
        );
    });
});
