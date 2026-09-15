# Contract — Markdown UI Surfaces

All surfaces use the shared style system (`src/styles/wiw-theme.scss`; constitution
amendment 1.2.0) and the existing modal/banner/menu primitives. English UI text.

## Workspace header — link control

| State | Shown | Actions |
|-------|-------|---------|
| Unsupported environment | disabled `fa-folder-tree` button | tooltip + click opens an info popup: "Markdown folders need a desktop Chromium-based browser (Chrome, Edge, Opera…) and a secure page (HTTPS or localhost)." |
| Not linked | `fa-folder-tree` button "Markdown" | menu: Link folder…, Export to folder…, Import folders… (whole folder or chosen top-level folders/files), Import files (.md, images)…, Mapping reference |
| Linked, access granted | chip "`<folder name>` · synced `<relative time>`"; badge with count of held-back writes / conflicts when > 0 | Sync now, Re-link…, Export to folder…, Import folders…, Import files…, Mapping reference, Last report, Unlink |
| Linked, access needs confirmation | chip with `fa-plug` "Reconnect" | click → request access → pull |
| Linked, unavailable (denied / folder gone) | warning chip "Folder unavailable" | Re-link…, Unlink |
| Operation running | chip spinner + "Syncing 120/300" | — |

## Confirmations (before anything is applied)

- **Link a non-empty folder**: names the folder and shows counts — matched, will be
  imported, will be written to disk, conflicts (research R9).
- **Export into a non-empty folder not produced by the workspace** (FR-007): lists that
  unrelated files are left untouched; names files that would be overwritten.
- **Disk deletions** (pull, FR-014): list of workspace items whose files were deleted on
  disk; Confirm deletes them in the workspace (the Phase 1 native-copy disclosure of
  spec 003 FR-021 is appended when applicable); Cancel keeps them and re-writes their
  files on the next push.
- **Workspace delete while linked**: the existing delete confirmation adds "Its file(s)
  in the linked folder will be removed."

## Conflict resolution modal (FR-013)

One row per conflicted item (collapsed by default): path, what changed on each side
(edited / deleted / moved), expandable side-by-side line diff via the shared `DiffView`
(workspace rendering vs file text). Per row: **Keep workspace** / **Keep file** / **Skip**
(the selected option is highlighted with the accent color); bulk "Keep all workspace" /
"Keep all files". Apply executes only decided rows; skipped rows stay conflicts (both
sides unchanged).

## Import selection

After a folder is picked (if it has subfolders): a checklist with "<folder> (whole folder)"
checked by default, followed by its top-level folders, notes and images. Choosing items
unchecks the whole-folder option; each chosen folder becomes its own workspace folder.

## Operation report (FR-019)

Modal after every import/export/sync: counters (created, updated, moved, deleted,
skipped, preserved, conflicts, warnings), then a collapsible per-file list with outcome
and message. Also reachable from the header chip ("Last report").

## Mapping reference (FR-018)

Modal rendering [markdown-convention.md](./markdown-convention.md) tables (entry keys
with types/defaults, folder record keys, scanner rules, naming rules) plus a copyable
sample entry file.
