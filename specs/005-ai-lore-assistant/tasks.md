---
description: "Task list for AI Lore Assistant — roadmap Phase 2 (005-ai-lore-assistant)"
---

# Tasks: AI Lore Assistant (Roadmap Phase 2)

**Input**: Design documents from `/specs/005-ai-lore-assistant/` (plan.md, spec.md,
research.md, data-model.md, contracts/, quickstart.md)

**Prerequisites**: all listed documents are present in `specs/005-ai-lore-assistant/`.

**Tests**: INCLUDED — constitution V (test-first for pure core logic) and VI
(integration + contract tests) mandate them; research.md R14 enumerates the suites.
Every test task precedes its implementation task and must fail first (red → green).

**Organization**: Setup → Foundational (request path end to end) → US3 Connection &
context settings (P1) → US4 Failure recovery (P1) → US1 Generate & edit entries (P1) →
US2 Reorganize + batch undo (P1) → US5 Conversations (P2) → US6 Discuss &
recommendations (P3) → Polish. US3/US4 come first among the P1 stories because every
other story needs a selectable profile and a resilient request path (plan Delivery Order).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1–US6)
- All paths are project-relative; single-project layout per plan.md

## Path Conventions

- `src/core/assistant/**` — pure logic, no app/browser-global imports (ports injected)
- `src/adapters/**` — app and browser boundary (`getContext()`, IndexedDB, events)
- `src/ui/**` — React components; styles only via `src/styles/wiw-theme.scss`
- `tests/unit|integration|contract/**`, fakes in `tests/support/**`, recorded replies in
  `tests/fixtures/assistant/**`

## Key rules for every task (from clarifications and research)

- **Never apply unaccepted operations** (FR-028); every mutation goes through the existing
  pure tree ops + `src/adapters/workspaceActions.ts` (FR-011) — never `store.update` directly.
- **Identity** by per-request handles → node ids (R5), never by names.
- **Requests** only via `ConnectionManagerRequestService.sendRequest`; never
  `generateRaw`/`generateQuietPrompt`, never the main `abortController`, never credentials
  (R1). Streaming follows the profile's preset (R2).
- **Protocol** exactly per `contracts/assistant-protocol.md`; tolerant, block by block (R3).
- **Destructive** = deletion, content removal > 50 %, or any keyword removed (FR-010).
- **Storage**: settings in `extensionSettings['WorldInfoWorkspace'].assistant`;
  conversations only in IndexedDB `WorldInfoWorkspace-assistant` (clarification).
- **Broken blocks** (owner, 2026-09-15): compact count notice; raw excerpts only on
  request; "Regenerate with the same context" re-sends the stored `requestMessages`.
- UI text English; styles extend the shared system (constitution IX, amendment 1.2.0).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Types, typed app surfaces, test fakes and fixtures the whole feature relies on

- [ ] T001 [P] Create `src/core/assistant/types.ts` with every type of `data-model.md`: `AssistantSettings`, `ContextSettings` (scope union), `Conversation`, `Message` (+ `MessageStatus` = `'pending' | 'receiving' | 'received' | 'failed' | 'stopped' | 'retry-wait'`), `ContextSnapshot` (incl. `handles`, `scopeNodeIds`, `included`, `omitted: OmittedPart[]`, `estimatedTokens`, `requestMessages: LlmMessage[]`), `ProposalBatch` (with `unparsed`), `OperationProposal`, `OperationType`, `ProposedValues`, `Decision` (`'pending' | 'accepted' | 'denied' | 'blocked' | 'stale' | 'invalid' | 'applied' | 'reverted' | 'failed' | 'superseded'`), `AppliedBatch`, `AppliedItem` with the `inverse` union, `AssistantFailure` (`kind` union from data-model), plus `DEFAULT_ASSISTANT_SETTINGS` (`profileId: null`, `responseTokens: 2000`, `contextTokens: 16000`, `instructions: null`, `defaultContext` = selection scope, outline on, everything else off)
- [ ] T002 [P] Create `src/core/assistant/ports.ts` exactly per `contracts/llm-port.md` (`ProfileApi`, `ProfileInfo`, `LlmAvailability`, `LlmMessage`, `LlmRequest`, `LlmEvent`, `LlmPort`) plus `ConversationStorePort` (`available(): boolean`, `listConversations(): Promise<Conversation[]>`, `getConversation(id)`, `putConversation(c)`, `deleteConversation(id)` (also deletes its messages), `listMessages(conversationId): Promise<Message[]>`, `putMessage(m)`, `deleteMessagesAfter(conversationId, seq)`) and `ChatContextPort` (`chatMessages(count): { name: string; isUser: boolean; text: string }[]`, `characterCard(): { name: string; description: string; personality: string; scenario: string } | null`, `persona(): { name: string; description: string } | null`, `activatedEntries(): { bookName: string; uid: number }[]`, `onChatChanged(listener): () => void`)
- [ ] T003 [P] Extend `src/global.d.ts` with the typed app surfaces used by this feature (source: `context/SillyTavern/public/scripts/extensions/shared.js:388-783`, `custom-request.js:481-531`, `connection-manager/index.js:160-181`, `events.js:81-84`): `ConnectionProfile` (`id`, `mode: 'cc' | 'tc'`, `name`, `api`, `preset?`, `model?`, `instruct?`, `'secret-id'?` …), `ConnectionManagerRequestServiceApi` (`sendRequest(profileId, prompt: LlmMessage[] | string, maxTokens, custom?: { stream?; signal?; extractData?; includePreset?; includeInstruct? }, overridePayload?): Promise<{ content: unknown; reasoning?: string } | (() => AsyncGenerator<{ text: string; state: { reasoning: string } }>)>`, `getSupportedProfiles(): ConnectionProfile[]`, `getProfile(id)`), `getPresetManager(apiId: string): { getCompletionPresetByName(name: string): Record<string, unknown> | undefined } | undefined`, `chat: { name: string; is_user: boolean; is_system?: boolean; mes: string }[]`, `name1`, `name2`, `getCharacterCardFields(): { description; personality; scenario; persona; … }`, `extensionSettings.disabledExtensions` access typing, event type names `CONNECTION_PROFILE_CREATED/UPDATED/DELETED/LOADED`, `WORLD_INFO_ACTIVATED`; all on `SillyTavernContext` without `any`
- [ ] T004 [P] Create `tests/support/fakeLlm.ts`: `FakeLlm implements LlmPort` with scripted scenarios — `stream(chunks: string[], { delayMs?, reasoning? })`, `reply(text)`, `fail(failure)`, `failTimes(n, failure).then(reply)`, `hang()` (only terminates on abort); records every `LlmRequest` for assertions; mutable profile list with `emitProfilesChanged()`; `availability` switchable to `connection-manager-disabled`
- [ ] T005 [P] Create `tests/support/memoryConversationStore.ts` (`MemoryConversationStore implements ConversationStorePort`, `available()` configurable) and `tests/support/fakeChatContext.ts` (`FakeChatContext implements ChatContextPort` with setters and `emitChatChanged()`)
- [ ] T006 [P] Create fixtures in `tests/fixtures/assistant/`: `probe-2026-09-15-router.txt` (the live reply recorded in research.md R3: five blocks — create_folder `new1` under `f3`, move `e2` → `new1`, two create_entry under `new1`, edit_entry `e1` content — with interleaved prose), `truncated.txt` (last `<op` unclosed), `fenced.txt` (blocks inside ```` ``` ```` fences), `think.txt` (`<think>…</think>` prefix + one block), `unknown-field.txt` (`<fields>sideways=1</fields>`), `broken-quotes.txt` (`parent=f3 ref='new1>`), `garbage.txt` (prose only with stray `</op>`), and `outline-aldermeer.ts` exporting a small `WorkspaceState` (root → Aldermeer WI root `f1` → Cities `f2` with Bristlemark `e1` + Bristlemark Taverns `e2`, Hearth & Home `f3`, one image) with fixed node ids

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: LLM client, conversation storage, settings schema, controller skeleton and a
minimal working panel — a text request goes out and a streamed text reply comes back.
Blocks ALL user stories.

**⚠ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T007 [P] Write failing contract tests `tests/contract/llm-client.test.ts` against a fake `ConnectionManagerRequestService` + fake `getPresetManager` mirroring `shared.js`/`custom-request.js` shapes, covering the 7 guarantees of `contracts/llm-port.md`: disabled Connection Manager short-circuit without calling `getSupportedProfiles`; profile mapping (`cc` → `chat-completion`, `tc` → `text-completion`, `streaming` from `stream_openai` / `streaming` of the named preset, fallback when the preset is missing); `sendRequest` called with `{ stream, signal, extractData: true, includePreset: true, includeInstruct: true }` and no override payload; streaming → throttled `progress` (accumulated text) + one `done`; non-streaming `{ content, reasoning }` → one `done`; error unwrapping of `Error('API request failed', { cause })` and classification (429 text → `rate-limit`, abort → `aborted`, `Failed to fetch` → `network`, profile errors → `profile`, empty → `empty`, other → `provider`); timeout (fake timers) aborts and emits `timeout`; exactly one terminal event
- [ ] T008 [P] Write failing unit tests `tests/unit/assistant-failures.test.ts` for `src/core/assistant/failures.ts`: `classifyError(error, { aborted })` per research R7 table incl. nested `cause`, `Got response status 429`, OpenRouter `"temporarily rate-limited upstream"` text; `readableMessage(kind)` English texts from `contracts/assistant-ui-contract.md`; `retryPolicy(kind, attempt)` → `{ delayMs: 10000 }` for attempt 1 and `{ delayMs: 30000 }` for attempt 2 on `rate-limit`/`network`, `null` otherwise and after 2 attempts
- [ ] T009 Implement `src/core/assistant/failures.ts` to pass T008
- [ ] T010 Implement `src/adapters/llmClient.ts` (`createLlmClient(getContext)` → `LlmPort`) to pass T007, using `failures.ts`; `onProfilesChanged` subscribes to `CONNECTION_PROFILE_CREATED/UPDATED/DELETED` via `eventSource.on` and returns a remover (`removeListener`); progress throttle 100 ms; timeouts 90 s (no chunk while streaming) / 180 s (non-streaming) via an internal `AbortController` linked to the request signal
- [ ] T011 [P] Write failing unit tests in `tests/unit/state-schema.test.ts` (extend): `migrate` keeps payloads without `assistant` valid and exposes defaults through `getAssistantSettings(state)`; valid `assistant` objects round-trip; out-of-range values (`responseTokens: 5`, `contextTokens` < `responseTokens + 500`, unknown scope kind) are repaired to defaults field by field; `deepValidateState` accepts the optional block; `canSaveAssistantSettings(state, recoveredUnpublished)` returns false while a fresh recovery is unpublished (spec FR-035, research R10 recovery guard)
- [ ] T012 Add optional `assistant?: AssistantSettings` to `WorkspaceSettings` (next to `sortMode`) in `src/core/state/schema.ts` with `getAssistantSettings(state)` and repair in `migrate`, plus a pure immutable `setAssistantSettings(state, patch)` op in the new file `src/core/assistant/settingsOps.ts` to pass T011
- [ ] T013 [P] Write failing integration tests `tests/integration/conversation-store.test.ts` after adding devDependency `fake-indexeddb` (`pnpm add -D fake-indexeddb`, tests only — never imported from `src/`): run the shared `runConversationStoreSuite(factory)` (exported from the test file) against `MemoryConversationStore` and against `createIndexedDbConversationStore()` with `import 'fake-indexeddb/auto'`; guarantees: put/get/list ordering by `updatedAt` desc, messages ordered by `seq`, `deleteConversation` removes messages, `deleteMessagesAfter`, values are structured-clone copies (mutating a returned object does not change storage)
- [ ] T014 Implement `src/adapters/conversationStore.ts`: `createIndexedDbConversationStore()` (DB `WorldInfoWorkspace-assistant` v1, stores `conversations` keyPath `id`, `messages` keyPath `['conversationId', 'seq']` with index `byConversation`; `openDb`/`withStore` pattern copied from `src/adapters/fsaDisk.ts`), `createMemoryConversationStore()` (move the test memory implementation here and re-export from `tests/support/memoryConversationStore.ts`), and `openConversationStore()` returning IndexedDB when available else memory with `available() === false`; per-conversation debounced writes (500 ms) with `flush(conversationId)`
- [ ] T015 [P] Write failing integration tests `tests/integration/assistant-controller.test.ts` (foundational part) with `FakeLlm` + `MemoryConversationStore` + a real `WorkspaceStore` (fixture state): `createConversation()` copies `defaultContext`; `send(conversationId, text, mode)` stores the user message, creates an assistant message `pending` → `receiving` (streaming) with growing `text` and `receivedChars` → `received`; non-streaming stays `pending` with `startedAt` for elapsed time; `stop()` aborts → `stopped` keeping partial text; only one active request per conversation (second `send` rejected); subscribers notified; messages persisted and `flush` called on terminal status; each assistant message records `origin` `{ profileId, profileName, api, model }` (FR-034)
- [ ] T016 Implement `src/adapters/assistantController.ts` skeleton to pass T015: `createAssistantController({ store, llm, conversations, chat, getSettings, updateSettings, newId, now, emit })` exposing an observable snapshot (`useSyncExternalStore`-compatible `subscribe`/`getSnapshot`: `availability`, `conversations`, `activeConversationId`, `messages`, `activeRequest`), `createConversation`, `selectConversation`, `send`, `stop`; for now builds messages as `[system: default instructions (discuss mode text from contracts/assistant-protocol.md), ...history, user]` without workspace context (context builder arrives in US1)
- [ ] T017 Wire services in `src/adapters/settingsStore.ts`: build `llm` (`createLlmClient`), `conversations` (`openConversationStore`), `chat` (temporary stub returning empty context until T068), `assistant` (`createAssistantController`) into `WorkspaceStateServices`; event emitter via `ctx.eventSource.emit`
- [ ] T018 Move mock-only styles `.wiw-bubble*`, `.wiw-proposal*`, `.wiw-decision*`, `.wiw-assistant*` from `src/styles/prototype.scss` into shared primitives in `src/styles/wiw-theme.scss` and add: streaming footer (`.wiw-assistant-status`), composer (`.wiw-assistant-composer`), banner variants reuse existing banner primitive, badge variants (`destructive`, `duplicate`, `stale`, `blocked`, `invalid`)
- [ ] T019 Rewrite `src/ui/AssistantPanel.tsx` (remove all mock data/PROPOSALS/DiffModal code) as the region root reading the controller snapshot: header with placeholder conversation title and [+] new conversation, `src/ui/assistant/ConversationView.tsx` (user/assistant bubbles, assistant prose rendered through the existing markdown preview renderer `src/core/preview.ts` without placeholder substitution, collapsed "Thinking" section when `reasoning` is non-empty), `src/ui/assistant/Composer.tsx` (textarea, Enter sends / Shift+Enter newline on desktop, Send ↔ Stop button, Propose/Discuss toggle stored per conversation), status footer per `contracts/assistant-ui-contract.md` ("Waiting for the model… 12 s" with a 1 s ticking timer, "Receiving… 1 240 chars"); keep both mount sites in `src/ui/WorkspaceApp.tsx` (desktop aside and mobile sheet) working

**Checkpoint**: with a profile id set manually in settings, a discuss-mode request streams a reply into the panel.

---

## Phase 3: User Story 3 — Choose the Connection and Control What the Assistant Sees (Priority: P1)

**Goal**: The user picks the assistant's profile and limits and edits instructions; the
region explains every unavailable state (FR-018–FR-020, FR-024; context options UI lands
in US6 for chat sources and here for scope).

**Independent Test**: Select each owner profile in turn and send the same request — the
request goes through the selected profile, the main chat connection stays; delete the
selected profile → banner; disable Connection Manager → banner, rest of workspace works
(quickstart A0, A1).

- [ ] T020 [P] [US3] Extend `tests/integration/assistant-controller.test.ts`: availability states — `connection-manager-disabled` → composer disabled state in snapshot; no `profileId` or id not in `profiles` → `no-profile`; profile deleted while selected (FakeLlm `emitProfilesChanged`) → `no-profile` without throwing; Text Completion profile → `textCompletionWarning: true`; `updateSettings({ profileId })` persists through the workspace store (settings op from T012) and `send` uses it; while the workspace is in unresolved recovery (`_recovered` present and unpublished) `updateSettings` is refused, the store is not replaced, and the snapshot exposes `settingsLocked: true`; limits passed as `maxTokens`; custom `instructions` replace the default system text and `resetInstructions()` restores `null`
- [ ] T021 [US3] Implement availability, profile selection, limits and instructions in `src/adapters/assistantController.ts` to pass T020 (subscribe to `llm.onProfilesChanged`; settings written via `store.replace(setAssistantSettings(...))` wrapped in a new `updateAssistantSettings(deps, patch)` helper (no sync-engine effects; refuses while `isFreshRecovery` is unpublished — expose the flag from `src/adapters/settingsStore.ts` as `isRecoveryPending()`) in `src/adapters/workspaceActions.ts` so settings saves follow the normal debounced persistence)
- [ ] T022 [P] [US3] Create `src/ui/assistant/SettingsMenu.tsx`: gear-button popover (reuse the menu/overlay primitives and portal-into-`.wiw-surface` approach of `src/ui/MarkdownControl.tsx`) with profile `<select>` grouped "Chat Completion" / "Text Completion" showing name + model and a streaming badge (`fa-wave-square` on/off), inline best-effort warning for Text Completion, number inputs for response length and context size (validated ranges from data-model, commit on change), instructions `<textarea>` prefilled with the default text when `null`, [Reset to default]; read-only with the recovery note from `contracts/assistant-ui-contract.md` when `settingsLocked`; the Text Completion warning names a missing instruct template (`profile.instruct` empty)
- [ ] T023 [US3] Add availability banners to `src/ui/AssistantPanel.tsx` with the exact texts of `contracts/assistant-ui-contract.md` (Connection Manager disabled; choose a profile + button opening SettingsMenu; conversations cannot be saved when `conversations.available() === false`) and disable the composer in blocking states
- [ ] T024 [P] [US3] Write failing unit tests `tests/unit/assistant-scope.test.ts` for `resolveScope(state, settings.scope, selection)` in `src/core/assistant/scope.ts`: `selection` → selected folder, or selected item's parent folder, or root when nothing selected; `folders` → union of subtrees, missing ids dropped and reported; `workspace` → root; returns `{ folderIds, nodeIds: Set<string>, dropped: string[] }`
- [ ] T025 [US3] Implement `src/core/assistant/scope.ts` to pass T024
- [ ] T026 [US3] Create `src/ui/assistant/ContextMenu.tsx` (scope part): context chip under the composer ("Scope: Cities · outline") opening a popover with scope radio (selection / chosen folders with a folder checklist from the tree / whole workspace) and outline toggle; changes stored in the active conversation's `context` via controller `updateConversationContext(patch)` (add to `src/adapters/assistantController.ts`); [Save as default for new conversations] writes the conversation's context into `AssistantSettings.defaultContext` via `updateSettings` (locked during recovery); `src/ui/WorkspaceApp.tsx` passes the current selection ids to `AssistantPanel`

**Checkpoint**: US3 independently testable (quickstart A0, A1). Acceptance scenario 3 (trimming notice) is verified after US1 delivers the context builder (T039, quickstart A16).

---

## Phase 4: User Story 4 — Recover from AI Failures Without Losing Work (Priority: P1)

**Goal**: Every failure is readable, retryable, stoppable; auto-retry bounded and visible;
the request text is never lost; nothing applies (FR-026, FR-028, FR-029).

**Independent Test**: Rate-limited Gemma profile, response length 150, and Stop mid-stream —
readable status, request kept, retry works, tree unchanged (quickstart A7–A9, A19).

- [ ] T027 [P] [US4] Extend `tests/integration/assistant-controller.test.ts`: `FakeLlm.failTimes(2, rate-limit).then(reply)` → message goes `failed` → `retry-wait` (snapshot exposes `retryAt`) → retried automatically twice with 10 s / 30 s (fake timers) → `received`; a third rate limit stays `failed` with manual `retry()`; `stop()` during `retry-wait` cancels the countdown; `retryNow()` skips the wait; `provider` failure → no auto retry, `retry()` re-sends the SAME `requestMessages`; `timeout` → failed, retryable; the workspace store state is reference-equal before and after every failure path; a hanging assistant request does not block a parallel `send` in another conversation
- [ ] T028 [US4] Implement retry state machine, `retry`, `retryNow`, cancel-on-stop and `requestMessages` storage in `ContextSnapshot` in `src/adapters/assistantController.ts` to pass T027 (retry policy from `src/core/assistant/failures.ts`)
- [ ] T029 [P] [US4] Create `src/ui/assistant/FailureCard.tsx`: readable reason, countdown "Retrying in 30 s" with [Cancel] / [Retry now] for `retry-wait`, [Retry] for retryable failures, collapsible provider detail; rendered by `ConversationView.tsx` under the failed assistant message; the user message stays visible

**Checkpoint**: US4 independently testable (quickstart A7, A8; A19 in the live run T077; A9 after US1 parser).

---

## Phase 5: User Story 1 — Generate and Edit Entries by Conversation (Priority: P1) 🎯 MVP

**Goal**: Propose-mode requests carry workspace context; replies become create/edit entry
proposals with preview, diff, edit-before-accept, feedback revisions, staleness and
duplicate hints; accepted items apply like manual edits (FR-005–FR-009, FR-011, FR-013,
FR-014, FR-016, FR-017, FR-021, FR-023–FR-025, FR-027).

**Independent Test**: Request three entries in a selected folder and an edit of an existing
entry; accept some, deny others — only accepted changes persist and reach the native book
(quickstart A2–A5, A9, A11, A17).

### Tests for User Story 1 ⚠️ write first, must fail

- [ ] T030 [P] [US1] Write failing unit tests `tests/unit/assistant-protocol.test.ts` per `contracts/assistant-protocol.md` "Parser rules" 1–8 using the fixtures of T006: router probe → 5 blocks with correct types/attributes/tags and prose segments; think tags moved to `reasoning` (closed and unclosed-at-start while streaming); fenced blocks recognized and fences dropped from prose; verbatim values (`&`, `<b>` kept); content newline trimming; keys split/dedupe; `fields` parsing incl. enum names, booleans, `null`, unknown field → malformed with reason; broken quotes tolerated or reported; unknown `type` / missing required attribute → `malformed-block` with ≤ 200-char excerpt while later blocks still parse; truncated → `unparsed: truncated`; incremental `feed()` over every possible chunk split of the router fixture yields the same final result and never exposes a partial block; `[[e1]]` references extracted
- [ ] T031 [P] [US1] Write failing unit tests `tests/unit/assistant-handles.test.ts`: `buildHandleMap(state, scope)` assigns `f`/`e`/`i` + running numbers in tree order, stable for the same state, reverse lookup; unknown handle → `undefined`
- [ ] T032 [P] [US1] Write failing unit tests `tests/unit/assistant-context.test.ts` for `buildRequest(input)`: message order (system instructions + protocol text for the mode → outline → in-scope items → optional sources placeholder → history → request); outline lines `handle | kind | name — keys/caption/World Info root` with indentation; in-scope entries list only non-default fields using `FIELD_SPECS` names (no `wi_` prefix); images as caption only; budget with `estimateTokens = ceil(chars / 3.5)` against `contextTokens - responseTokens`; trimming order from research R6 produces the documented `omitted` entries; returns `ContextSnapshot` with `handles`, `scopeNodeIds`, `included`, `estimatedTokens`, `requestMessages`; a 300-entry generated workspace builds in < 200 ms
- [ ] T033 [P] [US1] Write failing unit tests `tests/unit/assistant-validate.test.ts` for `toProposals(blocks, snapshot, state)`: create_entry/edit_entry per the required-attributes table; parent must be an in-scope folder or earlier ref; out-of-scope or unknown handle → `invalid` with reason; name validation via `validateName`; field values via Phase 1 `validateNode` on a trial entry (e.g. `probability=250` invalid); no-op edit dropped with a notice; `baseline` recorded (`updatedAt` + fingerprint of touched fields); `dependsOn` from refs; duplicate refs → later block invalid
- [ ] T034 [P] [US1] Write failing unit tests `tests/unit/assistant-rules.test.ts`: `isDestructive(before, after)` — content removal > 50 % of old content characters via `diffLines` (exactly 50 % not destructive), any primary or secondary keyword removed → destructive, additions never destructive; `findDuplicate(proposal, state, scope)` — case-insensitive title match or shared primary key within the same WI root scope (for entries outside any WI root: across the whole workspace); `isStale(proposal, state)` — `updatedAt`/fingerprint mismatch or target missing
- [ ] T035 [P] [US1] Write failing integration tests `tests/integration/assistant-apply.test.ts` (entries part) on the FakeHost harness of `tests/integration/sync-engine.test.ts` (extract the harness factory into `tests/support/fakeHost.ts` if it is not exported yet): applying accepted create_entry under a WI root creates the node via `createChild` + field commits, marks the book dirty, and after the engine's push the native book contains the entry with title/keys/content/fields; edit_entry applies only touched fields and marks books dirty; `userEdited` values win over `values`; stale proposal at accept → not applied, returns `stale` with fresh diff data; apply emits `wi-workspace:assistant-applied` with payload per `contracts/hooks.md`; linked-markdown auto-push is triggered through the normal store subscription (assert via a spy on the md link notify path used by manual edits)

### Implementation for User Story 1

- [ ] T036 [P] [US1] Extend `tests/contract/hooks.test.ts` with the `wi-workspace:assistant-applied` payload contract per `contracts/hooks.md` (fields and types; no prompt text or profile data; nothing emitted for a failed apply with zero applied operations) — constitution VI: lands in the same change as the emitter T042
- [ ] T037 [US1] Implement `src/core/assistant/protocol.ts` to pass T030: `createProtocolParser()` with `feed(accumulated: string)` and `finish()` returning `{ prose: ProseSegment[]; blocks: ParsedBlock[]; unparsed; reasoning; references: string[] }`, plus exported model-facing text constants `PROPOSE_PROTOCOL_TEXT` and `DISCUSS_PROTOCOL_TEXT` copied verbatim from the contract
- [ ] T038 [P] [US1] Implement `src/core/assistant/handles.ts` to pass T031
- [ ] T039 [US1] Implement `src/core/assistant/prompts.ts` (default instructions text focused on evocative lore writing for small models; decision-note formatter stub used in US5) and `src/core/assistant/context.ts` to pass T032
- [ ] T040 [US1] Implement `src/core/assistant/validate.ts` to pass T033 (create_entry, edit_entry; other op types return `invalid: "not supported yet"` until US2)
- [ ] T041 [P] [US1] Implement `src/core/assistant/rules.ts` to pass T034
- [ ] T042 [US1] Implement `src/adapters/assistantApply.ts` (entries part) to pass T035: `applyProposals({ store, sync, emit }, batch, proposalIds)` validates staleness, applies in reply order via `workspaceActions.applyTreeChange` with `createChild` + `commitEntryField` for each set field (title through `renameNode`/`comment`), records `AppliedItem`s with inverses (`delete-created`, `restore-fields`) and `afterUpdatedAt`, stops on the first failure recording `failed` (FR-028), emits the applied event
- [ ] T043 [US1] Integrate propose mode into `src/adapters/assistantController.ts`: build the request with `context.ts` (scope from `scope.ts`, selection from the panel), store `ContextSnapshot` on the assistant message, run the incremental parser on every `progress` (exposing completed proposals while streaming), on `done` finalize `ProposalBatch` (validate → rules → decisions `pending`/`invalid`), detect `truncated` (unclosed trailing `<op` block — no finish reason is available, research R7); actions `accept(messageSeq, proposalId)`, `deny`, `editProposal(proposalId, values)`, `acceptAll(messageSeq)` (non-destructive pending only), `continueReply(messageSeq)` (appends assistant prefix turn and concatenates text before re-parsing), `regenerate(messageSeq, { sameContext })` — `false` rebuilds context from the current tree (FR-004), `true` re-sends `requestMessages` unchanged and reuses handles/scope (FR-027); both replace the assistant message keeping `previousText`, remove later messages via `deleteMessagesAfter`, and carry over already-applied `AppliedBatch` records, `askToFix(messageSeq)` (follow-up turn quoting validation/unparsed reasons), `feedback(messageSeq, text, proposalId?)` (revision turn for the whole batch or one proposal; revised proposals mark the originals `superseded`); add these regenerate/feedback cases to `tests/integration/assistant-controller.test.ts` before implementing
- [ ] T044 [P] [US1] Create `src/ui/assistant/ProposalCard.tsx`: op icon (reuse the mock's icon map), summary with tree path of target/parent, badges (destructive, duplicate → "Similar to <name>", stale, invalid + reason), Accept / Deny / Edit / Diff / Feedback (inline input calling `feedback(messageSeq, text, proposalId)`) buttons with disabled states per decision; create_entry preview shows title, keys, fields list and content rendered through the preview renderer
- [ ] T045 [P] [US1] Create `src/ui/assistant/ProposalEditor.tsx`: modal editing title, keys (comma list), secondary keys, content, and scalar fields present in the proposal; saves via controller `editProposal`
- [ ] T046 [P] [US1] Create `src/ui/assistant/ProposalDiff.tsx`: per-field before/after using `src/ui/DiffView.tsx` (content as line diff, scalar fields as one-line rows), also used for the stale refresh
- [ ] T047 [US1] Create `src/ui/assistant/BatchBar.tsx` (Accept all pending / Deny all pending / Feedback… input) and `src/ui/assistant/ReplyNotices.tsx`: context notice ("Sent: … Omitted: …" from `ContextSnapshot.omitted`); truncated notice with [Continue] [Regenerate]; [Regenerate] also in the assistant message footer; collapsed "Previous version" when `previousText` is set; broken-blocks notice "N operation blocks could not be used." with [Show broken blocks] (collapsed list of raw excerpts + reasons) and [Regenerate with the same context], plus [Ask to fix] when zero proposals are valid; wire proposals, bar and notices into `ConversationView.tsx`
- [ ] T048 [US1] Render `[[handle]]` references in assistant prose as item links in `src/ui/assistant/ConversationView.tsx` (resolve through the message's `ContextSnapshot.handles`; click selects the node and opens it in the editor via a callback from `src/ui/WorkspaceApp.tsx`; missing node → `notifyWarning` from `src/adapters/logger.ts`: "This item no longer exists")

**Checkpoint**: MVP — US1 independently testable (quickstart A2–A5, A9, A11, A17).

---

## Phase 6: User Story 2 — Reorganize the Tree with the Assistant + Batch Undo (Priority: P1)

**Goal**: Folder creation, rename, move and delete proposals with dependency ordering,
blocked state, destructive confirmation with full disclosure, and undo of any applied batch
(FR-006, FR-010, FR-012, FR-015, FR-036).

**Independent Test**: Request a reorganization creating a folder, moving entries into it,
renaming a folder, deleting one entry — deletion not applied by Accept all; after
confirmation tree and native books match; undo a batch after editing one item → partial
revert with report (quickstart A6, A12–A14, A20).

### Tests for User Story 2 ⚠️ write first, must fail

- [ ] T049 [P] [US2] Extend `tests/unit/assistant-validate.test.ts`: create_folder, rename, move, delete per the required-attributes table; move into own subtree / no-op move / delete or rename of the workspace root → invalid; ref used as move parent must be a folder creation
- [ ] T050 [P] [US2] Write failing unit tests `tests/unit/assistant-plan.test.ts` for `src/core/assistant/plan.ts`: `applyOrder(proposals)` topological (folder creations → entry creations → moves → renames → edits → deletions; ties keep reply order); `blockedBy(proposals)` marks dependents of denied/invalid/failed proposals `blocked` with the dependency's summary and returns them to `pending` when the dependency is re-accepted; `acceptAllSelection(batch)` = pending, non-destructive, with dependencies accepted/applied or inside the selection
- [ ] T051 [P] [US2] Write failing unit tests `tests/unit/assistant-undo.test.ts` for `src/core/assistant/undo.ts`: `planUndo(appliedBatch, state)` walks items in reverse; skips items whose node `updatedAt` ≠ `afterUpdatedAt` or whose restore parent no longer exists, with reasons; produces steps for all five inverse kinds; `delete-created` of a folder whose later-added children exist → skipped
- [ ] T052 [P] [US2] Extend `tests/integration/assistant-apply.test.ts`: folder creation + entry creation inside via ref + move of an existing WI-root entry out of the root (native entry removed at next push via Phase 1 move-out tombstone rules) in one accept-all; delete proposal applied only through `confirmDestructive` and records tombstones exactly like the manual delete (reuse the assertions style of sync-engine scenarios); partial failure mid-batch (inject a rejecting tree op) → earlier items applied and recorded, later not, `failed` set; undo of a batch with one item edited afterwards → others reverted, skipped reported, native books follow after push, `wi-workspace:assistant-undone` payload per contract; re-inserting a deleted entry restores it into its book

- [ ] T053 [P] [US2] Extend `tests/contract/hooks.test.ts` with the `wi-workspace:assistant-undone` payload contract per `contracts/hooks.md` (`reverted`/`skipped` node id arrays) — lands in the same change as the emitter T059
- [ ] T054 [P] [US2] Write failing integration tests `tests/integration/delete-nodes.test.ts` on the FakeHost harness for the CURRENT delete behavior before extraction: tombstones recorded before the change for every synced uid (folders recursively), root-book keep/delete question for WI roots, linked-folder note in the confirmation label, affected books marked dirty — written against the new `deleteNodes`/`describeDeletion` API with a thin wrapper that T055 provides, so the same tests guard the refactor

### Implementation for User Story 2

- [ ] T055 [US2] Extract the delete flow from `src/ui/WorkspaceApp.tsx` (confirmation label with linked-files note, `collectEntityDeletions`, `sync.recordEntityDeletions`, root-book keep/delete question, `bulkDeleteNodes` via `applyTreeChange`) into `deleteNodes(deps, ids, { confirm, preconfirmed?, rootBooks? })` plus `describeDeletion(state, ids)` (affected items incl. descendants, books, linked files) in `src/adapters/workspaceActions.ts`; make `WorkspaceApp.tsx` call it with no behavior change (T054 green)
- [ ] T056 [US2] Extend `src/core/assistant/validate.ts` for create_folder/rename/move/delete to pass T049, and set `destructive` for deletions
- [ ] T057 [P] [US2] Implement `src/core/assistant/plan.ts` to pass T050
- [ ] T058 [P] [US2] Implement `src/core/assistant/undo.ts` to pass T051
- [ ] T059 [US2] Extend `src/adapters/assistantApply.ts` to pass T052: ordering via `plan.ts`; ops via `createChild('folder')`, `renameNode`, `moveNode` (effects `structure: true`), `deleteNodes` from T055 (called with `preconfirmed: true` after the assistant's own confirmation); inverses `restore-name`, `restore-position` (parent + index captured before the move), `reinsert` (deep subtree snapshot + index); `undoBatch(deps, conversationId, batch)` executing `planUndo` steps through the same tree ops (re-insert through a new pure op `insertSubtree(state, parentId, index, subtree)` added to `src/core/tree/operations.ts` with a unit test in `tests/unit/tree-operations.test.ts`) and emitting the undone event
- [ ] T060 [US2] Controller support in `src/adapters/assistantController.ts`: blocked recomputation after every decision, `acceptAll` via `acceptAllSelection`, `confirmDestructive(messageSeq, proposalId)` (shows `describeDeletion` text for deletions or the diff summary for destructive edits through `src/adapters/popups.ts`), `undoBatch(messageSeq, batchId)` with result toast via `src/adapters/logger.ts` `notifyInfo`/`notifyWarning`: "Reverted N changes; M skipped (edited since)"
- [ ] T061 [US2] UI: blocked and destructive states in `src/ui/assistant/ProposalCard.tsx` ("Blocked: needs <summary>", "Confirm delete…" / "Confirm edit…" button instead of Accept), move/rename previews (source → destination path, old → new name), deletion preview listing affected items; after Accept all scroll the first remaining destructive card into view; [Undo batch] per `AppliedBatch` with skipped details in `src/ui/assistant/BatchBar.tsx`

**Checkpoint**: US1 + US2 cover the roadmap phase gate (quickstart A6, A12–A14, A20).

---

## Phase 7: User Story 5 — Keep and Continue Conversations (Priority: P2)

**Goal**: Conversations persist with decisions and undo records, can be created,
switched, renamed, deleted; denied ideas are not re-proposed (FR-031–FR-033).

**Independent Test**: Conversation with applied and denied proposals, reload, reopen —
intact; second conversation, switch back; "more ideas" avoids denied ones (quickstart A15).

- [ ] T062 [P] [US5] Write failing unit tests `tests/unit/assistant-decisions.test.ts` for `decisionNote(batch)` in `src/core/assistant/prompts.ts`: compact English note listing accepted/denied/applied/undone proposals by op + title, "(do not propose again unless asked)" for denied; empty batch → no note
- [ ] T063 [P] [US5] Extend `tests/integration/assistant-controller.test.ts`: controller restart over the same `MemoryConversationStore` restores conversations, messages, batches with decisions and applied batches; pending proposals of a restored batch are re-validated for staleness on accept; history sent in a later request includes `note` messages after decided batches; `renameConversation` (non-empty), `deleteConversation` (removes messages, selects the most recent remaining or none); conversation titles default to the first 60 chars of the first request; per-conversation `context` and `mode` persist
- [ ] T064 [US5] Implement `decisionNote` in `src/core/assistant/prompts.ts` and history assembly with notes in `src/core/assistant/context.ts` (notes count toward the budget, older turns trimmed first per R6) to pass T062
- [ ] T065 [US5] Implement restore on controller init, rename, delete, title defaulting, note messages after decisions/undo, and store flushes on decision/apply in `src/adapters/assistantController.ts` to pass T063
- [ ] T066 [US5] Create `src/ui/assistant/ConversationSwitcher.tsx` (dropdown in the region header: list with title + relative updated time, new, rename inline, delete with confirmation via `src/adapters/popups.ts`) and mount it in `src/ui/AssistantPanel.tsx`

**Checkpoint**: US5 independently testable (quickstart A15).

---

## Phase 8: User Story 6 — Discuss and Get Lore Recommendations for the Current Chat (Priority: P3)

**Goal**: Optional chat, character card, persona and activated-entries context; discuss
mode answers with clickable references (FR-003, FR-005, FR-015 roadmap, FR-022).

**Independent Test**: Active chat, chat + activated entries enabled, discuss "Which entries
matter for this conversation?" → prose with working references, no proposals (quickstart A10).

- [ ] T067 [P] [US6] Write failing unit tests in `tests/unit/assistant-context.test.ts` (extend): optional sources rendered when enabled — last N chat messages as `Name: text` (system messages skipped), character card block, persona block, activated entries mapped to workspace entries through `sync.books[bookName].uid` and listed as handles (unmatched ones reported as "not in workspace"); chat messages trimmed oldest first; discuss mode uses `DISCUSS_PROTOCOL_TEXT` and the controller ignores any blocks (they are dropped from prose with a notice)
- [ ] T068 [P] [US6] Write failing contract tests `tests/contract/chat-context.test.ts` for `src/adapters/chatContext.ts` against a fake context: `chatMessages(n)` reads `getLiveAppContext().chat` (fresh per call), `characterCard()` via `getCharacterCardFields()` and `name2` (null without an open character), `persona()` from `name1` + `powerUserSettings.persona_description`, `activatedEntries()` caches the last `WORLD_INFO_ACTIVATED` payload (`world` + `uid`) and clears it on `CHAT_CHANGED`
- [ ] T069 [US6] Implement `src/adapters/chatContext.ts` to pass T068 and replace the stub in `src/adapters/settingsStore.ts`
- [ ] T070 [US6] Implement optional sources and discuss-mode handling in `src/core/assistant/context.ts` and `src/adapters/assistantController.ts` to pass T067
- [ ] T071 [US6] Extend `src/ui/assistant/ContextMenu.tsx` with chat message count (0 = off), character card, persona and activated entries toggles, and update the context chip summary ("chat 10 · card · persona · activated")

**Checkpoint**: US6 independently testable (quickstart A10).

---

## Phase 9: Polish & Cross-Cutting Concerns

- [ ] T072 [P] Scale check: add a generated 300-entry workspace case to `tests/unit/assistant-context.test.ts` (whole-workspace scope, 8000-token limit → within budget, omitted list non-empty, < 200 ms) and a 50-operation reply case to `tests/unit/assistant-protocol.test.ts` (parse + validate < 50 ms)
- [ ] T073 Typing responsiveness while streaming: throttle controller snapshot notifications to ≤ 10 per second during `receiving` and memoize `ConversationView` message rows so only the streaming row re-renders, in `src/adapters/assistantController.ts` and `src/ui/assistant/ConversationView.tsx`; verify editor typing during a stream in the live app (SC-007)
- [ ] T074 Mobile layout pass: composer, proposal cards, menus and ProposalEditor inside the mobile bottom sheet (`src/ui/Sheet.tsx` mount in `src/ui/WorkspaceApp.tsx`), using existing sheet sizes; fix via shared primitives in `src/styles/wiw-theme.scss`
- [ ] T075 Update `AGENTS.md`: project structure (`src/core/assistant/`, new adapters, `src/ui/assistant/`, tests/fixtures/support), Settings section (`assistant` block), assistant semantics section (request channel, streaming from preset, protocol, handles, destructive rule, undo, broken blocks + same-context regenerate, IndexedDB `WorldInfoWorkspace-assistant`), hooks (`assistant-applied`, `assistant-undone`), mark spec 005 as the current increment
- [ ] T076 Bump version to `0.4.0` in `manifest.json` and `package.json`; run all four gates (`pnpm run typecheck`, `pnpm run lint`, `pnpm run test`, `pnpm run build`) and commit `dist/index.js`
- [ ] T077 Live validation: run quickstart A0–A21 on `openrouter free provider` and `openrouter small gemma free` (dev account, `playwright-cli`), including the parallel main-chat check A19 (FR-029), record results and the SC-005 valid-proposal rate in a "Validation runs" section of `specs/005-ai-lore-assistant/quickstart.md`; every discrepancy becomes a failing test before its fix

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: depends on Setup — BLOCKS all user stories
- **US3 (Phase 3)**: after Foundational
- **US4 (Phase 4)**: after Foundational (independent of US3 except the shared controller file — sequence T021 before T028)
- **US1 (Phase 5)**: after US3 (scope resolver T025, settings) and US4 (`requestMessages`, retry state in T028)
- **US2 (Phase 6)**: after US1 (validate/apply/controller proposal flow)
- **US5 (Phase 7)**: after US1 (batches/decisions exist); undo records from US2 are persisted if US2 is done
- **US6 (Phase 8)**: after US1 (context builder, references); independent of US2/US5
- **Polish (Phase 9)**: after the desired stories

### Within stories

- Tests first (marked "write first") → pure core → adapters → controller → UI
- `src/adapters/assistantController.ts` is touched by T016, T021, T026, T028, T043, T060, T065, T070, T073 — never in parallel
- `tests/integration/assistant-controller.test.ts` is extended by T015, T020, T027, T063 — sequential

### Parallel Opportunities

- Phase 1: T001–T006 all parallel
- Phase 2: T007, T008, T011, T013, T015 parallel; then T009 → T010; T012; T014; T016 → T017; T018 parallel with T016
- US3: T020, T022, T024 parallel
- US4: T027, T029 parallel
- US1: T030–T036 parallel; then T038, T041 parallel with T037; T044, T045, T046 parallel after T043
- US2: T049–T054 parallel; T057, T058 parallel
- US5: T062, T063 parallel
- US6: T067, T068 parallel
- Polish: T072, T074 parallel

---

## Parallel Example: User Story 1

```bash
# Tests together (all different files):
Task: "T030 [US1] tests/unit/assistant-protocol.test.ts"
Task: "T031 [US1] tests/unit/assistant-handles.test.ts"
Task: "T032 [US1] tests/unit/assistant-context.test.ts"
Task: "T033 [US1] tests/unit/assistant-validate.test.ts"
Task: "T034 [US1] tests/unit/assistant-rules.test.ts"
Task: "T035 [US1] tests/integration/assistant-apply.test.ts"
Task: "T036 [US1] tests/contract/hooks.test.ts"

# Then independent pure modules:
Task: "T037 [US1] src/core/assistant/protocol.ts"
Task: "T038 [US1] src/core/assistant/handles.ts"
Task: "T041 [US1] src/core/assistant/rules.ts"

# UI components after the controller integration (T043):
Task: "T044 [US1] src/ui/assistant/ProposalCard.tsx"
Task: "T045 [US1] src/ui/assistant/ProposalEditor.tsx"
Task: "T046 [US1] src/ui/assistant/ProposalDiff.tsx"
```

---

## Implementation Strategy

### MVP First

1. Phase 1 Setup → Phase 2 Foundational (streamed discuss replies work)
2. Phase 3 US3 (profile + limits + scope) → Phase 4 US4 (failures) → Phase 5 US1
3. Validate quickstart A0–A5, A7–A9, A11, A17 → usable AI lore writing with review

### Incremental Delivery

1. + US2 reorganization and batch undo → roadmap Phase 2 gate (A6, A12–A14, A20)
2. + US5 conversations → multi-session work (A15)
3. + US6 discuss with chat context → recommendations (A10)
4. Polish → scale, mobile, AGENTS.md, version, live runs on both owner profiles

### Notes

- Commit after each task or tight logical group; all four gates must pass before a commit
- Never mutate the workspace outside `workspaceActions`; never apply unaccepted proposals
- Gemma free is frequently rate-limited upstream — use the router profile for functional
  checks and Gemma for failure-path checks
- Every live discrepancy found in validation becomes a failing test before the fix
