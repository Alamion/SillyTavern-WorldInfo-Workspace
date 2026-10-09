import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPickingController, PICK_EXTRA_KEY, type PickRecord } from '../../src/adapters/pickingController';
import { WorkspaceStore } from '../../src/core/state/store';
import { createDefaultNativeEntry, createDefaultState, createEntryNode, createFolderNode } from '../../src/core/state/schema';
import type { ActiveWorldInfoEntry, SillyTavernChatMessage, SillyTavernContext } from '../../src/global';
import { FAKE_PROFILE, FakeLlm } from '../support/fakeLlm';

/**
 * Main-chat picking against a fake host that mirrors the app's mechanics
 * (research R9): the interceptor is awaited before the World Info scan; forced
 * activation stores the PASSED objects; WORLDINFO_ENTRIES_LOADED carries the
 * active entries; MESSAGE_RECEIVED / WORLD_INFO_ACTIVATED follow the scan.
 */

const TYPES = {
    WORLDINFO_FORCE_ACTIVATE: 'worldinfo_force_activate',
    WORLDINFO_ENTRIES_LOADED: 'worldinfo_entries_loaded',
    WORLD_INFO_ACTIVATED: 'world_info_activated',
    MESSAGE_RECEIVED: 'message_received',
    CHARACTER_MESSAGE_RENDERED: 'character_message_rendered',
    CHAT_CHANGED: 'chat_id_changed',
    WORLDINFO_SETTINGS_UPDATED: 'worldinfo_settings_updated',
    WORLDINFO_UPDATED: 'worldinfo_updated',
};

function entry(uid: number, comment: string, keys: string[], extra: Partial<ActiveWorldInfoEntry> = {}): ActiveWorldInfoEntry {
    return { ...createDefaultNativeEntry(uid), comment, key: keys, content: `${comment} lore.`, world: 'Book', position: 4, ...extra };
}

class FakeHostContext {
    handlers = new Map<string, Array<(...args: unknown[]) => void>>();
    forced: unknown[][] = [];
    chat: SillyTavernChatMessage[] = [{ name: 'User', is_user: true, mes: 'Hello.' }];
    chatMetadata: Record<string, unknown> = {};
    chatId = 'chat-1';
    active: ActiveWorldInfoEntry[] = [entry(1, 'Selene', ['selene']), entry(2, 'Harbor', ['harbor']), entry(3, 'Old', ['old'], { disable: true })];
    dryScans = 0;
    eventTypes = TYPES;
    eventSource = {
        on: (event: string, handler: (...args: unknown[]) => void) => {
            this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
        },
        removeListener: () => undefined,
        emit: async (event: string, ...args: unknown[]) => {
            if (event === TYPES.WORLDINFO_FORCE_ACTIVATE) {
                this.forced.push(args[0] as unknown[]);
            }
            for (const handler of this.handlers.get(event) ?? []) {
                handler(...args);
            }
        },
    };
    getCurrentChatId = () => this.chatId;
    saveMetadataDebounced = vi.fn();
    getWorldInfoPrompt = async () => {
        this.dryScans += 1;
        await this.eventSource.emit(TYPES.WORLDINFO_ENTRIES_LOADED, { globalLore: this.active, characterLore: [], chatLore: [], personaLore: [] });
    };
}

function setup(options: { enabled?: boolean } = {}) {
    const host = new FakeHostContext();
    const llm = new FakeLlm();
    const state = createDefaultState();
    const root = createFolderNode({ id: 'R', parentId: state.root.id, name: 'Lore', now: 'x' });
    root.isWiRoot = true;
    root.book = { bookName: 'Book', orphans: [], tombstones: [] };
    const people = createFolderNode({ id: 'P', parentId: 'R', name: 'People', now: 'x' });
    const selene = createEntryNode({ id: 'n1', parentId: 'P', name: 'Selene', now: 'x', nativeUid: 1 });
    selene.sync.books['Book'] = { uid: 1, hash: null, status: 'in-sync' };
    people.children.push(selene);
    root.children.push(people);
    state.root.children.push(root);
    state.settings.assistant = { ...(state.settings.assistant ?? {}), profileId: FAKE_PROFILE.id } as never;
    state.settings.picking = { defaultEnabled: options.enabled ?? true, timeoutSec: 5 };
    const store = new WorkspaceStore(state);
    const emitted: Array<{ event: string; payload: unknown }> = [];
    const notices: string[] = [];
    const recorded: number[] = [];
    const controller = createPickingController({
        context: () => host as unknown as SillyTavernContext,
        store,
        llm,
        emit: (event, payload) => emitted.push({ event, payload }),
        notice: (message) => notices.push(message),
        now: () => Date.now(),
        onRecorded: (id) => recorded.push(id),
        isRecoveryPending: () => false,
    });
    controller.start();
    return { host, llm, store, controller, emitted, notices, recorded };
}

/** One generation the way the app runs it: interceptor → scan → reply received. */
async function generate(rig: ReturnType<typeof setup>, type = 'normal', activated: Array<{ world: string; uid: number }> = []) {
    await rig.controller.interceptor(rig.host.chat, 8192, () => undefined, type);
    await rig.host.eventSource.emit(TYPES.WORLD_INFO_ACTIVATED, activated);
    rig.host.chat.push({ name: 'Bot', is_user: false, mes: 'Reply.', swipe_id: 0, swipe_info: [{}] });
    await rig.host.eventSource.emit(TYPES.MESSAGE_RECEIVED, rig.host.chat.length - 1, type);
}

beforeEach(() => {
    vi.useFakeTimers();
});
afterEach(() => {
    vi.useRealTimers();
});

describe('main-chat picking (spec 007 US5)', () => {
    it('off: zero model calls and zero forced activations (SC-005)', async () => {
        const rig = setup({ enabled: false });
        await generate(rig);
        await rig.host.eventSource.emit(TYPES.CHARACTER_MESSAGE_RENDERED, 1, 'normal');
        expect(rig.llm.requests).toHaveLength(0);
        expect(rig.host.forced).toHaveLength(0);
        expect(rig.emitted).toHaveLength(0);
    });

    it('fresh pick: forces complete entry objects, records the pick on the reply, emits the hook', async () => {
        const rig = setup();
        rig.llm.reply('<pick id="e1">Selene is mentioned</pick>');
        rig.host.chat.push({ name: 'User', is_user: true, mes: 'Selene, are you there?' });
        await generate(rig, 'normal', [{ world: 'Book', uid: 1 }]);
        expect(rig.llm.requests).toHaveLength(1);
        expect(rig.host.forced).toHaveLength(1);
        expect(rig.host.forced[0]).toMatchObject([{ world: 'Book', uid: 1, comment: 'Selene', position: 4, decorators: [] }]);
        const record = rig.host.chat.at(-1)?.extra?.[PICK_EXTRA_KEY] as PickRecord;
        expect(record).toMatchObject({ v: 1, source: 'fresh', picked: [{ book: 'Book', uid: 1, name: 'Selene', reason: 'Selene is mentioned', inserted: true }] });
        expect(rig.host.chat.at(-1)?.swipe_info?.[0]?.extra?.[PICK_EXTRA_KEY]).toEqual(record);
        expect(rig.emitted[0]).toMatchObject({ event: 'wi-workspace:pick-completed', payload: { chatId: 'chat-1', source: 'fresh', picked: [{ book: 'Book', uid: 1 }] } });
        expect(rig.recorded).toEqual([rig.host.chat.length - 1]);
    });

    it('disabled entries and entries under an excluded folder are never offered', async () => {
        const rig = setup();
        rig.store.update((draft) => {
            const lore = draft.root.children[0];
            if (lore?.kind === 'folder' && lore.children[0]?.kind === 'folder') {
                lore.children[0].pickExcluded = true;
            }
        });
        rig.llm.reply('<none/>');
        await generate(rig);
        const catalog = rig.llm.requests[0]?.messages[1]?.content ?? '';
        expect(catalog).toContain('Harbor');
        expect(catalog).not.toContain('Selene');
        expect(catalog).not.toContain('Old');
    });

    it('uses the pick prepared after the last reply without a model call when nothing new is named', async () => {
        const rig = setup();
        rig.llm.reply('<pick id="e2">harbor</pick>');
        await rig.host.eventSource.emit(TYPES.CHARACTER_MESSAGE_RENDERED, 0, 'normal');
        await vi.waitFor(() => expect(rig.llm.requests).toHaveLength(1));
        await vi.advanceTimersByTimeAsync(0);
        rig.host.chat.push({ name: 'User', is_user: true, mes: 'We walk on.' });
        await generate(rig);
        expect(rig.llm.requests).toHaveLength(1);
        expect((rig.host.chat.at(-1)?.extra?.[PICK_EXTRA_KEY] as PickRecord).source).toBe('prepared');
    });

    it('runs a fresh pick when the new text names an entry the prepared pick lacks', async () => {
        const rig = setup();
        rig.llm.reply('<pick id="e2">harbor</pick>').reply('<pick id="e1">Selene</pick>');
        await rig.host.eventSource.emit(TYPES.CHARACTER_MESSAGE_RENDERED, 0, 'normal');
        await vi.waitFor(() => expect(rig.llm.requests).toHaveLength(1));
        await vi.advanceTimersByTimeAsync(0);
        rig.host.chat.push({ name: 'User', is_user: true, mes: 'Selene appears.' });
        await generate(rig);
        expect(rig.llm.requests).toHaveLength(2);
        expect((rig.host.chat.at(-1)?.extra?.[PICK_EXTRA_KEY] as PickRecord).source).toBe('fresh');
    });

    it('a timeout never holds the generation longer than the limit and falls back with a notice (SC-006)', async () => {
        const rig = setup();
        rig.llm.hang();
        const running = rig.controller.interceptor(rig.host.chat, 8192, () => undefined, 'normal');
        await vi.advanceTimersByTimeAsync(5000);
        await running;
        expect(rig.notices[0]).toMatch(/timed out.*keywords only/);
        expect(rig.host.forced).toHaveLength(0);
        expect(rig.emitted[0]).toMatchObject({ payload: { source: 'fallback' } });
        // The record says how long the reply waited, not 0 ms.
        expect((rig.emitted[0] as { payload: { durationMs: number } }).payload.durationMs).toBeGreaterThanOrEqual(4000);
    });

    it('a reply in another format is a visible failure, not a silent empty pick (live 2026-10-09)', async () => {
        const rig = setup();
        rig.llm.reply('User Safety: safe');
        rig.host.chat.push({ name: 'User', is_user: true, mes: 'Selene, are you there?' });
        await generate(rig);
        const record = rig.host.chat.at(-1)?.extra?.[PICK_EXTRA_KEY] as PickRecord;
        expect(record).toMatchObject({ source: 'fallback', picked: [] });
        expect(record.failure?.message).toMatch(/did not answer in the pick format.*User Safety: safe/);
        expect(rig.host.forced).toHaveLength(0);
    });

    it('an explicit <none/> is a successful empty pick', async () => {
        const rig = setup();
        rig.llm.reply('<none/>');
        rig.host.chat.push({ name: 'User', is_user: true, mes: 'Selene, are you there?' });
        await generate(rig);
        const record = rig.host.chat.at(-1)?.extra?.[PICK_EXTRA_KEY] as PickRecord;
        expect(record).toMatchObject({ source: 'fresh', picked: [] });
        expect(record.failure).toBeUndefined();
    });

    it('skips quiet and impersonate generations', async () => {
        const rig = setup();
        await rig.controller.interceptor(rig.host.chat, 8192, () => undefined, 'quiet');
        await rig.controller.interceptor(rig.host.chat, 8192, () => undefined, 'impersonate');
        expect(rig.llm.requests).toHaveLength(0);
    });

    it('continue re-forces the pick stored on the continued reply without a model call', async () => {
        const rig = setup();
        rig.llm.reply('<pick id="e1">x</pick>');
        await generate(rig);
        await rig.controller.interceptor(rig.host.chat, 8192, () => undefined, 'continue');
        expect(rig.llm.requests).toHaveLength(1);
        expect(rig.host.forced).toHaveLength(2);
        expect(rig.emitted.at(-1)).toMatchObject({ payload: { source: 'reused' } });
    });

    it('discards a pick when the chat changed meanwhile', async () => {
        const rig = setup();
        rig.llm.hang();
        const running = rig.controller.interceptor(rig.host.chat, 8192, () => undefined, 'normal');
        rig.host.chatId = 'chat-2';
        await vi.advanceTimersByTimeAsync(5000);
        await running;
        expect(rig.host.forced).toHaveLength(0);
        expect(rig.emitted).toHaveLength(0);
    });

    it('never throws, even when the host misbehaves', async () => {
        const rig = setup();
        rig.host.getWorldInfoPrompt = async () => {
            throw new Error('boom');
        };
        await expect(rig.controller.interceptor(rig.host.chat, 8192, () => undefined, 'normal')).resolves.toBeUndefined();
    });

    it('per-chat choice overrides the global default', () => {
        const rig = setup({ enabled: false });
        rig.controller.setChatChoice('on');
        expect(rig.controller.status().enabled).toBe(true);
        expect(rig.host.chatMetadata).toEqual({ WorldInfoWorkspace: { picking: 'on' } });
        rig.controller.setChatChoice(null);
        expect(rig.controller.status().enabled).toBe(false);
    });
});
