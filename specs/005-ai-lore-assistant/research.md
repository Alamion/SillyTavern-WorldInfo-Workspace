# Research: AI Lore Assistant (Roadmap Phase 2)

Sources: vendored app source `context/SillyTavern/` (paths below are relative to it),
reference extension `context/SillyTavern-WorldInfo-Recommender/`, live probes against the
owner's OpenRouter profiles (2026-09-15), and the delivered code of specs 003/004.

## R1. Request channel

**Decision**: every assistant request goes through
`getContext().ConnectionManagerRequestService.sendRequest(profileId, messages, maxTokens,
{ stream, signal, extractData: true, includePreset: true, includeInstruct: true },
overridePayload)` (`public/scripts/extensions/shared.js:419`), wrapped by a single adapter
`src/adapters/llmClient.ts` behind a pure `LlmPort` (contract `contracts/llm-port.md`).

**Rationale**:
- Uses the profile the user picks, independent of the main chat connection (FR-018); the
  server resolves the key from the profile's `secret-id` — the plugin never sees
  credentials (roadmap FR-017).
- Takes an `AbortSignal` (stop, FR-002) and does not listen to `GENERATION_STOPPED`, and
  it does not touch the main `abortController` → main chat and assistant never cancel
  each other (FR-029).
- Supports Chat Completion and Text Completion profiles (Text Completion formats the
  message array through the profile's instruct template, `custom-request.js:283-385`) —
  best-effort Text Completion per clarification.

**Alternatives considered**:
- `generateQuietPrompt` — runs the full chat pipeline (character, WI, Author's Note) on
  the main connection and shares the main `abortController` (`script.js:3025, 4244`);
  rejected (FR-018, FR-029).
- `generateRaw` — main connection only, aborts on `GENERATION_STOPPED`, other extensions
  can rewrite its prompt via `CHAT_COMPLETION_PROMPT_READY`; no signal, no streaming;
  rejected.
- Direct `ChatCompletionService.processRequest` — would bypass profile resolution
  (proxy, api-url, secret id); rejected.

**Availability**: `sendRequest` throws `'Connection Manager is not available'` when the
`connection-manager` extension is disabled (`shared.js:423`). The adapter checks
`extensionSettings.disabledExtensions` up front and reports the state
`connection-manager-disabled` to the UI (FR-019) instead of failing on send.

## R2. Streaming follows the profile's preset

**Decision**: `stream` is resolved per request from the profile's completion preset:
Chat Completion → `getPresetManager('openai').getCompletionPresetByName(profile.preset)
.stream_openai`; Text Completion → the textgen preset's `streaming` flag. When the preset
is missing, fall back to the current global setting of that API. No plugin-level
streaming toggle (clarification 2026-09-15).

**Rationale**: `sendRequest` defaults to `stream: false` and the preset conversion builds
parameters with type `'quiet'`, which forces `stream=false`
(`openai.js:2724`); the explicit `stream` from the request data overrides it
(`custom-request.js:601-605`). Reading the preset keeps behavior identical to what the
user configured on the connection.

**Streaming shape**: the call returns a generator factory; each chunk yields the
**accumulated** `text` plus `state.reasoning` (`custom-request.js:506-531`). The UI
shows live text and `text.length` as the received-character counter (FR-002).
Non-streaming: `{ content, reasoning }`; the UI shows elapsed time.

**Limitation found**: the streaming parser only accumulates text/reasoning deltas
(`openai.js:3128+`); tool-call deltas are not surfaced. Streaming and tool calling are
therefore mutually exclusive in this channel (drives R3).

## R3. Operation format: tagged text blocks (one canonical protocol)

**Decision**: the assistant answers in prose with embedded operation blocks in a tagged
text protocol (contract `contracts/assistant-protocol.md`), parsed by a tolerant,
incremental, pure parser (`src/core/assistant/protocol.ts`) — not an XML parser. The same
protocol is used for every profile, streaming or not.

**Rationale**:
- Works while streaming: completed blocks are recognized as they close, so proposals can
  appear progressively and prose streams live (FR-002).
- Needs no provider feature: the owner's Gemma free model lacks strict schema output;
  the router profile changes the underlying model per request; Text Completion has
  neither tools nor schemas (FR-025).
- Tolerant parsing fixes the reference recommender's "Invalid XML" failure mode: content
  is taken verbatim between tags (no entity escaping, `&`, `<` in prose are fine),
  unknown attributes are ignored, and each block is parsed independently, so one broken
  block never discards the others (FR-027); an unclosed trailing block is reported as
  truncated (continue offered, FR-004).
- **Live probe (2026-09-15, `openrouter free provider`, routed to
  `inclusionai/ling-3.0-flash-fin:free`, streaming)**: first token 1.7 s, full answer
  2.8 s, 1714 chars; the answer contained five well-formed blocks covering
  create_folder, move into a newly created folder via its temporary ref, two
  create_entry, and edit_entry — interleaved with short prose. The earlier tool-calling
  probe on the same profile (routed to a different model) also succeeded.
- Prose interleaved with blocks is natural for models and gives the UI its "reply text".

**Alternatives considered**:
- Native tool calling (`tools` via `overridePayload`, `extractData:false`) — not
  streamable through the app's stream parser (R2); per-model support varies behind the
  router; Text Completion unsupported. Rejected for this phase; the operation model
  (R5) is protocol-independent, so a tool-call front end can be added later.
- JSON schema structured output (`overridePayload.json_schema`, mapped to OpenRouter
  `response_format`, `chat-completions.js:874-881`) — the whole answer becomes one JSON
  document: no prose streaming, one syntax error loses everything, Gemma free lacks strict
  support. Rejected as the default. FR-025 "stronger mechanisms" is satisfied by
  **R4 validation + repair turn** rather than provider-side enforcement; recorded as a
  justified reading in plan Complexity Tracking.
- The reference recommender's strict XML — rejected (its documented main failure).

## R4. Validation and repair

**Decision**: every parsed block is validated against the current tree and the scope
(`src/core/assistant/validate.ts`): target ids must exist and be in scope, parents must be
folders, field values must satisfy the Phase 1 field validation
(`core/tree/validation.ts`), refs must be declared before use. Invalid blocks become
`invalid` proposals with a reason (FR-014). When a reply yields zero valid operations in
propose mode *and* contains at least one invalid or malformed block, the UI offers
**"Ask to fix"**: a follow-up turn quoting the validation messages. No automatic repair
turn (keeps free-tier request counts predictable; FR-026 "bounded, visible").

## R5. Target identity: short handles per request

**Decision**: the context sent to the model labels items with short per-request handles
(`f1`, `e12`, `i3`) mapped to node ids in a `HandleMap` stored with the request's context
snapshot. New items in a reply get model-chosen refs (`new1`). Names are never used for
identity (FR-007).

**Rationale**: node ids are UUIDs (token-heavy, easy to garble); short handles are cheap
and unambiguous; duplicate names (edge case) resolve correctly. Handles stay valid for
the lifetime of the message (proposals keep node ids after parsing, so later tree edits
do not break them — staleness is checked separately, R8).

## R6. Context assembly and budget

**Decision**: pure builder `src/core/assistant/context.ts` produces the message array:

1. System: instructions (user-editable, default template) + protocol description +
   mode rules (propose/discuss). Nothing else goes into system messages except decision
   notes: steps 2–5 are wrapped in `<workspace>…</workspace>` and placed at the start of the
   latest user turn, before the request (revised 2026-09-16 — models treated a separate
   system message as hidden rules and denied seeing any lore).
2. Where the user is: selected items and the current folder for new items (revised
   2026-09-16 — without it models placed new folders wherever seemed convenient).
3. Structure outline: one line per node of the chosen structure and the folders above
   it (`handle | kind | name [WI root: book] — keys`), depth-indented; nothing else of
   the tree is sent or handled.
4. Entries in full: the selection, then entries triggered by their primary keys or
   title (`core/assistant/triggers.ts`: plain keys as whole words, case-insensitive;
   `/regex/flags` keys as patterns) in the request, the last two turns, enabled chat
   sources and the contents of already-triggered entries, breadth-first until nothing new
   matches; or every entry with `entryContents: 'all'`. Entries show title, keys,
   non-default fields (`FIELD_SPECS` names/enums) and content.
5. Optional (per conversation, default off): character card fields, persona description,
   last N chat messages, entries activated in the current chat.
6. Conversation history (user/assistant turns) with decision summaries (R9).
7. Current user request.

**Budget**: token estimation by characters (≈ 3.5 chars/token, conservative) against the
user's context limit minus the response length. Trimming order, most kept first
(spec Assumptions, revised 2026-09-16): system + current request + location → structure
outline (≤ 45 % of the budget, else collapsed below depth 2, then folders only) → recent
conversation turns (≤ 60 %) → selected entries → triggered entries in trigger order
(≤ 90 %) → chat sources (oldest messages first) → older conversation turns. The builder returns an `omitted` list rendered as the notice
(FR-023). Exact tokenizer counts are not used: `getTokenCountAsync` follows the *main*
API's tokenizer, not the assistant profile's (`tokenizers.js:443`).

**Defaults**: context limit 16 000 tokens, response length 2 000 tokens (owner's free
models: 200k–262k context, Gemma free max output 32 768).

**Activated entries**: read from the last `WORLD_INFO_ACTIVATED` event payload of the
current chat (`world-info.js:900-903`), cached by the adapter per chat id and cleared on
`CHAT_CHANGED`; matched to workspace entries through the per-book `uid` in
`sync.books`. No dry-run scan (`checkWorldInfo` is not on `getContext()` and a scan can
touch Author's Note prompts).

## R7. Failure classification and retry

**Decision**: `llmClient` maps errors to `AssistantFailure.kind`:
`rate-limit` (HTTP 429 / "rate-limited" / quota text), `provider` (other upstream error
messages), `network`, `timeout` (no chunk for 90 s streaming / 180 s non-streaming),
`aborted`, `profile` (missing/unsupported profile, Connection Manager disabled),
`empty`, `truncated` (an unclosed trailing `<op` block — the finish reason is not exposed by
`sendRequest` with `extractData: true`, so a reply cut inside prose is not detectable),
`malformed` (no parseable content in propose mode with block-like residue).
Sources: `sendRequest` wraps errors as `Error('API request failed', { cause })`
(`shared.js:485`); non-streaming errors carry `json.error.message`
(`custom-request.js:481-486`); streaming errors surface as
`Got response status <code>` (`custom-request.js:500-504`). The live probes returned 429
with `"temporarily rate-limited upstream"` for Gemma free on all 5 attempts.

**Retry**: `rate-limit` and `network` get at most 2 automatic retries with visible
countdown (10 s, 30 s), cancellable with Stop; everything else is manual Retry (FR-026).
The user's request text is never cleared until a reply is received.

## R8. Applying proposals

**Decision**: `src/adapters/assistantApply.ts` applies accepted proposals one by one in
topological order (creations of parents → moves/renames → edits → deletions), each via
the existing pure tree operations (`createChild`, `renameNode`, `moveNode`,
`commitEntryField`, `bulkDeleteNodes`) through `workspaceActions.applyTreeChange` with
the same effects the UI uses (structure, deletions/tombstones, dirty books) — FR-011.
The delete flow currently living in `WorkspaceApp.tsx:320-370` (tombstones, root-book
keep/delete question, linked-file note) is extracted into
`workspaceActions.deleteNodes(...)` and used by both the UI and the assistant, as spec
004 R10 did for tree changes.

- **Staleness (FR-013)**: every proposal records the target's `updatedAt` and a
  fingerprint of the fields it touches at parse time; at acceptance a mismatch marks it
  `stale` with a refreshed diff.
- **Dependencies (FR-012)**: refs create edges; a denied/failed/invalid dependency marks
  dependents `blocked`.
- **Destructive (FR-010)**: pure `isDestructive(before, after)` — deletion, or content
  removal > 50 % measured as removed characters of the old content from the line diff
  (`core/diff/lineDiff.ts`), or any keyword removed.
- **Duplicates (FR-016)**: case-insensitive title match or ≥ 1 shared primary key with an
  existing entry in the same book scope → `duplicateOf` hint.
- **Partial failure (FR-028)**: each applied item is recorded immediately; a failure
  stops the batch and reports applied vs not applied.

## R9. Undo records and decision memory

**Decision**: an `AppliedBatch` stores, per applied operation, the inverse data: the
created node id (undo = delete), prior name, prior parent + index, prior field values,
and the full deleted subtree snapshot plus its book bindings (undo = re-insert with
original ids; tombstones for those uids are cleared through the sync engine's existing
restore path, or the entries are re-added as new native entries when the book copy was
already removed). Undo checks each item's `updatedAt` against the value recorded after
application; changed items are skipped and reported (FR-015, clarification B).

Decision memory (FR-033): each assistant turn in history is followed by a compact system
note: `Decisions: accepted create_entry "The Salty Keel"; denied create_entry "The
Hearthfire Inn" (do not propose again unless asked)`.

## R10. Conversation storage

**Recovery guard**: assistant settings live inside the published workspace state, and the
app store publishes on every change; while `_recovered` is set and unpublished
(`isFreshRecovery`), settings edits are refused with a notice (spec FR-035) instead of
publishing the empty fallback over the recoverable payload.

**Decision**: IndexedDB database `WorldInfoWorkspace-assistant` (separate from the md
link DB), stores `conversations` (metadata + settings) and `messages` (keyed by
`[conversationId, seq]`), opened through a small adapter
`src/adapters/conversationStore.ts` mirroring `fsaDisk.ts` `openDb/withStore`. Saves are
debounced per conversation (500 ms) and flushed on stream end, decision and apply. When
IndexedDB is unavailable, an in-memory store is used and a banner explains that
conversations will not persist (FR-035). Assistant settings live in
`extensionSettings['WorldInfoWorkspace'].assistant` (optional, schema v1 additive).

**Alternatives considered**: `SillyTavern.libs.localforage` (used by the reference
recommender) — would work, but the project already has a typed IndexedDB pattern and no
localforage typing; rejected for consistency. Shared settings — rejected by clarification.

## R11. Profile list and selection

**Decision**: the settings menu renders its own React select from
`ConnectionManagerRequestService.getSupportedProfiles()` (`shared.js:525`), refreshed on
`CONNECTION_PROFILE_CREATED / UPDATED / DELETED` events (`events.js:81-84`); the
selected id is stored in assistant settings; missing id → `no-profile` state with a
fix hint. `handleDropdown` is not used: it binds a jQuery `<select>` and adds
never-removed listeners per call (`shared.js:629-782`), which conflicts with React
re-mounts. Profile api/model come from `getProfile(id)`; each assistant message stores
`profileName`, `api`, `model` (FR-034) — for routers, the actual model is not exposed by
the extracted response or the stream generator (it yields only text and reasoning), so
the profile's configured model id is recorded (spec edge case amended 2026-09-15).

## R12. Reasoning text

**Decision**: `reasoning` from the result/stream state is stored on the message and shown
collapsed ("Thinking"); it is never passed to the protocol parser (FR-030). Inline
`<think>…</think>` in content (reasoning templates like the owner's "Think XML") is
stripped by the parser before block recognition and moved to `reasoning`.

## R13. Interop events

**Decision** (additive, constitution VII): `wi-workspace:assistant-applied`
`{ conversationId, batchId, operations: AppliedOperationSummary[] }` and
`wi-workspace:assistant-undone` `{ conversationId, batchId, reverted: string[], skipped:
string[] }` (FR-036). Contract tests in `tests/contract/hooks.test.ts`.

## R14. Testing strategy

- Unit (Vitest-first): protocol parser (incl. streaming chunk boundaries, truncation,
  garbage, think tags), validation, handles, context builder + budget trimming,
  destructive/duplicate rules, apply ordering and dependency blocking, undo planning,
  failure classification.
- IndexedDB: devDependency `fake-indexeddb` (tests only) so the real
  `conversationStore` adapter runs the same suite as the memory store.
- Delete flow: a regression test for `workspaceActions.deleteNodes` precedes its
  extraction from `WorkspaceApp.tsx` (no UI tests exist for it).
- Integration: `assistantApply` + real store + real sync engine against the existing
  FakeHost (`tests/integration/sync-engine.test.ts` harness) — applied batches reach
  native books; undo; stale and partial failure.
- Contract: `llmClient` against a fake `ConnectionManagerRequestService` mirroring
  `shared.js` signatures (stream factory, error wrapping); hooks payloads.
- Recorded fixtures: the live probe answer above is stored as a parser fixture.
- Live: quickstart scenarios on both owner profiles via Playwright (`dev` account).
