# Contracts — Workspace UI Prototype (002-workspace-ui-prototype)

The prototype exposes no public plugin API (interop hooks are out of scope this phase —
spec 002 Out of Scope; the future `wi-workspace:*` events remain as specified in
`specs/001-workspace-plugin-roadmap/contracts/contracts.md`). Contracts here govern the
prototype's internals and its composition with the host drawer.

## C1. Sample dataset schema

Module: `src/core/sample/dataset.ts`. Single exported typed constant; shape per
[data-model.md](../data-model.md):

```ts
interface SampleDataset {
    meta: { title: string; prototypeLabel: string };
    root: SampleFolderNode;   // kind discriminator: 'folder' | 'entry' | 'image'
}
interface SampleFolderNode {
    id: string; parentId: string | null; kind: 'folder'; name: string;
    isWiRoot: boolean;
    wiSettings: WiRootSettingsMock | null;   // non-null iff isWiRoot
    expanded: boolean; children: SampleNode[];
}
interface SampleEntryNode {
    id: string; parentId: string; kind: 'entry'; name: string;
    fields: NativeWorldInfoEntry;            // full native field set (src/global.d.ts)
    bookMemberships: string[];               // derived from enclosing WI roots
    contentLengthClass: 'normal' | 'long';
}
interface SampleImageNode {
    id: string; parentId: string; kind: 'image'; name: string;
    source: string;                          // prototype: SVG data URIs
    caption: string;
}
```

Contract tests (`tests/unit/sample-dataset.test.ts`, `sample-tree*.test.ts`,
`markdown.test.ts`, `diff.test.ts`) enforce: single root, parent resolution, no cycles,
FR-003 minimums (nesting ≥ 3, entries ≥ 10, images ≥ 2, WI roots ≥ 2, one nested),
full field coverage by `FIELD_SCHEMA`, intersection fixtures (multi-book entries),
wide/deep folders, SVG data URIs on images, ASCII-only content, and the behavior of
sort/filter/move/create/duplicate/delete helpers.

## C2. UI interaction contract

| Interaction | Response | Persistence |
|-------------|----------|-------------|
| Open via native WI entry point (`#WIDrawerIcon`, pin, programmatic opens) | Workspace surface shows (native `#wi-holder` hidden) | — |
| Close (header title click, outside click, other drawer opens) | Host drawer closes normally; state resets | none (FR-009) |
| Folder chevron/folder-icon click | Expand/collapse (separate translucent toggle button) | In-memory only |
| Node name click | Selection; editor swaps views; on mobile opens the editor sheet | In-memory only |
| Tree toolbar | Sort (custom/title/position/depth/order/trigger), kind filters, title/prompt/title+prompt search | Sort mutates dataset order; filters UI-only |
| Drag-and-drop | Move between folders; reorder within a folder in custom mode (insert-before-target) | In-memory only |
| Create buttons | New folder/entry/image in the selected folder (or parent of selection/root) | In-memory only |
| Entry header | Disable toggle (icon), title edit, duplicate (fresh uid, name + "(copy)"), delete (confirm) | In-memory only |
| Folder view | WI-mode toggle (live badges + membership recompute), per-root settings grid | In-memory only |
| Content section | Textarea + live markdown preview; draggable split (PC), stacked + preview toggle (mobile) | In-memory only |
| Assistant toggle | Panel/sheet shows/hides; scripted conversation with per-item decisions and diff modal | In-memory only |
| Mobile sheet bar | Drag to resize with snap sizes peek/half/tall/full; drag down > threshold closes | none |
| Review-guide toggle | Built-in checklist overlay (FR-010) | none |

Selection model: single selection; default on first open: first entry under the first WI
root.

## C3. Shell (entry-point replacement) contract

Module: `src/adapters/shell.ts` — the ONLY module allowed to compose with host DOM
(constitution II last-resort clause).

| Concern | Contract |
|---------|----------|
| Mount | Append a single `div.wiw-root` into `#WorldInfo` (host drawer-content); witness `data-wiw-mounted` guards double init |
| Fullscreen | Body class `wiw-active` added on init: CSS hides `#wi-holder`, stretches `#WorldInfo` (fullscreen editor surface), styles `.wiw-root` |
| Open/close detection | MutationObserver on `#WorldInfo` attributes `class` + `style` (host toggles `openDrawer`/`closedDrawer`; legacy inline `display:none` also handled) |
| Host interactions preserved | Native button, pin (`#WI_panel_pin`), outside-click autoclose, programmatic opens — untouched, no click interception, no host function patching, no direct host imports |
| Theming | Only via `--SmartTheme*` custom properties + host layout variables (`--topBarBlockSize`); zero fixed colors |
| Teardown | Page reload (host extension lifecycle); single `beforeunload` disconnects the observer |
| Failure mode | If `#WorldInfo` is missing (host markup changed): `console.warn` with a `[WorldInfoWorkspace]` prefix, extension degrades to no-op — no throw, no UI injection |

## C4. Review guide content (built-in checklist, spec FR-010)

The in-prototype guide walks the owner through, in order:

1. Open flow — the surface replaces the native editor; pin/autoclose/programmatic opens
   behave natively.
2. Tree — chevron/folder icon toggles, name selects; WI badges; intersection visibility
   via editor membership line; the wide Sandbox folder; long-name truncation.
3. Editor — Essentials/Content/Advanced organization, markdown preview with embedded
   images, drawer-style rows with info/question icons.
4. Folder WI toggle — enable/disable a folder as a World Info root and watch badges and
   memberships update live.
5. Assistant — batch proposals with per-item decisions; diff modal with highlighted
   removed/added parts.
6. Splitter — resize the tree/editor divider; collapse and restore the tree.

Decision (approve / iterate / discard) is recorded in the review conversation and the
spec checklist — the Phase 0 exit gate (spec SC-005). RECORDED: approve (2026-09-05).
