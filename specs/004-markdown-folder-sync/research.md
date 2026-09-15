# Research — Markdown Folder Sync (004-markdown-folder-sync)

Resolves every open technical question of [plan.md](./plan.md). Format per item:
Decision / Rationale / Alternatives considered. Browser facts were checked on 2026-09-14
against MDN, Chrome developer docs, and caniuse; re-verify in the live Chromium during
implementation (quickstart S0).

## R1. Folder access mechanism (spec FR-017, "Folder Access Decision")

**Decision**: File System Access API — `window.showDirectoryPicker({ id, mode:
'readwrite' })` for link/export, `mode: 'read'` for one-off import. Availability gate:
`isSecureContext && typeof window.showDirectoryPicker === 'function'`; otherwise every
markdown action renders disabled with the explanation text from
[contracts/md-ui-contract.md](./contracts/md-ui-contract.md).

Facts relied upon:

- Supported by desktop Chromium-family browsers (Chrome/Edge 86+, Opera 72+). Firefox
  and Safari ship only the Origin Private File System (OPFS), not the local-disk pickers;
  Chrome/Firefox for Android and all iOS browsers do not expose `showDirectoryPicker`.
- Secure context only (HTTPS or `localhost`/`127.0.0.1`); pickers need a user gesture.
- Directory handles are structured-cloneable and can be stored in IndexedDB.
- Permission state is re-checked per session: `handle.queryPermission({ mode })` →
  `granted | prompt | denied`; `handle.requestPermission({ mode })` needs transient user
  activation. Recent Chrome versions offer the user a persistent "allow on every visit"
  grant, after which `queryPermission` returns `granted` on reload.
- `FileSystemHandle.move()` is shipped only inside OPFS (behind a flag for local disk;
  not for directories) → **not used**. Renames/moves are copy-then-remove.
- `createWritable()` writes into a browser-managed swap file and replaces the target
  only on `close()`; `abort()` discards it → each file write is atomic from a reader's
  perspective. Chromium leaves `*.crswap` files after a crash → ignored by the scanner.
- `removeEntry(name, { recursive: true })` deletes directories.
- The browser may refuse sensitive OS folders at pick time (surfaced as a picker error).

**Rationale**: owner decision (spec). The access layer is a narrow port
([contracts/disk-port.md](./contracts/disk-port.md)) so option B (server plugin) or C
(upload/download) can be added as another port implementation (FR-022).

**Alternatives considered**: B and C — see spec "Folder Access Decision". Continuous
watching (`FileSystemObserver`, Chromium-only, not broadly shipped) — rejected; also out
of scope by FR-010.

## R2. Regaining access on open (FR-010 "pull when the workspace is opened", FR-017)

**Decision**: On workspace open, the link manager calls `queryPermission`. `granted` →
run a pull. `prompt` → call `requestPermission` synchronously inside the click handler
of the native "Workspace" button (still within transient activation); if that is not
possible (open not caused by a click, activation expired) the header shows a
**Reconnect** button — one click grants and pulls. `denied` / handle lost →
"unavailable" status with **Re-link**. While access is missing, auto-writes are not
queued as operations: pending writes are *derived* from the baseline diff at the next
grant, so nothing can be lost or double-applied.

**Rationale**: meets "at most one confirmation click" (FR-017) without a bespoke queue.

**Alternatives considered**: persisting an operation queue (rejected: duplicate
application risk after partial failures; the diff is the source of truth).

## R3. YAML front matter parsing and writing

**Decision**: Use the app-provided `yaml` library (`globalThis.SillyTavern.libs.yaml`,
`yaml@^2`, exported by `public/lib.js`) through a small adapter
(`src/adapters/yamlCodec.ts`) that implements a pure `YamlCodec` port
(`parse(text) → unknown`, `stringify(value) → string`). Core logic never imports the
library; Vitest uses the `yaml` package (same major) as a devDependency only.

Serialization rules: YAML 1.2 core schema; strings are quoted by the library when
needed; key order on write = documented key order, then preserved foreign keys in their
original order. YAML comments in front matter are **not** preserved (documented
normalization, allowed by SC-002).

**Rationale**: constitution II (app API first, no duplicate bundle); `yaml` v2 is
YAML-1.2 compliant, round-trips scalars exactly, and is what the app already ships.

**Alternatives considered**: bundling `js-yaml` (duplicate dependency, YAML 1.1 quirks
like `no → false`); a hand-written front-matter subset parser (fails on hand-written
vault files using lists/objects/multi-line strings).

## R4. Markdown convention (FR-001..FR-005)

**Decision** (full contract: [contracts/markdown-convention.md](./contracts/markdown-convention.md)):

- Directory = folder; `<name>.md` = entry; image file = image item.
- **Minimal metadata (spec FR-023)**: every plugin key is optional with a default; a
  plain Obsidian note is a valid entry. Nothing is written into a file merely because
  it was imported or linked.
- Entry file = optional front matter block + body. Plugin-owned keys use the `wi_`
  prefix. Ids are NOT written; an optional `wi_id` key, if a user or tool adds one, is
  honored for matching. Every key without the prefix is foreign and preserved verbatim
  (Obsidian `tags`, `aliases`, etc.).
- Body = `native.content` verbatim. Writer emits `---\n<yaml>---\n\n<content>`; reader
  removes exactly one blank line after the closing delimiter if present → exact
  round-trip for any content and natural hand-authoring.
- Entry title = `native.comment` = node name; written as `wi_title` only when it
  differs from the file stem.
- Enum fields are written as readable names (`position: before_char`, `role: system`,
  `selective_logic: and_any`); import accepts names or native numbers.
- Fields equal to their default are omitted on write (defaults =
  `createDefaultNativeEntry`). Per-book state (`uid`, `displayIndex`, sync) is never
  written.
- Folder record: a dotfile `.wiw-folder.yaml`, written ONLY for a folder with
  non-default folder information — name differing from the directory name, WI root
  designation and book name, custom child order (by child file/directory name) that
  differs from the default order (folders first, then case-insensitive name), image
  captions/titles, or preserved foreign keys. Obsidian and most editors hide dotfiles,
  so vaults stay clean. A plain vault therefore has no records until the user adds
  such information in the workspace; records then "appear on export back".
- Ignored on scan: dot-entries other than the folder record (e.g. `.obsidian/`,
  `.git/`), `*.crswap`, and files that are neither `.md` nor a supported image type
  (`png jpg jpeg gif webp svg avif bmp`).

**Rationale**: a namespace prefix is the only unambiguous way to satisfy "unrecognized
keys preserved" while staying hand-authorable; dotfile records keep structure metadata
out of the notes app's file list.

**Alternatives considered**: unprefixed native field names (collide with common vault
properties such as `order`, `group`, `position`); a nested `wi:` object (poorly edited
in Obsidian's property UI); "folder notes" `Folder/Folder.md` (ambiguous with an entry
of the same name); one global manifest file at the top (breaks when directories are
moved in the external editor).

## R5. File naming (FR-004)

**Decision**: stem = item name with `< > : " / \ | ? *` and control characters replaced
by `_`, trailing dots/spaces trimmed, Windows reserved names (`CON`, `PRN`, `AUX`, `NUL`,
`COM1-9`, `LPT1-9`) suffixed with `_`, length capped at 120 UTF-16 units, empty →
`Untitled`. Sibling uniqueness is checked case-insensitively (NFC-normalized); collisions
get ` (2)`, ` (3)`… Stability: when an item's current baseline path still produces the
same sanitized stem (ignoring the collision suffix), the existing path is kept → no
renaming churn across exports (SC-005).

**Rationale**: works on NTFS, APFS (case-insensitive), ext4; matches the app's own
"Name (N)" collision pattern users already know.

**Alternatives considered**: slug/transliteration (loses readable non-Latin names —
the owner's vaults may be Russian); id-based file names (unreadable in Obsidian).

## R6. Images (US1, FR-008)

**Decision** (revised in planning review, spec FR-024):

- **Storage**: images imported from disk and images uploaded in the editor are stored in
  the app's user image storage — the same storage the built-in Gallery extension uses
  (`user/images/<subfolder>/`) — via the app's `POST /api/images/upload`
  (`{ image: <base64>, format, ch_name: 'WorldInfoWorkspace', filename }` → `{ path }`,
  e.g. `user/images/WorldInfoWorkspace/Aldermeer map-3f9a.png`) and removed via
  `POST /api/images/delete` (`{ path }`, server restricts it to `user/images/`). The
  item's `src` becomes that path. Accepted formats (app `MEDIA_EXTENSIONS`): `bmp png jpg
  jpeg jfif gif webp`; SVG, AVIF, and anything else keep the Phase 1 `data:` URI form.
  File names get a short random suffix because the upload endpoint overwrites an
  existing name silently.
- **Ownership / cleanup**: only files under `user/images/WorldInfoWorkspace/` are owned.
  When an image item is deleted (or its source replaced) and no other item references
  that `src`, the owned file is deleted. Existing `data:` URIs are left as they are (no
  automatic migration in this phase).
- **Adapter**: `src/adapters/imageStore.ts` calls the endpoints with
  `ctx.getRequestHeaders()`. The app's own helper `saveBase64AsFile`
  (`public/scripts/utils.js`) wraps the same endpoint but is not exposed through
  `getContext()`, so the adapter mirrors it (constitution II: documented app endpoint
  used by core extensions; isolated in one adapter).
- **Export**: `data:` URI → decoded bytes (extension from MIME); other `src` → `fetch`
  (same-origin `user/images/...` succeeds); if the fetch fails (external URL, CORS) no
  file is written and the folder record keeps a URL-only image entry (`wi_src`) with a
  warning.
- Image title/caption live in the folder record keyed by file name, only when non-default
  (caption non-empty, title ≠ file stem).

**Rationale**: keeps shared settings small (no megabytes of base64 in
`extensionSettings`), uses app-owned storage visible in the app's Gallery folder, and
needs no server plugin. Images stay workspace-only (never exported to native books —
spec 003 decision).

**Alternatives considered**: `data:` URIs for everything (Phase 1 behavior; bloats the
settings file shared by every device); the app's Data Bank (`/api/files/upload`,
`user/files/`) — designed for chat/character document attachments used by retrieval,
not for images, and its attachment registry would list workspace images as documents;
a server plugin — rejected by the spec's access decision.

## R7. Change detection and three-way sync (FR-011..FR-014)

**Decision**: Per link, a **baseline** records for every synced item: id, kind, relative
path, `wsHash` (hash of the item's canonical file representation rendered from the
workspace) and `diskHash` (hash of the file bytes as last read/written). Hash = SHA-256
via `crypto.subtle.digest` (hex). Folder records participate as items of kind `folder`.

Per item on pull (Sync / open):

| Workspace vs baseline | Disk vs baseline | Result |
|-----------------------|------------------|--------|
| same | same | nothing |
| same | changed | apply disk → workspace |
| changed | same | write workspace → disk |
| changed | changed | conflict, unless both canonical forms are equal (auto-resolve) |
| same | missing | **disk deletion** → listed for confirmation, then deleted in workspace |
| changed | missing | conflict (edited here, deleted there) |
| missing | same | workspace deletion → file removed (confirmed at delete time) |
| missing | changed | conflict (deleted here, edited there) |
| new (no baseline) | — | create file |
| — | new (no baseline match) | create workspace item (file left untouched) |

Identity without ids in files (spec FR-003, FR-023) — matching order per pull:

1. **Optional `wi_id`** in a file that names an existing baseline item → that item.
2. **Path**: a disk path equal to a baseline item's path → that item.
3. **Content move detection**: a baseline item whose path is missing on disk and an
   unmatched disk file (same kind) with `diskHash` equal to the baseline `diskHash` →
   the same item moved/renamed (only when the hash match is unique on both sides;
   ambiguous matches fall back to delete + create).
4. **Folder moves**: a baseline folder whose directory is missing, where every matched
   descendant moved into the same new directory (or its record's hash matches) → the
   folder node moved/renamed (keeps its id, WI designation, book binding).
5. Leftovers: baseline items → disk deletions (confirmation); disk items → creations.

A file renamed AND edited within one interval becomes delete + create; the delete is
confirmed by the user (FR-014), so the edit is never lost. Workspace-side moves/renames
are always exact (the workspace knows ids): write the new path, then remove the old path.
An interrupted move leaves both paths with identical bytes → step 3 cannot apply (old
path still exists), so a special rule applies: a new file byte-identical to a baseline
item that still exists at its path, whose workspace render maps to the NEW path → the
move is finished (old path removed).

Automatic push (workspace → disk): the link manager subscribes to the store, debounces
1000 ms, diffs workspace hashes against the baseline, and for each changed item first
re-reads the target file hash; if it differs from `diskHash`, the write is **held back**
(counted in the header, resolved as a conflict at the next Sync).

**Rationale**: a three-way comparison is the minimum that distinguishes one-sided
changes from conflicts (spec FR-012); SHA-256 removes the practical collision risk that
the 32-bit FNV used for native divergence warnings would carry here (a collision would
silently skip a change).

**Alternatives considered**: `lastModified` timestamps only (unreliable across sync
tools and copy operations; used only as an optional read-skip hint, not for decisions);
last-writer-wins (violates "nothing overwritten silently").

## R8. Baseline and link storage

**Decision**: IndexedDB database `WorldInfoWorkspace-md` (store `links`, key `default`)
holds `{ handle, rootWsId, baseline, lastSyncAt }` — per browser profile. Workspace data
itself stays in `extensionSettings`; nothing about the link is written there.

**Rationale**: the directory handle can only live in IndexedDB, and the baseline
describes the relationship with *that* folder in *this* browser. Keeping both together
means another device (shared settings, no handle) never inherits a stale baseline; its
edits simply show up as workspace-side changes when the linked browser opens the
workspace (spec edge case).

**Alternatives considered**: baseline in `extensionSettings` (shared across devices while
the handle is not → wrong decisions on a second linked browser); `localStorage` (size
limit, cannot store handles).

## R9. Initial link and re-link (FR-010)

**Decision**: Linking a folder runs a reconcile without a baseline: the workspace
computes the path every item would have (naming rules R5) and matches disk items by
optional `wi_id`, then by that path; matched items with equal canonical forms become
in-sync (baseline created), differing matched items become conflicts, and items present
on one side only are created on the other (files created on disk; disk-only items
imported). A non-empty folder always gets a confirmation first showing the counts
(matched / will be imported / will be written / conflicts). Re-link after a lost handle
uses the same path. Unlink only deletes the IndexedDB record — files and workspace data
stay.

## R10. Applying disk changes to the workspace and native sync (FR-015, FR-016)

**Decision**: Pull builds the full change set first (pure, `core/md/reconcile.ts`), asks
for confirmations/conflict decisions, then applies all accepted workspace changes in ONE
`store.replace` produced by the Phase 1 pure tree operations (`createChild`, `moveNode`,
`renameNode`, `commitEntryField`, `commitImage`, `deleteSubtree`) and afterwards invokes
the same sync-engine hooks the UI uses after equivalent edits
(`refreshStructure`, `recordEntityDeletions`, `markBooksDirty`). To avoid duplicating
that choreography, the UI's post-edit hook calls are extracted into one shared adapter
function (`src/adapters/workspaceActions.ts`) used by both `WorkspaceApp` and the md
link manager. Disk writes happen after the workspace commit; the baseline is persisted
after every successfully written file batch, so an interruption leaves only items whose
baseline is stale — the next Sync re-derives and completes them (FR-016).

Root designations restored from files go through the existing designation flow
(`sync.matchBookForAdopt` → adopt-or-create, collision-resolved naming); restored books
stay inactive (spec 003 FR-017).

**Alternatives considered**: applying item by item with individual store updates
(hundreds of settings saves and native pushes for one Sync; partial workspace state if
interrupted).

## R11. Import of a folder into a chosen workspace folder (one-off, FR-008/FR-009)

**Decision**: Read-only scan + parse + map into new nodes under the target folder with
fresh ids (an optional `wi_id` is used only if it is not already taken). Image files are
uploaded to the app image storage (R6) as part of the import; an upload failure keeps the
image as a `data:` URI and adds a warning. Invalid values are imported as-is into the native field and surfaced by the
existing `core/tree/validation.ts` (publish-blocked with a visible reason), never
coerced; malformed YAML → entry imported with the whole file as content and a per-file
warning. Text decoding: UTF-8 with BOM stripping (`TextDecoder('utf-8', { fatal: true })`);
decode failure → file skipped and reported as unreadable.

## R12. Performance (SC-006)

**Decision**: Directory walk and file reads run sequentially with a yield to the event
loop (`await` a resolved timer) every 25 files and a progress callback driving the
report modal; hashing and parsing are per file. 300 files × a few KB is well within
budget without workers.

**Alternatives considered**: Web Worker (handles are transferable, but it adds a second
bundle entry for no measured need — revisit in Phase 4).

## R13. Testing strategy

**Decision**:

- Unit (Vitest, pure): convention serializer/parser round-trips (every field, defaults
  omission, foreign keys, body blank-line rule, enum names/numbers), naming
  (sanitization, case-insensitive collisions, stability), reconcile decision table (every
  row of R7 incl. moves and interrupted moves).
- Integration: link manager + `MemoryDiskFolder` (in-memory `DiskFolder` port
  implementation) + real `WorkspaceStore` + a sync-engine stub recording hook calls —
  scripted two-sided sessions (SC-004), idempotence (SC-005), interruption injected at
  every write (FR-016).
- Contract: jsdom has no File System Access API, so the port guarantee suite
  (`tests/contract/disk-port.test.ts`) runs against `MemoryDiskFolder`; `FsaDiskFolder`
  is exercised live in Chromium through the OPFS substitution below (quickstart S1–S11).
- Live automation: Playwright cannot drive the native directory picker; the quickstart
  replaces `window.showDirectoryPicker` with `() => navigator.storage.getDirectory()`
  through `page.addInitScript` (OPFS handle implements the same interface) — no test hooks
  in the shipped bundle. The Obsidian check (SC-003) is manual on a real folder.

## R14. Decisions made during owner validation (2026-09-15)

- **Import shape**: the picked folder is imported as ONE folder. Browser pickers select a
  single folder, so a selection dialog offers the whole folder or any of its top-level
  folders/files (each chosen folder becomes its own workspace folder). A "contents into the
  target" variant was tried and dropped as too situational. Single notes/images use
  `showOpenFilePicker` ("Import files…").
- **Header overlays**: an element with `backdrop-filter` is the containing block of its
  absolute/fixed descendants; overlays therefore render via a React portal into
  `.wiw-surface`.
- **Typing cost**: profiling showed most per-keystroke CPU in the app's document-level
  jQuery delegated handlers; editing events are stopped at the workspace container (Escape
  still propagates). Link auto-push skips unchanged state and memoizes entry renders.
- **Choice highlighting** uses `--SmartThemeQuoteColor` (the WI badge accent);
  `--SmartThemeEmColor` is grey in several themes.
- **Image references**: content references resolve by id, name, path, Obsidian embed or
  direct URL (`core/tree/imageLinks.ts`), so sample data, hand-written notes and exported
  vaults render the same image.
