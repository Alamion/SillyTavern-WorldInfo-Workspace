import { createRoot } from 'react-dom/client';
import type { WorkspaceStateServices } from '../adapters/settingsStore';
import { installViewportScrollGuard } from '../adapters/viewportScrollGuard';
import '../styles/prototype.scss';
import { WorkspaceApp } from './WorkspaceApp';

/** Typing events that the app's document-level jQuery handlers would otherwise inspect. */
const TYPING_EVENTS = ['keydown', 'keyup', 'keypress', 'beforeinput', 'input', 'change', 'compositionend'] as const;

function isEditable(target: EventTarget | null): boolean {
    return (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
    );
}

export function mountWorkspaceSurface(
    container: HTMLElement,
    services: WorkspaceStateServices
): void {
    createRoot(container).render(<WorkspaceApp services={services} />);
    installViewportScrollGuard(container);
    // Performance: the app registers many delegated jQuery handlers on `document`; every
    // keystroke bubbling out of a workspace field made jQuery match all their selectors
    // (most of the typing cost). React has already handled the event at this container
    // (its listeners were attached first), so editing events stop here. Escape still
    // propagates so the app's close-on-Escape behavior keeps working.
    for (const type of TYPING_EVENTS) {
        container.addEventListener(type, (event) => {
            if (!isEditable(event.target)) {
                return;
            }
            if (event instanceof KeyboardEvent && event.key === 'Escape') {
                return;
            }
            event.stopPropagation();
        });
    }
}
