import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    createAssistantController,
    type AssistantController,
} from '../../src/adapters/assistantController';
import { createMemoryConversationStore } from '../../src/adapters/conversationStore';
import type { ConversationStorePort } from '../../src/core/assistant/ports';
import { DEFAULT_ASSISTANT_SETTINGS } from '../../src/core/assistant/types';
import { WorkspaceStore } from '../../src/core/state/store';
import { getAssistantSettings } from '../../src/core/state/schema';
import { FAKE_PROFILE, FakeLlm } from '../support/fakeLlm';
import { FakeChatContext } from '../support/fakeChatContext';
import { aldermeerState } from '../fixtures/assistant/outline-aldermeer';

/**
 * Controller behavior with a scripted LLM, a memory conversation store and the
 * real workspace store (spec 005 US3/US4 + foundational request path).
 */

const TC_PROFILE = {
    id: 'p-tc',
    name: 'local kobold',
    api: 'text-completion' as const,
    model: 'local',
    streaming: false,
    hasInstructTemplate: false,
};

interface Harness {
    controller: AssistantController;
    llm: FakeLlm;
    store: WorkspaceStore;
    conversations: ConversationStorePort;
    chat: FakeChatContext;
    recovery: { pending: boolean };
}

let idCounter = 0;
let clock = Date.parse('2026-09-15T12:00:00.000Z');

function createHarness(options: { store?: ConversationStorePort } = {}): Harness {
    const llm = new FakeLlm();
    const store = new WorkspaceStore(aldermeerState());
    const conversations = options.store ?? createMemoryConversationStore();
    const chat = new FakeChatContext();
    const recovery = { pending: false };
    const controller = createAssistantController({
        store,
        llm,
        conversations,
        chat,
        newId: () => `id-${(idCounter += 1)}`,
        now: () => new Date((clock += 1000)).toISOString(),
        isRecoveryPending: () => recovery.pending,
    });
    return { controller, llm, store, conversations, chat, recovery };
}

async function ready(harness: Harness): Promise<void> {
    await harness.controller.init();
    harness.controller.updateSettings({ profileId: FAKE_PROFILE.id });
}

beforeEach(() => {
    idCounter = 0;
    clock = Date.parse('2026-09-15T12:00:00.000Z');
});

afterEach(() => {
    vi.useRealTimers();
});

describe('conversations and the request path', () => {
    it('copies the default context into a new conversation', async () => {
        const harness = createHarness();
        await ready(harness);
        harness.controller.updateSettings({
            defaultContext: { ...DEFAULT_ASSISTANT_SETTINGS.defaultContext, chatMessages: 10 },
        });
        await harness.controller.createConversation();
        expect(harness.controller.getSnapshot().activeConversation?.context.chatMessages).toBe(10);
    });

    it('streams a reply into the assistant message and records the origin', async () => {
        const harness = createHarness();
        await ready(harness);
        harness.llm.stream(['Hello', ' world']);
        await harness.controller.createConversation();
        await harness.controller.send('Write a tavern');
        const snapshot = harness.controller.getSnapshot();
        const [user, assistant] = snapshot.messages;
        expect(user).toMatchObject({ role: 'user', text: 'Write a tavern', status: 'received' });
        expect(assistant).toMatchObject({ role: 'assistant', text: 'Hello world', status: 'received' });
        expect(assistant?.origin).toEqual({
            profileId: FAKE_PROFILE.id,
            profileName: FAKE_PROFILE.name,
            api: 'chat-completion',
            model: FAKE_PROFILE.model,
        });
        expect(snapshot.activeRequest).toBeNull();
        expect(snapshot.activeConversation?.title).toBe('Write a tavern');
    });

    it('sends instructions and history, and remembers the exact request', async () => {
        const harness = createHarness();
        await ready(harness);
        harness.llm.reply('first').reply('second');
        await harness.controller.createConversation();
        await harness.controller.send('one');
        await harness.controller.send('two');
        const second = harness.llm.requests[1];
        expect(second?.messages[0]?.role).toBe('system');
        expect(second?.messages.map((message) => message.content)).toContain('first');
        expect(second?.maxTokens).toBe(DEFAULT_ASSISTANT_SETTINGS.responseTokens);
        const assistantMessage = harness.controller.getSnapshot().messages.at(-1);
        expect(assistantMessage?.context?.requestMessages).toEqual(second?.messages);
    });

    it('stops a running request and keeps the partial text', async () => {
        const harness = createHarness();
        await ready(harness);
        harness.llm.hang();
        await harness.controller.createConversation();
        const sending = harness.controller.send('long one');
        harness.controller.stop();
        await sending;
        expect(harness.controller.getSnapshot().messages.at(-1)).toMatchObject({
            status: 'stopped',
            failure: undefined,
        });
        expect(harness.controller.getSnapshot().activeRequest).toBeNull();
    });

    it('refuses a second request while one is running', async () => {
        const harness = createHarness();
        await ready(harness);
        harness.llm.hang().reply('later');
        await harness.controller.createConversation();
        const first = harness.controller.send('one');
        await harness.controller.send('two');
        harness.controller.stop();
        await first;
        // The second send was refused while the first was in flight.
        expect(harness.llm.requests).toHaveLength(1);
        expect(harness.controller.getSnapshot().messages.map((message) => message.text)).toEqual([
            'one',
            '',
        ]);
    });

    it('persists messages and restores them on a new controller', async () => {
        const store = createMemoryConversationStore();
        const first = createHarness({ store });
        await ready(first);
        first.llm.reply('kept');
        await first.controller.createConversation();
        await first.controller.send('remember me');

        const second = createHarness({ store });
        await second.controller.init();
        const snapshot = second.controller.getSnapshot();
        expect(snapshot.conversations).toHaveLength(1);
        expect(snapshot.messages.map((message) => message.text)).toEqual(['remember me', 'kept']);
    });
});

describe('availability and settings (US3)', () => {
    it('reports a disabled Connection Manager', async () => {
        const harness = createHarness();
        harness.llm.state = 'connection-manager-disabled';
        await harness.controller.init();
        expect(harness.controller.getSnapshot().availability).toBe('connection-manager-disabled');
    });

    it('reports no-profile when nothing is selected or the profile disappeared', async () => {
        const harness = createHarness();
        await harness.controller.init();
        expect(harness.controller.getSnapshot().availability).toBe('no-profile');
        harness.controller.updateSettings({ profileId: FAKE_PROFILE.id });
        expect(harness.controller.getSnapshot().availability).toBe('ready');
        harness.llm.profiles = [];
        harness.llm.emitProfilesChanged();
        expect(harness.controller.getSnapshot().availability).toBe('no-profile');
    });

    it('warns for Text Completion profiles', async () => {
        const harness = createHarness();
        harness.llm.profiles = [FAKE_PROFILE, TC_PROFILE];
        await ready(harness);
        harness.controller.updateSettings({ profileId: TC_PROFILE.id });
        const snapshot = harness.controller.getSnapshot();
        expect(snapshot.textCompletionWarning).toBe(true);
        expect(snapshot.profile?.hasInstructTemplate).toBe(false);
    });

    it('persists settings through the workspace store and uses them', async () => {
        const harness = createHarness();
        await ready(harness);
        harness.controller.updateSettings({ responseTokens: 512 });
        expect(getAssistantSettings(harness.store.getState()).responseTokens).toBe(512);
        harness.llm.reply('ok');
        await harness.controller.createConversation();
        await harness.controller.send('hi');
        expect(harness.llm.requests[0]?.maxTokens).toBe(512);
    });

    it('locks settings while a workspace recovery is unresolved', async () => {
        const harness = createHarness();
        await harness.controller.init();
        harness.recovery.pending = true;
        expect(harness.controller.updateSettings({ profileId: FAKE_PROFILE.id })).toBe(false);
        expect(getAssistantSettings(harness.store.getState()).profileId).toBeNull();
        expect(harness.controller.getSnapshot().settingsLocked).toBe(true);
        harness.recovery.pending = false;
        expect(harness.controller.updateSettings({ profileId: FAKE_PROFILE.id })).toBe(true);
    });

    it('resets instructions and saves the conversation context as default', async () => {
        const harness = createHarness();
        await ready(harness);
        harness.controller.updateSettings({ instructions: 'custom' });
        expect(getAssistantSettings(harness.store.getState()).instructions).toBe('custom');
        harness.controller.resetInstructions();
        expect(getAssistantSettings(harness.store.getState()).instructions).toBeNull();
        await harness.controller.createConversation();
        await harness.controller.updateConversationContext({ chatMessages: 6 });
        expect(harness.controller.saveContextAsDefault()).toBe(true);
        expect(getAssistantSettings(harness.store.getState()).defaultContext.chatMessages).toBe(6);
    });

    it('fails a request when the selected profile is gone', async () => {
        const harness = createHarness();
        await ready(harness);
        harness.llm.profiles = [];
        await harness.controller.createConversation();
        await harness.controller.send('hi');
        expect(harness.controller.getSnapshot().messages.at(-1)).toMatchObject({
            status: 'failed',
            failure: { kind: 'profile' },
        });
    });
});

describe('failure recovery (US4)', () => {
    const rateLimit = {
        kind: 'rate-limit' as const,
        message: 'The provider is rate-limiting requests right now (temporary).',
        retryable: true,
    };

    it('retries rate limits twice with a visible countdown, then stops', async () => {
        vi.useFakeTimers();
        const harness = createHarness();
        await ready(harness);
        harness.llm.failTimes(3, rateLimit);
        await harness.controller.createConversation();
        await harness.controller.send('hi');
        expect(harness.controller.getSnapshot().messages.at(-1)).toMatchObject({
            status: 'retry-wait',
            retryAttempt: 1,
        });
        await vi.advanceTimersByTimeAsync(10000);
        expect(harness.controller.getSnapshot().messages.at(-1)).toMatchObject({
            status: 'retry-wait',
            retryAttempt: 2,
        });
        await vi.advanceTimersByTimeAsync(30000);
        const last = harness.controller.getSnapshot().messages.at(-1);
        expect(last).toMatchObject({ status: 'failed', failure: { kind: 'rate-limit' } });
        expect(harness.llm.requests).toHaveLength(3);
        expect(harness.controller.getSnapshot().messages[0]?.text).toBe('hi');
    });

    it('cancels a pending retry on stop', async () => {
        vi.useFakeTimers();
        const harness = createHarness();
        await ready(harness);
        harness.llm.failTimes(2, rateLimit);
        await harness.controller.createConversation();
        await harness.controller.send('hi');
        harness.controller.stop();
        await vi.advanceTimersByTimeAsync(60000);
        expect(harness.llm.requests).toHaveLength(1);
        expect(harness.controller.getSnapshot().messages.at(-1)?.status).toBe('failed');
    });

    it('retryNow skips the countdown and re-sends the same request', async () => {
        vi.useFakeTimers();
        const harness = createHarness();
        await ready(harness);
        harness.llm.fail(rateLimit).reply('second try');
        await harness.controller.createConversation();
        await harness.controller.send('hi');
        const waiting = harness.controller.getSnapshot().messages.at(-1);
        await harness.controller.retryNow(waiting?.seq ?? 1);
        expect(harness.controller.getSnapshot().messages.at(-1)).toMatchObject({
            status: 'received',
            text: 'second try',
        });
        expect(harness.llm.requests[1]?.messages).toEqual(harness.llm.requests[0]?.messages);
    });

    it('does not retry provider failures automatically', async () => {
        const harness = createHarness();
        await ready(harness);
        harness.llm.fail({ kind: 'provider', message: 'The provider rejected the request.', retryable: true });
        await harness.controller.createConversation();
        await harness.controller.send('hi');
        expect(harness.controller.getSnapshot().messages.at(-1)?.status).toBe('failed');
        expect(harness.llm.requests).toHaveLength(1);
    });

    it('never changes the workspace state on a failure', async () => {
        const harness = createHarness();
        await ready(harness);
        const before = harness.store.getState();
        harness.llm.fail({ kind: 'timeout', message: 'The model did not respond in time.', retryable: true });
        await harness.controller.createConversation();
        await harness.controller.send('hi');
        expect(harness.store.getState()).toBe(before);
    });
});
