# Data Model: Stale-Tab Protection

## Saved (in `extensionSettings['WorldInfoWorkspace']`, additive)

### SaveMarker — top-level key `_save` (optional)

| Field | Type | Rule |
|---|---|---|
| `rev` | integer ≥ 1 | `max(seen.rev, saved.rev) + 1` on every save by this extension |
| `writer` | string | random id of the page load that saved (e.g. 8 hex chars) |
| `at` | ISO string | time of the save (informational only, never compared) |
| `hash` | string | content hash (research R3) of the payload being saved |

- Absent on payloads saved before this feature: treated as `rev 0`, not trustworthy.
- **Trustworthy** iff `contentHash(payload) === _save.hash`.
- Never part of the content hash; never shown to the user.
- `migrate` keeps it (valid payloads are returned by reference); a recovery fallback has
  none.

## In memory (per page load)

### SeenCopy

| Field | Meaning |
|---|---|
| `state` | the WorkspaceState last loaded from or saved to the server (immutable reference) |
| `hash` | its content hash |
| `marker` | its `_save` (or none) |

Set at startup (the loaded payload), after every successful guarded save, after a
silent load, and after either conflict choice.

### Local edits

`contentHash(store.getState()) !== seen.hash` **or** `hasPendingDrafts()`. Bookkeeping
(expand flags, `layout`, `sortMode`, sync status) never counts (FR-015).

### CheckResult

`unchanged | newer | older | conflict | failed` — classification table in research R2.
`newer` with local edits is handled as `conflict`.

### GateState

| State | Publishes / saves | Native pushes | UI |
|---|---|---|---|
| `open` | yes (guarded) | yes (after check) | — |
| `conflict` | no — namespace stays `seen.state` | held | conflict banner (FR-005, FR-016) |
| `recovery` (existing) | no | as today | recovery banner; a newer valid saved payload adds the conflict choice (FR-011) |

Transitions: `open → conflict` on a conflict result; `conflict → open` on "Use the saved
version" (load, `seen` = saved) or "Keep this version" (save with a new marker, `seen` =
this tab's state). A later check while in `conflict` refreshes the banner's lists.

### ConflictSummary (banner content)

`{ mine: string[], theirs: string[], mineMore: number, theirsMore: number }`. Each list
holds item names from `diffTree(seen.state, side)`, `changed/added/removed` labelled, at
most 10 per side. Settings changes appear as one line each ("Assistant settings",
"Lore picking settings").
