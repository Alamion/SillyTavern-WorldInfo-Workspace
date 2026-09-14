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
  the default empty workspace (v1) plus a user-visible warning (never silent data loss:
  the raw payload is kept under `WorldInfoWorkspace._recovered` for one session).
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