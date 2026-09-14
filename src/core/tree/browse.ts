import type { TreeNode } from '../state/schema';

/**
 * View-level browse helpers (US1, FR-005): sort modes over a folder's children
 * (folders last unless custom), kind filters, and title/prompt search. These
 * NEVER mutate the persisted child order — `custom` is the real order.
 */

export type SortMode = 'custom' | 'title' | 'position' | 'depth' | 'order' | 'trigger';

export type BrowseFilter = 'folders' | 'wiFolders' | 'entries' | 'images';

export type SearchScope = 'title' | 'prompt' | 'title+prompt';

export function sortChildrenView(children: readonly TreeNode[], mode: SortMode): TreeNode[] {
    const folders = children.filter((node) => node.kind === 'folder');
    const items = children.filter((node) => node.kind !== 'folder');
    if (mode === 'custom') {
        return [...children];
    }
    const sorted = [...items];
    switch (mode) {
        case 'title':
            sorted.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
            break;
        case 'position':
            sorted.sort((a, b) => entryValue(b, 'position') - entryValue(a, 'position'));
            break;
        case 'depth':
            sorted.sort((a, b) => entryValue(b, 'depth') - entryValue(a, 'depth'));
            break;
        case 'order':
            sorted.sort((a, b) => entryValue(b, 'order') - entryValue(a, 'order'));
            break;
        case 'trigger':
            sorted.sort((a, b) => entryValue(b, 'probability') - entryValue(a, 'probability'));
            break;
    }
    return [...sorted, ...folders];
}

function entryValue(node: TreeNode, field: 'position' | 'depth' | 'order' | 'probability'): number {
    if (node.kind !== 'entry') {
        return 0;
    }
    switch (field) {
        case 'position':
            return node.native.position;
        case 'depth':
            return node.native.depth;
        case 'order':
            return node.native.order;
        case 'probability':
            return node.native.probability;
    }
}

export function matchesSearch(node: TreeNode, query: string, scope: SearchScope): boolean {
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
            ? node.native.content
            : node.kind === 'image'
              ? node.caption
              : '';
    if (scope === 'prompt') {
        return prompt.toLowerCase().includes(needle);
    }
    return titleMatch || prompt.toLowerCase().includes(needle);
}

export function kindOfFilter(node: TreeNode): BrowseFilter {
    switch (node.kind) {
        case 'folder':
            return node.isWiRoot ? 'wiFolders' : 'folders';
        case 'entry':
            return 'entries';
        case 'image':
            return 'images';
    }
}

export function filterKindsFor(kinds: ReadonlySet<BrowseFilter>, children: readonly TreeNode[]): TreeNode[] {
    return children.filter((node) => kinds.has(kindOfFilter(node)));
}
