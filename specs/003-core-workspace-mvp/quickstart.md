# Quickstart — Core Workspace MVP Validation (003-core-workspace-mvp)

End-to-end validation of the Phase 1 acceptance scenarios. Each scenario maps to spec
success criteria; run them in order in a running SillyTavern instance.

## Prerequisites

```bash
pnpm install
pnpm run build        # production bundle → dist/index.js (tracked; manifest points here)
pnpm run test         # Vitest unit + contract suites
pnpm run typecheck && pnpm run lint
```

Install into the app: extension installer → this repo (manifest.json), or copy the repo
folder into `data/<user>/extensions/`; enable the extension and reload the app. Native
book files land in `data/<user-handle>/worlds/` (inspect to verify sync output).

## Scenarios

**S1 — Empty state & demo seed (FR-001, SC-006)** — Open the World Info entry point →
the workspace opens with an empty-state guide → "Load demo data" seeds the 'Aldermeer'
tree (folders/entries/images, **no** WI designations, no native book files created).
Expected: tree browsable, nothing under `worlds/` yet; deleting demo items works.

**S2 — Build the tree (US1, FR-002..006)**: create folders 3+ levels deep, entries and
images inside them; rename, drag-move, move via the item menu ("Move to…", "Move up /
down"); reorder children in custom sort; switch sort modes and kind filters; search
title/prompt; multi-select → bulk move / bulk delete / bulk enable-disable; delete a
non-empty folder → confirmation appears; cancel leaves the subtree intact.
Expected: all operations succeed with no data loss; confirmation gates destructive ops.

**S3 — Persistence (US2.1, SC-001)**: fill every field of an entry; close the panel,
switch chats, restart the app; reopen → field-by-field comparison matches exactly
(assets: the full-field card from the demo seed or manual fills). Custom order and
expand/collapse state survive the restart.

**S4 — Focus safety (US2.2, SC-002)**: type continuously into the content textarea
while edits elsewhere trigger background saves (keep making edits from another input).
Expected: no focus or cursor displacement during the whole session.

**S5 — Designate, sync, generate (US3.1, SC-003)**: mark a folder as World Info root →
a native book file appears immediately under `worlds/` (named after the folder;
collision → "Name (N)") and the root is NOT in the active list → verify in the
workspace's book list → activate it there → edit/add entries → within ~1 s of idle the
book contains the flattened entries with all fields intact and `displayIndex` matching
tree order → run a generation with matching keys: entries fire exactly like
natively-created ones.

**S6 — Nested roots (US3.2)**: designate a folder inside another designated root →
both books exist; an entry under the inner root appears in both books after sync;
activation toggles are independent.

**S7 — Orphan flow (FR-018)**: sync a root, then move an entry out from under it →
the book's divergence banner lists the orphan; "remove from book" drops the native
entry on the next push; dragging it back re-includes it (status dirty). Nothing
changes silently at any point.

**S8 — Delete disclosure (FR-021)**: delete a synced entry → the confirmation states
the native copy will be removed at the next sync → after the sync the native entry is
gone; no second prompt.

**S9 — Import & round-trip (US3.5–6, SC-004)**: import an existing native lorebook →
it lands as a designated root bound to that book (activation state untouched) with all
fields preserved → edit nothing → sync → the book file is equivalent to before
(round-trip). Then: edit the book file externally (or via another tool), make a
workspace edit, try to push → push is blocked with a divergence banner; resolve per
entry (keep workspace / take native); import of a bound book follows the same
per-entry resolution and never silently overwrites.

**S10 — Failure & retry (US2.3, SC-005)**: with devtools network throttling to offline,
make an edit that triggers a push → a visible error appears with retry → restore
network → retry succeeds and the edit is intact (verify book file contents).

**S11 — Book list parity (FR-017/FR-022)**: the workspace book list shows ALL native
books with activation checkboxes (external books included); toggling activation changes
generation participation exactly like the old native select did; a detached book
(toggle-off) remains visible/deletable there; renaming a root folder does not rename
its book (the binding holds); root deletion offers keep-or-delete.

**S12 — Performance (SC-006/SC-007)**: create folder+entry (stopwatch < 30 s); move an
entry (< 10 s both paths); build a 300+ node tree (e.g. repeat demo seed into extra
folders) → scrolling/filtering/editing shows no perceptible delay; 100-entry sync does
not freeze interaction for more than a few seconds.

**S13 — Touch moves (FR-004)**: on a touch device, long-press opens the item menu →
"Move to…" relocates the item; "Move up/down" reorders in custom sort. Desktop
drag-and-drop still works.

## Pass criteria

Every scenario's "Expected" holds; spec SC-001…SC-008 verified by the mapped scenario
field (S3→SC-001, S4→SC-002, S5+S6→SC-003, S9→SC-004, S10→SC-005, S2/S13→SC-006,
S12→SC-007, S1–S11→SC-008). Failed save recovery (S10) must show zero edit loss.