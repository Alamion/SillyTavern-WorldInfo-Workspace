const GUIDE_STEPS: readonly string[] = [
    'Open flow: this surface replaces the native World Info editor. Pin, outside-click autoclose and programmatic opens all behave natively.',
    'Tree: chevron and folder icon collapse/expand (they are a separate button); the name selects. Check the WI badge on both designated folders, membership badges on intersection entries, the wide Sandbox folder and long-name truncation.',
    'Editor: Content is a textarea with a live markdown preview (headings, lists, bold, links, embedded images). Other fields sit in drawer-style horizontal rows with info icons (hover) and question icons (open the docs).',
    'Folder WI toggle: open a plain folder and make it a World Info root (or disable one) - badges and book memberships update live.',
    'Assistant: batch proposals with per-item Accept/Deny plus accept-all/deny-all; the edit proposal has a before/after diff with removed and added parts highlighted.',
    'Splitter: drag the tree/editor divider to resize; drag it far left or double-click to collapse the tree, restore via the side button.',
];

export function ReviewGuide({ onClose }: { onClose: () => void }): JSX.Element {
    return (
        <div className="wiw-guide">
            <div className="wiw-guide-card">
                <h3 className="wiw-guide-title">Review guide</h3>
                <ol className="wiw-guide-list">
                    {GUIDE_STEPS.map((step) => (
                        <li key={step}>{step}</li>
                    ))}
                </ol>
                <p className="wiw-guide-note">
                    Record your decision (approve / iterate / discard) in the review
                    conversation - that closes Phase 0.
                </p>
                <button type="button" className="wiw-button" onClick={onClose}>
                    Close
                </button>
            </div>
        </div>
    );
}
