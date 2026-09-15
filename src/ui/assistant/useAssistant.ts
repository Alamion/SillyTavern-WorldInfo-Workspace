import { useSyncExternalStore } from 'react';
import type { AssistantController, AssistantSnapshot } from '../../adapters/assistantController';

/** Subscribes a component to the assistant controller snapshot. */
export function useAssistant(controller: AssistantController): AssistantSnapshot {
    return useSyncExternalStore(controller.subscribe, controller.getSnapshot);
}
