import { useEffect, useState } from 'react';
import type { WorkspaceStateServices } from '../adapters/settingsStore';
import { notifyWarning } from '../adapters/logger';
import { inputDialog } from '../adapters/popups';
import { confirmDialog } from '../adapters/popups';
import type { WorkspaceState } from '../core/state/schema';
import { ConversationView, type MessageActions } from './assistant/ConversationView';
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

    return (
        <div className="wiw-assistant">
            <header className="wiw-assistant-header">
                <select
                    className="wiw-assistant-title"
                    value={snapshot.activeConversationId ?? ''}
                    onChange={(event) => void assistant.selectConversation(event.target.value)}
                    title="Conversations"
                >
                    {snapshot.conversations.length === 0 && <option value="">No conversation</option>}
                    {snapshot.conversations.map((conversation) => (
                        <option key={conversation.id} value={conversation.id}>
                            {conversation.title}
                        </option>
                    ))}
                </select>
                <button
                    type="button"
                    className="wiw-button wiw-icon-button"
                    title="New conversation"
                    onClick={() => void assistant.createConversation()}
                >
                    <i className="fa-solid fa-plus" />
                </button>
                <button
                    type="button"
                    className="wiw-button wiw-icon-button"
                    title="Rename conversation"
                    disabled={snapshot.activeConversationId === null}
                    onClick={() => {
                        const conversation = snapshot.activeConversation;
                        if (!conversation) {
                            return;
                        }
                        void inputDialog('Conversation name', conversation.title).then((title) => {
                            if (title !== null) {
                                void assistant.renameConversation(conversation.id, title);
                            }
                        });
                    }}
                >
                    <i className="fa-solid fa-tag" />
                </button>
                <button
                    type="button"
                    className="wiw-button wiw-icon-button"
                    title="Delete conversation"
                    disabled={snapshot.activeConversationId === null}
                    onClick={() => {
                        const conversation = snapshot.activeConversation;
                        if (!conversation) {
                            return;
                        }
                        void confirmDialog(`Delete the conversation "${conversation.title}"?`).then(
                            (confirmed) => {
                                if (confirmed) {
                                    void assistant.deleteConversation(conversation.id);
                                }
                            }
                        );
                    }}
                >
                    <i className="fa-solid fa-trash-can" />
                </button>
                <button
                    type="button"
                    className="wiw-button wiw-icon-button"
                    title="AI settings"
                    onClick={() => setSettingsOpen(true)}
                >
                    <i className="fa-solid fa-gear" />
                </button>
            </header>

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

            <ConversationView messages={snapshot.messages} actions={actions} />

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
                onOpenContext={() => setContextOpen(true)}
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
