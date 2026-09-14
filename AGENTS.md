# AGENTS.md — WorldInfo Workspace

## Project

SillyTavern UI extension: **World Info Workspace** — a single integrated workspace for
lore management. It unifies a flexible folder tree (cards, notes, any depth),
workspace-authoritative sync into the native World Info format via designated "World
Info" root folders, an in-workspace AI lore assistant, and bidirectional markdown
conversion. Roadmap and full requirements: `specs/001-workspace-plugin-roadmap/`.

**Current increment (spec 003)**: Phase 1 Core Workspace MVP delivered (2026-09-08):
the workspace runs on real persisted data (`extensionSettings['WorldInfoWorkspace']`,
schema v1 with migration/recovery), full tree CRUD with multi-select bulk actions and a
touch-safe move affordance (long-press menu), trustworthy editing (commit-on-change,
validation surfaced, placeholder-resolving preview, save-failure banner with retry,
flush before generation), and workspace-authoritative native WI sync via designated
roots: books created on designation (inactive, FR-022/FR-023 naming invariant),
flattened pushes with divergence guards in both directions, orphan retention/resolution
(FR-018), delete disclosure (FR-021), lossless import incl. per-entry conflict
resolution, and the replacement all-books activation list. Design contracts:
`specs/003-core-workspace-mvp/` (research/data-model/contracts/quickstart/tasks).
Next: Phase 2 (AI assistant) per the roadmap.

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
│   ├── tree/            # operations.ts, browse.ts, validation.ts
│   ├── sync/            # flatten.ts, convert.ts, fingerprint.ts, divergence.ts,
│   │                    #   import.ts, bookNaming.ts
│   ├── demo/            # dataset.ts (Aldermeer seed), sampleDataset.ts (Phase 0 shapes)
│   ├── fieldSchema.ts   # Typed field schema + drawer layout (from Phase 0)
│   ├── preview.ts       # Markdown renderer + placeholder hook (FR-010)
│   └── assistant/       # diff.ts (assistant mock, Phase 2 scope)
├── adapters/            # App boundary — the ONLY host-facing modules
│   ├── shell.ts             # Host drawer composition (#WorldInfo mount)
│   ├── appApi.ts            # Single typed getContext() accessor
│   ├── settingsStore.ts     # extensionSettings bridge + services bootstrap
│   ├── worldInfoAdapter.ts  # Book load/save/create/delete/rename composition
│   ├── activeBooksAdapter.ts# Native #world_info select read + drive (FR-017)
│   ├── syncEngine.ts        # Push pipeline, divergence reports, orphan/import flows
│   ├── saveEvents.ts        # Save outcome events (failure banner, FR-009)
│   ├── popups.ts            # Confirm/input dialogs over app Popup APIs
│   └── logger.ts            # Namespaced console debug + toastr
├── ui/                  # React components
│   ├── WorkspaceApp.tsx     # Layout root: splitter, bulk bar, banners, modals
│   ├── StructureTree.tsx    # Real tree: toolbar, DnD + long-press menu, multi-select
│   ├── ItemEditor.tsx       # entry / image / folder(+root book settings) views
│   ├── ActiveBooksPanel.tsx # Replacement book list with activation checkboxes
│   ├── ImportDialog.tsx     # Native lorebook import + per-entry conflict resolution
│   ├── fieldGroups/FieldGroups.tsx  # Essentials/Content/Advanced rows (store-bound)
│   ├── AssistantPanel.tsx   # Batch-proposal mock (Phase 2 scope)
│   └── mount.tsx            # React root creation
├── styles/
│   └── prototype.scss   # Three-region layout + banners/menus/modals
├── global.d.ts          # Typed SillyTavern API surface (grows per feature)
├── styles.d.ts          # SCSS module declaration
└── index.ts             # Entry: init state+services, shell mount on APP_READY
tests/
├── manifest.test.ts     # Manifest contract test (spec 001)
├── contract/
│   └── native-wi.test.ts        # Adapter usage vs app contract (jsdom)
└── unit/                # state, tree, sync, preview, fingerprint, naming, demo, diff
dist/           # Built bundle — TRACKED in git (manifest.json points here)
manifest.json   # ST extension manifest (display_name, js: dist/index.js, semver 0.2.0)
```

## Settings

Workspace state persists under `extensionSettings['WorldInfoWorkspace']` (schema v1,
saved via `saveSettingsDebounced` after every mutation): `{ version: 1, root:
FolderNode-tree, settings: { sortMode } }`. Node kinds: folder (expanded, isWiRoot,
book binding `bookName` + orphans), entry (full `NativeWorldInfoEntry` + sync state),
image (src/caption + sync). Per-entity sync bookkeeping: `bookName`, `uid` (stable slot
in its book), `status` (new/in-sync/dirty/orphaned), `lastExportedHash` (FNV-1a of the
native entry), `nativeDrift`. Full contract:
`specs/003-core-workspace-mvp/contracts/persistence-schema.md`.

## World Info sync (Phase 1 semantics)

- Workspace-authoritative: edits mark entities dirty; the sync engine debounces 1000 ms
  (its own debounce — failures are catchable) and pushes the flattened `{ entries }`
  payload via `saveWorldInfo(immediately)`; flushes on `GENERATION_STARTED` and panel
  close.
- Books are created on root designation and stay inactive; activation is driven through
  the native `#world_info` select by the workspace's ActiveBooksPanel (FR-017).
- Workspace vs native editor is a MODE toggle (2026-09-08 amendment): the native
  Worlds/Lorebooks editor is the default; `shell.ts` inserts a "Workspace" button into
  the native book row, and the workspace header's "Worlds/Lorebooks" button switches
  back (`body.wiw-active` controls visibility).
- Book names are assigned once through the app's collision-resolved flow ("Name (N)")
  and are opaque handles thereafter — folder renames never rename books (FR-023).
- Divergence (native-side drift or foreign entries) blocks automatic pushes in BOTH
  directions and is resolved via per-entry import/push choices — never silent (FR-015).
- Orphans (entries moved out of a root) are retained in the book until the user
  resolves them (FR-018); deleted entities are disclosed in the delete confirmation and
  removed at the next sync (FR-021).
- Images and folders are workspace-only: they never export and never import (owner
  decision 2026-09-08; the former wiw-marker image encoding is retired). Sync state is
  PER BOOK (`sync.books[bookName] = { uid, hash, status }`) — nested WI roots give an
  entity independent uids in several books.

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
  functional baselines this plugin unifies
- `context/variables.css` — all SillyTavern theme variables

## Style system (constitution amendment 1.2.0)

All component styling lives in `src/styles/wiw-theme.scss` (shared primitives: buttons,
overlays/panels, rows, banners, menus, bulk bar, badges) composed through
`prototype.scss` (layout). Theme variables only (`--SmartTheme*`); when a surface needs
something new, extend the shared system — never add one-off styles.

## Symbols and emojis

The source app uses `Font Awesome 6 Free` for custom symbols; follow the same pattern
where the font has a suitable icon.
