# Research: Stale-Tab Protection

Decisions for spec 008. Facts were checked against the vendored app source
(`context/SillyTavern/`) and the running server on 2026-10-09.

## R1 — Where the saved workspace can be read

- **Decision**: `POST /api/settings/get` with `getRequestHeaders()`; parse
  `response.settings` (a JSON string) and read `extension_settings.WorldInfoWorkspace`.
- **Rationale**: it is the only app endpoint that returns the saved `settings.json`; the
  server reads the file on every call, so it reflects the latest write by any tab.
  Measured on `dev`: 430 KB response (workspace ≈106 KB of it), 7–12 ms locally. At a
  1000-entry workspace (~1–2 MB) and one check per 2 minutes plus focus/visibility events,
  the cost is acceptable (FR-003 assumption confirmed).
- **Alternatives**: a server plugin returning only the namespace (would need installing a
  plugin — out of scope); reading `settings.json` as a static file (not served);
  BroadcastChannel (option 2, excluded by the owner).

## R2 — The save marker and how ages are compared

- **Decision**: a top-level key `_save` in the namespace:
  `{ rev: number, writer: string, at: string, hash: string }`.
  - `rev` grows by one with every save this extension makes (`max(seen, server) + 1`).
  - `writer` is a random id per page load.
  - `hash` is the content hash (R3) of the saved payload at save time.
- **Trustworthy marker**: `hash(content of the saved payload) === _save.hash`. Only then
  is `rev` used to decide newer/older. Otherwise the payload was written by something that
  did not update the marker (an earlier extension version — `migrate` returns a valid
  payload by reference, so unknown top-level keys survive and the OLD marker is carried
  along with NEW content) → unknown age → conflict banner (FR-008, FR-009).
- **Classification** (against the tab's last seen copy `seen`):

  | Saved content vs `seen` | Marker | Result |
  |---|---|---|
  | same hash | any | unchanged (adopt the saved marker silently) |
  | differs | trustworthy, `rev > seen.rev` | newer elsewhere |
  | differs | trustworthy, `rev < seen.rev` | older elsewhere (stale overwrite) |
  | differs | trustworthy, `rev == seen.rev` | conflict (two writers from one base) |
  | differs | missing or not trustworthy | conflict (unknown age) |

- **Rationale**: a revision counter alone cannot tell a stale overwrite from an
  old-version tab with genuine new edits; the content hash in the marker can.
- **Alternatives**: timestamps (clock skew between devices); a hash chain (no benefit for
  two-party comparisons); server-side revisions (needs a server plugin).

## R3 — Content vs bookkeeping

- **Decision**: content hash = FNV-1a (`core/sync/fingerprint.ts`) over `stableStringify`
  of a projection of the state WITHOUT: `_save`, `_recovered`, folder `expanded`,
  `settings.layout`, `settings.sortMode`, and per-entity sync bookkeeping
  (`sync.books[*].status/hash/uid`, root `book.tombstones`), and native `uid` copies.
  Everything else — tree shape, names, entries, images, folder records, assistant and
  picking settings, context sets — is content (clarification 2026-10-09, FR-015).
- **Why sync bookkeeping is excluded**: another tab's successful native push rewrites
  sync status/hashes without any content change; treating it as content would raise false
  conflicts.
- **Cost**: computed only at check time and at own saves, not per keystroke. For a
  1–2 MB workspace a stringify + FNV pass is tens of milliseconds; memoized per state
  object (the store is immutable, path-copied).

## R4 — Holding back saves and pushes

- **Decision**: a single **save gate** in `settingsStore.ts`.
  - Today every store change publishes the state into the namespace and calls
    `saveSettingsDebounced()`. Instead, a store change marks the tab dirty and schedules
    a **guarded save** (debounce 1000 ms): run a check (R1), then act on the result —
    unchanged/older → publish + save (with a new marker); newer + no local content edits
    → load; conflict or newer with edits → open the conflict state and publish nothing.
  - While the conflict state is open, the namespace keeps pointing at the last seen copy,
    so even the app's own unrelated saves write the last seen copy, not this tab's
    unconfirmed edits (same idea as the recovery no-publish rule).
  - The **native book push** (`syncEngine.ts`) awaits the same gate before writing:
    without it, a stale tab could push its unconfirmed edits into the books, and "Use the
    saved version" would later pull them back in through the clean-side merge.
- **Rationale**: one place decides whether this tab may publish; native pushes and
  settings saves cannot disagree.
- **Alternatives**: checking only in the app's `SETTINGS_UPDATED` event (fires after the
  save — too late); wrapping `saveSettingsDebounced` (would affect every extension).

## R5 — Loading a newer workspace

- **Decision**:
  1. `migrate` the saved payload.
  2. Copy the tab's bookkeeping onto it — expand flags by node id, `layout`, `sortMode`.
  3. `store.replace` it; set it as `seen`.
  4. Publish it, but do NOT save: it is already what the server holds.
- **Side effects**: the store-level diff emits `wi-workspace:tree-changed` as for any
  other change (FR-012, no new hook). The sync engine sees entities whose sync status
  came from the other tab's pushes (in-sync), so nothing is pushed (FR-010). The markdown
  link sees workspace changes and pushes them to disk by its usual rules. Assistant
  conversations and drafts live in IndexedDB/sessionStorage and are untouched.
- **Uncommitted field drafts** count as local edits (`draftRegistry.hasPendingDrafts()`),
  so a silent load never drops typed text (spec edge case).

## R6 — When checks run

- **Decision**:
  - `visibilitychange` → visible, and `window` `focus`;
  - `wi-workspace:workspace-shown` (internal shell callback);
  - before each guarded save (R4) and native push;
  - a 2-minute interval that runs only while `document.visibilityState === 'visible'`
    (clarification 2026-10-09).
  - One check at a time; a result younger than 3 s is reused.
- **Failure**: a failed fetch decides nothing (FR-013); a guarded save retries once and
  then saves as today (an unreachable server fails the save anyway).

## R7 — The conflict banner

- **Decision**: a banner in the shared banner style, in the workspace region:
  - "The workspace was changed in another tab or device." plus two lists from
    `core/hooks/treeDiff.diffTree`: `seen → this tab` and `seen → saved`, by item name,
    10 per side + "and N more" (FR-016). Changes to assistant/picking settings appear as
    one line "Assistant settings" / "Lore picking settings" (diffTree ignores settings).
  - Buttons "Use the saved version" (discards: the first list) and "Keep this version"
    (overwrites: the second list).
  - Recovery pending (FR-011): the same banner, with "Use the saved version" as the way
    out of recovery.
- **Notices** (toasts): silent load → "Updated with changes made in another tab or
  device."; restore → "Restored the newer workspace from this tab; another tab had saved
  an older copy."

## R8 — What stays unprotected

- An extension cannot stop the app from saving the namespace of a stale tab for unrelated
  reasons. Such a save is repaired by the newest open tab at its next check (FR-007). If
  no newer tab is open, it is lost from the workspace; the native books still hold
  everything that was pushed. The README states this (FR-014).
