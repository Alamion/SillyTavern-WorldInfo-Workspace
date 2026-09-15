import { describe, expect, it } from 'vitest';
import { createImageStore } from '../../src/adapters/imageStore';

interface Call {
    url: string;
    body: Record<string, unknown>;
    headers: unknown;
}

function makeStore(respond: (call: Call) => Response) {
    const calls: Call[] = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
        const call = { url, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>, headers: init?.headers };
        calls.push(call);
        return respond(call);
    }) as unknown as typeof fetch;
    const store = createImageStore({ getRequestHeaders: () => ({ 'X-CSRF-Token': 't' }), fetchFn });
    return { store, calls };
}

describe('imageStore adapter (FR-024)', () => {
    it('accepts only the app image storage formats', () => {
        const { store } = makeStore(() => new Response('{}'));
        for (const ext of ['bmp', 'png', 'jpg', 'jpeg', 'jfif', 'gif', 'webp', 'PNG']) {
            expect(store.accepts(ext)).toBe(true);
        }
        for (const ext of ['svg', 'avif', 'md', 'mp4']) {
            expect(store.accepts(ext)).toBe(false);
        }
    });

    it('uploads base64 into the WorldInfoWorkspace subfolder with a unique name', async () => {
        const { store, calls } = makeStore(
            () => new Response(JSON.stringify({ path: '/user/images/WorldInfoWorkspace/Map-abc123.png' }))
        );
        const src = await store.upload({ bytes: new Uint8Array([1, 2, 3]), ext: 'png', stem: 'Map' });
        expect(src).toBe('user/images/WorldInfoWorkspace/Map-abc123.png');
        expect(calls[0]?.url).toBe('/api/images/upload');
        expect(calls[0]?.headers).toEqual({ 'X-CSRF-Token': 't' });
        expect(calls[0]?.body).toMatchObject({ image: 'AQID', format: 'png', ch_name: 'WorldInfoWorkspace' });
        expect(String(calls[0]?.body['filename'])).toMatch(/^Map-[a-z0-9]{6}$/);
    });

    it('surfaces upload errors', async () => {
        const { store } = makeStore(() => new Response(JSON.stringify({ error: 'Invalid image format' }), { status: 400 }));
        await expect(store.upload({ bytes: new Uint8Array([1]), ext: 'png', stem: 'x' })).rejects.toThrow('Invalid image format');
    });

    it('recognizes owned sources with or without a leading slash', () => {
        const { store } = makeStore(() => new Response('{}'));
        expect(store.isOwned('user/images/WorldInfoWorkspace/a.png')).toBe(true);
        expect(store.isOwned('/user/images/WorldInfoWorkspace/a.png')).toBe(true);
        expect(store.isOwned('user/images/Seraphina/a.png')).toBe(false);
        expect(store.isOwned('data:image/png;base64,AA')).toBe(false);
    });

    it('deletes owned files, treats 404 as success, never deletes foreign sources', async () => {
        const { store, calls } = makeStore((call) =>
            new Response(null, { status: String(call.body['path']).includes('gone') ? 404 : 200 })
        );
        await store.remove('/user/images/WorldInfoWorkspace/a.png');
        await store.remove('user/images/WorldInfoWorkspace/gone.png');
        await store.remove('user/images/Seraphina/a.png');
        await store.remove('https://example.org/a.png');
        expect(calls.map((call) => call.body['path'])).toEqual([
            'user/images/WorldInfoWorkspace/a.png',
            'user/images/WorldInfoWorkspace/gone.png',
        ]);
        expect(calls.every((call) => call.url === '/api/images/delete')).toBe(true);
    });
});
