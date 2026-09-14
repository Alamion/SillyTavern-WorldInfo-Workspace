/**
 * Runtime app state the Books panel needs: which native books are globally
 * active, bound to the current character, or bound to the current chat.
 * Facts verified against the vendored app sources (world-info.js):
 * - global activation lives in the #world_info select / selected_world_info,
 * - the character's lorebook is characters[characterId].data.extensions.world,
 * - the chat lorebook lives in chat_metadata.world_info (METADATA_KEY).
 */
import type { SillyTavernContext } from '../global';

export interface BookState {
    name: string;
    globallyActive: boolean;
    characterBound: boolean;
    chatBound: boolean;
}

const CHAT_METADATA_KEY = 'world_info';

export function collectBookStates(ctx: SillyTavernContext, activeBooks: readonly string[]): BookState[] {
    const globallyActive = new Set(activeBooks);
    const chid = ctx.eventTypes.CHAT_CHANGED ? (ctx as { characterId?: number }).characterId : undefined;
    const character = Array.isArray((ctx as { characters?: unknown[] }).characters)
        ? (ctx as unknown as { characters: Array<{ data?: { extensions?: { world?: string } } } | undefined>; characterId: number | undefined }).characters[chid ?? -1]
        : undefined;
    const characterWorld = character?.data?.extensions?.world ?? '';
    const chatMetadata = (ctx as { chatMetadata?: Record<string, unknown> }).chatMetadata ?? {};
    const chatEntry = chatMetadata[CHAT_METADATA_KEY];
    const chatWorld =
        chatEntry && typeof chatEntry === 'object' && 'world' in chatEntry
            ? String((chatEntry as { world?: unknown }).world ?? '')
            : '';

    return ctx.getWorldInfoNames().map((name) => ({
        name,
        globallyActive: globallyActive.has(name),
        characterBound: characterWorld === name,
        chatBound: chatWorld === name,
    }));
}