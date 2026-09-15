import type { AssistantController, AssistantSnapshot } from '../../adapters/assistantController';
import { confirmDialog, inputDialog } from '../../adapters/popups';

/**
 * Conversation switcher (spec 005 FR-032): pick a conversation (title + last
 * update), start a new one, rename or delete the current one.
 */

function relativeTime(iso: string, now: number = Date.now()): string {
    const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
    if (seconds < 60) {
        return 'just now';
    }
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) {
        return `${String(minutes)} min ago`;
    }
    const hours = Math.round(minutes / 60);
    if (hours < 24) {
        return `${String(hours)} h ago`;
    }
    return `${String(Math.round(hours / 24))} d ago`;
}

export function ConversationSwitcher({
    snapshot,
    assistant,
    onOpenSettings,
}: {
    snapshot: AssistantSnapshot;
    assistant: AssistantController;
    onOpenSettings: () => void;
}): JSX.Element {
    const active = snapshot.activeConversation;
    return (
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
                        {conversation.title} · {relativeTime(conversation.updatedAt)}
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
                disabled={!active}
                onClick={() => {
                    if (!active) {
                        return;
                    }
                    void inputDialog('Conversation name', active.title).then((title) => {
                        if (title !== null) {
                            void assistant.renameConversation(active.id, title);
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
                disabled={!active}
                onClick={() => {
                    if (!active) {
                        return;
                    }
                    void confirmDialog(
                        `Delete the conversation "${active.title}"? Its messages and undo history are removed from this device.`
                    ).then((confirmed) => {
                        if (confirmed) {
                            void assistant.deleteConversation(active.id);
                        }
                    });
                }}
            >
                <i className="fa-solid fa-trash-can" />
            </button>
            <button
                type="button"
                className="wiw-button wiw-icon-button"
                title="AI settings"
                onClick={onOpenSettings}
            >
                <i className="fa-solid fa-gear" />
            </button>
        </header>
    );
}
