# Feature Specification: Markdown Folder Sync (Roadmap Phase 3)

**Feature Branch**: `004-markdown-folder-sync`

**Created**: 2026-09-14

**Status**: Implemented (owner-validated 2026-09-15; see quickstart.md validation runs)

**Input**: User description: "Насчёт проверки понял, по основным UC пробежался ещё после
разработки фазы 1, вроде всё работает, интерфейс выглядит достаточно интуитивно.
Тестировать на каждодневной основе буду после прохода всех основных фаз. Насчёт фаз по
большому счёту согласен, давай сделаем как ты предложил и начнём с фазы 3 (md
синхронизация с реальной файловой структурой)." — i.e., deliver roadmap Phase 3
(`specs/001-workspace-plugin-roadmap/spec.md`, US6, FR-019–FR-022) next, ahead of the
AI Assistant (Phase 2), as synchronization between the workspace and a real markdown
file/folder structure on disk.

## Baseline and Roadmap Amendments

- **Phase order amended (owner decision, 2026-09-14)**: Phase 3 (Markdown) is delivered
  before Phase 2 (AI Assistant). Phase 1 was walked through by the owner after
  implementation (main use cases pass); day-to-day usage testing is deferred until all
  main phases are delivered.
- **Positioning (inherited from spec 002)**: markdown support exists to make an external
  .md-based hub (e.g., an Obsidian vault) a second working home for the same lore, next to
  the built-in workspace. The goal is a *real folder structure on disk* that both hubs
  can work with, not only a one-off file conversion.
- **Entity model (inherited from spec 003)**: tree items are folders, entries, and images;
  there is no "note" kind (roadmap FR-003 amended in Phase 0). Roadmap US6 scenario 3
  ("preserved as a note") is re-read accordingly: unmappable content is preserved inside
  an entry or left untouched on disk, never dropped.
- **Roadmap "Out of Scope" item "continuous file-watching markdown synchronization"** is
  partially revisited: workspace→disk writes become automatic, while disk→workspace
  changes are still pulled on an explicit trigger — no continuous watching of the disk
  (FR-010).

## Clarifications

### Session 2026-09-14

- Q: Which synchronization mode does the linked folder use? → A: Hybrid — workspace
  edits are written to disk automatically as they are saved; changes made on disk are
  pulled into the workspace on an explicit Sync action and when the workspace is opened.
  No continuous disk watching.
- Q: How many folder links may exist? → A: Exactly one link, for the whole workspace
  (the whole tree mirrors one disk folder). One-off export of a subtree and import into
  a chosen folder remain available as separate actions.
- Q: How does the workspace reach a real folder on disk? → A: Option A only — a folder
  the user picks in the browser. Options B and C are recorded below for a later
  revisit (see "Folder Access Decision").
- Q: How much plugin metadata must markdown files carry (planning review)? → A: As
  little as possible. Every plugin key is optional with a default, so a plain
  Obsidian vault imports and links without the plugin writing anything into the user's
  files. Metadata is written only when it carries non-default information: entry keys
  only for non-default fields; a folder record (`.wiw-folder.yaml`) only for a folder
  that has a World Info designation, a custom order, image captions/titles, or preserved
  keys — so records "appear on export back" only where needed. Identity of items is
  tracked by the link (path + content), not by ids written into files.
- Q: Where do images imported from disk (and uploaded in the editor) live? → A: In the
  app's own user image storage (the Gallery storage, `user/images/`), through the app's
  existing image upload/delete service — no server plugin. The app's Data Bank is meant
  for chat/character document attachments and is not used. Images in formats the app
  image storage does not accept (e.g., SVG) and pre-existing embedded images keep the
  Phase 1 embedded form.

- Q: What does importing a folder produce (owner testing, 2026-09-15)? → A: The picked
  folder becomes ONE workspace folder (as originally specified). Because browser pickers
  select a single folder, the import then offers a selection: the whole folder, or any of
  its top-level folders and files — each chosen folder becomes its own workspace folder
  (this is how several folders are imported at once). Single `.md` notes and image files
  can also be imported via a file picker ("Import files…"). A short-lived "import the
  folder's contents into the target" variant was dropped as too situational.

## Folder Access Decision (2026-09-14)

The plugin runs inside the browser page of SillyTavern and cannot open an arbitrary disk
folder by itself. Three ways were considered:

| Option | How it works | Pros | Cons |
|--------|--------------|------|------|
| **A — Browser folder picker (CHOSEN)** | The user picks a folder in a browser dialog; the page gets read/write access to that real folder | No server-side part, no app config change, no extra install; the folder can be the same one a notes app (Obsidian) uses on this computer | Only desktop Chromium-family browsers (Chrome, Edge, Opera…); unavailable in Firefox and Safari (their vendors declined the capability on security grounds; Safari only offers a browser-private storage invisible to other apps) and on phones (iOS browsers are all Safari-based; Android Chrome lacks the folder picker); only on a secure page (HTTPS or `localhost`) — an app opened over plain `http://<LAN-IP>` does not get it; access is re-confirmed by the user in a new browser session unless the browser remembers the permission; the link is per browser profile |
| B — Server-side folder via a companion server plugin | A small SillyTavern server plugin reads/writes a configured folder on the machine running the app | Works from every browser and device (phones included); the folder lives next to the app's data; no per-session permission | Requires enabling server plugins in the app config and installing a second component — a real adoption barrier for a community release; extra security surface (server writes to a user-chosen path) |
| C — Download / upload only | Export downloads an archive; import uploads files | Works everywhere, trivial | No live link to a real folder; linked sync (US3) degenerates into manual re-import — misses the "second hub" goal |

**Why A**: it is the only option that delivers a live link to a real folder (the
"second hub" goal) without an extra server component or app reconfiguration, and it
covers the owner's actual setup (desktop browser on the machine hosting both the app
and the notes vault). Its environment limits are accepted for this phase.

**Revisit later**: B, if phone/remote access to the linked folder becomes important; C
(or an upload-a-folder import that works in every browser) as a fallback for
unsupported browsers. The sync logic is kept independent of the access mechanism so a
different one can be added without redesign (FR-022).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Export the Lore Tree to a Markdown Folder (Priority: P1)

The user exports the whole workspace, or any folder subtree, to a folder of markdown
files: every workspace folder becomes a directory, every entry becomes one markdown file
whose body is the entry content and whose metadata block carries the entry's World Info
fields, and every image becomes an image file next to the entries that reference it.
Folder-level facts (World Info root designation, bound book name, custom child order)
travel with the directory. The result opens cleanly in a general-purpose markdown editor
or a notes app such as Obsidian and reads naturally there.

**Why this priority**: Export is the first half of every round-trip and immediately
useful on its own (backup, reading and editing lore in an external editor, version
control). It also fixes the file convention every other story depends on.

**Independent Test**: Export a multi-level tree (with a nested World Info root, images,
and entries using every field) to an empty folder, then inspect the files: structure,
names, metadata, and content match the workspace and the documented mapping.

**Acceptance Scenarios**:

1. **Given** a workspace subtree with nested folders, entries, and images, **When** the
   user exports it to an empty target folder, **Then** the directory hierarchy mirrors the
   tree, each entry is one markdown file, and each image is a file referenced from its
   entry/folder as it is in the workspace.
2. **Given** an entry with every native World Info field set, **When** it is exported,
   **Then** every field value appears in the file's metadata block per the documented
   mapping, and the entry content is the file body unchanged.
3. **Given** a folder designated as a World Info root, **When** it is exported, **Then**
   its designation, bound book name, and custom child order are recorded so a later import
   restores them.
4. **Given** items whose names contain characters that are illegal in file names, or two
   siblings with the same name, **When** exported, **Then** file names are made safe and
   unique while the original item names are preserved in the metadata.

---

### User Story 2 - Import a Markdown Folder into the Workspace (Priority: P1)

The user imports a markdown folder — one previously exported by the workspace, or an
existing lore collection written by hand (e.g., an Obsidian vault) — into a chosen place
in the tree. Directories become folders, markdown files become entries, images become
image items. Recognized metadata maps onto entry fields; files without metadata still
import as entries with sensible defaults; nothing the user wrote is dropped.

**Why this priority**: Completes the round-trip (roadmap FR-022) and lets users adopt lore
collections they already have — the other half of the two-hub goal.

**Independent Test**: Import a hand-written sample library (mixed: files with full
metadata, partial metadata, none, unknown metadata keys, images, deep nesting), inspect
the tree; then export → import a workspace subtree and diff it against the original.

**Acceptance Scenarios**:

1. **Given** a markdown folder with nested directories, **When** the user imports it into
   a chosen workspace folder, **Then** the hierarchy appears there with folders, entries,
   and images in the right places.
2. **Given** a file whose metadata contains recognized World Info fields, **When**
   imported, **Then** those values populate the entry's fields exactly.
3. **Given** a file with no metadata or with unrecognized metadata keys, **When**
   imported, **Then** it becomes an entry with default field values, its body becomes the
   content, and the unrecognized metadata is preserved and written back unchanged on the
   next export.
4. **Given** a workspace subtree exported and re-imported, **When** the result is compared
   with the original, **Then** structure, names, content, all fields, root designations,
   and custom order are identical.
5. **Given** a file with invalid metadata (malformed block, out-of-range values), **When**
   imported, **Then** the file still imports, the problem is reported per file, and
   invalid values are surfaced by the workspace's existing validation rather than silently
   coerced.

---

### User Story 3 - Keep a Linked Folder in Sync (Priority: P2)

The user links the whole workspace to a folder on disk. From then on both sides can be
edited — in the workspace, or in an external editor such as Obsidian. Workspace edits are
written to the files automatically as they are saved; changes made on disk are pulled in
when the user runs Sync or opens the workspace. Items created, renamed, moved, or deleted
on one side are reflected on the other; when the same item was changed on both sides
since the last sync, the user sees the conflict and decides, and nothing is overwritten
silently.

**Why this priority**: This is what turns markdown from a conversion utility into the
"second hub" the owner wants. It builds on the file convention and the import/export
engine of US1–US2, so it comes after them.

**Independent Test**: Link the workspace, then edit entries on both sides (including a
rename and a move on disk, a delete in the workspace, and one entry edited on both
sides), run Sync, and verify each change landed on the other side and the conflict was
presented for a decision.

**Acceptance Scenarios**:

1. **Given** a linked workspace in sync, **When** the user edits an entry in the external
   editor and then runs Sync (or reopens the workspace), **Then** the workspace entry
   shows the new content and fields, and (if it is under a World Info root) the native
   book receives the change through the existing workspace sync.
2. **Given** a linked workspace in sync, **When** the user edits, creates, or deletes
   items in the workspace, **Then** the corresponding files are updated or created on
   disk automatically as the edits are saved, with no Sync action needed (deletions per
   scenario 5).
3. **Given** a file renamed or moved to another directory on disk without changing its
   content, **When** the user syncs, **Then** the workspace moves/renames the same entry
   (identity preserved, not a delete plus a new entry).
4. **Given** the same entry changed on both sides since the last sync, **When** the user
   syncs, **Then** the conflict is listed with both versions and the user chooses per item
   (keep workspace / keep file); unresolved conflicts change nothing.
5. **Given** a sync that would delete items on either side, **When** it runs, **Then**
   deletions are shown for explicit confirmation before being applied; a deletion the
   user already confirmed in the workspace (spec 003 delete confirmation) counts as that
   confirmation for its files.
6. **Given** a file changed on disk since the last sync, **When** an automatic workspace
   write would overwrite it, **Then** the write is held back and the item is reported as
   a conflict at the next Sync instead of clobbering the disk change.

---

### User Story 4 - See and Trust the Mapping (Priority: P3)

The user can open, from the workspace, a readable description of the markdown convention:
which metadata key maps to which entry field, how folders record their designation and
order, how images and unrecognized content are handled. After every import, export, or
sync the user sees a short report of what happened (created, updated, moved, deleted,
skipped, preserved-as-is, warnings).

**Why this priority**: Roadmap FR-021 requires the mapping to be documented and visible;
it is what lets people hand-author compatible files. Lower priority because the flows
work without it, but trust and adoption depend on it.

**Independent Test**: Open the mapping reference from the workspace and hand-author a
file from it alone; import it and confirm every documented field lands correctly; check
that the operation report lists every file touched.

**Acceptance Scenarios**:

1. **Given** the workspace, **When** the user opens the markdown mapping reference,
   **Then** every native entry field and every folder-level fact is listed with its file
   representation and default.
2. **Given** any completed import, export, or sync, **When** it finishes, **Then** a
   report lists counts and the individual files affected, including skipped and
   warning items.

### Edge Cases

- A markdown file's body contains content that looks like metadata, or the file has two
  metadata blocks — only the leading block is metadata; the rest is content verbatim.
- Non-markdown, non-image files (PDF, canvas files, app config directories such as a
  notes app's own settings folder) inside the target folder — ignored by import, never
  modified or deleted by export/sync.
- An image referenced by an entry is missing on disk, or an image file is referenced by
  no entry — missing references are reported; unreferenced images import as image items.
- Entry names that differ only by letter case, or that collide after file-name
  sanitization, on case-insensitive file systems — resulting file names stay unique and
  stable across repeated exports (no renaming churn).
- Links between notes in the external editor's own link syntax (e.g., `[[Other note]]`)
  — kept verbatim in content; not interpreted as World Info keys.
- Exporting into a non-empty folder that was not produced by the workspace — the user is
  warned and must confirm; unrelated files are left untouched.
- A World Info root imported from markdown whose recorded book name is already bound to
  another root or exists as an unbound native book — handled by the existing Phase 1
  adopt-or-create and collision-resolution flow (spec 003 FR-022/FR-023), never by
  overwriting.
- Very large libraries (hundreds of files, deep nesting) — import/export/sync finish
  without freezing the interface for more than a few seconds and show progress.
- A sync is interrupted midway (tab closed, access to the folder lost, disk full) — no
  side ends up with half-written files or partially applied changes that the next sync
  cannot detect and repair.
- A file saved with a non-UTF-8 encoding or a byte-order mark — imported with the text
  intact or reported as unreadable, never garbled silently.
- Access to the linked folder is no longer available (moved, permissions revoked, other
  device) — the link is shown as unavailable with a way to re-link; workspace data is
  unaffected.
- The workspace is opened on another device or browser (workspace data is shared, the
  folder link is per browser) — no link is shown there; workspace edits made there are
  written to the folder the next time the linked browser opens the workspace.
- The browser has not yet re-confirmed folder access in this session — automatic writes
  are queued (not lost) and the header offers a one-click reconnect.

## Requirements *(mandatory)*

### Functional Requirements

**File convention**

- **FR-001**: The system MUST define one documented markdown convention: a workspace
  folder is a directory; an entry is one markdown file whose leading metadata block holds
  the entry's fields and whose body is the entry content verbatim; an image item is an
  image file; folder-level facts (World Info root designation, bound book name, custom
  child order, and other persisted folder state) are recorded in the directory in a
  documented way.
- **FR-002**: The convention MUST cover every native World Info entry field held by the
  workspace (spec 003 FR-010 parity), each with a documented key and default; fields
  equal to their default MAY be omitted from the file.
- **FR-003**: Item identity MUST be tracked without requiring ids inside user files:
  renames and moves made in the workspace, and moves/renames of unchanged files on disk,
  MUST be recognized as the same item rather than delete-and-create. A file renamed AND
  edited on disk in the same sync interval MAY appear as a deletion plus a creation; the
  deletion then goes through the FR-014 confirmation, so nothing is lost silently. An
  optional id key, when present in a file, MUST be honored for matching.
- **FR-023**: All plugin metadata in files MUST be optional with documented defaults;
  the plugin MUST NOT write metadata that equals the defaults, and MUST NOT create folder
  records for folders without non-default folder information. Importing or linking a
  plain markdown folder MUST NOT modify any of its files by itself.
- **FR-024**: Images imported from disk MUST be stored in the app's user image storage
  (Gallery) through the app's image service, and image items MUST reference them there;
  the same applies to images uploaded in the workspace editor from now on. Formats the
  storage does not accept keep the embedded form. Deleting the last image item that
  references a stored image MUST remove that stored file.
- **FR-004**: File and directory names MUST be derived from item names, made safe for
  common desktop file systems, unique among siblings (including case-insensitive
  collisions), and stable across repeated exports; the exact item name MUST be preserved
  in metadata whenever the file name differs from it.
- **FR-005**: Metadata keys the convention does not recognize, and any file content the
  convention cannot map, MUST be preserved and written back unchanged — never silently
  dropped (roadmap FR-021).

**Export**

- **FR-006**: The user MUST be able to export the whole workspace or any folder subtree to
  a chosen target folder, producing files per FR-001–FR-005.
- **FR-007**: Exporting into a target that contains files not produced by the workspace
  MUST warn and require confirmation; files the export does not own MUST never be
  modified or deleted.

**Import**

- **FR-008**: The user MUST be able to import a markdown folder into a chosen workspace
  folder: directories → folders, markdown files → entries, image files → image items;
  other file types are ignored and reported.
- **FR-009**: Import MUST accept hand-written files: missing metadata yields entries with
  default field values (title from metadata, else the file name); invalid values MUST be
  reported per file and surfaced through the workspace's existing validation instead of
  being coerced; World Info root designations restored from files MUST go through the
  Phase 1 designation, adopt-or-create, and name-collision flows (spec 003
  FR-013/FR-022/FR-023), and restored roots MUST NOT auto-activate (spec 003 FR-017).

**Linked sync**

- **FR-010**: The user MUST be able to link the workspace to a folder on disk. Sync is
  hybrid: workspace edits MUST be written to the linked files automatically as they are
  saved; disk-side changes MUST be pulled into the workspace on an explicit Sync action
  and when the workspace is opened; the disk MUST NOT be watched continuously. An
  automatic write MUST NOT overwrite a file changed on disk since the last sync — such
  items become conflicts for the next Sync (FR-013).
- **FR-011**: Sync MUST be two-way at item granularity: creations, edits, renames, moves,
  and deletions made on one side since the last sync are applied to the other side.
- **FR-012**: The system MUST remember, per linked item, the state both sides had at the
  last successful sync, so that one-sided changes apply without prompting and changes on
  both sides are detected as conflicts.
- **FR-013**: Conflicts MUST be presented with both versions and resolved per item (keep
  workspace / keep file); unresolved conflicts MUST leave both sides unchanged.
- **FR-014**: Any sync step that deletes items on either side MUST be listed and
  explicitly confirmed before it is applied.
- **FR-015**: Changes arriving from disk into entries under a World Info root MUST reach
  the native book through the existing workspace→native sync (spec 003), with no separate
  path to native World Info.
- **FR-016**: An interrupted or failed import/export/sync MUST leave no half-written
  files and no partially applied workspace changes that the next sync cannot detect;
  failures MUST be reported visibly with a retry, consistent with spec 003 FR-009.

**Access & visibility**

- **FR-017**: Disk folders (for linking, export, and import) MUST be reached through a
  folder the user picks in the browser (Folder Access Decision, option A). The link MUST
  be remembered in this browser so reopening the workspace needs at most one
  confirmation click to regain access. Where the browser or page does not offer folder
  access, markdown actions MUST be shown as unavailable with a short explanation of the
  requirement (desktop Chromium-family browser, secure page) — never fail silently.
- **FR-022**: The import/export/sync logic MUST be independent of the folder-access
  mechanism, so other mechanisms (options B/C) can be added later without changing the
  convention or the sync rules.
- **FR-018**: The mapping reference (FR-001–FR-005) MUST be viewable from within the
  workspace.
- **FR-019**: Every import, export, and sync MUST end with a report of created, updated,
  moved, deleted, skipped, preserved, and warning items, with the individual files listed.
- **FR-020**: At most one link MUST exist, binding the whole workspace tree to one disk
  folder; one-off subtree export (FR-006) and import into a chosen folder (FR-008) stay
  available independently of the link.
- **FR-021**: Link status (linked folder, last sync time, held-back writes / known
  conflicts, unavailable) MUST be visible in the workspace header.

### Key Entities *(include if feature involves data)*

- **Markdown Convention**: The documented rules mapping workspace items and entry fields
  to directories, files, metadata keys, and defaults; includes how unrecognized content
  is carried through.
- **Entry File**: One markdown file = one entry: optional metadata block (non-default
  fields, original name when it differs) + verbatim content body + preserved
  unrecognized metadata.
- **Folder Record**: Optional folder-level facts stored in a directory only when
  non-default: original name, World Info root designation and bound book name, custom
  child order, image captions/titles.
- **Workspace Link**: The single binding between the workspace tree and a folder on
  disk, with its access status, last successful sync time, and held-back writes.
- **Sync Baseline**: Per linked item, the fingerprint of the workspace side and the file
  side at the last successful sync, plus its last known relative path — the basis for
  identity, change, move, and conflict detection.
- **Stored Image**: An image file in the app's user image storage referenced by one or
  more image items.
- **Operation Report**: The per-run list of affected items and outcomes shown after an
  import, export, or sync.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Export → import of a workspace subtree of at least 100 entries (nested World
  Info roots, images, every field type used) reproduces 100% of structure, names,
  content, field values, root designations, and custom order.
- **SC-002**: Import → export of a representative hand-written sample library preserves
  100% of file content and metadata, including unrecognized keys (byte-level diff limited
  to documented normalizations such as key order).
- **SC-003**: Files exported by the workspace open in a general-purpose notes app
  (e.g., Obsidian) with readable content and metadata and no errors.
- **SC-004**: In a scripted two-sided session (edits, a rename, a move, a delete on each
  side, one both-sides conflict), one sync applies every one-sided change correctly,
  presents exactly the one conflict, and loses zero edits.
- **SC-005**: Repeating an export or a sync with no changes on either side modifies zero
  files and zero workspace items.
- **SC-006**: A library of 300 files imports, exports, or syncs without the interface
  being unresponsive for more than 3 seconds at a time, with visible progress.
- **SC-007**: A user can hand-author an importable entry using only the in-workspace
  mapping reference, in under 5 minutes.

## Assumptions

- Single local user per installation; no multi-user or cloud merge (inherited from the
  roadmap). Syncing the disk folder between devices (e.g., via a cloud drive or the
  notes app's own sync) is the user's concern outside the plugin.
- The metadata block uses the de-facto markdown front-matter convention widely read by
  notes apps (e.g., Obsidian properties); exact key names are fixed during planning and
  documented per FR-018.
- Workspace-internal state that is not lore (expand/collapse state, sync bookkeeping,
  native uid slots) is not written into entry files unless needed for identity or
  round-trip fidelity; per-book uid/sync state stays in the workspace.
- Links in the notes app's own syntax are content, not structure; the workspace does not
  resolve or rewrite them in this phase.
- The workspace data remains the single source for native World Info; disk files never
  write to native books directly (spec 003 FR-020).
- UI text and all artifacts are English-only (constitution IX).

## Dependencies

- Phase 1 workspace data model, persistence, and native sync (spec 003), including the
  designation, adopt-or-create, and collision flows reused by import.
- The native World Info field inventory (`specs/001-workspace-plugin-roadmap/research.md`
  R1) for the metadata mapping.
- The browser folder-access capability (FR-017): desktop Chromium-family browser and a
  secure page (HTTPS or `localhost`).

## Out of Scope

- The AI assistant (roadmap Phase 2, now after this phase).
- Interpreting notes-app link syntax as World Info keys or relations; rendering of
  notes-app-specific embeds beyond plain images.
- Non-markdown lore formats (JSON/.lorebook import already exists from Phase 1; other
  formats are not added here).
- Version history, git integration, or multi-device merge of the disk folder.
- Character cards and other non-World-Info content types.
