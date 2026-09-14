# Contract: Workspace Persistence Schema (v1)

What the extension persists under `extensionSettings['WorldInfoWorkspace']` inside the
app's `settings.json` (written by `saveSettingsDebounced`, 1000 ms, whole-payload
`POST /api/settings/save`). This is the contract between the store module, migration
code, and any future tooling that inspects saved state.

## JSON shape (version 1)

```jsonc
{
  "version": 1,
  "root": {
    "id": "<uuid>",
    "parentId": null,
    "kind": "folder",
    "name": "Workspace",
    "createdAt": "<ISO>",
    "updatedAt": "<ISO>",
    "expanded": true,
    "isWiRoot": false,
    "book": null,
    "children": [ /* FolderNode | EntryNode | ImageNode */ ]
  },
  "settings": { "sortMode": "custom" }
}
```

FolderNode (non-root): `parentId` = parent id; `book` set iff `isWiRoot`:

```jsonc
{
  "id": "<uuid>", "parentId": "<uuid>", "kind": "folder", "name": "Aldermeer",
  "createdAt": "<ISO>", "updatedAt": "<ISO>",
  "expanded": false, "isWiRoot": true,
  "book": {
    "bookName": "Aldermeer",           // actual native name, opaque handle
    "orphans": [ { "uid": 42, "name": "Old Roads" } ]
  },
  "children": [ /* … */ ]
}
```

EntryNode (sync state v2 — PER BOOK, nested WI lives in several books at once):

```jsonc
{
  "id": "<uuid>", "parentId": "<uuid>", "kind": "entry", "name": "Riverborn",
  "createdAt": "<ISO>", "updatedAt": "<ISO>",
  "native": { /* full NativeWiEntry, 001 research R1 */ },
  "sync": {
    "books": {
      "Aldermeer": { "uid": 7, "hash": "<fnv1a-hex>", "status": "in-sync" },
      "Region":    { "uid": 0, "hash": "<fnv1a-hex>", "status": "dirty" }
    }
  }
}
```

ImageNode: workspace-only — no book binding, no sync books (never exported).

ImageNode:

```jsonc
{
  "id": "<uuid>", "parentId": "<uuid>", "kind": "image", "name": "Map of Aldermeer",
  "createdAt": "<ISO>", "updatedAt": "<ISO>",
  "src": "https://…|data:image/…", "caption": "The Verdant Span",
  "sync": { /* same shape */ }
}
```

## Invariants (enforced by schema validation + migration)

1. `id` unique workspace-wide; `parentId` refers to an existing folder; no cycles
   (parent chain is acyclic by construction — moves validate).
2. `book` is non-null iff `isWiRoot`; `book.bookName` never auto-follows folder renames.
3. `book.bookName` values are unique across the workspace (at most one binding per book).
4. For every book in `sync.books`, `bookSync.uid === native.uid` (or null before
   the first export); uids within 0..999,999 and unique per book.
5. `name` non-empty after trim on every node.
6. `children` arrays preserve custom order; `orphans.uid` values reference slots that
   still exist in the bound book (revalidated against `getWorldInfoNames()`/book loads).
7. Unknown future keys inside the namespace MUST be preserved on load/save (forward
   compatibility).

## Migration policy

- `migrate(raw: unknown): WorkspaceState` — pure function; unknown/invalid input yields
  the default empty workspace (v1) plus a user-visible warning (never silent data loss).
- Recovery safety (amended 2026-09-14, cross-device wipe): on recovery the raw payload
  stays untouched in the namespace until the first workspace mutation — the empty
  fallback is NOT published before that, so an app-wide settings save cannot persist
  it (settings are shared across devices; a stale bundle on one device must not wipe
  the others). On the first mutation the fallback is persisted with the raw payload
  under `WorldInfoWorkspace._recovered`.
- `_recovered` is a durable backup: a valid payload carrying it keeps it on load. It
  is removed only by an explicit user action — Restore (replaces the workspace when
  the backup now validates; kept when still invalid) or Discard backup (confirmed).
  The load-time warning fires only for a recovery of the current load, never for a
  carried backup (a persistent banner offers Restore/Discard instead).
- `parentId` is derived data: on load it is rewritten from the nesting (root → `null`,
  child → its containing folder's id). A stale link is never a recovery cause
  (amended 2026-09-14: the demo seed grafted children still pointing at its own root).
- Version bumps are additive: `v(n) → v(n+1)` steps applied in order.
- Sync-state v2 (2026-09-08): per-book `sync.books` replaces the single
  bookName/uid/status pair; persisted legacy shapes are normalized on load
  (single-book state → one books entry).

## Size and lifecycle notes

- Saved inside the app's whole-settings payload; no enforced size limit (research R1);
  expected magnitudes (hundreds of entries) are far below practical limits.
- Saved debounced (1000 ms) after every mutation; a hard crash within the debounce
  window can lose ≤1 s of tree edits (books are flushed more aggressively — see the
  native contract). Documented, accepted trade-off.