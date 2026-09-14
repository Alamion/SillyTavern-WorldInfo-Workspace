import type { SillyTavernToastr } from '../global';

const MODULE_TAG = '[WorldInfoWorkspace]';

function toastr(): SillyTavernToastr | undefined {
    return window.toastr;
}

/**
 * Namespaced logging per the constitution: console debug in development, toastr
 * info/warn/error for user-visible feedback. Never console.error for anything a
 * user must act on — route that through `notifyError` so the toast appears.
 */
export function debugLog(message: string): void {
    console.debug(`${MODULE_TAG} ${message}`);
}

export function notifyInfo(message: string): void {
    toastr()?.info(message, 'World Info Workspace');
}

export function notifySuccess(message: string): void {
    toastr()?.success(message, 'World Info Workspace');
}

export function notifyWarning(message: string): void {
    toastr()?.warning(message, 'World Info Workspace');
}

export function notifyError(message: string): void {
    toastr()?.error(message, 'World Info Workspace');
}