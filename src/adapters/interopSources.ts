import { readScene } from '../core/interop/doomsTracker';
import type { InteropPort } from '../core/assistant/ports';
import { getLiveAppContext } from './appApi';
import { debugLog } from './logger';

/**
 * Optional interop with other lore extensions (spec 007 US4, research R8/R14).
 * Nothing here is a dependency: every probe runs at the moment of use (Memory
 * Books registers its commands ~10 s after load), and anything missing or
 * oddly shaped answers "unavailable".
 */

type DeepLoreMatcher = (input: string | readonly unknown[]) => Promise<unknown>;

function deepLoreMatcher(): DeepLoreMatcher | null {
    const candidate: unknown = (globalThis as Record<string, unknown>)['deepLoreEnhanced_matchText'];
    return typeof candidate === 'function' ? (candidate as DeepLoreMatcher) : null;
}

function hasCommand(name: string): boolean {
    try {
        return getLiveAppContext().SlashCommandParser?.commands[name] !== undefined;
    } catch {
        return false;
    }
}

export function createInteropSources(): InteropPort {
    return {
        scene() {
            try {
                return readScene(getLiveAppContext().chatMetadata);
            } catch {
                return null;
            }
        },
        deepLoreAvailable: () => deepLoreMatcher() !== null,
        async deepLoreMatches(texts) {
            const matcher = deepLoreMatcher();
            if (matcher === null) {
                return null;
            }
            try {
                const result: unknown = await matcher(texts.join('\n'));
                if (typeof result !== 'object' || result === null) {
                    return null;
                }
                const record = result as Record<string, unknown>;
                return {
                    text: typeof record['text'] === 'string' ? record['text'] : '',
                    count: typeof record['count'] === 'number' ? record['count'] : 0,
                };
            } catch (error) {
                debugLog(`DeepLore matcher failed: ${String(error)}`);
                return null;
            }
        },
        memoryBooksAvailable: () => hasCommand('creatememory'),
        async createMemory() {
            const context = getLiveAppContext();
            if (!hasCommand('creatememory') || typeof context.executeSlashCommandsWithOptions !== 'function') {
                return false;
            }
            try {
                await context.executeSlashCommandsWithOptions('/creatememory');
                return true;
            } catch (error) {
                debugLog(`Memory Books /creatememory failed: ${String(error)}`);
                return false;
            }
        },
    };
}
