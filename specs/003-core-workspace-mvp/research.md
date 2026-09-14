# Research — Core Workspace MVP (003-core-workspace-mvp)

Builds on `specs/001-workspace-plugin-roadmap/research.md` (R1–R9) and
`specs/002-workspace-ui-prototype/research.md` (R1–R8). All app facts below were
re-verified this session against the vendored sources (`context/SillyTavern/public/`);
line references are given as `file:line`.

## R1. Verified app API surface — and the three gaps (resolves "what is actually callable")

**Findings** (st-context.js:114–307):

- Exposed and used by this phase: `loadWorldInfo`, `saveWorldInfo`, `updateWorldInfoList`,
  `getWorldInfoNames` (returns a **copy** of `world_names`), `extensionSettings`
  (= `extension_settings`), `saveSettingsDebounced` (1000 ms, script.js:469), `eventSource`,
  `eventTypes`, `callGenericPopup`/`Popup`/`POPUP_TYPE`/`POPUP_RESULT` (popup.js:9–36, 909),
  `substituteParams`/`substituteParamsExtended` (script.js:2922/2756), `uuidv4`, `macros`
  (new macro engine registry), `powerUserSettings` (note the key name — not `power_user`).
- **NOT exposed**: `createNewWorldInfo` (WI:4336), `deleteWorldInfo` (WI:4234),
  `selected_world_info` (module export, WI:66), `worldInfoCache`, `getFreeWorldName`
  (WI:4310), `newWorldInfoEntryTemplate`, `checkWorldInfo`, `toastr` (window global,
  index.html:8195).
- `saveWorldInfo(name, data, immediately=false)` (WI:4097): cache updated synchronously
  with the **caller's reference** (`cloneOnSet: false`, WI:882; doc comment WI:4084–4090
  demands callers never mutate afterwards); debounce 1000 ms (`debounce_timeout.relaxed`,
  constants.js:14); `immediately: true` posts at once (`_save` cancels pending debounce);
  emits `WORLDINFO_UPDATED(name, data)` (WI:4080) — the only emit site in the app.
- `loadWorldInfo(name)` (WI:2036): returns a **structured clone on every call**
  (`cloneOnGet: true`); `undefined` for falsy name, `null` on fetch failure/nonexistent
  book; cache holds `{ name?, entries, …extra keys }` verbatim.
- Server contract (`context/SillyTavern/src/endpoints/worldinfo.js:134–154`): `/edit`
  requires `data.entries` and writes the **entire** payload verbatim (pretty JSON,
  `sanitize(name).json`) — so extra keys (book-level `extensions`, character-book
  `originalData`) survive round-trips.
- Settings persistence: `saveSettings()` (script.js:7992–8056) posts the whole settings
  payload to `/api/settings/save` (no enforced size limit; retries ×3; emits
  `SETTINGS_UPDATED` on success). `extension_settings` rides inside it.
- Active books: runtime state is `selected_world_info` (WI:66), restored from
  `settings.world_info_settings.world_info.globalSelect` at load (WI:998); generation
  reads it directly (`getGlobalLore`, WI:4415–4427). The only runtime writer is the
  native `#world_info` control's change handler (WI:6057→5704–5719→`saveSettingsDebounced`
  + `WORLDINFO_SETTINGS_UPDATED`, WI:5722–5723).
- Events (events.js): `WORLDINFO_UPDATED(name, data)`; `GENERATION_STARTED(type, opts,
  dryRun)` (script.js:4240); `CHAT_CHANGED(chatId)`; `SETTINGS_LOADED`;
  `EXTENSION_SETTINGS_LOADED`; `SETTINGS_UPDATED`; `WORLDINFO_SETTINGS_UPDATED` (no args);
  `WORLDINFO_SETTINGS_UPDATED` is also emitted on book create (WI:6109). Note:
  `GENERATION_STARTED_AFTER_TRANSFORMS` does not exist in this vendored version.
- `displayIndex`: not in the entry template; native editor assigns `?? uid` at render
  (WI:2365), persists it on the entry object via its DnD handler (WI:2580–2600), and sorts
  "Manual" mode by it (WI:2170–2176) — so writing `displayIndex` on export round-trips.
- Entry `extensions` passthrough: not injected by the app but preserved verbatim (server
  writes whole payload); safe additive workspace marker location.
- `uid`: auto-assignment pool 0..999,999 (`getFreeWorldEntryUid`, WI:4283–4297).
- `eventSource.emit` awaits listeners sequentially and returns a Promise (lib/eventemitter.js:130–146);
  `on/makeFirst/makeLast/once/removeListener` available.

**Decision**: grow `src/global.d.ts` with exactly the used members above (typed, no `any`);
declare `toastr` as an ambient window global; fix `saveWorldInfo`'s return type to
`Promise<void>`. All app access flows through one `adapters/appApi.ts` accessor.

**Rationale**: constitution II/III; the verified surface is the contract.

**Alternatives considered**: direct imports from app modules — rejected (fragile for
bundles; forbidden by 002 R1 findings).

## R2. Persistence architecture for the workspace tree

**Decision**: all workspace state (tree with entry content, bindings, sync bookkeeping,
settings) lives under `extensionSettings['WorldInfoWorkspace']` per the roadmap data
model, saved via `saveSettingsDebounced()` after each mutation. Schema carries
`version: 1` with a migration function stub.

**Rationale**: single source of truth for the workspace-authoritative model; the app's
own debounced whole-settings save coalesces bursts (1000 ms); no server plugin needed.
Typical lore spaces (100–300 entries × few KB) are well within settings.json norms; the
native book push additionally mirrors entry content into real book files, so no data
exists in only one place for rooted content.

**Alternatives considered**:
- Per-book native files as the primary card store (tree = pointers only) — rejected:
  workspace-only entities and orphans would need a synthetic "scratch" book; sync
  semantics and FR-018/FR-021 flows get circular; roadmap already chose settings storage.
- `chatMetadata` per-chat storage — wrong scope (workspace is global, chat-independent).

**Caveats honored**: `saveSettingsDebounced` is the only settings saver exposed (no
immediate variant); flush points therefore cover books (see R5) and accept a ≤1 s
settings-loss window on hard crash (acceptable; documented in quickstart).

## R3. Book lifecycle: create / delete / rename (composing the missing APIs)

**Decision** — implemented inside `adapters/worldInfoAdapter.ts` (+ pure `core/sync/bookNaming.ts`):

- **Create**: resolve a free name (`bookNaming.resolveFreeName(base)`), then
  `saveWorldInfo(name, { entries: {} }, true)` + `updateWorldInfoList()`. This creates
  the real book file without the side effects of the native create flow (no editor
  dropdown selection, no interactive overwrite dialog — we resolve collisions ourselves).
- **Name resolution** (`bookNaming`): sanitize the proposed name via the app's own
  `POST /api/files/sanitize-filename` (same endpoint `getSanitizedFilename` uses,
  utils.js:1617); strip a trailing `" (N)"`; against `getWorldInfoNames()` (accent-
  insensitive compare, mirroring `checkOverwriteExistingData`) pick the first free
  `"Base (N)"`, N=1… — same pattern as native `getFreeWorldName` (WI:4311–4321).
- **Delete**: `POST /api/worldinfo/delete` (the same endpoint the app's own
  `deleteWorldInfo`, WI:4234–4280, uses), then `updateWorldInfoList()`. Caveats honored:
  the module cache cannot be evicted from outside → the adapter never calls
  `loadWorldInfo` for a name absent from the current `getWorldInfoNames()` list; if the
  deleted book was active, remove it from the active-list drive too; the native cleanup
  of character/persona lorebook references (`#character_world`, persona lorebook) is
  replicated as far as observable from the adapter (`#character_world` value check) and
  otherwise surfaced in the delete confirmation text.
- **Rename**: no rename API exists anywhere in the app; implemented as create-with-copy
  (`saveWorldInfo(newName, {…oldBook, name: newName}, true)` preserving unknown top-level
  keys) + delete-old. Failure mid-way leaves both books and a visible warning.
- **Root designation ON** (FR-013): propose folder name → resolve free name → create book
  immediately → store durable binding (root id ↔ book name) → do **not** activate.
- **Root designation OFF** (FR-022): release the binding only; the book file remains.

**Rationale**: the server endpoints and the naming pattern are the app's own documented
mechanisms; the composed behavior matches what the native editor does, minus the
interactive popups the workspace replaces.

**Alternatives considered**: interactive `createNewWorldInfo`-style flow via popups —
rejected: designation must be non-blocking and side-effect-free (no editor dropdown
selection, no overwrite-confirm on a name our own resolution already avoids).

## R4. Active-books list (FR-017) without an exposed write path

**Decision**: `adapters/activeBooksAdapter.ts` reads the activation state from the
native `#world_info` select (host-stable id, rendered under the hidden `#wi-holder`
native editor — present even while visually replaced, per 002 R1) and writes by setting
its values and triggering `change`, riding the host's own handler
(`onWorldInfoChange`, WI:6057–5723) which rebuilds `selected_world_info`, stamps
`globalSelect`, saves settings, and emits `WORLDINFO_SETTINGS_UPDATED`. The workspace
re-renders its ActiveBooksPanel from `getWorldInfoNames()` + the select state +
`WORLDINFO_SETTINGS_UPDATED` / `SETTINGS_UPDATED` events.

**Rationale**: the host handler is the only sanctioned writer of the runtime module
state that generation actually reads (`getGlobalLore`, WI:4415–4427); riding it keeps
persistence and event behavior at native parity with zero forks.

**Alternatives considered**: direct mutation of `settings.world_info_settings…globalSelect`
— rejected: does not update the runtime `selected_world_info` until reload;
host-function patching — forbidden (constitution II); asking upstream for a context
member — recorded as a future upstream-request note, not a Phase 1 dependency.

## R5. Sync engine (push) and orphan semantics

**Decision** (`core/sync/flatten.ts`, `divergence.ts`):

- Every entity carries a `SyncState` (see data-model): `uid` (its slot in its book),
  `status` (`new | in-sync | dirty | orphaned`), `lastExportedHash`, `lastExportedAt`,
  `nativeDrift`.
- **Flatten**: walk each bound root's subtree (nested roots traversed as ordinary
  folders → their entities also export into the parent book — world intersection by
  design). Entries export their stored native fields verbatim; images export as a
  derived native entry (R6). `uid` is kept stable per entity; colliding/missing uids are
  assigned from the book's free pool (client-side re-implementation of the 0..999999
  pool, WI:4283). `displayIndex` is assigned sequentially in workspace child order so
  the native editor's "Manual" sort matches the tree.
- **Payload**: load the current book, replace `entries` wholesale, **preserve unknown
  top-level keys** (e.g. character-book `originalData`), then `saveWorldInfo(bookName,
  payload, immediately?)`. Push is triggered debounced (1000 ms) by edits and flushed
  `immediately` on `GENERATION_STARTED` and panel close.
- **Deletion (FR-021)**: delete confirmation discloses native removal; the next flatten
  naturally omits the deleted entity, so the native copy disappears on the next push —
  no second prompt. No tombstones needed.
- **Orphans (FR-018)**: an entity moved out from under its root is excluded from the
  flatten scope but **retained in the book** until the user resolves it (remove-from-book
  clears the retained slot; restore re-includes it). Push guards prevent silent drops.
- **Self-save discrimination**: `WORLDINFO_UPDATED` passes the same object reference we
  just saved (cache `cloneOnSet:false`) → the listener ignores events whose `data`
  reference matches the adapter's last outbound payload; other saves (native editor is
  replaced, but character-book flows/other tools) count as external.
- **Push guard (divergence, both directions per FR-015)**: before overwriting a book,
  each native entry's fingerprint is compared to the card's `lastExportedHash`; a
  mismatch (native drifted or foreign entries present) blocks the automatic push and
  raises a per-book divergence banner with resolution (adopt native via import-merge /
  push anyway / per-entry merge). No silent clobber in either direction.

**Rationale**: workspace-authoritative semantics with "never silent" disclosures on every
irreversible path, exactly as clarified on 2026-09-08.

**Alternatives considered**: tombstone lists for deletions — rejected: flatten-from-tree
already encodes removal; orphan retention list is the only bookkeeping needed for the
ambiguous case (moves).

## R6. Fingerprint (divergence basis)

**Decision**: stable canonical serialization (deterministic key-sorted stringify of the
native entry) hashed with FNV-1a (32-bit) in pure code — no async crypto. `uid` included;
no fields excluded (workspace always exports the full entry).

**Rationale**: cheap, deterministic, dependency-free; used only for warning decisions
(not security), so 32-bit collision risk is acceptable and disclosed.

**Alternatives considered**: `crypto.subtle` SHA-256 — async, overkill; JSON compare of
full objects — O(n) memory per comparison, no benefit.

## R7. Image entity encoding (resolves the spec's "fixed during planning" item)

**Decision**: an image entity exports as a native entry with `comment = name`,
`content = "![caption](src)"` (caption text as alt), all other fields at native template
defaults, plus an additive marker `extensions: { wiw: { v: 1, kind: 'image', src,
caption } }`. Import restores an `ImageNode` when the marker is present; native entries
that merely contain image markdown (no marker) import as ordinary text entries — no
guessing. The marker rides the entry `extensions` passthrough, which the server
preserves verbatim (R1).

**Rationale**: preserves the approved prototype UX (image nodes with preview/caption)
while native consumers see a working entry whose content embeds the image, exactly like
any hand-made image-bearing entry; round-trip is lossless.

**Alternatives considered**: guessing "image-ness" from content on import — rejected
(ambiguity, false positives); separate image storage outside books — rejected (breaks
the merged-entity export model approved in Phase 0).

## R8. Editor UX patterns (focus, validation, preview, touch)

**Decision**:

- **Focus/cursor safety (FR-008)**: editor fields keep local draft state and commit to
  the store on change; store updates never remount fields (stable per-field React keys;
  sync badges render outside inputs). Background saves/refreshes never rebuild the
  edited subtree's component identity. Pattern recorded for tasks: store → `useSyncExternalStore`
  selectors, editor subscribes by node id.
- **Validation (FR-010)**: `core/tree/validation.ts` returns typed rule violations
  (probability 0–100, `depth ≥ 0`, `position 0–7` with `outletName` required at
  `position: outlet`, `role 0–2`, `selectiveLogic 0–3`, `triggers ⊆` generation types,
  timed effects ≥ 0/null, names non-empty) — the editor shows them inline and sync still
  excludes/surfaces invalid values rather than resetting them (publish blocked for
  invalid entities with a visible reason).
- **Preview placeholders (FR-010)**: live markdown preview resolves app-wide
  placeholders via `substituteParams` (context-exposed; script.js:2922).
- **Touch move/reorder (FR-004)**: HTML5 DnD remains the pointer path; the guaranteed
  touch path is the item menu — long-press opens it — with "Move to…"(folder picker),
  "Move up", "Move down" (works in custom sort). No DnD library.
- **Sort/filter/search (FR-005)**: view-level, over all folder children (folders first),
  per the approved prototype toolbar; custom order is the real persisted order.

**Rationale**: all three deferred Phase 0 items get the simplest robust mechanism; no
new dependencies.

**Alternatives considered**: long-press-drag emulation for touch DnD — rejected for
Phase 1 (fragility across browsers); deferred as a later enhancement; DnD library —
rejected (app has none; bundle discipline).

## R9. Demo data and empty state (FR-001)

**Decision**: first run renders an empty-state panel with guidance and an explicit
"Load demo data" action. The action seeds the real workspace store with an 'Aldermeer'
tree (from `src/core/demo/dataset.ts`, refactored from the Phase 0 sample modules into
production shapes) **without** any WI root designations — the user opts into sync by
toggling a root themselves. Demo content is ordinary deletable workspace data.

**Rationale**: honest demo (no surprise native book files), zero special-case code
paths beyond the seed function.

**Alternatives considered**: ephemeral demo mode (non-persisted) — rejected: doubles UI
paths for no value; seeding with designated roots — rejected: silently creates native
books (contradicts FR-013's deliberate-activation model).

## R10. Testing strategy (constitution V/VI)

**Decision**:

- **Unit (Vitest, red→green)**: schema/migrations; tree operations (incl. cycle checks,
  bulk ops); browse (sort/filter/search); validation rules; flatten (uid allocation,
  displayIndex, nested roots, orphans retained); image conversion; fingerprint;
  divergence; import mapping; bookNaming ("Name (N)" + sanitize handling); demo seed.
- **Contract tests**: adapter usage pinned against the verified surface (R1) — payload
  shapes for `saveWorldInfo` (entries-keyed object, `entries` key present), clone
  discipline (no post-save mutation — tested by freeze), event names/payloads used,
  endpoint request shapes for the composed create/delete, `#world_info` drive semantics.
- **Manual quickstart**: scenario script mapping every SC in the spec (see quickstart.md).

**Rationale**: matches the constitution's gates and the 3DDiceRolls testing pattern.

## Open items

None — all spec-level questions were resolved in the 2026-09-08 clarification session;
all technical unknowns are resolved above. Deferred by design to later phases:
assistant (Phase 2), markdown conversion (Phase 3), interop events + scale hardening
(Phase 4), upstream request to expose `createNewWorldInfo`/`deleteWorldInfo`/
`selected_world_info` via `getContext()` (nice-to-have; would retire the R3/R4 adapters).