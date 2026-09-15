import type { AssistantSnapshot } from '../../adapters/assistantController';
import type { ContextSettings, ContextScope } from '../../core/assistant/types';
import type { FolderNode, WorkspaceState } from '../../core/state/schema';

/**
 * What the assistant may see for this conversation (spec 005 FR-021, FR-022,
 * FR-035): the workspace scope, the tree outline, and the optional chat sources.
 */

function folderOptions(state: WorkspaceState): Array<{ id: string; label: string }> {
    const options: Array<{ id: string; label: string }> = [];
    const walk = (folder: FolderNode, depth: number): void => {
        for (const child of folder.children) {
            if (child.kind !== 'folder') {
                continue;
            }
            options.push({ id: child.id, label: `${'— '.repeat(depth)}${child.name}` });
            walk(child, depth + 1);
        }
    };
    walk(state.root, 0);
    return options;
}

export function contextSummary(context: ContextSettings, state: WorkspaceState): string {
    const scope =
        context.scope.kind === 'workspace'
            ? 'whole workspace'
            : context.scope.kind === 'selection'
              ? 'selection'
              : `${String(context.scope.folderIds.length)} folder(s)`;
    const extras: string[] = [];
    if (context.includeOutline) {
        extras.push('outline');
    }
    if (context.chatMessages > 0) {
        extras.push(`chat ${String(context.chatMessages)}`);
    }
    if (context.characterCard) {
        extras.push('card');
    }
    if (context.persona) {
        extras.push('persona');
    }
    if (context.activatedEntries) {
        extras.push('activated');
    }
    void state;
    return `Scope: ${scope}${extras.length > 0 ? ` · ${extras.join(' · ')}` : ''}`;
}

export function ContextMenu({
    snapshot,
    state,
    onChange,
    onSaveAsDefault,
    onClose,
}: {
    snapshot: AssistantSnapshot;
    state: WorkspaceState;
    onChange: (patch: Partial<ContextSettings>) => void;
    onSaveAsDefault: () => void;
    onClose: () => void;
}): JSX.Element | null {
    const context = snapshot.activeConversation?.context;
    if (!context) {
        return null;
    }
    const setScope = (scope: ContextScope): void => onChange({ scope });
    const selectedFolders = context.scope.kind === 'folders' ? context.scope.folderIds : [];
    return (
        <div className="wiw-overlay" onClick={onClose}>
            <div
                className="wiw-panel wiw-assistant-settings"
                onClick={(event) => event.stopPropagation()}
            >
                <h3>Context sent to the assistant</h3>
                <label>
                    <input
                        type="radio"
                        checked={context.scope.kind === 'selection'}
                        onChange={() => setScope({ kind: 'selection' })}
                    />{' '}
                    Selected folder (or the selected item&apos;s folder)
                </label>
                <label>
                    <input
                        type="radio"
                        checked={context.scope.kind === 'folders'}
                        onChange={() => setScope({ kind: 'folders', folderIds: selectedFolders })}
                    />{' '}
                    Chosen folders
                </label>
                {context.scope.kind === 'folders' && (
                    <div className="wiw-panel-body">
                        {folderOptions(state).map((option) => (
                            <label key={option.id}>
                                <input
                                    type="checkbox"
                                    checked={selectedFolders.includes(option.id)}
                                    onChange={(event) =>
                                        setScope({
                                            kind: 'folders',
                                            folderIds: event.target.checked
                                                ? [...selectedFolders, option.id]
                                                : selectedFolders.filter((id) => id !== option.id),
                                        })
                                    }
                                />{' '}
                                {option.label}
                            </label>
                        ))}
                    </div>
                )}
                <label>
                    <input
                        type="radio"
                        checked={context.scope.kind === 'workspace'}
                        onChange={() => setScope({ kind: 'workspace' })}
                    />{' '}
                    Whole workspace
                </label>
                <label>
                    <input
                        type="checkbox"
                        checked={context.includeOutline}
                        onChange={(event) => onChange({ includeOutline: event.target.checked })}
                    />{' '}
                    Send the tree outline
                </label>
                <div className="wiw-assistant-settings-row">
                    <label>
                        Chat messages (0 = off)
                        <input
                            type="number"
                            min={0}
                            max={200}
                            value={context.chatMessages}
                            onChange={(event) => onChange({ chatMessages: Number(event.target.value) })}
                        />
                    </label>
                </div>
                <label>
                    <input
                        type="checkbox"
                        checked={context.characterCard}
                        onChange={(event) => onChange({ characterCard: event.target.checked })}
                    />{' '}
                    Character card
                </label>
                <label>
                    <input
                        type="checkbox"
                        checked={context.persona}
                        onChange={(event) => onChange({ persona: event.target.checked })}
                    />{' '}
                    Persona description
                </label>
                <label>
                    <input
                        type="checkbox"
                        checked={context.activatedEntries}
                        onChange={(event) => onChange({ activatedEntries: event.target.checked })}
                    />{' '}
                    Entries activated in the current chat
                </label>
                <div className="wiw-panel-actions">
                    <button
                        type="button"
                        className="wiw-button"
                        disabled={snapshot.settingsLocked}
                        onClick={onSaveAsDefault}
                    >
                        <i className="fa-solid fa-floppy-disk" /> Save as default for new conversations
                    </button>
                    <button type="button" className="wiw-button" onClick={onClose}>
                        <i className="fa-solid fa-xmark" /> Close
                    </button>
                </div>
            </div>
        </div>
    );
}
