import type { PickRecordView } from '../core/picking/display';
import { pickDetailsHtml } from '../core/picking/display';
import { getAppContext, getLiveAppContext } from './appApi';
import { PICK_EXTRA_KEY, type PickingController } from './pickingController';

/**
 * The reply icon of main-chat lore picking (spec 007 FR-024, research R10): one
 * button in the app's message template (the slot bundled extensions use), shown
 * only on replies that carry a recorded pick; a click opens the details.
 */

const BUTTON_CLASS = 'wiw-pick-button';
const HAS_PICK_CLASS = 'wiw-has-pick';

function recordOf(messageId: number): PickRecordView | null {
    const message = getLiveAppContext().chat[messageId];
    const record = message?.extra?.[PICK_EXTRA_KEY];
    return typeof record === 'object' && record !== null && Array.isArray((record as PickRecordView).picked)
        ? (record as PickRecordView)
        : null;
}

function refresh(messageId: number): void {
    const element = document.querySelector(`#chat .mes[mesid="${String(messageId)}"]`);
    element?.classList.toggle(HAS_PICK_CLASS, recordOf(messageId) !== null);
}

function refreshAll(): void {
    document.querySelectorAll<HTMLElement>('#chat .mes[mesid]').forEach((element) => {
        element.classList.toggle(HAS_PICK_CLASS, recordOf(Number(element.getAttribute('mesid'))) !== null);
    });
}

export function mountPickIndicator(picking: PickingController, onRecorded: (listener: (id: number) => void) => () => void): void {
    const template = document.querySelector('#message_template .mes_buttons .extraMesButtons');
    if (template && !template.querySelector(`.${BUTTON_CLASS}`)) {
        const button = document.createElement('div');
        button.className = `mes_button ${BUTTON_CLASS} fa-solid fa-book-open-reader interactable`;
        button.title = 'Lore picked for this reply';
        button.tabIndex = 0;
        template.prepend(button);
    }

    document.addEventListener('click', (event) => {
        const target = event.target instanceof Element ? event.target.closest(`.${BUTTON_CLASS}`) : null;
        const mes = target?.closest('.mes');
        if (!target || !mes) {
            return;
        }
        const record = recordOf(Number(mes.getAttribute('mesid')));
        if (record === null) {
            return;
        }
        const ctx = getAppContext();
        const content = document.createElement('div');
        content.innerHTML = pickDetailsHtml(record);
        const fresh = document.createElement('button');
        fresh.type = 'button';
        fresh.className = 'menu_button';
        fresh.textContent = 'Pick fresh next time';
        fresh.title = 'The next reply runs a new pick instead of the prepared one';
        fresh.addEventListener('click', () => {
            picking.forceFresh();
            fresh.disabled = true;
            fresh.textContent = 'The next reply picks fresh';
        });
        content.append(fresh);
        void ctx.callGenericPopup(content, ctx.POPUP_TYPE.TEXT, '', { wide: false, allowVerticalScrolling: true });
    });

    const ctx = getAppContext();
    const types = ctx.eventTypes;
    ctx.eventSource.on(types.CHAT_CHANGED, () => setTimeout(refreshAll, 0));
    ctx.eventSource.on(types.MESSAGE_SWIPED, (id) => setTimeout(() => refresh(Number(id)), 0));
    ctx.eventSource.on(types.CHARACTER_MESSAGE_RENDERED, (id) => refresh(Number(id)));
    onRecorded((id) => setTimeout(() => refresh(id), 0));
    refreshAll();
}
