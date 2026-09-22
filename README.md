# World Info Workspace

A SillyTavern UI extension that replaces the native Worlds/Lorebooks editor with a single
workspace for lore: a folder tree of any depth, automatic sync into real World Info books,
an in-workspace AI lore assistant, and two-way markdown folder sync (Obsidian vaults
included).

## Install

In SillyTavern: **Extensions → Install extension**, and paste:

```
https://github.com/Alamion/SillyTavern-WorldInfo-Workspace
```

Then reload the page. Open the **World Info** drawer as usual — you will now see a
**Workspace** button in the book row. The native editor stays available: the workspace
header has a **Worlds/Lorebooks** button that switches back at any time.

Nothing is converted or moved on install. Your existing books are untouched until you
explicitly import one or designate a folder as a World Info root.

## Requirements

| Feature | Needs |
|---|---|
| Workspace, tree, native sync | Nothing beyond SillyTavern |
| AI lore assistant | The **Connection Manager** extension, and at least one connection profile |
| Markdown folder link | A desktop Chromium-based browser (Chrome, Edge, Brave…) on a secure page (`https://` or `localhost`) |

The markdown link uses the browser's File System Access API. On Firefox, Safari, or a
non-secure page the control is visible but disabled and says why. One-off **export** and
**import** still work everywhere.

## The workspace

The tree holds three kinds of item, nested however you like:

- **Folders** — organise anything, any depth.
- **Entries** — lore cards. Every native World Info field is editable, grouped into
  Essentials / Content / Advanced.
- **Images** — pictures with captions, for your own reference.

Edits are saved as you make them. Selecting several items enables bulk actions; on touch
devices a long press opens the item menu.

**Images and folders are workspace-only.** They are never written into a World Info book
and never come back from one — books have no concept of either.

## World Info sync

A folder becomes a real lorebook when you designate it as a **World Info root**.

- Designating creates the book immediately, **inactive**. Activate it from the Lorebooks
  panel when you want it in play.
- Everything under that folder — at any depth — is flattened into that one book.
- The workspace is the source of truth. Your edits are pushed automatically about a second
  after you stop typing, and always before a message is generated.
- The book's **name is fixed when it is created**. Renaming the folder later does not
  rename the book; the name is just a handle.
- Moving an entry out of the root removes it from the book on the next sync; moving one in
  adds it.
- Deleting items tells you first exactly what will disappear from which book.

Changes made outside the workspace are merged in silently when they do not collide.
If the same entry was edited on both sides, you get a conflict banner and decide.
If a save fails, a banner offers **Retry** and nothing is lost.

You can also **import** any existing book into the tree from the Lorebooks panel, with
per-entry conflict resolution.

## Markdown folders

Any subtree can be exported to markdown, and any markdown folder can be imported.
Separately, **one** folder can be *linked* for continuous two-way sync.

- A directory becomes a folder, a `.md` file becomes an entry, image files become image
  items.
- Entry fields live in YAML front matter under `wi_`-prefixed keys. The body below is your
  prose, kept verbatim.
- Every key is optional. Defaults are never written, and keys the convention does not own
  (your own front matter, or unknown `wi_*` keys) are preserved on round-trip.

While linked, workspace edits are written to disk automatically, and changes on disk are
pulled in when you open the workspace or press Sync. If both sides changed the same item
you choose per item: keep workspace, keep file, or skip. Deletions on disk are confirmed
before anything is removed.

Use **Reference** in the markdown menu to see the full field table and a sample entry.

## The AI assistant

The assistant panel writes and reorganises lore with you. It needs the Connection Manager
extension and a profile selected in its settings.

It answers in prose and attaches **proposals** — create this entry, edit that one, move
these into a folder. **Nothing is applied until you accept it.** You can review each
proposal as a diff, edit it before accepting, accept them all, or deny. Any applied batch
can be undone while the conversation exists.

Deletions and heavy content removals always ask separately and are never included in
"Accept all".

You choose how much context it sees — the selected items, the whole structure, the current
chat, the character card — and what you choose becomes the default for new conversations.
Conversations are stored in your browser, per profile, not in your settings.

Free models are rate-limited often; the assistant retries automatically and tells you what
happened.

## Extending it

Other extensions can observe the workspace through documented events. See
[docs/hooks.md](docs/hooks.md).

## Troubleshooting

**The markdown control is greyed out.** You are not on desktop Chromium, or the page is
not secure. One-off export/import still work.

**The assistant says it cannot send.** The Connection Manager extension is missing, or no
profile is selected in the assistant's settings.

**A book shows a conflict banner.** The same entry changed in the workspace and outside
it. Open the banner to compare and pick a side.

**"Workspace data could not be loaded".** Your settings payload could not be read. The
workspace stays empty and your stored data is left untouched until you edit — use
**Restore** in the banner.

## License and credits

Author: Alamion. Built on the patterns of SillyTavern-3DDiceRolls; supersedes the
WorldInfoDrawer and WorldInfo-Recommender workflows.
