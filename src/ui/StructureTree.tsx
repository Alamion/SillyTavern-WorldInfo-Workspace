import { useMemo, useState } from 'react';
import type { CSSProperties, DragEvent as ReactDragEvent } from 'react';
import type { SampleFolderNode, SampleNode } from '../core/sample/dataset';
import {
    matchesFilter,
    sortedChildren,
    type FilterKind,
    type FilterSearchScope,
    type SortMode,
} from '../core/sample/tree';

interface StructureTreeProps {
    root: SampleFolderNode;
    selectedId: string | null;
    onSelect: (id: string) => void;
    onSort: (mode: SortMode) => void;
    onMoveNode: (nodeId: string, newParentId: string, indexInParent?: number) => void;
    onCreate: (kind: 'folder' | 'entry' | 'image') => void;
    allowReorder: boolean;
}

interface RowProps {
    siblingIndex: number;
    visible: ReadonlySet<string>;
    node: SampleNode;
    depth: number;
    expandedIds: ReadonlySet<string>;
    onToggle: (id: string) => void;
    selectedId: string | null;
    onSelect: (id: string) => void;
    onMoveNode: StructureTreeProps['onMoveNode'];
    allowReorder: boolean;
    dragOverId: string | null;
    setDragOverId: (id: string | null) => void;
}

const ALL_KINDS: ReadonlySet<FilterKind> = new Set<FilterKind>([
    'folders',
    'wiFolders',
    'entries',
    'images',
]);

function Row({
    siblingIndex,
    visible,
    node,
    depth,
    expandedIds,
    onToggle,
    selectedId,
    onSelect,
    onMoveNode,
    allowReorder,
    dragOverId,
    setDragOverId,
}: RowProps): JSX.Element | null {
    if (!visible.has(node.id)) {
        return null;
    }
    const isFolder = node.kind === 'folder';
    const expanded = isFolder && expandedIds.has(node.id);
    const indentStyle: CSSProperties = { paddingLeft: `${depth * 12 + 4}px` };
    const selected = selectedId === node.id;
    const isDragOver = dragOverId === node.id;
    const kindIcon =
        node.kind === 'folder'
            ? expanded
                ? 'fa-folder-open'
                : 'fa-folder'
            : node.kind === 'entry'
              ? 'fa-book'
              : 'fa-image';
    const handleSelect = (): void => {
        onSelect(node.id);
    };
    const handleToggle = (): void => {
        if (node.kind === 'folder') {
            onToggle(node.id);
        }
    };
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
                className={`wiw-tree-row${selected ? ' wiw-selected' : ''}${isDragOver ? ' wiw-drag-over' : ''}`}
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
            >
                {isFolder ? (
                    <span
                        className="wiw-tree-toggle"
                        role="button"
                        tabIndex={0}
                        title="Collapse / expand"
                        onClick={handleToggle}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                                handleToggle();
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
                        <i className={`fa-solid ${kindIcon}`} />
                    </span>
                )}
                <span
                    className="wiw-tree-name"
                    role="button"
                    tabIndex={0}
                    onClick={handleSelect}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                            handleSelect();
                        }
                    }}
                >
                    {node.name}
                </span>
                {node.kind === 'folder' && node.isWiRoot && (
                    <span className="wiw-badge wiw-badge-book">WI</span>
                )}
            </div>
            {isFolder &&
                expanded &&
                sortedChildren(node as SampleFolderNode).map((child, childIndex) => (
                    <Row
                        key={child.id}
                        siblingIndex={childIndex}
                        visible={visible}
                        node={child}
                        depth={depth + 1}
                        expandedIds={expandedIds}
                        onToggle={onToggle}
                        selectedId={selectedId}
                        onSelect={onSelect}
                        onMoveNode={onMoveNode}
                        allowReorder={allowReorder}
                        dragOverId={dragOverId}
                        setDragOverId={setDragOverId}
                    />
                ))}
        </>
    );
}

export function StructureTree({
    root,
    selectedId,
    onSelect,
    onSort,
    onMoveNode,
    onCreate,
    allowReorder,
}: StructureTreeProps): JSX.Element {
    const [sortMode, setSortMode] = useState<SortMode>('custom');
    const [kinds, setKinds] = useState<ReadonlySet<FilterKind>>(ALL_KINDS);
    const [query, setQuery] = useState('');
    const [scope, setScope] = useState<FilterSearchScope>('title+prompt');
    const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => {
        const initial = new Set<string>();
        const walk = (node: SampleNode): void => {
            if (node.kind === 'folder') {
                if (node.expanded) {
                    initial.add(node.id);
                }
                node.children.forEach(walk);
            }
        };
        walk(root);
        return initial;
    });
    const [dragOverId, setDragOverId] = useState<string | null>(null);
    const toggle = (id: string): void => {
        setExpandedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };
    const toggleKind = (kind: FilterKind): void => {
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
    const visible = useMemo(() => {
        const result = new Set<string>();
        const walk = (node: SampleNode): boolean => {
            let childVisible = false;
            if (node.kind === 'folder') {
                for (const child of node.children) {
                    if (walk(child)) {
                        childVisible = true;
                    }
                }
            }
            const self = matchesFilter(node, kinds, query.trim(), scope);
            if (self || childVisible) {
                result.add(node.id);
            }
            return self || childVisible;
        };
        walk(root);
        return result;
    }, [root, kinds, query, scope]);
    return (
        <div className="wiw-tree">
            <div className="wiw-tree-toolbar">
                <select
                    className="wiw-tree-sort"
                    title="Sort entries"
                    value={sortMode}
                    onChange={(event) => {
                        const mode = event.target.value as SortMode;
                        setSortMode(mode);
                        onSort(mode);
                    }}
                >
                    <option value="custom">Custom order</option>
                    <option value="title">Title (A-Z)</option>
                    <option value="position">Position</option>
                    <option value="depth">Depth</option>
                    <option value="order">Order</option>
                    <option value="trigger">Trigger %</option>
                </select>
                <div className="wiw-tree-filters">
                    <button
                        type="button"
                        className={`wiw-filter-chip${kinds.has('folders') ? ' wiw-filter-on' : ''}`}
                        title="Folders"
                        onClick={() => toggleKind('folders')}
                    >
                        <i className="fa-solid fa-folder" />
                    </button>
                    <button
                        type="button"
                        className={`wiw-filter-chip${kinds.has('wiFolders') ? ' wiw-filter-on' : ''}`}
                        title="World Info folders"
                        onClick={() => toggleKind('wiFolders')}
                    >
                        <i className="fa-solid fa-folder-tree" />
                    </button>
                    <button
                        type="button"
                        className={`wiw-filter-chip${kinds.has('entries') ? ' wiw-filter-on' : ''}`}
                        title="Entries"
                        onClick={() => toggleKind('entries')}
                    >
                        <i className="fa-solid fa-book" />
                    </button>
                    <button
                        type="button"
                        className={`wiw-filter-chip${kinds.has('images') ? ' wiw-filter-on' : ''}`}
                        title="Images"
                        onClick={() => toggleKind('images')}
                    >
                        <i className="fa-solid fa-image" />
                    </button>
                    <select
                        className="wiw-tree-scope"
                        title="Search in"
                        value={scope}
                        onChange={(event) => setScope(event.target.value as FilterSearchScope)}
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
                </div>
            </div>
            <Row
                siblingIndex={0}
                visible={visible}
                node={root}
                depth={0}
                expandedIds={expandedIds}
                onToggle={toggle}
                selectedId={selectedId}
                onSelect={onSelect}
                onMoveNode={onMoveNode}
                allowReorder={allowReorder && sortMode === 'custom'}
                dragOverId={dragOverId}
                setDragOverId={setDragOverId}
            />
        </div>
    );
}
