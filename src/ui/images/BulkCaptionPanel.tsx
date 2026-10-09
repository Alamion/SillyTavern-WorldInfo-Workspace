import { useState, useSyncExternalStore } from 'react';
import type { BulkItem, ImageCaption } from '../../adapters/imageCaption';
import { confirmDialog } from '../../adapters/popups';
import { notifySuccess } from '../../adapters/logger';
import { MenuPanel, OptionRow } from '../formControls';

/**
 * "Caption all images without captions" (spec 009 US4): progress and Stop while
 * the run goes, then one review list; only checked captions are stored, in one
 * change.
 */

function rowState(item: BulkItem): string {
    switch (item.state) {
        case 'waiting':
            return 'Waiting';
        case 'running':
            return item.error ?? 'Writing…';
        case 'failed':
            return item.error ?? 'Failed';
        case 'skipped':
            return 'Skipped';
        case 'ready':
            return '';
    }
}

export function BulkCaptionPanel({ caption, onClose }: { caption: ImageCaption; onClose: () => void }): JSX.Element | null {
    const view = useSyncExternalStore(caption.subscribe, caption.bulkView);
    const [edits, setEdits] = useState<Record<string, string>>({});
    const [unchecked, setUnchecked] = useState<Record<string, boolean>>({});
    if (!view) {
        return null;
    }
    const ready = view.items.filter((item) => item.state === 'ready');
    const chosen = ready.filter((item) => unchecked[item.imageId] !== true);
    const finished = view.items.filter((item) => item.state !== 'waiting' && item.state !== 'running').length;
    const textOf = (item: BulkItem): string => edits[item.imageId] ?? item.text;

    const keep = (): void => {
        const kept = caption.keepBulk(new Map(chosen.map((item) => [item.imageId, textOf(item)])));
        notifySuccess(`${String(kept)} caption${kept === 1 ? '' : 's'} stored.`);
        caption.closeBulk();
        onClose();
    };
    const close = async (): Promise<void> => {
        if (chosen.length > 0 && !(await confirmDialog(`Close without storing ${String(chosen.length)} proposed caption(s)?`))) {
            return;
        }
        caption.closeBulk();
        onClose();
    };

    return (
        <MenuPanel
            title={`Captions for ${view.folderName}`}
            className="wiw-bulk-captions"
            intro={
                view.state === 'running'
                    ? `Writing captions… ${String(finished)} / ${String(view.items.length)}${
                          view.retryIn !== null ? ` · retrying in ${String(view.retryIn)} s` : ''
                      }`
                    : `${String(ready.length)} of ${String(view.items.length)} captions ready. Check the ones to keep; you can edit them first.`
            }
            footerHint={view.state === 'stopped' ? 'Stopped — the remaining images were skipped.' : undefined}
            footerActions={
                <>
                    {view.state === 'running' && (
                        <button type="button" className="wiw-button" onClick={() => caption.stopBulk()}>
                            <i className="fa-solid fa-stop" /> Stop
                        </button>
                    )}
                    <button type="button" className="wiw-button" onClick={() => void close()}>
                        Close
                    </button>
                    <button
                        type="button"
                        className="wiw-button wiw-button-active"
                        disabled={view.state === 'running' || chosen.length === 0}
                        onClick={keep}
                    >
                        <i className="fa-solid fa-check" /> Keep selected ({chosen.length})
                    </button>
                </>
            }
            onClose={() => void close()}
        >
            <ul className="wiw-bulk-caption-list">
                {view.items.map((item) => (
                    <li key={item.imageId} className="wiw-bulk-caption-row">
                        <img src={item.src} alt={item.name} loading="lazy" />
                        <div className="wiw-bulk-caption-body">
                            <OptionRow
                                type="checkbox"
                                disabled={item.state !== 'ready'}
                                checked={item.state === 'ready' && unchecked[item.imageId] !== true}
                                title={item.name}
                                onChange={(checked) => setUnchecked((current) => ({ ...current, [item.imageId]: !checked }))}
                            />
                            {item.state === 'ready' ? (
                                <textarea
                                    rows={2}
                                    value={textOf(item)}
                                    onChange={(event) => setEdits((current) => ({ ...current, [item.imageId]: event.target.value }))}
                                />
                            ) : (
                                <span className={`wiw-hint${item.state === 'failed' ? ' wiw-field-error' : ''}`}>
                                    {item.state === 'running' && <i className="fa-solid fa-spinner fa-spin" />} {rowState(item)}
                                </span>
                            )}
                        </div>
                    </li>
                ))}
            </ul>
        </MenuPanel>
    );
}
