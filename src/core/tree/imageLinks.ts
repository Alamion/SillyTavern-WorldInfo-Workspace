import type { FolderNode, ImageNode, TreeNode } from '../state/schema';

/**
 * Resolves image references written in entry content to an image source (FR-010
 * preview). Accepted forms, so hand-written, Obsidian-style and legacy content all work:
 * - `img:<node id>` (legacy workspace reference)
 * - an image item name, with or without a file extension or folder path
 *   (`Aldermeer map sketch`, `Aldermeer map sketch.svg`, `Geography/Aldermeer map sketch.svg`)
 * - a direct source (`https://…`, `data:…`, `/user/images/…`, `user/images/…`)
 * Name lookups prefer the image closest to the entry: its own folder, then each ancestor.
 */

const DIRECT = /^(?:[a-z][a-z0-9+.-]*:|\/|user\/images\/)/i;

function normalizeName(value: string): string {
    return value.normalize('NFC').trim().toLocaleLowerCase();
}

function stripExtension(value: string): string {
    const at = value.lastIndexOf('.');
    return at > 0 ? value.slice(0, at) : value;
}

export function cleanReference(raw: string): string {
    let ref = raw.trim();
    if (ref.startsWith('<') && ref.endsWith('>')) {
        ref = ref.slice(1, -1).trim();
    }
    // Obsidian/CommonMark titles and size hints: `name "title"`, `name|300`.
    ref = ref.replace(/\s+"[^"]*"$/, '').replace(/\|[^|]*$/, '');
    try {
        ref = decodeURI(ref);
    } catch {
        // Not URI-encoded: keep as written.
    }
    return ref;
}

function findByName(scope: TreeNode, wanted: string): ImageNode | undefined {
    // Breadth-first, but with a read cursor instead of `queue.shift()`: shifting
    // an array is O(n), which made this O(n^2) over the scope — and it runs twice
    // per ancestor folder, inside the markdown preview render (spec 006 R8).
    // Traversal ORDER is unchanged, so which image wins is unchanged.
    const queue: TreeNode[] = [scope];
    for (let at = 0; at < queue.length; at += 1) {
        const node = queue[at];
        if (!node) {
            continue;
        }
        if (node.kind === 'image' && node.src !== '') {
            const name = normalizeName(node.name);
            if (name === wanted || normalizeName(stripExtension(node.name)) === wanted) {
                return node;
            }
        } else if (node.kind === 'folder') {
            // Push one by one: spreading a large children array can overflow the
            // argument limit.
            for (const child of node.children) {
                queue.push(child);
            }
        }
    }
    return undefined;
}

export function resolveImageReference(
    root: FolderNode,
    index: ReadonlyMap<string, TreeNode>,
    fromNodeId: string | null,
    rawRef: string
): string | undefined {
    const ref = cleanReference(rawRef);
    if (ref === '') {
        return undefined;
    }
    if (ref.startsWith('img:')) {
        const node = index.get(ref.slice(4));
        return node?.kind === 'image' && node.src !== '' ? node.src : undefined;
    }
    if (DIRECT.test(ref)) {
        return ref;
    }
    const last = ref.split('/').pop() ?? ref;
    const candidates = [normalizeName(last), normalizeName(stripExtension(last))];
    let cursor: TreeNode | undefined = fromNodeId !== null ? index.get(fromNodeId) : undefined;
    const scopes: TreeNode[] = [];
    while (cursor) {
        if (cursor.kind === 'folder') {
            scopes.push(cursor);
        }
        cursor = cursor.parentId !== null ? index.get(cursor.parentId) : undefined;
    }
    if (scopes[scopes.length - 1] !== root) {
        scopes.push(root);
    }
    for (const scope of scopes) {
        for (const wanted of candidates) {
            const found = findByName(scope, wanted);
            if (found) {
                return found.src;
            }
        }
    }
    return undefined;
}
