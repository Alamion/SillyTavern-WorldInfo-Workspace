# Feature Specification: Core Workspace MVP (Phase 1)

**Feature Branch**: `003-core-workspace-mvp`

**Created**: 2026-09-07

**Status**: Draft

**Input**: User description: "Изучи результаты spec-000 и spec-001. Давай приступим к
Phase 1 — Core Workspace MVP (US2–US4 из roadmap-спеки: гибкое дерево с реальным
персистом, надёжное сохранение, нативная WI-синхронизация через WI-корни с импортом)" —
i.e., deliver Phase 1 of the approved roadmap
(`specs/001-workspace-plugin-roadmap/spec.md`: US2 Flexible Lore Tree, US3 Trustworthy
Persistence and Editing, US4 Native World Info Integration including import), building on
the approved Phase 0 UI direction (`specs/002-workspace-ui-prototype/`).

## Baseline and Roadmap Amendments

Phase 1 inherits the owner-approved Phase 0 outcome as its UI and data-model baseline:

- The workspace surface is the three-region panel (tree / editor / assistant) that
  replaces the native World Info editor; the entry point is already re-bound by the
  Phase 0 shell.
- **Merged entity model**: tree items are folders, entries, and images — one unified
  entity model in which export membership is derived solely from enclosing World Info
  roots. There is **no separate "note" kind** (this amends roadmap FR-003, which listed
  free-form notes; the owner dropped notes in the Phase 0 review).
- Tree toolbar with sorting (custom/title/position/depth/order/trigger), kind filters,
  title/prompt search, and creation controls; drag-and-drop moves with custom-order
  reordering; folders toggle their World Info role live.
- The card editor uses the approved Essentials / Content / Advanced layout with a live
  markdown preview supporting embedded images.
- Every World Info root is its own book with its own settings view; the workspace owns
  the active-books list; character/persona/chat bindings remain native.
- Two items deferred by the Phase 0 review land in this phase: a touch-friendly
  move/reorder affordance in the tree (HTML5 drag-and-drop does not fire on touch), and
  resolution of app-wide placeholders (`{{user}}`, `{{char}}`, …) in the content preview.

## Clarifications

### Session 2026-09-08

- Q: When a synced entity (or a folder of entities) is deleted, what happens to its
  native book copy? → A: The delete confirmation warns that the native copy will be
  removed at the next sync; the sync then removes it automatically (workspace-
  authoritative; no second prompt). The flag-and-decide-later flow stays reserved for
  entries merely moved out from under a root (FR-018).
- Q: Does Phase 1 need multi-select bulk operations in the tree? → A: Yes — multi-select
  with bulk move, bulk delete, and bulk enable/disable of entries (minimal parity with
  the native editor); destructive bulk operations follow the same confirmation rules
  (including the FR-021 native-copy disclosure).
- Q: When is a root's native book created, and is it auto-activated? → A: Created
  immediately upon designation (even while empty — so the user can create a row of empty
  books and bind them to characters natively right away); it stays INACTIVE until the
  user explicitly activates it in the workspace's active-books list. Rationale: in the
  app, "active" World Info means globally activated for all chats — activation must be a
  deliberate choice, never automatic.
- Q: What happens to the native book when a root designation is toggled off? → A: The
  binding is simply released — the book stays as a plain native book, neither deleted
  nor flagged; because the native book-management surface is replaced, the workspace
  implements its own all-books list where every book stays visible and deletable;
  re-designating a folder offers to adopt the existing matching book (divergence-
  checked) or create a fresh one.
- Q: How are book names kept unique when folder names may duplicate? → A: A book's name
  is assigned once at designation by running the folder-derived proposal through the
  app's collision-resolved flow ("Name (2)" when taken) and stored as a durable
  root↔book binding; folder renames never rename the book, book renames are explicit
  and collision-checked; at most one binding per book name exists at any time.
- Q: Does the 'Aldermeer' sample dataset stay or go in Phase 1? → A: It stays as an
  explicit "Load demo data" action in the empty state (never default content) — useful
  for the community release as a zero-risk, one-click demonstration of the workspace.
- Q: What syncs to the native lorebook — entries only or images too (2026-09-08,
  validation round 3)? → A: Entries ONLY. Images and folders are workspace-only
  organizational items (the Phase 0 "merged export" decision is reversed; the wiw
  marker encoding is retired). Sync state is PER BOOK (uid/hash/status keyed by book
  name) because nested WI roots place one entry in several books with independent uid
  pools — the single-book sync state could not express the intersection and misfired
  deletions.
- Q: How aggressive should divergence warnings be (2026-09-08, validation round 2)?
  → A: Two-way sync handles everything the workspace can reconcile silently: native
  edits refresh clean workspace copies in place, native-only entries are imported
  automatically (matching by uid, falling back to content fingerprint so legacy data
  self-heals instead of duplicating), and pushes proceed after such merges. Banners
  and "Resolve via import" are reserved for genuine conflicts (both sides edited) and
  validation blocks; every banner is dismissible (advisory only — dismissing changes
  nothing). Adds a fa-file-import JSON/.lorebook file-import (native parity) that
  lands in the folder nearest to the current selection.
- Q: How do the workspace and the native editor coexist after Phase 1 validation
  feedback (2026-09-08)? → A: Mode toggle instead of full replacement: the native
  Worlds/Lorebooks editor is the DEFAULT view; a "Workspace" button (inserted into the
  native editor's book row) and a "Worlds/Lorebooks" button (in the workspace header)
  switch between the two surfaces. This amends the Phase 0 "full replacement, native
  unreachable" positioning. Also recorded from the same feedback: the Books and Import
  panels share one modal/banner style system, which the constitution (amendment 1.2.0)
  now mandates for ALL plugin surfaces.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Organize Lore in a Real, Persistent Tree (Priority: P1)

A user builds their actual lore structure in the workspace tree: folders nested at any
depth anywhere in the tree, lore entries carrying all native World Info fields, and image
items alongside them — no fixed hierarchy imposed. They rename, move (drag-and-drop or a
menu action that also works on touch), reorder, and delete items; the toolbar sorts,
filters, and searches. Everything they build is still there when they come back.

**Why this priority**: The flexible tree is the structural core that replaces the rigid
reference editors; nothing else in the product is useful without it, and US3/US4 store
their data inside it.

**Independent Test**: Can be fully tested by creating a multi-level tree with folders,
entries, and images, rearranging it with every available interaction, restarting the app,
and verifying the structure and order persist exactly.

**Acceptance Scenarios**:

1. **Given** an empty workspace, **When** the user creates folders nested several levels
   deep and adds entries and images in different folders, **Then** the structure is shown
   and retained exactly as built after closing the panel and restarting the app.
2. **Given** an existing tree, **When** the user moves an entry from one folder to
   another — once by dragging, once via the non-drag move affordance — **Then** the entry
   and all its content move intact with no data loss, by either path.
3. **Given** a folder's children manually reordered in custom sort mode, **When** the
   user reopens the workspace later, **Then** the custom order is preserved.
4. **Given** a non-empty folder, **When** the user deletes it, **Then** a confirmation is
   required; confirming removes the whole subtree, canceling leaves everything untouched.
5. **Given** a tree with many items, **When** the user applies a kind filter or searches
   by title/prompt, **Then** the matching item is reachable within a few interactions.

---

### User Story 2 - Edit with Total Trust (Priority: P1)

The user edits any field of any entry in the approved editor layout and trusts it:
nothing resets when the workspace is closed, when switching chats, or when restarting the
app; no input ever loses focus or the cursor while a background save or refresh runs; if
a save fails, the user sees a clear error with a retry and loses nothing. Values that
violate field rules are surfaced visibly, never silently reset. The content preview stays
live and resolves app-wide placeholders to their real values.

**Why this priority**: Unreliable persistence is the owner's biggest complaint about the
existing plugins; the workspace is unusable if it repeats those defects.

**Independent Test**: Can be fully tested by editing every field type, closing and
reopening the UI, switching chats, restarting the app, and diffing saved state against
entered values; plus a scripted session with forced background saves watching focus.

**Acceptance Scenarios**:

1. **Given** an entry with every field filled in, **When** the user closes the
   workspace, switches chats, and restarts the app, **Then** every field shows exactly
   the entered value.
2. **Given** the user is typing into any text input, **When** a background save or
   refresh occurs, **Then** the input keeps focus and the cursor position is unchanged.
3. **Given** a save operation fails, **When** the failure occurs, **Then** the user sees
   a clear error with a way to retry, and the unsaved edit is not lost.
4. **Given** the user enters an out-of-range or rule-violating value (e.g., probability
   outside 0–100), **When** the value is committed, **Then** it is visibly flagged for
   correction and never silently replaced.
5. **Given** rapid successive edits to the same fields, **When** saves coalesce in the
   background, **Then** the final entered values are what persist.

---

### User Story 3 - Native World Info Sync and Import (Priority: P1)

The user designates folders as World Info roots — several of them, nested inside each
other if desired. Every root is its own native book with its own name and settings. On
save, all entries beneath each root are flattened into that book in the official native
World Info format, so they take effect in chat generation exactly like entries created in
the app's own editor. The workspace controls which roots participate in generation. If an
entry later leaves a root it once exported under, the divergence is flagged and the user
decides. Existing native lorebooks can be imported into the workspace to continue working
on them; if a native book was changed outside the workspace, the user is warned before an
import overwrites their own unexported edits.

**Why this priority**: Without this bridge, workspace content never reaches the AI; it is
the reason the plugin exists.

**Independent Test**: Can be fully tested by designating roots (including a nested one),
syncing, and verifying the native books activate in a chat identically to natively
created entries; separately, by importing an existing native lorebook and round-tripping
it.

**Acceptance Scenarios**:

1. **Given** a folder designated as a World Info root containing entries, **When** the
   user syncs/saves, **Then** all entries under that root appear as native World Info
   entries with all their fields intact and behave in generation identically to natively
   created entries.
2. **Given** multiple designated roots, including one nested inside another, **When** the
   user syncs, **Then** each root produces its own correct flattened book, and entries
   beneath the nested root legitimately appear in both books (world intersection by
   design).
3. **Given** the workspace's active-books list, **When** the user toggles which roots
   participate in generation, **Then** generation follows exactly that selection.
4. **Given** an entry moved out from under a root it was previously synced under,
   **When** the next sync/inspection happens, **Then** the leftover native counterpart is
   flagged as orphaned and the user explicitly chooses to remove it from the native book
   or restore the entry under the root — nothing changes silently.
5. **Given** a native book changed outside the workspace while the workspace holds
   unexported edits to its entries, **When** the user imports that book, **Then** a
   divergence warning identifies the conflicts and the workspace changes are not
   overwritten without the user's explicit decision.
6. **Given** an existing native lorebook, **When** the user imports it, **Then** it
   appears in the workspace as entries in a folder with all field values preserved, and
   syncing it back produces an equivalent native book.

### Edge Cases

- What happens when an entry is moved from one World Info root directly beneath another
  (both designated) — its membership moves with it; both books' outputs stay correct?
- What happens when a previously synced entry is deleted — its delete confirmation
  discloses that the native copy will be removed at the next sync, and the sync removes
  it automatically (FR-021); only moved-out entries go through the orphan flow. Bulk
  deletion follows the same rule.
- What happens when two roots contain entries with identical keys or titles — allowed
  (separate books); within a single book, identity collisions are resolved visibly.
- What happens when a designated root is renamed — its native book binding survives;
  renaming must not orphan the book; the book name itself never auto-follows folder
  renames (it is an opaque handle assigned once, FR-023).
- What happens when a root designation is toggled off — the binding is released; the
  book remains a plain native book, visible and deletable in the workspace's all-books
  list; nothing is deleted silently (FR-022).
- What happens when a folder is designated as a root while a same-named unbound native
  book exists — the user chooses to adopt that book (divergence-checked) or create a
  new collision-resolved book (FR-022/FR-023).
- What happens when a designated root is deleted — confirmation required, and the user
  chooses whether the native book is kept or deleted with it.
- How does the system behave with very large lore spaces (hundreds of entries, deep
  nesting) — tree interaction stays responsive; sync of 100 entries completes without
  freezing interaction for more than a few seconds (full scale-hardening is Phase 4).
- What happens when the native book file is edited by another tool between syncs —
  divergence is detected on the next import/sync interaction and warned about, never
  silently clobbered.
- What happens with empty names, duplicate names, or special characters in folders and
  entries — names are required and validated; duplicates are allowed but visibly
  surfaced; native book names follow the app's sanitization and collision rules.
- What happens when the workspace is opened with no chat active — tree, editing,
  persistence, and sync are chat-independent and fully functional.
- What happens when image items sit under a World Info root — they export through the
  same merged entity pipeline as entries (exact native encoding fixed at planning).
- What happens when a save burst occurs (many rapid edits before generation starts) —
  saves coalesce and flush before generation so the newest state is what the AI sees.

## Requirements *(mandatory)*

### Functional Requirements

**Structure & tree**

- **FR-001**: The workspace MUST operate on real persisted workspace data (replacing the
  prototype's sample data as the default content); the 'Aldermeer' sample dataset
  remains available only as an explicit "Load demo data" action in the empty state
  (never default content).
- **FR-002**: The workspace MUST allow folders at arbitrary nesting depth, created
  anywhere in the tree, and MUST allow entries and images (the approved merged entity
  model) to be created in any folder; there is no separate "note" item kind.
- **FR-003**: The workspace MUST support renaming, moving, reordering, and deleting
  folders, entries, and images; deleting a non-empty folder and other destructive
  operations MUST require confirmation. The tree MUST also support multi-select with
  bulk move, bulk delete, and bulk enable/disable of entries (minimal parity with the
  native editor's bulk management); destructive bulk operations follow the same
  confirmation rules.
- **FR-004**: Item moves MUST be possible by drag-and-drop AND by a non-drag affordance
  (e.g., a menu action) that remains fully usable on touch devices.
- **FR-005**: The tree toolbar MUST provide the approved controls: sorting modes
  (custom/title/position/depth/order/trigger), kind filters, title/prompt search, and
  creation of folders, entries, and images.
- **FR-006**: The user's custom child ordering and folder expand/collapse state MUST
  persist across sessions.

**Persistence & reliability**

- **FR-007**: Every edit MUST persist such that no field value resets when closing the
  UI, switching chats, or restarting the app.
- **FR-008**: Background saves and refreshes MUST NOT steal focus from, or move the
  cursor within, any input the user is editing.
- **FR-009**: Failed saves MUST be surfaced as visible, actionable errors with retry;
  edits MUST NOT be silently dropped; pending edits MUST be flushed before the next
  generation starts so the newest state is used.
- **FR-010**: The editor MUST reach full native World Info field parity in the approved
  Essentials/Content/Advanced layout; rule-violating values MUST be surfaced visibly,
  never silently reset; the content preview MUST stay live and resolve app-wide
  placeholders (user/character names and similar) to their current values.
- **FR-011**: Item names MUST be required (non-empty after trimming); duplicate names
  MUST be allowed but visibly surfaced.

**Native World Info integration**

- **FR-012**: The user MUST be able to designate any folder as a "World Info" root,
  live-toggle the designation, and maintain multiple roots, including roots nested inside
  other roots.
- **FR-013**: Each designated root MUST be its own native book, created immediately
  upon designation (even while empty, so the user can bind it to characters/personas
  natively right away), with its own name and settings view; syncing MUST flatten all
  entities beneath the root recursively, treating nested designations as ordinary
  folders — so an entry under a nested root appears in both books (world intersection by
  design).
- **FR-014**: The native output MUST preserve every native field of every exported
  entity exactly, so entries behave in chat generation identically to natively created
  entries.
- **FR-015**: Sync MUST be workspace-authoritative: workspace edits push to native books
  on save; native-side changes are pulled in only through explicit import; the system
  MUST detect divergence between workspace entries and their last-exported native state
  and warn the user before an import overwrites unexported workspace changes (never
  silent).
- **FR-016**: The user MUST be able to import an existing native lorebook into the
  workspace as a folder of entries with all field values preserved; importing a book that
  is already bound to a root MUST go through the same divergence flow instead of
  silently overwriting.
- **FR-017**: The workspace MUST own the active-books list (which roots participate in
  generation); designating a root MUST NOT auto-activate its book — activation happens
  only through explicit user action in that list (in the app, "active" World Info means
  globally activated for all chats, so it must stay a deliberate choice);
  character/persona/chat bindings remain native and out of scope.
- **FR-022**: Un-designating a root (toggle-off) MUST simply release the root's book
  binding — the book remains a plain native book, neither deleted nor flagged; because
  the native book-management surface is replaced, the workspace MUST provide its own
  book list showing ALL native books (native-editor parity: every book visible with its
  activation checkbox and deletable; workspace-bound roots marked), so released books
  stay discoverable; re-designating a folder whose proposed book name matches an
  existing unbound book MUST offer to adopt that book (gated by the FR-015 divergence
  check) or create a new one.
- **FR-023**: A book's name MUST be assigned once, at root designation, by passing the
  folder-derived proposal through the app's official collision-resolved name flow
  ("Name (2)" when taken) and stored as a durable root↔book binding; folder renames
  MUST NOT rename the book; book renames MUST be explicit (root settings) and go
  through the same collision-checked flow; at most one binding per book name MUST exist
  at any time. After assignment, the book name is treated as an opaque handle.
- **FR-018**: Entries whose native counterpart was exported under a root they no longer
  sit beneath MUST be flagged as orphaned, and the user MUST explicitly choose to remove
  the native counterpart or restore the entry under the root; the system MUST NOT resolve
  this silently.
- **FR-019**: Renaming a designated root MUST preserve its native book binding; deleting
  a designated root MUST require confirmation and MUST offer the choice to keep or delete
  its native book.
- **FR-020**: All native World Info reads and writes MUST go through the app's official
  World Info mechanisms (never side-channel file writes), so app-side caches, lists, and
  events stay consistent for the rest of the app.
- **FR-021**: Deleting an entity (or a folder containing entities) that has been
  exported to a native book MUST disclose in its confirmation that the native copy will
  be removed at the next sync; the next sync MUST then remove those native copies
  automatically with no second prompt. (Entries merely moved out from under a root keep
  the FR-018 orphan flow, since their removal intent is ambiguous.)

### Key Entities *(include if feature involves data)*

- **Workspace**: The plugin's single top-level container (one global workspace per
  installation); holds the tree, workspace settings, and root-book bindings.
- **Tree Node**: A folder, entry, or image in the tree; every node has a stable identity
  that survives moves and renames; folders order their children (custom order plus
  user-selectable sort modes); entries carry the full native World Info field set;
  images are part of the same merged entity model.
- **World Info Root Designation**: A folder flag that turns the folder into one native
  book — with the book's name, its settings view, and the flatten scope (all entries
  beneath, recursively; nested designations act as ordinary folders inside it). The
  root holds a durable binding to its book's actual name, assigned once through the
  app's collision-resolved flow (FR-023).
- **Export State**: Per-entry sync bookkeeping — never exported / in sync / edited since
  last export / orphaned — including a fingerprint of the entry as last written to the
  native book, which powers divergence detection (FR-015).
- **Native Book**: The flattened `{ entries }` payload produced from one root in the
  official native format; book names follow the app's sanitization and collision rules;
  workspace metadata rides in the book's extension area so it survives app round-trips.
- **Import Session**: The explicit native→workspace pull of one book, gated by the
  divergence check of FR-015.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of entry fields edited in the workspace retain their exact values
  across UI close/reopen, chat switch, and app restart (verified by a field-by-field test
  pass over every field type).
- **SC-002**: Zero input focus or cursor losses during a scripted editing session that
  includes background saves and refreshes.
- **SC-003**: A 100-entry nested lore space (multiple roots, one nested) syncs so that
  every entry appears in the correct native book(s) with all fields intact and behaves in
  chat generation identically to a natively created entry.
- **SC-004**: Import → export → import of a native lorebook preserves 100% of entries
  and field values.
- **SC-005**: In a scripted failure scenario, a failed save is visibly reported and
  fully recovered via retry with zero edit loss.
- **SC-006**: Creating a folder with a new entry takes under 30 seconds; moving an entry
  to another folder takes under 10 seconds by either the drag or the non-drag path.
- **SC-007**: Rendering, scrolling, and editing a 300+ node tree shows no perceptible
  delay compared to the approved prototype at mock scale; syncing 100 entries does not
  block interaction for more than a few seconds.
- **SC-008**: Day-to-day lore management (organize, edit, sync, import) is completed
  entirely within the workspace, without opening the old separate plugins or the native
  editor.

## Assumptions

- Single local user per installation; no authentication, sharing, or multi-device sync
  (inherited from the roadmap).
- One global workspace per installation; world separation is non-linear and the user
  decides which folders become World Info roots, at any nesting depth (spec 002
  clarification, confirmed).
- Workspace-authoritative sync (roadmap FR-012, user-confirmed option A): one-way push
  on save, explicit import back, divergence warnings.
- The merged entry/image entity model is authoritative; image items export through the
  same native-entry pipeline under their root — the exact encoding of image content into
  native fields is fixed during planning.
- Free-form notes are NOT part of the entity model (Phase 0 outcome amending roadmap
  FR-003).
- First run starts from an empty workspace with clear empty-state guidance; the
  'Aldermeer' sample dataset stays as an explicit "Load demo data" action in the empty
  state (resolved 2026-09-08), never default content.
- All native reads/writes use the app's World Info APIs with debounced saves; saves
  flush before generation starts; objects handed to the save path are never mutated
  afterwards (app save-mechanics contract, research R3).
- A root's own settings cover what the native book format actually supports (book name
  and book-level metadata); global scan settings remain app-global — per-root scan
  overrides beyond the native format are out of scope until the format supports them.
- Native book name sanitization and collision resolution follow the app's own rules
  ("Name (N)" pattern).
- UI text is English-only at the artifact level (constitution IX); localization layers
  on later.
- Out of scope for this phase: the AI assistant (Phase 2), markdown import/export
  (Phase 3), interop hooks/slash commands/macros and large-book scale hardening
  (Phase 4), per-root scan overrides beyond the native format, localization, multi-user.

## Dependencies

- The delivered Phase 0 shell and approved UI (three-region surface, editor layout,
  tree interactions) as the visual and interaction baseline.
- The app's World Info format, save mechanics, and extension APIs
  (`specs/001-workspace-plugin-roadmap/research.md` R1–R5, derived from the vendored app
  sources in `context/SillyTavern/`).
- Project quality gates (typecheck, lint, tests, build) per the constitution.
