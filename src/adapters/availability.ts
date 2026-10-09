import {
    computeAvailability,
    type Availability,
    type AvailabilityFacts,
    type ExtensionFact,
    type FeatureId,
    type FeatureState,
    type ProfileFact,
} from '../core/availability';
import { getImageSettings } from '../core/images/settings';
import { getPickingSettings } from '../core/picking/settings';
import { getAssistantSettings } from '../core/state/schema';
import type { WorkspaceStore } from '../core/state/store';
import type { SillyTavernContext } from '../global';
import { folderAccessFact, onFolderAccessChanged } from './fsaDisk';

/**
 * Collects the facts behind core/availability.ts from the app (spec 009 R6) and
 * keeps one snapshot for the UI. Re-checked when the workspace is shown, on the
 * app's settings and profile events, on workspace settings changes and when the
 * folder picker was refused.
 */

const CONNECTION_MANAGER = 'connection-manager';
const IMAGE_GENERATION = 'stable-diffusion';
const EVENTS = [
    'SETTINGS_UPDATED',
    'EXTENSION_SETTINGS_LOADED',
    'CONNECTION_PROFILE_LOADED',
    'CONNECTION_PROFILE_CREATED',
    'CONNECTION_PROFILE_UPDATED',
    'CONNECTION_PROFILE_DELETED',
] as const;

export interface AvailabilityService {
    get(): Availability;
    feature(id: FeatureId): FeatureState;
    refresh(): void;
    subscribe(listener: () => void): () => void;
    start(): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

export function readFacts(ctx: SillyTavernContext, store: WorkspaceStore, folderAccess = folderAccessFact): AvailabilityFacts {
    const disabled = Array.isArray(ctx.extensionSettings.disabledExtensions) ? ctx.extensionSettings.disabledExtensions : [];
    const service = ctx.ConnectionManagerRequestService;
    const connectionManager: ExtensionFact = disabled.includes(CONNECTION_MANAGER)
        ? 'disabled'
        : service
          ? 'enabled'
          : 'missing';
    let profiles: ProfileFact[] = [];
    if (connectionManager === 'enabled' && service) {
        try {
            profiles = service.getSupportedProfiles().map((profile) => ({
                id: profile.id,
                api: profile.mode === 'tc' ? 'text-completion' : 'chat-completion',
            }));
        } catch {
            profiles = [];
        }
    }
    const imagine = ctx.SlashCommandParser?.commands['imagine'];
    const imageGeneration: ExtensionFact = disabled.includes(IMAGE_GENERATION)
        ? 'disabled'
        : isRecord(imagine) && typeof imagine['callback'] === 'function'
          ? 'enabled'
          : 'missing';
    const sd = ctx.extensionSettings['sd'];
    const imageSource = isRecord(sd) && typeof sd['source'] === 'string' ? sd['source'] : '';
    const state = store.getState();
    const images = getImageSettings(state);
    return {
        connectionManager,
        profiles,
        assistantProfileId: getAssistantSettings(state).profileId,
        pickingProfileId: getPickingSettings(state).profileId,
        captionProfileId: images.captionProfileId,
        promptProfileId: images.promptProfileId,
        imageGeneration,
        imageSource,
        folderAccess: folderAccess(),
    };
}

function sameAvailability(a: Availability, b: Availability): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

export function createAvailability(deps: {
    context: () => SillyTavernContext;
    store: WorkspaceStore;
    folderAccess?: () => ReturnType<typeof folderAccessFact>;
}): AvailabilityService {
    const listeners = new Set<() => void>();
    const compute = (): Availability => computeAvailability(readFacts(deps.context(), deps.store, deps.folderAccess));
    let snapshot = compute();

    const refresh = (): void => {
        const next = compute();
        if (!sameAvailability(next, snapshot)) {
            snapshot = next;
            listeners.forEach((listener) => listener());
        }
    };

    return {
        get: () => snapshot,
        feature: (id) => snapshot[id],
        refresh,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        start() {
            const ctx = deps.context();
            for (const name of EVENTS) {
                const event = ctx.eventTypes[name];
                if (typeof event === 'string') {
                    ctx.eventSource.on(event, refresh);
                }
            }
            onFolderAccessChanged(refresh);
            // Settings that choose profiles live in the workspace state.
            let previousSettings = deps.store.getState().settings;
            deps.store.subscribe(() => {
                const settings = deps.store.getState().settings;
                if (settings !== previousSettings) {
                    previousSettings = settings;
                    refresh();
                }
            });
            // Extensions register commands after the app is ready (Memory Books ~10 s).
            setTimeout(refresh, 0);
        },
    };
}
