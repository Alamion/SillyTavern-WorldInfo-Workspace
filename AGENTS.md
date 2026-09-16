# AGENTS.md — WorldInfo Workspace

## Project

SillyTavern UI extension: **World Info Workspace** — a single integrated workspace for
lore management. It unifies a flexible folder tree (cards, notes, any depth),
workspace-authoritative sync into the native World Info format via designated "World
Info" root folders, an in-workspace AI lore assistant, and bidirectional markdown
conversion. Roadmap and full requirements: `specs/001-workspace-plugin-roadmap/`.

**Earlier increment (spec 003)**: Phase 1 Core Workspace MVP implemented and validated
(owner walkthrough S1–S13, 2026-09-14; results in `quickstart.md`):
the workspace runs on real persisted data (`extensionSettings['WorldInfoWorkspace']`,
schema v1 with migration/recovery), full tree CRUD with multi-select bulk actions and a
touch-safe move affordance (long-press menu), trustworthy editing (commit-on-change,
validation surfaced, placeholder-resolving preview, save-failure banner with retry,
flush before generation), and workspace-authoritative native WI sync via designated
roots: books created on designation (inactive, FR-022/FR-023 naming invariant),
flattened pushes with divergence guards in both directions, orphan retention/resolution
(FR-018), delete disclosure (FR-021), lossless import incl. per-entry conflict
resolution, and the Lorebooks panel (all native books: activation, import next to the
tree selection / update from native, delete — search, filters, pagination). Design contracts:
`specs/003-core-workspace-mvp/` (research/data-model/contracts/quickstart/tasks).
**Previous increment (spec 004, implemented and owner-validated 2026-09-15)**: roadmap Phase 3 — Markdown Folder Sync (roadmap order
amended 2026-09-14: Phase 3 before Phase 2). One-off export of any subtree and import of
any markdown folder (Obsidian vaults included), plus ONE whole-workspace folder link with
hybrid sync. Design: `specs/004-markdown-folder-sync/` (convention contract, disk port,
UI contract, quickstart S0–S14).
**Current increment (spec 005, implemented 2026-09-15; live validation pending)**: roadmap
Phase 2 — AI Lore Assistant. Requests via `ConnectionManagerRequestService` on a profile
chosen in the assistant settings (streaming follows the profile's preset); prose replies
with tagged operation blocks (`contracts/assistant-protocol.md`), batch proposals with
review/diff/undo, conversations in IndexedDB `WorldInfoWorkspace-assistant`. Design:
`specs/005-ai-lore-assistant/` (research R1–R14, data model, protocol/LLM port/UI/hooks
contracts, quickstart A0–A21).

## Key Reference

**Always check `specs/001-workspace-plugin-roadmap/research.md`** for the native World
Info field inventory, save mechanics (`saveWorldInfo` clone discipline, debounce, server
contract), the `getContext()` API surface, and event constants — all derived from the
vendored app source in `context/SillyTavern/`.

## Commands

| Command                      | Purpose                                        |
| ---------------------------- | ---------------------------------------------- |
| `pnpm install`               | Install dependencies                           |
| `pnpm run build`             | Production build to `dist/index.js` (webpack)  |
| `pnpm run dev`               | Watch mode (webpack, source maps)              |
| `pnpm run test`              | Vitest suite                                   |
| `pnpm exec tsc --noEmit`     | Typecheck (also `pnpm run typecheck`)          |
| `pnpm run lint` / `lint:fix` | ESLint 9 flat config + TS                      |

All four gates (`typecheck`, `lint`, `test`, `build`) MUST pass before any commit
(constitution III/IV/V/VI).

## Constitution

`.specify/memory/constitution.md` — principles I–IX:

1. Holistic, modular plugin (single manifest/bundle, explicit module surfaces)
2. App API first — everything via `globalThis.SillyTavern.getContext()`; never fork app
   internals; `context/SillyTavern/` is read-only reference and is never bundled
3. Strict TypeScript — `strict`, no `any`, app types in `src/global.d.ts`
4. Lint & format discipline — ESLint 9 flat config + `.prettierrc`; zero errors
5. Test-first for core logic (Vitest)
6. Integration tests against `getContext()` surfaces
7. Extension interop hooks — namespaced `wi-workspace:*` events, additive only
8. Proven pattern (SillyTavern-3DDiceRolls) + spec-driven execution (speckit)
9. Language policy — conversation in any language; ALL artifacts (code, specs, UI,
   docs, commits) English-only

## Project Structure

Real layout (from `specs/002-workspace-ui-prototype/plan.md`). **No empty
files/folders**: directories are created only by the tasks of the feature that first
needs them.

```
src/
├── core/                # Pure logic (Vitest-first, no app imports)
│   ├── state/           # schema.ts (WorkspaceState v1 + migrate), store.ts
│   ├── tree/            # operations.ts, browse.ts, validation.ts, imageLinks.ts (image
│   │                    #   references in content: img:<id>, names, paths, ![[…]], URLs)
│   ├── sync/            # flatten.ts, fingerprint.ts, divergence.ts, import.ts,
│   │                    #   bookNaming.ts
│   ├── books/           # listing.ts (book search/filters/pagination for book lists)
│   ├── md/              # Markdown folders (spec 004): ports.ts (DiskFolder/access/yaml/
│   │                    #   image store ports), convention.ts (field table, entry files,
│   │                    #   folder records), naming.ts, scan.ts, exportPlan.ts,
│   │                    #   importPlan.ts, reconcile.ts (three-way), linkRender.ts,
│   │                    #   applyPull.ts, imageRefs.ts, reference.ts, report.ts, hash.ts,
│   │                    #   dataUri.ts
│   ├── assistant/       # AI assistant (spec 005): types.ts, ports.ts (LlmPort,
│   │                    #   ConversationStorePort, ChatContextPort), parser.ts (tolerant
│   │                    #   incremental protocol parser), protocol.ts (model-facing text),
│   │                    #   prompts.ts (instructions, decision notes), handles.ts, scope.ts,
│   │                    #   context.ts (request + budget), validate.ts (blocks → proposals),
│   │                    #   rules.ts (destructive/duplicate/stale), plan.ts (order, blocked,
│   │                    #   accept-all), undo.ts, failures.ts, settingsOps.ts
│   ├── demo/            # dataset.ts (Aldermeer seed), sampleDataset.ts (Phase 0 shapes)
│   ├── fieldSchema.ts   # Typed field schema + drawer layout (from Phase 0)
│   ├── preview.ts       # Markdown renderer + placeholder hook (FR-010)
│   └── diff/            # lineDiff.ts — shared LCS line diff (any before/after view)
├── adapters/            # App boundary — the ONLY host-facing modules
│   ├── shell.ts             # Host drawer composition (#WorldInfo mount)
│   ├── appApi.ts            # getAppContext() (memoized API) + getLiveAppContext()
│   │                        #   (fresh context for data snapshots: characters, tags, characterId)
│   ├── settingsStore.ts     # extensionSettings bridge + services bootstrap
│   ├── worldInfoAdapter.ts  # Book load/save/create/delete/rename composition
│   ├── activeBooksAdapter.ts# Native #world_info select read + drive by option TEXT (FR-017)
│   ├── bookStates.ts        # Book facts: global activation, character/chat binding, bound folder
│   ├── syncEngine.ts        # Push pipeline, divergence reports, orphan/import flows
│   ├── saveEvents.ts        # Save outcome events (failure banner, FR-009)
│   ├── workspaceActions.ts  # Tree change + sync-engine notification; restored WI roots;
│   │                        #   deleteNodes/describeDeletion (the single delete path)
│   ├── llmClient.ts         # LlmPort over ConnectionManagerRequestService (spec 005)
│   ├── conversationStore.ts # IndexedDB WorldInfoWorkspace-assistant + memory fallback
│   ├── chatContext.ts       # Chat messages, character card, persona, activated entries
│   ├── assistantApply.ts    # Apply proposals / deletions / undo via tree ops + hooks
│   ├── assistantController.ts # UI-facing assistant surface (conversations, requests,
│   │                        #   streaming, retries, proposal decisions, undo)
│   ├── fsaDisk.ts           # File System Access folder port + IndexedDB link store
│   ├── yamlCodec.ts         # YAML via SillyTavern.libs.yaml (never bundled)
│   ├── imageStore.ts        # App image storage (user/images/WorldInfoWorkspace/)
│   ├── mdExport.ts / mdImport.ts  # One-off export / import runners
│   ├── mdLink.ts            # Linked folder: pull, debounced auto-push, conflicts, reconnect
│   ├── mdController.ts      # UI-facing markdown surface (busy, reports, decisions)
│   ├── popups.ts            # Confirm/input dialogs over app Popup APIs
│   └── logger.ts            # Namespaced console debug + toastr
├── ui/                  # React components
│   ├── WorkspaceApp.tsx     # Layout root: tree and assistant splitters, bulk bar, banners, modals
│   ├── StructureTree.tsx    # Real tree: toolbar, DnD + long-press menu, multi-select
│   ├── ItemEditor.tsx       # entry / image / folder(+root book settings) views
│   ├── LorebooksPanel.tsx   # All native books: activation, import/update (+ conflict
│   │                        #   resolution), delete (bound book = book + folder)
│   ├── BookList.tsx         # Shared book list: useBookFacts, search, filter chips, pager
│   ├── NodeHeader.tsx       # Unified item header (icon, enable, name, duplicate/delete)
│   ├── Sheet.tsx            # Mobile bottom sheet
│   ├── fieldGroups/FieldGroups.tsx  # Essentials/Content/Advanced rows (store-bound)
│   ├── fieldGroups/MultiSelect.tsx  # Chip multi-select; CharacterFilterControl (chars + tags)
│   ├── MarkdownControl.tsx  # Header chip + menu: link/sync/export/import/reference
│   ├── DiffView.tsx         # SHARED side-by-side diff (assistant proposals, conflicts, …)
│   ├── ConflictDialog.tsx   # Per-item keep workspace / keep file / skip
│   ├── OperationReport.tsx  # Import/export/sync report modal
│   ├── MappingReference.tsx # Convention tables + sample entry
│   ├── AssistantPanel.tsx   # Assistant region root (spec 005)
│   ├── assistant/           # ConversationSwitcher, ConversationView, Composer,
│   │                        #   ProposalCard/Editor/Diff, BatchBar, ReplyNotices,
│   │                        #   FailureCard, SettingsMenu, ContextMenu, useAssistant
│   └── mount.tsx            # React root creation
├── styles/
│   ├── wiw-theme.scss   # SHARED style system (buttons, panels, rows, banners, menus,
│   │                    #   multi-select, book lists)
│   └── prototype.scss   # Three-region layout (uses wiw-theme)
├── global.d.ts          # Typed SillyTavern API surface (grows per feature)
├── styles.d.ts          # SCSS module declaration
└── index.ts             # Entry: init state+services, shell mount on APP_READY
tests/
├── manifest.test.ts     # Manifest contract test (spec 001)
├── support/             # memoryDisk.ts (in-memory DiskFolder + fault injection, node
│                        #   digest/yaml, MemoryImageStore), mdFixtures.ts, fakeHost.ts
│                        #   (shared sync-engine harness), fakeLlm.ts, fakeChatContext.ts,
│                        #   memoryConversationStore.ts
├── fixtures/assistant/  # recorded live reply + hostile protocol cases, Aldermeer state
├── contract/
│   ├── native-wi.test.ts        # Adapter usage vs app contract (jsdom)
│   ├── disk-port.test.ts        # DiskFolder guarantees (runDiskPortSuite)
│   ├── yaml-codec.test.ts       # libs.yaml delegation
│   └── hooks.test.ts            # wi-workspace:md-* event payloads
├── integration/
│   └── sync-engine.test.ts      # REAL engine + adapters vs FakeHost mirroring the app's
│                                #   save/cache/event mechanics; scenarios A–W (every live
│                                #   discrepancy becomes a scenario here)
└── unit/                # state (+recovery), tree, sync, books listing, preview,
                         #   fingerprint, naming, demo, diff
dist/           # Built bundle — TRACKED in git (manifest.json points here)
manifest.json   # ST extension manifest (display_name, js: dist/index.js, semver 0.4.2)
```

## Settings

Workspace state persists under `extensionSettings['WorldInfoWorkspace']` (schema v1,
saved via `saveSettingsDebounced` after every mutation): `{ version: 1, root:
FolderNode-tree, settings: { sortMode, assistant? }, _recovered? }`. `settings.assistant`
(spec 005, optional/additive) = `{ profileId, responseTokens, contextTokens, instructions,
defaultContext }`, repaired field by field by `getAssistantSettings`; it is NOT saved while
a data recovery is unresolved (`settingsStore.isRecoveryPending()`). Conversations never
live in settings. Node kinds: folder (expanded,
isWiRoot, book binding `{ bookName, orphans, tombstones }`), entry (full native entry
incl. `triggers` and the native `characterFilter` object + sync), image (src/caption).
Sync is PER BOOK: `sync.books[bookName] = { uid, hash (FNV-1a), status in-sync|dirty }`.

Load rules (`migrate`): `parentId` is derived from the nesting; missing native fields
are filled and legacy shapes migrated (v1 single-book sync, flat character-filter keys)
with sync hashes carried over. An invalid payload yields an empty workspace that is NOT
published before the user's first edit (settings are shared across devices); the raw
payload stays under `_recovered` until Restore/Discard in the recovery banner. Full
contract: `specs/003-core-workspace-mvp/contracts/persistence-schema.md`.

## World Info sync (Phase 1 semantics)

- Workspace-authoritative: edits mark entities dirty; the sync engine debounces 1000 ms
  (its own debounce — failures are catchable) and pushes the flattened `{ entries }`
  payload via `saveWorldInfo(immediately)`; flushes on `GENERATION_STARTED` and panel
  close.
- Books are created on root designation and stay inactive; activation is driven through
  the native `#world_info` select (option value = index, name = option text) from the
  Lorebooks panel (FR-017).
- Failed saves: the app caches a payload before its fetch; the adapter fingerprints the
  unsent write so Retry pushes it without a false divergence, and every successful save
  emits a `success` save event (clears that book's failure banner).
- Workspace vs native editor is a MODE toggle (2026-09-08 amendment): the native
  Worlds/Lorebooks editor is the default; `shell.ts` inserts a "Workspace" button into
  the native book row, and the workspace header's "Worlds/Lorebooks" button switches
  back (`body.wiw-active` controls visibility).
- Book names are assigned once through the app's collision-resolved flow ("Name (N)")
  and are opaque handles thereafter — folder renames never rename books (FR-023).
- Clean-side native changes merge silently (refreshes, additions, deletions); only
  genuine conflicts (both sides edited) and validation blocks raise banners (FR-015).
- Move-out removes an entry from the book at the next push via tombstones, move-in adds
  it (FR-018 amended 2026-09-14); deleted entities are disclosed in the delete
  confirmation and removed at the next sync (FR-021).
- Images and folders are workspace-only: they never export and never import (owner
  decision 2026-09-08; the former wiw-marker image encoding is retired). Sync state is
  PER BOOK (`sync.books[bookName] = { uid, hash, status }`) — nested WI roots give an
  entity independent uids in several books.

## Markdown folders (spec 004)

- **Access**: browser File System Access API only (desktop Chromium + secure page:
  HTTPS or localhost); elsewhere the header control is disabled with an explanation.
  The link (directory handle + baseline) lives in IndexedDB `WorldInfoWorkspace-md`
  (store `links`, key `default`) — per browser profile, never in extension settings.
  Alternatives (server plugin, upload/download) are recorded in the spec; all logic sits
  behind `core/md/ports.ts` so another access port can be added.
- **Convention** (`contracts/markdown-convention.md`): directory = folder, `.md` = entry
  (YAML front matter with `wi_`-prefixed keys + verbatim body), image files = image
  items, hidden `.wiw-folder.yaml` = folder record. Minimal metadata: every key optional,
  defaults never written, ids never written, records only for non-default folders;
  foreign keys (`tags`, `aliases`) and unknown `wi_*` keys are preserved (`node.md`).
- **Import**: the picked folder becomes one workspace folder, or — via the selection
  dialog — only chosen top-level folders/files, each as its own item
  (`core/md/folderViews.ts`: `wrapAsDirectory` / `selectTopLevel` over the picked folder);
  "Import files…" (`showOpenFilePicker`, `core/md/filesFolder.ts`) imports single
  notes/images through the same pipeline.
- **Typing performance**: `ui/mount.tsx` stops editing events (keydown/input/…, except
  Escape) at the workspace container — the app's document-level delegated jQuery handlers
  otherwise matched selectors on every keystroke.
- **Identity**: optional `wi_id` hint → path → folder move → unique content hash; rename +
  edit on disk in one interval = confirmed deletion + creation.
- **Hybrid sync** (`mdLink.ts`): workspace edits auto-push (1000 ms debounce) and are
  HELD BACK when the file changed on disk since the baseline; disk changes are pulled on
  Sync and when the workspace is shown (`shell.onWorkspaceShown`, inside the click for
  permission prompts). Conflicts: keep workspace / keep file / skip; disk deletions need
  confirmation (decline = files written again). Pulled changes go through the Phase 1
  tree ops + `workspaceActions.applyTreeChange`, so native books update as usual.
- **Images**: imported/uploaded images go to the app image storage via
  `/api/images/upload` (`user/images/WorldInfoWorkspace/`, formats bmp/png/jpg/jpeg/jfif/
  gif/webp; SVG/AVIF stay `data:` URIs); owned files are deleted when no image item
  references them any more (`core/md/imageRefs.ts`, wired in `settingsStore.ts`).
- **Hooks** (additive, constitution VII): `wi-workspace:md-link-changed`
  `{ state: 'none'|'loading'|'needs-reconnect'|'unavailable'|'linked', folderName }`,
  `wi-workspace:md-synced` `{ report: OperationReport }`.
- **Live automation**: Playwright cannot drive the native picker — substitute
  `window.showDirectoryPicker = () => navigator.storage.getDirectory()` via
  `page.addInitScript` (OPFS handle, same interface).

## AI assistant (spec 005)

- **Requests**: only `ConnectionManagerRequestService.sendRequest(profileId, messages,
  maxTokens, { stream, signal, extractData: true, includePreset, includeInstruct })`
  through `adapters/llmClient.ts` — never `generateRaw`/`generateQuietPrompt`, never the
  main abort controller, never credentials. `stream` comes from the profile's preset
  (`stream_openai` / textgen `streaming`); requests need the Connection Manager extension.
  Text Completion profiles are best-effort.
- **Protocol** (`contracts/assistant-protocol.md`): prose + `<op type=… …>` blocks with
  per-request handles (`f1`, `e12`, `i3`) and refs (`new1`). The parser is tolerant and
  incremental (called on every stream chunk); broken blocks are counted, shown on request,
  and "Regenerate with the same context" re-sends the stored `requestMessages`.
- **Context** (`core/assistant/context.ts`): instructions, where the user is (selection +
  current folder), outline of the chosen structure only (handles exist only for it and the
  folders above it), entry contents for selected + key-triggered entries
  (`core/assistant/triggers.ts`, recursive) or all entries, optional chat/card/persona/
  activated entries, history with decision notes; budget by ~3.5 chars/token; everything
  left out is reported. The workspace part goes into the latest user turn as a
  `<workspace>` block — system messages carry only rules (models ignore lore there).
- **Messages**: the last reply keeps versions (`Message.variants`, `core/assistant/variants.ts`;
  the shown one is mirrored in the message fields); any message can be deleted
  (`deleteMessage`) or start a fork (`forkConversation`, copies marked `forkedFrom`, no undo
  in the fork).
- **Proposals**: validated against scope and Phase 1 field rules; destructive = deletion,
  > 50 % of content removed (word-level), or any keyword removed → own confirmation, never
  via Accept all. Stale targets (changed since parse) need a fresh review. Applying goes
  through tree ops + `applyTreeChange` / `deleteNodes`, so native sync and the markdown
  link behave as for manual edits. Any applied batch can be undone while the conversation
  exists; items edited since are skipped and reported.
- **Failures**: rate-limit/network retry automatically twice (10 s, 30 s), visibly and
  stoppably; everything else is a manual Retry. Free OpenRouter models are rate-limited
  often — this is expected.
- **Storage**: IndexedDB `WorldInfoWorkspace-assistant` (stores `conversations`,
  `messages` keyed `[conversationId, seq]`), per browser profile; memory fallback with a
  banner when IndexedDB is unavailable.
- **Hooks** (additive): `wi-workspace:assistant-applied` `{ conversationId, batchId,
  operations: [{ op, nodeId, name }], failed? }`, `wi-workspace:assistant-undone`
  `{ conversationId, batchId, reverted: string[], skipped: string[] }`.

## SillyTavern Integration

- `globalThis.SillyTavern.getContext()` — main API, typed in `src/global.d.ts`
- Extension docs: https://docs.sillytavern.app/for-contributors/writing-extensions/
- World Info docs: https://docs.sillytavern.app/usage/core-concepts/worldinfo/

## Context

Read-only reference material lives in `context/` (git-ignored, never bundled):

- `context/SillyTavern/` — vendored app source (`public/scripts/st-context.js`,
  `public/scripts/world-info.js` are the primary references)
- `context/SillyTavern-3DDiceRolls/` — author's previous extension; baseline pattern
- `context/SillyTavern-WorldInfo-Recommender/`, `context/SillyTavern-WorldInfoDrawer/` —
  functional baselines this plugin unifies (installed live on the `reference` account
  for side-by-side comparison)

## Live test accounts

The local instance (`http://127.0.0.1:8634`, data under `ST-Data/`) has two passwordless
accounts safe to modify: `dev` (this extension's working copy lives in
`ST-Data/dev/extensions/`) and `reference` (WorldInfoDrawer + WorldInfo-Recommender).
Browser checks: `playwright-cli` with the system Chromium (`/usr/bin/chromium-browser`
via a `.playwright/cli.config.json` `launchOptions.executablePath`).
- `context/variables.css` — all SillyTavern theme variables

## Style system (constitution amendment 1.2.0)

All component styling lives in `src/styles/wiw-theme.scss` (shared primitives: buttons,
overlays/panels, rows, banners, menus, bulk bar, badges) composed through
`prototype.scss` (layout). Theme variables only (`--SmartTheme*`); when a surface needs
something new, extend the shared system — never add one-off styles.

## Symbols and emojis

The source app uses `Font Awesome 6 Free` for custom symbols; follow the same pattern
where the font has a suitable icon.
