import type { SillyTavernContext, WorldInfoBook } from '../global';
import { getAppContext } from './appApi';
import { emitSaveEvent } from './saveEvents';
import { resolveFreeBookName } from '../core/sync/bookNaming';
import { normalizeNativeEntry } from '../core/state/schema';
import { fnv1a, stableStringify } from '../core/sync/fingerprint';

/**
 * Book lifecycle over the app's World Info mechanisms (contract:
 * native-wi-contract.md "Book create / delete / rename"). The context exposes
 * load/save/list/refresh but NOT create/delete — those compose the app's own
 * endpoints here (documented deviation, plan.md Complexity Tracking).
 */
export interface WorldInfoAdapter {
    listBooks(): string[];
    refreshBooks(): Promise<void>;
    loadBook(name: string): Promise<WorldInfoBook | null>;
    saveBook(name: string, book: WorldInfoBook, immediately?: boolean): Promise<void>;
    getLastOutbound(name?: string): WorldInfoBook | null;
    /**
     * True when `book` (as loaded) is the workspace's own write that failed to
     * reach the server: the app caches a payload BEFORE its fetch, so after a
     * network failure the cache serves the unsent write, not a native change.
     */
    isUnsentOwnWrite(name: string, book: WorldInfoBook): boolean;
    resolveBookName(base: string): Promise<string>;
    uploadBook(file: File): Promise<{ name: string } | null>;
    createBook(baseName: string): Promise<{ bookName: string } | null>;
    deleteBook(name: string): Promise<boolean>;
    renameBook(oldName: string, newBase: string): Promise<{ bookName: string } | null>;
}

function errorText(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

export function createWorldInfoAdapter(ctx: SillyTavernContext): WorldInfoAdapter {
    let lastOutbound: WorldInfoBook | null = null;
    // Per-book outbound payloads: WORLDINFO_UPDATED passes the same reference
    // the app cached (cloneOnSet:false), but with several books saved in a row
    // a single lastOutbound slot would misclassify the earlier book's event as
    // external. Track one reference per book name.
    const outboundByBook = new Map<string, WorldInfoBook>();
    const unsentByBook = new Map<string, string>();

    const setOutbound = (name: string, payload: WorldInfoBook): void => {
        lastOutbound = payload;
        outboundByBook.set(name, payload);
    };

    // Sanitize contract (app utils.js getSanitizedFilename, files.js): POST
    // { fileName } -> JSON { fileName: sanitized }.
    const sanitize = async (name: string): Promise<string> => {
        try {
            const response = await fetch('/api/files/sanitize-filename', {
                method: 'POST',
                headers: ctx.getRequestHeaders(),
                body: JSON.stringify({ fileName: name }),
            });
            if (!response.ok) {
                return name;
            }
            const data = (await response.json()) as { fileName?: unknown };
            return typeof data.fileName === 'string' && data.fileName.trim() !== ''
                ? data.fileName
                : name;
        } catch {
            return name;
        }
    };

    const normalizeBook = (book: WorldInfoBook): WorldInfoBook => ({
        ...book,
        entries: Object.fromEntries(
            Object.keys(book.entries ?? {}).map((key) => [key, normalizeNativeEntry(book.entries[key]!)])
        ),
    });

    const bookFingerprint = (book: WorldInfoBook): string => fnv1a(stableStringify(book));

    const loadBook = async (name: string): Promise<WorldInfoBook | null> => {
        // Never load a name outside the current list — the module cache cannot be
        // evicted externally after an adapter-level delete (research R3 caveat).
        if (!ctx.getWorldInfoNames().includes(name)) {
            return null;
        }
        const book = await ctx.loadWorldInfo(name);
        if (!book) {
            return null;
        }
        // Normalize on read (additive): entries from other tools may lack newer
        // fields. Comparisons and fingerprints are stable only against complete
        // entries; without this, plan/refresh hashing loops forever.
        return normalizeBook(book);
    };

    const saveBook = async (name: string, book: WorldInfoBook, immediately = false): Promise<void> => {
        // Clone handoff: the cache stores the caller's reference (research R1).
        const payload = structuredClone(book);
        setOutbound(name, payload);
        try {
            await ctx.saveWorldInfo(name, payload, immediately);
        } catch (error) {
            unsentByBook.set(name, bookFingerprint(normalizeBook(structuredClone(payload))));
            emitSaveEvent({
                kind: 'failure',
                scope: 'book',
                bookName: name,
                message: `Failed to save "${name}": ${errorText(error)}`,
            });
            outboundByBook.delete(name);
            lastOutbound = outboundByBook.get(name) ?? null;
            throw error;
        }
        unsentByBook.delete(name);
        emitSaveEvent({ kind: 'success', scope: 'book', bookName: name });
    };

    const resolveBookName = async (base: string): Promise<string> => {
        const resolved = await resolveFreeBookName(base, ctx.getWorldInfoNames(), sanitize);
        return resolved ?? base;
    };

    const createBook = async (baseName: string): Promise<{ bookName: string } | null> => {
        const name = await resolveBookName(baseName);
        const payload: WorldInfoBook = { entries: {} };
        setOutbound(name, payload);
        try {
            await ctx.saveWorldInfo(name, payload, true);
        } catch (error) {
            emitSaveEvent({
                kind: 'failure',
                scope: 'book',
                bookName: name,
                message: `Failed to create "${name}": ${errorText(error)}`,
            });
            return null;
        }
        await ctx.updateWorldInfoList();
        return { bookName: name };
    };

    const deleteBook = async (name: string): Promise<boolean> => {
        try {
            const response = await fetch('/api/worldinfo/delete', {
                method: 'POST',
                headers: ctx.getRequestHeaders(),
                body: JSON.stringify({ name }),
            });
            if (!response.ok) {
                return false;
            }
        } catch (error) {
            emitSaveEvent({
                kind: 'failure',
                scope: 'book',
                bookName: name,
                message: `Failed to delete "${name}": ${errorText(error)}`,
            });
            return false;
        }
        lastOutbound = null;
        await ctx.updateWorldInfoList();
        return true;
    };

    // File import (native parity): POST /api/worldinfo/import with FormData
    // field 'avatar' (world-info.js importWorldInfo, worldinfo.js /import);
    // response { name } is the created book's name (sanitized file name).
    const uploadBook = async (file: File): Promise<{ name: string } | null> => {
        try {
            const formData = new FormData();
            formData.append('avatar', file);
            const result = await fetch('/api/worldinfo/import', {
                method: 'POST',
                headers: ctx.getRequestHeaders({ omitContentType: true }),
                body: formData,
                cache: 'no-cache',
            });
            if (!result.ok) {
                return null;
            }
            const data = (await result.json()) as { name?: string };
            if (!data.name) {
                return null;
            }
            await ctx.updateWorldInfoList();
            return { name: data.name };
        } catch {
            return null;
        }
    };

    const renameBook = async (oldName: string, newBase: string): Promise<{ bookName: string } | null> => {
        const existing = ctx.getWorldInfoNames();
        const current = await loadBook(oldName);
        if (!current) {
            return null;
        }
        const newName = await resolveFreeBookName(newBase, existing.filter((n) => n !== oldName), sanitize);
        if (!newName) {
            return null;
        }
        const copy: WorldInfoBook = { ...structuredClone(current), name: newName };
        await saveBook(newName, copy, true);
        await deleteBook(oldName);
        return { bookName: newName };
    };

    return {
        listBooks: () => ctx.getWorldInfoNames(),
        refreshBooks: () => ctx.updateWorldInfoList(),
        loadBook,
        saveBook,
        getLastOutbound: (name?: string): WorldInfoBook | null =>
            name ? (outboundByBook.get(name) ?? null) : lastOutbound,
        isUnsentOwnWrite: (name: string, book: WorldInfoBook): boolean => {
            const unsent = unsentByBook.get(name);
            return unsent !== undefined && unsent === bookFingerprint(book);
        },
        resolveBookName,
        createBook,
        deleteBook,
        uploadBook,
        renameBook,
    };
}

export function createWorldInfoAdapterWithAppContext(): WorldInfoAdapter {
    return createWorldInfoAdapter(getAppContext());
}