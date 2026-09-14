# Contract: Native World Info Usage (workspace ↔ app boundary)

How the extension interacts with the app's World Info systems in Phase 1. Everything
here was verified against the vendored sources (`context/SillyTavern/public/`) — see
research.md R1 for line references. Contract tests pin this file; any change to these
calls/payloads MUST update the contract tests in the same change (constitution VI/VII).

## Context members used (via `globalThis.SillyTavern.getContext()`)

| Member | Signature (as typed in `src/global.d.ts`) | Usage |
|--------|-------------------------------------------|-------|
| `loadWorldInfo(name)` | `Promise<WorldInfoBook \| null \| undefined>` | Import/divergence reads; returns a fresh clone each call; `null` = fetch failure/missing, `undefined` = empty name |
| `saveWorldInfo(name, data, immediately?)` | `Promise<void>` | Book create (`{ entries: {} }`, immediate), pushes (debounced/immediate); cache stores the caller's reference |
| `getWorldInfoNames()` | `string[]` (copy) | Book list, name-collision resolution |
| `updateWorldInfoList()` | `Promise<void>` | Refresh `world_names` after create/delete/import |
| `extensionSettings` | `Record<string, unknown>` | `['WorldInfoWorkspace']` namespace |
| `saveSettingsDebounced()` | `void` | After every workspace mutation |
| `eventSource.on / makeFirst / makeLast` | host EventEmitter | Event wiring below |
| `eventTypes` | includes `WORLDINFO_UPDATED`, `WORLDINFO_SETTINGS_UPDATED`, `GENERATION_STARTED`, `SETTINGS_LOADED`, `SETTINGS_UPDATED`, `EXTENSION_SETTINGS_LOADED`, `CHAT_CHANGED` | see events |
| `callGenericPopup(content, type, opts?)` / `POPUP_TYPE` / `POPUP_RESULT` | confirmations (delete/bulk/orphan/import resolutions) | |
| `substituteParams(content)` | `string` | Preview placeholder resolution |
| `getRequestHeaders()` | `Record<string, string>` | Headers (incl. CSRF token) for the composed endpoint calls below |
| `uuidv4()` | `string` | Node ids |
| `characters` / `tags` / `characterId` | data snapshots copied into each context object | Character-filter options; read through a FRESH `getContext()` (`getLiveAppContext`), never the memoized one |

### Entry fields with a native shape (amended 2026-09-14)

- `triggers`: `string[]` ⊆ `GENERATION_TYPE_TRIGGERS` (`normal, continue, impersonate,
  swipe, regenerate, quiet`); empty = all types. Edited as a multi-select.
- `characterFilter`: `{ isExclude: boolean, names: string[], tags: string[] }` — the
  ONLY shape the app reads. `names` = character avatar file names without extension
  (native `getCharaFilename`), `tags` = tag ids. Edited as ONE multi-select over
  characters + tags plus an Exclude toggle (native `select[name="characterFilter"]`).
  Legacy flat keys (`characterFilterNames/Tags/Exclude`) from early builds are moved
  into the object on load and removed; sync hashes that described the legacy entry
  are carried over so the repair never reads as drift.

## Events

| Event | Direction | Payload | Workspace behavior |
|-------|-----------|---------|--------------------|
| `GENERATION_STARTED` | subscribe | `(type, opts, dryRun)` | Flush pending book pushes (`immediately`) before generation |
| `WORLDINFO_UPDATED` | subscribe | `(name, data)` | Ignore self-saves (same `data` reference as the adapter's last outbound payload); otherwise run divergence detection for the bound book |
| `WORLDINFO_SETTINGS_UPDATED` | subscribe | none | Re-render the active-books panel (external activation changes) |
| `SETTINGS_UPDATED` | subscribe | none | Refresh book list snapshot |
| `SETTINGS_LOADED` / `EXTENSION_SETTINGS_LOADED` | subscribe | none | Load/migrate workspace state at startup |
| `CHAT_CHANGED` | subscribe (book lists only) | — | Refresh character/chat book markers; the workspace tree itself stays chat-independent |
| `wi-workspace:*` | none this phase | — | Interop events are Phase 4 (spec out-of-scope) |

## Book create / delete / rename (composed — context lacks these APIs)

- **Create**: `resolveFreeName(base)` → `saveWorldInfo(name, { entries: {} }, true)` →
  `updateWorldInfoList()`.
- **Name resolution** (`core/sync/bookNaming`): sanitize the proposal via
  `POST /api/files/sanitize-filename` `{ fileName }` → JSON `{ fileName: <sanitized> }`
  (app contract: utils.js `getSanitizedFilename`, src/endpoints/files.js);
  strip trailing `" (N)"`; pick the first free `"Base (N)"` (N=1…) comparing
  accent-insensitively against `getWorldInfoNames()` — mirrors the app's own
  `getFreeWorldName` (WI:4311) and `checkOverwriteExistingData` comparison.
- **Delete**: `POST /api/worldinfo/delete` `{ name }` with `getRequestHeaders()` (the
  exact endpoint the app's `deleteWorldInfo` calls) → `updateWorldInfoList()`; if the
  book was active, remove it from the active-list drive; if `#character_world` (native
  editor select) references it, clear that select and note it in the confirmation.
- **Lorebooks panel** (amended 2026-09-14): one surface lists every native book with
  activation, import/update and delete. Deleting an UNBOUND book deletes the file;
  deleting a book BOUND to a workspace folder deletes the file AND the folder with its
  subtree after one confirmation (same path as tree deletion with the root's book set
  to delete: tombstones for copies in parent books, then the folder). New imports land
  in the folder next to the tree selection.
- **Rename**: create-with-copy (`saveWorldInfo(newName, {…old, name: newName}, true)`,
  preserving unknown top-level keys) → rebind → delete old. Never rename in place.

## Active-books drive (FR-017 — context lacks `selected_world_info`)

- Options are `new Option(name, index)` (amended 2026-09-14): the VALUE is an index
  into `world_names`, the book NAME is the option text. Matching by value never matches
  a name.
- Read: the TEXT of the selected options of `#world_info` (host-stable id; the native
  editor DOM persists under the hidden `#wi-holder`).
- Write: select the options whose text is in the desired name list and trigger `change` — the
  host handler (`onWorldInfoChange`) rebuilds `selected_world_info`, persists
  `world_info.globalSelect`, and emits `WORLDINFO_SETTINGS_UPDATED`. The adapter MUST
  re-read state after the host handler runs (single source of truth stays native).
- Character/chat markers: the current character's primary book is
  `characters[characterId].data.extensions.world`; the chat book is the string
  `chatMetadata.world_info`. Both are snapshots — read from a fresh context. Additional
  character books (`world_info.charLore`) are not exposed by the context (not shown).
- Isolation: all of this lives in `adapters/activeBooksAdapter.ts` (constitution II
  last-resort DOM composition, Complexity Tracking row 2 in plan.md).

## Save discipline (invariants the workspace MUST honor)

1. **Clone handoff**: the object passed to `saveWorldInfo` is never mutated afterwards
   (cache stores the caller's reference — WI doc comment 4084–4090). The adapter always
   hands over a fresh structured clone.
2. **Payload shape**: `{ entries: { "<uid>": entry } }` — the `entries` key is required
   by the server (`/api/worldinfo/edit` rejects otherwise); uids are stringified keys;
   the workspace preserves unknown top-level book keys (e.g. `originalData`).
3. **Never load deleted names**: `loadWorldInfo` may return stale cache after an
   adapter-level delete (the module cache cannot be evicted externally); therefore
   loads are gated on the current `getWorldInfoNames()` list.
4. **uid pool**: 0..999,999 per book (mirrors `getFreeWorldEntryUid`, WI:4283); the
   workspace assigns from free slots and keeps uids stable per entity.
5. **displayIndex**: written on export (sequential, workspace order) — the native
   editor sorts "Manual" by it and round-trips the field.
6. **extensions passthrough**: additive workspace marker only on image-derived entries
   (`extensions.wiw`, research R7); never stripped, never read as authoritative.
7. **Flush points**: pending pushes flush with `immediately: true` on
   `GENERATION_STARTED` and panel close; ordinary edits use the 1000 ms debounce.
8. **Self-save discrimination**: `WORLDINFO_UPDATED` with `data === lastOutbound(name)`
   is ignored — the adapter tracks the outbound payload reference PER BOOK NAME (the
   cache stores the caller's reference uncloned; a single global slot would
   misclassify the earlier of two consecutive saves as external).
   **Failed saves** (amended 2026-09-14, S10): the app's `_save` caches the payload
   BEFORE its fetch, and a network failure rejects without `WORLDINFO_UPDATED`. The
   adapter records a fingerprint of the unsent payload; a later push whose loaded book
   matches it treats the book as the workspace's own write (no merge, no conflict).
   Every successful save emits a `success` save event, which clears that book's failure
   banner; Retry reports the outcome (toast on success, banner stays on failure). An
   HTTP error status is NOT detectable: the app's `_save` ignores the response.
9. **Validation-blocked pushes never write** (FR-010 publish-block): when flatten skips
   invalid entities, the push aborts entirely — the book is never partially emptied.
   Divergence force ("push anyway") bypasses only the divergence guard, never the
   validation block; the banner lists the entities to fix in the editor.
10. **Import normalization**: book entries missing native fields (books authored by
    other tools) are filled additively from the native template defaults on import —
    mirroring the app's `addMissingWorldInfoFields` — so native data never trips
    validation on fields the app itself does not constrain. Persisted entries are
    normalized again on load (schema migrate), healing data written before the rule
    existed.
12. **Import plan identity** (refined 2026-09-08): entities match native entries by
    uid, falling back to fingerprint match for entries whose uid was never recorded
    (legacy data self-heals on the next import: same-content entries refresh in place,
    never duplicate). Plan outputs: conflicts (both changed), refreshes (native won,
    workspace clean), additions (native-only). Application applies refreshes and
    additions immediately; conflicts only via the user's per-entry resolutions.
13. **Silent two-way sync** (owner decision 2026-09-08): on `WORLDINFO_UPDATED` the
    engine builds the import plan for the bound book and applies it automatically when
    it contains NO conflicts (refreshes + additions mirror the native change; the
    push then proceeds). A push that encounters clean-side divergence runs the same
    plan before writing. Banners are reserved for genuine conflicts (both sides
    edited) and validation blocks; they can be dismissed (reports are advisory state
    only — dismissal changes nothing on disk).
14. **File import** (native parity): JSON/.lorebook files upload via
    `POST /api/worldinfo/import` (FormData `avatar`, headers without content-type);
    the response `{ name }` is imported into the workspace as a designated root in
    the folder nearest to the current selection; an existing same-named book requires
    explicit overwrite confirmation (the server replaces the file silently). The
    entry point is a toolbar icon next to folder/entry/image creation.
15. **Deletion intent (tombstones)**: deleting an exported entity records its uid in
    the root binding's `tombstones` BEFORE the next push; auto-merge never resurrects
    tombstoned uids (they are excluded from additions), and a fulfilled push clears
    them. Books are normalized on READ (additive field fill) so plan fingerprints are
    stable — a raw book with missing fields must never re-trigger refresh/merge
    loops. Bound books NEVER flow through the unbound-import path (the import dialog
    refuses them); the plan's `deletions` mirror native deletions of clean entities
    (dirty copies survive and re-create on push, workspace-authoritative).
11. **uid is the import identity**: `mapBookToNodes` preserves the native uid into
    `sync.uid` for BOTH entry and image nodes; bound re-import matches entities by
    it (dirty+drifted → conflict; clean+drifted → silent refresh; absent → addition).
    An import that produces a node with `sync.uid = null` under a bound root is a
    contract violation (it would duplicate the native entry on the next push).

## Images and folders are workspace-only (owner decision 2026-09-08)

Images and folders never export to native books and never participate in the import
plan: `flattenRoot` walks entries only, `entitiesOfRoot` returns entries only, and the
import maps book entries to entry nodes exclusively. The former `extensions.wiw`
image-marker encoding is RETIRED (books authored by earlier builds keep the marker in
`extensions` — it is inert passthrough). An entity's sync info is PER BOOK
(`sync.books[bookName] = { uid, hash, status }`) because nested WI roots put the same
entry into several books with independent uid pools.

## Not used in Phase 1 (recorded to prevent scope creep)

`getWorldInfoPrompt`, `convertCharacterBook`, `reloadWorldInfoEditor`, macros registry,
slash commands, `wi-workspace:*` interop events (Phase 4), per-root scan overrides
beyond the native book format.