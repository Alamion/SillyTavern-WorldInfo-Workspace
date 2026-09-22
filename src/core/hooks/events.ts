import type { NodeKind } from '../state/schema';

/**
 * The public `wi-workspace:*` event surface (constitution VII, spec 006
 * contracts/hooks.md).
 *
 * Until now these payloads existed only as prose in `AGENTS.md` — nothing in the
 * codebase declared their shape, which is the FR-008 gap this module closes.
 * `docs/hooks.md` and `tests/contract/hooks.test.ts` are kept in step with it.
 *
 * ADDITIVE ONLY: no existing event name or payload field may be removed or
 * repurposed. A breaking change here is a MAJOR version event for the plugin.
 */

export const WI_EVENTS = {
    treeChanged: 'wi-workspace:tree-changed',
    bookPushed: 'wi-workspace:book-pushed',
    rootChanged: 'wi-workspace:root-changed',
    workspaceShown: 'wi-workspace:workspace-shown',
    workspaceHidden: 'wi-workspace:workspace-hidden',
    // Delivered by specs 004 and 005; listed so the documented surface is complete.
    mdLinkChanged: 'wi-workspace:md-link-changed',
    mdSynced: 'wi-workspace:md-synced',
    assistantApplied: 'wi-workspace:assistant-applied',
    assistantUndone: 'wi-workspace:assistant-undone',
} as const;

export type WiEventName = (typeof WI_EVENTS)[keyof typeof WI_EVENTS];

/**
 * How a consumer identifies an item. Ids are uuids that survive renames and
 * moves; `bookName` is the opaque, collision-resolved native book handle that
 * folder renames never change (roadmap FR-023, spec 001).
 *
 * Deliberately no filesystem path: nodes have none, and the markdown-relative
 * paths that exist belong to the link baseline, not to the tree.
 */
export interface NodeRef {
    nodeId: string;
    kind: NodeKind;
    name: string;
    parentId: string | null;
    /** Nearest enclosing World Info root's book, or null. */
    bookName: string | null;
}

export type TreeChangeKind = 'create' | 'delete' | 'move' | 'rename' | 'update';

export interface TreeChange {
    change: TreeChangeKind;
    node: NodeRef;
}

export interface TreeChangedPayload {
    changes: TreeChange[];
}

export type BookPushOutcome =
    | 'success'
    | 'save-failed'
    | 'conflict-blocked'
    | 'validation-blocked'
    | 'book-missing';

export interface BookPushedPayload {
    bookName: string;
    /** The designated World Info root folder's id. */
    rootId: string;
    outcome: BookPushOutcome;
    /** Entries written; success only. */
    exported?: number;
    skipped?: Array<{ nodeId: string; reason: string }>;
    /** Human-readable; failure and blocked outcomes only. */
    reason?: string;
}

export type RootChangeAction =
    | 'designated'
    | 'undesignated'
    | 'book-renamed'
    | 'book-deleted'
    | 'imported';

export interface RootChangedPayload {
    folderId: string;
    folderName: string;
    /** null after 'undesignated'. */
    bookName: string | null;
    action: RootChangeAction;
}

export interface WorkspaceVisibilityPayload {
    mode: 'workspace' | 'native';
}
