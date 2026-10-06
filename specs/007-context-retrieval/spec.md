# Feature Specification: Context & Retrieval (Roadmap Phase 6)

**Feature Branch**: `007-context-retrieval`

**Created**: 2026-10-06

**Status**: Draft

**Input**: Owner request, distilled from a tester conversation: "You know how you have
extensions like DeepLore that let the AI choose which entry can be sent to context
depending on the situation? The way I see it yourself could be a simple version of it"
— "letting it trigger based on folder". The owner chose scope A (assistant context) +
B (optional interop with other extensions) + C-lite (AI-chosen entries for main-chat
generation on the native World Info engine). A full own retrieval engine is roadmap
Phase 7 and out of scope here.

## Baseline and Roadmap Position

- **Delivered**: Phases 0–4 (specs 002–006). The assistant (spec 005) already builds its
  context from instructions, the user's selection and current folder, an outline of a
  chosen structure, entry contents (selected + key-triggered recursively, or all), and
  optional chat / character card / persona / activated entries, within a token budget,
  and reports what it left out.
- **This phase** (roadmap Phase 6, added 2026-10-06): make that context explainable and
  able to cope with large libraries, let it draw on other installed lore extensions, and
  carry the same "which entries matter now" judgement into main-chat generation — always
  through the native World Info engine, never beside it.
- **Reference study** (recorded in `research.md`): DeepLore (MIT — ideas may be reused),
  Memory Books and Doom's Enhancement Suite (AGPL — only their data formats and ideas,
  never code), DoomLore-Mesh (no licence — not used).
- **Delivered contracts touched** (constitution 1.3.0 — this is why this is a spec, not
  maintenance): persistence schema (new optional entry field and saved context sets),
  markdown convention (new key for the summary), assistant protocol (summaries as an
  editable field, catalog-based selection), hook surface (new additive events), native
  sync semantics (see FR-007).

## Clarifications

### Session 2026-10-06

- Q: Write summaries into native book entries, or keep them workspace-only? → A: Into
  the native entry as an extra field the app ignores and preserves (FR-007); summaries
  travel with the book and main-chat picking sees them for any active book.
- Q: How does the assistant pick from the catalog — a separate pre-request, or within one
  conversation turn? → A: Within one turn: the model gets the catalog and either answers
  directly or requests full text of chosen entries through a new protocol operation; the
  plugin sends them and the same reply continues (FR-008).
- Q: When is main-chat picking done, given slow models (~30 s)? → A: Hybrid: a pick is
  prepared in the background after each model reply; before a generation the prepared
  pick is used unless the user's new message mentions entries absent from it, in which
  case a fresh pick runs, waiting up to the timeout (FR-021, FR-022).
- Q: Where does the user see which entries were picked for a main-chat reply? → A: A
  small indicator on each model reply in the main chat; clicking it shows that reply's
  picks with reasons, prepared/fresh, ignored names and fallback state. The mode's
  settings stay in the workspace (FR-024).
- Q: What happens when Memory Books entries are reordered in the workspace tree? → A:
  Reordering is free in the tree, but tree order is not written to the native order of
  Memory Books entries; their native order stays as Memory Books set it. Other entries
  sync as before (FR-015).
- Q: Does catalog selection turn on by itself when the needed full text exceeds the
  budget? → A: Yes — an "Auto" mode (default) uses the catalog only when the full text
  does not fit, marked in the context preview; each conversation can force it on or off
  (FR-009).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See What the Assistant Sees, and Why (Priority: P1)

A user asks the assistant to revise the harbour district. Before sending, they open the
context preview and see every item that will go into the request: which entries, which
folders' outline, chat messages, card — each with the reason it is there ("selected",
"key 'harbor' matched", "recursion step 2 from 'Salt Guild'", "fuzzy match", "picked from
catalog", "in context set 'Factions'") and its token cost, plus the items that were left
out and why ("over budget", "outside scope"). After the reply, the same view is available
for that exact request.

**Why this priority**: Every other part of this phase changes what goes into the context;
without a way to see it, none of those changes can be trusted or tuned. It is also the
cheapest standalone win.

**Independent Test**: With an unchanged context feature set, open the preview for a
request and compare it with the request actually sent: same items, every item has a
reason and a cost, every omission is listed.

**Acceptance Scenarios**:

1. **Given** a conversation with a selected entry whose keys trigger two other entries,
   **When** the user opens the context preview, **Then** the selected entry shows
   "selected", the two others show the key that triggered them, and each shows its token
   cost; the total matches the request budget display.
2. **Given** a budget too small for all triggered entries, **When** the preview is shown,
   **Then** the entries that did not fit are listed as left out "over budget", and an
   entry cut short is marked "truncated" with the kept share.
3. **Given** a sent request, **When** the user opens the context of that request from
   the message, **Then** they see the items as they were at send time, even if entries
   changed since.

---

### User Story 2 - Summaries and Catalog-Based Selection for Large Libraries (Priority: P1)

A user with a 600-entry world asks "who could have forged the guild seal?". Sending every
entry is impossible and keyword triggers miss most relevant ones. Each entry carries a
short summary — one or two sentences saying when the entry matters. The assistant first
works from a catalog (entry name, folder path, summary, size), with the folder tree used
to narrow large catalogs (first relevant folders, then entries within them); only the
entries it picks are sent in full. Entries without a summary are represented by an
excerpt of their content. The user can write summaries by hand or ask the assistant to
propose them for a folder; proposals go through the usual review.

**Why this priority**: This is the capability the tester actually asked for, and the
foundation of US5 (main-chat selection uses the same catalog).

**Independent Test**: On a library far larger than the context budget, ask a question
whose answer lives in entries no key would trigger; the request contains the catalog and
the full text of the picked entries only, and the answer uses them.

**Acceptance Scenarios**:

1. **Given** an entry editor, **When** the user types a summary, **Then** it is saved
   with the entry, shown in the editor and the tree tooltip, and survives reload,
   markdown export/import and the native book round trip (FR-007).
2. **Given** a folder with 40 entries without summaries, **When** the user asks the
   assistant to write summaries for it, **Then** the reply proposes one summary per
   entry as reviewable changes, accepted or rejected individually like other proposals.
3. **Given** a library whose full text exceeds the budget and catalog selection on Auto,
   **When** the user asks a question, **Then** the request carries the catalog (within
   budget, narrowed by folder for large libraries) and full text only for picked
   entries, and the context preview shows "picked from catalog" for each of them.
4. **Given** catalog selection on Auto and a library that fits the budget, or catalog
   selection Off, **When** the user sends a request, **Then** the context is built as
   before this phase; **Given** Auto and a library that does not fit, **Then** the
   catalog is used and the preview says why.

---

### User Story 3 - Better Matching and Reusable Context Sets (Priority: P2)

Keyword triggers miss entries whose keys use another spelling or word form ("forge" vs.
"forged", "Salt-Guild"). A fuzzy match over names, keys, summaries and content adds such
entries as a supplement, clearly marked. A user who often works on the same area saves
the current context choices (structure, entry contents, folders/entries pinned in,
optional sources) as a named set — "Factions", "Harbor arc" — and applies it to any
conversation in one step. When the last entry does not fit the budget, its beginning is
kept up to a sentence boundary instead of dropping it entirely.

**Why this priority**: Quality improvements on top of US1/US2; useful but each is small.

**Independent Test**: Ask about "the forged seal" with an entry keyed only on "forge":
it appears as "fuzzy match". Save a context set, open a new conversation, apply it: the
same choices are active.

**Acceptance Scenarios**:

1. **Given** fuzzy matching is on, **When** text mentions a near-form of an entry's key
   or name, **Then** that entry is added after key-triggered ones with reason "fuzzy
   match" and never displaces a key-triggered or selected entry.
2. **Given** a saved context set, **When** it is applied to a conversation, **Then** all
   its choices become active and the conversation records which set it used; editing the
   set later does not silently change past requests.
3. **Given** a set referring to a deleted folder, **When** it is applied, **Then** the
   missing item is reported and the rest applies.
4. **Given** a budget with room for half of the last entry, **When** the request is
   built, **Then** that entry is cut at the last sentence boundary within the room and
   marked "truncated".

---

### User Story 4 - Living Alongside Other Lore Extensions (Priority: P2)

A user also runs Memory Books, which writes chat memories into a lorebook. When that book
is a workspace World Info root, its memory entries carry a badge (memory, summary tier,
side prompt, clip) and editing them in the workspace never breaks Memory Books: its own
fields, the numbered titles and the entry order it relies on are kept. Optional buttons
run Memory Books' own commands (e.g. create a memory). A user of Doom's Enhancement
Suite gets the current scene's present characters as an optional context source and
relevance hint; a DeepLore user can add DeepLore's keyword matches as an optional source.
Users without these extensions see none of this.

**Why this priority**: Pleasant and protective for users of those extensions, invisible
for others; protection of Memory Books data is the part that must not be skipped.

**Independent Test**: With Memory Books installed and a memory book bound to a workspace
root, edit a memory entry's content in the workspace; Memory Books still lists, numbers
and rolls back the memory correctly. Uninstall it: no badges, no buttons, no errors.

**Acceptance Scenarios**:

1. **Given** a bound book containing Memory Books entries, **When** the user edits one
   in the workspace and it syncs, **Then** every field Memory Books set on the entry is
   still present and unchanged, the numbered title prefix is kept, and the native order
   of memory entries is unchanged.
2. **Given** the user reorders memory entries in the tree, **When** the book syncs,
   **Then** their native order is unchanged; **Given** a rename that would drop a memory's
   number prefix, **When** the user confirms the name, **Then** they are warned first
   that Memory Books relies on it.
3. **Given** Doom's Enhancement Suite has tracked present characters in the current
   chat, **When** the "scene" source is enabled, **Then** the present cast is listed in
   the request context and entries named after present characters are preferred.
4. **Given** none of the three extensions is installed, **When** the user opens any
   context option, **Then** no interop option is offered and nothing fails.

---

### User Story 5 - AI-Chosen Entries for Main-Chat Generation (Priority: P2)

A roleplayer enables "AI picks lore" for their chat. Before each reply, a model on a
connection profile of their choice reads the recent chat and the catalog of entries in
the active books (summaries, folders as categories) and picks the entries that matter
now; those entries are activated through the native World Info mechanism, alongside the
ones their keys activate as usual. The native engine still decides position, depth,
budget and ordering. Each reply carries an indicator showing which entries the model
picked and why. If the model is slow or fails, the reply goes ahead with normal keyword
activation; the user is told, not blocked.

**Why this priority**: The tester's headline request, but it builds on US2 (summaries,
catalog) and costs an extra model call per reply, so it is opt-in and comes after the
workspace-side work.

**Independent Test**: With an active book containing an entry no key matches, enable
the mode and write a message about that entry's subject; the entry appears in the
generated prompt (native prompt inspection) and in that reply's pick details with a reason.

**Acceptance Scenarios**:

1. **Given** the mode is off (default), **When** the user chats, **Then** no extra model
   call is made and generation behaves exactly as before this phase.
2. **Given** the mode is on, **When** a reply is generated, **Then** the picked entries
   of active books are activated by the native engine with their own position, depth and
   order settings, and none appears twice in the prompt.
3. **Given** the picking model does not answer within the configured time, **When** the
   reply is generated, **Then** it proceeds with normal keyword activation, and the user
   sees a non-blocking notice; the next reply tries again.
4. **Given** a pick prepared in the background after the last reply and a user message
   that mentions no entry missing from it, **When** the next reply is generated,
   **Then** the prepared pick is used without waiting, and the reply's pick indicator
   says so.
5. **Given** a user message naming an entry that the prepared pick lacks, **When** the
   reply is generated, **Then** a fresh pick runs and the generation waits for it at most
   the configured time.
6. **Given** a quiet or impersonation generation, or a generation by another extension,
   **When** it runs, **Then** no picking happens.
7. **Given** a pick naming entries that do not exist in an active book, **When** it is
   applied, **Then** those names are ignored and reported in the reply's pick details;
   valid picks still apply.

### Edge Cases

- An entry's summary is longer than the summary limit → saved, flagged as too long, and
  shortened in the catalog with a visible mark.
- A catalog too large even after folder narrowing → the narrowest useful level is sent
  and what was left out is reported; never a silent cut.
- The picking model returns malformed output → treated like a timeout (fallback +
  notice), raw output viewable for diagnosis.
- Active books not bound to the workspace → included in main-chat picking with content
  excerpts instead of summaries and no folder grouping.
- An entry the native engine would never activate on its own (disabled) → never picked;
  disabled entries are excluded from the catalog.
- The user switches chat during picking → the stale pick is discarded.
- A forced entry that the native budget then cuts → shown in the reply's pick details as "picked but
  cut by the World Info budget" when the native engine reports it.
- Memory Books changes its book while the workspace is open → treated as any other
  clean-side native change (merged silently, spec 003 FR-015).
- Two extensions both forcing activations → additive; ours never removes others'.
- Context set applied in a conversation whose scope no longer exists → falls back to
  "selection" scope with a notice.

## Requirements *(mandatory)*

### Functional Requirements

#### Context preview and explainability (US1)

- **FR-001**: The assistant MUST show, before sending and for any sent request, every
  context item with its reason and token cost, and every left-out item with the reason
  it was left out; the shown items MUST equal what was sent.
- **FR-002**: Reasons MUST distinguish at least: selected, in scope/outline,
  key-triggered (with the matching key), recursion (with step and source entry), fuzzy
  match, picked from catalog, in a context set, from an interop source, and truncated.
- **FR-003**: The context of a sent request MUST remain viewable as it was at send time
  for as long as the conversation exists.

#### Summaries and catalog selection (US2)

- **FR-004**: Entries MUST support an optional short summary ("when this entry
  matters"), editable in the entry editor and visible in the tree tooltip; a soft length
  limit is shown and exceeding it is flagged, not blocked.
- **FR-005**: The assistant MUST be able to propose summaries for chosen entries or a
  folder as regular reviewable proposals (accept, edit, reject, undo).
- **FR-006**: Summaries MUST round-trip through the persistence schema, the markdown
  convention (one new optional key) and markdown import/export without loss.
- **FR-007**: Summaries MUST travel with the entry into its native book as an additional
  field on the native entry that the native app ignores and preserves, so that main-chat
  picking (US5) can use them for any active book, including books edited elsewhere; an
  entry edited natively keeps its summary (owner decision 2026-10-06).
- **FR-008**: The assistant MUST offer catalog-based selection: a catalog of entries
  (name, folder path, summary or content excerpt, size) is sent with the request; the
  model either answers directly or requests the full text of chosen entries (or the
  catalog of chosen folders) through a protocol operation, which the plugin fulfils
  automatically within the same reply, visibly and stoppably, up to a bounded number of
  rounds; catalogs over budget are narrowed by folder (first folders, then entries)
  rather than cut silently.
- **FR-009**: Catalog selection MUST have three settings per conversation — Auto
  (default), On, Off. Auto uses the catalog only when the full text the existing modes
  would send does not fit the budget, and the context preview says so; when the catalog
  is not used, the existing context modes MUST behave exactly as before this phase.

#### Matching, sets, truncation (US3)

- **FR-010**: An optional fuzzy match over entry names, keys, summaries and content MUST
  supplement key triggers, ranked after selected and key-triggered entries, with a cap on
  how many entries it may add.
- **FR-011**: Users MUST be able to save, rename, delete and apply named context sets
  holding all context choices of a conversation; sets are stored with the workspace
  settings and survive reload; applying a set records its name on the conversation.
- **FR-012**: When the last entry does not fit, its text MUST be kept up to the last
  sentence boundary that fits (if at least a minimum useful share fits) and marked
  truncated; otherwise it is left out as today.

#### Interop (US4)

- **FR-013**: Every interop feature MUST activate only when the other extension is
  detected at runtime, MUST NOT require it, and MUST degrade silently (no errors, no
  options shown) when it is absent or its data has an unexpected shape.
- **FR-014**: Memory Books entries in bound books MUST show a badge by kind (memory,
  summary tier, side prompt/tracker, clip); all their extension-specific fields MUST be
  preserved byte-for-byte through every workspace edit and sync.
- **FR-015**: For Memory Books entries, tree order MUST NOT be written to their native
  order fields: they keep the native order Memory Books set, however they are arranged in
  the tree (a narrow, marker-based exception to the "tree order → native order" sync rule;
  all other entries are unaffected). A rename that would drop their numbered title prefix
  MUST warn first.
- **FR-016**: The workspace MAY offer buttons that run Memory Books' own public commands
  (e.g. create a memory for the current scene); it MUST NOT reimplement them.
- **FR-017**: With Doom's Enhancement Suite present, the assistant MUST offer the current
  scene's present characters (and location, when tracked) as an optional context source,
  and US5 MUST be able to use them as a relevance hint.
- **FR-018**: With DeepLore present, the assistant MUST offer DeepLore's keyword-match
  output for the current chat as an optional context source, shown as one item.

#### Main-chat picking (US5)

- **FR-019**: Main-chat picking MUST be opt-in (off by default), configurable per chat
  and with a global default, using a connection profile chosen in its settings
  (defaulting to the assistant's profile).
- **FR-020**: When on, before World Info is assembled for a normal user-facing
  generation, the plugin MUST obtain picks from the catalog of enabled entries of the
  currently active books, and activate them only through the native forced-activation
  mechanism; it MUST NOT inject prompt text itself and MUST NOT deactivate anything.
- **FR-021**: Picking MUST time out after a configurable limit and fall back to normal
  activation with a non-blocking notice; failures MUST NOT block or abort generation.
- **FR-022**: After each model reply in the chat, a pick for the next turn MUST be
  prepared in the background (no waiting, cancelled when the chat changes or a newer
  preparation starts). At generation time the prepared or previous pick MUST be used
  without waiting while the new chat text since it mentions no entry name or key of the
  active books that the pick lacks; otherwise a fresh pick runs and is waited for up to
  the timeout (FR-021). The user can force a fresh pick.
- **FR-023**: Picking MUST NOT run for quiet, impersonation or extension-internal
  generations, nor when no book is active.
- **FR-024**: Each model reply generated with picking on MUST carry a small indicator in
  the main chat; clicking it shows that reply's pick: picked entries with the model's
  stated reason, prepared or fresh, ignored names, timing, and fallback state. The pick
  stays attached to that reply (its swipe) for the life of the chat; replies generated
  with picking off show no indicator.
- **FR-025**: Folders MUST be usable as categories for picking (narrowing large
  catalogs), and a folder MUST be excludable from picking.

#### Cross-cutting

- **FR-026**: New public events MUST be additive `wi-workspace:*` events following the
  existing hook rules (identity not content, never awaited), documented in the hook
  reference; at least one event announces a completed main-chat pick.
- **FR-027**: All new model calls MUST go through the app's connection-profile request
  service like the existing assistant; no credentials are stored by the plugin.
- **FR-028**: README and the hook reference MUST describe every new option, its cost
  (extra model calls) and the interop requirements.

### Key Entities

- **Entry summary**: Short text on an entry saying when it is relevant; travels with the
  entry (workspace, markdown, native book).
- **Context item**: One piece of a request's context with its kind, reason, source and
  token cost; left-out items carry the reason for omission.
- **Context snapshot**: The context items of one sent request, kept with the
  conversation.
- **Catalog**: The list of candidate entries (name, folder path, summary/excerpt, size)
  shown to a model for picking; grouped by folder when large.
- **Context set**: Named, saved set of context choices, applicable to any conversation.
- **Pick result**: For one main-chat generation: picked entries with reasons, ignored
  names, reused/fresh flag, timing, fallback state.
- **Interop source**: An optional context provider backed by another extension's data
  (scene cast, DeepLore matches), present only when that extension is detected.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For 100% of sampled requests, the context preview lists exactly the items
  sent, each with a reason and cost (verified on at least 20 requests across all modes).
- **SC-002**: On a library at least 5× larger than the context budget, questions whose
  answers live in entries no key triggers are answered using the right entries in at
  least 8 of 10 test questions with catalog selection on (vs. the baseline without it).
- **SC-003**: Summaries survive 100% of round trips (reload, markdown export/import,
  native push/pull, native edit of another field) in a dedicated test matrix run before
  release (owner requirement: test this thoroughly).
- **SC-004**: After editing Memory Books entries in the workspace, 0 Memory Books
  functions (listing, numbering, rollback, regeneration) are broken, and 0 of its fields
  differ from before the edit except the edited one.
- **SC-005**: With main-chat picking off, generation is unchanged: 0 extra model calls
  and an identical World Info result on a fixed test chat.
- **SC-006**: With main-chat picking on, a timeout or failure never delays a reply by
  more than the configured limit plus 1 second, and never aborts it.
- **SC-007**: With main-chat picking on, an entry that no key matches but the chat is
  about is present in the prompt in at least 8 of 10 test turns; on turns that
  introduce no new entity, the reply is not delayed by picking at all (prepared pick
  used) in at least 9 of 10 cases.
- **SC-008**: Users without Memory Books, Doom's Enhancement Suite or DeepLore see no
  interop option and no error in a full session.

## Assumptions

- Main-chat picking covers all **active** books (bound to the workspace or not); bound
  books benefit from summaries and folder categories, others get content excerpts.
  Entries outside active books are out of scope (roadmap Phase 7).
- Picking adds to keyword activation; making a book "AI only" (disabling its keys) is
  out of scope.
- Default picking timeout is generous enough for slow free models but bounded (planned
  around 20 s, configurable); it applies only to fresh picks at generation time, since
  background preparation never delays a reply.
- Fuzzy matching and catalog selection run locally; only the picking step calls a model.
- Context sets and the main-chat picking defaults live in the workspace settings
  (additive, repaired field by field like existing assistant settings); per-chat picking
  state lives with the chat.
- Interop relies on the other extensions' observable data and public commands as of the
  versions studied (DeepLore 2.6.2, Memory Books 9.3.4, Doom's Enhancement Suite 2.6.0);
  shape changes there degrade the interop feature, not the workspace.
- AGPL-licensed references are used for ideas and data formats only; no code is copied.

## Out of Scope

- An own prompt-injection engine (positions, depth, dedup, budget) — roadmap Phase 7.
- Picking entries from books that are not active.
- Obsidian or any external vault; dependency on DeepLore.
- An own scene/character tracker; Memory Books' multi-tier summaries.
- AI image generation and captioning (roadmap Phase 5).
