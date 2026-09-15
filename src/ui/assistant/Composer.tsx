import { useState } from 'react';
import type { AssistantMode } from '../../core/assistant/types';

/**
 * Request composer (spec 005 FR-002, FR-003): Enter sends on desktop,
 * Shift+Enter inserts a newline, and Send turns into Stop while a request runs.
 */
export function Composer({
    mode,
    busy,
    disabled,
    contextSummary,
    onSend,
    onStop,
    onModeChange,
    onOpenContext,
}: {
    mode: AssistantMode;
    busy: boolean;
    disabled: boolean;
    contextSummary: string;
    onSend: (text: string) => void;
    onStop: () => void;
    onModeChange: (mode: AssistantMode) => void;
    onOpenContext: () => void;
}): JSX.Element {
    const [text, setText] = useState('');
    const send = (): void => {
        const trimmed = text.trim();
        if (trimmed === '' || busy || disabled) {
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
                value={text}
                disabled={disabled}
                placeholder={
                    mode === 'propose'
                        ? 'Ask for new entries, an edit, or a reorganization…'
                        : 'Ask about the lore…'
                }
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
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
                    <button type="button" className="wiw-button" disabled={disabled} onClick={send}>
                        <i className="fa-solid fa-paper-plane" /> Send
                    </button>
                )}
            </div>
        </div>
    );
}
