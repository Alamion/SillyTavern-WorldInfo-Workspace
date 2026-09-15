import { useEffect, useState } from 'react';
import type { WorkspaceStateServices } from '../adapters/settingsStore';
import { notifyWarning } from '../adapters/logger';
import type { WorkspaceState } from '../core/state/schema';
import { BatchBar } from './assistant/BatchBar';
import { ConversationSwitcher } from './assistant/ConversationSwitcher';
import { ConversationView, type MessageActions } from './assistant/ConversationView';
import { ProposalCard, type ProposalActions } from './assistant/ProposalCard';
import { ReplyNotices } from './assistant/ReplyNotices';
import { Composer } from './assistant/Composer';
import { ContextMenu, contextSummary } from './assistant/ContextMenu';
import { SettingsMenu } from './assistant/SettingsMenu';
import { useAssistant } from './assistant/useAssistant';

/**
 * Assistant region (spec 005 FR-001): conversation switcher, availability
 * banners, the conversation log and the composer. Everything it does goes
 * through the assistant controller.
 */
export function AssistantPanel({
    services,
    state,
    selectedIds,
    onOpenNode,
}: {
    services: WorkspaceStateServices;
    state: WorkspaceState;
    selectedIds: ReadonlySet<string>;
    onOpenNode: (nodeId: string) => void;
}): JSX.Element {
    const assistant = services.assistant;
    const snapshot = useAssistant(assistant);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [contextOpen, setContextOpen] = useState(false);

    useEffect(() => {
        assistant.setSelection([...selectedIds]);
    }, [assistant, selectedIds]);

    const busy = snapshot.activeRequest !== null;
    const blocked = snapshot.availability !== 'ready';

    const actions: MessageActions = {
        onRetry: (seq) => void assistant.retry(seq),
        onRetryNow: (seq) => void assistant.retryNow(seq),
        onCancelRetry: () => assistant.stop(),
        onOpenItem: (handle, handles) => {
            const nodeId = handles[handle];
            if (nodeId === undefined) {
                notifyWarning('This item is not part of this reply any more.');
                return;
            }
            onOpenNode(nodeId);
        },
    };

    const proposalActions = (seq: number): ProposalActions => ({
        onAccept: (proposalId) => void assistant.accept(seq, proposalId),
        onConfirmDestructive: (proposalId) => void assistant.confirmDestructive(seq, proposalId),
        onDeny: (proposalId) => void assistant.deny(seq, proposalId),
        onEdit: (proposalId, values) => void assistant.editProposal(seq, proposalId, values),
        onFeedback: (proposalId, text) => void assistant.feedback(seq, text, proposalId),
        onRefresh: (proposalId) => void assistant.refreshProposal(seq, proposalId),
    });

    return (
        <div className="wiw-assistant">
            <ConversationSwitcher
                snapshot={snapshot}
                assistant={assistant}
                onOpenSettings={() => setSettingsOpen(true)}
            />

            {snapshot.availability === 'connection-manager-disabled' && (
                <p className="wiw-banner wiw-banner-warn">
                    The assistant needs the Connection Manager extension. Enable it in Extensions →
                    Manage extensions.
                </p>
            )}
            {snapshot.availability === 'no-profile' && (
                <p className="wiw-banner wiw-banner-warn">
                    Choose a connection profile for the assistant.{' '}
                    <button type="button" className="wiw-button" onClick={() => setSettingsOpen(true)}>
                        AI settings
                    </button>
                </p>
            )}
            {!snapshot.storageAvailable && (
                <p className="wiw-banner wiw-banner-warn">
                    Conversations cannot be saved in this browser; they last until the page is
                    reloaded.
                </p>
            )}

            <ConversationView
                messages={snapshot.messages}
                actions={actions}
                renderBatch={(message) => {
                    const batch = message.batch;
                    return (
                        <>
                            <ReplyNotices
                                message={message}
                                onContinue={() => void assistant.continueReply(message.seq)}
                                onRegenerate={() => void assistant.regenerate(message.seq)}
                                onRegenerateSameContext={() =>
                                    void assistant.regenerate(message.seq, { sameContext: true })
                                }
                                onAskToFix={() => void assistant.askToFix(message.seq)}
                            />
                            {batch !== undefined && batch.proposals.length > 0 && (
                                <div className="wiw-proposals">
                                    <ul className="wiw-proposal-list">
                                        {batch.proposals.map((proposal) => (
                                            <ProposalCard
                                                key={proposal.id}
                                                proposal={proposal}
                                                state={state}
                                                actions={proposalActions(message.seq)}
                                            />
                                        ))}
                                    </ul>
                                    <BatchBar
                                        batch={batch}
                                        busy={busy}
                                        onAcceptAll={() => {
                                            void assistant.acceptAll(message.seq).then(() => {
                                                // Destructive proposals stay pending: bring the
                                                // first one into view for its own confirmation.
                                                document
                                                    .querySelector('.wiw-assistant [data-destructive-pending="true"]')
                                                    ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                                            });
                                        }}
                                        onDenyAll={() => void assistant.denyAll(message.seq)}
                                        onFeedback={(text) => void assistant.feedback(message.seq, text)}
                                        onUndo={(appliedBatchId) =>
                                            void assistant.undoBatch(message.seq, appliedBatchId)
                                        }
                                    />
                                </div>
                            )}
                        </>
                    );
                }}
            />

            <Composer
                mode={snapshot.activeConversation?.mode ?? 'propose'}
                busy={busy}
                disabled={blocked}
                contextSummary={
                    snapshot.activeConversation
                        ? contextSummary(snapshot.activeConversation.context, state)
                        : 'Context'
                }
                onSend={(text) => void assistant.send(text)}
                onStop={() => assistant.stop()}
                onModeChange={(mode) => void assistant.setMode(mode)}
                onOpenContext={() => {
                    void assistant.ensureConversation().then(() => setContextOpen(true));
                }}
            />

            {settingsOpen && (
                <SettingsMenu
                    snapshot={snapshot}
                    onChange={(patch) => {
                        if (!assistant.updateSettings(patch)) {
                            notifyWarning(
                                'Assistant settings can be changed after the workspace recovery banner is resolved.'
                            );
                        }
                    }}
                    onResetInstructions={() => void assistant.resetInstructions()}
                    onClose={() => setSettingsOpen(false)}
                />
            )}
            {contextOpen && (
                <ContextMenu
                    snapshot={snapshot}
                    state={state}
                    onChange={(patch) => void assistant.updateConversationContext(patch)}
                    onSaveAsDefault={() => void assistant.saveContextAsDefault()}
                    onClose={() => setContextOpen(false)}
                />
            )}
        </div>
    );
}
