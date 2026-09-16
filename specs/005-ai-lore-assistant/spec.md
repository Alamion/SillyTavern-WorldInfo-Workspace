# Feature Specification: AI Lore Assistant (Roadmap Phase 2)

**Feature Branch**: `005-ai-lore-assistant`

**Created**: 2026-09-15

**Status**: Draft

**Input**: User description: "Время для следующей фазы и введения нейронок поисследуй что
там как, если что-то будет непонятно на стадии clarify отвечу на все твои вопросы.
Дополнительно создал "openrouter free provider" и "openrouter small gemma free" профиля
коннекта - можешь их пользовать как надо. там ключи подключены соответственно к
бесплатному провайдеру opencode (который редиректит к одной из доступных бесплатных
моделек) и к gemma free которая является как мне кажется лучшей представленной бесплатной
языковой моделью с упором на генерацию красивого текста, а не кода." — i.e., deliver
roadmap Phase 2 (`specs/001-workspace-plugin-roadmap/spec.md`, US5, FR-013–FR-018): the
real in-workspace AI assistant, replacing the Phase 0 mock. Two connection profiles were
prepared by the owner for development and validation.

## Baseline and Roadmap Amendments

- **Phase order**: Phases 0, 1 and 3 are delivered (specs 002, 003, 004); this is the
  next phase per the roadmap order amendments. Phase 5 (AI Images) stays separate; this
  phase introduces the AI connection groundwork it will reuse.
- **Assistant philosophy (inherited from spec 002 clarifications)**: the assistant works
  in *batch proposals* — one turn may propose many operations ("fill this folder"),
  presented as one batch with per-item accept/deny and a batch decision; destructive
  operations are always confirmed separately; autonomous / auto-apply modes stay out of
  scope until after real-world use.
- **Presentation (inherited from the Phase 0 outcome)**: the assistant lives in the
  workspace's assistant region; proposals show per-item decisions and a shared diff view
  (already used by markdown sync conflicts); AI settings are a dedicated menu of the
  assistant region. Separate "recommendation list" widgets were dropped in Phase 0, so
  recommendations (roadmap FR-015) are delivered as assistant replies that reference
  existing tree items.
- **Entity model (inherited from spec 003)**: tree items are folders, entries and images;
  there is no "note" kind. Roadmap wording "cards, notes" reads as "entries, images,
  folders".
- **Credentials (roadmap FR-017)**: the assistant uses the app's own connection profiles;
  the plugin never asks for, stores or reads API keys.

## Clarifications

### Session 2026-09-15

- Q: Should replies stream to the user when the connection has streaming enabled? → A:
  Yes. When the selected profile's preset has streaming on (the usual case), the user gets
  instant feedback: the reply text streams live, with a live count of received characters;
  without streaming, a waiting status with elapsed time is shown.
- Q: Where are assistant conversations stored? → A: In the browser on the current device
  (like the markdown link of spec 004); the shared extension settings hold only assistant
  settings (profile, limits, instructions, default context choices). Conversations are
  not visible on other devices.
- Q: What does the assistant see by default in a new conversation? → A: The selected
  folder (or the selected item's folder) in full plus a compact outline of the whole tree;
  current chat, character card, persona and activated entries are off and enabled per
  conversation.
- Q: (owner review 2026-09-16) Is the whole tree outline and every in-scope entry's content
  always needed? → A: No — workspaces can hold thousands of items. The assistant sees only
  the structure the user chose (plus the folders above it for orientation), is told where
  the user is (selected item, current folder for new items), and gets entry contents only
  for selected entries and entries whose keys or title are mentioned in the request, the
  chat or another sent entry, recursively until the context limit or nothing new matches.
  Sending every entry of the structure stays available as an option. This supersedes the
  2026-09-15 answer below about the outline of the whole tree.
- Q: (owner review 2026-09-16, free models) How does the user recover from a bad reply?
  → A: The last assistant reply keeps versions: `>` on the last version generates a new
  one from the same request and history, `<`/`>` switch between kept versions, each with
  its own proposals and decisions; the shown version is what later requests see. Any
  message (user or assistant) can be deleted — accepted changes stay in the workspace.
  Any message can start a fork: a new conversation with the messages up to and including
  it; accepted changes there are read-only (undo stays in the original), pending proposals
  stay decidable. Icons follow the app's own chat.
- Q: (owner review 2026-09-16) Where does the workspace context go in the request? → A: In
  the latest user turn inside a `<workspace>` block, as data the user shares; the system
  message carries only instructions and protocol. Models (DeepSeek via OpenRouter) treated
  a separate system message as hidden rules and claimed no lore had been shown.
- Q: Which edits, besides deletions, need their own confirmation? → A: Edits that remove
  more than half of an entry's content, or remove any of its keywords; all other edits
  apply through the batch-level accept.
- Q: How fully are Text Completion profiles supported? → A: Best-effort: selectable and
  working through the text proposal format, with a quality warning; acceptance is
  validated on Chat Completion profiles only. Full support waits for an explicit need.
- Q: Which applied assistant batches can be undone, and for how long? → A: Any applied
  batch of a conversation, for as long as the conversation exists; items modified after
  the batch was applied are skipped and reported, never overwritten. Undo records are
  deleted with the conversation.
- Q (planning review, 2026-09-15): How are broken operation blocks surfaced? → A: A
  compact notice with the count; the raw broken blocks and reasons are shown on request;
  "Regenerate with the same context" re-sends the stored request unchanged.

## Research Findings (2026-09-15)

Findings that shape the requirements (details go to `research.md` during planning):

- **Reference recommender** (`context/SillyTavern-WorldInfo-Recommender/`): runs
  requests through a user-chosen connection profile; sends chat history, character card
  and the selected books' entries; expects one large XML/JSON payload. Its known pain
  points — which this phase must not repeat — are: fragile parsing on small models
  ("Invalid XML"), no automatic recovery from truncated or malformed answers, targets
  identified by entry *name* (operations silently skipped on renamed items), only
  title/keys/content editable, no deletions or moves in the main flow, no token budget for
  the lore it sends, and a slash-command path that saves results without review. Worth
  carrying over: revise-with-feedback turns, rejection memory ("don't suggest this
  again"), a read-only "discuss" mode, regenerate, and per-session persistence.
- **App capabilities**: an extension can send its own requests through any Chat
  Completion or Text Completion connection profile without touching the main chat
  (independent of chat generation, cancellable, optionally streamed, with optional
  structured output and tool definitions); profiles can be listed and change live. These
  requests require the app's Connection Manager to be enabled. Chat, character, persona
  and the World Info activation of the current chat are readable.
- **Owner's development profiles** (both OpenRouter, Chat Completion):
  - `openrouter free provider` → a router that forwards each request to one of the
    currently free models. Probe: a single turn returned three well-formed operations
    (two creations, one rename) with evocative text. The actual model changes between
    requests, so capability and quality vary per request.
  - `openrouter small gemma free` → a Gemma free model (prose-oriented, large context,
    image input). Advertises tool use and JSON output but not strict schema-enforced
    output. Probe: every attempt (4 over ~1 minute) was rejected with a *rate-limit*
    error from the shared free pool.
  - Consequence: the assistant MUST treat rate limits, provider errors, missing
    structured-output support, malformed and truncated answers as ordinary, recoverable
    situations — not exceptional ones.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Generate and Edit Entries by Conversation (Priority: P1)

The user opens the assistant region, types a request in natural language ("create three
entries about everyday life in Aldermeer in this folder", "rewrite Bristlemark's harbor
paragraph and add a city-law section"), and receives a batch proposal: each proposed
creation shows the new entry (title, keywords, content, any other fields the assistant
set) and each proposed edit shows a before/after diff. The user accepts or denies items
individually or all at once; accepted items land in the tree exactly as proposed and, when
under a World Info root, reach the native book through the usual sync.

**Why this priority**: Writing and improving lore with AI is the core value of the phase
and the most frequent use; everything else extends this loop.

**Independent Test**: With one working connection profile, request creation of several
entries in a chosen folder and an edit of an existing entry; accept some items, deny
others; verify only accepted changes appear in the tree, persist after reload, and appear
in the native book of an enclosing World Info root.

**Acceptance Scenarios**:

1. **Given** a folder is selected, **When** the user asks for new entries without naming a
   location, **Then** the proposals target the selected folder, and each shows its full
   proposed content before anything is created.
2. **Given** a proposal edits an existing entry, **When** the user opens it, **Then** a
   before/after diff of every changed field is shown.
3. **Given** a batch of four proposals, **When** the user accepts two and denies two,
   **Then** exactly the two accepted changes are applied, and the batch shows each item's
   final decision.
4. **Given** an accepted proposal, **When** it is applied, **Then** it behaves like a
   manual edit: it is persisted, it marks the affected book for sync, it is reversible
   through the assistant's undo of that batch, and the linked markdown folder (if any)
   receives it as any other edit.
5. **Given** a proposal the user likes partially, **When** the user edits the proposed
   content before accepting (or replies with feedback such as "shorter, less purple"),
   **Then** the adjusted version is what gets applied (or a revised proposal replaces the
   original).
6. **Given** the tree changed since the proposal was made (the target was edited, moved or
   deleted), **When** the user accepts it, **Then** the conflict is detected and shown
   instead of silently overwriting or failing.

---

### User Story 2 - Reorganize the Tree with the Assistant (Priority: P1)

The user asks the assistant to restructure lore: "split Cities into Northern and Southern
folders", "move all tavern entries into Hearth & Home", "rename the Guilds folder",
"delete the duplicate entries about the Lanternwrights". The assistant proposes folder
creations, renames, moves and deletions as part of a batch; deletions are visibly marked
and require their own explicit confirmation, disclosing everything that would be removed.

**Why this priority**: Structural management of the lore space is what distinguishes the
workspace assistant from the reference recommender (roadmap FR-014) and is required for the
phase gate.

**Independent Test**: Ask for a reorganization that creates a folder, moves entries into
it, renames another folder and deletes one entry; verify the proposal order is sensible,
that the deletion cannot be applied by a plain "accept all", and that after confirmation
the tree and native books match the proposal.

**Acceptance Scenarios**:

1. **Given** a request that needs a new folder and moves into it, **When** the batch is
   accepted, **Then** operations apply in a dependency-safe order (the folder exists before
   items move into it) and every item keeps its content intact.
2. **Given** a batch containing a deletion, **When** the user uses "accept all", **Then**
   non-destructive items apply while the deletion stays pending until the user explicitly
   confirms it, seeing the full list of affected items (including a folder's descendants
   and the native books they leave).
3. **Given** the user denies an item that later items depend on (e.g., the folder
   creation), **When** the dependent items are reviewed, **Then** they are shown as
   blocked with the reason, not applied to a wrong location.
4. **Given** a move that takes an entry out of or into a World Info root, **When** it is
   applied, **Then** the native books update exactly as for a manual move (Phase 1 rules).

---

### User Story 3 - Choose the Connection and Control What the Assistant Sees (Priority: P1)

In the assistant's settings menu the user picks which connection profile the assistant
uses (independently of the profile used for chatting), and controls the context sent with
requests: which part of the workspace the assistant can see (e.g., the selected folder,
chosen folders, or the whole workspace outline), whether the current chat, the character
card and persona are included, and a size limit for what is sent. The user can also view
and adjust the assistant's instructions (with a reset to default).

**Why this priority**: Without a working connection nothing works; without context
control the assistant either sees too little to be useful or sends a whole large workspace
to a small or free model and fails.

**Independent Test**: Select each of the two owner profiles in turn, run the same request,
and verify the request went through the selected profile while the chat's own connection
stayed unchanged; switch the context scope and confirm the assistant only references items
inside the scope; set a low size limit and confirm the user is told what was left out
(scenario 3 needs the context builder delivered with User Story 1).

**Acceptance Scenarios**:

1. **Given** several connection profiles exist, **When** the user selects one in the
   assistant settings, **Then** assistant requests use it, the main chat connection is not
   switched, and the choice is remembered.
2. **Given** the selected profile is deleted or becomes unusable, **When** the user opens
   the assistant, **Then** the assistant shows that no usable profile is selected and how to
   fix it, instead of failing on send.
3. **Given** the context would exceed the size limit, **When** the user sends a request,
   **Then** the assistant trims context in a predictable priority order and tells the user
   what was omitted.
4. **Given** the app's connection-profile feature is disabled, **When** the user opens the
   assistant, **Then** the region explains the requirement and the rest of the workspace
   keeps working.

---

### User Story 4 - Recover from AI Failures Without Losing Work (Priority: P1)

Free and small models are rate-limited, slow, switch underlying models, and sometimes
return truncated or malformed answers. The user always sees what is happening (waiting,
receiving, failed), can stop a request, and on failure gets a clear reason (rate limit,
provider error, invalid answer, too long) with one-click retry — never a half-applied tree
or a lost request text.

**Why this priority**: The owner's own development profiles hit these conditions
immediately (rate-limit errors on every probe of one profile); an assistant that is not
resilient to them is unusable on the connections the owner actually has.

**Independent Test**: Use the rate-limited profile, a deliberately tiny response-length
limit, and a stop mid-request; verify each case produces a readable status, keeps the
request text, allows retry, and leaves the tree unchanged.

**Acceptance Scenarios**:

1. **Given** the provider responds with a rate-limit error, **When** the request fails,
   **Then** the user sees it is a temporary limit, the request text is kept, and retry is
   offered (automatic bounded retry is allowed but visible and stoppable).
2. **Given** the answer is malformed or cut off, **When** it is received, **Then** every
   well-formed operation is still shown as a proposal, the unusable remainder is reported,
   and the user can ask the assistant to continue or regenerate.
3. **Given** a request is in progress, **When** the user stops it, **Then** it ends
   promptly, nothing is applied, and the conversation stays consistent.
4. **Given** a request proposes an operation on an item that does not exist or is outside
   the allowed scope, **When** the answer is processed, **Then** that operation is shown as
   invalid with the reason and cannot be accepted.

---

### User Story 5 - Keep and Continue Conversations (Priority: P2)

Assistant conversations persist: after closing the workspace, reloading the app or
switching chats, the user returns to the conversation with its messages, proposals and the
decisions taken. The user can start a new conversation, switch between previous ones,
rename and delete them. The assistant remembers within a conversation what was proposed,
accepted and denied, and does not re-propose denied items unless asked.

**Why this priority**: Required by roadmap FR-018 and needed for multi-step lore work, but
single-session use (US1–US4) already delivers value.

**Independent Test**: Hold a conversation with applied and denied proposals, reload the
app, reopen the conversation, and verify messages and decisions are intact; start a
second conversation and switch back.

**Acceptance Scenarios**:

1. **Given** a conversation with pending proposals, **When** the app is reloaded, **Then**
   the conversation reopens with pending proposals still decidable (subject to the
   staleness check of US1 scenario 6).
2. **Given** several conversations, **When** the user switches between them, **Then** each
   keeps its own history and context settings.
3. **Given** the user denied a proposal, **When** they ask for "more ideas" in the same
   conversation, **Then** the denied idea is not proposed again.
4. **Given** stored conversations grow large, **When** the user deletes old ones, **Then**
   the stored data is released and the workspace data is unaffected.

---

### User Story 6 - Discuss and Get Lore Recommendations for the Current Chat (Priority: P3)

Without proposing changes, the user asks the assistant questions about the lore ("what do
we know about the Bridgehold watch?", "are any entries contradicting each other?") or asks
which existing entries are relevant to the current chat. The assistant answers in the
conversation, referencing existing tree items that the user can click to open; for
relevance questions it considers the recent chat messages and which entries the app
actually activated.

**Why this priority**: Covers roadmap FR-015 and a read-only "discuss" mode; useful but not
required for the create/edit/reorganize core.

**Independent Test**: With an active chat, ask for relevant lore and verify the answer
references existing items that open on click; ask a question in discuss mode and verify no
proposals are produced.

**Acceptance Scenarios**:

1. **Given** an active chat, **When** the user asks for relevant entries, **Then** the
   reply lists existing workspace entries with the reason each is relevant, and each
   reference opens the item in the editor.
2. **Given** discuss mode is on, **When** the user asks for a change, **Then** the
   assistant answers in text only and suggests switching modes to get proposals.
3. **Given** a referenced item is later deleted, **When** the user clicks the reference,
   **Then** the user is told the item no longer exists.

---

### Edge Cases

- The workspace is very large (hundreds of entries): context exceeds the model's window or
  the size limit — the assistant sends an outline plus the in-scope items and says what was
  left out; more detail on specific items comes only through the user's next turn (no
  automatic lookup requests).
- Duplicate names (two entries called "Bristlemark" in different folders): proposals must
  target the exact item, not the first match by name.
- The model invents fields or values outside what entries support (unknown position, a
  negative depth): the invalid part is rejected with a reason; valid parts remain.
- A proposed creation duplicates an existing entry's title or keywords: the proposal is
  flagged as a likely duplicate before acceptance.
- The user edits the tree manually while a request is running: proposals are validated
  against the tree at acceptance time.
- The main chat is generating while an assistant request runs: both proceed independently;
  the assistant never blocks or cancels chat generation and vice versa.
- An applied batch is later partially edited by the user: undo of that batch reports which
  items can no longer be reverted cleanly instead of overwriting the later edits.
- A proposal targets a World Info root's book settings or a book that is bound elsewhere:
  only workspace-level operations are proposed; book activation and character/chat
  bindings are not assistant operations.
- Model output contains reasoning / thinking text: it is kept apart from the answer
  (optionally viewable) and never parsed as operations.
- The router profile switches the underlying model between turns of one conversation: the
  conversation continues; each assistant message records the profile and its configured
  model id (the concrete model a router picked is not available to the plugin in this
  phase).
- The linked markdown folder has held-back writes: assistant-applied changes follow the
  same Phase 3 hold-back and conflict rules as manual edits.
- Text Completion profiles (with or without an instruct template): the assistant warns that
  output quality may be poor and still attempts the request; a missing instruct template is
  named in the warning.

## Requirements *(mandatory)*

### Functional Requirements

**Assistant region & conversation**

- **FR-001**: The Phase 0 assistant mock MUST be replaced by a working assistant in the
  same region, with a message input, a conversation view and a settings menu.
- **FR-002**: The user MUST be able to send a natural-language request and see the
  assistant's reply in the conversation, with a visible status while the request is in
  progress (waiting / receiving) and the ability to stop it. When the selected connection
  has streaming enabled, the reply text MUST stream live together with a live count of
  received characters (proposals are shown once they are complete); otherwise a waiting
  status with elapsed time is shown.
- **FR-002a**: Unsent text in the message input MUST survive closing and reopening the
  workspace within the same browser tab session (e.g. to check the chat or a character
  card), and MUST be cleared once sent. Unavailable browser session storage only means the
  text is not kept; the assistant keeps working.
- **FR-003**: The assistant MUST support two modes per request: *propose* (reply may
  contain operation proposals) and *discuss* (text only, no proposals).
- **FR-004**: The user MUST be able to regenerate the last assistant reply, and to
  continue a reply that was cut off. Regenerating keeps earlier versions of the reply,
  which the user can switch between (versions of the last reply only); the user MUST be
  able to delete any single message and to fork the conversation at any message
  (clarification 2026-09-16).
- **FR-005**: Replies MUST be able to reference existing tree items; a reference opens the
  item in the editor, and a reference to a missing item says so.

**Operations & proposals**

- **FR-006**: The assistant MUST be able to propose these operations: create entry, edit
  entry (any editable entry field, including title, keywords, content and native
  activation/insertion settings), create folder, rename folder or entry, move folder or
  entry, delete folder or entry. Book activation, book bindings and image items are not
  assistant operations in this phase.
- **FR-007**: Proposals MUST identify their targets unambiguously (by the item's identity,
  never by name alone), and the user-facing summary MUST show the target's location in
  the tree.
- **FR-008**: Every proposal MUST be previewed before application: creations show the full
  proposed item, edits show a per-field before/after diff (using the shared diff view),
  moves show source and destination, renames show old and new name, deletions list
  everything that would be removed.
- **FR-009**: The user MUST be able to accept or deny each proposal individually, accept or
  deny all pending proposals of a batch, and edit a proposal's content before accepting it.
- **FR-010**: Destructive proposals (deletions; edits that remove more than half of an
  entry's existing content, measured on the content text; edits that remove any of the
  entry's keywords) MUST NOT be applied by a batch-level
  accept; each requires its own explicit confirmation disclosing affected items and native
  books, consistent with the Phase 1 delete disclosure.
- **FR-011**: Applying proposals MUST go through the same tree operations as manual
  editing, so persistence, validation, World Info sync, markdown link behavior and
  interop events are identical to a manual change.
- **FR-012**: Accepted operations of a batch MUST be applied in a dependency-safe order;
  proposals depending on a denied or failed proposal MUST be shown as blocked with the
  reason.
- **FR-013**: At acceptance time each proposal MUST be validated against the current tree;
  a proposal whose target changed since it was proposed MUST be shown as stale (with the
  current state) and require a fresh decision.
- **FR-014**: Invalid proposals (unknown target, out of scope, invalid field values) MUST
  be shown with a reason and MUST NOT be acceptable; valid proposals of the same reply
  remain usable.
- **FR-015**: The user MUST be able to undo any applied batch of a conversation (not only
  the latest) for as long as the conversation exists; items modified again after
  application MUST be skipped and reported as not cleanly revertible rather than
  overwritten, while the remaining items of the batch are reverted.
- **FR-016**: A likely duplicate (proposed creation matching an existing entry's title or
  keywords) MUST be flagged in its preview.
- **FR-017**: The user MUST be able to give feedback on a proposal or batch (e.g., "make it
  shorter"), producing revised proposals that replace the originals in the review.

**Connection & context**

- **FR-018**: The assistant MUST send requests through a connection profile chosen in its
  settings, independently of the main chat's connection, without switching the main
  connection and without the plugin handling credentials. Chat Completion profiles are
  fully supported; Text Completion profiles MUST be selectable and attempted on a
  best-effort basis, with a visible warning that proposal quality is not guaranteed.
- **FR-019**: The profile list MUST stay current when profiles are created, renamed or
  deleted; a missing or unusable profile, or a disabled connection-profile feature, MUST
  be explained in the region without breaking the rest of the workspace.
- **FR-020**: The user MUST be able to set the response length limit and the context size
  limit for assistant requests.
- **FR-021**: The user MUST be able to choose the structure (context scope) for a
  conversation: the current folder (following the selection), chosen folders, or the whole
  workspace. Only the structure and the folders above it are shown to the assistant;
  nothing outside it is sent, and only items inside it are valid operation targets (the
  folders above it are valid places for new items). Every request MUST tell the assistant
  what is selected and which folder is current, so new items land there unless the request
  says otherwise. A new conversation defaults to the current folder.
- **FR-021a**: Entry contents MUST be sent only for the selected entries plus entries
  triggered by their keys or title appearing in the request, recent turns, enabled chat
  sources or another sent entry — recursively, until nothing new matches or the context
  limit is reached (default). The user MAY instead send the contents of every entry of the
  structure. Other entries of the structure are listed by title and keys only.
- **FR-022**: The user MUST be able to include or exclude the current chat (with a message
  count), the character card and the persona description, and the entries the app
  activated in the current chat. All of these are excluded by default in a new
  conversation.
- **FR-023**: When context exceeds the size limit, the assistant MUST trim in a documented
  priority order and tell the user what was omitted in that request.
- **FR-024**: The assistant's instructions MUST be viewable and editable by the user, with
  a reset to default; defaults MUST be written so that small and free models produce
  usable proposals.
- **FR-025**: The assistant MUST work with models that do not support schema-enforced
  output or tool use, using the stronger mechanisms when the connection supports them
  (method chosen in planning), with the same user-facing result.

**Reliability**

- **FR-026**: Rate-limit, provider, network, timeout, malformed-answer and truncated-answer
  failures MUST each be reported with a readable reason; the request text MUST be kept and
  retry offered. Any automatic retry MUST be bounded, visible and stoppable.
- **FR-027**: A partially malformed answer MUST yield all well-formed proposals plus a
  visible notice that some blocks could not be used (count). The broken blocks themselves
  (raw excerpt + reason) are shown only on the user's request ("Show broken blocks"), and
  the user MUST be able to regenerate the reply with the exact same context that was sent
  (same items, handles and history), without rebuilding it from the current tree. Plain
  regenerate (FR-004) rebuilds the context from the current tree.
- **FR-028**: No failure, stop or reload MUST ever leave the tree partially changed by a
  proposal the user did not accept; applying an accepted batch that fails midway MUST
  report which items were applied.
- **FR-029**: Assistant requests MUST NOT block, cancel or alter the main chat generation,
  and main chat generation MUST NOT cancel assistant requests.
- **FR-030**: Model reasoning/thinking text MUST be kept apart from the answer, optionally
  viewable, and never interpreted as operations.

**Conversations & persistence**

- **FR-031**: Conversations (messages, proposals, decisions, applied-batch records for
  undo, and per-conversation context settings) MUST persist across workspace close, chat
  switch and app reload.
- **FR-032**: The user MUST be able to create, switch, rename and delete conversations;
  deleting releases its stored data.
- **FR-033**: Within a conversation the assistant MUST be told what was accepted and denied
  so it does not re-propose denied items unless the user asks.
- **FR-034**: Each assistant message MUST record which connection profile produced it and
  the model id configured in that profile.
- **FR-035**: Assistant settings (profile, limits, instructions, default context choices)
  MUST persist in the shared extension settings; the user MUST be able to save a
  conversation's context choices as the default for new conversations. While the
  workspace shows an unresolved data-recovery banner, assistant settings MUST NOT be saved
  (saving would publish the empty fallback workspace over the recoverable data). Conversations MUST be stored per
  browser/device, outside the shared settings, so they never grow the settings payload;
  unavailable or cleared browser storage MUST be reported, and the assistant keeps working
  with in-memory conversations for the session.

**Interop**

- **FR-036**: The plugin MUST emit additive, namespaced interop events for assistant
  activity — at least when a batch is applied (with its operations) and when a batch is
  undone — documented in `AGENTS.md` (constitution VII).

### Key Entities *(include if feature involves data)*

- **Conversation**: A persisted assistant thread: title, messages, context settings
  (scope, chat/character/persona/activated-lore inclusion), mode, creation/update times.
- **Message**: One user or assistant turn: text, optional reasoning text, status
  (pending/received/failed/stopped), failure reason, and — for assistant turns — the
  profile and model that answered and the batch it proposed.
- **Proposal Batch**: The set of operation proposals from one assistant reply, with an
  omitted/invalid-remainder report.
- **Operation Proposal**: One proposed change (create/edit entry, create folder, rename,
  move, delete) with its target identity, proposed values, dependencies, validity, and
  decision (pending / accepted / denied / blocked / stale / invalid / applied / reverted).
- **Applied Batch Record**: What an accepted batch actually changed (prior state of each
  affected item), enabling undo and not-cleanly-revertible detection.
- **Assistant Settings**: Chosen connection profile, response and context limits,
  instructions (with default reset), default context choices.
- **Context Snapshot**: What was sent for one request (scope, included sources, omitted
  parts), shown to the user as the "what was omitted" notice.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A confirmed assistant-created entry is in the tree in under 90 seconds from
  typing the request, including AI response time on the owner's free router profile
  (roadmap SC-006).
- **SC-002**: 100% of accepted proposals land in the tree and, under World Info roots, in
  the native books exactly as previewed; 0 denied, invalid, blocked or stale proposals are
  ever applied (verified over a scripted session of at least 20 proposals covering every
  operation type).
- **SC-003**: 0 deletions are applied without their own explicit confirmation.
- **SC-004**: On a request series that includes rate-limit errors, a stop, a truncated
  answer and a malformed answer, 100% of cases show a readable reason, keep the request
  text, and leave the tree unchanged.
- **SC-005**: With both owner profiles (when not rate-limited), at least 8 of 10 typical
  lore requests (create a few entries, edit an entry, reorganize a folder) produce at least
  one valid, acceptable proposal without manual retries.
- **SC-006**: Conversations with their decisions are fully restored after app reload in
  100% of checks.
- **SC-007**: While an assistant request runs, the main chat can generate normally and the
  workspace stays responsive to editing (no typing lag noticeable to the owner).
- **SC-008**: On a 300-entry workspace, a request with whole-workspace scope stays within
  the configured context limit and reports what was omitted.
- **SC-009**: The phase gate of the roadmap holds: confirmed assistant operations land
  correctly in the tree and native World Info, and the owner can complete a lore
  authoring session (generate, refine, reorganize) without the reference recommender.

## Assumptions

- Single local user; conversations are personal and not shared across users.
- The owner's two OpenRouter profiles are the primary validation targets; other
  Chat Completion providers are expected to work through the same profile mechanism but are
  validated only opportunistically. Text Completion support is best-effort and not part
  of acceptance (clarified 2026-09-15).
- Default context (clarified 2026-09-15): the assistant is a lore tool, not a chat
  participant, so chat-related context is opt-in per conversation (FR-021, FR-022).
- Default context trimming priority (most kept first, revised 2026-09-16): instructions,
  the current request and where the user is → structure outline (collapsed below depth 2,
  then folders only) → recent conversation turns → selected entries' contents →
  key-triggered entries' contents (in trigger order) → chat sources (oldest messages
  dropped first) → older conversation turns.
- Undo covers applied assistant batches only (manual edits keep their existing behavior);
  undo records live with the conversation on the device (clarified 2026-09-15), so a
  batch applied on another device cannot be undone here.
- Conversations are stored per browser/device like the markdown link (spec 004); the
  shared settings hold only assistant settings (clarified 2026-09-15).
- Streaming follows the selected connection's own streaming setting (usually on); the
  plugin does not add a separate streaming toggle.
- No autonomous multi-step behavior: every request to the model is started by a user
  action (send, retry, continue, regenerate, ask to fix, feedback) or a visible automatic
  retry of a failed request.
- Image items are visible to the assistant only as their name/caption text; image
  understanding and generation belong to Phase 5.

## Dependencies

- Delivered specs 003 (tree operations, sync engine, delete disclosure) and 004 (linked
  markdown folder rules, shared diff view).
- The app's connection-profile feature (Connection Manager) being enabled, and at least
  one Chat Completion or Text Completion profile.
- The owner's development profiles `openrouter free provider` and
  `openrouter small gemma free` (free tiers: variable models, shared rate limits).
- Reference behavior of `context/SillyTavern-WorldInfo-Recommender/` (functional baseline)
  and the app's request/profile/World Info APIs in `context/SillyTavern/`.

## Out of Scope

- Auto-apply / autonomous modes and assistant actions triggered without a user request
  (e.g., on every chat message).
- Slash commands or macros for the assistant (may be added in Phase 4 Hardening &
  Interop).
- Image generation and image captioning (Phase 5).
- Assistant control over book activation, character/persona/chat bindings, or native book
  settings.
- Direct provider connections, API key management, or cost tracking.
- Full Text Completion support and its validation (best-effort only in this phase).
- Multi-user or cross-device sharing of conversations (conversations stay on the device
  where they were held).
