import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
    createIndexedDbConversationStore,
    createMemoryConversationStore,
} from '../../src/adapters/conversationStore';
import type { ConversationStorePort } from '../../src/core/assistant/ports';
import type { Conversation, Message } from '../../src/core/assistant/types';
import { DEFAULT_CONTEXT_SETTINGS } from '../../src/core/assistant/types';

/**
 * Both conversation stores must behave identically (spec 005 research R10): the
 * IndexedDB one is what the app uses, the memory one is the fallback when the
 * browser has no storage.
 */

function conversation(id: string, updatedAt: string): Conversation {
    return {
        id,
        title: `Conversation ${id}`,
        createdAt: '2026-09-15T10:00:00.000Z',
        updatedAt,
        mode: 'propose',
        context: DEFAULT_CONTEXT_SETTINGS,
        nextSeq: 0,
    };
}

function message(conversationId: string, seq: number, text = 'hello'): Message {
    return {
        conversationId,
        seq,
        role: 'user',
        text,
        status: 'received',
        mode: 'propose',
        createdAt: '2026-09-15T10:00:00.000Z',
    };
}

function runConversationStoreSuite(name: string, factory: () => ConversationStorePort): void {
    describe(name, () => {
        let store: ConversationStorePort;
        beforeEach(async () => {
            store = factory();
            for (const existing of await store.listConversations()) {
                await store.deleteConversation(existing.id);
            }
        });

        it('stores and reads a conversation', async () => {
            await store.putConversation(conversation('c1', '2026-09-15T11:00:00.000Z'));
            expect(await store.getConversation('c1')).toMatchObject({ id: 'c1', title: 'Conversation c1' });
            expect(await store.getConversation('missing')).toBeUndefined();
        });

        it('lists conversations newest first', async () => {
            await store.putConversation(conversation('older', '2026-09-15T10:00:00.000Z'));
            await store.putConversation(conversation('newer', '2026-09-15T12:00:00.000Z'));
            expect((await store.listConversations()).map((item) => item.id)).toEqual(['newer', 'older']);
        });

        it('orders messages by seq and overwrites by key', async () => {
            await store.putMessage(message('c1', 2));
            await store.putMessage(message('c1', 1));
            await store.putMessage(message('c1', 1, 'edited'));
            const messages = await store.listMessages('c1');
            expect(messages.map((item) => item.seq)).toEqual([1, 2]);
            expect(messages[0]?.text).toBe('edited');
        });

        it('deletes a conversation with its messages', async () => {
            await store.putConversation(conversation('c1', '2026-09-15T11:00:00.000Z'));
            await store.putMessage(message('c1', 1));
            await store.putMessage(message('c2', 1));
            await store.deleteConversation('c1');
            expect(await store.getConversation('c1')).toBeUndefined();
            expect(await store.listMessages('c1')).toEqual([]);
            expect(await store.listMessages('c2')).toHaveLength(1);
        });

        it('deletes messages after a sequence number (regenerate)', async () => {
            for (const seq of [1, 2, 3, 4]) {
                await store.putMessage(message('c1', seq));
            }
            await store.deleteMessagesAfter('c1', 2);
            expect((await store.listMessages('c1')).map((item) => item.seq)).toEqual([1, 2]);
        });

        it('returns copies, never live references', async () => {
            await store.putConversation(conversation('c1', '2026-09-15T11:00:00.000Z'));
            const first = await store.getConversation('c1');
            if (first) {
                first.title = 'mutated';
            }
            expect((await store.getConversation('c1'))?.title).toBe('Conversation c1');
            const stored = message('c1', 1);
            await store.putMessage(stored);
            stored.text = 'mutated after put';
            expect((await store.listMessages('c1'))[0]?.text).toBe('hello');
        });
    });
}

runConversationStoreSuite('memory conversation store', () => createMemoryConversationStore());
runConversationStoreSuite('IndexedDB conversation store', () => createIndexedDbConversationStore());

describe('availability', () => {
    it('reports the memory fallback as unavailable storage', () => {
        expect(createMemoryConversationStore().available()).toBe(false);
        expect(createIndexedDbConversationStore().available()).toBe(true);
    });
});
