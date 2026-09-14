# Data Model — Core Workspace MVP (003-core-workspace-mvp)

Persisted shapes for the workspace's own state and its mapping onto the native World
Info format. Native field inventory: `specs/001-workspace-plugin-roadmap/research.md`
R1 (verified in this feature's research R1). Naming uses the
`extensionSettings['WorldInfoWorkspace']` namespace; the exact JSON contract lives in
[contracts/persistence-schema.md](./contracts/persistence-schema.md), the app-API usage
contract in [contracts/native-wi-contract.md](./contracts/native-wi-contract.md).

## Entities

### WorkspaceState (root container)

| Field | Type | Notes |
|-------|------|-------|
| `version` | `1` | Schema version; migrations run on load |
| `root` | `FolderNode` | Synthetic root of the whole tree (not rendered as an item) |
| `settings` | `WorkspaceSettings` | User preferences |

### WorkspaceSettings

| Field | Type | Notes |
|-------|------|-------|
| `sortMode` | `'custom' \| 'title' \| 'position' \| 'depth' \| 'order' \| 'trigger'` | Toolbar sort default; `custom` = real persisted child order |

Kind filters and search text are ephemeral UI state (not persisted).

### NodeBase (common fields)

| Field | Type | Notes |
|-------|------|-------|
| `id` | string (uuid) | Stable across moves/renames; unique workspace-wide |
| `parentId` | string \| null | `null` only for the synthetic root |
| `name` | string | Required non-empty after trim; duplicates allowed, surfaced by validation |
| `createdAt` / `updatedAt` | ISO timestamp | Audit; `updatedAt` bumps on any content change |

### FolderNode (`kind: 'folder'`)

| Field | Type | Notes |
|-------|------|-------|
| `expanded` | boolean | Persisted (FR-006) |
| `isWiRoot` | boolean | World Info designation (FR-012); multiple + nested allowed |
| `book` | `BookBinding \| null` | Set iff `isWiRoot` (FR-023) |
| `children` | `TreeNode[]` | Ordered; order is the persisted custom order |

### BookBinding

| Field | Type | Notes |
|-------|------|-------|
| `bookName` | string | The **actual** native book name — assigned once via the collision-resolved flow, treated as an opaque handle afterwards (FR-023); never auto-follows folder renames |
| `orphans` | `OrphanedEntry[]` | Native entries retained in the book whose workspace entities moved out from under this root (FR-018); empty after resolution |

### OrphanedEntry

| Field | Type | Notes |
|-------|------|-------|
| `uid` | number | The slot the entity occupies in this book |
| `name` | string | Display name (from `comment`) for the resolution UI |

### EntryNode (`kind: 'entry'`)

| Field | Type | Notes |
|-------|------|-------|
| `native` | `NativeWiEntry` | Full native field set verbatim (001 research R1); `native.uid` MUST equal `sync.uid`; `extensions` passthrough preserved |
| `sync` | `SyncState` | Export bookkeeping |

Node `name` and `native.comment` are one value (native memo is the title, per the
approved editor); on import, a missing `comment` falls back to the first key, then
`Entry <uid>`.

### ImageNode (`kind: 'image'`)

| Field | Type | Notes |
|-------|------|-------|
| `src` | string | Image source (URL or data URI) |
| `caption` | string | Free-form caption |

### SyncState (per exported entity — entry or image)

| Field | Type | Notes |
|-------|------|-------|
| `bookName` | string \| null | Book this entity currently exports into (derived from its enclosing root) |
| `uid` | number \| null | Slot in that book; stable once assigned (0..999,999 pool) |
| `status` | `'new' \| 'in-sync' \| 'dirty' \| 'orphaned'` | `new` = never exported; `dirty` = edited since last export; `orphaned` = moved out from under its root while its native counterpart exists (FR-018) |
| `lastExportedHash` | string \| null | Fingerprint (research R6) of the entry as last written |
| `lastExportedAt` | ISO timestamp \| null | |
| `nativeDrift` | boolean | A native entry occupying this entity's slot no longer matches `lastExportedHash` (detected via `WORLDINFO_UPDATED` or at sync/import time) — feeds the divergence banner |

For `EntryNode`, `sync.uid` and `native.uid` must stay equal (validation invariant).

### Derived image entry (export form, research R7)

`{ uid: sync.uid, comment: name, content: "![caption](src)", …native template defaults,
extensions: { wiw: { v: 1, kind: 'image', src, caption } } }`

## Relationships

```text
WorkspaceState 1—1 FolderNode (root; children hold the whole tree)
FolderNode 1—* TreeNode (arbitrary depth; custom order)
FolderNode(root) 1—0..1 BookBinding — only when isWiRoot
EntryNode/ImageNode 1—1 SyncState — drives push, orphans, divergence
BookBinding 1—* OrphanedEntry — native entries retained pending user resolution
Workspace 1—* native book (one per designated root; entries under a nested root
           appear in both books — world intersection by design)
```

## Validation rules (surfaced, never silently reset — FR-010/FR-011)

- `name` non-empty after trim (all node kinds); duplicates allowed but flagged.
- `probability` 0–100; `order` numeric; `position` 0–7 with `outletName` required
  non-empty when `position = 7 (outlet)`; `role` 0–2; `selectiveLogic` 0–3; `depth ≥ 0`;
  timed effects (`sticky`/`cooldown`/`delay`) ≥ 0 or null; `triggers` ⊆ generation
  trigger types; `groupWeight` 0–100.
- `sync.uid` (entry) === `native.uid`; `uid` within 0..999,999 and unique per book.
- An entity with rule violations is excluded from publish/flatten with a visible reason
  (not silently coerced).

## State transitions

**SyncState.status**

```text
new ──(successful export)──▶ in-sync
in-sync ──(workspace edit)──▶ dirty
dirty ──(successful export)──▶ in-sync
in-sync|dirty ──(moved out from under its root, native copy exists)──▶ orphaned
             (recorded in the root's BookBinding.orphans)
orphaned ──(user: remove from book)──▶ new        (binding/orphan row cleared)
orphaned ──(user: restore under the root)──▶ dirty
```

**Book lifecycle (FR-013/FR-019/FR-022/FR-023)**

```text
designation ON  ──▶ resolve free name → create empty book → bind (INACTIVE)
push            ──▶ flatten subtree → save entries (orphans retained, guarded)
designation OFF ──▶ release binding (book file remains; stays in the all-books list)
root delete     ──▶ confirm → keep book (release binding) | delete book (endpoint)
book rename     ──▶ create-with-copy (collision-resolved) → rebind → delete old
import unbound  ──▶ create folder → designate root bound to the imported book
                    (activation state untouched) → map entries losslessly
```

**Divergence handling (FR-015, never silent in either direction)**

```text
WORLDINFO_UPDATED(book):  fingerprint mismatch vs lastExportedHash → nativeDrift=true
push:                     nativeDrift or foreign entries → automatic push BLOCKED,
                          per-book divergence banner: adopt native (import-merge) |
                          push anyway | per-entry resolution
import into bound root:   dirty cards + drifted natives → per-entry resolution
                          (keep workspace | take native) before any overwrite
```

## Sync semantics

- Workspace is authoritative: edits mark entities (and their book) dirty; push writes
  the flattened `{ entries }` payload via `saveWorldInfo` (debounced 1000 ms; flushed
  with `immediately` on `GENERATION_STARTED` and panel close).
- `uid` is assigned from the book's free pool when absent/colliding and then kept stable
  per entity (never churned across syncs) — this is the import/export identity key.
- `displayIndex` is written sequentially in workspace child order at export.
- Deletion (FR-021): the confirm dialog discloses native removal; the next push omits
  the entity — no second prompt.
- Objects handed to `saveWorldInfo` are never mutated afterwards (hand over clones);
  the workspace never calls `loadWorldInfo` for a name absent from the current
  `getWorldInfoNames()` list (cache cannot be evicted externally — research R3).
- All workspace mutations save settings via `saveSettingsDebounced`; book pushes flush
  immediately on `GENERATION_STARTED` and panel close.