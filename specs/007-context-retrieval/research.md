# Research: Context & Retrieval (Phase 6)

Reference study of 2026-10-06. Clones live in `context/` (git-ignored, read-only, never
bundled). Planning adds its own decisions (R-numbered) below this section.

## Reference extensions

| Extension | Version | Licence | Use |
|---|---|---|---|
| DeepLore (pixelnull/sillytavern-DeepLore) | 2.6.2 | MIT | Ideas; optional source via its public global |
| Memory Books (aikohanasaki/SillyTavern-MemoryBooks) | 9.3.4 | AGPL-3.0-only | Data format and public commands only — no code |
| Doom's Enhancement Suite (DangerDaza/Dooms-Enhancement-Suite) | 2.6.0 | AGPL-3.0-or-later | Data format only — no code |
| DoomLore-Mesh (Ryah/DoomLore-Mesh) | 1.0.0 | none (all rights reserved) | Not used |

### DeepLore

- Lore lives in an Obsidian vault (Local REST API plugin); native WI books are only a
  one-off import source. Index cached in IndexedDB; per-chat state in
  `chat_metadata.deeplore_*`.
- Hook: manifest `generate_interceptor`; injection via `setExtensionPrompt` grouped by
  position/depth/role (default in-chat depth 4).
- Selection, two stage: constants + keywords over the last N messages + cascade links +
  recursion + BM25 fuzzy supplement (top 20, score ≥ 0.5 over title, keys, content) →
  optional category pre-filter above ~40 candidates → LLM picks from a manifest of
  `<entry name>` lines (title, token cost, links, summary or first 600 chars) returning
  `[{title, confidence, reason}]`, filtered by a confidence threshold.
- Sliding-window cache: reuse the AI pick unless new chat lines mention a vault entity.
- Budget: max entries + max tokens; the last entry is truncated at a sentence boundary
  when ≥ 50 tokens remain. Entries wrapped as `<title>…</title>`. Prompt-injection guard
  text treats lore as data.
- Explainability: per-entry match reason, `/dle-why`, `/dle-simulate`, injection tab.
- Public API: `globalThis.deepLoreEnhanced_matchText(textOrChat) → {text, count,
  tokens}` (keyword/BM25/recursion stage only, pre-formatted).

### Memory Books

- Memories are ordinary entries of native books (the chat-bound lorebook, or a manual
  one). Markers: `stmemorybooks: true` (the only "is a memory" test), `STMB_start`,
  `STMB_end`, `STMB_chatId`, `stmbSummary`, `stmbSummaryTier`, legacy `stmbArc`,
  `STMB_sp_*` / `STMB_tracker_*`, `STMB_canonical*`, `STMB_inclusionGroup`,
  `STMB_memoryRole`, `STMB_narrator*Ids`, `STMB_consolidationCommitId`.
- Identification by title: numbered `[NNN] - title` (numbering and sort), side prompts
  `(STMB SidePrompt)` / `(STMB Tracker|Scoreboard|Plotpoints)`, clips ` [STMB Clip]`.
  It sets `displayIndex` to the memory number and `order` by its mode.
- Listens to `WORLDINFO_UPDATED`. Requests via `ConnectionManagerRequestService`
  (Chat Completion only). Prompt framing "PREVIOUS SCENE CONTEXT (DO NOT PROCESS)";
  JSON `{title, content, keywords}` with schema + fallback parsing.
- Public surface: slash commands (`/creatememory`, `/scenememory`, `/nextmemory`,
  `/stmb-catchup`, `/sideprompt*`, `/stmb-highest`, `/stmb-set-highest`, `/stmb-stop`),
  macros `{{memtier0..6}}`, `{{memclips}}`, `{{memside}}`.

### Doom's Enhancement Suite

- RPG/immersion suite; lore-relevant parts: tracker (scene, quests, present characters,
  JSON written by the model) re-injected via `setExtensionPrompt`; Lore Library
  ("campaigns" = sets of whole books); auto-link (book named like a present character
  is activated); "Inject into Scene".
- No entry-level retrieval: book activation by editing `selected_world_info` + one
  `updateWorldInfoList()` and a `#world_info` change per batch; ownership ledgers so it
  never deactivates books the user enabled.
- Data: `chat_metadata.dooms_tracker.{committedTrackerData, lastGeneratedData,
  knownCharacters}`; per-swipe copies in `message.extra.dooms_tracker_swipes`.
- `window.DES_INSPECTOR` logs every `setExtensionPrompt` write (context inspector idea).

### DoomLore-Mesh

- Glue only: copies DES present characters into DeepLore's per-chat context and exports
  Memory Books entries to Obsidian, importing other extensions' internal modules by
  hard-coded path. No licence file. Not used.

## Our baseline facts

- Sync preserves unknown native entry keys and `uid` (the native entry is cloned as a
  whole, `src/core/sync/flatten.ts`), and sets `comment` from the node name and
  `displayIndex` from tree order on every push.
- Native forced activation: `WORLDINFO_FORCE_ACTIVATE` with `[{world, uid}]` fills
  `WorldInfoBuffer.externalActivations` (`context/SillyTavern/public/scripts/
  world-info.js:1020`); only entries of loaded (active) books are scanned
  (`world-info.js:4774`); external activations are reset per scan.
- Generation interceptors (`manifest.generate_interceptor`) run at
  `public/script.js:4505`, before `getWorldInfoPrompt` at `script.js:4576`.

## Native facts gathered for planning (vendored app, `context/SillyTavern/public/`)

- **Interceptor**: `runGenerationInterceptors` (`scripts/extensions.js:2015`) awaits
  `globalThis[manifest.generate_interceptor](chat, contextSize, abort, type)` per
  manifest; thrown errors are logged and skipped. Only `Generate()` calls it, and never on
  dry runs (`script.js:4503-4514`). `type`: `'normal'`, `'continue'`, `'swipe'`,
  `'regenerate'`, `'impersonate'`, `'quiet'` (`generateQuietPrompt` → `Generate('quiet')`,
  so interceptors DO run for quiet prompts); `generateRaw` never reaches it.
- **Forced activation**: the handler stores the PASSED object
  (`world-info.js:1020-1030`), and the scan inserts that object, not the book copy
  (`:4774-4777`) — an object with only `{world, uid}` has no `position` and is silently
  not inserted (`:5141`). Pre-activation checks still run on the book copy: `disable`,
  generation-type triggers, character filter, delay, cooldown, recursion flags,
  `@@dont_activate`. After activation: sorted first, inclusion groups, probability
  (re-rolled per recursion loop for forced entries), budget unless `ignoreBudget`, final
  `order`. The map is reset at the end of every `checkWorldInfo` (`:5156`, dry runs too),
  EXCEPT on the early return when no entries are loaded (`:4637`); an aborted generation
  after the emit leaves it for the next scan.
- **Events**: `WORLD_INFO_ACTIVATED(entries[])` after budget/probability, not on dry runs
  or empty; `WORLDINFO_SCAN_DONE` per loop; `WORLDINFO_ENTRIES_LOADED({globalLore,
  characterLore, chatLore, personaLore})` from `getSortedEntries` on every scan and on the
  `CHAT_CHANGED` pre-cache — the app's own resolution of the active books, including the
  character's extra books that the context does not expose.
- **Messages**: per-reply data belongs in `message.extra`; swipes keep
  `swipe_info[i].extra` (copied on swipe change). `MESSAGE_RECEIVED(id, type)` then
  `CHARACTER_MESSAGE_RENDERED(id, type)` per model reply; `MESSAGE_SWIPED(id)`,
  `CHAT_CHANGED(chatId)`, `GENERATION_STARTED(type, opts, dryRun)`, `GENERATION_STOPPED`.
  Message buttons: third-party extensions append to `#message_template .mes_buttons
  .extraMesButtons` and handle clicks by delegation (`.closest('.mes').attr('mesid')`).
- **Context surface**: `loadWorldInfo`, `getWorldInfoPrompt`, `getWorldInfoNames`,
  `getTokenCountAsync`, `chatMetadata` (snapshot — read fresh), `saveMetadataDebounced`,
  `executeSlashCommandsWithOptions`, `SlashCommandParser.commands[name]`.
- **Character book conversion**: exporting a book into a character card spreads
  `entry.extensions` (`src/endpoints/characters.js:682`) and importing keeps it
  (`world-info.js` `convertCharacterBook`, `extensions: entry.extensions ?? {}`); unknown
  TOP-LEVEL entry keys are lost in that round trip.

## Decisions

### R1 — Summary lives in `extensions.wiw_summary` of the native entry

- **Decision**: the summary is a string at `native.extensions.wiw_summary`. The workspace
  node already carries the native entry verbatim (`node.native`), so the persistence
  shape does not change; the key is documented in the persistence and markdown contracts.
  Empty summary = key absent. Soft limit 300 characters (flagged, never blocked).
- **Rationale**: the native editor and saves preserve `extensions`; it also survives
  embedding a book into a character card, unlike a top-level key (Memory Books' top-level
  keys do not). Fingerprints include it, so a summary edit pushes like any field edit.
- **Alternatives**: top-level `wiwSummary` (lost via character cards); workspace-only
  (rejected by the owner, clarification 2026-10-06).

### R2 — Markdown key `wi_summary`

- **Decision**: export hoists `extensions.wiw_summary` into front-matter `wi_summary`
  and leaves it out of `wi_extensions` (which is then omitted when empty); import puts
  `wi_summary` back; if both carry a value, `wi_summary` wins and the conflict is
  reported. Convention version note added; files without the key are unchanged.
- **Rationale**: a readable, hand-editable key for Obsidian users; no duplication.

### R3 — Context items and preview

- **Decision**: `buildRequest` (pure) additionally returns `items: ContextItem[]`
  (kind, node, reason, detail, estimated tokens, state included/truncated/omitted). The
  preview calls the same builder without sending; the sent message keeps the items in its
  `ContextSnapshot` (IndexedDB, with the request). Costs use the existing estimate
  (~3.5 chars/token) and are shown as "≈", because the budget itself is character-based.
- **Alternatives**: app tokenizer counts (async, provider-specific, would disagree with
  the budget that actually decided inclusion).

### R4 — Catalog selection inside one reply (protocol v2)

- **Decision**: in catalog mode the workspace block lists a catalog section (handle,
  folder path, name, summary or 160-char excerpt, ≈tokens). New operations
  `<op type="read" ids="e3,e7"></op>` (full text of entries) and
  `<op type="open" ids="f2"></op>` (catalog of a folder's entries). When a finished reply
  contains read/open blocks, the controller fulfils them and sends a follow-up request
  (same messages + the reply so far + a user turn with a `<workspace-read>` block); the
  continuation is appended to the SAME reply (the existing Continue mechanism, no
  prefill). Max 3 rounds per reply; visible ("Reading 3 entries…") and stoppable.
  Edits are only valid for entries whose full text the model has received in this reply
  chain (others → validation "read the entry first").
- **Auto** (default): catalog mode is used when the entries the existing mode would send
  in full do not fit the item budget. Folder narrowing: when the entry catalog itself
  does not fit, the catalog lists folders (path, entry count, first entry names) plus the
  entries ranked highest locally (R5) until the budget is used; `open` expands a folder.
- **Rationale**: one request when the catalog suffices; no provider tool-calling needed
  (free models vary), same tolerant text protocol as v1.

### R5 — Local fuzzy matching (BM25)

- **Decision**: a pure BM25 index over entry name, keys, summary and content, with
  Unicode word tokenization, lower-casing and a light prefix stem (tokens ≥ 5 chars
  compared on their first 5); built lazily per request from the store snapshot and
  memoized by entry fingerprint. Fuzzy additions: off by default, cap 5, minimum
  normalized score 0.5, ranked after selected/key-triggered entries. The same ranking
  orders catalogs and chooses which entries a narrowed catalog lists.
- **Alternatives**: embeddings (need a provider/vector store — out of scope).

### R6 — Context sets

- **Decision**: `settings.assistant.contextSets: ContextSet[]` (`{ id, name, context }`,
  context = the full per-conversation context settings incl. new fields). Applying copies
  the values into the conversation and records `contextSetName`; later edits of the set do
  not change past requests. Missing folders are dropped with a notice. Not saved while a
  recovery is pending (same rule as other assistant settings).

### R7 — Sentence-boundary truncation

- **Decision**: when the next entry does not fit and at least max(50 tokens, 25 % of the
  entry) fits, cut at the last sentence end (`.`, `!`, `?`, `…`, `。！？`, or a blank line)
  inside the room, append "[…]", mark `truncated` with the kept share.

### R8 — Interop detection and Memory Books protection

- **Decision**: Memory Books badges and protection are DATA-driven (`stmemorybooks ===
  true`, `stmbSummaryTier`, title suffixes), so they work even when the extension is
  disabled; its command buttons appear only when `SlashCommandParser.commands` has the
  command. Doom's suite: `chatMetadata.dooms_tracker` with present characters
  (`committedTrackerData` / `lastGeneratedData` → `characterThoughts` entries not marked
  `present === false`, location when present). DeepLore: `typeof
  globalThis.deepLoreEnhanced_matchText === 'function'`. Any shape mismatch → source
  reported unavailable, no error.
- **Memory Books order (clarification 2026-10-06)**: `flatten` keeps the stored native
  `displayIndex` and `order` of entries with `stmemorybooks === true` instead of the
  tree position. A rename that removes a leading `[NNN]` prefix asks for confirmation.

### R9 — Main-chat picking pipeline

- **Interceptor**: manifest `generate_interceptor: "wiwPickInterceptor"`; returns
  immediately unless picking is on for the chat, `type` is `normal`, `swipe`,
  `regenerate` or `continue`, and at least one active entry exists. `continue` reuses the
  pick stored on the message being continued.
- **Active entries**: the latest `WORLDINFO_ENTRIES_LOADED` payload (the app's own
  resolution), invalidated on `CHAT_CHANGED`, `WORLDINFO_SETTINGS_UPDATED`,
  `WORLDINFO_UPDATED` and character changes; when invalid, refreshed with a dry
  `getWorldInfoPrompt` call (dry runs emit the event and do not set timed effects).
- **Forcing**: one `WORLDINFO_FORCE_ACTIVATE` emit, as late as possible in the
  interceptor, with full clones of the book entries plus `world` and `decorators: []`;
  entries whose content starts with `@@` decorator lines are passed with those lines
  stripped. Never emitted when the pick is empty or no entries are loaded (avoids the
  early-return leak). Disabled entries and entries under an excluded folder are not in the
  catalog. Accepted risk: an abort by another interceptor after our emit leaves the
  activations for the next scan (documented).
- **Prepared vs fresh (clarification 2026-10-06)**: after each model reply
  (`CHARACTER_MESSAGE_RENDERED`, type not quiet/impersonate) a pick for the next turn is
  prepared in the background from the last N messages; cancelled on chat change or a newer
  preparation. At generation time, the new text since the prepared pick is matched against
  names and keys of active entries (`core/assistant/triggers.ts` matching); if every hit
  is already picked → prepared pick used, no wait; otherwise a fresh pick runs with the
  timeout (default 20 s, range 5–120). On timeout/failure: the prepared pick (if any) is
  still forced and the notice says the fresh pick failed; without one, only normal
  keyword activation runs.
- **Pick format**: lines `<pick id="e12">reason</pick>`; tolerant parse; unknown ids
  counted as ignored. Catalog for picking = same builder as R4 with the R5 ranking against
  the recent chat; folders listed as groups (FR-025).
- **Outcome**: after the scan, `WORLD_INFO_ACTIVATED` tells which forced entries made it;
  missing ones are recorded "picked but not inserted (budget, probability or group)".

### R10 — Per-reply indicator

- **Decision**: the pick result is attached to `chat[id].extra.wiw_pick` and the current
  `swipe_info[swipe_id].extra` on `MESSAGE_RECEIVED`; saved with the chat. An icon is
  added to `#message_template .mes_buttons .extraMesButtons` and shown only on messages
  carrying `wiw_pick` (class toggled on render, swipe and chat load); a delegated click
  opens an app popup with the details.

### R11 — Settings placement

- Global: `settings.picking = { defaultEnabled: false, profileId: null (→ assistant
  profile), timeoutSec: 20, chatMessages: 6, maxPicks: 8, catalogTokens: 4000 }`,
  repaired field by field. Per chat: `chatMetadata.WorldInfoWorkspace.picking = 'on' |
  'off'` (absent = global default). Folder exclusion: optional `pickExcluded: true` on
  folder nodes (workspace-only; resolved to entries through sync uids at pick time).

### R12 — Hooks

- `wi-workspace:pick-completed` `{ chatId, source: 'prepared' | 'fresh' | 'fallback' |
  'reused', picked: Array<{ book, uid }>, ignored: number, durationMs }` — identity only,
  emitted for every generation where picking ran. No event for context sets or previews
  (UI state, not data).

### R13 — Testing the summary round trip (owner requirement)

- A dedicated matrix (unit + FakeHost integration + markdown contract): editor edit →
  reload; push → native load; native edit of another field → pull; native edit of the
  summary → pull; markdown export → import; export → edit file → pull; character-card
  conversion helper round trip; assistant proposal accept → undo. Live: quickstart
  section S.

### R14 — Live check of the installed references (2026-10-07, `dev` account)

- Installed: DeepLore 2.6.2, Memory Books 9.3.4, Doom's Enhancement Suite 2.6.0,
  DoomLore-Mesh 1.0.0 — all load with 0 console errors next to the workspace, which opens
  normally.
- **Detection must be lazy**: Memory Books registers its slash commands ~10 s after it
  logs "Initializing" (its init awaits settings, chat observer and caches). Interop
  availability is therefore checked when a menu opens or a request is built, never once
  at our init.
- DeepLore without a configured vault: `deepLoreEnhanced_matchText` exists and returns
  `{ text: '', count: 0, tokens: 0 }` → the source is offered but reported "no matches",
  not an error. DeepLore's own interceptor (`loading_order` 1) runs before ours (10);
  both only add.
- Doom's suite before any tracker run: `chatMetadata.dooms_tracker` holds only
  `knownCharacters`, `removedCharacters`, `characterColors`, `characterSheets`,
  `timestamp` — no `committedTrackerData` / `lastGeneratedData` → "scene cast
  unavailable" (known characters are not the present cast and are not used).
- DeepLore wraps `console.*` (its diagnostics); our logs still appear, attributed to its
  wrapper — irrelevant for behaviour.

- **Fixtures created (2026-10-07, `.live/README-fixtures.md`)**: Memory Books names memory
  entries `NNN - title` on this account (title format without brackets) — the prefix rule
  must accept `NNN - ` and `[NNN] - `. Doom's suite stores `characterThoughts` and
  `infoBox` as JSON STRINGS inside `lastGeneratedData` / `committedTrackerData` (parse
  when a string), characters carry no `present` key (absent = present), location is
  `infoBox.location.value`. DeepLore runs against a local stand-in for the Obsidian Local
  REST API (`.live/obsidian-rest-mock.mjs`) over a copied vault.
