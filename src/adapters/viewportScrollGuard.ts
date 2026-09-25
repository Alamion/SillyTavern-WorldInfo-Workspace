/**
 * Undoes page scrolls the browser makes to show a workspace field above the mobile
 * keyboard when the page itself cannot be scrolled by the user.
 *
 * Focusing a field that the keyboard would cover makes the browser scroll every
 * ancestor, the root viewport included, even when the viewport is `overflow: hidden`.
 * With the stock layout the document is exactly one screen tall, so there is nothing to
 * scroll. Host layouts whose document is taller than the screen (AstraProjecta) let the
 * root move: after the keyboard closes the workspace sheet stays shifted up with its
 * header off screen, and no gesture can bring it back. The guard remembers the root
 * scroll position when focus enters the workspace and restores it when the keyboard
 * closes or focus leaves — only while the root is not user-scrollable, so a page the
 * user can scroll is never touched.
 *
 * Rejected: making the root unscrollable with CSS — `overflow: hidden`/`clip` on the
 * viewport still allows programmatic and focus scrolling, and changing the host's page
 * layout is not ours to do.
 */

/** Growth of the visual viewport that counts as the keyboard closing. */
export const KEYBOARD_CLOSE_GROWTH_PX = 100;

export interface ViewportHost {
    readonly document: Document;
    scrollPosition(): { x: number; y: number };
    scrollTo(x: number, y: number): void;
    /** The computed `overflow-y` of an element. */
    overflowY(element: Element): string;
    visualViewport: Pick<VisualViewport, 'height' | 'addEventListener'> | null;
}

export function browserViewportHost(): ViewportHost {
    return {
        document,
        scrollPosition: () => ({ x: window.scrollX, y: window.scrollY }),
        scrollTo: (x, y) => window.scrollTo(x, y),
        overflowY: (element) => getComputedStyle(element).overflowY,
        visualViewport: window.visualViewport ?? null,
    };
}

/** The viewport takes `html`'s overflow, or `body`'s when `html` leaves it visible. */
function rootUserScrollable(host: ViewportHost): boolean {
    const { documentElement, body } = host.document;
    const own = host.overflowY(documentElement);
    const viewport = own === 'visible' && body !== null ? host.overflowY(body) : own;
    return viewport !== 'hidden' && viewport !== 'clip';
}

export function installViewportScrollGuard(
    container: HTMLElement,
    host: ViewportHost = browserViewportHost()
): void {
    let saved: { x: number; y: number } | null = null;
    let lastViewportHeight = host.visualViewport?.height ?? 0;

    const restore = (): void => {
        if (saved === null || rootUserScrollable(host)) {
            return;
        }
        const now = host.scrollPosition();
        if (now.x !== saved.x || now.y !== saved.y) {
            host.scrollTo(saved.x, saved.y);
        }
    };

    container.addEventListener('focusin', () => {
        if (saved === null) {
            saved = host.scrollPosition();
        }
    });
    container.addEventListener('focusout', (event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && container.contains(next)) {
            return;
        }
        restore();
        saved = null;
    });
    // Android keeps the field focused when the keyboard is dismissed (back gesture), so
    // the keyboard closing is seen as the visual viewport growing back.
    host.visualViewport?.addEventListener('resize', () => {
        const height = host.visualViewport?.height ?? 0;
        if (height - lastViewportHeight >= KEYBOARD_CLOSE_GROWTH_PX) {
            restore();
        }
        lastViewportHeight = height;
    });
}
