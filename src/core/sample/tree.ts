import type { SampleEntryNode, SampleFolderNode, SampleNode } from './dataset';

export type NodeIndex = Map<string, SampleNode>;

export function buildNodeIndex(root: SampleFolderNode): NodeIndex {
    const index: NodeIndex = new Map();
    const walk = (node: SampleNode): void => {
        index.set(node.id, node);
        if (node.kind === 'folder') {
            node.children.forEach(walk);
        }
    };
    walk(root);
    return index;
}

export function sortedChildren(folder: SampleFolderNode): SampleNode[] {
    return [...folder.children];
}

export function depthOf(index: NodeIndex, node: SampleNode): number {
    let depth = 0;
    let cursor = node.parentId !== null ? index.get(node.parentId) : undefined;
    while (cursor) {
        depth += 1;
        cursor = cursor.parentId !== null ? index.get(cursor.parentId) : undefined;
    }
    return depth;
}

export function wiRootChain(index: NodeIndex, node: SampleNode): SampleFolderNode[] {
    const chain: SampleFolderNode[] = [];
    let cursor = node.parentId !== null ? index.get(node.parentId) : undefined;
    while (cursor) {
        if (cursor.kind === 'folder' && cursor.isWiRoot) {
            chain.unshift(cursor);
        }
        cursor = cursor.parentId !== null ? index.get(cursor.parentId) : undefined;
    }
    return chain;
}

export function resolveMemberships(index: NodeIndex, card: SampleEntryNode): string[] {
    return wiRootChain(index, card).map((root) => root.wiSettings?.bookName ?? '');
}

export function collectWiRoots(root: SampleFolderNode): SampleFolderNode[] {
    const roots: SampleFolderNode[] = [];
    const walk = (node: SampleNode): void => {
        if (node.kind === 'folder') {
            if (node.isWiRoot) {
                roots.push(node);
            }
            node.children.forEach(walk);
        }
    };
    walk(root);
    return roots;
}

export function findDefaultSelection(root: SampleFolderNode): SampleEntryNode | null {
    const walk = (node: SampleNode, insideRoot: boolean): SampleEntryNode | null => {
        if (node.kind === 'entry') {
            return insideRoot ? node : null;
        }
        if (node.kind !== 'folder') {
            return null;
        }
        const inScope = insideRoot || node.isWiRoot;
        for (const child of node.children) {
            const found = walk(child, inScope);
            if (found) {
                return found;
            }
        }
        return null;
    };
    return walk(root, false);
}

export type SortMode = 'custom' | 'title' | 'position' | 'depth' | 'order' | 'trigger';

export type FilterKind = 'folders' | 'wiFolders' | 'entries' | 'images';

export type FilterSearchScope = 'title' | 'prompt' | 'title+prompt';

function entrySortValue(node: SampleNode, mode: SortMode): number | string {
    if (node.kind !== 'entry') {
        return 0;
    }
    switch (mode) {
        case 'position':
            return node.fields.position;
        case 'depth':
            return node.fields.depth;
        case 'order':
            return node.fields.order;
        case 'trigger':
            return node.fields.probability;
        default:
            return node.name.toLowerCase();
    }
}

export function sortChildrenRecursively(root: SampleFolderNode, mode: SortMode): void {
    const walk = (folder: SampleFolderNode): void => {
        if (mode !== 'custom') {
            folder.children.sort((a, b) => {
                const va = entrySortValue(a, mode);
                const vb = entrySortValue(b, mode);
                if (typeof va === 'string' || typeof vb === 'string') {
                    return String(va).localeCompare(String(vb));
                }
                return vb - va;
            });
        }
        folder.children.forEach((child) => {
            if (child.kind === 'folder') {
                walk(child);
            }
        });
    };
    walk(root);
}

export function matchesFilter(
    node: SampleNode,
    kinds: ReadonlySet<FilterKind>,
    query: string,
    scope: FilterSearchScope
): boolean {
    const kindOk =
        (node.kind === 'folder' && node.isWiRoot && kinds.has('wiFolders')) ||
        (node.kind === 'folder' && !node.isWiRoot && kinds.has('folders')) ||
        (node.kind === 'entry' && kinds.has('entries')) ||
        (node.kind === 'image' && kinds.has('images'));
    if (!kindOk) {
        return false;
    }
    if (query === '') {
        return true;
    }
    const needle = query.toLowerCase();
    const titleMatch = node.name.toLowerCase().includes(needle);
    if (scope === 'title') {
        return titleMatch;
    }
    const prompt =
        node.kind === 'entry'
            ? node.fields.content
            : node.kind === 'image'
              ? node.caption
              : '';
    if (scope === 'prompt') {
        return prompt.toLowerCase().includes(needle);
    }
    return titleMatch || prompt.toLowerCase().includes(needle);
}

export function moveNode(
    root: SampleFolderNode,
    nodeId: string,
    newParentId: string,
    indexInParent?: number
): SampleFolderNode | null {
    if (nodeId === root.id) {
        return null;
    }
    const index = buildNodeIndex(root);
    const node = index.get(nodeId);
    const newParent = index.get(newParentId);
    if (!node || !newParent || newParent.kind !== 'folder') {
        return null;
    }
    let cursor: SampleNode | undefined = newParent;
    while (cursor) {
        if (cursor.id === nodeId) {
            return null;
        }
        cursor = cursor.parentId !== null ? index.get(cursor.parentId) : undefined;
    }
    const detach = (folder: SampleFolderNode): boolean => {
        const at = folder.children.findIndex((child) => child.id === nodeId);
        if (at >= 0) {
            folder.children.splice(at, 1);
            return true;
        }
        return folder.children.some((child) => child.kind === 'folder' && detach(child));
    };
    if (!detach(root)) {
        return null;
    }
    node.parentId = newParentId;
    const at = indexInParent ?? newParent.children.length;
    newParent.children.splice(Math.min(at, newParent.children.length), 0, node);
    return root;
}

let createdCounter = 0;

function nextCreatedId(prefix: string): string {
    createdCounter += 1;
    return `${prefix}-created-${String(createdCounter).padStart(3, '0')}`;
}

const nextCreatedUid = (): number => 500 + createdCounter + Math.floor(Date.now() % 1000);

const BASE_ENTRY_FIELDS = {
    key: [] as string[],
    keysecondary: [] as string[],
    constant: false,
    vectorized: false,
    selective: true,
    selectiveLogic: 0,
    probability: 100,
    useProbability: true,
    disable: false,
    order: 100,
    position: 0,
    depth: 4,
    role: 0,
    outletName: '',
    ignoreBudget: false,
    excludeRecursion: false,
    preventRecursion: false,
    delayUntilRecursion: 0,
    matchPersonaDescription: false,
    matchCharacterDescription: false,
    matchCharacterPersonality: false,
    matchCharacterDepthPrompt: false,
    matchScenario: false,
    matchCreatorNotes: false,
    group: '',
    groupOverride: false,
    groupWeight: 100,
    scanDepth: null,
    caseSensitive: null,
    matchWholeWords: null,
    useGroupScoring: null,
    sticky: null,
    cooldown: null,
    delay: null,
    automationId: '',
    triggers: [] as string[],
    characterFilterNames: [] as string[],
    characterFilterTags: [] as string[],
    characterFilterExclude: false,
    addMemo: true,
    extensions: {} as Record<string, unknown>,
};

export function createFolder(
    root: SampleFolderNode,
    parentId: string,
    name: string
): SampleFolderNode | null {
    const index = buildNodeIndex(root);
    const parent = index.get(parentId);
    if (!parent || parent.kind !== 'folder') {
        return null;
    }
    const folder: SampleFolderNode = {
        id: nextCreatedId('folder'),
        parentId,
        kind: 'folder',
        name,
        isWiRoot: false,
        wiSettings: null,
        expanded: false,
        children: [],
    };
    parent.children.push(folder);
    return folder;
}

export function createEntry(
    root: SampleFolderNode,
    parentId: string,
    name: string
): SampleEntryNode | null {
    const index = buildNodeIndex(root);
    const parent = index.get(parentId);
    if (!parent || parent.kind !== 'folder') {
        return null;
    }
    const uid = nextCreatedUid();
    const entry: SampleEntryNode = {
        id: nextCreatedId('entry'),
        parentId,
        kind: 'entry',
        name,
        fields: {
            ...BASE_ENTRY_FIELDS,
            uid,
            comment: name,
            content: '',
            displayIndex: uid,
        },
        bookMemberships: [],
        contentLengthClass: 'normal',
    };
    parent.children.push(entry);
    return entry;
}

export function createImage(
    root: SampleFolderNode,
    parentId: string,
    name: string
): SampleNode | null {
    const index = buildNodeIndex(root);
    const parent = index.get(parentId);
    if (!parent || parent.kind !== 'folder') {
        return null;
    }
    const image: SampleNode = {
        id: nextCreatedId('image'),
        parentId,
        kind: 'image',
        name,
        source: '',
        caption: '',
    };
    parent.children.push(image);
    return image;
}

export function duplicateNode(root: SampleFolderNode, nodeId: string): SampleNode | null {
    const index = buildNodeIndex(root);
    const node = index.get(nodeId);
    if (!node || node.parentId === null) {
        return null;
    }
    const parent = index.get(node.parentId);
    if (!parent || parent.kind !== 'folder') {
        return null;
    }
    if (node.kind === 'folder') {
        return null;
    }
    const clone = structuredClone(node);
    clone.id = nextCreatedId(node.kind);
    clone.name = `${node.name} (copy)`;
    if (clone.kind === 'entry') {
        const uid = nextCreatedUid();
        clone.fields.uid = uid;
        clone.fields.comment = clone.name;
        clone.fields.displayIndex = uid;
        clone.contentLengthClass = 'normal';
    }
    const at = parent.children.findIndex((child) => child.id === nodeId);
    parent.children.splice(at + 1, 0, clone);
    return clone;
}

export function deleteNode(root: SampleFolderNode, nodeId: string): boolean {
    if (nodeId === root.id) {
        return false;
    }
    const detach = (folder: SampleFolderNode): boolean => {
        const at = folder.children.findIndex((child) => child.id === nodeId);
        if (at >= 0) {
            folder.children.splice(at, 1);
            return true;
        }
        return folder.children.some((child) => child.kind === 'folder' && detach(child));
    };
    return detach(root);
}
