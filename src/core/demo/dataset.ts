import type { TreeNode } from '../state/schema';
import {
    createDefaultState,
    createEntryNode,
    createFolderNode,
    createImageNode,
    type WorkspaceState,
} from '../state/schema';
import { SAMPLE_DATASET, type SampleNode } from './sampleDataset';

/**
 * 'Aldermeer' demo seed (FR-001, research R9): a valid WorkspaceState derived
 * from the approved Phase 0 sample content — WITHOUT any World Info designations
 * or sync bindings (the user opts into sync by designating a root themselves).
 */
export function createDemoState(newId: () => string): WorkspaceState {
    // The fixed root id: the seed is grafted into the live workspace root, and
    // its top-level children must already point at it.
    const state = createDefaultState();
    state.root.name = SAMPLE_DATASET.meta.title;
    let uidSeed = 400;
    const convert = (node: SampleNode, parentId: string): TreeNode => {
        const id = newId();
        const now = new Date().toISOString();
        switch (node.kind) {
            case 'folder': {
                const folder = createFolderNode({
                    id,
                    parentId,
                    name: node.name,
                    now,
                });
                folder.expanded = node.expanded;
                folder.children = node.children.map((child) => convert(child, id));
                return folder;
            }
            case 'entry': {
                uidSeed += 1;
                const entry = createEntryNode({
                    id,
                    parentId,
                    name: node.name,
                    now,
                    nativeUid: uidSeed,
                });
                entry.native = structuredClone(node.fields);
                entry.native.uid = uidSeed;
                entry.native.comment = node.name;
                return entry;
            }
            case 'image': {
                const image = createImageNode({ id, parentId, name: node.name, now });
                image.src = node.source;
                image.caption = node.caption;
                return image;
            }
        }
    };
    state.root.children = SAMPLE_DATASET.root.children.map((child) => convert(child, state.root.id));
    // Sample content references images by sample id (`img:img-map`), but ids are
    // regenerated above: rewrite them to name references, which survive new ids and
    // markdown export.
    const imageNames = new Map<string, string>();
    const collect = (node: SampleNode): void => {
        if (node.kind === 'image') {
            imageNames.set(node.id, node.name);
        } else if (node.kind === 'folder') {
            node.children.forEach(collect);
        }
    };
    SAMPLE_DATASET.root.children.forEach(collect);
    const rewrite = (node: TreeNode): void => {
        if (node.kind === 'entry') {
            node.native.content = node.native.content.replace(/\(img:([^)\s]+)\)/g, (match, id: string) => {
                const name = imageNames.get(id);
                return name === undefined ? match : `(<${name}>)`;
            });
        } else if (node.kind === 'folder') {
            node.children.forEach(rewrite);
        }
    };
    state.root.children.forEach(rewrite);
    return state;
}