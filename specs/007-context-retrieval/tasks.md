---
description: "Task list for Context & Retrieval — roadmap Phase 6 (007-context-retrieval)"
---

# Tasks: Context & Retrieval (Roadmap Phase 6)

**Input**: Design documents from `/specs/007-context-retrieval/` (plan.md, spec.md,
research.md R1–R14, data-model.md, contracts/, quickstart.md C0–C40)

**Tests**: INCLUDED — constitution V (test-first for pure core logic) and VI (integration
and contract tests). Every test task precedes its implementation task and must fail first.

**Organization**: Setup (live fixtures, types) → Foundational (summary field and context
items, used by every story) → US1 Preview (P1, MVP) → US2 Summaries + catalog (P1) →
US3 Fuzzy/sets/truncation (P2) → US4 Interop (P2) → US5 Main-chat picking (P2) → Polish.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US5 (spec.md)
- Paths are project-relative; single-project layout per plan.md

## Key rules for every task

- `src/core/**` is pure: no `getContext()`, no DOM, no app imports.
- All app access goes through `src/adapters/**` and is typed in `src/global.d.ts`.
- UI styling only through `src/styles/wiw-theme.scss` primitives; English strings;
  Font Awesome icons.
- Interop availability is checked lazily (at menu open / request build), never once at
  init (research R14).
- Documentation moves with the code (AGENTS.md rule): a task that changes documented
  behaviour updates README / `docs/hooks.md` / AGENTS.md in the same task.
- Four gates (`typecheck`, `lint`, `test`, `build`) green before every commit.

---

## Phase 1: Setup (Live Fixtures and Types)

**Purpose**: Real data for the interop scenarios and the app types every story needs.

- [x] T001 Prepare a DeepLore test vault: copy `/home/JRCD/apps/obsidian/main/Егоровское/Панацея/DtF` to `.live/vault-dtf/` (git-ignored via `.live/`), add `lorebook` tags to a sample of notes in the copy only, and record the setup in `.live/README-fixtures.md`
- [x] T002 Serve the vault to DeepLore: if a running Obsidian with the Local REST API plugin is not available, write `.live/obsidian-rest-mock.mjs` (Node, no dependencies) implementing the endpoints DeepLore calls (`context/sillytavern-DeepLore/src/vault/obsidian-api.js`: auth check, list files, read note, write note) over `.live/vault-dtf/`, and configure DeepLore on the `dev` account to use it; record port/key in `.live/README-fixtures.md`
- [x] T003 Create Memory Books test data on the `dev` account: a chat with an existing character, a chat-bound lorebook, ≥ 3 memories created through Memory Books with a working free connection profile; record chat/book names in `.live/README-fixtures.md`
- [x] T004 Create Doom's Enhancement Suite tracker data on the `dev` account: at least one tracked turn so `chatMetadata.dooms_tracker.committedTrackerData` (or `lastGeneratedData`) lists present characters; record the chat in `.live/README-fixtures.md` (if the tracker cannot run on the available API, write a recorded tracker payload into the chat metadata and note that it is synthetic)
- [x] T005 [P] Extend `src/global.d.ts`: events `WORLDINFO_FORCE_ACTIVATE`, `WORLDINFO_ENTRIES_LOADED` (payload `{ globalLore, characterLore, chatLore, personaLore }`), `WORLD_INFO_ACTIVATED`, `MESSAGE_RECEIVED`, `CHARACTER_MESSAGE_RENDERED`, `MESSAGE_SWIPED`, `WORLDINFO_SETTINGS_UPDATED`, `WORLDINFO_UPDATED`; `SlashCommandParser.commands`; chat message `extra` / `swipe_id` / `swipe_info[].extra`; `getWorldInfoPrompt`; interceptor signature type `GenerateInterceptor`

---

## Phase 2: Foundational (Summary Field + Context Items)

**Purpose**: The summary (R1/R2) and typed context items (R3) are used by US1, US2, US4
and US5. **No user story starts before this phase is complete.**

### Tests (write first, must fail)

- [x] T006 [P] Unit tests for summary accessors (`getSummary`, `setSummary` — blank removes the key, trims, >300 flagged) and fingerprint inclusion in `tests/unit/entry-summary.test.ts`
- [x] T007 [P] Unit tests for `wi_summary` export/import incl. hoisting out of `wi_extensions`, omitting empty `wi_extensions`, conflict (both present) reported, files without the key unchanged, in `tests/unit/md-convention.test.ts` (folder `pickExcluded` stays workspace-only — not in markdown, decided 2026-10-07)
- [x] T008 [P] Integration summary round-trip matrix (R13) on FakeHost + memory disk: editor set → reload; push → native entry has `extensions.wiw_summary`; native edit of another field → summary kept; native edit of the summary → pulled; markdown export → import; export → edit file → pull; character-book conversion helper round trip in `tests/integration/summary-roundtrip.test.ts`
- [x] T009 [P] Unit tests for `ContextItem` production in `buildRequest`: one item per sent part with kind/reason/detail/tokens/state; omitted items with `omitReason`; items equal what the request text contains in `tests/unit/assistant-context.test.ts`

### Implementation

- [x] T010 Add summary accessors and the 300-char soft limit in `src/core/tree/summary.ts` (pure; reads/writes `node.native.extensions.wiw_summary`)
- [x] T011 Add `wi_summary` to the field table and the export/import mapping in `src/core/md/convention.ts` (and `src/core/md/reference.ts` sample); update `specs/004-markdown-folder-sync/contracts/markdown-convention.md` with a "Phase 6 additions" section pointing to `specs/007-context-retrieval/contracts/markdown-convention-delta.md`
- [x] T012 Add `pickExcluded?: boolean` to `FolderNode` and its load repair in `src/core/state/schema.ts`; document both additions in `specs/003-core-workspace-mvp/contracts/persistence-schema.md`
- [x] T013 Add `ContextItem` and the new `ContextSettings` fields (`catalog`, `fuzzy`, `sources`) with defaults and repair in `src/core/assistant/types.ts` and the settings/conversation repair paths (`src/core/assistant/settingsOps.ts`, `src/adapters/conversationStore.ts`)
- [x] T014 Produce `items` in `buildRequest` and store them in `ContextSnapshot.items` in `src/core/assistant/context.ts` (reasons: selected, scope, key with matching key, recursion with step/source from `src/core/assistant/triggers.ts`, option, history)
- [x] T015 Make T008 pass end to end: ensure `src/core/sync/fingerprint.ts` covers `extensions` and `src/core/sync/import.ts` keeps `extensions.wiw_summary` on clean-side pulls

**Checkpoint**: summaries persist everywhere; every request carries typed items.

---

## Phase 3: User Story 1 — See What the Assistant Sees (Priority: P1) 🎯 MVP

**Goal**: Preview before sending; the same view for any sent request (FR-001–FR-003).

**Independent Test**: quickstart C0–C3.

### Tests (write first, must fail)

- [x] T016 [P] [US1] Controller test: `previewContext(conversationId, draft)` returns the items the next `send` stores, byte-identical request text in `tests/integration/assistant-controller.test.ts`

### Implementation

- [x] T017 [US1] Add `previewContext` (builds without sending) to `src/adapters/assistantController.ts` and expose it through `src/ui/assistant/useAssistant.ts`
- [x] T018 [US1] Create `src/ui/assistant/ContextPreview.tsx` (groups Included / Truncated / Left out; reason chip + detail; ≈tokens; totals vs budget) with styles in `src/styles/wiw-theme.scss`
- [x] T019 [US1] Add "Preview context" to `src/ui/assistant/ContextMenu.tsx` and a "Context" action on sent messages in `src/ui/assistant/ConversationView.tsx` (snapshot items; older messages without items show the old summary)
- [x] T020 [US1] Document the preview in `README.md` (assistant section)

**Checkpoint**: US1 independently usable (MVP).

---

## Phase 4: User Story 2 — Summaries and Catalog Selection (Priority: P1)

**Goal**: Summary editing, assistant-written summaries, catalog mode with read/open rounds
(FR-004–FR-009; protocol v2).

**Independent Test**: quickstart C4–C19.

### Tests (write first, must fail)

- [x] T021 [P] [US2] Unit tests for catalog lines and folder narrowing (fits → entry catalog; too big → folder lines + top-ranked entries; excluded/disabled left out; summary vs quoted excerpt; ≈tokens) in `tests/unit/assistant-catalog.test.ts`
- [x] T022 [P] [US2] Parser tests for v2: `read`/`open` blocks (ids lists, unknown handles), `summary` tag in create/edit, empty summary clears, waiting state, streaming chunk boundaries in `tests/unit/assistant-protocol.test.ts` with new fixtures `tests/fixtures/assistant/v2-read-rounds.txt`, `v2-round-limit.txt`, `v2-summary-edit.txt`
- [x] T023 [P] [US2] Validation tests: catalog-mode edit of an unread entry → "read the entry first"; summary-only edit valid; no-op summary dropped in `tests/unit/assistant-validate.test.ts`
- [x] T024 [P] [US2] Context tests for Auto/On/Off: Auto uses the catalog only when full text overflows; Off/fit = request identical to the pre-phase snapshot in `tests/unit/assistant-context.test.ts`
- [x] T025 [US2] Controller tests for read rounds with `FakeLlm`: fulfil reads, continuation appended to the same reply, max 3 rounds then "No more reads", Stop mid-round, items gain `catalog-read` in `tests/integration/assistant-controller.test.ts`

### Implementation

- [x] T026 [P] [US2] Summary field (counter, warning >300) in the Essentials group of `src/ui/fieldGroups/FieldGroups.tsx`; tree tooltip with the summary in `src/ui/StructureTree.tsx`
- [x] T027 [P] [US2] Create `src/core/assistant/catalog.ts` (catalog lines, folder narrowing, excerpt quoting, ranking hook for R5)
- [x] T028 [US2] Extend `src/core/assistant/parser.ts` with `read`/`open` blocks and the `summary` tag; `src/core/assistant/protocol.ts` and `src/core/assistant/prompts.ts` with the v2 model-facing text; bump the protocol doc: copy the delta into `specs/005-ai-lore-assistant/contracts/assistant-protocol.md` as "v2"
- [x] T029 [US2] Extend `src/core/assistant/validate.ts` (read-before-edit rule, summary values) and `src/adapters/assistantApply.ts` (apply/undo summary edits through tree ops)
- [x] T030 [US2] Catalog mode in `src/core/assistant/context.ts` (Auto/On/Off, catalog section, handles for catalog lines, `<workspace-read>` block builder)
- [x] T031 [US2] Read rounds in `src/adapters/assistantController.ts` (reuse the Continue path, visible status "Reading N entries… (round k/3)", stoppable, max 3) and the status line in `src/ui/assistant/ConversationView.tsx`
- [x] T032 [US2] Catalog Auto/On/Off control in `src/ui/assistant/ContextMenu.tsx`
- [x] T033 [US2] Document summaries, catalog mode and `wi_summary` in `README.md` and `src/ui/MappingReference.tsx`

**Checkpoint**: large libraries usable; summaries editable by hand and by the assistant.

---

## Phase 5: User Story 3 — Fuzzy, Context Sets, Truncation (Priority: P2)

**Goal**: FR-010–FR-012.

**Independent Test**: quickstart C2 (truncation), C20–C23.

### Tests (write first, must fail)

- [x] T034 [P] [US3] BM25 tests: tokenization (Unicode, case), prefix stem, ranking, threshold 0.5, cap 5, memo by fingerprint, 1000-entry build < 100 ms in `tests/unit/assistant-bm25.test.ts`
- [x] T035 [P] [US3] Truncation tests: sentence ends (`.!?…。！？`, blank line), min share max(50 tok, 25 %), "[…]" marker, keptShare in `tests/unit/assistant-truncate.test.ts`
- [x] T036 [P] [US3] Context-set tests: repair (unique names, ≤ 50, invalid dropped), apply copies values + records name, missing folders reported, later edits do not change snapshots in `tests/unit/assistant-context-sets.test.ts`

### Implementation

- [x] T037 [P] [US3] Create `src/core/assistant/bm25.ts`; use it for fuzzy additions in `src/core/assistant/context.ts` (reason `fuzzy`, after key-triggered) and for catalog ranking in `src/core/assistant/catalog.ts`
- [x] T038 [P] [US3] Create `src/core/assistant/truncate.ts` and apply it to the last non-fitting entry in `src/core/assistant/context.ts`
- [x] T039 [P] [US3] Create `src/core/assistant/contextSets.ts`; persist `settings.assistant.contextSets` via `src/adapters/settingsStore.ts` (not while recovery is pending)
- [x] T040 [US3] Fuzzy toggle and context-set UI (apply / save as / rename / delete; set name on the context chip) in `src/ui/assistant/ContextMenu.tsx`
- [x] T041 [US3] Document fuzzy matches and context sets in `README.md`

---

## Phase 6: User Story 4 — Interop (Priority: P2)

**Goal**: FR-013–FR-018; Memory Books protection is the part that must not be skipped.

**Independent Test**: quickstart C24–C31 on the Phase 1 fixtures.

### Tests (write first, must fail)

- [x] T042 [P] [US4] Memory Books detection tests: kinds (memory, tier N, side prompt/tracker, clip) from fields and title suffixes; numbered prefix rule accepting both `NNN - ` and `[NNN] - ` (research R14) in `tests/unit/interop-memory-books.test.ts`
- [x] T043 [P] [US4] Sync-engine scenario: a bound book with Memory Books entries — content edit keeps every `STMB_*`/`stmemorybooks` field byte-identical; tree reorder leaves native `displayIndex`/`order` unchanged; other entries still follow tree order — new scenario in `tests/integration/sync-engine.test.ts`
- [x] T044 [P] [US4] Doom's tracker extraction tests (present cast from `committedTrackerData`/`lastGeneratedData` `characterThoughts` given as array OR JSON string, absent `present` = present, `present === false` dropped, location from `infoBox.location.value` also as JSON string; only-`knownCharacters` → unavailable; malformed → unavailable) in `tests/unit/interop-dooms-tracker.test.ts`

### Implementation

- [x] T045 [P] [US4] Create `src/core/interop/memoryBooks.ts` and `src/core/interop/doomsTracker.ts` (pure)
- [x] T046 [US4] Memory Books order exception in `src/core/sync/flatten.ts`; update `AGENTS.md` "World Info sync" with the exception (contracts/native-sync-delta.md)
- [x] T047 [US4] Memory Books badges in `src/ui/StructureTree.tsx` and `src/ui/NodeHeader.tsx`; rename confirmation when a `[NNN]` prefix would be removed in the rename path (`src/ui/NodeHeader.tsx` / `src/adapters/popups.ts`)
- [x] T048 [US4] Create `src/adapters/interopSources.ts` (lazy detection; DeepLore `deepLoreEnhanced_matchText` with empty-result handling; Doom's tracker from fresh `chatMetadata`; Memory Books command availability via `SlashCommandParser.commands` and execution via `executeSlashCommandsWithOptions`)
- [x] T049 [US4] Interop sources in the request: "Scene cast" and "DeepLore matches" items (reason `interop`) in `src/core/assistant/context.ts` fed by the controller from `src/adapters/interopSources.ts`; scene cast as a ranking hint for catalogs
- [x] T050 [US4] Source toggles (only when detected) in `src/ui/assistant/ContextMenu.tsx`; "Create memory (Memory Books)" action in the bound book folder's header menu (`src/ui/ItemEditor.tsx`)
- [x] T051 [US4] Document interop (what each needs, what it does, AGPL note: data only) in `README.md`

---

## Phase 7: User Story 5 — AI-Chosen Entries for Main-Chat Generation (Priority: P2)

**Goal**: FR-019–FR-026; contracts/main-chat-picking.md.

**Independent Test**: quickstart C32–C40.

### Tests (write first, must fail)

- [x] T052 [P] [US5] Pick-line parser tests (tolerant prose, unknown ids → ignored, duplicates, cap `maxPicks`) in `tests/unit/picking-parser.test.ts`
- [x] T053 [P] [US5] Decision tests: prepared used when new text has no unpicked mentions; fresh when it does; no prepared → fresh; continue → reused in `tests/unit/picking-decide.test.ts`
- [x] T054 [P] [US5] Forced-entry tests: full clone + `world` + `decorators: []`, leading `@@` lines stripped, disabled/excluded never produced, empty pick → no emit in `tests/unit/picking-forced.test.ts`
- [x] T055 [P] [US5] Picking request tests (system rules, recent chat, scene block, catalog within `catalogTokens`, folders as groups) in `tests/unit/picking-request.test.ts`
- [x] T056 [US5] Interceptor integration with a fake eventSource mirroring `world-info.js` forced-activation handling: off ⇒ 0 LLM calls and 0 emits; quiet/impersonate skipped; timeout ⇒ resolves within `timeoutSec + 1 s` and forces the prepared pick; chat change discards; result attached to `extra.wiw_pick` and the swipe; `inserted` filled from `WORLD_INFO_ACTIVATED`; `pick-completed` emitted in `tests/integration/picking.test.ts`
- [x] T057 [P] [US5] Contract tests: manifest has `generate_interceptor: "wiwPickInterceptor"` in `tests/manifest.test.ts`; `docs/hooks.md` ↔ `WI_EVENTS` includes `pick-completed` in `tests/contract/hooks.test.ts`

### Implementation

- [x] T058 [P] [US5] Create `src/core/picking/pickParser.ts`, `src/core/picking/decide.ts`, `src/core/picking/forced.ts`, `src/core/picking/request.ts` (reuse `catalog.ts`, `bm25.ts`, `triggers.ts`)
- [x] T059 [US5] `settings.picking` (data-model.md defaults and ranges) repair in `src/core/state/schema.ts` and bridge in `src/adapters/settingsStore.ts`; per-chat `chatMetadata.WorldInfoWorkspace.picking` read/write via `saveMetadataDebounced`
- [x] T060 [US5] Create `src/adapters/pickingController.ts`: active-entries cache from `WORLDINFO_ENTRIES_LOADED` with invalidation and dry `getWorldInfoPrompt` refresh; background preparation on `CHARACTER_MESSAGE_RENDERED`; `wiwPickInterceptor`; emit `WORLDINFO_FORCE_ACTIVATE`; record on `MESSAGE_RECEIVED`; `inserted` from `WORLD_INFO_ACTIVATED`; toast on fallback
- [x] T061 [US5] Register `globalThis.wiwPickInterceptor` in `src/index.ts` and add `"generate_interceptor": "wiwPickInterceptor"` to `manifest.json`
- [x] T062 [US5] Add `wi-workspace:pick-completed` to `src/core/hooks/events.ts` (`WI_EVENTS`) and emit it from `src/adapters/pickingController.ts` via `src/adapters/hooks.ts`; document it in `docs/hooks.md` and the AGENTS.md hook table
- [x] T063 [US5] Create `src/adapters/pickIndicator.ts` (icon in `#message_template .mes_buttons .extraMesButtons`, shown on messages with `extra.wiw_pick`, toggled on render/swipe/chat load; delegated click → app popup with details and "Pick fresh next time")
- [x] T064 [US5] Create `src/ui/PickingSettings.tsx` (global default, profile, timeout, chat messages, max picks, catalog size; per-chat toggle) reachable from the workspace header menu; folder "Exclude from lore picking" toggle in `src/ui/ItemEditor.tsx`
- [x] T065 [US5] Document lore picking (cost: extra model call per turn, prepared vs fresh, fallback, requirements) in `README.md`

---

## Phase 8: Polish & Live Validation

- [ ] T066 Perf check: preview build for the 1000-entry scale dataset < 150 ms and interceptor overhead with picking off < 1 ms, added to `tests/perf/scale.bench.test.ts`
- [ ] T067 Update `AGENTS.md` (current increment, structure: `core/picking`, `core/interop`, new adapters; settings `picking`, `contextSets`; protocol v2) and `specs/001-workspace-plugin-roadmap/spec.md` delivery note
- [ ] T068 Run live scenarios C0–C23 on the `dev` account and record results in `specs/007-context-retrieval/quickstart.md`
- [ ] T069 Run live scenarios C24–C31 on the Phase 1 fixtures and record results in `specs/007-context-retrieval/quickstart.md`
- [ ] T070 Run live scenarios C32–C40 with the free profile and record results in `specs/007-context-retrieval/quickstart.md`
- [ ] T071 Fix every defect found in T068–T070; each live sync discrepancy becomes a scenario in `tests/integration/sync-engine.test.ts`
- [ ] T072 Run all four gates; bump `manifest.json` to 0.5.0; add the `CHANGELOG.md` entry (Added: preview, summaries, catalog, fuzzy, sets, interop, lore picking); build and commit `dist/index.js`

---

## Dependencies & Execution Order

### Phase dependencies

- Phase 1 (fixtures T001–T004) is needed only for live runs (T069) — implementation may
  start in parallel; T005 blocks everything that touches the new app types.
- Phase 2 blocks all stories.
- US1 (Phase 3) has no story dependency — the MVP.
- US2 (Phase 4) depends on Phase 2; uses the US1 preview to show catalog reasons (T031
  can land before T018, the preview simply shows the new reasons later).
- US3 (Phase 5): T037 extends `catalog.ts` from US2 (T027) — do US2 first.
- US4 (Phase 6): independent of US2/US3 except T049's catalog hint (needs T027).
- US5 (Phase 7): needs `catalog.ts` (T027), `bm25.ts` (T037) and the summary (Phase 2).
- Polish after all stories.

### Critical path

T005 → T006–T015 → T021–T033 → T034–T037 → T052–T065 → T068–T072.

### Within each story

Tests first (fail) → pure core → adapters → UI → docs.

### Parallel opportunities

- T001–T004 (fixtures) alongside all code work.
- T006–T009 (foundational tests) in parallel.
- US2 tests T021–T024; US3 tests T034–T036; US4 tests T042–T044; US5 tests T052–T055 and
  T057 — each group in parallel.
- US4 core (T045) in parallel with US3 implementation.

## Parallel Example: User Story 5 tests

```text
T052 picking-parser.test.ts   T053 picking-decide.test.ts
T054 picking-forced.test.ts   T055 picking-request.test.ts   T057 manifest/hooks contract
```

## Implementation Strategy

### MVP (US1 only)

Phase 1 T005 → Phase 2 → Phase 3: the preview alone makes every later context change
visible and checkable.

### Incremental delivery

1. Foundation + US1 → commit (gates green).
2. US2 (summaries + catalog) → commit; run the summary matrix C4–C12 live early (owner
   requirement: test it thoroughly).
3. US3 → commit. 4. US4 → commit (Memory Books protection before badges/buttons).
5. US5 → commit. 6. Polish, live validation, release 0.5.0.

### Risk control

- Summary in native entries: T008 matrix + C4–C12 before any release.
- Main-chat path: picking off must be provably inert (T056, C32) before anything else
  in US5 is enabled by default — it stays off by default.
- Memory Books: T043 before T047 (protection before UI).
