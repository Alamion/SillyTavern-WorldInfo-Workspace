import { memo, useEffect, useRef, useState } from 'react';
import { displayText, replyHtml, statusText } from '../../core/assistant/display';
import type { Message } from '../../core/assistant/types';
import { variantCount, variantIndex } from '../../core/assistant/variants';
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
    /** Message tools (owner request 2026-09-16). */
    onShowVariant: (seq: number, index: number) => void;
    onNewVariant: (seq: number) => void;
    onFork: (seq: number) => void;
    onDelete: (message: Message) => void;
}

/** Row state that decides which message tools are usable. */
interface RowTools {
    /** The last reply of the conversation: the only one with version arrows. */
    swipeable: boolean;
    /** A request is running (tools that start or reshape one are disabled). */
    busy: boolean;
    /** No usable connection: a new version cannot be generated. */
    blocked: boolean;
}

/** Version arrows, fork and delete — the icons of the app's own chat. */
function MessageTools({
    message,
    actions,
    tools,
}: {
    message: Message;
    actions: MessageActions;
    tools: RowTools;
}): JSX.Element {
    const running = message.status === 'pending' || message.status === 'receiving';
    const count = variantCount(message);
    const index = variantIndex(message);
    const atLast = index >= count - 1;
    return (
        <span className="wiw-message-tools">
            {message.role === 'assistant' && (tools.swipeable || count > 1) && (
                <span className="wiw-message-swipe">
                    <button
                        type="button"
                        className="wiw-message-tool"
                        title="Previous version"
                        disabled={tools.busy || index === 0}
                        onClick={() => actions.onShowVariant(message.seq, index - 1)}
                    >
                        <i className="fa-solid fa-chevron-left" />
                    </button>
                    <span className="wiw-message-counter">
                        {String(index + 1)}/{String(count)}
                    </span>
                    <button
                        type="button"
                        className="wiw-message-tool"
                        title={atLast ? 'Generate another version' : 'Next version'}
                        disabled={tools.busy || (atLast && (!tools.swipeable || tools.blocked))}
                        onClick={() =>
                            atLast ? actions.onNewVariant(message.seq) : actions.onShowVariant(message.seq, index + 1)
                        }
                    >
                        <i className="fa-solid fa-chevron-right" />
                    </button>
                </span>
            )}
            <button
                type="button"
                className="wiw-message-tool"
                title="Fork: continue in a new conversation from this message"
                disabled={tools.busy || running}
                onClick={() => actions.onFork(message.seq)}
            >
                <i className="fa-solid fa-code-branch" />
            </button>
            <button
                type="button"
                className="wiw-message-tool"
                title="Delete message"
                disabled={tools.busy && running}
                onClick={() => actions.onDelete(message)}
            >
                <i className="fa-solid fa-trash-can" />
            </button>
        </span>
    );
}

const MessageRow = memo(function MessageRow({
    message,
    actions,
    tools,
    children,
}: {
    message: Message;
    actions: MessageActions;
    tools: RowTools;
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
            {shown !== '' && (
                <div
                    className="wiw-bubble-text"
                    onClick={(event) => {
                        const handle = (event.target as HTMLElement).closest<HTMLElement>('[data-handle]')?.dataset['handle'];
                        if (handle !== undefined) {
                            actions.onOpenItem(handle, handles);
                        }
                    }}
                    dangerouslySetInnerHTML={{ __html: replyHtml(shown) }}
                />
            )}
            {message.reasoning !== undefined && message.reasoning !== '' && (
                <details className="wiw-collapsible">
                    <summary>Thinking</summary>
                    <pre className="wiw-notice-excerpt">{message.reasoning}</pre>
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
            <div className="wiw-bubble-meta">
                {message.origin !== undefined && (
                    <span>
                        {message.origin.profileName}
                        {message.origin.model !== '' ? ` · ${message.origin.model}` : ''}
                    </span>
                )}
                {status !== null && <span className="wiw-assistant-status">{status}</span>}
                {message.role !== 'note' && <MessageTools message={message} actions={actions} tools={tools} />}
            </div>
        </div>
    );
});

export function ConversationView({
    messages,
    actions,
    busy,
    blocked,
    renderBatch,
}: {
    messages: readonly Message[];
    actions: MessageActions;
    busy: boolean;
    blocked: boolean;
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
            {messages.map((message, index) => (
                <MessageRow
                    key={`${message.conversationId}-${String(message.seq)}`}
                    message={message}
                    actions={actions}
                    tools={{ swipeable: index === messages.length - 1, busy, blocked }}
                >
                    {renderBatch?.(message)}
                </MessageRow>
            ))}
        </div>
    );
}
