---

description: "Task list for 002-workspace-ui-prototype — Phase 0 UI prototype"
---

# Tasks: Workspace UI Prototype (Phase 0)

**Input**: Design documents from `/specs/002-workspace-ui-prototype/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md
(plus spec 001 artifacts referenced by them)

**Tests**: Sample-dataset contract tests are mandated by constitution V (test-first for
core logic) and contracts C1 — they are written FIRST and must FAIL before the dataset
implementation. UI shell behavior is validated manually via quickstart.md scenarios
(proportionate for a mock-only phase per plan.md).

**Organization**: Tasks are grouped by user story (US1–US5 from spec.md). Foundational
tasks cover the shared pure logic (sample dataset, tree helpers) and the host-shell
adapter that every story renders through.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm the spec 001 baseline before prototype work begins.

- [x] T001 Run all four gates (`pnpm run typecheck && pnpm run lint && pnpm run test && pnpm run build`) and confirm green on the untouched spec 001 baseline; fix nothing — any red gate here blocks the whole feature and must be reported before proceeding.

**Checkpoint**: Baseline green — prototype work may begin.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Pure sample-lore logic (test-first) and the host-shell adapter that all
user stories render through. No user story can start until this phase is complete.

- [x] T002 [P] Write failing contract tests in `tests/unit/sample-dataset.test.ts` per contracts C1 and data-model validation rules: exactly one root; every `parentId` resolves; no cycles; FR-003 minimums (≥ 3 nesting levels, ≥ 10 cards, ≥ 3 notes, ≥ 2 WI roots, ≥ 1 nested WI root); full native field set covered by FieldGroupMap grouping (no orphan fields); ≥ 1 card with `bookMemberships.length >= 2`; ≥ 1 folder with ≥ 30 children; ≥ 1 card with `contentLengthClass: 'long'` (~2,000-word content); all sample text English-only. Run `pnpm run test` and confirm the new tests FAIL (dataset module does not exist yet).
- [x] T003 Implement `src/core/sample/dataset.ts`: the typed `SampleDataset` constant ("Aldermeer" fantasy realm, English) exactly per data-model.md — node kinds folder/card/note with stable uuid ids and `parentId` links, `isWiRoot` + `WiRootSettingsMock` on designated folders (one root nested inside another root), full `NativeWorldInfoEntry` field values on every card (src/global.d.ts type), `bookMemberships` annotations, long-content card, 30+-children folder. Make T002 tests pass (constitution V red→green).
- [x] T004 Implement `src/core/sample/tree.ts` (with tests-first additions in `tests/unit/sample-tree.test.ts`): pure helpers — `sortedChildren(node)` (stable order by `childOrder`), `depthOf(node)`, `wiRootChain(node)` (nested-designation detection), `resolveMemberships(card)` (book names from enclosing/nested WI roots). No app imports; make its tests pass.
- [x] T005 [P] Implement `src/adapters/shell.ts` per contracts C3 — the ONLY host-DOM-composing module: `mountWorkspaceShell()` appends a single `div.wiw-root` into `#WorldInfo` (double-mount guard via `data-wiw-mounted` witness), adds `body.wiw-active`, starts a MutationObserver on `#WorldInfo` attributes `class` + `style` (open/close edges, incl. legacy inline `display: none`), exposes `onOpen`/`onClose` callbacks, registers one `beforeunload` observer cleanup; missing `#WorldInfo` → `console.warn('[WorldInfoWorkspace] ...')` and no-op (graceful degradation). No click interception, no host function patching, no direct host imports.

**Checkpoint**: Foundation ready — dataset + tree helpers are pure and tested; shell
composition isolated. User story implementation may begin.

---

## Phase 3: User Story 1 — Open the Prototype Workspace (Priority: P1) — MVP

**Goal**: The re-bound native World Info entry point opens a fullscreen three-region
workspace surface (tree / editor / assistant) styled entirely by `--SmartTheme*`
variables, with the prototype label and the inert active-books control.

**Independent Test**: quickstart.md Scenario 1 — open via the native WI button (and pin,
outside-click, another-drawer checks), three regions render in the active theme.

### Implementation for User Story 1

- [x] T006 [US1] Create `src/ui/WorkspacePrototype.tsx`: three-region root (header strip + flex row: structure-tree slot, editor slot, assistant slot with visibility toggle); header shows the dataset title, a persistent "PROTOTYPE — nothing is saved" label, and the active-books control slot; local state only (selected node id, assistant visibility); no persistence.
- [x] T007 [P] [US1] Create `src/ui/mount.tsx`: `mountWorkspacePrototype(container)` — `ReactDOM.createRoot(container).render(<WorkspacePrototype />)` fed by the `SampleDataset` from `src/core/sample/dataset.ts` (strict-typed props; no globals).
- [x] T008 [P] [US1] Create `src/styles/prototype.scss` and import it from `src/ui/mount.tsx`: `body.wiw-active` rules (hide `#wi-holder`; fullscreen `#WorldInfo` via `width: 100vw; height: calc(100dvh - var(--topBarBlockSize))`), `.wiw-root` three-region flex layout, header strip, tree/editor/assistant region shells; every color/blur/border/radius from `--SmartTheme*` variables (e.g., `--SmartThemeBorderColor`, `--SmartThemeBodyColor`, `--SmartThemeBlurTintColor`, `--SmartThemeBlurStrength`) — zero fixed colors; narrow-window degradation to stacked scroll (best effort).
- [x] T009 [US1] Wire the init path in `src/index.ts`: after `APP_READY`, call `mountWorkspaceShell()` from `src/adapters/shell.ts`; on shell `onOpen` render `mountWorkspacePrototype` into `.wiw-root` via `src/ui/mount.tsx`; keep the existing APP_READY console.debug line and the idempotency guard.
- [x] T010 [US1] Create `src/ui/ActiveBooksControl.tsx`: inert mock control listing the sample WI roots (`bookName` from `WiRootSettingsMock`) with checkbox-style active toggles that change nothing (contracts C2); mount it in the header slot from T006.
- [x] T011 [US1] Verify quickstart.md Scenario 1 end-to-end in a running SillyTavern (entry-point replacement, close/pin/outside-click, theme variables applied, prototype label visible, no console errors) and run all four gates green.

**Checkpoint**: User Story 1 independently functional — the shell opens as the native
editor's replacement. This is the MVP increment.

---

## Phase 4: User Story 2 — Browse the Sample Lore Tree (Priority: P1)

**Goal**: The structure tree renders the full sample dataset with expand/collapse,
selection, node-type distinction, WI-root markers (incl. nested), membership badges,
scroll and truncation behavior.

**Independent Test**: quickstart.md Scenario 2 — walk the tree; markers, badges,
scrolling, truncation all observable.

### Implementation for User Story 2

- [x] T012 [US2] Create `src/ui/StructureTree.tsx`: recursive tree from `src/core/sample/tree.ts` helpers (sortedChildren, wiRootChain); row click toggles folders / selects nodes; visual distinction of cards vs notes (Font Awesome 6 Free icons per app pattern); WI-root badge and nested-root badge; `bookMemberships` badges on intersection cards; CSS ellipsis truncation for long names; per-folder scroll for the 30+-children folder; selection callback lifts to `WorkspacePrototype`.
- [x] T013 [US2] Verify quickstart.md Scenario 2 in the running app (depth ≥ 3 visible, nested WI-root markers, badges on multi-membership cards, smooth scroll, graceful truncation) and run all four gates green.

**Checkpoint**: Stories 1 AND 2 independently functional.

---

## Phase 5: User Story 3 — Inspect a Sample Card in the Editor (Priority: P1)

**Goal**: The editor region swaps views by node kind: nine field-group sections for
cards, free-form view for notes, per-root settings mock for WI roots; every group
reachable within 2 interactions.

**Independent Test**: quickstart.md Scenario 3 — select card/note/WI-root, check the
nine groups, note view, settings mock, membership visibility.

### Implementation for User Story 3

- [x] T014 [P] [US3] Create `src/ui/fieldGroups/FieldGroups.tsx`: the nine collapsible sections in the fixed order from data-model.md FieldGroupMap (Identity & Content → Automation & Filters), rendering the card's `NativeWorldInfoEntry` fields as read-only inputs populated with sample values; collapsed by default except Identity & Content (≤ 2 interactions to any group per spec SC-003); labels English-only.
- [x] T015 [US3] Create `src/ui/ItemEditor.tsx`: view switch by selected node kind — card → `FieldGroups` view; note → free-form content view; WI-root folder → `WiRootSettingsMock` view (its own book settings per clarification Q2); default selection on first open = first card under the first WI root (contracts C2); empty-selection placeholder text.
- [x] T016 [US3] Verify quickstart.md Scenario 3 in the running app (nine groups, note view, settings mock, membership visibility on a nested-root card) and run all four gates green.

**Checkpoint**: Stories 1–3 independently functional — core review targets (layout,
tree, editor) are all evaluable now.

---

## Phase 6: User Story 4 — Review the Assistant Panel Mock (Priority: P2)

**Goal**: The assistant region shows the scripted conversation: request → reply → batch
proposal preview (several operations, one inert batch confirm/deny) → recommendation
answer, clearly labeled as a mock.

**Independent Test**: quickstart.md Scenario 4 — step through the conversation; no
network calls; state stable across toggles.

### Implementation for User Story 4

- [x] T017 [US4] Create `src/ui/AssistantPanel.tsx`: scripted conversation per data-model PrototypeLayout (user ask → assistant reply → batch proposal preview listing several `AssistantProposal`-style operations with a single inert batch confirm/deny control → recommendation answer referencing existing sample entries); visible "MOCK — no AI calls" labeling; distinct visual styling for the proposal preview (theme variables only); content typed as a local constant array.
- [x] T018 [US4] Verify quickstart.md Scenario 4 in the running app (distinct batch preview, inert controls, state stability across panel toggles, zero network calls in devtools) and run all four gates green.

**Checkpoint**: Stories 1–4 independently functional.

---

## Phase 7: User Story 5 — Record the Visual Direction Decision (Priority: P2)

**Goal**: The built-in review guide (contracts C4) walks the owner through the full
evaluation and the decision (approve / iterate / discard) is recorded — the Phase 0
exit gate.

**Independent Test**: quickstart.md Scenario 5 — complete the guide, switch theme once,
record the decision.

### Implementation for User Story 5

- [x] T019 [US5] Create `src/ui/ReviewGuide.tsx`: overlay/panel with the C4 checklist (layout → tree → editor → assistant → theme fit) rendered from the header toggle; purely presentational (owner records the decision in the review conversation and `specs/002-workspace-ui-prototype/checklists/requirements.md` Notes).
- [x] T020 [US5] Verify quickstart.md Scenario 5: full walkthrough with a theme switch (styling follows the new theme), then run the data-safety check — devtools show zero `/api/worldinfo/*` calls, `extensionSettings` untouched, native editor intact after disabling the extension and reloading — and run all four gates green. STOP: Phase 0 decision gate reached.

**Checkpoint**: Prototype complete; decision recorded → Phase 0 closed.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Documentation and final validation after the decision.

- [x] T021 [P] Update `AGENTS.md`: real Project Structure section (now that `src/core/sample/`, `src/adapters/shell.ts`, `src/ui/*`, `src/styles/prototype.scss` exist), prototype-phase status line, discard-path note (prototype modules are leaves reachable only from `src/index.ts` + `src/ui/mount.tsx` — removal = delete call sites, per spec FR-011).
- [x] T022 Final validation: full four-gate pass plus a complete quickstart.md re-run (Scenarios 1–5 in one sitting) confirming no regressions; report the recorded Phase 0 decision and any iteration notes. Four-gate pass complete; quickstart re-run and decision recording are the owner's in-app steps.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (T001)**: baseline gates — blocks everything on red.
- **Foundational (T002–T005)**: T002 → T003 → T004 (test-first chain); T005 parallel to
  the dataset chain. BLOCKS all user stories.
- **US1 (T006–T011)**: T006 → (T007 ∥ T008) → T009 → T010 → T011. Depends on
  Foundational. MVP increment.
- **US2 (T012–T013)**: depends on US1 (renders in its layout) + Foundational.
- **US3 (T014–T016)**: T014 parallel-startable with US2 tasks (different files);
  T015 → T016 depend on T014 + US1/US2.
- **US4 (T017–T018)**: depends on US1 (panel slot) — may run parallel to US2/US3 if
  staffed; sequential here by priority.
- **US5 (T019–T020)**: depends on US1–US4 (guide reviews everything).
- **Polish (T021–T022)**: T021 after the decision; T022 last.

### Parallel Opportunities

- T002 [P] and T005 [P] start Phase 2 in parallel (different files, no overlap).
- T007 [P] ∥ T008 [P] (mount vs styles) after T006.
- T014 [P] can start alongside Phase 4 tasks (different files, no cross-dependency).
- T021 [P] is documentation-only.

### Parallel Example (Phase 2)

```bash
Task: "T002 failing contract tests in tests/unit/sample-dataset.test.ts"
Task: "T005 shell adapter in src/adapters/shell.ts"
# then sequential: T003 → T004
```

---

## Implementation Strategy

- **MVP first**: Phases 1–3 (Setup + Foundational + US1) yield the openable
  three-region shell — stop and validate (T011) before tree/editor work.
- **Incremental delivery**: each story phase ends with a green-gate + quickstart
  scenario verification (T011, T013, T016, T018, T020) — every checkpoint is a valid
  stopping point.
- **Red→green discipline**: T002/T004 tests are written first and must fail before
  their implementations (constitution V).
- **No empty artifacts**: every task creates complete, functional content; placeholder
  files and empty directories are forbidden (owner rule).
- Commit after each task or tight logical group.

## Notes

- Phase 0 outcome (2026-09-05): all tasks completed, then six owner-review iterations
  refined the prototype (merged entry/image model, tree toolbar + DnD, Essentials/
  Content/Advanced editor, batch proposals with diff modal, mobile sheets with snap
  sizes, splitter). Decision: APPROVED - Phase 0 closed. Follow-up specs proceed per the
  Deferred Work table.

- [P] tasks = different files, no dependencies.
- The shell adapter (`src/adapters/shell.ts`) is the only module touching host DOM —
  keep it that way (constitution II, contracts C3).
- Zero reads/writes of real lorebooks, settings, or chat data at any point (spec FR-008).
- All UI text and sample content English-only (constitution IX).
- Stop at the T020 checkpoint: the recorded decision closes Phase 0.
