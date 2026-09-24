# World Info Workspace

One place for your lore in **SillyTavern**: a folder tree of any depth, kept in sync with
real World Info books, with a markdown folder on disk and an AI lore assistant attached to
the same tree.

![The workspace: tree, entry editor with live preview, and the assistant](docs/images/workspace.png)

> Replaces the native Worlds/Lorebooks editor while it is enabled — the native editor is
> always one button away, and nothing is converted until you ask for it.

## What it does

- **Organises lore as a tree.** Folders, lore entries and images, nested however you like.
  Multi-select for bulk actions, drag to move, long press on touch devices.
- **Turns any folder into a real lorebook.** Everything beneath it is flattened into one
  native World Info book and pushed automatically as you edit — no export step.
- **Writes and reads markdown folders.** Export a subtree, import a vault, or link one
  folder for continuous two-way sync. Obsidian vaults work as they are.
- **Puts an AI assistant next to the tree.** It proposes entries, edits and
  reorganisations; nothing is applied until you accept it, and any batch can be undone.
- **Keeps every native field.** Keys, strategy, order, position, depth, role, character
  filters, triggers — the full World Info entry, grouped so the common fields are up front.

## In one pass

A folder becomes a World Info root, its entries are edited in the workspace, and the same
entries turn up in the native Worlds/Lorebooks editor — no export step in between.

![Designating a folder as a World Info root, editing an entry, and finding it in the native book](docs/images/walkthrough.gif)

## Install

In SillyTavern: **Extensions → Install extension**, and paste

```
https://github.com/Alamion/SillyTavern-WorldInfo-Workspace
```

Reload the page, open the **World Info** drawer, and press **Workspace** in the book row.
The workspace header has a **Worlds/Lorebooks** button that switches back at any time.

## The tree

Three kinds of item, nested to any depth:

| Item | What it is |
| --- | --- |
| **Folder** | Organises everything else. Can be designated a World Info root. |
| **Entry** | A lore card — every native World Info field, editable. |
| **Image** | A picture with a caption, for your own reference. |

Edits are saved as you make them. **Images and folders are workspace-only:** they are never
written into a World Info book and never come back from one, because books have no concept
of either.

### Writing with live preview

The content field is markdown, rendered as you type — headings, emphasis, lists, tables,
callouts, and Obsidian-style `[[wikilinks]]` and `![[embeds]]` that resolve against your own
tree.

![Markdown source beside its live preview: a callout, a table, wikilinks and an embedded image](docs/images/markdown-preview.png)

Lore is usually written line by line, so **every line is its own paragraph** — you do not
need a blank line between them. Wikilinks resolve against your tree, and `![[an image]]`
embeds an image item you already have.

## World Info sync

A folder becomes a real lorebook when you designate it a **World Info root**.

- The book is created immediately and left **inactive**. Activate it from the Lorebooks
  panel when you want it in play.
- Everything beneath the folder, at any depth, is flattened into that one book.
- The workspace is the source of truth. Edits are pushed about a second after you stop
  typing, and always before a message is generated.
- The book's **name is fixed when it is created**. Renaming the folder later does not
  rename the book — the name is just a handle.
- Moving an entry out removes it from the book on the next sync; moving one in adds it.
- Deleting tells you first exactly what will disappear from which book.

![A folder designated as a World Info root, bound to the native book it fills](docs/images/wi-root.png)

Changes made outside the workspace merge in silently when they do not collide. If the same
entry changed on both sides you get a conflict banner and decide. If a save fails, a banner
offers **Retry** and nothing is lost.

<table>
  <tr>
    <td><img src="docs/images/lorebooks.png" alt="The Lorebooks panel listing every native book with activation and import controls" width="430"></td>
    <td valign="top">
      <b>The Lorebooks panel</b><br><br>
      Every native book in one list: activate globally or per character and chat, import one
      into the tree, update it from native, or delete it. Search, filters and paging for
      large libraries.
    </td>
  </tr>
</table>

## Markdown folders

Export any subtree to markdown, import any markdown folder, or link **one** folder for
continuous two-way sync.

- A directory is a folder, a `.md` file is an entry, image files are image items.
- Entry fields live in YAML front matter under `wi_`-prefixed keys; the body below is your
  prose, kept verbatim.
- Every key is optional, defaults are never written, and keys the convention does not own —
  your own front matter, unknown `wi_*` keys — survive the round trip.

While linked, workspace edits are written to disk automatically and disk changes are pulled
in when you open the workspace or press Sync. If both sides changed the same item you
choose per item: keep workspace, keep file, or skip. Deletions on disk are confirmed before
anything is removed.

![The built-in mapping reference: how folders map, and every front-matter key](docs/images/markdown-reference.png)

**Linking needs a desktop Chromium-based browser on a secure page** (`https://` or
`localhost`), because it uses the File System Access API. Elsewhere the control is disabled
and says so — one-off export and import still work everywhere.

## The AI assistant

The assistant writes and reorganises lore with you, using the connection profile you pick in
its settings.

<table>
  <tr>
    <td><img src="docs/images/assistant.png" alt="Two proposed entries, each pending your decision, with Accept, Deny, Edit and Diff" width="360"></td>
    <td valign="top">
      <b>Nothing is applied until you accept it.</b><br><br>
      Each proposal can be reviewed as a diff, edited before accepting, accepted with the
      rest, or denied. Any applied batch can be undone while the conversation exists.
      Deletions and heavy content removals always ask separately and are never part of
      "Accept all".<br><br>
      The notice above the proposals says exactly what the model was sent, so a surprising
      answer is traceable rather than mysterious.
    </td>
  </tr>
</table>

You choose what it sees — the selected items, the whole structure, the current chat, the
character card — and that choice becomes the default for new conversations. Conversations
live in your browser, per profile, never in your settings.

It needs the Connection Manager extension and at least one
[connection profile](https://docs.sillytavern.app/usage/core-concepts/connection-profiles/).
Free models are rate-limited often; the assistant retries by itself and tells you what
happened.

## For extension authors

Other extensions can observe the workspace through documented, namespaced events — tree
changes, native book push outcomes, World Info root designation, workspace visibility:

```js
const { eventSource } = SillyTavern.getContext();
eventSource.on('wi-workspace:tree-changed', ({ changes }) => {
    // [{ change: 'create' | 'delete' | 'move' | 'rename' | 'update', node: {...} }]
});
```

Full reference, payloads and stability promise: **[docs/hooks.md](docs/hooks.md)**.

## Building from source

```bash
pnpm install
pnpm run build      # production bundle to dist/index.js
pnpm run dev        # watch mode
pnpm run test       # Vitest suite, then the performance budgets
pnpm run lint
pnpm exec tsc --noEmit
```

The built bundle is committed, because `manifest.json` points at `dist/index.js`.

## Credits

Projects this one took its cues from — each solved a piece of the problem first, and this
workspace is better for having read them.

### [SillyTavern-3DDiceRolls](https://github.com/Alamion/SillyTavern-3DDiceRolls)

The structural baseline. This extension reuses its shape for an ST extension that ships a
real front end: a React + Webpack + SCSS bundle behind a single manifest, styling driven
entirely by theme variables so the UI follows the user's theme, and the small settings and
logging modules that sit between the app and the extension's own state.

### [SillyTavern-WorldInfoDrawer](https://github.com/LenAnderson/SillyTavern-WorldInfoDrawer)

Showed that lore editing belongs in a roomy drawer rather than the native form, and that an
extension can re-bind the native World Info entry point so the richer editor opens in place
instead of living somewhere else in the UI. The mode toggle back to Worlds/Lorebooks comes
directly from that idea.

### [SillyTavern-WorldInfo-Recommender](https://github.com/bmen25124/SillyTavern-WorldInfo-Recommender)

The source of the assistant's central rule: **propose first, apply only on confirmation.**
Its workflow — ask a model for lore, show what it came up with, let the user take some of
it — is what the in-workspace assistant generalises into reviewable batches with diffs and
undo.

## License

[MIT](LICENSE).
