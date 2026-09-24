# Changelog

User-visible changes, newest first. Internal-only work (refactors, tests, tooling) is not
listed here — see the git history for that.

## 0.4.12 — unreleased

### Added

- Other extensions can now observe the workspace: events for tree changes, native book
  push outcomes, World Info root designation, and workspace visibility. See
  [docs/hooks.md](docs/hooks.md).
- A README with screenshots of every feature, an extension-author hook reference, and an MIT licence file.

### Changed

- Large libraries are usable. Editing an entry in a 1000-entry book no longer copies the
  whole workspace on every keystroke, expanding or collapsing a folder is immediate, and
  deleting a large multi-selection is no longer a multi-second freeze.
- Typing is local: text fields commit shortly after you stop, instead of on every
  character. Pending text is still saved when you leave the field, switch item, close the
  workspace, or start a generation.
- The markdown preview no longer re-renders while you type, and no longer re-renders at
  all when the text has not changed.
- Very large folders render only the rows in view.

### Fixed

- Entries restored from a workspace saved before field normalization existed no longer
  look like they were changed outside the workspace on the next sync.
- Pressing the markdown folders button again now closes its menu instead of reopening it.

## 0.4.11 and earlier

Initial development across roadmap Phases 0–3: the workspace and tree, native World Info
sync, markdown folder sync, and the AI lore assistant. See `specs/002-workspace-ui-prototype`
through `specs/005-ai-lore-assistant` for what each increment delivered.
