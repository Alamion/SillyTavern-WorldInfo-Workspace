---
description: "Task list for Phase 1 Core Workspace MVP (003-core-workspace-mvp)"
---

# Tasks: Core Workspace MVP (Phase 1)

**Input**: Design documents from `/specs/003-core-workspace-mvp/` (plan.md, spec.md,
research.md, data-model.md, contracts/, quickstart.md)

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/,
quickstart.md — all present in `specs/003-core-workspace-mvp/`.

**Tests**: INCLUDED — constitution V (test-first for core logic) and VI (contract
tests) mandate them; research.md R10 enumerates the suites. Test tasks precede their
implementation tasks (red → green).

**Organization**: Grouped by user story (US1 tree, US2 editing trust, US3 WI sync +
import — all P1 per spec.md, executed in spec order).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- All paths are project-relative; single-project layout per plan.md

## Path Conventions

- `src/core/**` — pure logic, no app imports (Vitest-first)
- `src/adapters/**` — app boundary (context, endpoints, host DOM)
- `src/ui/**` — React components
- `tests/unit/**`, `tests/contract/**` — Vitest suites

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Typed app surface, single accessor, logging — prerequisites for everything

- [X] T001 [P] Extend app API types in `src/global.d.ts` per `contracts/native-wi-contract.md`: event types (`WORLDINFO_UPDATED`, `WORLDINFO_SETTINGS_UPDATED`, `GENERATION_STARTED`, `SETTINGS_LOADED`, `EXTENSION_SETTINGS_LOADED`, `SETTINGS_UPDATED`, `CHAT_CHANGED`), `saveWorldInfo` return `Promise<void>`, `updateWorldInfoList`, `eventSource.makeFirst/makeLast`, `uuidv4`, `callGenericPopup`/`Popup`/`POPUP_TYPE`/`POPUP_RESULT`, `substituteParams`/`substituteParamsExtended`, `powerUserSettings`, ambient `window.toastr` declaration
- [X] T002 [P] Create single typed context accessor `src/adapters/appApi.ts` (get/require `globalThis.SillyTavern.getContext()` typed via `src/global.d.ts`); refactor `src/index.ts` to use it (no inline casts elsewhere, ever)
- [X] T003 [P] Create namespaced logging util `src/adapters/logger.ts` (console debug in dev, toastr info/warn/error for user-visible feedback; constitution constraint) and use it in the existing shell error path

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Persisted state schema + observable store + settings persistence — blocks ALL user stories

**⚠ CRITICAL**: No user story work can begin until this phase is complete

- [X] T004 [P] Write failing unit tests `tests/unit/state-schema.test.ts`: WorkspaceState v1 defaults, node shape invariants per `contracts/persistence-schema.md` (id uniqueness, parent integrity, book-iff-root, name non-empty), `migrate()` passthrough for v1, unknown-input recovery (default state + `_recovered` retention), unknown-key preservation
- [X] T005 [P] Write failing unit tests `tests/unit/state-store.test.ts`: framework-free observable store — subscribe/selector semantics (`useSyncExternalStore`-compatible `getSnapshot` stability), immutable tree updates, action dispatch, node CRUD primitives used by stories
- [X] T006 Implement `src/core/state/schema.ts`: types (WorkspaceState/WorkspaceSettings/NodeBase/FolderNode/BookBinding/OrphanedEntry/EntryNode/ImageNode/SyncState per `data-model.md`), defaults, `migrate()`, deep validation helper, uuid generation via app `uuidv4` (injected, not imported — keep core app-free)
- [X] T007 Implement `src/core/state/store.ts`: store + pure action reducers over schema (create/move/update/delete hooks), selector helpers, subscription registry; no app imports
- [X] T008 Implement `src/adapters/settingsStore.ts`: load `extensionSettings['WorldInfoWorkspace']` → `migrate()` → store; save via `saveSettingsDebounced()` after every mutation (per R2); expose save-failure events (settings saves are not interceptable — R1) and the `_recovered` warning path
- [X] T009 Wire bootstrap in `src/index.ts`: on `EXTENSION_SETTINGS_LOADED`/`SETTINGS_LOADED` initialize settingsStore + store, keep shell mount + `body.wiw-active` behavior, keep idempotency witness; store instance becomes the single source passed to the UI root

**Checkpoint**: Foundation ready — store holds a migrated persisted state; user story work can begin

---

## Phase 3: User Story 1 — Organize Lore in a Real, Persistent Tree (P1) 🎯 MVP

**Goal**: The tree operates on real persisted data: build folders/entries/images at any
depth, rename/move/reorder/delete with confirmations, toolbar sort/filter/search,
multi-select bulk actions, DnD + touch-safe move affordance; everything survives
restart. Empty state with optional 'Aldermeer' demo seed (FR-001–FR-006, FR-011).

**Independent Test**: Build a multi-level tree with every interaction type, restart the
app, verify structure/order persist exactly (quickstart S1–S3).

### Tests for User Story 1 (constitution V — write first, keep failing)

- [X] T010 [P] [US1] Failing unit tests `tests/unit/tree-operations.test.ts`: create folder/entry/image at any depth, rename, move (incl. cycle rejection: folder into own descendant), custom reorder, subtree delete, bulk move/delete/toggle-disable (maps `native.disable`), name trimming rules
- [X] T011 [P] [US1] Failing unit tests `tests/unit/tree-browse.test.ts`: sort modes custom/title/position/depth/order/trigger over folder children (folders first), kind filters (folders/WI folders/entries/images), title/prompt search matching
- [X] T012 [P] [US1] Failing unit tests `tests/unit/tree-validation.test.ts`: name rules + native field rules per `data-model.md` (probability 0–100, position 0–7 + outletName at outlet, role 0–2, selectiveLogic 0–3, depth ≥ 0, timed effects, triggers subset, groupWeight 0–100) — violations returned, never coerced
- [X] T013 [P] [US1] Failing unit tests `tests/unit/demo-dataset.test.ts`: demo seed is a valid WorkspaceState (schema-validated), ≥3 nesting levels, ≥10 entries, ≥2 images, NO WI designations, no sync bindings (FR-001, research R9)

### Implementation for User Story 1

- [X] T014 [US1] Implement `src/core/tree/operations.ts` (create/rename/move with cycle check/reorder/delete subtree/bulk move+delete+enable-disable; immutable updates via store actions from T006/T007)
- [X] T015 [US1] Implement `src/core/tree/browse.ts` (sort modes, kind filters, title/prompt search; view-level only — never mutates persisted order)
- [X] T016 [US1] Implement `src/core/tree/validation.ts` (typed rule violations; consumed by editor in US2 and flatten publish-block in US3)
- [X] T017 [P] [US1] Implement `src/adapters/popups.ts` — confirm wrappers over `callGenericPopup`/`POPUP_TYPE.CONFIRM`/`POPUP_RESULT` (non-empty folder delete, destructive ops; text-parameterized for reuse by US3 disclosures)
- [X] T018 [P] [US1] Implement `src/core/demo/dataset.ts` — 'Aldermeer' seed as a WorkspaceState derived from the Phase 0 sample shapes (`src/core/sample/dataset.ts`), entries carry full `NativeWiEntry` fields, images carry src/caption, zero root designations
- [X] T019 [US1] Rebuild `src/ui/StructureTree.tsx` onto the store: real nodes, selection (single + multi via ctrl/shift), expand/collapse persisted, toolbar (sort/filter/search/create), HTML5 DnD moves + custom-order reordering, long-press item menu on touch ("Move to…" folder picker, "Move up/down") per research R8, bulk action bar for multi-select
- [X] T020 [US1] Rework `src/ui/WorkspaceApp.tsx` (rename from `WorkspacePrototype.tsx`): bind tree to store, wire delete confirmations through `src/adapters/popups.ts`, empty-state guidance + "Load demo data" action (T018), route every mutation through `settingsStore` save (T009) — verify restart persistence (quickstart S1–S3 basis)

**Checkpoint**: US1 independently testable — a built tree survives UI close/restart; S1–S3 pass

---

## Phase 4: User Story 2 — Edit with Total Trust (P1)

**Goal**: Every field edit persists reliably; no focus/cursor steal during background
saves; validation surfaced inline, never silently reset; live preview resolves app
placeholders; failed saves visible with retry (FR-007–FR-011).

**Independent Test**: Edit every field type across close/reopen/chat-switch/restart and
diff values; scripted session with background saves watching focus (quickstart S3–S4).

### Tests for User Story 2 (constitution V)

- [X] T021 [P] [US2] Failing unit tests `tests/unit/store-edits.test.ts`: field commit actions update `native` fields + `updatedAt` + dirty/status marking per `data-model.md` state transitions; rapid successive commits coalesce to final values
- [X] T022 [P] [US2] Failing unit tests `tests/unit/preview.test.ts`: production markdown renderer `src/core/preview.ts` (port from `src/core/sample/markdown.ts`): block/inline basics, embedded images with missing-image placeholder, placeholder-resolution hook injection point

### Implementation for User Story 2

- [X] T023 [US2] Implement `src/core/preview.ts` (productionize the Phase 0 renderer; expose `render(content, { resolvePlaceholder })` so the adapter injects `substituteParams`)
- [X] T024 [US2] Rework `src/ui/ItemEditor.tsx` for live editing per research R8: local draft state per field with commit-on-change into the store, stable per-field React keys (no remount on store/save refresh), inline validation display from `src/core/tree/validation.ts`, publish-block reasons shown on the entity (never silent reset) — entries, images (src/caption), and folders (WI toggle view placeholder, completed by US3)
- [X] T025 [US2] Rework `src/ui/fieldGroups/FieldGroups.tsx` onto the store: Essentials/Content/Advanced rows bind to the editor draft; Content preview uses `src/core/preview.ts` with `substituteParams` resolution via `src/adapters/appApi.ts`
- [X] T026 [US2] Implement save-failure surfacing + retry in `src/ui/WorkspaceApp.tsx` (status banner component): listens to settingsStore/worldInfoAdapter failure events (T009/T038), shows clear error + Retry action; edits are never dropped (store retains state; retry re-saves) per FR-009

**Checkpoint**: US1+US2 pass quickstart S1–S4; editing is trustworthy end-to-end

---

## Phase 5: User Story 3 — Native World Info Sync and Import (P1)

**Goal**: WI roots own native books (created on designation, inactive), sync flattens
subtrees losslessly with divergence guards in both directions, orphans and deletions
behave per FR-018/FR-021, native lorebooks import losslessly, workspace owns the
all-books activation list (FR-012–FR-023).

**Independent Test**: Designate roots (incl. nested), sync, verify native parity in
generation; import an existing lorebook and round-trip it (quickstart S5–S11).

### Tests for User Story 3 (constitution V/VI — write first)

- [X] T027 [P] [US3] Failing unit tests `tests/unit/fingerprint.test.ts`: deterministic key-sorted serialization, FNV-1a stability across key order/whitespace, uid inclusion
- [X] T028 [P] [US3] Failing unit tests `tests/unit/sync-flatten.test.ts`: uid allocation from free pool + stability across syncs; `displayIndex` sequential in workspace order; nested roots traversed as ordinary folders (entity in both books); orphaned entities EXCLUDED from scope but RETAINED in output per `data-model.md`; image → derived entry encoding (research R7) incl. `extensions.wiw` marker; unknown top-level book keys preserved; entries-keyed payload shape
- [X] T029 [P] [US3] Failing unit tests `tests/unit/sync-divergence.test.ts`: fingerprint mismatch → `nativeDrift`; foreign entries detection; push guard blocks automatic push when diverged; orphan retention flow (record/resolve remove/restore); FR-021 deletion omission (no tombstones)
- [X] T030 [P] [US3] Failing unit tests `tests/unit/sync-import.test.ts`: unbound book → folder + designated bound root; comment→name with key/`Entry <uid>` fallbacks; image markers → ImageNode (no-marker image md stays a text entry); displayIndex → child order; bound re-import per-entry conflict model
- [X] T031 [P] [US3] Failing unit tests `tests/unit/book-naming.test.ts`: trailing `(N)` stripping, first-free `"Base (N)"` selection, accent-insensitive collision compare (mirrors app `getFreeWorldName`, WI:4311)
- [X] T032 [P] [US3] Failing contract tests `tests/contract/native-wi.test.ts` pinning `contracts/native-wi-contract.md`: worldInfoAdapter create/delete/rename request shapes (endpoint bodies), `saveWorldInfo` payload (`entries` key, unknown top-level keys preserved, clone discipline via Object.freeze), self-save discrimination by reference identity, activeBooksAdapter read/drive semantics against a stub `#world_info`, event names/payloads subscribed

### Implementation for User Story 3

- [X] T033 [US3] Implement `src/core/sync/fingerprint.ts` (T027)
- [X] T034 [US3] Implement `src/core/sync/convert.ts` — image entity ↔ native entry (research R7): export encoding `![caption](src)` + `extensions.wiw {v:1, kind:'image', src, caption}`; import restores ImageNode only via marker
- [X] T035 [US3] Implement `src/core/sync/bookNaming.ts` — `resolveFreeName()` per contract (sanitize via app endpoint injection point, strip `(N)`, accent-insensitive first-free search)
- [X] T036 [US3] Implement `src/core/sync/flatten.ts` (T028 semantics; pure, receives naming/uid policies as parameters)
- [X] T037 [US3] Implement `src/core/sync/divergence.ts` — `WORLDINFO_UPDATED` analysis, push guard decisions, per-entry conflict model for import/push (FR-015)
- [X] T038 [US3] Implement `src/core/sync/import.ts` — book → folder/entities mapping (T029), displayIndex ordering, unknown-key preservation
- [X] T039 [US3] Implement `src/adapters/worldInfoAdapter.ts` — load/save (clone handoff), create (`{entries:{}}` + `updateWorldInfoList`), delete (`/api/worldinfo/delete` + list refresh + `#character_world` check), rename (copy+delete+rebind) per contract; emits success/failure events for T026 banner
- [X] T040 [P] [US3] Implement `src/adapters/activeBooksAdapter.ts` — read `#world_info` values, drive via value-set + `change` trigger, re-read after host handler (contract section "Active-books drive")
- [X] T041 [US3] Implement `src/adapters/syncEngine.ts` — orchestrates store ↔ adapters: dirty tracking → debounced push → flush `immediately` on `GENERATION_STARTED`/panel close; self-save discrimination (reference identity); divergence banner state; wires `src/adapters/eventsAdapter.ts` subscriptions (complete the events table from the contract)
- [X] T042 [US3] Wire root designation in `src/ui/StructureTree.tsx` + folder editor view in `src/ui/ItemEditor.tsx`: designation ON → resolve name (T035) → create+bind (inactive) via T039; toggle-off releases binding; root settings view (book name, rename action); root delete offers keep-or-delete (FR-019); designation collision offers adopt-or-create (FR-022/FR-023)
- [X] T043 [US3] Implement `src/ui/ActiveBooksPanel.tsx` — replacement book list: ALL native books with activation checkboxes (drive via T040), workspace roots marked, detached books visible/deletable (FR-017/FR-022)
- [X] T044 [US3] Implement divergence/orphan UI in `src/ui/StructureTree.tsx` + `src/ui/WorkspaceApp.tsx`: per-book divergence banner (adopt native / push anyway / per-entry resolution), orphan resolution rows (remove from book / restore), all via `src/adapters/popups.ts` confirmations (FR-015/FR-018)
- [X] T045 [US3] Implement import UI flow (entry point in toolbar): book picker → unbound adoption or bound re-import → per-entry resolution list (keep workspace / take native) → mapping report; wire `src/core/sync/import.ts` (FR-016)
- [X] T046 [US3] Wire FR-021 delete disclosures: single + bulk delete confirmations state native-copy removal at next sync (via `src/adapters/popups.ts`) for every exported entity kind

**Checkpoint**: US3 passes quickstart S5–S11; all three stories independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Cleanup, performance, docs, final validation

- [X] T047 [P] Remove prototype remnants: delete `src/ui/ReviewGuide.tsx`, strip "PROTOTYPE" labels/mock markers from `src/ui/**`, absorb `src/core/sample/` into `src/core/demo/` (delete leftover modules, update imports) per FR-001/FR-011
- [X] T048 Performance pass per SC-007: memoized tree rows, selector-scoped subscriptions (avoid full-tree re-render on save badges), verify 300+ node scroll/edit latency and 100-entry sync non-blocking (quickstart S12); virtualize only if measurements demand
- [X] T049 [P] Mobile/touch pass: long-press menu + "Move to…"/"Move up/down" inside bottom sheets, snap sizes unaffected (quickstart S13)
- [X] T050 [P] Update `AGENTS.md` (module surfaces, settings schema, sync semantics) and bump `manifest.json` version (constitution: AGENTS.md updated in the same change)
- [ ] T051 Run all four gates (`pnpm run typecheck && pnpm run lint && pnpm run test && pnpm run build`) and execute `specs/003-core-workspace-mvp/quickstart.md` S1–S13 end-to-end; record results
  - Automated portion (2026-09-08): typecheck/lint/test(115)/build all pass. The S1–S13 manual walkthrough requires a running SillyTavern instance — execute per quickstart.md before release.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — start immediately
- **Foundational (Phase 2)**: depends on Setup — BLOCKS all user stories
- **US1 (Phase 3)**: depends on Foundational — first increment (MVP)
- **US2 (Phase 4)**: depends on US1's tree/editor skeletons (T019–T020) — editing needs real nodes
- **US3 (Phase 5)**: depends on US1+US2 (tree ops, editor, store, popups) — the sync engine rides on both
- **Polish (Phase 6)**: depends on all stories

### User Story Dependencies

- **US1**: Foundational only — no cross-story dependencies
- **US2**: integrates with US1's tree (selection → editor); independently testable against quickstart S3/S4
- **US3**: integrates with US1 (tree/root UI) and US2 (editor fields, failure banner); independently testable per quickstart S5–S11

### Within Each User Story

- Tests first (failing) → implementation (constitution V red→green)
- Pure core modules before adapters; adapters before UI wiring
- Checkpoint = quickstart scenarios listed for the story

### Parallel Opportunities

- All [P] test tasks within a phase run together (different files)
- T001–T003 (Setup) and T004/T005 (Foundational tests) fully parallel
- Within US1: T013–T018 pure modules/adapters in parallel after their tests
- Within US3: T026–T032 all tests in parallel; T033–T039 module/adapter parallelization after tests
- T039/T042 (activeBooks adapter + panel) parallel to T038 worldInfoAdapter work

---

## Parallel Example: User Story 1

```bash
# Tests first (all in parallel):
Task: "Failing unit tests tests/unit/tree-operations.test.ts"
Task: "Failing unit tests tests/unit/tree-browse.test.ts"
Task: "Failing unit tests tests/unit/tree-validation.test.ts"
Task: "Failing unit tests tests/unit/demo-dataset.test.ts"

# Then pure modules (parallel, different files):
Task: "Implement src/core/tree/operations.ts"
Task: "Implement src/core/tree/browse.ts"
Task: "Implement src/core/tree/validation.ts"
Task: "Implement src/adapters/popups.ts"
Task: "Implement src/core/demo/dataset.ts"
```

## Parallel Example: User Story 3

```bash
# Tests first (all in parallel):
Task: "Failing unit tests tests/unit/fingerprint.test.ts"
Task: "Failing unit tests tests/unit/sync-flatten.test.ts"
Task: "Failing unit tests tests/unit/sync-divergence.test.ts"
Task: "Failing unit tests tests/unit/sync-import.test.ts"
Task: "Failing unit tests tests/unit/book-naming.test.ts"
Task: "Contract tests tests/contract/native-wi.test.ts"

# Then modules/adapters (parallel where files differ):
Task: "Implement src/core/sync/fingerprint.ts"
Task: "Implement src/core/sync/convert.ts"
Task: "Implement src/core/sync/bookNaming.ts"
```

---

## Implementation Strategy

### MVP First (US1 only)

1. Complete Setup (T001–T003) + Foundational (T004–T009)
2. Complete US1 (T010–T020) → **STOP and VALIDATE** quickstart S1–S3
3. At this point the workspace is a trustworthy persistent lore tree (US2 trust
   mechanics land next; books/sync are not wired yet)

### Incremental Delivery

1. Setup + Foundational → foundation ready
2. US1 → validate S1–S3 (MVP: real persistent tree)
3. US2 → validate S3–S4 (editing trust complete)
4. US3 → validate S5–S11 (native WI bridge complete — the reason the plugin exists)
5. Polish (T047–T051) → gates + quickstart full pass → release candidate

### Notes

- Commit after each task or logical group; all four gates green before any commit
- [P] = different files, no dependency on incomplete tasks
- Any deviation from contract files (`contracts/*.md`) requires updating the contract
  AND its contract tests in the same change (constitution VI/VII)