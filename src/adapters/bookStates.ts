/**
 * Runtime app facts the book lists need: which native books are globally
 * active, bound to the current character, or bound to the current chat.
 * Facts verified against the vendored app sources (world-info.js):
 * - global activation lives in the #world_info select / selected_world_info,
 * - the character's primary lorebook is characters[characterId].data.extensions.world,
 * - the chat lorebook is the STRING chat_metadata.world_info (METADATA_KEY).
 * Character and chat values are snapshots, so they are read from a fresh context.
 * Additional character lorebooks (world_info.charLore) are not exposed by the
 * context and are not reported.
 */
import { getLiveAppContext } from './appApi';
import type { BookFacts } from '../core/books/listing';
import { buildNodeIndex, type WorkspaceState } from '../core/state/schema';

const CHAT_METADATA_KEY = 'world_info';

export function collectBookFacts(activeBooks: readonly string[], state: WorkspaceState): BookFacts[] {
    const ctx = getLiveAppContext();
    const globallyActive = new Set(activeBooks);
    const characterId = ctx.characterId === undefined ? undefined : Number(ctx.characterId);
    const character = characterId !== undefined && Number.isInteger(characterId) ? ctx.characters[characterId] : undefined;
    const characterWorld = character?.data?.extensions?.world ?? '';
    const chatWorld = ctx.chatMetadata?.[CHAT_METADATA_KEY];

    const roots = new Map<string, { id: string; name: string }>();
    for (const node of buildNodeIndex(state.root).values()) {
        if (node.kind === 'folder' && node.isWiRoot && node.book) {
            roots.set(node.book.bookName, { id: node.id, name: node.name });
        }
    }

    return ctx.getWorldInfoNames().map((name) => ({
        name,
        globallyActive: globallyActive.has(name),
        characterBound: characterWorld !== '' && characterWorld === name,
        chatBound: typeof chatWorld === 'string' && chatWorld === name,
        workspaceRoot: roots.get(name)?.name ?? null,
        workspaceRootId: roots.get(name)?.id ?? null,
    }));
}
