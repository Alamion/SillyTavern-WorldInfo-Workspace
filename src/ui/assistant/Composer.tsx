import { useLayoutEffect, useRef, useState } from 'react';
import { sendsOnEnter } from '../../adapters/appApi';
import { createComposerDraft } from '../../adapters/composerDraft';
import type { AssistantMode } from '../../core/assistant/types';

const draft = createComposerDraft();

/** Browsers that size a textarea to its content in CSS (as the app's own chat input does). */
const cssAutofit = typeof CSS !== 'undefined' && CSS.supports('field-sizing', 'content');

/**
 * Fallback for browsers without `field-sizing`: the app's `autoFitSendTextArea`
 * pattern — collapse, then take the content height; CSS min/max-height clamp it.
 */
function fitToContent(textarea: HTMLTextAreaElement): void {
    textarea.style.height = '1px';
    textarea.style.height = `${String(textarea.scrollHeight)}px`;
}

/**
 * Request composer (spec 005 FR-002, FR-003): Enter sends where the app's chat
 * sends on Enter (never on phones: Enter is their newline key), Shift+Enter
 * inserts a newline, and Send turns into Stop while a request runs. Unsent text
 * survives closing and reopening the workspace (FR-002a). With an empty input,
 * Send answers the last message when it is the user's (`canSendEmpty`).
 */
export function Composer({
    mode,
    busy,
    disabled,
    canSendEmpty,
    contextSummary,
    onSend,
    onStop,
    onModeChange,
    onOpenContext,
}: {
    mode: AssistantMode;
    busy: boolean;
    disabled: boolean;
    /** The conversation ends with a user message: an empty send asks for its reply. */
    canSendEmpty: boolean;
    contextSummary: string;
    onSend: (text: string) => void;
    onStop: () => void;
    onModeChange: (mode: AssistantMode) => void;
    onOpenContext: () => void;
}): JSX.Element {
    const [text, setTextState] = useState(() => draft.load());
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    // Grows while typing, shrinks after sending or clearing (owner request 2026-09-17:
    // a phone cannot drag the resize handle).
    useLayoutEffect(() => {
        if (!cssAutofit && textareaRef.current) {
            fitToContent(textareaRef.current);
        }
    }, [text]);
    const setText = (value: string): void => {
        setTextState(value);
        draft.save(value);
    };
    const send = (): void => {
        const trimmed = text.trim();
        if ((trimmed === '' && !canSendEmpty) || busy || disabled) {
            return;
        }
        setText('');
        onSend(trimmed);
    };
    return (
        <div className="wiw-assistant-composer">
            <div className="wiw-assistant-composer-row">
                <button
                    type="button"
                    className={`wiw-button ${mode === 'propose' ? 'wiw-button-active' : ''}`}
                    onClick={() => onModeChange('propose')}
                    title="Replies may contain change proposals"
                >
                    Propose
                </button>
                <button
                    type="button"
                    className={`wiw-button ${mode === 'discuss' ? 'wiw-button-active' : ''}`}
                    onClick={() => onModeChange('discuss')}
                    title="Text only — no proposals"
                >
                    Discuss
                </button>
                <button type="button" className="wiw-button" onClick={onOpenContext}>
                    <i className="fa-solid fa-sliders" /> {contextSummary}
                </button>
            </div>
            <textarea
                ref={textareaRef}
                value={text}
                disabled={disabled}
                placeholder={
                    mode === 'propose'
                        ? 'Ask for new entries, an edit, or a reorganization…'
                        : 'Ask about the lore…'
                }
                onChange={(event) => {
                    if (cssAutofit) {
                        // Drop a manual drag size so the field follows its content again.
                        event.target.style.height = '';
                    }
                    setText(event.target.value);
                }}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && sendsOnEnter()) {
                        event.preventDefault();
                        send();
                    }
                }}
            />
            <div className="wiw-assistant-composer-row">
                {busy ? (
                    <button type="button" className="wiw-button" onClick={onStop}>
                        <i className="fa-solid fa-stop" /> Stop
                    </button>
                ) : (
                    <button
                        type="button"
                        className="wiw-button"
                        disabled={disabled}
                        title={
                            text.trim() === '' && canSendEmpty
                                ? 'Ask for a reply to your last message'
                                : undefined
                        }
                        onClick={send}
                    >
                        <i className="fa-solid fa-paper-plane" /> Send
                    </button>
                )}
            </div>
        </div>
    );
}
