import {
    createDefaultState,
    createEntryNode,
    createFolderNode,
    createImageNode,
    type EntryNode,
    type FolderNode,
    type WorkspaceState,
} from '../../../src/core/state/schema';

/**
 * Small deterministic workspace for assistant tests: Aldermeer (WI root) →
 * Cities → Bristlemark + Bristlemark Taverns, plus Hearth & Home and one image.
 * Node ids are fixed so expectations can name them.
 */
export const NODE_IDS = {
    aldermeer: 'n-aldermeer',
    cities: 'n-cities',
    bristlemark: 'n-bristlemark',
    taverns: 'n-bristlemark-taverns',
    hearth: 'n-hearth',
    map: 'n-map',
} as const;

const NOW = '2026-09-15T12:00:00.000Z';

function folder(id: string, parentId: string, name: string): FolderNode {
    return createFolderNode({ id, parentId, name, now: NOW });
}

function entry(id: string, parentId: string, name: string, nativeUid: number): EntryNode {
    return createEntryNode({ id, parentId, name, now: NOW, nativeUid });
}

export function aldermeerState(): WorkspaceState {
    const state = createDefaultState();
    const root = state.root;
    const aldermeer = folder(NODE_IDS.aldermeer, root.id, 'Aldermeer');
    aldermeer.isWiRoot = true;
    aldermeer.book = { bookName: 'Aldermeer', orphans: [] };
    const cities = folder(NODE_IDS.cities, aldermeer.id, 'Cities');
    const bristlemark = entry(NODE_IDS.bristlemark, cities.id, 'Bristlemark', 1);
    bristlemark.native.key = ['bristlemark', 'harbor city'];
    bristlemark.native.content =
        'Capital of Aldermeer, built on the confluence of the Lira and the Ossen. ' +
        'The harbor district never sleeps. Sells charcoal.';
    bristlemark.native.position = 4;
    bristlemark.native.depth = 2;
    bristlemark.sync.books['Aldermeer'] = { uid: 1, hash: 'h1', status: 'in-sync' };
    const taverns = entry(NODE_IDS.taverns, cities.id, 'Bristlemark Taverns', 2);
    taverns.native.key = ['tavern', 'alehouse'];
    taverns.native.content = 'Three taverns share the harbor trade.';
    taverns.sync.books['Aldermeer'] = { uid: 2, hash: 'h2', status: 'in-sync' };
    cities.children.push(bristlemark, taverns);
    const hearth = folder(NODE_IDS.hearth, aldermeer.id, 'Hearth & Home');
    const map = createImageNode({ id: NODE_IDS.map, parentId: aldermeer.id, name: 'Aldermeer map', now: NOW });
    map.caption = 'Hand-drawn map of the river delta';
    aldermeer.children.push(cities, hearth, map);
    root.children.push(aldermeer);
    return state;
}

/** Handle map matching `aldermeerState()` as the context builder produces it. */
export const HANDLES: Record<string, string> = {
    f1: NODE_IDS.aldermeer,
    f2: NODE_IDS.cities,
    e1: NODE_IDS.bristlemark,
    e2: NODE_IDS.taverns,
    f3: NODE_IDS.hearth,
    i1: NODE_IDS.map,
};
