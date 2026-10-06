# Implementation Plan: Context & Retrieval (Roadmap Phase 6)

**Branch**: `master` (feature dir `007-context-retrieval`) | **Date**: 2026-10-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/007-context-retrieval/spec.md`

## Summary

Make the assistant's context explainable and able to cope with large libraries, let it
draw on other installed lore extensions, and carry "which entries matter now" into
main-chat generation through the native World Info engine.

Technical approach:

- **Context items**: the pure context builder returns typed items (reason, detail, cost,
  state). The preview reuses the same builder without sending, and each sent message stores
  its items in its snapshot (R3).
- **Summaries**: a summary lives at `extensions.wiw_summary` inside the native entry, so it
  travels with the book, the markdown (`wi_summary`) and character cards with no
  persistence-shape change (R1, R2).
- **Catalog selection**: assistant protocol v2 adds a catalog section and `read`/`open`
  operations. The controller fulfils them inside the same reply, reusing the Continue
  mechanism, up to 3 rounds. An Auto mode uses the catalog only when the full text does
  not fit (R4).
- **Local helpers**: a local BM25 index adds fuzzy matches and ranks and narrows catalogs
  (R5). Context sets are saved setting snapshots (R6). The last entry is truncated at a
  sentence boundary (R7).
- **Interop**: Memory Books badges and protection are data-driven, and `flatten` keeps the
  native order of memory entries. Command buttons, the Doom's suite scene cast and DeepLore
  matches are detected at runtime (R8).
- **Main-chat picking**:
  - A manifest generation interceptor builds a catalog from the app's own active-entry
    list (`WORLDINFO_ENTRIES_LOADED`).
  - It uses a pick prepared in the background after each reply, or runs a fresh,
    time-limited pick when the new text names unpicked entries.
  - It forces full entry clones through `WORLDINFO_FORCE_ACTIVATE`, so the native engine
    keeps position, budget and order.
  - Results are recorded per reply (`extra.wiw_pick`) with a message icon and a popup (R9–R11).
  - The new additive event is `wi-workspace:pick-completed` (R12).

## Technical Context

**Language/Version**: TypeScript 5.x, `strict` (constitution III)

**Primary Dependencies**: React 18, Webpack 5, shared SCSS system. App APIs via
`getContext()`:
- generation: `ConnectionManagerRequestService` (existing `LlmPort`), `eventSource` with
  `WORLDINFO_FORCE_ACTIVATE`, `WORLDINFO_ENTRIES_LOADED`, `WORLD_INFO_ACTIVATED`,
  `MESSAGE_RECEIVED`, `CHARACTER_MESSAGE_RENDERED`, `MESSAGE_SWIPED`, `CHAT_CHANGED`,
  `WORLDINFO_SETTINGS_UPDATED`, `WORLDINFO_UPDATED`;
- world info and chat: `getWorldInfoPrompt` (dry refresh), `loadWorldInfo`, `chat`,
  `chatMetadata`, `saveChat`, `saveMetadataDebounced`;
- commands and UI: `SlashCommandParser.commands`, `executeSlashCommandsWithOptions`,
  `Popup`.
- manifest: `generate_interceptor`.

No new runtime dependencies (BM25 is ~100 lines of own code).

**Storage**:
- Workspace state, additive (data-model.md):
  - `extensions.wiw_summary` inside native entries;
  - `FolderNode.pickExcluded`;
  - `settings.assistant` (catalog, fuzzy and sources defaults, `contextSets`);
  - `settings.picking`.
- IndexedDB conversations: the new `ContextSettings` fields and `ContextSnapshot.items`,
  repaired on load.
- Per chat: `chatMetadata.WorldInfoWorkspace.picking`.
- Per reply: `extra.wiw_pick`.

**Testing**: Vitest.
- Unit: context items and reasons, truncation, BM25, catalog building and narrowing,
  protocol v2 parser incl. streaming and fixtures, pick-line parser,
  prepared-vs-fresh decision, Memory Books detection, set repair.
- Integration:
  - summary round-trip matrix on FakeHost + markdown memory disk (R13);
  - Memory Books order exception in the real sync engine;
  - controller read rounds with `FakeLlm`;
  - interceptor with a fake eventSource and fake active entries (off ⇒ zero calls,
    timeout bound, chat change discards, forced objects complete).
- Contract: `docs/hooks.md` ↔ `WI_EVENTS`, manifest interceptor key, forced-entry shape vs
  `world-info.js` expectations.
- Live: quickstart C0–C40.

**Target Platform**: SillyTavern web UI (desktop + mobile), Connection Manager enabled for
assistant and picking.

**Project Type**: SillyTavern UI extension (single bundle)

**Performance Goals**:
- preview build for a 1000-entry workspace < 150 ms;
- BM25 index build for 1000 entries < 100 ms (memoized thereafter);
- interceptor overhead with picking OFF < 1 ms;
- using a prepared pick < 20 ms;
- the spec 006 budgets still hold (L-2 exception unchanged).

**Constraints**:
- Never block or abort generation: SC-006 (timeout + 1 s).
- No own prompt injection.
- AGPL references: data formats only.
- No credentials.
- Additive hooks only.
- English-only artifacts.

**Scale/Scope**: libraries up to the spec 006 target (1000-entry book, ~2000 nodes); picks
up to 30 entries; up to 50 context sets.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Check | Status |
|-----------|-------|--------|
| I. Holistic, modular | New pure modules under `core/assistant/` (`catalog.ts`, `bm25.ts`, `truncate.ts`, `contextSets.ts`) and `core/picking/` (`decide.ts`, `pickParser.ts`, `forced.ts`), `core/interop/` (`memoryBooks.ts`, `doomsTracker.ts`); adapters `pickingController.ts`, `pickIndicator.ts`, `interopSources.ts`; one bundle, interceptor registered from `index.ts` | ✅ |
| II. App API first | Everything via `getContext()` and app events; active entries from the app's own `WORLDINFO_ENTRIES_LOADED` (no import of `world-info.js` internals such as `getSortedEntries`); forced activation through the app's documented event; message buttons through the app's template slot used by bundled extensions | ✅ |
| III. Strict TS | `global.d.ts` grows: event names above, `SlashCommandParser.commands`, chat message `extra`/`swipe_info`, `WORLDINFO_ENTRIES_LOADED` payload, interceptor signature | ✅ |
| IV. Lint & format | Unchanged | ✅ |
| V. Test-first | All selection, parsing, decision and truncation logic is pure and table-driven; summary matrix written before the editor field | ✅ |
| VI. Integration testing | FakeHost sync (summary, Memory Books order), controller read rounds, interceptor against a fake eventSource mirroring `world-info.js` forced-activation handling | ✅ |
| VII. Interop hooks | One additive event `wi-workspace:pick-completed`; `docs/hooks.md` + `WI_EVENTS` updated together | ✅ |
| VIII. Pattern + speckit | Full speckit path (contracts touched: persistence, markdown, protocol, sync semantics, hooks) | ✅ |
| IX. Language | English UI strings and artifacts | ✅ |

Post-design re-check (after Phase 1 artifacts): still ✅. The interceptor and forced
activation are the documented extension points; the Memory Books order exception is a
documented sync-contract change (contracts/native-sync-delta.md), not a hidden one.

## Project Structure

### Documentation (this feature)

```text
specs/007-context-retrieval/
├── spec.md
├── plan.md                 # this file
├── research.md             # reference study + native facts + decisions R1–R13
├── data-model.md
├── quickstart.md           # live scenarios C0–C40
├── contracts/
│   ├── assistant-protocol-v2.md
│   ├── markdown-convention-delta.md
│   ├── native-sync-delta.md
│   ├── main-chat-picking.md
│   ├── hooks.md
│   └── ui-contract.md
├── checklists/requirements.md
└── tasks.md                # /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── core/
│   ├── assistant/
│   │   ├── context.ts        # + items/reasons, catalog mode, sets, sources (changed)
│   │   ├── catalog.ts        # catalog lines, folder narrowing (new)
│   │   ├── bm25.ts           # local fuzzy index + ranking (new)
│   │   ├── truncate.ts       # sentence-boundary cut (new)
│   │   ├── contextSets.ts    # repair/apply/save sets (new)
│   │   ├── parser.ts         # + read/open blocks, summary tag (changed)
│   │   ├── protocol.ts       # v2 model-facing text (changed)
│   │   ├── validate.ts       # + "read the entry first" (changed)
│   │   └── types.ts          # ContextItem, new ContextSettings fields (changed)
│   ├── picking/
│   │   ├── decide.ts         # prepared vs fresh, mentions in new text (new)
│   │   ├── pickParser.ts     # <pick> lines (new)
│   │   ├── request.ts        # picking prompt + catalog (new)
│   │   └── forced.ts         # forced-entry objects, decorator stripping (new)
│   ├── interop/
│   │   ├── memoryBooks.ts    # detection, badge kind, prefix rule (new)
│   │   └── doomsTracker.ts   # present cast / location extraction (new)
│   ├── sync/flatten.ts       # Memory Books order exception (changed)
│   ├── md/convention.ts      # wi_summary (changed)
│   ├── hooks/events.ts       # + pick-completed (changed)
│   └── state/schema.ts       # pickExcluded, settings.picking repair (changed)
├── adapters/
│   ├── assistantController.ts # read rounds, previews, sets (changed)
│   ├── pickingController.ts   # interceptor, preparation, recording, events (new)
│   ├── pickIndicator.ts       # message icon + popup (new)
│   ├── interopSources.ts      # runtime detection, DeepLore/DES readers, MB commands (new)
│   └── settingsStore.ts       # picking settings bridge (changed)
├── ui/
│   ├── ItemEditor.tsx / fieldGroups # summary field, MB badge, folder exclusion (changed)
│   ├── StructureTree.tsx      # summary tooltip, MB badge (changed)
│   ├── assistant/ContextMenu.tsx    # catalog/fuzzy/sources/sets (changed)
│   ├── assistant/ContextPreview.tsx # items panel (new)
│   └── PickingSettings.tsx    # global + per-chat settings (new)
└── index.ts                   # registers globalThis.wiwPickInterceptor (changed)
manifest.json                  # generate_interceptor (changed)
tests/
├── unit/        # bm25, truncate, catalog, context-items, protocol-v2, pick-parser, decide, memory-books, sets
├── integration/ # summary-roundtrip (FakeHost + memory disk), mb-order (sync engine), read-rounds (controller), picking (interceptor)
└── fixtures/assistant/ # v2 replies (read rounds, round limit, summary edit)
```

**Structure Decision**: same single-bundle layout as earlier phases. Picking is its own
`core/picking` + adapter pair because it runs in the main-chat generation path, not in
the workspace UI. It shares the catalog, BM25 and trigger matching with the assistant.

## Delivery order (for tasks)

1. **Foundations**: summary field (R1/R2) plus the round-trip matrix (R13); context items
   and the preview (US1).
2. **Catalog and reads**: catalog, BM25 and protocol v2 read rounds (US2); assistant
   summary proposals.
3. **Smaller assistant features**: fuzzy, sets and truncation (US3).
4. **Interop**: Memory Books protection, badges and order (US4), then DES/DeepLore sources
   and the command buttons.
5. **Main-chat picking** (US5), then its indicator and the event.
6. **Docs**: README, `docs/hooks.md`, AGENTS.md, CHANGELOG; live C0–C40.

## Complexity Tracking

| Item | Why Needed | Simpler Alternative Rejected Because |
|------|------------|-------------------------------------|
| Background pick preparation | Free models answer in ~30 s; waiting on every turn makes the mode unusable (clarification 2026-10-06) | Waiting every turn (latency); preparing only (misses the user's latest message) |
| Memory Books order exception in `flatten` | Tree order would scramble Memory Books numbering (clarification 2026-10-06) | Locking reorder in the tree (worse UX); warning only (still breaks data) |
