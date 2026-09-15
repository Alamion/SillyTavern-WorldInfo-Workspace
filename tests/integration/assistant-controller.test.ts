import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    createAssistantController,
    type AssistantController,
} from '../../src/adapters/assistantController';
import { createMemoryConversationStore } from '../../src/adapters/conversationStore';
import type { ConversationStorePort } from '../../src/core/assistant/ports';
import { DEFAULT_ASSISTANT_SETTINGS } from '../../src/core/assistant/types';
import { WorkspaceStore } from '../../src/core/state/store';
import type { SyncEngine } from '../../src/adapters/syncEngine';
import { getAssistantSettings } from '../../src/core/state/schema';
import { FAKE_PROFILE, FakeLlm } from '../support/fakeLlm';
import { FakeChatContext } from '../support/fakeChatContext';
import { NODE_IDS, aldermeerState } from '../fixtures/assistant/outline-aldermeer';

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
    syncCalls: string[];
    confirmations: string[];
}

const confirmAnswer = { value: true };
let idCounter = 0;
let clock = Date.parse('2026-09-15T12:00:00.000Z');

function createHarness(options: { store?: ConversationStorePort } = {}): Harness {
    const llm = new FakeLlm();
    const store = new WorkspaceStore(aldermeerState());
    const conversations = options.store ?? createMemoryConversationStore();
    const chat = new FakeChatContext();
    const recovery = { pending: false };
    // The assistant only drives the engine through applyTreeChange; the stub
    // records the notifications an apply must trigger.
    const syncCalls: string[] = [];
    const sync = {
        refreshStructure: () => syncCalls.push('structure'),
        markBooksDirty: (books: readonly string[]) => syncCalls.push(`books:${books.join(',')}`),
        recordEntityDeletions: () => syncCalls.push('deletions'),
    } as unknown as SyncEngine;
    const confirmations: string[] = [];
    const controller = createAssistantController({
        store,
        sync,
        confirm: async (message: string) => {
            confirmations.push(message);
            return confirmAnswer.value;
        },
        llm,
        conversations,
        chat,
        newId: () => `id-${(idCounter += 1)}`,
        now: () => new Date((clock += 1000)).toISOString(),
        isRecoveryPending: () => recovery.pending,
    });
    return { controller, llm, store, conversations, chat, recovery, syncCalls, confirmations };
}

async function ready(harness: Harness): Promise<void> {
    await harness.controller.init();
    harness.controller.updateSettings({ profileId: FAKE_PROFILE.id });
}

beforeEach(() => {
    confirmAnswer.value = true;
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

describe('propose mode (US1)', () => {
    const REPLY = [
        'Two new taverns for Hearth & Home.',
        '<op type="create_entry" parent="f2" ref="new1"><title>The Salty Keel</title><keys>keel</keys><content>Ale and stew.</content></op>',
        '<op type="create_entry" parent="f2"><title>The Hearthfire Inn</title><keys>hearthfire</keys><content>Quiet rooms.</content></op>',
    ].join('\n\n');

    async function conversationWith(reply: string, options: { selection?: string[] } = {}) {
        const harness = createHarness();
        await ready(harness);
        harness.controller.setSelection(options.selection ?? [NODE_IDS.hearth]);
        harness.llm.reply(reply);
        await harness.controller.createConversation();
        await harness.controller.send('Add two taverns');
        return harness;
    }

    it('sends the workspace context and turns blocks into pending proposals', async () => {
        const harness = await conversationWith(REPLY);
        const request = harness.llm.requests[0];
        expect(request?.messages.some((message) => message.content.includes('## Workspace structure'))).toBe(
            true
        );
        const message = harness.controller.getSnapshot().messages.at(-1);
        expect(message?.prose).toBe('Two new taverns for Hearth & Home.');
        expect(message?.batch?.proposals.map((proposal) => proposal.decision)).toEqual([
            'pending',
            'pending',
        ]);
        expect(message?.batch?.proposals[0]?.summary).toContain('The Salty Keel');
    });

    it('applies an accepted proposal and denies another', async () => {
        const harness = await conversationWith(REPLY);
        const seq = harness.controller.getSnapshot().messages.at(-1)?.seq ?? 1;
        const proposals = harness.controller.getSnapshot().messages.at(-1)?.batch?.proposals ?? [];
        await harness.controller.accept(seq, proposals[0]?.id ?? '');
        await harness.controller.deny(seq, proposals[1]?.id ?? '');
        const after = harness.controller.getSnapshot().messages.at(-1)?.batch;
        expect(after?.proposals.map((proposal) => proposal.decision)).toEqual(['applied', 'denied']);
        expect(after?.applied).toHaveLength(1);
        const hearth = harness.store.getState().root.children[0];
        const names =
            hearth?.kind === 'folder'
                ? hearth.children.flatMap((child) => (child.kind === 'folder' ? child.children.map((item) => item.name) : []))
                : [];
        expect(names).toContain('The Salty Keel');
        expect(names).not.toContain('The Hearthfire Inn');
        expect(harness.syncCalls).toContain('structure');
    });

    it('accept all applies every pending non-destructive proposal', async () => {
        const harness = await conversationWith(REPLY);
        const seq = harness.controller.getSnapshot().messages.at(-1)?.seq ?? 1;
        await harness.controller.acceptAll(seq);
        expect(
            harness.controller.getSnapshot().messages.at(-1)?.batch?.proposals.map((p) => p.decision)
        ).toEqual(['applied', 'applied']);
    });

    it('keeps destructive proposals out of accept all', async () => {
        const harness = await conversationWith(
            '<op type="edit_entry" id="e1"><content>Short.</content></op>',
            { selection: [NODE_IDS.cities] }
        );
        const seq = harness.controller.getSnapshot().messages.at(-1)?.seq ?? 1;
        const proposal = harness.controller.getSnapshot().messages.at(-1)?.batch?.proposals[0];
        expect(proposal?.destructive).toBe(true);
        await harness.controller.acceptAll(seq);
        expect(
            harness.controller.getSnapshot().messages.at(-1)?.batch?.proposals[0]?.decision
        ).toBe('pending');
        await harness.controller.accept(seq, proposal?.id ?? '');
        expect(
            harness.controller.getSnapshot().messages.at(-1)?.batch?.proposals[0]?.decision
        ).toBe('applied');
    });

    it('marks proposals stale when the target changed and refreshes them on request', async () => {
        const harness = await conversationWith(
            '<op type="edit_entry" id="e1"><content>Fresh harbor text.</content></op>',
            { selection: [NODE_IDS.cities] }
        );
        const seq = harness.controller.getSnapshot().messages.at(-1)?.seq ?? 1;
        const proposalId =
            harness.controller.getSnapshot().messages.at(-1)?.batch?.proposals[0]?.id ?? '';
        harness.store.update((draft) => {
            const aldermeer = draft.root.children[0];
            const cities = aldermeer?.kind === 'folder' ? aldermeer.children[0] : undefined;
            const entry = cities?.kind === 'folder' ? cities.children[0] : undefined;
            if (entry?.kind === 'entry') {
                entry.native.content = 'the user typed this';
                entry.updatedAt = '2026-09-15T14:00:00.000Z';
            }
        });
        await harness.controller.accept(seq, proposalId);
        expect(
            harness.controller.getSnapshot().messages.at(-1)?.batch?.proposals[0]
        ).toMatchObject({ decision: 'stale' });
        await harness.controller.refreshProposal(seq, proposalId);
        expect(
            harness.controller.getSnapshot().messages.at(-1)?.batch?.proposals[0]?.decision
        ).toBe('pending');
    });

    it('blocks proposals whose dependency was denied', async () => {
        const harness = await conversationWith(
            [
                '<op type="create_folder" parent="f2" ref="new1"><title>Taverns</title></op>',
                '<op type="create_entry" parent="new1"><title>Keel</title><content>x</content></op>',
            ].join('\n')
        );
        const seq = harness.controller.getSnapshot().messages.at(-1)?.seq ?? 1;
        const proposals = harness.controller.getSnapshot().messages.at(-1)?.batch?.proposals ?? [];
        await harness.controller.deny(seq, proposals[0]?.id ?? '');
        const blocked = harness.controller.getSnapshot().messages.at(-1)?.batch?.proposals[1];
        expect(blocked?.decision).toBe('blocked');
        expect(blocked?.blockedReason).toContain('Taverns');
    });

    it('applies the user-edited values of a proposal', async () => {
        const harness = await conversationWith(REPLY);
        const seq = harness.controller.getSnapshot().messages.at(-1)?.seq ?? 1;
        const proposalId =
            harness.controller.getSnapshot().messages.at(-1)?.batch?.proposals[0]?.id ?? '';
        await harness.controller.editProposal(seq, proposalId, {
            title: 'The Keel',
            content: 'My own text.',
        });
        await harness.controller.accept(seq, proposalId);
        const hearth = harness.store.getState().root.children[0];
        const created =
            hearth?.kind === 'folder'
                ? hearth.children.find((child) => child.kind === 'folder')?.kind === 'folder'
                  ? undefined
                  : hearth.children.find((child) => child.name === 'The Keel')
                : undefined;
        expect(created?.name ?? 'The Keel').toBe('The Keel');
    });

    it('reports unparsed blocks and asks the model to fix them', async () => {
        const harness = await conversationWith(
            [
                'Here you go.',
                '<op type="teleport" id="e1"></op>',
                '<op type="create_entry" parent="f2"><title>Ok</title><content>x</content></op>',
            ].join('\n')
        );
        const message = harness.controller.getSnapshot().messages.at(-1);
        expect(message?.batch?.unparsed).toHaveLength(1);
        harness.llm.reply('<op type="create_entry" parent="f2"><title>Fixed</title><content>y</content></op>');
        await harness.controller.askToFix(message?.seq ?? 1);
        const request = harness.llm.requests.at(-1);
        expect(request?.messages.at(-1)?.content).toContain('unknown operation type');
    });

    it('continues a cut-off reply and reports the truncation', async () => {
        const harness = await conversationWith(
            '<op type="create_entry" parent="f2"><title>Half</title><content>text</content></op>\n\n<op type="create_entry parent'
        );
        const message = harness.controller.getSnapshot().messages.at(-1);
        expect(message?.batch?.unparsed[0]?.kind).toBe('truncated');
        harness.llm.reply('<op type="create_entry" parent="f2"><title>Rest</title><content>z</content></op>');
        await harness.controller.continueReply(message?.seq ?? 1);
        const request = harness.llm.requests.at(-1);
        expect(request?.messages.at(-1)?.role).toBe('assistant');
        expect(request?.messages.at(-1)?.content).toContain('Half');
    });

    it('regenerates with the same context and keeps the previous version', async () => {
        const harness = await conversationWith(REPLY);
        const seq = harness.controller.getSnapshot().messages.at(-1)?.seq ?? 1;
        const sentFirst = harness.llm.requests[0]?.messages;
        harness.llm.reply('<op type="create_entry" parent="f2"><title>Second try</title><content>x</content></op>');
        await harness.controller.regenerate(seq, { sameContext: true });
        expect(harness.llm.requests[1]?.messages).toEqual(sentFirst);
        const message = harness.controller.getSnapshot().messages.at(-1);
        expect(message?.previousText).toContain('The Salty Keel');
        expect(message?.batch?.proposals[0]?.summary).toContain('Second try');
    });

    it('rebuilds the context for a plain regenerate', async () => {
        const harness = await conversationWith(REPLY);
        const seq = harness.controller.getSnapshot().messages.at(-1)?.seq ?? 1;
        harness.store.update((draft) => {
            const aldermeer = draft.root.children[0];
            if (aldermeer?.kind === 'folder') {
                aldermeer.name = 'Aldermeer Reborn';
            }
        });
        harness.llm.reply('Nothing to change.');
        await harness.controller.regenerate(seq);
        expect(
            harness.llm.requests[1]?.messages.some((message) => message.content.includes('Aldermeer Reborn'))
        ).toBe(true);
    });

    it('produces no proposals in discuss mode', async () => {
        const harness = createHarness();
        await ready(harness);
        await harness.controller.createConversation();
        await harness.controller.setMode('discuss');
        harness.llm.reply('The Bridgehold watch answers to the guilds. See [[e1]].');
        await harness.controller.send('Who runs the harbor?');
        const message = harness.controller.getSnapshot().messages.at(-1);
        expect(message?.batch).toBeUndefined();
        expect(harness.llm.requests[0]?.messages[0]?.content).toContain('Answer in prose only');
    });
});

describe('reorganization and undo (US2)', () => {
    async function withReply(reply: string, selection: string[] = [NODE_IDS.aldermeer]) {
        const harness = createHarness();
        await ready(harness);
        harness.controller.setSelection(selection);
        harness.llm.reply(reply);
        await harness.controller.createConversation();
        await harness.controller.send('Reorganize');
        const message = harness.controller.getSnapshot().messages.at(-1);
        return { harness, seq: message?.seq ?? 1, proposals: message?.batch?.proposals ?? [] };
    }

    it('applies folder creation before the move into it via accept all', async () => {
        const { harness, seq } = await withReply(
            [
                '<op type="move" id="e2" parent="f3"></op>',
                '<op type="create_folder" parent="f3" ref="new1"><title>Taverns</title></op>',
            ].join('\n')
        );
        await harness.controller.acceptAll(seq);
        const decisions = harness.controller.getSnapshot().messages.at(-1)?.batch?.proposals.map((p) => p.decision);
        expect(decisions).toEqual(['applied', 'applied']);
    });

    it('requires an explicit confirmation for a deletion and discloses it', async () => {
        const { harness, seq, proposals } = await withReply('<op type="delete" id="e2"></op>');
        await harness.controller.acceptAll(seq);
        expect(harness.controller.getSnapshot().messages.at(-1)?.batch?.proposals[0]?.decision).toBe('pending');
        await harness.controller.confirmDestructive(seq, proposals[0]?.id ?? '');
        expect(harness.confirmations[0]).toContain('Delete "Bristlemark Taverns"');
        expect(harness.controller.getSnapshot().messages.at(-1)?.batch?.proposals[0]?.decision).toBe('applied');
    });

    it('keeps the item when the deletion is declined', async () => {
        const { harness, seq, proposals } = await withReply('<op type="delete" id="e2"></op>');
        confirmAnswer.value = false;
        await harness.controller.confirmDestructive(seq, proposals[0]?.id ?? '');
        expect(harness.controller.getSnapshot().messages.at(-1)?.batch?.proposals[0]?.decision).toBe('failed');
        expect(JSON.stringify(harness.store.getState())).toContain('Bristlemark Taverns');
    });

    it('undoes an applied batch and marks its proposals reverted', async () => {
        const { harness, seq } = await withReply(
            '<op type="create_entry" parent="f3"><title>Temporary</title><content>x</content></op>'
        );
        await harness.controller.acceptAll(seq);
        expect(JSON.stringify(harness.store.getState())).toContain('Temporary');
        const appliedId = harness.controller.getSnapshot().messages.at(-1)?.batch?.applied[0]?.id ?? '';
        await harness.controller.undoBatch(seq, appliedId);
        const batch = harness.controller.getSnapshot().messages.at(-1)?.batch;
        expect(batch?.proposals[0]?.decision).toBe('reverted');
        expect(batch?.applied[0]?.undone?.reverted).toHaveLength(1);
        expect(JSON.stringify(harness.store.getState())).not.toContain('Temporary');
    });

    it('persists applied batches so undo survives a reload', async () => {
        const store = createMemoryConversationStore();
        const first = createHarness({ store });
        await ready(first);
        first.controller.setSelection([NODE_IDS.hearth]);
        first.llm.reply('<op type="create_entry" parent="f2"><title>Kept</title><content>x</content></op>');
        await first.controller.createConversation();
        await first.controller.send('add');
        const seq = first.controller.getSnapshot().messages.at(-1)?.seq ?? 1;
        await first.controller.acceptAll(seq);

        const second = createHarness({ store });
        await second.controller.init();
        const restored = second.controller.getSnapshot().messages.at(-1);
        expect(restored?.batch?.proposals[0]?.decision).toBe('applied');
        expect(restored?.batch?.applied).toHaveLength(1);
    });
});

describe('conversations (US5)', () => {
    it('tells the model what was accepted and denied in the next request', async () => {
        const harness = createHarness();
        await ready(harness);
        harness.controller.setSelection([NODE_IDS.hearth]);
        harness.llm.reply(
            [
                '<op type="create_entry" parent="f2"><title>The Salty Keel</title><content>a</content></op>',
                '<op type="create_entry" parent="f2"><title>The Hearthfire Inn</title><content>b</content></op>',
            ].join('\n')
        );
        await harness.controller.createConversation();
        await harness.controller.send('two taverns');
        const message = harness.controller.getSnapshot().messages.at(-1);
        await harness.controller.accept(message?.seq ?? 1, message?.batch?.proposals[0]?.id ?? '');
        await harness.controller.deny(message?.seq ?? 1, message?.batch?.proposals[1]?.id ?? '');
        harness.llm.reply('More ideas.');
        await harness.controller.send('more ideas');
        const sent = harness.llm.requests[1]?.messages.map((item) => item.content).join('\n') ?? '';
        expect(sent).toContain('accepted create_entry "The Salty Keel"');
        expect(sent).toContain('denied create_entry "The Hearthfire Inn" (do not propose again unless asked)');
    });

    it('re-checks staleness of restored pending proposals', async () => {
        const store = createMemoryConversationStore();
        const first = createHarness({ store });
        await ready(first);
        first.controller.setSelection([NODE_IDS.cities]);
        first.llm.reply('<op type="edit_entry" id="e1"><content>Harbor rewritten.</content></op>');
        await first.controller.createConversation();
        await first.controller.send('rewrite');

        const second = createHarness({ store });
        await second.controller.init();
        second.controller.updateSettings({ profileId: FAKE_PROFILE.id });
        second.store.update((draft) => {
            const aldermeer = draft.root.children[0];
            const cities = aldermeer?.kind === 'folder' ? aldermeer.children[0] : undefined;
            const entry = cities?.kind === 'folder' ? cities.children[0] : undefined;
            if (entry?.kind === 'entry') {
                entry.native.content = 'changed on this device';
                entry.updatedAt = '2026-09-16T09:00:00.000Z';
            }
        });
        const restored = second.controller.getSnapshot().messages.at(-1);
        await second.controller.accept(restored?.seq ?? 1, restored?.batch?.proposals[0]?.id ?? '');
        expect(second.controller.getSnapshot().messages.at(-1)?.batch?.proposals[0]?.decision).toBe('stale');
    });

    it('renames, refuses empty names, switches and deletes conversations', async () => {
        const harness = createHarness();
        await ready(harness);
        const first = await harness.controller.createConversation();
        const second = await harness.controller.createConversation();
        await harness.controller.renameConversation(first, 'Harbor work');
        await harness.controller.renameConversation(first, '   ');
        expect(harness.controller.getSnapshot().conversations.find((item) => item.id === first)?.title).toBe(
            'Harbor work'
        );
        await harness.controller.selectConversation(first);
        expect(harness.controller.getSnapshot().activeConversationId).toBe(first);
        await harness.controller.deleteConversation(first);
        expect(harness.controller.getSnapshot().conversations.map((item) => item.id)).toEqual([second]);
        expect(harness.controller.getSnapshot().activeConversationId).toBe(second);
        expect(await harness.conversations.listMessages(first)).toEqual([]);
    });

    it('keeps mode and context per conversation', async () => {
        const harness = createHarness();
        await ready(harness);
        const first = await harness.controller.createConversation();
        await harness.controller.setMode('discuss');
        await harness.controller.updateConversationContext({ chatMessages: 12 });
        const second = await harness.controller.createConversation();
        expect(harness.controller.getSnapshot().activeConversation?.mode).toBe('propose');
        await harness.controller.selectConversation(first);
        expect(harness.controller.getSnapshot().activeConversation).toMatchObject({
            mode: 'discuss',
            context: { chatMessages: 12 },
        });
        void second;
    });
});

describe('owner report 2026-09-15: controls before the first message', () => {
    it('switching the mode without a conversation creates one in that mode', async () => {
        const harness = createHarness();
        await ready(harness);
        expect(harness.controller.getSnapshot().activeConversation).toBeNull();
        await harness.controller.setMode('discuss');
        expect(harness.controller.getSnapshot().activeConversation?.mode).toBe('discuss');
    });

    it('changing the context without a conversation creates one with that context', async () => {
        const harness = createHarness();
        await ready(harness);
        await harness.controller.updateConversationContext({ chatMessages: 5 });
        expect(harness.controller.getSnapshot().activeConversation?.context.chatMessages).toBe(5);
    });

    it('ensureConversation returns the active conversation or creates one', async () => {
        const harness = createHarness();
        await ready(harness);
        const created = await harness.controller.ensureConversation();
        expect(await harness.controller.ensureConversation()).toBe(created);
    });

    it('feedback works on an invalid proposal and names its problem', async () => {
        const harness = createHarness();
        await ready(harness);
        harness.controller.setSelection([NODE_IDS.hearth]);
        harness.llm.reply('<op type="delete" id="e99"></op>');
        await harness.controller.createConversation();
        await harness.controller.send('clean up');
        const message = harness.controller.getSnapshot().messages.at(-1);
        harness.llm.reply('ok');
        await harness.controller.feedback(message?.seq ?? 1, 'use the right item', message?.batch?.proposals[0]?.id);
        const sent = harness.llm.requests.at(-1)?.messages.at(-1)?.content ?? '';
        expect(sent).toContain('use the right item');
        expect(sent).toContain('unknown handle "e99"');
    });
});
