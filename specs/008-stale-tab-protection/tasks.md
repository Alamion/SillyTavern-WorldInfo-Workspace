---
description: "Task list for Stale-Tab Protection (008-stale-tab-protection)"
---

# Tasks: Stale-Tab Protection

**Input**: Design documents from `/specs/008-stale-tab-protection/` (plan.md, spec.md,
research.md R1–R8, data-model.md, contracts/persistence-delta.md, contracts/ui-contract.md,
quickstart.md T0–T14)

**Tests**: INCLUDED — constitution V (test-first for pure core logic) and VI (integration
tests against `getContext()` surfaces). Every test task precedes its implementation task
and must fail first.

**Organization**: Setup → Foundational (marker, hash, classification, saved-settings
reader, gate skeleton) → US1 pick up newer (P1, MVP) → US2 conflict banner (P1) → US3
repair stale overwrites (P2) → US4 README (P3) → Polish.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US4 (spec.md)
- Paths are project-relative; single-project layout per plan.md

## Key rules for every task

- `src/core/**` is pure: no `getContext()`, no DOM, no fetch.
- Host access only in `src/adapters/**`; the gate (`adapters/saveGate.ts`) receives every
  host capability as an injected dependency so integration tests drive it with fakes.
- Bookkeeping (folder `expanded`, `settings.layout`, `settings.sortMode`, sync status,
  `_save`) is never content (FR-015, research R3).
- The recovery no-publish rule (`settingsStore.isRecoveryPending()`) always wins.
- UI strings exactly as in contracts/ui-contract.md; shared banner styles only.

---

## Phase 1: Setup

**Purpose**: types and test support used by every story

- [X] T001 Add the `SaveMarker` type (`{ rev: number; writer: string; at: string; hash: string }`) and the optional `_save?: SaveMarker` field to `WorkspaceState` in src/core/state/schema.ts (no migration change: valid payloads are returned by reference, so the key survives; document it in the type's comment)
- [X] T002 [P] Extend tests/support/fakeHost.ts: a mutable `serverSettings` payload (the "saved file"), `readSaved()` returning a deep copy of its namespace or throwing when `serverDown` is set, `saveSettingsDebounced` that copies `extensionSettings.WorldInfoWorkspace` into `serverSettings` (counted), a `visible` flag, and a helper `writeAsOtherTab(mutate)` that edits the server payload and re-stamps `_save` like another tab of this version would (plus `writeAsOldVersion(mutate)` that keeps the old `_save`)

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: the pure staleness logic, the saved-settings reader and the gate skeleton.
No user story works without them.

- [X] T003 [P] Write failing unit tests in tests/unit/staleness.test.ts for `contentHash`: equal for states differing only in folder `expanded`, `settings.layout`, `settings.sortMode`, `sync.books[*]` status/hash/uid, root `book.tombstones`, native `uid`, `_save`, `_recovered`; different for a renamed node, an edited entry field, a summary, an added/removed/moved node, an image caption, assistant settings, picking settings, context sets; memoized per state object (same reference → no recomputation)
- [X] T004 [P] Write failing unit tests in tests/unit/staleness.test.ts for `markerTrusted(payload)` and `classify({ seen, saved })` covering every row of research R2's table: same hash → `unchanged`; differs + trusted + higher rev → `newer`; lower rev → `older`; equal rev → `conflict`; differs + missing or untrusted marker → `conflict`
- [X] T005 Implement `contentHash`, `markerTrusted`, `classify` and `nextMarker(seen, saved, writer, hash, now)` (`rev = max(seen.rev, saved.rev) + 1`) in src/core/state/staleness.ts using `stableStringify`/`fnv1a` from src/core/sync/fingerprint.ts; projection builds a bookkeeping-free copy without mutating the input (T003, T004 pass)
- [X] T006 [P] Write failing unit tests in tests/unit/staleness.test.ts for `withBookkeeping(loaded, tab)`: copies `expanded` by node id for nodes present in both, `settings.layout` and `settings.sortMode` from the tab; keeps everything else (incl. sync status) from `loaded`; returns a new object
- [X] T007 Implement `withBookkeeping` in src/core/state/staleness.ts (T006 passes)
- [X] T008 [P] Implement src/adapters/savedSettings.ts: `readSavedWorkspace(ctx): Promise<unknown>` — `fetch('/api/settings/get', { method: 'POST', headers: ctx.getRequestHeaders(), body: '{}' })`, parse `response.settings` (JSON string), return `extension_settings.WorldInfoWorkspace` (or `undefined`); throw on non-OK responses and parse errors (research R1)
- [X] T009 Create src/adapters/saveGate.ts: `createSaveGate(deps)` with deps `{ store, readSaved, publish(state), save(), now(), writerId, hasPendingDrafts(), isRecoveryPending(), notify(message), onStateChange() }`; holds the `SeenCopy` (data-model.md), a single in-flight check with 3 s result reuse (research R6), `check(): Promise<CheckResult>` (classification via T005; `failed` on a thrown read), `gateState(): 'open' | 'conflict'`, and `subscribe(listener)` for the UI; initialise `seen` from the loaded store state and its `_save`

**Checkpoint**: pure logic green; gate can classify but does not yet act.

---

## Phase 3: User Story 1 — A tab picks up newer changes when you come back (Priority: P1) 🎯 MVP

**Goal**: an untouched stale tab loads the newer saved workspace silently, and its later
saves (including the app's unrelated saves) carry the new workspace.

**Independent Test**: quickstart T1–T4, T11 — edit in B, return to A: A shows the edit
within 2 s with the notice; any app save in A keeps B's edit in the file; expand state and
sizes in A survive.

### Tests for User Story 1

- [X] T010 [P] [US1] Write failing integration tests in tests/integration/stale-tabs.test.ts (real store + gate + fake host from T002): (a) other tab writes newer → `check()` → store shows it, `seen` updated, notice "Updated with changes made in another tab or device.", `save` NOT called; (b) after (a) an app save (`host.saveSettingsDebounced()` with the published namespace) leaves the other tab's content in `serverSettings`; (c) tab with only expanded folders/resized layout still loads silently and keeps its bookkeeping; (d) unchanged server → no notice, no load; (e) single tab editing and saving produces no notice and saves with `rev` incremented each time (SC-006)
- [X] T011 [P] [US1] Write a failing integration test in tests/integration/stale-tabs.test.ts with the real sync engine (`buildRig` + gate): after loading a newer workspace whose entries carry in-sync status from the other tab's push, no native book save happens and no divergence report appears (FR-010, SC-005); a `tree-changed` event is emitted for the loaded change (FR-012)

### Implementation for User Story 1

- [X] T012 [US1] Implement the guarded save in src/adapters/saveGate.ts: `scheduleSave()` (1000 ms debounce) → `check()` → `unchanged`/`older`* → stamp `_save` via `nextMarker` + `publish` + `save` and set `seen`; `newer` without local edits (`contentHash(store) !== seen.hash` is false and no pending drafts) → load; `failed` → one retry, then publish + save without a marker change. (*`older` gets its notice in US3.) Local edits per data-model.md
- [X] T013 [US1] Implement `load(saved)` in src/adapters/saveGate.ts: `migrate` → `withBookkeeping(…, store.getState())` → `store.replace` with a flag so the gate's own store subscription does not schedule a save for it → `publish` (no save) → `seen` = loaded → notice (contracts/ui-contract.md)
- [X] T014 [US1] Rewire src/adapters/settingsStore.ts: replace the `store.subscribe(() => { publish(); ctx.saveSettingsDebounced(); })` path with the gate (`createSaveGate` with `readSavedWorkspace`, `publish`, `ctx.saveSettingsDebounced`, `hasPendingDrafts`, `isRecoveryPending`, `notifyInfo`); keep the recovery branch exactly as today (no publish while recovery is pending); export the gate on the services object
- [X] T015 [US1] Add check triggers in src/adapters/settingsStore.ts: `document` `visibilitychange` (to visible), `window` `focus`, `shell.onWorkspaceShown` (existing callback in src/adapters/shell.ts / src/index.ts), and a 2-minute `setInterval` that runs `check()` only when `document.visibilityState === 'visible'`; each check result `newer` without local edits loads (T013)
- [X] T016 [US1] Make native pushes await the gate in src/adapters/syncEngine.ts: before `pushBook` writes, `await gate.ready()` (runs/reuses a check; resolves `false` while the gate is in conflict, in which case the push is deferred and the book stays pending); inject the gate through the engine deps with a no-op default so existing tests are unaffected (research R4)

**Checkpoint**: T1–T4 and T11 pass in automation; single-tab behaviour unchanged.

---

## Phase 4: User Story 2 — Both sides changed: the user decides (Priority: P1)

**Goal**: a stale tab with its own edits never overwrites; a banner lists both sides'
differences and offers "Use the saved version" / "Keep this version".

**Independent Test**: quickstart T5–T8 — the banner appears, the file keeps B's version,
each choice gives the described result, and no native push of A's unconfirmed edit
happened.

### Tests for User Story 2

- [X] T017 [P] [US2] Write failing unit tests in tests/unit/staleness.test.ts for `conflictSummary(seen, mine, theirs)`: labelled lines "Name — edited/added/removed" from `diffTree`, max 10 per side + count of the rest, settings changes as "Assistant settings — changed" / "Lore picking settings — changed", bookkeeping never listed (FR-016)
- [X] T018 [P] [US2] Write failing integration tests in tests/integration/stale-tabs.test.ts: (a) newer saved + local edit → gate `conflict`, `serverSettings` unchanged, namespace still the seen copy, a pending native push is held; (b) "Use the saved version" → store = saved, local edit gone, gate `open`, no push of the discarded edit; (c) "Keep this version" → saved payload = tab state with `rev` above both, gate `open`, held push released; (d) edits made while in conflict are included by "Keep this version"; (e) equal-rev different content and untrusted marker (`writeAsOldVersion`) also open the conflict (FR-008/FR-009)

### Implementation for User Story 2

- [X] T019 [US2] Implement `conflictSummary` in src/core/state/staleness.ts (T017 passes)
- [X] T020 [US2] Implement the conflict state in src/adapters/saveGate.ts: on `conflict` or `newer` with local edits → state `conflict`, keep `pendingSaved` (latest saved payload), stop publishing/saving, hold pushes (`ready()` → false); later checks refresh `pendingSaved` and the summary; `useSaved()` → `load(pendingSaved)` without the silent-load notice; `keepMine()` → stamp + publish + save, notice "Saved this version.", release pushes; expose `conflict(): { summary } | null` (T018 passes)
- [X] T021 [P] [US2] Create src/ui/StaleBanner.tsx: subscribes to the gate, renders nothing when open; in conflict renders the text, the two titled lists and the two buttons exactly as contracts/ui-contract.md, using the shared banner classes from src/styles/wiw-theme.scss (add only a list style if the shared system lacks one)
- [X] T022 [US2] Mount StaleBanner in the banner area of src/ui/WorkspaceApp.tsx so it shows on desktop regions and phone sheets; wire the buttons to `services.gate.useSaved()` / `keepMine()`
- [X] T023 [US2] Recovery interplay (FR-011) in src/adapters/saveGate.ts and src/ui/StaleBanner.tsx: while `isRecoveryPending()`, a valid newer saved payload never loads or saves silently; the banner adds "A valid workspace was saved elsewhere" with **Use the saved version** only; add an integration test case for it in tests/integration/stale-tabs.test.ts

**Checkpoint**: T5–T8, T10 (old marker) pass in automation.

---

## Phase 5: User Story 3 — A newer tab repairs an overwrite by a stale one (Priority: P2)

**Goal**: when the saved copy is older than the tab's own (trusted marker, lower rev), the
tab writes its copy back and says so.

**Independent Test**: quickstart T9 — a stale writer saves its old copy; the newest tab
restores on its next check with the notice; the file holds the newest content.

### Tests for User Story 3

- [X] T024 [P] [US3] Write failing integration tests in tests/integration/stale-tabs.test.ts: (a) tab B saved rev 5; the server payload is replaced by a trusted rev-3 copy (a stale tab of this version) → B's `check()` saves B's state back with rev 6 and notifies "Restored the newer workspace from this tab; another tab had saved an older copy."; (b) after "Use the saved version" in another tab (its seen = saved, rev unchanged) no restore is triggered anywhere (deliberate choice never undone, FR-007)

### Implementation for User Story 3

- [X] T025 [US3] Handle `older` in src/adapters/saveGate.ts at every check (not only before own saves): stamp + publish + save the tab's state, notice per contracts/ui-contract.md, `seen` = tab state (T024 passes)

**Checkpoint**: all automated stories green.

---

## Phase 6: User Story 4 — The remaining risk is stated plainly (Priority: P3)

**Goal**: README describes what is protected and what is not.

**Independent Test**: the README section matches stories 1–3 (quickstart cross-check).

- [X] T026 [US4] Replace the "One open tab at a time" warning in the "World Info sync" section of README.md with "Several tabs and devices" per contracts/ui-contract.md (detected and repaired cases, residual risk, lorebooks unaffected)

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T027 [P] Add perf budget P-12 to tests/perf/scale.bench.test.ts: `contentHash` of the 1000-entry scale dataset < 100 ms, and a second call on the same state object ≈ 0 ms (memoized)
- [X] T028 [P] Amend specs/003-core-workspace-mvp/contracts/persistence-schema.md with contracts/persistence-delta.md (shape `_save`, save rules, load-while-running rules, checks) and update the "Settings" section of AGENTS.md (marker, gate, checks; replace the "Next increment" note with "Current increment")
- [X] T029 [P] Add CHANGELOG.md lines (new unreleased section above 0.5.0, or into 0.5.0 if still unpushed at that time): changes from other tabs/devices are picked up, conflicts are asked about, stale overwrites are repaired
- [X] T030 Run the four gates (typecheck, lint, test incl. perf, build) and fix anything red
- [X] T031 Live pass on the dev account per quickstart.md T0–T14 with two independent browser sessions and the server log; record results under "Results" in specs/008-stale-tab-protection/quickstart.md; every discrepancy becomes an integration scenario in tests/integration/stale-tabs.test.ts
- [X] T032 Commit per story (US1, US2, US3, US4 + polish) with all gates green

---

## Dependencies & Execution Order

### Phase Dependencies

- Setup (T001–T002) → Foundational (T003–T009) → US1 → US2 → US3 → US4 → Polish.
- US2 depends on US1's guarded save and load (T012–T016); US3 depends on the gate's
  check loop (T012, T015) but not on US2; US4 depends on the behaviour being final.

### Within Each Story

- Tests first and failing (T010/T011, T017/T018, T024), then core, then adapters, then UI.
- `saveGate.ts` tasks are sequential (same file); `staleness.ts` tasks are sequential.

### Parallel Opportunities

- T002 ∥ T001; T003 ∥ T004 ∥ T006 ∥ T008 (different files or independent test blocks
  written before code).
- T010 ∥ T011; T017 ∥ T018; T021 (UI) ∥ T020 once the gate's conflict API is agreed.
- Polish: T027 ∥ T028 ∥ T029.

## Parallel Example: User Story 2

```text
T017 conflictSummary unit tests        (tests/unit/staleness.test.ts)
T018 conflict integration tests        (tests/integration/stale-tabs.test.ts)
T021 StaleBanner component             (src/ui/StaleBanner.tsx)
```

## Implementation Strategy

### MVP First (User Story 1)

1. Setup + Foundational.
2. US1: the observed failure (a stale untouched tab) is fixed — validate T1–T4.
3. Stop and validate before adding the banner.

### Incremental Delivery

US1 (silent pick-up) → US2 (conflict banner, nothing lost silently) → US3 (repair of
stale overwrites) → US4 (README) → polish and live pass. Each story is committed
separately with green gates.

## Notes

- 32 tasks: Setup 2, Foundational 7, US1 7, US2 7, US3 2, US4 1, Polish 6.
- The gate is the only place that publishes the workspace into the app's settings; any
  later code that wants to save must go through `scheduleSave()`.
