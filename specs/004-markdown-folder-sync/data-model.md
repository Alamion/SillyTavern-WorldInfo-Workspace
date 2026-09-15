# Data Model — Markdown Folder Sync (004-markdown-folder-sync)

Builds on the Phase 1 model (`specs/003-core-workspace-mvp/data-model.md`). The file
format is specified in [contracts/markdown-convention.md](./contracts/markdown-convention.md);
this document covers in-memory and persisted structures.

## Changes to persisted workspace state (`extensionSettings['WorldInfoWorkspace']`)

Additive, optional fields — schema stays `version: 1` (`migrate` already preserves
unknown keys; older bundles ignore them).

### NodeBase + `md?: NodeMarkdownExtras`

| Field | Type | Notes |
|-------|------|-------|
| `foreign` | `Record<string, unknown>` | Front matter / folder-record keys not owned by the convention, in original order (FR-005). Omitted when empty |
| `unknownOwned` | `Record<string, unknown>` | Unrecognized `wi_*` keys, preserved and reported (FR-005) |
| `rawOnParseError` | `boolean` | Entry imported from malformed YAML; its file is not rewritten until the entry is edited |

Native fields read from `wi_native` go straight into `EntryNode.native` (no separate
extras field). Nothing link-specific (paths, hashes, handles) is stored in workspace state.

### ImageNode `src` (meaning extended, shape unchanged)

`src` may now be an app image-storage path `user/images/WorldInfoWorkspace/<file>`
(owned by the workspace; deleted when the last referencing item is deleted), besides the
Phase 1 forms (`data:` URI, external URL). Research R6.

## Link storage (IndexedDB `WorldInfoWorkspace-md`, store `links`, key `default`)

### StoredLink

| Field | Type | Notes |
|-------|------|-------|
| `formatVersion` | `1` | Convention version the baseline was produced with |
| `handle` | `FileSystemDirectoryHandle` | Structured-cloned directory handle |
| `folderName` | string | Display name (`handle.name`) |
| `workspaceRootId` | string | Workspace root id at link time; mismatch (workspace replaced/restored) → treated as a new link (reconcile without baseline, R9) |
| `linkedAt` | ISO timestamp | |
| `lastSyncAt` | ISO timestamp \| null | Last completed pull |
| `baseline` | `Record<string, BaselineItem>` | Keyed by item id |

### BaselineItem

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Workspace node id (ids are not written into files; identity is matched by optional `wi_id`, path, then content hash — research R7) |
| `kind` | `'folder' \| 'entry' \| 'image'` | |
| `path` | RelPath | Entry: the `.md` file; image: the image file (or `null` for URL-only images); folder: the directory (its record is `<path>/.wiw-folder.yaml`) |
| `wsHash` | string | SHA-256 of the canonical rendering from the workspace side (entry file text; image bytes + record slice; folder record text) |
| `diskHash` | string | SHA-256 of what was last read from / written to disk for this item |

Invariant: after a completed pull or push step for an item, `wsHash === hash(render(ws))`
and `diskHash === hash(disk bytes)`; if the two sides are equal, the item is in sync.

## In-memory structures (pure, `src/core/md/`)

### ScannedItem (result of reading the folder)

`{ id: string | null, kind, path, parentPath, name, diskHash, parsed }` where `parsed` is
an `EntryFileModel` (native field values, title, content, extras, parse warnings), an
`ImageFileModel` (bytes/MIME, record metadata), or a `FolderRecordModel` (title,
designation, book name, order, image records, extras).

### ReconcileResult (result of `reconcile({ ws, disk, baseline })`, `core/md/reconcile.ts`)

Workspace→disk writes are not listed: the push step derives them from the baseline.

| Field | Type | Notes |
|-------|------|-------|
| `matches` | `Map<id, { path, via: 'wi_id' \| 'path' \| 'folder-move' \| 'content-move' }>` | How each workspace item was matched to a disk item |
| `toWorkspace` | `WorkspaceChange[]` | `create` / `update` / `move` (disk → workspace), applied by `applyPull.ts` |
| `pendingDeletions` | `{ id, path, kind }[]` | Deleted on disk, unchanged in the workspace: confirmation required (FR-014) |
| `conflicts` | `Conflict[]` | Both sides changed, changed vs deleted, or different moves (R7 table) |
| `adopt` | `{ id, path, kind }[]` | Equal pairs without a (current) baseline: recorded as in sync |
| `warnings` | `{ path, message }[]` | Ignored `wi_id` hints etc. |

### Conflict

`{ id, kind, path, workspace: 'edited' | 'deleted' | 'moved' | 'created', disk: same }`;
the UI view adds `key`, `name`, `workspaceText`, `diskText` → decision
`'keep-workspace' | 'keep-disk' | 'skip'`.

### OperationReport

`{ operation: 'import' | 'export' | 'sync' | 'link', startedAt, finishedAt, counts: {
created, updated, moved, deleted, skipped, preserved, conflicts, warnings }, lines:
ReportLine[] }`, `ReportLine = { path, outcome, message? }`. The last report is kept in
memory (not persisted).

## State transitions

**Link lifecycle**

```text
none ──Link folder… (pick, readwrite)──▶ reconciling ──confirm/resolve──▶ linked
linked ──open workspace──▶ query access
    granted ──▶ pull
    prompt  ──▶ request within click activation ── granted ──▶ pull
                                                 └─ otherwise ──▶ needs-reconnect
    denied / handle error ──▶ unavailable
needs-reconnect ──Reconnect click──▶ granted ──▶ pull
unavailable ──Re-link…──▶ reconciling (no baseline)   |   ──Unlink──▶ none
linked ──Unlink──▶ none (IndexedDB record deleted; files and workspace untouched)
```

**Per-item sync state (derived, not stored)**

```text
in-sync       wsHash==render(ws) && diskHash==hash(disk)
ws-changed    workspace render differs, disk unchanged   → auto-push (debounced)
disk-changed  disk differs, workspace unchanged          → applied on next pull
held-back     ws-changed but disk changed since baseline → conflict at next Sync
conflict      both changed / changed vs deleted          → user decision
```

## Validation rules

- An optional `wi_id` is honored only when it names exactly one existing item and is
  not duplicated in the scan; otherwise it is ignored (warning) and matching continues
  by path/content (R7). Ids are never written into files.
- A folder record is rendered only when it has non-default content (FR-023); a record
  that would render empty is removed if it carries no foreign keys.
- Relative paths never contain `..`, empty segments, or a leading `/` (port rule 5).
- Native field values from files go through the Phase 1 validation
  (`core/tree/validation.ts`); invalid values are kept and publish-blocked with a visible
  reason, never coerced (spec FR-009).
- Imported WI root designations: book name conflicts resolve through the Phase 1
  adopt-or-create and collision flows; books are never auto-activated.
