import { useState } from 'react';
import type { Message } from '../../core/assistant/types';

/**
 * Notices under an assistant reply (spec 005 FR-023, FR-027, FR-004): what was
 * left out of the context, a cut-off reply, and blocks that could not be used —
 * the broken blocks themselves only on request (owner decision 2026-09-15).
 */
export function ReplyNotices({
    message,
    onContinue,
    onRegenerate,
    onRegenerateSameContext,
    onAskToFix,
}: {
    message: Message;
    onContinue: () => void;
    onRegenerate: () => void;
    onRegenerateSameContext: () => void;
    onAskToFix: () => void;
}): JSX.Element | null {
    const [showBroken, setShowBroken] = useState(false);
    const omitted = message.context?.omitted ?? [];
    const unparsed = message.batch?.unparsed ?? [];
    const truncated = unparsed.filter((item) => item.kind === 'truncated');
    const broken = unparsed.filter((item) => item.kind === 'malformed-block');
    const validProposals = (message.batch?.proposals ?? []).filter(
        (proposal) => proposal.decision !== 'invalid'
    );
    const included = message.context?.included;
    if (message.status !== 'received' && message.status !== 'stopped') {
        return null;
    }
    return (
        <>
            {included !== undefined && (
                <div className="wiw-notice">
                    <span>
                        Sent: {included.outline ? `structure (${String(included.outlineItems)} items)` : 'no structure'} ·{' '}
                        {String(included.fullItems)} with contents
                        {included.triggeredItems > 0 ? ` (${String(included.triggeredItems)} by keys)` : ''}
                        {included.chatMessages > 0 ? ` · chat ${String(included.chatMessages)}` : ''}
                        {included.characterCard ? ' · character card' : ''}
                        {included.persona ? ' · persona' : ''}
                        {included.activatedEntries > 0
                            ? ` · ${String(included.activatedEntries)} activated`
                            : ''}
                        .
                        {omitted.length > 0
                            ? ` Omitted: ${omitted
                                  .map((part) =>
                                      part.count !== undefined
                                          ? `${part.label} (${String(part.count)})`
                                          : part.label
                                  )
                                  .join(', ')}.`
                            : ''}
                    </span>
                </div>
            )}
            {truncated.length > 0 && (
                <div className="wiw-notice">
                    <span>The reply was cut off.</span>
                    <div className="wiw-notice-actions">
                        <button type="button" className="wiw-button" onClick={onContinue}>
                            <i className="fa-solid fa-forward" /> Continue
                        </button>
                        <button type="button" className="wiw-button" onClick={onRegenerate}>
                            <i className="fa-solid fa-rotate" /> Regenerate
                        </button>
                    </div>
                </div>
            )}
            {broken.length > 0 && (
                <div className="wiw-notice">
                    <span>
                        {String(broken.length)} operation block
                        {broken.length === 1 ? '' : 's'} could not be used.
                    </span>
                    <div className="wiw-notice-actions">
                        <button
                            type="button"
                            className="wiw-button"
                            onClick={() => setShowBroken(!showBroken)}
                        >
                            <i className="fa-solid fa-bug" />{' '}
                            {showBroken ? 'Hide broken blocks' : 'Show broken blocks'}
                        </button>
                        <button type="button" className="wiw-button" onClick={onRegenerateSameContext}>
                            <i className="fa-solid fa-rotate" /> Regenerate with the same context
                        </button>
                        {validProposals.length === 0 && (
                            <button type="button" className="wiw-button" onClick={onAskToFix}>
                                <i className="fa-solid fa-wand-magic-sparkles" /> Ask to fix
                            </button>
                        )}
                    </div>
                    {showBroken &&
                        broken.map((item, index) => (
                            <div key={index}>
                                <span className="wiw-proposal-path">{item.reason}</span>
                                <pre className="wiw-notice-excerpt">{item.excerpt}</pre>
                            </div>
                        ))}
                </div>
            )}
        </>
    );
}
