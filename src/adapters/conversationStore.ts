import type { ConversationStorePort } from '../core/assistant/ports';
import type { Conversation, Message } from '../core/assistant/types';

/**
 * Conversation storage (spec 005 research R10): per browser/device, never in the
 * shared extension settings. The IndexedDB implementation is the real one; the
 * memory implementation is the fallback when IndexedDB is unavailable (private
 * windows, blocked site data) and the one tests use.
 */

const DB_NAME = 'WorldInfoWorkspace-assistant';
const DB_VERSION = 1;
const CONVERSATIONS = 'conversations';
const MESSAGES = 'messages';
const BY_CONVERSATION = 'byConversation';

function clone<T>(value: T): T {
    return structuredClone(value);
}

function byUpdatedAtDesc(a: Conversation, b: Conversation): number {
    return a.updatedAt === b.updatedAt ? 0 : a.updatedAt < b.updatedAt ? 1 : -1;
}

export function createMemoryConversationStore(
    options: { available?: boolean } = {}
): ConversationStorePort {
    const conversations = new Map<string, Conversation>();
    const messages = new Map<string, Message[]>();
    const available = options.available ?? false;
    const list = (conversationId: string): Message[] => {
        const existing = messages.get(conversationId);
        if (existing) {
            return existing;
        }
        const created: Message[] = [];
        messages.set(conversationId, created);
        return created;
    };
    return {
        available: () => available,
        listConversations: async () => [...conversations.values()].map(clone).sort(byUpdatedAtDesc),
        getConversation: async (id) => {
            const found = conversations.get(id);
            return found ? clone(found) : undefined;
        },
        putConversation: async (conversation) => {
            conversations.set(conversation.id, clone(conversation));
        },
        deleteConversation: async (id) => {
            conversations.delete(id);
            messages.delete(id);
        },
        listMessages: async (conversationId) =>
            [...list(conversationId)].sort((a, b) => a.seq - b.seq).map(clone),
        putMessage: async (message) => {
            const bucket = list(message.conversationId);
            const at = bucket.findIndex((item) => item.seq === message.seq);
            const stored = clone(message);
            if (at >= 0) {
                bucket[at] = stored;
            } else {
                bucket.push(stored);
            }
        },
        deleteMessagesAfter: async (conversationId, seq) => {
            messages.set(
                conversationId,
                list(conversationId).filter((message) => message.seq <= seq)
            );
        },
        deleteMessage: async (conversationId, seq) => {
            messages.set(
                conversationId,
                list(conversationId).filter((message) => message.seq !== seq)
            );
        },
        flush: async () => {
            /* memory writes are immediate */
        },
    };
}

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(CONVERSATIONS)) {
                db.createObjectStore(CONVERSATIONS, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(MESSAGES)) {
                const store = db.createObjectStore(MESSAGES, {
                    keyPath: ['conversationId', 'seq'],
                });
                store.createIndex(BY_CONVERSATION, 'conversationId');
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    });
}

async function withStore<T>(
    storeName: string,
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T> | null
): Promise<T | undefined> {
    const db = await openDb();
    try {
        return await new Promise<T | undefined>((resolve, reject) => {
            const tx = db.transaction(storeName, mode);
            const request = run(tx.objectStore(storeName));
            tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
            tx.oncomplete = () => resolve(request ? request.result : undefined);
            if (request) {
                request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
            }
        });
    } finally {
        db.close();
    }
}

export function createIndexedDbConversationStore(): ConversationStorePort {
    return {
        available: () => true,
        listConversations: async () => {
            const all = await withStore<Conversation[]>(CONVERSATIONS, 'readonly', (store) =>
                store.getAll() as IDBRequest<Conversation[]>
            );
            return (all ?? []).sort(byUpdatedAtDesc);
        },
        getConversation: async (id) =>
            await withStore<Conversation | undefined>(CONVERSATIONS, 'readonly', (store) =>
                store.get(id) as IDBRequest<Conversation | undefined>
            ),
        putConversation: async (conversation) => {
            await withStore(CONVERSATIONS, 'readwrite', (store) => store.put(clone(conversation)));
        },
        deleteConversation: async (id) => {
            await withStore(CONVERSATIONS, 'readwrite', (store) => store.delete(id));
            const stored = await withStore<Message[]>(MESSAGES, 'readonly', (store) =>
                store.index(BY_CONVERSATION).getAll(id) as IDBRequest<Message[]>
            );
            await withStore(MESSAGES, 'readwrite', (store) => {
                for (const message of stored ?? []) {
                    store.delete([message.conversationId, message.seq]);
                }
                return null;
            });
        },
        listMessages: async (conversationId) => {
            const all = await withStore<Message[]>(MESSAGES, 'readonly', (store) =>
                store.index(BY_CONVERSATION).getAll(conversationId) as IDBRequest<Message[]>
            );
            return (all ?? []).sort((a, b) => a.seq - b.seq);
        },
        putMessage: async (message) => {
            await withStore(MESSAGES, 'readwrite', (store) => store.put(clone(message)));
        },
        deleteMessagesAfter: async (conversationId, seq) => {
            const all = await withStore<Message[]>(MESSAGES, 'readonly', (store) =>
                store.index(BY_CONVERSATION).getAll(conversationId) as IDBRequest<Message[]>
            );
            await withStore(MESSAGES, 'readwrite', (store) => {
                for (const message of all ?? []) {
                    if (message.seq > seq) {
                        store.delete([message.conversationId, message.seq]);
                    }
                }
                return null;
            });
        },
        deleteMessage: async (conversationId, seq) => {
            await withStore(MESSAGES, 'readwrite', (store) => store.delete([conversationId, seq]));
        },
        flush: async () => {
            /* every write is committed by its transaction */
        },
    };
}

/** IndexedDB when the browser provides it, the memory fallback otherwise. */
export function openConversationStore(): ConversationStorePort {
    if (typeof indexedDB === 'undefined') {
        return createMemoryConversationStore();
    }
    return createIndexedDbConversationStore();
}
