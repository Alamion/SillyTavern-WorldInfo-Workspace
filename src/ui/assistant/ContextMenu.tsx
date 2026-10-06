import { useState } from 'react';
import type { AssistantSnapshot } from '../../adapters/assistantController';
import { resolveScope } from '../../core/assistant/scope';
import type { CatalogMode, ContextSet, ContextSettings, ContextScope, EntryContents } from '../../core/assistant/types';
import type { FolderNode, TreeNode, WorkspaceState } from '../../core/state/schema';

/**
 * What the assistant may see for this conversation (spec 005 FR-021, FR-021a,
 * FR-022, FR-035): the structure (part of the tree), which entries go with
 * their contents, and the optional chat sources.
 */

const DEFAULT_CHAT_MESSAGES = 10;

/** Folders and entries inside a resolved scope, the scope folders themselves excluded. */
function countEntries(
    nodes: Iterable<string>,
    state: WorkspaceState,
    scopeFolders: readonly string[] = []
): { folders: number; entries: number } {
    const ids = new Set(nodes);
    scopeFolders.forEach((id) => ids.delete(id));
    let folders = 0;
    let entries = 0;
    const walk = (node: TreeNode): void => {
        if (ids.has(node.id) && node.id !== state.root.id) {
            if (node.kind === 'folder') {
                folders += 1;
            } else if (node.kind === 'entry') {
                entries += 1;
            }
        }
        if (node.kind === 'folder') {
            node.children.forEach(walk);
        }
    };
    walk(state.root);
    return { folders, entries };
}

function plural(count: number, one: string, many = `${one}s`): string {
    return `${String(count)} ${count === 1 ? one : many}`;
}

function sizeLabel(size: { folders: number; entries: number }): string {
    return size.folders > 0
        ? `${plural(size.folders, 'folder')}, ${plural(size.entries, 'entry', 'entries')}`
        : plural(size.entries, 'entry', 'entries');
}

function scopeName(context: ContextSettings, state: WorkspaceState, selection: readonly string[]): string {
    if (context.scope.kind === 'workspace') {
        return 'Whole workspace';
    }
    const resolved = resolveScope(state, context.scope, selection);
    if (context.scope.kind === 'folders') {
        if (resolved.folderIds.length === 1) {
            return findFolderName(state, resolved.folderIds[0]) ?? '1 folder';
        }
        return plural(resolved.folderIds.length, 'folder');
    }
    const id = resolved.folderIds[0];
    return id === state.root.id ? 'Whole workspace' : (findFolderName(state, id) ?? 'Current folder');
}

function findFolderName(state: WorkspaceState, id: string | undefined): string | undefined {
    let found: string | undefined;
    const walk = (folder: FolderNode): void => {
        for (const child of folder.children) {
            if (child.kind === 'folder') {
                if (child.id === id) {
                    found = child.name;
                    return;
                }
                walk(child);
            }
        }
    };
    walk(state.root);
    return found;
}

/** Composer chip: "Cities · by keys · chat 10". */
export function contextSummary(
    context: ContextSettings,
    state: WorkspaceState,
    selection: readonly string[]
): string {
    const parts = [
        scopeName(context, state, selection),
        context.entryContents === 'all' ? 'all contents' : context.fuzzy ? 'by keys + near' : 'by keys',
    ];
    if (context.catalog !== 'auto') {
        parts.push(context.catalog === 'on' ? 'catalog' : 'no catalog');
    }
    if (context.chatMessages > 0) {
        parts.push(`chat ${String(context.chatMessages)}`);
    }
    if (context.characterCard) {
        parts.push('card');
    }
    if (context.persona) {
        parts.push('persona');
    }
    if (context.activatedEntries) {
        parts.push('activated');
    }
    return parts.join(' · ');
}

function Option({
    type,
    checked,
    disabled,
    title,
    hint,
    onChange,
    children,
}: {
    type: 'radio' | 'checkbox';
    checked: boolean;
    disabled?: boolean;
    title: string;
    hint?: string;
    onChange: (checked: boolean) => void;
    children?: React.ReactNode;
}): JSX.Element {
    return (
        <label className={`wiw-context-option${checked ? ' wiw-context-option-checked' : ''}`}>
            <input
                type={type}
                checked={checked}
                disabled={disabled}
                onChange={(event) => onChange(event.target.checked)}
            />
            <span className="wiw-context-option-text">
                <span className="wiw-context-option-title">
                    {title}
                    {children}
                </span>
                {hint !== undefined && <span className="wiw-context-hint">{hint}</span>}
            </span>
        </label>
    );
}

function FolderChooser({
    state,
    chosen,
    onChange,
}: {
    state: WorkspaceState;
    chosen: readonly string[];
    onChange: (folderIds: string[]) => void;
}): JSX.Element {
    const entryCounts = new Map<string, number>();
    const countIn = (folder: FolderNode): number => {
        let count = 0;
        for (const child of folder.children) {
            count += child.kind === 'folder' ? countIn(child) : child.kind === 'entry' ? 1 : 0;
        }
        entryCounts.set(folder.id, count);
        return count;
    };
    countIn(state.root);
    const rows: JSX.Element[] = [];
    const walk = (folder: FolderNode, depth: number, inherited: boolean): void => {
        for (const child of folder.children) {
            if (child.kind !== 'folder') {
                continue;
            }
            const own = chosen.includes(child.id);
            rows.push(
                <label
                    key={child.id}
                    className="wiw-context-folder"
                    style={{ paddingLeft: `${String(depth * 1.1 + 0.3)}rem` }}
                    title={inherited ? 'Included through a chosen parent folder' : undefined}
                >
                    <input
                        type="checkbox"
                        checked={own || inherited}
                        disabled={inherited}
                        onChange={(event) =>
                            onChange(
                                event.target.checked
                                    ? [...chosen, child.id]
                                    : chosen.filter((id) => id !== child.id)
                            )
                        }
                    />
                    <i className="fa-solid fa-folder" />
                    <span className="wiw-context-folder-name">{child.name}</span>
                    <span className="wiw-context-hint" title="Entries inside">
                        {entryCounts.get(child.id) ?? 0}
                    </span>
                </label>
            );
            walk(child, depth + 1, inherited || own);
        }
    };
    walk(state.root, 0, false);
    return (
        <div className="wiw-context-folders">
            {rows.length > 0 ? rows : <span className="wiw-context-hint">The workspace has no folders.</span>}
        </div>
    );
}

export function ContextMenu({
    snapshot,
    state,
    selectedIds,
    onChange,
    onClose,
    onPreview,
    sets,
    interop,
}: {
    snapshot: AssistantSnapshot;
    state: WorkspaceState;
    selectedIds: readonly string[];
    onChange: (patch: Partial<ContextSettings>) => void;
    onClose: () => void;
    /** Opens the preview of the next request (spec 007 US1). */
    onPreview: () => void;
    /** Other extensions usable right now (spec 007 US4). */
    interop: { scene: boolean; deeplore: boolean; memoryBooks: boolean };
    /** Context sets (spec 007 US3). */
    sets: {
        apply: (set: ContextSet) => void;
        saveAs: () => void;
        rename: (set: ContextSet) => void;
        remove: (set: ContextSet) => void;
    };
}): JSX.Element | null {
    const context = snapshot.activeConversation?.context;
    const [chatCount, setChatCount] = useState(
        context && context.chatMessages > 0 ? context.chatMessages : DEFAULT_CHAT_MESSAGES
    );
    if (!context) {
        return null;
    }
    const setScope = (scope: ContextScope): void => onChange({ scope });
    const setContents = (entryContents: EntryContents): void => onChange({ entryContents });
    const chosenFolders = context.scope.kind === 'folders' ? context.scope.folderIds : [];

    const selectionScope = resolveScope(state, { kind: 'selection' }, selectedIds);
    const selectionFolderId = selectionScope.folderIds[0];
    const selectionLabel =
        selectionFolderId === state.root.id
            ? 'nothing selected — the whole workspace'
            : `now: ${findFolderName(state, selectionFolderId) ?? 'folder'} (${sizeLabel(countEntries(selectionScope.nodeIds, state, selectionScope.folderIds))})`;
    const chosenScope = resolveScope(state, { kind: 'folders', folderIds: chosenFolders }, []);
    const workspaceSize = countEntries(resolveScope(state, { kind: 'workspace' }, []).nodeIds, state);

    return (
        <div className="wiw-overlay" onClick={onClose}>
            <div
                className="wiw-panel wiw-context-menu"
                role="dialog"
                aria-label="Assistant context"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="wiw-context-header">
                    <h3>Assistant context</h3>
                    <button
                        type="button"
                        className="wiw-button wiw-icon-button"
                        title="Close"
                        onClick={onClose}
                    >
                        <i className="fa-solid fa-xmark" />
                    </button>
                </div>
                <p>What this conversation sends to the model with each message.</p>

                <div className="wiw-context-body">
                    <section className="wiw-context-section">
                        <h4>Context sets</h4>
                        <p className="wiw-context-hint">
                            Saved choices for this menu. Applying one copies it into this conversation.
                        </p>
                        {snapshot.settings.contextSets.map((set) => (
                            <div
                                key={set.id}
                                className={`wiw-context-set${snapshot.activeConversation?.contextSetName === set.name ? ' wiw-context-option-checked' : ''}`}
                            >
                                <button type="button" className="wiw-button" title="Apply this set" onClick={() => sets.apply(set)}>
                                    <i className="fa-solid fa-layer-group" /> {set.name}
                                </button>
                                <span className="wiw-context-hint">{contextSummary(set.context, state, selectedIds)}</span>
                                <button type="button" className="wiw-button wiw-icon-button" title="Rename" onClick={() => sets.rename(set)}>
                                    <i className="fa-solid fa-pencil" />
                                </button>
                                <button type="button" className="wiw-button wiw-icon-button" title="Delete" onClick={() => sets.remove(set)}>
                                    <i className="fa-solid fa-trash-can" />
                                </button>
                            </div>
                        ))}
                        <button type="button" className="wiw-button" onClick={sets.saveAs}>
                            <i className="fa-solid fa-floppy-disk" /> Save current choices as a set…
                        </button>
                    </section>

                    <section className="wiw-context-section">
                        <h4>Structure</h4>
                        <p className="wiw-context-hint">
                            The part of the tree the assistant sees. It can only change items inside it.
                        </p>
                        <Option
                            type="radio"
                            checked={context.scope.kind === 'selection'}
                            title="Current folder"
                            hint={`Follows your selection in the tree · ${selectionLabel}`}
                            onChange={() => setScope({ kind: 'selection' })}
                        />
                        <Option
                            type="radio"
                            checked={context.scope.kind === 'folders'}
                            title="Chosen folders"
                            hint={
                                context.scope.kind === 'folders'
                                    ? chosenFolders.length === 0
                                        ? 'Tick at least one folder below'
                                        : sizeLabel(countEntries(chosenScope.nodeIds, state, chosenScope.folderIds))
                                    : 'A fixed set of folders, whatever is selected'
                            }
                            onChange={() => setScope({ kind: 'folders', folderIds: chosenFolders })}
                        />
                        {context.scope.kind === 'folders' && (
                            <FolderChooser
                                state={state}
                                chosen={chosenFolders}
                                onChange={(folderIds) => setScope({ kind: 'folders', folderIds })}
                            />
                        )}
                        <Option
                            type="radio"
                            checked={context.scope.kind === 'workspace'}
                            title="Whole workspace"
                            hint={sizeLabel(workspaceSize)}
                            onChange={() => setScope({ kind: 'workspace' })}
                        />
                    </section>

                    <section className="wiw-context-section">
                        <h4>Entry contents</h4>
                        <p className="wiw-context-hint">
                            Every entry of the structure is listed by title and keys. Contents are sent for:
                        </p>
                        <Option
                            type="radio"
                            checked={context.entryContents !== 'all'}
                            title="Selected and mentioned entries (recommended)"
                            hint="Selected entries, plus entries whose keys or title appear in your message, the chat or another sent entry — recursively, up to the context size."
                            onChange={() => setContents('triggered')}
                        />
                        <Option
                            type="radio"
                            checked={context.entryContents === 'all'}
                            title="All entries of the structure"
                            hint="For small structures. Whatever does not fit the context size is left out."
                            onChange={() => setContents('all')}
                        />
                        <Option
                            type="checkbox"
                            checked={context.fuzzy}
                            disabled={context.entryContents === 'all'}
                            title="Also near matches"
                            hint="Up to 5 entries that share words with your message even when no key matches exactly (other word forms, partial names)."
                            onChange={(checked) => onChange({ fuzzy: checked })}
                        />
                    </section>

                    <section className="wiw-context-section">
                        <h4>Large libraries</h4>
                        <p className="wiw-context-hint">
                            A catalog lists entries by name, folder and summary; the model asks for the full
                            text of the ones it needs (it may take a few extra seconds).
                        </p>
                        {(
                            [
                                ['auto', 'Auto (recommended)', 'Only when the entry contents above do not fit the context size.'],
                                ['on', 'Always use the catalog', 'Selected entries are still sent in full.'],
                                ['off', 'Never', 'Entries that do not fit are left out, as before.'],
                            ] as Array<[CatalogMode, string, string]>
                        ).map(([mode, title, hint]) => (
                            <Option
                                key={mode}
                                type="radio"
                                checked={context.catalog === mode}
                                title={title}
                                hint={hint}
                                onChange={() => onChange({ catalog: mode })}
                            />
                        ))}
                    </section>

                    <section className="wiw-context-section">
                        <h4>Current chat</h4>
                        <Option
                            type="checkbox"
                            checked={context.chatMessages > 0}
                            title="Recent messages"
                            onChange={(checked) => onChange({ chatMessages: checked ? chatCount : 0 })}
                        >
                            <input
                                type="number"
                                className="wiw-context-count"
                                min={1}
                                max={200}
                                value={chatCount}
                                aria-label="Number of chat messages"
                                onClick={(event) => event.preventDefault()}
                                onChange={(event) => {
                                    const value = Math.min(200, Math.max(1, Math.round(Number(event.target.value) || 1)));
                                    setChatCount(value);
                                    onChange({ chatMessages: value });
                                }}
                            />
                        </Option>
                        <Option
                            type="checkbox"
                            checked={context.characterCard}
                            title="Character card"
                            onChange={(checked) => onChange({ characterCard: checked })}
                        />
                        <Option
                            type="checkbox"
                            checked={context.persona}
                            title="Persona description"
                            onChange={(checked) => onChange({ persona: checked })}
                        />
                        <Option
                            type="checkbox"
                            checked={context.activatedEntries}
                            title="Entries activated in the chat"
                            hint="Sent with their contents when they are inside the structure."
                            onChange={(checked) => onChange({ activatedEntries: checked })}
                        />
                    </section>

                    {(interop.scene || interop.deeplore || context.sources.scene || context.sources.deeplore) && (
                        <section className="wiw-context-section">
                            <h4>Other extensions</h4>
                            {(interop.scene || context.sources.scene) && (
                                <Option
                                    type="checkbox"
                                    checked={context.sources.scene}
                                    title="Current scene (Doom's Enhancement Suite)"
                                    hint={
                                        interop.scene
                                            ? 'Who is present and where; entries named after present characters are preferred.'
                                            : 'No tracked scene in this chat yet.'
                                    }
                                    onChange={(checked) => onChange({ sources: { ...context.sources, scene: checked } })}
                                />
                            )}
                            {(interop.deeplore || context.sources.deeplore) && (
                                <Option
                                    type="checkbox"
                                    checked={context.sources.deeplore}
                                    title="DeepLore matches"
                                    hint={
                                        interop.deeplore
                                            ? "Entries DeepLore's keyword matching finds for the recent chat, as one block."
                                            : 'DeepLore is not available right now.'
                                    }
                                    onChange={(checked) => onChange({ sources: { ...context.sources, deeplore: checked } })}
                                />
                            )}
                        </section>
                    )}
                </div>

                <div className="wiw-context-footer">
                    <span className="wiw-context-hint">
                        {snapshot.settingsLocked
                            ? 'Kept for this conversation; new conversations keep their start until the recovery banner is resolved.'
                            : 'New conversations start with these choices.'}
                    </span>
                    <span className="wiw-context-footer-actions">
                        <button
                            type="button"
                            className="wiw-button"
                            title="Everything the next message would send, with the reason and size of each part"
                            onClick={onPreview}
                        >
                            <i className="fa-solid fa-layer-group" /> Preview context
                        </button>
                        <button type="button" className="wiw-button wiw-button-active" onClick={onClose}>
                            Done
                        </button>
                    </span>
                </div>
            </div>
        </div>
    );
}
