# Feature Specification: Hardening & Interop (Roadmap Phase 4)

**Feature Branch**: `006-hardening-interop`

**Created**: 2026-09-22

**Status**: Draft

**Input**: User description: "Начнём и полностью имплементируем следующую по roadmap
фазу" — i.e., deliver the next phase of `specs/001-workspace-plugin-roadmap/spec.md`.
Two phases remained with their order explicitly left to the owner; the owner chose
**Phase 4 — Hardening & Interop** (Phase 5, AI Images, stays for a later spec).

## Baseline and Roadmap Position

- **Delivered**: Phase 0 (spec 002), Phase 1 Core Workspace MVP (spec 003), Phase 3
  Markdown Folder Sync (spec 004), Phase 2 AI Lore Assistant (spec 005, closed by the
  owner 2026-09-22). The workspace is feature-complete for its main flows.
- **This phase**: the roadmap's Phase 4 scope — "Large-book performance, extension hooks,
  polish, documentation", gated on "Meets success criteria at scale; hooks documented".
  It adds no new user-facing capability; it makes what exists trustworthy at realistic
  sizes, usable by other extensions, and documented.
- **Roadmap criteria this phase finally verifies**: SC-003 (a 100-card nested lore space
  behaves identically to native entries), SC-007 (typical workflows complete entirely in
  the workspace), and SC-002 (zero focus losses) at scale rather than on small samples.
- **Deliberately out of scope**: Phase 5 (AI image generation and captioning, US7 /
  FR-025–FR-027) and any new lore-editing capability.

## Clarifications

### Session 2026-09-22

- Q: What scale must "large-book performance" be held to? → A: Performance targets are
  set against a **1000-entry book and a ~2000-node workspace**; roadmap SC-003's
  100-card nested space remains the *correctness* gate. Designing for 5000+ entries
  (full virtualization rework) is explicitly out of scope.
- Q: How is the "polish" part bounded? → A: **Superseded later in the same session.**
  Polish was first scoped as an owner-supplied punch list; the owner has no list, because
  the rough edges found at the end of Phase 2 were already fixed as they appeared. US4
  therefore delivers a standing **maintenance-change process** instead of a one-off list.
- Q: Where is a small fix that does not deserve its own spec documented? → A: **Both**
  a user-facing `CHANGELOG.md` (one line per change, grouped by release) **and** a
  maintenance record carrying rationale — the record written only when the change embeds
  a non-obvious decision, so the common case stays a single line.
- Q: What rule decides whether a change takes the lightweight fix path instead of a full
  spec? → A: **Contract-based.** A change may take the fix path only if it adds no new
  user capability and alters no delivered contract (persistence schema, markdown
  convention, assistant protocol, native sync semantics, hook names and payloads).
  Anything touching those requires a spec.
- Q: How are fixes handed over so each becomes trackable work? → A: A **standing minimal
  template in conversation** (what was done / expected / actual / area). Items fixed
  straight away are recorded only in the changelog; **only deferred items** are written to
  a backlog file.
- Q: Where is the process codified so it is binding? → A: A **constitution amendment
  (MINOR, 1.2.0 → 1.3.0)** carries the binding rule, with the operational detail in
  `AGENTS.md`. Required because Governance makes the constitution supersede other project
  documents, so a maintenance path living only in `AGENTS.md` would be void wherever it
  conflicts with Principle VIII.
- Q: Does the changelog reconstruct past releases? → A: **No.** One summary entry covers
  "0.4.11 and earlier" by reference to specs 002–005; real per-release history starts at
  0.4.12.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The Workspace Stays Responsive on a Large Library (Priority: P1)

A user imports a large community lorebook (around a thousand entries) or links an
established Obsidian vault, then works the way they always do: expanding and collapsing
folders, selecting entries, typing into content fields, moving items between folders,
searching the book list, and syncing. Nothing stalls, no keystroke is dropped or
re-ordered, and the editor never loses focus while background saves and syncs run.

**Why this priority**: This is the phase's headline risk. Every prior phase was validated
on the small Aldermeer dataset; a workspace that becomes unusable on a real library
invalidates the roadmap's core promise of replacing the previous plugins.

**Independent Test**: Load a workspace containing a 1000-entry book and a ~2000-node tree,
then run a scripted editing session (expand/collapse, select, type a paragraph, move a
subtree, search, trigger a sync) and measure interaction responsiveness and dropped input.
Delivers value on its own: the existing feature set becomes usable at real sizes.

**Acceptance Scenarios**:

1. **Given** a workspace of ~2000 nodes, **When** the user expands or collapses a folder
   with several hundred children, **Then** the tree updates without blocking input beyond
   the SC-001 budget and the scroll position of the surrounding tree is preserved.
2. **Given** a 1000-entry book under a World Info root, **When** the user types
   continuously into an entry's content field while a debounced sync push and a markdown
   auto-push both run, **Then** every typed character appears in order and the caret and
   focus stay in the field.
3. **Given** the same workspace, **When** the user opens the Lorebooks panel and searches
   and filters the book list, **Then** results appear within the SC-001 budget.
4. **Given** the same workspace, **When** a sync push flattens and saves the 1000-entry
   book, **Then** the UI stays interactive for the whole operation and the result is
   byte-identical to the same push performed on a small book of the same shape.
5. **Given** a large linked markdown folder, **When** the workspace is shown and a pull
   scans it, **Then** the scan reports progress and the user can keep working or cancel.

---

### User Story 2 - Another Extension Observes and Reacts to the Workspace (Priority: P2)

An author of another SillyTavern extension wants to react to what happens in the
workspace — a lore entry was created, an entry was pushed to a native book, a World Info
root was designated. They subscribe to the plugin's documented events, receive typed
payloads, and build their feature without reading this plugin's source or patching it.

**Why this priority**: Constitution VII mandates a stable, documented hook surface, and
the roadmap gates this phase on "hooks documented". Today only four events exist, all
added by specs 004 and 005 (`md-link-changed`, `md-synced`, `assistant-applied`,
`assistant-undone`); the Phase 1 core — tree changes, native sync, root designation —
emits nothing at all.

**Independent Test**: Write a small consumer that subscribes to every documented event,
exercise each originating workflow in the app, and verify each event fires exactly once
per occurrence with a payload matching its documented shape.

**Acceptance Scenarios**:

1. **Given** a subscribed consumer, **When** the user creates, renames, moves, or deletes
   a tree item by any route (manual edit, assistant apply, markdown pull, import),
   **Then** a tree-change event fires with the affected item identity and the kind of
   change.
2. **Given** a subscribed consumer, **When** a book is pushed to native World Info,
   **Then** an event reports the book and the outcome, including failures.
3. **Given** a subscribed consumer, **When** a folder is designated or undesignated as a
   World Info root, **Then** an event reports the folder and its bound book name.
4. **Given** a consumer whose handler throws, **When** the event fires, **Then** the
   workspace operation still completes and the error is logged without a user-facing
   failure.
5. **Given** the documented event list, **When** the contract tests run, **Then** every
   documented event has a test asserting its name and payload shape, and no undocumented
   event is emitted.

---

### User Story 3 - A New User Installs and Understands the Plugin (Priority: P2)

Someone discovers the extension, installs it, and needs to know what it does, how the
workspace relates to the native World Info editor, what the markdown convention is, and
what the AI assistant needs in order to work. An extension author separately needs a hook
reference. None of this exists today outside contributor-facing spec folders.

**Why this priority**: The roadmap gates the phase on documentation, and the repository
has no README at all — only `AGENTS.md`, which is written for contributors and assumes
the spec folders. Without user documentation the plugin is effectively undiscoverable.

**Independent Test**: Hand the documentation to someone who has never seen the plugin and
have them install it, designate a World Info root, sync a book, and link a markdown folder
using only the docs. Delivers value independently of any code change.

**Acceptance Scenarios**:

1. **Given** only the published documentation, **When** a new user follows it, **Then**
   they can install the plugin, open the workspace, create a lore entry, designate a World
   Info root, and confirm the entry reaches a native book.
2. **Given** the documentation, **When** a user looks for the markdown convention,
   **Then** they find the field mapping, the folder record, and the round-trip guarantees
   and limits (images and folders never export to native books).
3. **Given** the documentation, **When** a user looks for the AI assistant,
   **Then** they find its prerequisites (a connection profile, the Connection Manager
   extension) and its confirmation model.
4. **Given** the documentation, **When** an extension author looks for hooks, **Then**
   they find every event name, its payload, when it fires, and the additive-only
   stability promise.

---

### User Story 4 - A Small Fix Is Documented Without Writing a Spec (Priority: P3)

The owner finds a rough edge in day-to-day use and reports it. It is one or two fixes —
far too small to justify a full specify→plan→tasks→implement cycle — but the change still
needs to be documented: what changed, for users, and why, when the choice was not obvious.
A standing maintenance path handles it end to end: report, triage against a written
threshold, fix, record.

**Why this priority**: The roadmap deferred day-to-day usage testing until all main phases
were delivered, and that point is now reached — but the friction found at the end of
Phase 2 was fixed as it appeared, leaving no backlog and no record of what changed.
Establishing the path matters more than any individual fix, and it is what makes every
future maintenance change documentable. It follows the measurable work because it is
process, not product.

**Independent Test**: Run one real fix end to end through the new path — report it with
the template, triage it against the threshold, fix it, and verify it produced a changelog
entry (and a rationale record only if the change embedded a decision) without any spec
being written.

**Acceptance Scenarios**:

1. **Given** the standing template, **When** the owner reports a rough edge,
   **Then** the report carries what was done, what was expected, what happened, and the
   affected area — enough to reproduce it without follow-up questions.
2. **Given** a reported change that adds no user capability and alters no delivered
   contract, **When** it is triaged, **Then** it takes the fix path and no spec is
   written.
3. **Given** a reported change that would add user capability or alter a delivered
   contract, **When** it is triaged, **Then** it is routed to a new spec and explicitly
   refused the fix path.
4. **Given** a completed fix, **When** it is released, **Then** it appears as one
   changelog line under its release version; **and** if it embedded a non-obvious
   decision, a maintenance record states the rationale.
5. **Given** a reported item that will not be fixed now, **When** it is triaged,
   **Then** it is written to the backlog and survives the end of the session.
6. **Given** the codified process, **When** a contributor reads the constitution and
   `AGENTS.md`, **Then** the binding rule and the operational mechanics are both
   discoverable, and neither contradicts the other.

---

### Edge Cases

- What happens when a book grows past the stated target (well beyond 1000 entries)? The
  workspace must degrade gracefully — remain correct and usable with a clear slowdown —
  never corrupt data, lose edits, or hang without an escape.
- What happens when a large sync push fails midway (server error, quota)? The existing
  failure banner and retry must behave identically at scale, and the unsent payload must
  not produce a false divergence.
- What happens when a hook consumer subscribes and then the extension is disabled or
  reloaded? Events must not be delivered to stale listeners and the workspace must not
  retain references to them.
- What happens when two events would describe the same occurrence (an assistant apply is
  also a tree change)? The documented contract must state exactly which events fire, in
  what order, so consumers do not double-count.
- What happens when a scan or push is running and the user closes the workspace or starts
  a generation? The existing flush-before-generation guarantee must still hold at scale.
- What happens when performance targets are measured on a slow device? Targets are stated
  against a defined reference environment so results are comparable run to run.

## Requirements *(mandatory)*

### Functional Requirements

**Performance and scale**

- **FR-001**: The workspace MUST remain interactive while displaying and editing a
  workspace of at least 2000 nodes containing at least one book of 1000 entries, with no
  operation blocking user input beyond the responsiveness targets in Success Criteria.
- **FR-002**: Text entry into any field MUST preserve every keystroke, its order, and the
  caret and focus position, including while background saves, native sync pushes, and
  markdown auto-pushes run.
- **FR-003**: Long-running operations (large scans, imports, exports, pushes) MUST report
  progress and MUST be cancellable or, where cancellation is unsafe, clearly declared as
  uninterruptible before they start.
- **FR-004**: Sync, import, export, and markdown results MUST be identical at large scale
  to the results produced for equivalent small inputs — scale MUST NOT change outcomes,
  only duration.
- **FR-005**: The plugin MUST NOT degrade the host app's own responsiveness while the
  workspace is closed, and MUST release large working data when the workspace is closed.
- **FR-006**: The system MUST expose a repeatable way to measure the scale targets on a
  generated dataset, so the gate can be re-verified after later changes.

**Extension interop hooks**

- **FR-007**: The plugin MUST emit a documented, namespaced (`wi-workspace:*`) event for
  each of these occurrences: tree structure or content change, native book push outcome,
  World Info root designation change, and workspace open/close — in addition to the
  markdown and assistant events already delivered.
- **FR-008**: Every emitted event payload MUST be typed and MUST identify the affected
  entities by stable identity, sufficient for a consumer to react without reading plugin
  internals.
- **FR-009**: Events MUST fire exactly once per occurrence regardless of which route
  caused it (manual edit, assistant apply, markdown pull, import, bulk action).
- **FR-010**: A failing or slow consumer MUST NOT break, block, or fail the workspace
  operation that emitted the event; errors MUST be logged and contained.
- **FR-011**: The hook surface MUST be additive-only relative to what specs 004 and 005
  delivered: no existing event name or payload field may be removed or repurposed.
- **FR-012**: Every documented event MUST be covered by a contract test asserting its name
  and payload shape, and the documented list MUST match what the code emits.

**Documentation**

- **FR-013**: The project MUST publish user-facing documentation covering installation,
  the relationship to the native World Info editor, the workspace and tree, World Info
  roots and sync semantics, the markdown convention and its limits, and the AI assistant's
  prerequisites and confirmation model.
- **FR-014**: The project MUST publish an extension-author hook reference listing every
  event, its payload, when it fires, and the additive-only stability promise.
- **FR-015**: Documentation MUST state the plugin's environment requirements and known
  limits, including markdown folder linking being available only on desktop Chromium
  browsers over a secure page, and the assistant requiring the Connection Manager
  extension.
- **FR-016**: Documentation MUST be English-only and MUST be updated in the same change as
  any behaviour or contract it describes.

**Maintenance change process**

- **FR-017**: The project MUST define a maintenance path for changes too small to justify
  a full specify→plan→tasks→implement cycle, covering report, triage, fix, and record.
- **FR-018**: The path MUST be governed by a written, contract-based threshold: a change
  qualifies only if it adds no new user capability and alters no delivered contract —
  persistence schema, markdown convention, assistant protocol, native World Info sync
  semantics, or hook names and payloads. A change touching any of those MUST be routed to
  a spec and MUST NOT take the fix path.
- **FR-019**: The project MUST publish a `CHANGELOG.md` recording every user-visible
  change as one entry under its release version, seeded with a single summary entry for
  "0.4.11 and earlier" referencing specs 002–005, with per-release history kept from
  0.4.12 onward.
- **FR-020**: A maintenance change that embeds a non-obvious decision MUST additionally
  produce a short record stating the rationale; changes without such a decision MUST NOT
  require one.
- **FR-021**: The project MUST define a standing minimal report template capturing what
  was done, what was expected, what happened, and the affected area, sufficient to
  reproduce the issue without follow-up.
- **FR-022**: Reported items that are not fixed immediately MUST be written to a backlog
  that persists beyond the reporting session; items fixed immediately MUST NOT require a
  backlog entry.
- **FR-023**: Each maintenance fix MUST be covered by a regression test where its
  behaviour is testable.
- **FR-024**: The binding rule (that a bounded maintenance path exists, and its threshold)
  MUST be recorded in the project constitution as a MINOR amendment (1.2.0 → 1.3.0), and
  the operational mechanics — template, changelog format, record format, backlog — MUST be
  recorded in `AGENTS.md`, with no contradiction between them.

### Key Entities

- **Interop Event**: A namespaced, payload-typed announcement of a workspace occurrence,
  consumed by other extensions; identified by name, carrying stable entity identities,
  documented and contract-tested.
- **Scale Benchmark Dataset**: A generated workspace and book of the target size used to
  measure and re-verify the performance gate; reproducible, not shipped as user data.
- **Maintenance Change**: A change small enough to bypass the full spec cycle, admitted
  only by the contract-based threshold; carries a report, a triage outcome, a changelog
  entry, and — when it embeds a non-obvious decision — a rationale record.
- **Changelog Entry**: One user-visible line describing what changed, grouped under its
  release version.
- **Backlog Item**: A reported rough edge accepted but deliberately not fixed yet,
  persisted beyond the reporting session.
- **Documentation Set**: The user-facing guide, the extension-author hook reference, and
  the changelog.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a workspace of 2000 nodes including a 1000-entry book, every routine
  interaction (expand/collapse, select, open an entry, search the book list) completes in
  under 1 second, and no interaction blocks input for more than 200 ms.
- **SC-002**: In a scripted 5-minute editing session on that workspace, with background
  saves, native sync pushes, and markdown auto-pushes running throughout, 0 keystrokes are
  lost or re-ordered and 0 focus losses occur (roadmap SC-002 verified at scale).
- **SC-003**: A 100-card nested lore space syncs to native World Info with every entry
  behaving in chat generation identically to a natively created entry (roadmap SC-003,
  verified on live data).
- **SC-004**: Sync, import, export, and markdown round-trip results on the 1000-entry
  dataset are identical to the results for the equivalent small dataset — 0 differences
  attributable to scale.
- **SC-005**: 100% of documented events fire exactly once per occurrence across every
  originating route, with payloads matching their documented shape, verified by a consumer
  exercising each workflow.
- **SC-006**: A consumer whose every handler throws causes 0 failed or blocked workspace
  operations.
- **SC-007**: A person who has never used the plugin completes installation, first entry,
  World Info root designation, confirmed native sync, and a markdown folder link using the
  documentation alone, without reading source or spec folders.
- **SC-008**: Typical lore-management workflows (organize, edit, sync, ask the assistant)
  are completed entirely within the workspace without opening the previous separate
  plugins, confirmed over a week of the owner's real use (roadmap SC-007).
- **SC-009**: At least one real fix is carried end to end through the maintenance path
  without a spec being written, producing its changelog entry; and given a set of at least
  5 sample changes spanning both sides of the threshold, triage routes 100% of them to the
  correct path (fix vs. spec) using the written rule alone.
- **SC-010**: The documented event list and the events the plugin actually emits match
  exactly — 0 documented events that never fire, 0 emitted events that are undocumented.

## Assumptions

- **Scale target** (owner decision 2026-09-22): performance is held to a 1000-entry book
  and a ~2000-node workspace. Larger libraries must degrade gracefully but are not gated;
  a virtualization rework for 5000+ entries is a separate future concern.
- **Reference environment**: performance targets are measured on the owner's development
  machine against the local instance (`http://127.0.0.1:8634`, the `dev` account) using
  the system Chromium already used for live checks. Targets are comparative and
  environment-relative, not absolute hardware guarantees.
- **Polish is delivered as a process, not a list** (owner decision 2026-09-22): the
  roadmap's "polish" slot becomes a standing maintenance-change path. There is no punch
  list to work off — the friction found at the end of Phase 2 was fixed as it appeared —
  so US4 is verified by running the path once on a real fix, not by closing a backlog.
- **The constitution will be amended in this phase** (1.2.0 → 1.3.0, MINOR per
  Governance). This is the one delivered project contract this phase deliberately changes;
  it changes no product contract.
- **No new user capability**: this phase changes no delivered *product* contract —
  persistence schema v1, the markdown convention, the assistant protocol, and native sync
  semantics all stay as specified. Any change that would break them is deferred. (The one
  deliberate exception is a process contract: the constitution amendment above. Hook
  additions are additive only, per FR-011.)
- **Benchmark data is synthetic**: the scale dataset is generated for measurement and is
  never published as user-facing sample content; the Aldermeer demo dataset stays the
  user-facing sample.
- **Hooks are observational**: this phase adds events other extensions can *observe*. A
  command surface letting other extensions *drive* the workspace is not in scope.
- **Documentation lives in the repository** as English-only Markdown alongside the
  existing `AGENTS.md`, which stays contributor-facing.
- **Phase 5 (AI Images) is untouched** and remains available as the next spec; the owner
  will supply reference projects when it is specified.
