// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SillyTavernContext, WorldInfoBook } from '../../src/global';
import { createWorldInfoAdapter } from '../../src/adapters/worldInfoAdapter';
import { createActiveBooksAdapter } from '../../src/adapters/activeBooksAdapter';
import { onSaveEvent } from '../../src/adapters/saveEvents';
import { createSyncEngine } from '../../src/adapters/syncEngine';
import { WorkspaceStore } from '../../src/core/state/store';
import { createDefaultState } from '../../src/core/state/schema';

interface CtxBundle {
    ctx: SillyTavernContext;
    saved: Array<{ name: string; data: WorldInfoBook; immediately?: boolean }>;
    events: Array<{ event: string; handler: (...args: unknown[]) => void }>;
}

interface CtxOverrides {
    names?: string[];
    saveError?: boolean;
}

function makeCtx(overrides: CtxOverrides = {}): CtxBundle {
    const saved: Array<{ name: string; data: WorldInfoBook; immediately?: boolean }> = [];
    const events: Array<{ event: string; handler: (...args: unknown[]) => void }> = [];
    const ctx = {
        eventSource: {
            on: (event: string, handler: (...args: unknown[]) => void): void => {
                events.push({ event, handler });
            },
            makeFirst: (): void => undefined,
            makeLast: (): void => undefined,
            removeListener: (): void => undefined,
            emit: async (): Promise<void> => undefined,
        },
        eventTypes: {
            APP_READY: 'app_ready',
            CHAT_CHANGED: 'chat_id_changed',
            GENERATION_STARTED: 'generation_started',
            SETTINGS_LOADED: 'settings_loaded',
            SETTINGS_UPDATED: 'settings_updated',
            EXTENSION_SETTINGS_LOADED: 'extension_settings_loaded',
            WORLDINFO_UPDATED: 'worldinfo_updated',
            WORLDINFO_SETTINGS_UPDATED: 'worldinfo_settings_updated',
        },
        extensionSettings: {},
        saveSettingsDebounced: (): void => undefined,
        uuidv4: (): string => `u-${Math.random()}`,
        getRequestHeaders: (): Record<string, string> => ({ 'X-CSRF-Token': 'token' }),
        loadWorldInfo: async (name: string): Promise<WorldInfoBook> => ({ entries: {}, name }),
        saveWorldInfo: async (
            name: string,
            data: WorldInfoBook,
            immediately?: boolean
        ): Promise<void> => {
            if (overrides.saveError) {
                throw new Error('save failed');
            }
            saved.push({ name, data, immediately });
        },
        updateWorldInfoList: async (): Promise<void> => undefined,
        getWorldInfoNames: (): string[] => [...(overrides.names ?? [])],
        callGenericPopup: async (): Promise<number | string | boolean | null> => 1,
        POPUP_TYPE: { TEXT: 1, CONFIRM: 2, INPUT: 3, DISPLAY: 4, CROP: 5 },
        POPUP_RESULT: { AFFIRMATIVE: 1, NEGATIVE: 0, CANCELLED: null },
        substituteParams: (text: string): string => text,
        powerUserSettings: {},
    } as unknown as SillyTavernContext;
    return { ctx, saved, events };
}

describe('worldInfoAdapter contract (native-wi-contract.md)', () => {
    let fetchCalls: Array<{ url: string; init: RequestInit | undefined }> = [];

    beforeEach(() => {
        fetchCalls = [];
        vi.stubGlobal(
            'fetch',
            async (url: string | URL, init?: RequestInit): Promise<Response> => {
                fetchCalls.push({ url: String(url), init });
                if (String(url) === '/api/files/sanitize-filename') {
                    const body = JSON.parse(String(init?.body)) as { fileName: string };
                    expect(Object.keys(body)).toEqual(['fileName']);
                    return {
                        ok: true,
                        json: async () => ({ fileName: body.fileName }),
                        text: async () => body.fileName,
                    } as unknown as Response;
                }
                return { ok: true, text: async () => '' } as Response;
            }
        );
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('createBook resolves a free name, saves an empty book immediately, refreshes the list', async () => {
        const { ctx, saved } = makeCtx({ names: ['Aldermeer'] });
        const adapter = createWorldInfoAdapter(ctx);
        const result = await adapter.createBook('Aldermeer');
        expect(result?.bookName).toBe('Aldermeer (1)');
        expect(saved).toHaveLength(1);
        expect(saved[0]?.name).toBe('Aldermeer (1)');
        expect(saved[0]?.immediately).toBe(true);
        expect((saved[0]?.data as { entries?: unknown }).entries).toBeDefined();
        expect(Object.keys(saved[0]?.data.entries ?? {})).toEqual([]);
        expect(fetchCalls.some((call) => call.url === '/api/files/sanitize-filename')).toBe(true);
    });

    it('saveBook hands over a distinct clone and tracks it as the last outbound payload', async () => {
        const { ctx, saved } = makeCtx();
        const adapter = createWorldInfoAdapter(ctx);
        const payload: WorldInfoBook = Object.freeze({ entries: {} });
        await adapter.saveBook('Book', payload, true);
        expect(saved).toHaveLength(1);
        expect(saved[0]?.data).not.toBe(payload);
        expect(Object.isFrozen(saved[0]?.data)).toBe(false);
        expect(adapter.getLastOutbound('Book')).toBe(saved[0]?.data);
        expect(adapter.getLastOutbound()).toBe(saved[0]?.data);
    });

    it('emits failure events when the app save rejects', async () => {
        const { ctx } = makeCtx({ saveError: true });
        const adapter = createWorldInfoAdapter(ctx);
        const failures: string[] = [];
        const off = onSaveEvent((event) => {
            if (event.kind === 'failure') {
                failures.push(event.message);
            }
        });
        await expect(adapter.saveBook('Book', { entries: {} }, true)).rejects.toThrow();
        expect(failures.length).toBeGreaterThan(0);
        off();
    });

    it('deleteBook posts to the app endpoint with app headers and refreshes the list', async () => {
        const { ctx } = makeCtx({ names: ['Book'] });
        const adapter = createWorldInfoAdapter(ctx);
        const ok = await adapter.deleteBook('Book');
        expect(ok).toBe(true);
        const deleteCall = fetchCalls.find((call) => call.url === '/api/worldinfo/delete');
        expect(deleteCall).toBeDefined();
        const headers = (deleteCall?.init?.headers ?? {}) as Record<string, string>;
        expect(headers['X-CSRF-Token']).toBe('token');
        expect(JSON.parse(String(deleteCall?.init?.body))).toEqual({ name: 'Book' });
    });

    it('renameBook saves a copy under the new name and deletes the old book', async () => {
        const { ctx, saved } = makeCtx({ names: ['Old'] });
        const adapter = createWorldInfoAdapter(ctx);
        const result = await adapter.renameBook('Old', 'New');
        expect(result?.bookName).toBe('New');
        expect(saved[0]?.name).toBe('New');
        expect(fetchCalls.some((call) => call.url === '/api/worldinfo/delete')).toBe(true);
    });
});

describe('activeBooksAdapter contract (FR-017)', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    // Native updateWorldInfoList builds `new Option(name, index)`: the value is an
    // index into world_names, the book name is the option TEXT.
    it('reads activation state from the native select by option text', () => {
        const select = document.createElement('select');
        select.id = 'world_info';
        select.multiple = true;
        select.innerHTML = '<option value="0" selected>A</option><option value="1">B</option>';
        document.body.appendChild(select);
        const adapter = createActiveBooksAdapter();
        expect(adapter.getActiveBooks()).toEqual(['A']);
    });

    it('drives activation by setting options and dispatching change', () => {
        const select = document.createElement('select');
        select.id = 'world_info';
        select.multiple = true;
        select.innerHTML = '<option value="0">A</option><option value="1">B</option>';
        document.body.appendChild(select);
        let changeEvents = 0;
        select.addEventListener('change', () => {
            changeEvents += 1;
        });
        const adapter = createActiveBooksAdapter();
        adapter.setActiveBooks(['B']);
        expect(adapter.getActiveBooks()).toEqual(['B']);
        // The native handler reads indices from .val().
        expect(Array.from(select.selectedOptions).map((option) => option.value)).toEqual(['1']);
        expect(changeEvents).toBe(1);
    });
});

describe('syncEngine event wiring (contract events table)', () => {
    it('subscribes to WORLDINFO_UPDATED and GENERATION_STARTED', () => {
        const { ctx, events } = makeCtx({});
        const store = new WorkspaceStore(createDefaultState());
        const adapter = createWorldInfoAdapter(ctx);
        createSyncEngine({ ctx, store, worldInfo: adapter });
        const subscribed = events.map((item) => item.event);
        expect(subscribed).toContain('worldinfo_updated');
        expect(subscribed).toContain('generation_started');
    });
});