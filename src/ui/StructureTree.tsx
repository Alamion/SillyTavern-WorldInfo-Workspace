import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, DragEvent as ReactDragEvent } from 'react';
import type { CreateKind } from '../core/tree/operations';
import {
    kindOfFilter,
    matchesSearch,
    sortChildrenView,
    type BrowseFilter,
    type SearchScope,
    type SortMode,
} from '../core/tree/browse';
import type { FolderNode, TreeNode } from '../core/state/schema';

export type TreeMenuAction =
    | 'rename'
    | 'move-to'
    | 'move-up'
    | 'move-down'
    | 'duplicate'
    | 'delete'
    | 'export-md';

export interface TreeMenuState {
    id: string;
    x: number;
    y: number;
}

export interface StructureTreeProps {
    root: FolderNode;
    sortMode: SortMode;
    onSort(mode: SortMode): void;
    selectedIds: ReadonlySet<string>;
    onSelect(id: string, additive: 'none' | 'toggle' | 'range'): void;
    onExpand(folderId: string, expanded: boolean): void;
    onCreate(kind: CreateKind): void;
    onMoveNode(nodeId: string, parentId: string, indexInParent?: number): void;
    onReorder(parentId: string, fromIndex: number, toIndex: number): void;
    menu: TreeMenuState | null;
    onOpenMenu(menu: TreeMenuState): void;
    onCloseMenu(): void;
    onMenuAction(action: TreeMenuAction, id: string): void;
    onImportFile(file: File): void;
}

interface RowProps {
    node: TreeNode;
    depth: number;
    siblingIndex: number;
    visibleIds: ReadonlySet<string>;
    selectedIds: ReadonlySet<string>;
    sortMode: SortMode;
    allowReorder: boolean;
    dragOverId: string | null;
    menuTargetId: string | null;
    setDragOverId(id: string | null): void;
    onSelect: StructureTreeProps['onSelect'];
    onExpand: StructureTreeProps['onExpand'];
    onMoveNode: StructureTreeProps['onMoveNode'];
    onOpenMenu: StructureTreeProps['onOpenMenu'];
}

const LONG_PRESS_MS = 500;

const KIND_ICONS: Record<BrowseFilter, string> = {
    folders: 'fa-folder',
    wiFolders: 'fa-folder-tree',
    entries: 'fa-book',
    images: 'fa-image',
};

const KIND_TITLES: Record<BrowseFilter, string> = {
    folders: 'Folders',
    wiFolders: 'World Info folders',
    entries: 'Entries',
    images: 'Images',
};

const MENU_ITEMS: ReadonlyArray<{ action: TreeMenuAction; icon: string; label: string; folderOnly?: boolean }> = [
    { action: 'rename', icon: 'fa-pen', label: 'Rename' },
    { action: 'move-to', icon: 'fa-folder-open', label: 'Move to…' },
    { action: 'move-up', icon: 'fa-arrow-up', label: 'Move up' },
    { action: 'move-down', icon: 'fa-arrow-down', label: 'Move down' },
    { action: 'duplicate', icon: 'fa-clone', label: 'Duplicate' },
    { action: 'export-md', icon: 'fa-file-export', label: 'Export folder to markdown…', folderOnly: true },
    { action: 'delete', icon: 'fa-trash-can', label: 'Delete' },
];

function isFolderId(root: FolderNode, id: string): boolean {
    const stack: TreeNode[] = [root];
    while (stack.length > 0) {
        const node = stack.pop()!;
        if (node.id === id) {
            return node.kind === 'folder';
        }
        if (node.kind === 'folder') {
            stack.push(...node.children);
        }
    }
    return false;
}

const STICKY_MENU_ACTIONS: ReadonlySet<TreeMenuAction> = new Set(['move-up', 'move-down']);

function Row({
    node,
    depth,
    siblingIndex,
    visibleIds,
    selectedIds,
    sortMode,
    allowReorder,
    dragOverId,
    menuTargetId,
    setDragOverId,
    onSelect,
    onExpand,
    onMoveNode,
    onOpenMenu,
}: RowProps): JSX.Element | null {
    if (!visibleIds.has(node.id)) {
        return null;
    }
    const isFolder = node.kind === 'folder';
    const expanded = isFolder && node.expanded;
    const indentStyle: CSSProperties = { paddingLeft: `${depth * 12 + 4}px` };
    const selected = selectedIds.has(node.id);
    const isDragOver = dragOverId === node.id;
    const isMenuTarget = menuTargetId === node.id;
    let pressTimer: number | null = null;
    const kindIcon =
        node.kind === 'folder'
            ? expanded
                ? 'fa-folder-open'
                : 'fa-folder'
            : node.kind === 'entry'
              ? 'fa-book'
              : 'fa-image';
    const handleDrop = (event: ReactDragEvent): void => {
        event.preventDefault();
        event.stopPropagation();
        setDragOverId(null);
        const draggedId = event.dataTransfer.getData('text/wiw-node');
        if (!draggedId || draggedId === node.id) {
            return;
        }
        if (isFolder) {
            onMoveNode(draggedId, node.id);
            return;
        }
        if (allowReorder && node.parentId !== null) {
            onMoveNode(draggedId, node.parentId, siblingIndex);
        }
    };
    return (
        <>
            <div
                className={`wiw-tree-row${selected ? ' wiw-selected' : ''}${isDragOver ? ' wiw-drag-over' : ''}${isMenuTarget ? ' wiw-menu-target' : ''}`}
                style={indentStyle}
                draggable={allowReorder}
                onDragStart={(event) => {
                    event.dataTransfer.setData('text/wiw-node', node.id);
                    event.dataTransfer.setData('text/wiw-index', String(siblingIndex));
                    event.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(event) => {
                    event.preventDefault();
                    setDragOverId(node.id);
                }}
                onDragLeave={() => setDragOverId(null)}
                onDrop={handleDrop}
                onPointerDown={(event) => {
                    if (event.pointerType === 'mouse') {
                        return;
                    }
                    const startX = event.clientX;
                    const startY = event.clientY;
                    pressTimer = window.setTimeout(() => {
                        pressTimer = null;
                        onOpenMenu({ id: node.id, x: event.clientX, y: event.clientY });
                    }, LONG_PRESS_MS);
                    const cancel = (moveEvent: PointerEvent): void => {
                        if (Math.abs(moveEvent.clientX - startX) > 10 || Math.abs(moveEvent.clientY - startY) > 10) {
                            cancelLongPress();
                        }
                    };
                    const cancelLongPress = (): void => {
                        if (pressTimer !== null) {
                            window.clearTimeout(pressTimer);
                            pressTimer = null;
                            window.removeEventListener('pointermove', cancel);
                            window.removeEventListener('pointerup', cancelLongPress);
                        }
                    };
                    window.addEventListener('pointermove', cancel);
                    window.addEventListener('pointerup', cancelLongPress, { once: true });
                }}
                onContextMenu={(event) => {
                    event.preventDefault();
                    onOpenMenu({ id: node.id, x: event.clientX, y: event.clientY });
                }}
            >
                {isFolder ? (
                    <span
                        className="wiw-tree-toggle"
                        role="button"
                        tabIndex={0}
                        title="Collapse / expand"
                        onClick={() => onExpand(node.id, !expanded)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                                onExpand(node.id, !expanded);
                            }
                        }}
                    >
                        <i
                            className={`fa-solid ${expanded ? 'fa-chevron-down' : 'fa-chevron-right'} wiw-tree-caret`}
                        />
                        <i className={`fa-solid ${kindIcon}`} />
                    </span>
                ) : (
                    <span className="wiw-tree-leaf-icon">
                        <i className={`fa-solid ${kindIcon}${node.kind === 'entry' && node.native.disable ? ' wiw-entry-off' : ''}`} />
                    </span>
                )}
                <span
                    className="wiw-tree-name"
                    role="button"
                    tabIndex={0}
                    onClick={(event) => {
                        if (event.shiftKey) {
                            onSelect(node.id, 'range');
                        } else if (event.ctrlKey || event.metaKey) {
                            onSelect(node.id, 'toggle');
                        } else {
                            onSelect(node.id, 'none');
                        }
                    }}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                            onSelect(node.id, 'none');
                        }
                    }}
                >
                    {node.name}
                </span>
                {node.kind === 'entry' && node.native.disable && (
                    <span className="wiw-badge wiw-badge-off" title="Disabled">
                        off
                    </span>
                )}
                {isFolder && (node as FolderNode).isWiRoot && (
                    <span className="wiw-badge wiw-badge-book">WI</span>
                )}
            </div>
            {isFolder &&
                expanded &&
                sortChildrenView((node as FolderNode).children, sortMode).map((child, childIndex) => (
                    <Row
                        key={child.id}
                        node={child}
                        depth={depth + 1}
                        siblingIndex={childIndex}
                        visibleIds={visibleIds}
                        selectedIds={selectedIds}
                        sortMode={sortMode}
                        allowReorder={allowReorder}
                        dragOverId={dragOverId}
                        menuTargetId={menuTargetId}
                        setDragOverId={setDragOverId}
                        onSelect={onSelect}
                        onExpand={onExpand}
                        onMoveNode={onMoveNode}
                        onOpenMenu={onOpenMenu}
                    />
                ))}
        </>
    );
}

function collectVisible(
    root: FolderNode,
    kinds: ReadonlySet<BrowseFilter>,
    query: string,
    scope: SearchScope,
    sortMode: SortMode
): Set<string> {
    const result = new Set<string>();
    const walk = (node: TreeNode): boolean => {
        let childVisible = false;
        if (node.kind === 'folder') {
            for (const child of sortChildrenView(node.children, sortMode)) {
                if (walk(child)) {
                    childVisible = true;
                }
            }
        }
        const self =
            node === root ||
            (matchesSearch(node, query, scope) &&
                (kinds.size === 0 || kinds.has(kindOfFilter(node))));
        if (self || childVisible) {
            result.add(node.id);
        }
        return self || childVisible;
    };
    walk(root);
    return result;
}

export function StructureTree(props: StructureTreeProps): JSX.Element {
    const { root, sortMode, onSort, selectedIds, onCreate, menu, onImportFile } = props;
    const [kinds, setKinds] = useState<ReadonlySet<BrowseFilter>>(
        new Set<BrowseFilter>(['folders', 'wiFolders', 'entries', 'images'])
    );
    const [query, setQuery] = useState('');
    const [scope, setScope] = useState<SearchScope>('title+prompt');
    const [dragOverId, setDragOverId] = useState<string | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const closeMenuRef = useRef(props.onCloseMenu);
    closeMenuRef.current = props.onCloseMenu;
    const menuOpen = menu !== null;
    useEffect(() => {
        if (!menuOpen) {
            return;
        }
        // Any press outside the menu closes it — anywhere on the page, not only
        // inside the tree (the menu is position: fixed and outlives scrolling).
        const onPointerDown = (event: PointerEvent): void => {
            if (!(event.target instanceof Node) || !menuRef.current?.contains(event.target)) {
                closeMenuRef.current();
            }
        };
        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                closeMenuRef.current();
            }
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown, true);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [menuOpen]);
    const visibleIds = useMemo(
        () => collectVisible(root, kinds, query.trim(), scope, sortMode),
        [root, kinds, query, scope, sortMode]
    );
    const toggleKind = (kind: BrowseFilter): void => {
        setKinds((prev) => {
            const next = new Set(prev);
            if (next.has(kind)) {
                next.delete(kind);
            } else {
                next.add(kind);
            }
            return next;
        });
    };
    return (
        <div className="wiw-tree">
            <div className="wiw-tree-toolbar">
                <select
                    className="wiw-tree-sort"
                    title="Sort entries"
                    value={sortMode}
                    onChange={(event) => onSort(event.target.value as SortMode)}
                >
                    <option value="custom">Custom order</option>
                    <option value="title">Title (A-Z)</option>
                    <option value="position">Position</option>
                    <option value="depth">Depth</option>
                    <option value="order">Order</option>
                    <option value="trigger">Trigger %</option>
                </select>
                <div className="wiw-tree-filters">
                    {(['folders', 'wiFolders', 'entries', 'images'] as const).map((kind) => (
                        <button
                            key={kind}
                            type="button"
                            className={`wiw-filter-chip${kinds.has(kind) ? ' wiw-filter-on' : ''}`}
                            title={KIND_TITLES[kind]}
                            onClick={() => toggleKind(kind)}
                        >
                            <i className={`fa-solid ${KIND_ICONS[kind]}`} />
                        </button>
                    ))}
                    <select
                        className="wiw-tree-scope"
                        title="Search in"
                        value={scope}
                        onChange={(event) => setScope(event.target.value as SearchScope)}
                    >
                        <option value="title">Title</option>
                        <option value="prompt">Prompt</option>
                        <option value="title+prompt">Title+Prompt</option>
                    </select>
                </div>
                <input
                    className="wiw-tree-search"
                    type="text"
                    placeholder="Search..."
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                />
                <div className="wiw-tree-create">
                    <span className="wiw-tree-create-label">New:</span>
                    <button
                        type="button"
                        className="wiw-filter-chip"
                        title="Create folder in the selected folder"
                        onClick={() => onCreate('folder')}
                    >
                        <i className="fa-solid fa-folder-plus" />
                    </button>
                    <button
                        type="button"
                        className="wiw-filter-chip"
                        title="Create entry in the selected folder"
                        onClick={() => onCreate('entry')}
                    >
                        <i className="fa-solid fa-square-plus" />
                    </button>
                    <button
                        type="button"
                        className="wiw-filter-chip"
                        title="Create image in the selected folder"
                        onClick={() => onCreate('image')}
                    >
                        <i className="fa-solid fa-image" />
                    </button>
                    <label
                        className="wiw-filter-chip"
                        title="Import a world file (.json / .lorebook) into the selected folder"
                    >
                        <i className="fa-solid fa-file-import" />
                        <input
                            type="file"
                            accept=".json,.lorebook"
                            hidden
                            onChange={(event) => {
                                const file = event.target.files?.[0];
                                event.target.value = '';
                                if (file) {
                                    onImportFile(file);
                                }
                            }}
                        />
                    </label>
                </div>
            </div>
            <Row
                node={root}
                depth={0}
                siblingIndex={0}
                visibleIds={visibleIds}
                selectedIds={selectedIds}
                sortMode={sortMode}
                allowReorder={sortMode === 'custom'}
                dragOverId={dragOverId}
                menuTargetId={menu?.id ?? null}
                setDragOverId={setDragOverId}
                onSelect={props.onSelect}
                onExpand={props.onExpand}
                onMoveNode={props.onMoveNode}
                onOpenMenu={props.onOpenMenu}
            />
            {menu && (
                <div
                    ref={menuRef}
                    className="wiw-tree-menu"
                    style={{ left: menu.x, top: menu.y }}
                    onClick={(event) => event.stopPropagation()}
                >
                    {MENU_ITEMS.filter((item) => !item.folderOnly || isFolderId(props.root, menu.id)).map((item) => (
                        <button
                            key={item.action}
                            type="button"
                            className="wiw-tree-menu-item"
                            onClick={() => {
                                // Reordering is repeated step by step on touch devices:
                                // the menu stays open until an outside tap.
                                if (!STICKY_MENU_ACTIONS.has(item.action)) {
                                    props.onCloseMenu();
                                }
                                props.onMenuAction(item.action, menu.id);
                            }}
                        >
                            <i className={`fa-solid ${item.icon}`} /> {item.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}