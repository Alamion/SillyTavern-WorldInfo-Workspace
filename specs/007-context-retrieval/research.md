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
