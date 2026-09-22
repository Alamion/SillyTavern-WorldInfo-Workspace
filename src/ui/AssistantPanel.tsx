import { useEffect, useState } from 'react';
import type { WorkspaceStateServices } from '../adapters/settingsStore';
import { notifySuccess, notifyWarning } from '../adapters/logger';
import { undoSummary } from '../core/assistant/undo';
import { confirmDialog } from '../adapters/popups';
import type { WorkspaceState } from '../core/state/schema';
import type { AppliedBatchUndone } from '../core/assistant/types';
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
    const reportUndo = (undone: AppliedBatchUndone | null): void => {
        if (undone !== null) {
            (undone.skipped.length > 0 ? notifyWarning : notifySuccess)(undoSummary(undone));
        }
    };
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
        onShowVariant: (seq, index) => void assistant.showVariant(seq, index),
        onNewVariant: (seq) => void assistant.regenerate(seq),
        onFork: (seq) => void assistant.forkConversation(seq),
        onEdit: (message, text) => {
            void assistant.editMessage(message.seq, text).then((edited) => {
                if (edited === null) {
                    notifyWarning('This message cannot be edited while its request is running.');
                    return;
                }
                const notes = [
                    edited.fresh > 0 ? `${String(edited.fresh)} changed or new proposal(s) to review` : '',
                    edited.kept > 0
                        ? `${String(edited.kept)} applied change(s) whose block was removed stay listed and can still be undone`
                        : '',
                ].filter((note) => note !== '');
                if (notes.length > 0) {
                    notifySuccess(`Reply edited: ${notes.join('; ')}.`);
                }
            });
        },
        onDelete: (message) => {
            const applied = (message.variants ?? [message]).some((variant) =>
                (variant.batch?.applied ?? []).some((batch) => batch.undone === undefined)
            );
            const versions = message.variants !== undefined && message.variants.length > 1;
            void confirmDialog(
                [
                    versions ? 'Delete this message with all its versions?' : 'Delete this message?',
                    applied
                        ? 'Changes already accepted from it stay in the workspace, but the assistant will no longer see this reply or its decisions.'
                        : '',
                ]
                    .filter((part) => part !== '')
                    .join(' ')
            ).then((confirmed) => {
                // The dialog is async: never delete a same-numbered message of another conversation.
                if (confirmed && assistant.getSnapshot().activeConversationId === message.conversationId) {
                    void assistant.deleteMessage(message.seq);
                }
            });
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
                busy={busy}
                blocked={blocked}
                renderBatch={(message) => {
                    const batch = message.batch;
                    return (
                        <>
                            <ReplyNotices
                                message={message}
                                onContinue={() =>
                                    void assistant.continueReply(message.seq).then((failure) => {
                                        if (failure) {
                                            notifyWarning(`Could not continue: ${failure.message}`);
                                        }
                                    })
                                }
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
                                        forked={message.forkedFrom !== undefined}
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
                                        onUndo={(appliedBatchId) => {
                                            void assistant.undoBatch(message.seq, appliedBatchId).then(reportUndo);
                                        }}
                                        onUndoAll={() => void assistant.undoAll(message.seq).then(reportUndo)}
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
                canSendEmpty={snapshot.messages.at(-1)?.role === 'user'}
                contextSummary={
                    snapshot.activeConversation
                        ? contextSummary(snapshot.activeConversation.context, state, [...selectedIds])
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
                    selectedIds={[...selectedIds]}
                    onChange={(patch) => void assistant.updateConversationContext(patch)}
                    onClose={() => setContextOpen(false)}
                />
            )}
        </div>
    );
}
