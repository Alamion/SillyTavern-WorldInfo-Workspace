import { useEffect, useMemo, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { SampleDataset, SampleNode } from '../core/sample/dataset';
import { SAMPLE_DATASET } from '../core/sample/dataset';
import {
    buildNodeIndex,
    createEntry,
    createFolder,
    createImage,
    deleteNode,
    duplicateNode,
    findDefaultSelection,
    moveNode,
    resolveMemberships,
    sortChildrenRecursively,
    type SortMode,
} from '../core/sample/tree';
import type { ImageResolver } from '../core/sample/markdown';
import { AssistantPanel } from './AssistantPanel';
import { ItemEditor } from './ItemEditor';
import { ReviewGuide } from './ReviewGuide';
import Sheet from './Sheet';
import { StructureTree } from './StructureTree';

const TREE_MIN = 140;
const TREE_COLLAPSE_BELOW = 120;
const TREE_MAX = 640;

function slugify(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

export function WorkspacePrototype(): JSX.Element {
    const [dataset, setDataset] = useState<SampleDataset>(() =>
        structuredClone(SAMPLE_DATASET)
    );
    const nodeIndex = useMemo(() => buildNodeIndex(dataset.root), [dataset]);
    const [selectedId, setSelectedId] = useState<string | null>(
        () => findDefaultSelection(SAMPLE_DATASET.root)?.id ?? null
    );
    const [assistantOpen, setAssistantOpen] = useState(false);
    const [guideOpen, setGuideOpen] = useState(false);
    const [treeWidth, setTreeWidth] = useState(300);
    const [treeCollapsed, setTreeCollapsed] = useState(false);
    const [dragging, setDragging] = useState<{ startX: number; startWidth: number } | null>(
        null
    );
    const [mobileSheet, setMobileSheet] = useState<'none' | 'editor' | 'assistant'>('none');
    const [isMobile, setIsMobile] = useState(
        () => window.matchMedia('(max-width: 900px)').matches
    );

    useEffect(() => {
        const query = window.matchMedia('(max-width: 900px)');
        const listener = (event: MediaQueryListEvent): void => {
            setIsMobile(event.matches);
        };
        query.addEventListener('change', listener);
        return () => query.removeEventListener('change', listener);
    }, []);

    const selected: SampleNode | null =
        selectedId !== null ? (nodeIndex.get(selectedId) ?? null) : null;

    const handleSelect = (id: string): void => {
        setSelectedId(id);
        if (isMobile) {
            setMobileSheet('editor');
        }
    };

    const applySort = (mode: SortMode): void => {
        setDataset((prev) => {
            const next: SampleDataset = structuredClone(prev);
            sortChildrenRecursively(next.root, mode);
            return next;
        });
    };

    const handleCreate = (kind: 'folder' | 'entry' | 'image'): void => {
        const target =
            selected && selected.kind === 'folder'
                ? selected.id
                : selected && selected.parentId !== null
                  ? selected.parentId
                  : dataset.root.id;
        const baseName =
            kind === 'folder' ? 'New Folder' : kind === 'entry' ? 'New Entry' : 'New Image';
        setDataset((prev) => {
            const next: SampleDataset = structuredClone(prev);
            const created =
                kind === 'folder'
                    ? createFolder(next.root, target, baseName)
                    : kind === 'entry'
                      ? createEntry(next.root, target, baseName)
                      : createImage(next.root, target, baseName);
            if (created) {
                setSelectedId(created.id);
                if (isMobile) {
                    setMobileSheet('editor');
                }
            }
            return next;
        });
    };

    const toggleWiRoot = (folderId: string): void => {
        setDataset((prev) => {
            const next: SampleDataset = structuredClone(prev);
            const index = buildNodeIndex(next.root);
            const folder = index.get(folderId);
            if (!folder || folder.kind !== 'folder') {
                return prev;
            }
            folder.isWiRoot = !folder.isWiRoot;
            folder.wiSettings = folder.isWiRoot
                ? {
                      bookName: slugify(folder.name),
                      scanDepthOverride: 4,
                      caseSensitiveOverride: false,
                      recursiveScanning: true,
                      notes: 'Created from the prototype WI toggle.',
                  }
                : null;
            for (const node of index.values()) {
                if (node.kind === 'entry') {
                    node.bookMemberships = resolveMemberships(index, node);
                }
            }
            return next;
        });
    };

    const handleDuplicate = (nodeId: string): void => {
        setDataset((prev) => {
            const next: SampleDataset = structuredClone(prev);
            const created = duplicateNode(next.root, nodeId);
            if (!created) {
                return prev;
            }
            if (created.kind === 'entry') {
                const index = buildNodeIndex(next.root);
                for (const node of index.values()) {
                    if (node.kind === 'entry') {
                        node.bookMemberships = resolveMemberships(index, node);
                    }
                }
            }
            setSelectedId(created.id);
            return next;
        });
    };

    const handleDelete = (nodeId: string): void => {
        const node = nodeIndex.get(nodeId);
        if (!node) {
            return;
        }
        const confirmed = window.confirm(`Delete "${node.name}"? This cannot be undone.`);
        if (!confirmed) {
            return;
        }
        setDataset((prev) => {
            const next: SampleDataset = structuredClone(prev);
            if (!deleteNode(next.root, nodeId)) {
                return prev;
            }
            return next;
        });
        setSelectedId((prev) => (prev === nodeId ? null : prev));
        if (isMobile && mobileSheet !== 'none') {
            setMobileSheet('none');
        }
    };

    const handleMoveNode = (nodeId: string, newParentId: string, indexInParent?: number): void => {
        setDataset((prev) => {
            const next: SampleDataset = structuredClone(prev);
            const moved = moveNode(next.root, nodeId, newParentId, indexInParent);
            if (!moved) {
                return prev;
            }
            const index = buildNodeIndex(next.root);
            for (const node of index.values()) {
                if (node.kind === 'entry') {
                    node.bookMemberships = resolveMemberships(index, node);
                }
            }
            return next;
        });
    };

    const resolveImage: ImageResolver = (ref) => {
        if (!ref.startsWith('img:')) {
            return undefined;
        }
        const node = nodeIndex.get(ref.slice(4));
        return node && node.kind === 'image' ? node.source : undefined;
    };

    const onSplitterDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
        if (treeCollapsed) {
            return;
        }
        setDragging({ startX: event.clientX, startWidth: treeWidth });
        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const onSplitterMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
        if (!dragging) {
            return;
        }
        const width = dragging.startWidth + (event.clientX - dragging.startX);
        if (width < TREE_COLLAPSE_BELOW) {
            setTreeCollapsed(true);
            setDragging(null);
            return;
        }
        setTreeWidth(Math.min(Math.max(width, TREE_MIN), TREE_MAX));
    };

    return (
        <div className="wiw-surface">
            <header className="wiw-header">
                <span
                    className="wiw-app-badge"
                    title={dataset.meta.prototypeLabel}
                >
                    <i className="fa-solid fa-book-atlas" /> Workspace
                </span>
                <div className="wiw-header-spacer" />
                <button
                    type="button"
                    className="wiw-button wiw-icon-button"
                    title="Review guide"
                    onClick={() => setGuideOpen(true)}
                >
                    <i className="fa-solid fa-circle-question" />
                </button>
                <button
                    type="button"
                    className="wiw-button wiw-icon-button"
                    title={isMobile || !assistantOpen ? 'Show assistant' : 'Hide assistant'}
                    onClick={() => {
                        if (isMobile) {
                            setMobileSheet('assistant');
                        } else {
                            setAssistantOpen((prev) => !prev);
                        }
                    }}
                >
                    <i className="fa-solid fa-wand-magic-sparkles" />
                </button>
            </header>
            <div className="wiw-regions">
                {!isMobile && (
                    <>
                        <aside
                            className={`wiw-region wiw-region-tree${treeCollapsed ? ' wiw-tree-collapsed' : ''}`}
                            style={{ flexBasis: treeCollapsed ? 44 : treeWidth }}
                        >
                            {treeCollapsed ? (
                                <button
                                    type="button"
                                    className="wiw-tree-expand"
                                    title="Show tree"
                                    onClick={() => setTreeCollapsed(false)}
                                >
                                    <i className="fa-solid fa-angles-right" />
                                </button>
                            ) : (
                                <StructureTree
                                    root={dataset.root}
                                    selectedId={selectedId}
                                    onSelect={handleSelect}
                                    onSort={applySort}
                                    onMoveNode={handleMoveNode}
                                    onCreate={handleCreate}
                                    allowReorder={true}
                                />
                            )}
                        </aside>
                        {!treeCollapsed && (
                            <div
                                className="wiw-splitter"
                                title="Drag to resize; double-click to collapse"
                                onPointerDown={onSplitterDown}
                                onPointerMove={onSplitterMove}
                                onPointerUp={() => setDragging(null)}
                                onDoubleClick={() => setTreeCollapsed(true)}
                            />
                        )}
                    </>
                )}
                {!isMobile && (
                    <main className="wiw-region wiw-region-editor">
                        <ItemEditor
                            selected={selected}
                            resolveImage={resolveImage}
                            onToggleWiRoot={toggleWiRoot}
onDuplicate={handleDuplicate}
onDelete={handleDelete}
/>
                    </main>
                )}
                {!isMobile && assistantOpen && (
                    <aside className="wiw-region wiw-region-assistant">
                        <AssistantPanel />
                    </aside>
                )}
                {isMobile && (
                    <main className="wiw-mobile-tree">
                        <StructureTree
                            root={dataset.root}
                            selectedId={selectedId}
                            onSelect={handleSelect}
                            onSort={applySort}
                            onMoveNode={handleMoveNode}
                            onCreate={handleCreate}
                            allowReorder={true}
                        />
                    </main>
                )}
            </div>
            {isMobile && mobileSheet === 'editor' && (
                <Sheet key="editor-sheet" onClose={() => setMobileSheet('none')}>
                    <ItemEditor
                        selected={selected}
                        resolveImage={resolveImage}
                        onToggleWiRoot={toggleWiRoot}
                        onDuplicate={handleDuplicate}
                        onDelete={handleDelete}
                    />
                </Sheet>
            )}
            {isMobile && mobileSheet === 'assistant' && (
                <Sheet key="assistant-sheet" onClose={() => setMobileSheet('none')}>
                    <AssistantPanel />
                </Sheet>
            )}
            {guideOpen && <ReviewGuide onClose={() => setGuideOpen(false)} />}
        </div>
    );
}
