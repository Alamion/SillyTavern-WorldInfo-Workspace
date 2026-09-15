import { useEffect, useState } from 'react';
import type { AssistantFailure } from '../../core/assistant/types';

/**
 * Failure presentation (spec 005 FR-026): a readable reason, the visible retry
 * countdown of an automatic retry, and the raw provider text on request. The
 * user's request text always stays in the conversation above this card.
 */
export function FailureCard({
    failure,
    retryAt,
    onRetry,
    onRetryNow,
    onCancelRetry,
}: {
    failure: AssistantFailure;
    retryAt?: string;
    onRetry: () => void;
    onRetryNow: () => void;
    onCancelRetry: () => void;
}): JSX.Element {
    const waiting = retryAt !== undefined;
    const [secondsLeft, setSecondsLeft] = useState(() => remainingSeconds(retryAt));
    useEffect(() => {
        if (retryAt === undefined) {
            return;
        }
        setSecondsLeft(remainingSeconds(retryAt));
        const timer = setInterval(() => setSecondsLeft(remainingSeconds(retryAt)), 1000);
        return () => clearInterval(timer);
    }, [retryAt]);

    return (
        <div className="wiw-banner wiw-banner-error">
            <span>
                {failure.message}
                {waiting ? ` Retrying in ${String(secondsLeft)} s.` : ''}
            </span>
            <div className="wiw-notice-actions">
                {waiting ? (
                    <>
                        <button type="button" className="wiw-button" onClick={onRetryNow}>
                            <i className="fa-solid fa-rotate-right" /> Retry now
                        </button>
                        <button type="button" className="wiw-button" onClick={onCancelRetry}>
                            <i className="fa-solid fa-xmark" /> Cancel
                        </button>
                    </>
                ) : (
                    failure.retryable && (
                        <button type="button" className="wiw-button" onClick={onRetry}>
                            <i className="fa-solid fa-rotate-right" /> Retry
                        </button>
                    )
                )}
            </div>
            {failure.detail !== undefined && failure.detail !== '' && (
                <details className="wiw-collapsible">
                    <summary>Provider details</summary>
                    <pre className="wiw-notice-excerpt">{failure.detail}</pre>
                </details>
            )}
        </div>
    );
}

function remainingSeconds(retryAt?: string): number {
    if (retryAt === undefined) {
        return 0;
    }
    return Math.max(0, Math.ceil((Date.parse(retryAt) - Date.now()) / 1000));
}
