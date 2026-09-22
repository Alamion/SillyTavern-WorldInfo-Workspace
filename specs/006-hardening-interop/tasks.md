---
description: "Task list for Hardening & Interop — roadmap Phase 4 (006-hardening-interop)"
---

# Tasks: Hardening & Interop (Roadmap Phase 4)

**Input**: Design documents from `/specs/006-hardening-interop/` (plan.md, spec.md,
research.md, data-model.md, contracts/, quickstart.md)

**Prerequisites**: all listed documents are present in `specs/006-hardening-interop/`.

**Tests**: INCLUDED — constitution V (test-first for pure core logic) and VI (integration
+ contract tests) mandate them. Every test task precedes its implementation task and must
fail first (red → green). Perf budget tasks are the exception in form only: they are
written to capture the **pre-fix baseline** first, then re-asserted against the budget.

**Organization**: Setup (measurement harness) → Foundational (store structural sharing +
node index) → US1 Performance at scale (P1) → US2 Interop hooks (P2) → US3 Documentation
(P2) → US4 Maintenance process (P3) → Polish (live validation + release).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1–US4)
- All paths are project-relative; single-project layout per plan.md

## Path Conventions

- `src/core/**` — pure logic, no app/browser-global imports (Vitest-first)
- `src/adapters/**` — app boundary (`getContext()`, IndexedDB, events)
- `src/ui/**` — React components; styles only via `src/styles/wiw-theme.scss`
- `tests/unit|integration|contract|perf/**`, fakes and generators in `tests/support/**`

## Key rules for every task

- **No product contract changes.** Persistence schema v1, the markdown convention, the
  assistant protocol and native sync semantics stay exactly as delivered. A task that
  would alter one is wrong — stop and route it to a new spec.
- **Hooks are additive only** (FR-011): the four existing `wi-workspace:*` events keep
  their names and every existing payload field.
- **Emission is never awaited** and is wrapped in try/catch (FR-010).
- **Payloads carry identity, never content** — no entry content, chat text or persona.
- **Structural sharing is a representation change, not a behaviour change**: if a Phase 2
  task changes any observable behaviour, that is a regression, not progress.
- **Draft fields must flush** on blur, before generation and on panel close — an unflushed
  draft is lost user work and violates the Phase 1 trustworthiness guarantee.
- All four gates (`typecheck`, `lint`, `test`, `build`) pass before any commit.
- UI text and all artifacts English-only (constitution IX).

---

## Phase 1: Setup (Measurement Harness)

**Purpose**: Be able to measure before changing anything. Without baselines the phase
gate cannot evidence improvement (plan: "the gain is evidenced, not assumed").

- [X] T001 [P] (FR-006) Create seeded deterministic scale dataset generator in `tests/support/scaleDataset.ts` (~2000 nodes, one 1000-entry WI root book, a second smaller book, depth ~5, realistic content lengths)
- [X] T002 Create perf suite scaffolding in `tests/perf/scale.bench.test.ts` with the budget table from `specs/006-hardening-interop/contracts/performance-budgets.md` (P-1…P-9)
- [X] T003 Wire `tests/perf/**` into the Vitest config in `vitest.config.ts` so the suite runs with `pnpm run test` (FR-006)
- [X] T004 Record pre-fix baselines for P-1…P-9 as comments/constants in `tests/perf/scale.bench.test.ts` so each budget states what it improved from

**Checkpoint**: Current performance is measured and reproducible.

---

## Phase 2: Foundational (Store Structural Sharing + Node Index)

**Purpose**: The root-cause fix (research R1, R2). **Blocks US1 and US2** — US2's tree-event
diff is only viable once unchanged subtrees keep reference identity, otherwise the diff is
itself an O(n) pass on every keystroke.

**⚠️ CRITICAL**: No US1 or US2 work begins until this phase is complete and the full
existing suite is green.

### Tests (write first, must fail)

- [X] T005 [P] Unit tests for path-copy structural sharing in `tests/unit/state-sharing.test.ts`: changed spine is fresh, every untouched sibling subtree is reference-identical, no shared mutable state between published versions
- [X] T006 [P] Unit tests for the node index cache in `tests/unit/node-index.test.ts`: warm-cache lookup, cache miss on a new root object, no stale entries after mutation

### Implementation

- [X] T007 [P] Implement identity-keyed node index in `src/core/state/nodeIndex.ts` (`WeakMap<FolderNode, Map<string, TreeNode>>`)
- [X] T008 Implement `updateNodePath(state, id, fn)` path-copy helper in `src/core/state/sharing.ts`
- [X] T009 Rewrite `findNode` to use the cached index and accept an optional pre-built index in `src/core/state/schema.ts` (replaces the per-call `buildNodeIndex` at lines 439-444)
- [X] T010 Replace `structuredClone(this.state)` with structural sharing in `WorkspaceStore.update` in `src/core/state/store.ts` (line 39), preserving the documented recipe contract
- [X] T011 Replace `clone(state)` with path-copy in every operation in `src/core/tree/operations.ts` (lines 32-34 and all call sites incl. `setExpanded`, which currently clones the whole state to flip one boolean)
- [X] T012 Rewrite `bulkDeleteNodes` and `bulkSetDisable` in `src/core/tree/operations.ts` to do one path-copy pass and one shared index instead of clone-plus-`findNode` per id (currently O(k·n))
- [X] T013 Run the full existing suite (57 files, incl. the real-engine scenarios A–W in `tests/integration/sync-engine.test.ts`) and fix every regression — no behavioural change is intended
- [X] T014 Re-measure P-1…P-4 in `tests/perf/scale.bench.test.ts` and assert the budgets

**Checkpoint**: Mutations no longer clone the workspace; unchanged subtrees keep identity.
The image-GC early-out in `src/core/md/imageRefs.ts` is live again (verify it now hits).

---

## Phase 3: User Story 1 — Responsive on a Large Library (Priority: P1) 🎯 MVP

**Goal**: A 1000-entry book and ~2000-node workspace stay responsive: no dropped
keystrokes, no focus loss, no freeze, identical results at scale.

**Independent Test**: Load the scale dataset, run the scripted editing session (expand,
select, type, move, search, sync) and verify budgets and typing fidelity.

### Tests (write first, must fail)

- [X] T015 [P] [US1] Perf budget tests P-5…P-9 in `tests/perf/scale.bench.test.ts` (push, fingerprint memo, markdown render, reconcile, memory stability)
- [X] T016 [P] [US1] Unit tests for draft-field flush semantics in `tests/unit/draft-field.test.ts`: commit on blur, commit on debounce, and **flush on demand** (generation start / panel close) with no lost text
- [X] T017 [P] [US1] Unit tests for identity-keyed fingerprint memoization in `tests/unit/fingerprint.test.ts` (extend): unchanged entry hashes once, changed entry re-hashes
- [X] T018 [P] [US1] Unit tests for bucketed reconcile equivalence in `tests/unit/md-reconcile.test.ts` (extend): output identical to the pre-bucketing implementation on existing fixtures
- [X] T019 [P] [US1] Unit tests for the image-name index in `tests/unit/image-links.test.ts` (extend): resolution results unchanged, no quadratic queue behaviour
- [X] T020 [P] [US1] (FR-004) Scale-invariance tests in `tests/integration/scale-invariance.test.ts`: sync/import/export/markdown round-trip output identical at 1000 entries vs the small fixture (SC-004)

### Implementation — sync and core hot paths

- [X] T021 [P] [US1] Add `WeakMap<NativeWorldInfoEntry, string>` memoization to `fingerprintEntry` in `src/core/sync/fingerprint.ts`
- [X] T022 [US1] Hoist `entitiesOfRoot` out of the tombstone filter predicate into a `Set<uid>` computed once per root in `src/adapters/syncEngine.ts` (lines 235-237)
- [X] T023 [US1] Make the dirty-book set incremental via `pendingBooks` instead of re-walking every root per push tick in `src/adapters/syncEngine.ts` (lines 250-265)
- [X] T024 [US1] Merge the two consecutive post-save `store.update` calls into one in `src/adapters/syncEngine.ts` (lines 387, 405) — also removes a redundant double store notification (bookkeeping-only, so it produces no hook event either way)
- [X] T025 [US1] Replace `allocateLowestUid`'s linear-scan-from-zero with a stateful cursor in `src/adapters/syncEngine.ts` (lines 86-93)
- [X] T026 [P] [US1] Replace the `queue.shift()` BFS with an index pointer and add a name→images map in `src/core/tree/imageLinks.ts` (lines 38-52, 82-90)

### Implementation — typing and preview

- [X] T027 [US1] Create the shared local-draft + debounced-commit hook in `src/ui/useDraftField.ts` (~250 ms debounce, commit on blur, imperative flush)
- [X] T028 [US1] Apply drafts to the entry content field in `src/ui/fieldGroups/FieldGroups.tsx`
- [X] T029 [P] [US1] Apply drafts to the name input in `src/ui/NodeHeader.tsx` and to URL/SVG/caption fields in `src/ui/ItemEditor.tsx`
- [X] T030 [US1] Flush pending drafts before generation, on panel close and on workspace hide in `src/index.ts` and `src/ui/WorkspaceApp.tsx` — an unflushed draft must never be lost
- [X] T031 [US1] Wrap `resolveImage` and `substitute` in `useCallback` in `src/ui/WorkspaceApp.tsx` (lines 544-553) so the preview `useMemo` can hit, and feed the preview a deferred value in `src/ui/fieldGroups/FieldGroups.tsx` (lines 307-314)

### Implementation — tree rendering

- [X] T032 [P] [US1] Create hand-rolled fixed-row windowing in `src/ui/VirtualList.tsx` (no new dependency)
- [X] T033 [US1] Stabilize all tree handlers with `useCallback` and pass boolean `selected` / `isDragOver` props instead of the whole `Set` in `src/ui/WorkspaceApp.tsx` and `src/ui/StructureTree.tsx`
- [X] T034 [US1] Wrap `Row` in `React.memo` in `src/ui/StructureTree.tsx` (depends on T033 — memo cannot hit without stable props)
- [X] T035 [US1] Integrate windowing into the tree in `src/ui/StructureTree.tsx`
- [X] T036 [US1] Move `dragOverId` out of React state into a ref with a direct class toggle in `src/ui/StructureTree.tsx`, following the existing `src/ui/Splitter.tsx` pattern
- [X] T037 [P] [US1] Debounce the tree search input (~150 ms) before it feeds `collectVisible` in `src/ui/StructureTree.tsx`
- [X] T038 [US1] Reuse the sorted child arrays computed in `collectVisible` instead of re-sorting per folder during render in `src/ui/StructureTree.tsx`
- [X] T039 [P] [US1] Memoize `contextSummary` on `[state, scope, selectedIds]` in `src/ui/AssistantPanel.tsx` (line 214)
- [X] T040 [US1] Have `createChild` return the new node id in `src/core/tree/operations.ts` and drop the double-index `diffCreatedId` in `src/ui/WorkspaceApp.tsx` (lines 925-934, 362-383)

### Implementation — markdown at scale

- [X] T041 [US1] Gate `renderWorkspace` on per-node identity and key the entry cache by node identity instead of `stableStringify` in `src/core/md/linkRender.ts` (line 71)
- [X] T042 [US1] Batch `crypto.subtle.digest` calls with a bounded pool (8–16) instead of sequential awaits in `src/core/md/linkRender.ts` (lines 68, 75, 85)
- [X] T043 [US1] Add bounded-concurrency reads and skip re-hashing files whose `(size, lastModified)` match the baseline in `src/core/md/scan.ts` (lines 98-150)
- [X] T044 [US1] Pre-bucket `disk` and `baseItems` into `Map`s to remove the two O(n²) matching passes in `src/core/md/reconcile.ts` (lines 134-180)

### Implementation — long operations and lifecycle

- [ ] T045 [US1] Report progress and support cancellation for long scans/imports/exports/pushes in `src/adapters/mdController.ts` and `src/ui/OperationReport.tsx`; where cancellation is unsafe, declare the operation uninterruptible before it starts (FR-003)
- [X] T046 [US1] (FR-005) Satisfied by design — every cache added is a WeakMap (node index, fingerprint memo, markdown entry render), so it is released with the state version it belongs to. Release large working data (indexes, memo caches, rendered state) when the workspace closes in `src/adapters/settingsStore.ts` and `src/index.ts` (FR-005)
- [ ] T047 [US1] (FR-001, FR-002, SC-001, SC-002) Verify all budgets P-1…P-9 pass in `tests/perf/scale.bench.test.ts`

**Checkpoint**: US1 independently testable — the workspace is responsive at target scale.

---

## Phase 4: User Story 2 — Interop Hooks (Priority: P2)

**Goal**: A complete, typed, documented, contract-tested event surface other extensions
can consume.

**Independent Test**: A consumer subscribing to every documented event receives each
exactly once per occurrence across every originating route, with payloads matching
`contracts/hooks.md`.

### Tests (write first, must fail)

- [X] T048 [P] [US2] Contract tests for `wi-workspace:tree-changed` in `tests/contract/hooks.test.ts`: payload shape, exactly-once, and a negative case asserting **no** event for bookkeeping-only deltas (sync status, uid, tombstones, expanded, settings)
- [X] T049 [P] [US2] Contract tests for `wi-workspace:book-pushed` in `tests/contract/hooks.test.ts` covering all five outcomes (`success`, `save-failed`, `conflict-blocked`, `validation-blocked`, `book-missing`)
- [X] T050 [P] [US2] Contract tests for `wi-workspace:root-changed` in `tests/contract/hooks.test.ts` covering all five actions, incl. markdown-restored roots not double-firing
- [X] T051 [P] [US2] Contract tests for `wi-workspace:workspace-shown` / `:workspace-hidden` in `tests/contract/hooks.test.ts`, incl. the already-open-at-init bootstrap and mode switches
- [X] T052 [P] [US2] Containment tests in `tests/contract/hooks.test.ts`: a subscriber that throws and one that blocks cause 0 failed or blocked workspace operations (FR-010, SC-006)
- [X] T053 [P] [US2] Privacy tests in `tests/contract/hooks.test.ts`: serialized payloads contain no entry content, chat text or persona data
- [X] T054 [US2] (SC-005) Integration test in `tests/integration/hooks-routes.test.ts` on the `tests/support/fakeHost.ts` harness: exactly-once per occurrence across **every** route — manual edit, assistant apply, markdown pull, native import, bulk action, delete (FR-009)

### Implementation

- [X] T055 [P] [US2] (FR-007) Declare event names and payload types in `src/core/hooks/events.ts` per `contracts/hooks.md` (closes the FR-008 gap — no `wi-workspace:*` payload is typed anywhere today)
- [X] T056 [US2] Implement the pure previous→next tree diff (create/delete/move/rename/update, with the bookkeeping-only filter) in `src/core/hooks/treeDiff.ts`
- [X] T057 [US2] Create the typed, contained, injectable emitter in `src/adapters/hooks.ts` (`try { void ctx.eventSource.emit(...) } catch { debugLog }`), keeping the `emit?: (event, payload) => void` shape the contract tests inject
- [X] T058 [US2] Migrate the two duplicated inline emit lambdas in `src/adapters/settingsStore.ts` (lines 97, 127) and the call sites in `src/adapters/mdLink.ts` and `src/adapters/assistantApply.ts` to the shared emitter — names and payloads unchanged (FR-011)
- [X] T059 [US2] Add the tree-event diff subscription with microtask coalescing in `src/adapters/settingsStore.ts`, mirroring the existing image-GC subscription that already keeps a `previousState` snapshot
- [X] T060 [US2] Emit `book-pushed` at the five terminal points of `pushBook` in `src/adapters/syncEngine.ts` (success, save-failed, conflict-blocked, validation-blocked, book-missing), only on non-recursive terminal paths
- [X] T061 [US2] Emit `root-changed` inside `designateRoot`, `undesignateRoot`, `deleteRootBook`, `renameRootBook` and `importUnboundBook` in `src/adapters/syncEngine.ts` — never at the callers, and not on the early-return paths
- [X] T062 [US2] Emit `workspace-shown` / `workspace-hidden` in `src/index.ts`, covering the already-open-at-init bootstrap and the Workspace ⇄ native mode switch
- [X] T063 [US2] Export the public event types from `src/global.d.ts` (or a public type entry) so consumers can type payloads
- [X] T064 [US2] (FR-012) Add a check asserting the documented event list and the emitted events match exactly in `tests/contract/hooks.test.ts` (SC-010)

**Checkpoint**: US2 independently testable — the hook surface is complete and contract-tested.

---

## Phase 5: User Story 3 — Documentation (Priority: P2)

**Goal**: A new user can install and use the plugin, and an extension author can write a
consumer, from documentation alone.

**Independent Test**: Someone who has never seen the plugin completes install → first
entry → WI root → confirmed sync → markdown link using only the docs.

- [X] T065 [P] [US3] (SC-007) Write user-facing `README.md`: install, relationship to the native World Info editor, workspace and tree, WI roots and sync semantics, markdown convention and limits (images/folders never export), assistant prerequisites and confirmation model (FR-013)
- [X] T066 [P] [US3] Document environment requirements and known limits in `README.md`: markdown linking only on desktop Chromium over a secure page; the assistant requires the Connection Manager extension (FR-015)
- [X] T067 [P] [US3] Write the extension-author hook reference in `docs/hooks.md` from `contracts/hooks.md`: every event, payload, firing condition, guarantees and the additive-only promise (FR-014)
- [X] T068 [US3] Create `CHANGELOG.md` seeded with one "0.4.11 and earlier" summary entry referencing specs 002–005, per `contracts/maintenance-process.md` (FR-019)
- [X] T069 [US3] Update `AGENTS.md` with the new hook surface, the new modules (`core/state/nodeIndex.ts`, `core/state/sharing.ts`, `core/hooks/**`, `adapters/hooks.ts`, `ui/VirtualList.tsx`, `ui/useDraftField.ts`, `tests/perf/**`) and the structural-sharing store contract
- [X] T070 [US3] Record the docs-updated-in-the-same-change rule (FR-016) in `AGENTS.md` and `specs/006-hardening-interop/contracts/maintenance-process.md`, then verify docs match code — every documented event exists and fires, every documented limit is real — and record the diff result in `specs/006-hardening-interop/quickstart.md` (SC-010)

**Checkpoint**: US3 independently testable — documentation stands alone.

---

## Phase 6: User Story 4 — Maintenance Change Process (Priority: P3)

**Goal**: A small fix is reportable, triageable, fixable and documented without a spec.

**Independent Test**: Run one real fix end to end through the path and verify it produced
a changelog entry with no spec written.

- [X] T071 [US4] Amend `.specify/memory/constitution.md` to 1.3.0: qualify Principle VIII with the bounded maintenance path per `contracts/maintenance-process.md` §7, plus a sync impact report and rationale in the header (Governance requires both) (FR-024)
- [X] T072 [US4] Add the maintenance mechanics to `AGENTS.md`: the contract-based threshold with its worked examples, the report template, changelog and rationale-record formats, and the backlog (FR-017, FR-018, FR-020, FR-021)
- [X] T073 [P] [US4] Create the deferred-items backlog file at `specs/006-hardening-interop/backlog.md` (deferred items only; items fixed immediately never get an entry) (FR-022)
- [ ] T074 [US4] Carry one real fix end to end through the path — report with the template, triage against the threshold, fix, add its `CHANGELOG.md` entry and a regression test — with no spec written (SC-009, FR-023)
- [ ] T075 [US4] Triage a sample set of ≥ 5 changes spanning both sides of the threshold using the written rule alone and record the routing results in `specs/006-hardening-interop/quickstart.md` (SC-009)

**Checkpoint**: US4 independently testable — the process is codified and proven once.

---

## Phase 7: Polish & Live Validation

**Purpose**: Prove the gate on the real app, then release.

- [ ] T076 Run quickstart scenarios H0–H11 (performance at scale, incl. the host-responsiveness-while-closed check) on the local instance and record results in `specs/006-hardening-interop/quickstart.md`
- [ ] T077 Run H12–H13 (correctness at scale, incl. roadmap SC-003's 100-card chat-generation check and the save-failure retry) and record results in `specs/006-hardening-interop/quickstart.md`
- [ ] T078 Run H14–H20 (interop hooks, incl. the throwing/blocking consumer and the documented-vs-emitted diff) and record results in `specs/006-hardening-interop/quickstart.md`
- [ ] T079 Run H21–H26 (documentation and process) and record results in `specs/006-hardening-interop/quickstart.md`
- [ ] T080 [P] Fix every defect found during H0–H26; each live discrepancy in sync behaviour becomes a new scenario in `tests/integration/sync-engine.test.ts` per the project's standing rule
- [ ] T081 Run all four gates: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`, `pnpm run build`
- [ ] T082 Bump `manifest.json` to 0.4.12 and add its `CHANGELOG.md` entry
- [ ] T083 Commit the built bundle `dist/index.js` (tracked in git per the project layout)
- [ ] T084 Record the phase-close result and the SC-008 week-of-use confirmation in `specs/006-hardening-interop/quickstart.md`, and add the delivery amendment to `specs/001-workspace-plugin-roadmap/spec.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — start immediately. Must precede Phase 2 so
  baselines exist.
- **Foundational (Phase 2)**: depends on Setup. **BLOCKS US1 and US2.**
- **US1 (Phase 3)**: depends on Phase 2.
- **US2 (Phase 4)**: depends on Phase 2 only (the tree diff is only viable with
  structural sharing). It does **not** depend on T024: the two post-save updates write
  only sync status and pending state, which the bookkeeping filter (T056) discards, so
  they produce no event either way. US2 is independently deliverable.
- **US3 (Phase 5)**: depends on US2 for `docs/hooks.md` content; the rest of `README.md`
  can be written any time after Setup.
- **US4 (Phase 6)**: **independent of all other stories** — can start immediately after
  Setup, in parallel with anything.
- **Polish (Phase 7)**: depends on all desired stories.

### Critical path

`T001-T004 → T005-T014 (store refactor) → T015-T047 (US1) → T076-T084`

US2, US3 and US4 branch off this spine. US4 is fully independent and is the natural filler
while the store refactor is under test.

### Within each story

- Tests written and failing before implementation
- Core (pure) before adapters before UI
- T033 (stable callbacks) strictly before T034 (memo) — memo cannot hit without it
- T032 (VirtualList) before T035 (integration)
- T055/T056 (types + pure diff) before T057-T062 (emission)

### Parallel Opportunities

- **Phase 1**: T001 is independent of the rest.
- **Phase 2**: T005, T006 in parallel; T007 in parallel with T008.
- **Phase 3**: all tests T015–T020 in parallel; then three independent tracks — sync/core
  (T021–T026), typing/preview (T027–T031), tree rendering (T032–T040) — plus markdown
  (T041–T044).
- **Phase 4**: all contract tests T048–T053 in parallel.
- **Phase 5**: T065, T066, T067 in parallel.
- **Phase 6**: fully parallel with Phases 3–5.

---

## Parallel Example: User Story 1 tests

```bash
# Launch all US1 tests together (they fail until implementation lands):
Task: "Perf budget tests P-5…P-9 in tests/perf/scale.bench.test.ts"
Task: "Draft-field flush semantics in tests/unit/draft-field.test.ts"
Task: "Fingerprint memoization in tests/unit/fingerprint.test.ts"
Task: "Bucketed reconcile equivalence in tests/unit/md-reconcile.test.ts"
Task: "Image-name index in tests/unit/image-links.test.ts"
Task: "Scale invariance in tests/integration/scale-invariance.test.ts"
```

---

## Implementation Strategy

### MVP (US1 only)

1. Phase 1 Setup — measure first
2. Phase 2 Foundational — the root-cause fix, landed alone, full suite green
3. Phase 3 US1 — the responsiveness work
4. **STOP and VALIDATE**: run H0–H11; the workspace is usable on a real library

This is a genuine MVP: the plugin becomes usable at real sizes even if no other story
ships.

### Incremental Delivery

1. Setup + Foundational → measurable, root cause fixed
2. + US1 → responsive at scale (**MVP**, H0–H11)
3. + US2 → other extensions can integrate (H14–H20)
4. + US3 → new users and extension authors can self-serve (H21–H23)
5. + US4 → future fixes are documentable without a spec (H24–H26)
6. Polish → live validation, release 0.4.12

### Risk Control

Phase 2 is the highest-risk change in the codebase — it touches the path every one of the
57 test files exercises. It lands **alone**, with **no intended behavioural change**, and
T013 exists specifically to prove that. If Phase 2 cannot be made green, US2's tree diff
must be re-planned (it depends on identity stability), but US3 and US4 remain deliverable
unchanged.

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks
- Commit after each task or logical group; all four gates pass before every commit
- Every live discrepancy in sync behaviour becomes a scenario in
  `tests/integration/sync-engine.test.ts` (standing project rule)
- Stop at any checkpoint to validate a story independently
