import { createContext, useContext } from 'react';
import { getLayoutSettings } from '../core/state/layout';
import { createDefaultState, type LayoutSettings } from '../core/state/schema';

/**
 * Saved region sizes for components deep in the tree (the content editor's
 * preview splitter), provided by WorkspaceApp (2026-09-22).
 */
export interface LayoutContextValue {
    layout: LayoutSettings;
    saveLayout: (patch: Partial<LayoutSettings>) => void;
}

export const LayoutContext = createContext<LayoutContextValue>({
    layout: getLayoutSettings(createDefaultState()),
    saveLayout: () => undefined,
});

export function useLayout(): LayoutContextValue {
    return useContext(LayoutContext);
}
