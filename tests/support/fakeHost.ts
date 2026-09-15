// @vitest-environment jsdom
import { vi } from 'vitest';
import type { SillyTavernContext, WorldInfoBook } from '../../src/global';
import { createDefaultState } from '../../src/core/state/schema';
import { WorkspaceStore } from '../../src/core/state/store';
import { createWorldInfoAdapter } from '../../src/adapters/worldInfoAdapter';
import { createSyncEngine, type SyncEngine } from '../../src/adapters/syncEngine';

/**
 * Shared integration harness: the REAL sync engine + adapters driven against a
 * host fake that mirrors the app's verified mechanics (spec 003 research R1).
 * Used by the sync-engine scenarios and by the assistant apply/undo tests.
 */

export const EVENTS = {
    APP_READY: 'app_ready',
    CHAT_CHANGED: 'chat_id_changed',
    GENERATION_STARTED: 'generation_started',
    SETTINGS_LOADED: 'settings_loaded',
    SETTINGS_UPDATED: 'settings_updated',
    EXTENSION_SETTINGS_LOADED: 'extension_settings_loaded',
    WORLDINFO_UPDATED: 'worldinfo_updated',
    WORLDINFO_SETTINGS_UPDATED: 'worldinfo_settings_updated',
} as const;

type Handler = (...args: unknown[]) => void;

export class FakeHost {
    books = new Map<string, WorldInfoBook>();
    world_names: string[] = [];
    extensionSettings: Record<string, unknown> = {};
    savedSettings = 0;
    private handlers = new Map<string, Set<Handler>>();

    eventTypes = EVENTS;

    eventSource = {
        on: (event: string, handler: Handler): void => {
            const set = this.handlers.get(event) ?? new Set<Handler>();
            set.add(handler);
            this.handlers.set(event, set);
        },
        makeFirst: (): void => undefined,
        makeLast: (): void => undefined,
        removeListener: (event: string, handler: Handler): void => {
            this.handlers.get(event)?.delete(handler);
        },
        emit: async (event: string, ...args: unknown[]): Promise<void> => {
            for (const handler of [...(this.handlers.get(event) ?? [])]) {
                handler(...args);
            }
        },
    };

    saveSettingsDebounced = (): void => {
        this.savedSettings += 1;
    };

    uuidv4 = (): string => `u-${(this.uuidCounter += 1)}`;
    private uuidCounter = 0;

    getRequestHeaders = (): Record<string, string> => ({});

    // cloneOnGet: true (StructuredCloneMap)
    loadWorldInfo = async (name: string): Promise<WorldInfoBook | null> => {
        const book = this.books.get(name);
        return book ? (structuredClone(book) as WorldInfoBook) : null;
    };

    /** Simulated network outage: saves update the cache, then the fetch throws. */
    offline = false;
    /** What the server actually holds (successful saves only). */
    server = new Map<string, WorldInfoBook>();

    // Native _save order (world-info.js): cache set BEFORE the fetch; the fetch
    // rejects on a network failure, so WORLDINFO_UPDATED is never emitted then.
    // cloneOnSet: false — cache keeps the caller's reference; emit same reference.
    saveWorldInfo = async (name: string, data: WorldInfoBook): Promise<void> => {
        this.books.set(name, data);
        if (this.offline) {
            throw new TypeError('NetworkError when attempting to fetch resource.');
        }
        this.server.set(name, structuredClone(data));
        await this.eventSource.emit(EVENTS.WORLDINFO_UPDATED, name, data);
    };

    updateWorldInfoList = async (): Promise<void> => {
        this.world_names = [...this.books.keys()];
    };

    getWorldInfoNames = (): string[] => [...this.world_names];

    callGenericPopup = async (): Promise<number | null> => 1;
    POPUP_TYPE = { TEXT: 1, CONFIRM: 2, INPUT: 3, DISPLAY: 4, CROP: 5 };
    POPUP_RESULT = { AFFIRMATIVE: 1, NEGATIVE: 0, CANCELLED: null };
    substituteParams = (text: string): string => text;
    powerUserSettings = {};

    /** Simulates a NATIVE editor save (different object reference). */
    async nativeSave(name: string, mutate: (book: WorldInfoBook) => void): Promise<void> {
        const current = await this.loadWorldInfo(name);
        if (!current) {
            throw new Error(`nativeSave: unknown book ${name}`);
        }
        mutate(current);
        this.books.set(name, current); // host cache stores the emitted object
        await this.eventSource.emit(EVENTS.WORLDINFO_UPDATED, name, current);
    }
}

export interface Rig {
    host: FakeHost;
    ctx: SillyTavernContext;
    store: WorkspaceStore;
    engine: SyncEngine;
    advanceTimers(ms?: number): Promise<void>;
}

export function buildRig(): Rig {
    const host = new FakeHost();
    const ctx = host as unknown as SillyTavernContext;
    const store = new WorkspaceStore(createDefaultState());
    const worldInfo = createWorldInfoAdapter(ctx);
    const engine = createSyncEngine({ ctx, store, worldInfo });
    return {
        host,
        ctx,
        store,
        engine,
        advanceTimers: async (ms = 1100) => {
            await vi.advanceTimersByTimeAsync(ms);
        },
    };
}

