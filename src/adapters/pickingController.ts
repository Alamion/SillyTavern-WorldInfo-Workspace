import type {
    ActiveWorldInfoEntry,
    SillyTavernChatMessage,
    SillyTavernContext,
    WorldInfoEntriesLoadedPayload,
} from '../global';
import type { LlmPort } from '../core/assistant/ports';
import { compileTrigger } from '../core/assistant/triggers';
import { getAssistantSettings } from '../core/state/schema';
import { getNodeIndex } from '../core/state/nodeIndex';
import type { WorkspaceStore } from '../core/state/store';
import { decidePick } from '../core/picking/decide';
import { forcedEntries } from '../core/picking/forced';
import { parsePicks } from '../core/picking/pickParser';
import { buildPickRequest, type PickCandidate } from '../core/picking/request';
import {
    getPickingSettings,
    isPickingOn,
    setPickingSettings,
    type ChatPickingChoice,
    type PickingSettings,
} from '../core/picking/settings';
import { WI_EVENTS, type PickCompletedPayload } from '../core/hooks/events';
import { readScene } from '../core/interop/doomsTracker';
import type { HookEmitter } from './hooks';

/**
 * Main-chat lore picking (spec 007 US5, contracts/main-chat-picking.md).
 *
 * A generation interceptor that never blocks or aborts generation and never
 * injects text: it decides which entries of the ACTIVE books matter, then hands
 * full copies of them to the app's own forced activation, so the native World
 * Info engine keeps position, depth, order and budget. A pick is prepared in
 * the background after each reply; a fresh one (bounded by the timeout) runs only
 * when the user's new text names an entry the prepared pick lacks.
 */

export const PICK_EXTRA_KEY = 'wiw_pick';
const METADATA_KEY = 'WorldInfoWorkspace';

export interface PickedEntry {
    book: string;
    uid: number;
    name: string;
    reason: string;
    /** From WORLD_INFO_ACTIVATED: did the native engine insert it? null = unknown. */
    inserted: boolean | null;
}

/** Stored on a reply as `extra.wiw_pick` (data-model.md). */
export interface PickRecord {
    v: 1;
    source: PickCompletedPayload['source'];
    picked: PickedEntry[];
    ignored: string[];
    durationMs: number;
    failure?: { kind: 'timeout' | 'failed' | 'malformed'; message: string };
    profileName: string;
    at: string;
}

export interface PickingHost {
    /** A fresh app context (chat, metadata and events are read at call time). */
    context(): SillyTavernContext;
    store: WorkspaceStore;
    llm: LlmPort;
    emit: HookEmitter;
    /** Non-blocking user notice (toast). */
    notice(message: string): void;
    now(): number;
    /** Called after a record is attached to a reply (message icon). */
    onRecorded?(messageId: number): void;
    /** Settings cannot be saved while a recovery is pending. */
    isRecoveryPending(): boolean;
}

export interface PickingController {
    /** The function registered as `globalThis.wiwPickInterceptor`. */
    interceptor(chat: SillyTavernChatMessage[], contextSize: number, abort: (immediately: boolean) => void, type: string): Promise<void>;
    start(): () => void;
    settings(): PickingSettings;
    /** False when a pending recovery blocks saving (same rule as assistant settings). */
    updateSettings(patch: Partial<PickingSettings>): boolean;
    chatChoice(): ChatPickingChoice;
    setChatChoice(choice: ChatPickingChoice): void;
    /** The next generation runs a fresh pick (the reply popup's action). */
    forceFresh(): void;
    /** For the settings view. */
    status(): { enabled: boolean; activeEntries: number | null; prepared: boolean };
}

interface Prepared {
    chatId: string;
    basedOnLength: number;
    picked: PickedEntry[];
    ignored: string[];
}

interface Pending {
    chatId: string;
    record: PickRecord;
}

type RunResult = { ok: true; picked: PickedEntry[]; ignored: string[]; durationMs: number; profileName: string } | { ok: false; kind: 'timeout' | 'failed' | 'malformed'; message: string; profileName: string };

const keyOf = (book: string, uid: number): string => `${book}:${String(uid)}`;

export function createPickingController(host: PickingHost): PickingController {
    let activeCache: ActiveWorldInfoEntry[] | null = null;
    let cacheValid = false;
    let prepared: Prepared | null = null;
    let preparing: AbortController | null = null;
    let pending: Pending | null = null;
    let freshNext = false;
    const triggerCache = new WeakMap<object, RegExp[]>();

    const settings = (): PickingSettings => getPickingSettings(host.store.getState());
    const chatId = (): string => host.context().getCurrentChatId?.() ?? '';

    const chatChoice = (): ChatPickingChoice => {
        const meta = host.context().chatMetadata?.[METADATA_KEY];
        const value = typeof meta === 'object' && meta !== null ? (meta as Record<string, unknown>)['picking'] : undefined;
        return value === 'on' || value === 'off' ? value : null;
    };
    const enabled = (): boolean => isPickingOn(settings(), chatChoice());

    /** The active entries, as the app resolved them for its last scan (R9). */
    const activeEntries = async (): Promise<ActiveWorldInfoEntry[]> => {
        if (!cacheValid) {
            const ctx = host.context();
            if (typeof ctx.getWorldInfoPrompt === 'function') {
                try {
                    // A dry scan emits WORLDINFO_ENTRIES_LOADED and sets no timed effects.
                    const lines = ctx.chat.slice(-10).map((message) => `${message.name}: ${message.mes}`).reverse();
                    await ctx.getWorldInfoPrompt(lines, 8192, true);
                } catch {
                    // The stale cache (or nothing) is still better than blocking.
                }
            }
        }
        return activeCache ?? [];
    };

    /** Where each bound entry sits in the workspace (folder path, excluded folders). */
    const placements = (): Map<string, { path: string; excluded: boolean }> => {
        const state = host.store.getState();
        const index = getNodeIndex(state.root);
        const result = new Map<string, { path: string; excluded: boolean }>();
        for (const node of index.values()) {
            if (node.kind !== 'entry') {
                continue;
            }
            const names: string[] = [];
            let excluded = false;
            let current = node.parentId !== null ? index.get(node.parentId) : undefined;
            while (current && current.parentId !== null) {
                names.unshift(current.name);
                if (current.kind === 'folder' && current.pickExcluded === true) {
                    excluded = true;
                }
                current = index.get(current.parentId);
            }
            for (const [book, sync] of Object.entries(node.sync.books)) {
                if (sync.uid !== null) {
                    result.set(keyOf(book, sync.uid), { path: names.join(' / '), excluded });
                }
            }
        }
        return result;
    };

    const candidatesOf = (entries: readonly ActiveWorldInfoEntry[]): PickCandidate[] => {
        const places = placements();
        const candidates: PickCandidate[] = [];
        for (const entry of entries) {
            if (entry.disable) {
                continue;
            }
            const place = places.get(keyOf(entry.world, entry.uid));
            if (place?.excluded === true) {
                continue;
            }
            candidates.push({
                id: keyOf(entry.world, entry.uid),
                name: entry.comment !== '' ? entry.comment : `${entry.world} #${String(entry.uid)}`,
                native: entry,
                book: entry.world,
                uid: entry.uid,
                path: place && place.path !== '' ? place.path : entry.world,
            });
        }
        return candidates;
    };

    /** Ids of candidates whose name or keys appear in `text` (decides prepared vs fresh). */
    const mentionsIn = (candidates: readonly PickCandidate[]) => (text: string): Set<string> => {
        const found = new Set<string>();
        if (text.trim() === '') {
            return found;
        }
        for (const candidate of candidates) {
            let patterns = triggerCache.get(candidate.native);
            if (patterns === undefined) {
                patterns = [...candidate.native.key, candidate.name]
                    .map(compileTrigger)
                    .filter((pattern): pattern is RegExp => pattern !== null);
                triggerCache.set(candidate.native, patterns);
            }
            if (patterns.some((pattern) => pattern.test(text))) {
                found.add(candidate.id);
            }
        }
        return found;
    };

    const recentChat = (count: number): Array<{ name: string; text: string }> =>
        host
            .context()
            .chat.filter((message) => message.is_system !== true)
            .slice(-count)
            .map((message) => ({ name: message.name, text: message.mes }));

    const runPick = async (candidates: readonly PickCandidate[], signal: AbortSignal): Promise<RunResult> => {
        const current = settings();
        const availability = host.llm.availability();
        const profileId = current.profileId ?? getAssistantSettings(host.store.getState()).profileId;
        const profile = availability.state === 'ready' ? availability.profiles.find((item) => item.id === profileId) : undefined;
        if (!profile) {
            return { ok: false, kind: 'failed', message: 'No connection profile for lore picking.', profileName: '' };
        }
        const started = host.now();
        const request = buildPickRequest({
            candidates,
            chat: recentChat(current.chatMessages),
            scene: readScene(host.context().chatMetadata),
            maxPicks: current.maxPicks,
            catalogTokens: current.catalogTokens,
        });
        let text: string | null = null;
        let failure: string | null = null;
        await host.llm.run(
            // The assistant's response length: reasoning models on free routers spent a
            // 400-token limit on thinking alone (live run 2026-10-07).
            { profileId: profile.id, messages: request.messages, maxTokens: getAssistantSettings(host.store.getState()).responseTokens, signal },
            (event) => {
                if (event.type === 'done') {
                    text = event.text;
                } else if (event.type === 'failed') {
                    failure = event.failure.message;
                }
            }
        );
        if (signal.aborted) {
            return { ok: false, kind: 'timeout', message: 'Lore picking timed out.', profileName: profile.name };
        }
        if (text === null) {
            return { ok: false, kind: 'failed', message: failure ?? 'Lore picking failed.', profileName: profile.name };
        }
        const parsed = parsePicks(text, new Set(request.handles.keys()), current.maxPicks);
        if (parsed.picks.length === 0 && parsed.ignored.length > 0) {
            return { ok: false, kind: 'malformed', message: 'The picking model named only unknown entries.', profileName: profile.name };
        }
        if (parsed.picks.length === 0 && !parsed.none) {
            const message =
                parsed.stray === ''
                    ? 'The picking model gave an empty reply.'
                    : `The picking model did not answer in the pick format ("${parsed.stray}").`;
            return { ok: false, kind: 'malformed', message, profileName: profile.name };
        }
        const picked = parsed.picks.flatMap((pick) => {
            const target = request.handles.get(pick.id);
            return target ? [{ ...target, reason: pick.reason, inserted: null }] : [];
        });
        return { ok: true, picked, ignored: parsed.ignored, durationMs: host.now() - started, profileName: profile.name };
    };

    const prepare = async (): Promise<void> => {
        if (!enabled()) {
            return;
        }
        preparing?.abort();
        const controller = new AbortController();
        preparing = controller;
        const id = chatId();
        const basedOnLength = host.context().chat.length;
        const candidates = candidatesOf(await activeEntries());
        if (candidates.length === 0) {
            return;
        }
        const result = await runPick(candidates, controller.signal);
        if (preparing !== controller) {
            return;
        }
        preparing = null;
        if (result.ok && chatId() === id) {
            prepared = { chatId: id, basedOnLength, picked: result.picked, ignored: result.ignored };
        }
    };

    const force = (picked: readonly PickedEntry[], entries: readonly ActiveWorldInfoEntry[]): void => {
        const wanted = new Set(picked.map((entry) => keyOf(entry.book, entry.uid)));
        const objects = forcedEntries(entries.filter((entry) => wanted.has(keyOf(entry.world, entry.uid))));
        if (objects.length === 0) {
            return;
        }
        const ctx = host.context();
        void ctx.eventSource.emit(ctx.eventTypes.WORLDINFO_FORCE_ACTIVATE, objects);
    };

    const finish = (record: PickRecord, id: string): void => {
        pending = { chatId: id, record };
        const payload: PickCompletedPayload = {
            chatId: id,
            source: record.source,
            picked: record.picked.map((entry) => ({ book: entry.book, uid: entry.uid })),
            ignored: record.ignored.length,
            durationMs: record.durationMs,
        };
        host.emit(WI_EVENTS.pickCompleted, payload);
    };

    const interceptor: PickingController['interceptor'] = async (chat, _contextSize, _abort, type) => {
        try {
            if (!enabled()) {
                return;
            }
            const id = chatId();
            const entries = await activeEntries();
            const candidates = candidatesOf(entries);
            if (candidates.length === 0) {
                return;
            }
            const base = prepared !== null && prepared.chatId === id && !freshNext ? prepared : null;
            const newText = chat
                .slice(base?.basedOnLength ?? 0)
                .filter((message) => message.is_system !== true)
                .map((message) => message.mes)
                .join('\n');
            const decision = decidePick({
                type,
                newText,
                prepared: base ? { picked: new Set(base.picked.map((entry) => keyOf(entry.book, entry.uid))) } : null,
                mentions: mentionsIn(candidates),
            });
            const at = new Date(host.now()).toISOString();
            if (decision === 'skip') {
                return;
            }
            if (decision === 'reused') {
                const last = chat.at(-1);
                const previous = last?.extra?.[PICK_EXTRA_KEY] as PickRecord | undefined;
                if (previous && Array.isArray(previous.picked)) {
                    force(previous.picked, entries);
                    finish({ ...previous, source: 'reused', durationMs: 0, at }, id);
                }
                return;
            }
            if (decision === 'prepared' && base) {
                force(base.picked, entries);
                finish(
                    { v: 1, source: 'prepared', picked: base.picked, ignored: base.ignored, durationMs: 0, profileName: '', at },
                    id
                );
                return;
            }
            freshNext = false;
            preparing?.abort();
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), settings().timeoutSec * 1000);
            const waitStarted = host.now();
            const result = await runPick(candidates, controller.signal);
            clearTimeout(timer);
            if (chatId() !== id) {
                return; // the chat changed meanwhile: a stale pick is discarded
            }
            if (result.ok) {
                force(result.picked, entries);
                prepared = { chatId: id, basedOnLength: chat.length, picked: result.picked, ignored: result.ignored };
                finish(
                    { v: 1, source: 'fresh', picked: result.picked, ignored: result.ignored, durationMs: result.durationMs, profileName: result.profileName, at },
                    id
                );
                return;
            }
            const fallback = base?.picked ?? [];
            force(fallback, entries);
            host.notice(
                fallback.length > 0
                    ? `${result.message} Using the earlier lore pick.`
                    : `${result.message} Using keywords only.`
            );
            finish(
                {
                    v: 1,
                    source: 'fallback',
                    picked: fallback,
                    ignored: [],
                    // How long the reply waited (live 2026-10-09: a timeout read "0 ms").
                    durationMs: host.now() - waitStarted,
                    failure: { kind: result.kind, message: result.message },
                    profileName: result.profileName,
                    at,
                },
                id
            );
        } catch (error) {
            // Never block or abort the generation (SC-006).
            console.debug('[WorldInfoWorkspace] lore picking failed', error);
        }
    };

    const attach = (messageId: number, type: unknown): void => {
        if (pending === null || type === 'quiet' || type === 'impersonate' || pending.chatId !== chatId()) {
            return;
        }
        const message = host.context().chat[messageId];
        if (!message || message.is_user) {
            return;
        }
        const record = pending.record;
        pending = null;
        message.extra = { ...(message.extra ?? {}), [PICK_EXTRA_KEY]: record };
        const swipe = message.swipe_id ?? 0;
        if (Array.isArray(message.swipe_info) && message.swipe_info[swipe]) {
            const info = message.swipe_info[swipe];
            if (info) {
                info.extra = { ...(info.extra ?? {}), [PICK_EXTRA_KEY]: record };
            }
        }
        host.onRecorded?.(messageId);
    };

    const onActivated = (entries: unknown): void => {
        if (pending === null || !Array.isArray(entries)) {
            return;
        }
        const inserted = new Set(
            entries
                .filter((entry): entry is { world: string; uid: number } => typeof entry === 'object' && entry !== null)
                .map((entry) => keyOf(String(entry.world), Number(entry.uid)))
        );
        pending.record = {
            ...pending.record,
            picked: pending.record.picked.map((entry) => ({ ...entry, inserted: inserted.has(keyOf(entry.book, entry.uid)) })),
        };
    };

    return {
        interceptor,
        start() {
            const ctx = host.context();
            const types = ctx.eventTypes;
            const handlers: Array<[string, (...args: unknown[]) => void]> = [
                [
                    types.WORLDINFO_ENTRIES_LOADED,
                    (payload) => {
                        const loaded = payload as Partial<WorldInfoEntriesLoadedPayload> | undefined;
                        activeCache = [
                            ...(loaded?.chatLore ?? []),
                            ...(loaded?.personaLore ?? []),
                            ...(loaded?.characterLore ?? []),
                            ...(loaded?.globalLore ?? []),
                        ];
                        cacheValid = true;
                    },
                ],
                [
                    types.CHAT_CHANGED,
                    () => {
                        cacheValid = false;
                        prepared = null;
                        pending = null;
                        preparing?.abort();
                        preparing = null;
                    },
                ],
                [types.WORLDINFO_SETTINGS_UPDATED, () => (cacheValid = false)],
                [types.WORLDINFO_UPDATED, () => (cacheValid = false)],
                [types.WORLD_INFO_ACTIVATED, (entries) => onActivated(entries)],
                [types.MESSAGE_RECEIVED, (id, type) => attach(Number(id), type)],
                [
                    types.CHARACTER_MESSAGE_RENDERED,
                    (_id, type) => {
                        if (type !== 'quiet' && type !== 'impersonate' && type !== 'first_message') {
                            void prepare();
                        }
                    },
                ],
            ];
            handlers.forEach(([event, handler]) => ctx.eventSource.on(event, handler));
            return () => handlers.forEach(([event, handler]) => ctx.eventSource.removeListener(event, handler));
        },
        settings,
        updateSettings(patch) {
            if (host.isRecoveryPending()) {
                return false;
            }
            host.store.replace(setPickingSettings(host.store.getState(), patch));
            return true;
        },
        chatChoice,
        setChatChoice(choice) {
            const ctx = host.context();
            if (!ctx.chatMetadata) {
                return;
            }
            const meta = ctx.chatMetadata[METADATA_KEY];
            const record = typeof meta === 'object' && meta !== null ? { ...(meta as Record<string, unknown>) } : {};
            if (choice === null) {
                delete record['picking'];
            } else {
                record['picking'] = choice;
            }
            ctx.chatMetadata[METADATA_KEY] = record;
            ctx.saveMetadataDebounced?.();
        },
        forceFresh() {
            freshNext = true;
        },
        status() {
            return { enabled: enabled(), activeEntries: activeCache?.length ?? null, prepared: prepared !== null };
        },
    };
}
