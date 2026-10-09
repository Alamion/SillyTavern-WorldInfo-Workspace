# Changelog

User-visible changes, newest first. Internal-only work (refactors, tests, tooling) is not
listed here — see the git history for that.

## 0.6.0 — 2026-10-10

Includes everything prepared as 0.5.0 (never published separately).

### Added

- **AI images** in the image editor: *Generate* a picture from a prompt with
  SillyTavern's Image Generation extension (kept only when you press *Keep*, stored with
  the workspace's images); *Write prompt* drafts the prompt from the lore in the image's
  folder and lists the entries it used; *Write caption* lets a picture-reading model
  describe the image for review. The prompt stays on the item and travels with markdown
  (`wi_prompt`).
- **Caption all images without captions** for a folder (folder editor and tree menu): one
  confirmed run with progress and *Stop*, then one list to choose which captions to keep.
- **Image settings** (gear in the image editor): profile and optional model for captions
  and for prompt drafts.
- **Lore picking in the main chat** (off by default): a model picks the entries of your
  active lorebooks the next reply needs; they are activated through World Info itself.
  Picks are prepared in the background, so most replies do not wait; the reader icon
  (header button and on a reply) shows what was picked and whether it was inserted.
- **Context preview**: see everything the assistant's next message would send — each
  entry with the reason it is there (selected, the matching key, the recursion chain…) and
  its estimated size, plus what was left out (layers button beside the context chip). The
  same icon on a reply shows what was sent for it.
- **Entry summaries**: a short "when does this matter" field on every entry, stored in the
  native entry (travels with the book, with markdown as `wi_summary`, and with character
  cards). The assistant can write the summaries of every entry in a folder in one go. The
  Aldermeer demo's lore cards come with summaries.
- **Large libraries**: when the chosen entries do not fit, the assistant gets a catalog
  (names, folders, summaries) and reads the entries it needs before answering.
- **Near matches** (other word forms of keys), **sentence-boundary truncation** of the
  last entry that does not fit, and **named context sets**.
- **Other lore extensions** (all optional): Memory Books entries get badges and keep their
  own fields and order when edited here; Doom's Enhancement Suite scene and DeepLore
  matches can be added to the assistant's context.
- Hook `wi-workspace:pick-completed` for extension authors.

### Changed

- **Several tabs and devices**: a tab picks up changes saved elsewhere when you come back
  to it (or within two minutes while visible); when both sides changed, a banner lists the
  differences and asks which version to keep, and nothing is saved or pushed until then;
  an outdated tab's save is repaired by the newest open tab.
- **Functions that need something missing are marked up front.** The assistant, lore
  picking, markdown folders and the image actions show a warning badge when their
  extension, profile or browser support is missing; pressing them says exactly what to
  enable or choose instead of failing later. Markdown folders now also detect embedded
  browsers (such as VS Code's), where the folder picker exists but cannot be used.
- Every input, select and text area in the workspace follows the theme (no white fields on
  dark themes in new panels); settings panels share one layout of options, fields and
  sections.
- README: refreshed screenshots, new sections for lore picking, AI images and optional
  dependencies; corrected the markdown note — export and import need the same browser
  support as linking.

## 0.4.12 — 2026-09-25

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
- Entry editor: the Selective checkbox is gone — it now follows the optional filter (on
  when it has keywords). Strategy takes its place next to Keys and Logic; Order, Position,
  Depth, Role, Probability and the group fields open Advanced. On phones only Keys stays
  above the content.
- Phones: sheets open fully expanded, and the assistant button closes the assistant sheet
  when it is already open.
- Very large folders render only the rows in view.

### Fixed

- Entries restored from a workspace saved before field normalization existed no longer
  look like they were changed outside the workspace on the next sync.
- Pressing the markdown folders button again now closes its menu instead of reopening it.
- Phones with UI extensions that make the page taller than the screen (AstraProjecta):
  after the keyboard closes, an open item is no longer stuck scrolled up with its header
  out of reach.

## 0.4.11 and earlier

Initial development across roadmap Phases 0–3: the workspace and tree, native World Info
sync, markdown folder sync, and the AI lore assistant. See `specs/002-workspace-ui-prototype`
through `specs/005-ai-lore-assistant` for what each increment delivered.
