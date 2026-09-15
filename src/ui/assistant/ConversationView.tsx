import { memo, useEffect, useRef, useState } from 'react';
import { renderMarkdown } from '../../core/preview';
import { displayText, statusText } from '../../core/assistant/display';
import type { Message } from '../../core/assistant/types';
import { FailureCard } from './FailureCard';

/**
 * Conversation log (spec 005 FR-002, FR-005, FR-030). Message rows are memoized
 * so a streaming reply only re-renders its own row (SC-007).
 */

export interface MessageActions {
    onRetry: (seq: number) => void;
    onRetryNow: (seq: number) => void;
    onCancelRetry: () => void;
    onOpenItem: (handle: string, snapshotHandles: Record<string, string>) => void;
}

/** Splits prose into text and `[[handle]]` references (FR-005). */
function renderProse(
    text: string,
    handles: Record<string, string>,
    onOpenItem: MessageActions['onOpenItem']
): JSX.Element[] {
    const parts = text.split(/(\[\[[A-Za-z0-9_-]+\]\])/g);
    return parts.map((part, index) => {
        const match = /^\[\[([A-Za-z0-9_-]+)\]\]$/.exec(part);
        if (!match) {
            return (
                <span
                    key={index}
                    className="wiw-bubble-text"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(part) }}
                />
            );
        }
        const handle = match[1] ?? '';
        return (
            <button
                key={index}
                type="button"
                className="wiw-assistant-ref"
                onClick={() => onOpenItem(handle, handles)}
            >
                {handle}
            </button>
        );
    });
}

const MessageRow = memo(function MessageRow({
    message,
    actions,
    children,
}: {
    message: Message;
    actions: MessageActions;
    children?: React.ReactNode;
}): JSX.Element {
    // The elapsed-time counter ticks on its own while waiting for the first chunk.
    const [, setTick] = useState(0);
    useEffect(() => {
        if (message.status !== 'pending') {
            return;
        }
        const timer = setInterval(() => setTick((value) => value + 1), 1000);
        return () => clearInterval(timer);
    }, [message.status]);
    const status = statusText(message);
    const shown = displayText(message);
    const handles = message.context?.handles ?? {};
    return (
        <div className={`wiw-bubble wiw-bubble-${message.role}`}>
            {shown !== '' && renderProse(shown, handles, actions.onOpenItem)}
            {message.reasoning !== undefined && message.reasoning !== '' && (
                <details className="wiw-collapsible">
                    <summary>Thinking</summary>
                    <pre className="wiw-notice-excerpt">{message.reasoning}</pre>
                </details>
            )}
            {message.previousText !== undefined && (
                <details className="wiw-collapsible">
                    <summary>Previous version</summary>
                    <pre className="wiw-notice-excerpt">{message.previousText}</pre>
                </details>
            )}
            {children}
            {message.failure !== undefined && message.status !== 'stopped' && (
                <FailureCard
                    failure={message.failure}
                    retryAt={message.status === 'retry-wait' ? message.retryAt : undefined}
                    onRetry={() => actions.onRetry(message.seq)}
                    onRetryNow={() => actions.onRetryNow(message.seq)}
                    onCancelRetry={actions.onCancelRetry}
                />
            )}
            {(status !== null || message.origin !== undefined) && (
                <div className="wiw-bubble-meta">
                    {message.origin !== undefined && (
                        <span>
                            {message.origin.profileName}
                            {message.origin.model !== '' ? ` · ${message.origin.model}` : ''}
                        </span>
                    )}
                    {status !== null && <span className="wiw-assistant-status">{status}</span>}
                </div>
            )}
        </div>
    );
});

export function ConversationView({
    messages,
    actions,
    renderBatch,
}: {
    messages: readonly Message[];
    actions: MessageActions;
    renderBatch?: (message: Message) => React.ReactNode;
}): JSX.Element {
    const logRef = useRef<HTMLDivElement | null>(null);
    const lastText = messages.at(-1)?.text.length ?? 0;
    useEffect(() => {
        const log = logRef.current;
        if (log) {
            log.scrollTop = log.scrollHeight;
        }
    }, [messages.length, lastText]);

    if (messages.length === 0) {
        return (
            <div className="wiw-assistant-log" ref={logRef}>
                <p className="wiw-assistant-empty">
                    Ask for new lore, an edit, or a reorganization. Proposals are previewed before
                    anything changes.
                </p>
            </div>
        );
    }
    return (
        <div className="wiw-assistant-log" ref={logRef}>
            {messages.map((message) => (
                <MessageRow key={`${message.conversationId}-${String(message.seq)}`} message={message} actions={actions}>
                    {renderBatch?.(message)}
                </MessageRow>
            ))}
        </div>
    );
}
