import {
    createDefaultState,
    createEntryNode,
    createFolderNode,
    createImageNode,
    type EntryNode,
    type FolderNode,
    type ImageNode,
    type TreeNode,
    type WorkspaceState,
} from '../../src/core/state/schema';

/** Small tree builders for markdown tests. Ids are readable and deterministic. */

const NOW = '2026-09-14T00:00:00.000Z';
let uid = 1;

export function folderNode(id: string, name: string, children: TreeNode[] = [], extra: Partial<FolderNode> = {}): FolderNode {
    const node = createFolderNode({ id, parentId: 'pending', name, now: NOW });
    Object.assign(node, extra);
    node.children = children;
    children.forEach((child) => (child.parentId = id));
    return node;
}

export function entryNode(id: string, name: string, native: Partial<EntryNode['native']> = {}): EntryNode {
    const node = createEntryNode({ id, parentId: 'pending', name, now: NOW, nativeUid: uid++ });
    Object.assign(node.native, native);
    return node;
}

export function imageNode(id: string, name: string, src: string, caption = ''): ImageNode {
    const node = createImageNode({ id, parentId: 'pending', name, now: NOW });
    node.src = src;
    node.caption = caption;
    return node;
}

export function stateWith(children: TreeNode[]): WorkspaceState {
    const state = createDefaultState();
    state.root.children = children;
    children.forEach((child) => (child.parentId = state.root.id));
    return state;
}

export const PNG_DATA_URI = 'data:image/png;base64,iVBORw0KGgo=';
export const SVG_DATA_URI = 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E';

/** A representative tree: nested WI root, custom order, collisions, images. */
export function sampleState(): WorkspaceState {
    return stateWith([
        folderNode(
            'kingdoms',
            'Kingdoms',
            [
                entryNode('varn', 'House Varn', { key: ['Varn'], content: 'A noble house.' }),
                entryNode('alder', 'Aldermeer', { key: ['Aldermeer', 'river city'], order: 120, content: 'River city.' }),
                imageNode('map', 'Aldermeer map', PNG_DATA_URI, 'Old survey'),
                imageNode('crest', 'Crest', SVG_DATA_URI),
                imageNode('remote', 'Remote portrait', 'https://example.org/p.png'),
                folderNode(
                    'houses',
                    'Houses',
                    [entryNode('e-ab1', 'A/B'), entryNode('e-ab2', 'a_b')],
                    { isWiRoot: true, book: { bookName: 'Houses Book', orphans: [] } }
                ),
            ],
            { isWiRoot: true, book: { bookName: 'Kingdoms East', orphans: [] } }
        ),
        entryNode('notes', 'Notes', { content: '# Notes\nPlain.' }),
    ]);
}
