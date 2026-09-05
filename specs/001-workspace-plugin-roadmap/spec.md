# Feature Specification: Integrated Lore Workspace (Phased Roadmap)

**Feature Branch**: `001-workspace-plugin-roadmap`

**Created**: 2026-09-05

**Status**: Draft

**Input**: User description: Build a SillyTavern extension named "Workspace" that unifies
the capabilities of two existing reference extensions (a full-screen lorebook editor with
folders and bulk entry management, and an LLM-based World Info recommender/manager) into a
single, deeply integrated workspace, plus new capabilities: a flexible folder tree for lore
cards and free-form notes at any depth, folders designated as "World Info" roots whose
contents flatten into the official native World Info format on save, bidirectional
conversion between markdown file structures and the app's World Info format, and an
in-workspace AI assistant that can create, edit, reorganize, and delete cards and folders
and manage the lore space via natural language. The user's dissatisfactions with the
current plugins: they work separately instead of together; they are buggy (fields not
saved correctly, values reset when the UI closes, inputs lose focus seconds after being
clicked); missing markdown features; and a rigid folder structure that must become
significantly more flexible. Delivery must be phased, starting with a prototype phase so
little effort is wasted if the visual direction is not approved.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Prototype Validation of the Workspace UI (Priority: P1)

Before any production interface work, the owner evaluates an interactive prototype of the
workspace filled with representative sample lore data. The prototype demonstrates the
layout: the folder tree, the card editor, the assistant panel, and the import/export
entry points. The owner either approves the visual direction, requests changes, or
discards it — with minimal invested effort.

**Why this priority**: The owner explicitly wants a cheap checkpoint on look and feel
before committing effort. Every later story builds on the approved visual direction.

**Independent Test**: Can be fully tested by walking through the prototype with sample
data and deciding "approve / iterate / discard" without any production implementation.

**Acceptance Scenarios**:

1. **Given** the prototype is open with sample lore data, **When** the owner browses the
   folder tree, opens a card, and views the assistant panel, **Then** they can judge the
   full visual direction of the product.
2. **Given** the owner rejects the visual direction, **When** the prototype is discarded,
   **Then** the invested effort is limited to the prototype only.

---

### User Story 2 - Flexible Lore Tree (Priority: P1)

A user organizes lore in one workspace panel inside SillyTavern as a tree: folders at any
depth, lore entries ("cards") in any folder, and free-form notes alongside cards. Folders
can be created, renamed, moved, and deleted anywhere; cards and notes can be moved between
folders. No fixed folder hierarchy is imposed.

**Why this priority**: This is the structural core that replaces the rigid structure of
the reference editor; nothing else is useful without it.

**Independent Test**: Can be fully tested by creating a multi-level tree with folders,
cards, and notes, rearranging it, and verifying the structure persists.

**Acceptance Scenarios**:

1. **Given** an empty workspace, **When** the user creates folders nested several levels
   deep and adds cards and notes in different folders, **Then** the structure is shown and
   retained exactly as built.
2. **Given** an existing tree, **When** the user moves a card from one folder to another,
   **Then** the card and all its content move intact with no data loss.

---

### User Story 3 - Trustworthy Persistence and Editing (Priority: P1)

Every edit a user makes in the workspace is saved reliably: no field resets when the UI
is closed, when switching chats, or when restarting the app; no input loses focus while
the user is typing; failed saves are visible and recoverable, never silent.

**Why this priority**: Unreliable persistence is the user's biggest complaint about the
existing plugins; the workspace is unusable if it repeats those defects.

**Independent Test**: Can be fully tested by editing every field type, closing and
reopening the UI, restarting the app, and diffing saved state against entered values.

**Acceptance Scenarios**:

1. **Given** a card with every field filled in, **When** the user closes the workspace,
   switches chats, and reopens it, **Then** every field shows exactly the entered value.
2. **Given** the user is typing into any text input, **When** a background save or refresh
   occurs, **Then** the input keeps focus and the cursor position is unchanged.
3. **Given** a save operation fails, **When** the failure occurs, **Then** the user sees a
   clear error with a way to retry, and the unsaved edit is not lost.

---

### User Story 4 - Native World Info Integration (Priority: P1)

The user designates folders as "World Info" roots. All cards beneath a designated root are
automatically flattened into a list and saved in the official native World Info format, so
they take effect in chat generation exactly like entries created in the app's own editor.
The user can also import existing native lorebooks into the workspace to continue working
on them.

**Why this priority**: Without this bridge, workspace content never reaches the AI; it is
the reason the plugin exists.

**Independent Test**: Can be fully tested by marking a folder as a World Info root,
syncing, and verifying the resulting native entries activate in a chat identically to
natively created entries; separately, by importing an existing native lorebook.

**Acceptance Scenarios**:

1. **Given** a folder designated as a World Info root containing cards, **When** the user
   syncs/saves, **Then** all cards under that root appear as native World Info entries
   with all their fields intact and are usable in generation.
2. **Given** an existing native lorebook, **When** the user imports it, **Then** it
   appears in the workspace as cards in a folder with all field values preserved.
3. **Given** multiple folders designated as World Info roots, **When** the user syncs,
   **Then** each root produces its own correct flattened native output.

---

### User Story 5 - AI Lore Assistant (Priority: P2)

Within the same workspace, the user chats with an AI assistant that can act on the lore
space: generate new cards, edit existing ones, create/delete/rename/reorganize folders,
cards, and notes, and recommend existing entries relevant to the current conversation.
Proposed changes are previewed and applied only on confirmation; destructive operations
always require explicit confirmation.

**Why this priority**: High value, but it builds on a stable, trustworthy structure
(stories 2–4) to operate on.

**Independent Test**: Can be fully tested by instructing the assistant to create, edit,
move, and delete items and verifying each confirmed change appears correctly in the tree
and in native World Info after sync.

**Acceptance Scenarios**:

1. **Given** an open workspace, **When** the user asks the assistant to create a card for
   a described concept, **Then** a preview of the new card is shown and, on confirmation,
   it is created in the requested folder with sensible keys and content.
2. **Given** an active chat, **When** the user asks for relevant existing lore, **Then**
   the assistant recommends matching existing entries from the workspace.
3. **Given** the user asks the assistant to delete a folder, **Then** an explicit
   confirmation is required before anything is removed.

---

### User Story 6 - Markdown Import/Export (Priority: P2)

The user converts between markdown file/folder structures and the workspace in both
directions: importing an existing markdown lore collection (preserving hierarchy) and
exporting any workspace subtree (or the whole workspace) as a markdown structure. The
mapping between markdown conventions and card fields is documented and visible; content
that cannot be mapped is preserved rather than dropped.

**Why this priority**: Important for portability and adopting existing markdown lore
collections, but independent of the core editing experience.

**Independent Test**: Can be fully tested by importing a sample markdown lore collection,
exporting it back, and comparing the round-trip result for completeness.

**Acceptance Scenarios**:

1. **Given** a markdown folder structure with lore notes, **When** the user imports it,
   **Then** the hierarchy and content appear in the workspace with metadata mapped to card
   fields where recognized.
2. **Given** a workspace subtree, **When** the user exports it to markdown, **Then** the
   resulting files and folders reflect the tree structure and entry fields per the
   documented mapping.
3. **Given** content that does not map to any card field, **When** conversion runs,
   **Then** that content is preserved visibly (e.g., as a note) instead of being lost.

---

### Edge Cases

- What happens when a card is moved out from under a designated World Info root — does the
  previously exported native entry get removed, kept, or flagged?
- What happens when two World Info roots contain entries with identical keys or titles?
- What happens when a designated World Info root folder is renamed or deleted?
- How does the system behave with very large lore spaces (hundreds of entries, deep
  nesting) — UI responsiveness and sync performance?
- What happens when the assistant's operation fails midway (connection drop, malformed
  response) — are partial changes applied or rolled back cleanly?
- What happens when imported markdown uses unknown encodings, missing metadata, or
  unrecognized structures?
- What happens when the user edits a native lorebook in the app's own editor between
  workspace syncs (conflict/divergence handling)?
- What happens with empty names, duplicate names, or special characters in folders, cards,
  and notes?

## Requirements *(mandatory)*

### Functional Requirements

**Structure & editing**

- **FR-001**: System MUST provide a workspace panel accessible from the app's interface
  without leaving the current chat context.
- **FR-002**: System MUST allow folders at arbitrary nesting depth, created anywhere in
  the tree.
- **FR-003**: System MUST allow lore entries (cards) and free-form notes to be created in
  any folder; notes are workspace-only content and are not exported to native World Info.
- **FR-004**: System MUST allow renaming, moving, and deleting folders, cards, and notes;
  deleting a non-empty folder MUST require confirmation.
- **FR-005**: System MUST support editing all fields of the native World Info entry format
  for cards (full field list to be derived from app sources during planning), reaching
  parity with the native editor.

**Persistence & reliability**

- **FR-006**: System MUST persist every edit such that no field value resets when closing
  the UI, switching chats, or restarting the app.
- **FR-007**: System MUST NOT steal focus from an input the user is editing during
  background saves or refreshes.
- **FR-008**: System MUST surface failed saves as visible, actionable errors with retry,
  and MUST NOT silently drop edits.

**Native World Info integration**

- **FR-009**: System MUST allow the user to designate any folder as a "World Info" root;
  multiple roots MUST be supported.
- **FR-010**: System MUST flatten all cards beneath a designated root and save them in the
  official native World Info format on sync/save, preserving all native fields.
- **FR-011**: System MUST import existing native lorebooks into the workspace with all
  field values preserved.
- **FR-012**: System MUST use a workspace-authoritative sync model: edits push to native
  World Info on save; native-side changes are pulled into the workspace only through an
  explicit import. The system MUST detect divergences between workspace cards and their
  last-exported native state and warn the user before an import overwrites workspace
  changes.

**AI assistant**

- **FR-013**: System MUST provide an AI chat panel within the same workspace.
- **FR-014**: The assistant MUST be able, on user instruction, to create and edit cards,
  and create/delete/rename/reorganize folders, cards, and notes.
- **FR-015**: The assistant MUST be able to recommend existing workspace entries relevant
  to the current conversation context.
- **FR-016**: Assistant-proposed changes MUST be previewed and applied only after user
  confirmation; destructive operations MUST always require explicit confirmation.
- **FR-017**: The assistant MUST use the AI connection already configured in the app; the
  user MUST NOT need to manage separate credentials.
- **FR-018**: Assistant conversations MUST persist across sessions and be scoped to the
  workspace.

**Markdown conversion**

- **FR-019**: System MUST import markdown file/folder structures into the workspace,
  preserving hierarchy and mapping recognized metadata to card fields.
- **FR-020**: System MUST export any workspace subtree, or the whole workspace, to a
  markdown file/folder structure.
- **FR-021**: The mapping between markdown conventions and card fields MUST be documented
  and user-visible; content that cannot be mapped MUST be preserved, never silently
  dropped.
- **FR-022**: Conversion MUST round-trip: import→export→import preserves content and all
  mapped fields.

**Prototype & interop**

- **FR-023**: System delivery MUST begin with an interactive prototype of the workspace UI
  populated with representative sample data, sufficient to validate layout and visual
  direction before production implementation.
- **FR-024**: System MUST expose a small set of namespaced events/hooks so other
  extensions can react to workspace changes (e.g., entry updated, structure changed).

### Delivery Phases (Proposed Roadmap)

| Phase | Scope | Gate / Acceptance |
|-------|-------|-------------------|
| 0 — Prototype | Interactive UI prototype with mocked sample data (US1) | Owner approves visual direction or iterates/discards cheaply |
| 1 — Core Workspace MVP | Flexible tree, reliable persistence, native WI integration incl. import (US2–US4) | Usable day-to-day lore management without the old plugins |
| 2 — AI Assistant | In-workspace assistant, recommendations, confirmation flow (US5) | Confirmed assistant operations land correctly in tree and native WI |
| 3 — Markdown Conversion | Bidirectional md import/export, documented mapping (US6) | Round-trip fidelity verified on a sample library |
| 4 — Hardening & Interop | Large-book performance, extension hooks, polish, documentation | Meets success criteria at scale; hooks documented |

Phase order is a proposal; the owner confirms or reshuffles it during review/clarification.

### Key Entities *(include if feature involves data)*

- **Workspace**: The plugin's top-level container; holds the tree, assistant history, and
  settings.
- **Folder**: A tree node with optional "World Info root" designation; contains folders,
  cards, and notes.
- **Card (Lore Entry)**: A World Info-bound entity carrying all native World Info fields;
  lives at exactly one tree location.
- **Note**: Free-form content in any format; workspace-only, never exported.
- **World Info Root**: A folder designation defining the flatten-and-export scope.
- **Export Snapshot**: The flattened set of native-format entries produced from one root.
- **Assistant Session**: A persisted conversation with the AI about the workspace, whose
  output is a set of proposed operations.
- **Conversion Mapping**: The documented rules linking markdown conventions to workspace
  entities and card fields.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of card fields edited in the workspace retain their exact values across
  UI close/reopen, chat switch, and app restart (verified by a field-by-field test pass).
- **SC-002**: Zero input focus losses during a scripted editing session that includes
  background saves and refreshes.
- **SC-003**: A 100-card nested lore space syncs to native World Info with every entry
  behaving in chat generation identically to a natively created entry.
- **SC-004**: Round-trip import→export→import of a native lorebook preserves 100% of
  entries and field values.
- **SC-005**: Markdown round-trip on a representative sample library preserves 100% of
  content and mapped metadata.
- **SC-006**: Creating a folder with a new card takes under 30 seconds; a confirmed
  assistant-created card completes in under 90 seconds including AI response time.
- **SC-007**: Typical lore-management workflows (organize, edit, sync, ask the assistant)
  are completed entirely within the workspace without opening the previous separate
  plugins.
- **SC-008**: The visual direction is approved, iterated, or rejected after evaluating
  only the prototype, before any production UI work is started.

## Assumptions

- Single local user per installation; no authentication, sharing, or multi-device sync.
- The workspace coexists with the app's native World Info editor rather than replacing it.
- Default sync model is workspace-authoritative (one-way push on save, explicit import
  back) unless FR-012 is clarified otherwise.
- The assistant uses the app's configured AI connections; model choice may constrain
  structured-output reliability (a known limitation of the reference recommender).
- Markdown mapping will use a documented, metadata-oriented convention (e.g., structured
  frontmatter for card fields); the exact convention is fixed during planning.
- The exact native World Info format specification is derived from the vendored app
  sources during planning (per user's instruction).
- UI text is English-only at the artifact level (per project constitution), structured so
  localization can layer on later.
- The prototype is intentionally discardable; only its approved design decisions carry
  forward.

## Dependencies

- The app's World Info format and extension APIs (vendored reference sources under
  `context/`), including the official World Info documentation.
- The two reference plugins (`context/SillyTavern-WorldInfo-Recommender/`,
  `context/SillyTavern-WorldInfoDrawer/`) as functional baselines to unify and improve
  upon.
- App-provided persistence and AI generation services.

## Out of Scope

- Multi-user editing, sharing, or cross-device synchronization.
- Continuous file-watching markdown synchronization (manual import/export only for now;
  may be revisited later).
- Managing non-World-Info content types (e.g., character cards).
- Replacing the native World Info editor wholesale.
