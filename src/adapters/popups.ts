import { getAppContext } from './appApi';

/**
 * Confirmation and input dialogs over the app's own popup system (constitution
 * II: no window.confirm). Text is parameterized so US3 can reuse these for the
 * FR-021 native-copy disclosure and divergence resolutions.
 */
export async function confirmDialog(message: string): Promise<boolean> {
    const ctx = getAppContext();
    const panel = document.createElement('div');
    panel.className = 'wiw-confirm';
    const text = document.createElement('p');
    text.textContent = message;
    panel.appendChild(text);
    const result = await ctx.callGenericPopup(panel, ctx.POPUP_TYPE.CONFIRM);
    return result === ctx.POPUP_RESULT.AFFIRMATIVE;
}

export async function inputDialog(message: string, defaultValue: string): Promise<string | null> {
    const ctx = getAppContext();
    const result = await ctx.callGenericPopup(message, ctx.POPUP_TYPE.INPUT, defaultValue);
    if (typeof result !== 'string') {
        return null;
    }
    return result;
}
