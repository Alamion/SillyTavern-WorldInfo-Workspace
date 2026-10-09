import { useSyncExternalStore } from 'react';
import type { SaveGate } from '../adapters/saveGate';
import type { ConflictSide } from '../core/state/staleness';

/**
 * The workspace was changed in another tab or device while this tab has its own
 * changes (spec 008 US2, contracts/ui-contract.md). Nothing from this tab is saved
 * or pushed until the user chooses; editing stays possible.
 */

function Side({ title, side }: { title: string; side: ConflictSide }): JSX.Element {
    return (
        <div className="wiw-stale-side">
            <strong>{title}</strong>
            {side.lines.length === 0 ? (
                <span className="wiw-hint">Nothing</span>
            ) : (
                <ul>
                    {side.lines.map((line) => (
                        <li key={line}>{line}</li>
                    ))}
                    {side.more > 0 && <li className="wiw-hint">and {side.more} more</li>}
                </ul>
            )}
        </div>
    );
}

export function StaleBanner({ gate }: { gate: SaveGate }): JSX.Element | null {
    const conflict = useSyncExternalStore(gate.subscribe, gate.conflict);
    if (!conflict) {
        return null;
    }
    if (conflict.recovery) {
        return (
            <div className="wiw-banner wiw-banner-warn wiw-save-banner wiw-stale-banner">
                <i className="fa-solid fa-code-compare" />
                <span className="wiw-stale-text">A valid workspace was saved elsewhere.</span>
                <span className="wiw-stale-actions">
                    <button type="button" className="wiw-button" onClick={() => gate.useSaved()}>
                        Use the saved version
                    </button>
                </span>
            </div>
        );
    }
    return (
        <div className="wiw-banner wiw-banner-warn wiw-save-banner wiw-stale-banner" role="alert">
            <i className="fa-solid fa-code-compare" />
            <span className="wiw-stale-text">
                The workspace was changed in another tab or device. Nothing from this tab is saved until you
                choose.
            </span>
            <div className="wiw-stale-sides">
                <Side title="Changed here (lost if you use the saved version)" side={conflict.summary.mine} />
                <Side title="Changed there (overwritten if you keep this version)" side={conflict.summary.theirs} />
            </div>
            <span className="wiw-stale-actions">
                <button type="button" className="wiw-button" onClick={() => gate.useSaved()}>
                    Use the saved version
                </button>
                <button type="button" className="wiw-button" onClick={() => gate.keepMine()}>
                    Keep this version
                </button>
            </span>
        </div>
    );
}
