# Implementation Plan: Markdown Folder Sync (Roadmap Phase 3)

**Branch**: `master` (feature dir `004-markdown-folder-sync`) | **Date**: 2026-09-14 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/004-markdown-folder-sync/spec.md`

## Summary

Make a real folder of markdown files a second home for the workspace's lore: one-off
export of any subtree, one-off import of any markdown folder (including hand-written
Obsidian vaults), and a single whole-workspace link with hybrid sync — workspace edits
written to disk automatically, disk changes pulled on Sync and on workspace open, with a
three-way baseline for conflicts, confirmed deletions, and move/rename detection.

Technical approach: folders are reached through the browser File System Access API
(owner decision, option A) behind a narrow `DiskFolder` port so other access mechanisms
can be added later. A pure `core/md` module owns the convention (YAML front matter with
`wi_`-prefixed keys, dotfile folder records, safe stable file names), scanning, and the
reconcile decision table; adapters provide the FSA port with an IndexedDB link/baseline
store, a YAML codec over the app's bundled `yaml` library, and a link manager that
applies accepted changes through the Phase 1 pure tree operations plus the existing
sync-engine hooks, so native World Info keeps flowing through the Phase 1 pipeline.
Details: [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 5.x, `strict` (constitution III)

**Primary Dependencies**: React 18, Webpack 5, SCSS shared style system; app APIs via
`getContext()`; app-bundled `yaml@2` via `globalThis.SillyTavern.libs.yaml` (R3); browser
File System Access API + IndexedDB + `crypto.subtle` (R1, R7, R8). New devDependency:
`yaml@^2` (tests only, not bundled).

**Storage**: Workspace data unchanged in `extensionSettings['WorldInfoWorkspace']`
(optional `md` extras per node, schema v1); link handle + baseline in IndexedDB
`WorldInfoWorkspace-md` (per browser profile); lore files in the user-picked folder.

**Testing**: Vitest — unit (convention, naming, reconcile), integration (link manager +
`MemoryDiskFolder` + real store, fault injection), contract (disk port suite); live
Chromium via Playwright with OPFS substituted for the picker; manual Obsidian check.

**Target Platform**: SillyTavern web UI; markdown features only in desktop
Chromium-family browsers on a secure page (HTTPS / localhost); elsewhere visibly
disabled (FR-017).

**Project Type**: SillyTavern UI extension (single bundle)

**Performance Goals**: 300-file import/export/sync with visible progress and no UI
freeze > 3 s (SC-006); auto-push within ~2 s of an edit (1000 ms debounce).

**Constraints**: never modify/delete files the convention does not own (FR-007); no
silent overwrite on either side (FR-013); interruption-safe (FR-016); no side-channel
writes to native books (spec 003 FR-020); English-only artifacts (IX).

**Scale/Scope**: one link per browser profile; hundreds of entries, nesting depth ~10.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Check | Status |
|-----------|-------|--------|
| I. Holistic, modular | New `core/md` (pure) with explicit exports; adapters `fsaDisk`, `yamlCodec`, `mdLink`, `workspaceActions`; UI components; no entry-point scripts | ✅ |
| II. App API first | YAML via app `libs.yaml`; images via the app's image storage endpoints (`/api/images/upload`, `/api/images/delete` — the same ones the app's `saveBase64AsFile` and Gallery use — the helper itself is not exposed by `getContext()`, so `imageStore.ts` mirrors it); workspace mutations via existing store/tree ops; native WI only via the Phase 1 sync engine. File System Access / IndexedDB / WebCrypto are browser APIs with no app equivalent — isolated in `src/adapters/fsaDisk.ts` | ✅ (browser APIs isolated, justified: the app offers no user-folder access) |
| III. Strict TS | FSA types not in TS `lib.dom` (`showDirectoryPicker`, `queryPermission`, `requestPermission`) declared in `src/global.d.ts`; `libs.yaml` typed as the `YamlCodec` subset | ✅ |
| IV. Lint & format | Unchanged tooling | ✅ |
| V. Test-first | Convention, naming, reconcile are pure and specified by tables → tests first | ✅ |
| VI. Integration testing | Link manager scenarios against `MemoryDiskFolder`; disk port contract suite; `getContext().libs` access covered by adapter test | ✅ |
| VII. Interop hooks | Additive events `wi-workspace:md-synced` (`{ report }`) and `wi-workspace:md-link-changed` (`{ state }`), documented in `AGENTS.md` | ✅ |
| VIII. Proven pattern / speckit | Follows spec → plan → tasks | ✅ |
| IX. Language | English artifacts; conversation in Russian | ✅ |
| Shared style system | Header chip, conflict modal, report modal, mapping reference extend `wiw-theme.scss` primitives (chips, modals, diff rows) | ✅ |

Post-design re-check (after data-model/contracts): no violations; no Complexity Tracking
entries required.

## Project Structure

### Documentation (this feature)

```text
specs/004-markdown-folder-sync/
├── spec.md
├── plan.md              # This file
├── research.md          # R1–R13
├── data-model.md
├── quickstart.md        # S0–S14
├── contracts/
│   ├── markdown-convention.md
│   ├── disk-port.md
│   └── md-ui-contract.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks (not created here)
```

### Source Code (repository root)

```text
src/
├── core/
│   └── md/                      # NEW — pure, framework-free
│       ├── ports.ts             # DiskFolder, DiskFolderAccess, YamlCodec, DiskError types
│       ├── convention.ts        # entry/folder-record render + parse, field mapping table,
│       │                        #   enum names, defaults omission, extras preservation
│       ├── naming.ts            # sanitize, case-insensitive uniqueness, stable paths
│       ├── scan.ts              # walk DiskFolder → ScannedItem[] (ignore rules, decoding,
│       │                        #   progress/yield)
│       ├── reconcile.ts         # three-way decision table → ChangeSet (moves, interrupted
│       │                        #   moves, id rewrites)
│       ├── exportPlan.ts        # workspace subtree → planned files (one-off export)
│       ├── importPlan.ts        # ScannedItem[] → new nodes under a target (fresh ids on clash)
│       ├── imageRefs.ts         # owned image srcs released by a state transition
│       ├── hash.ts              # SHA-256 hex over bytes/text (injected digest for tests)
│       └── report.ts            # OperationReport builder
├── adapters/
│   ├── fsaDisk.ts               # NEW — FsaDiskFolder + fsaAccess (picker, IndexedDB link
│   │                            #   store, permission query/request)
│   ├── yamlCodec.ts             # NEW — YamlCodec over SillyTavern.libs.yaml
│   ├── imageStore.ts            # NEW — app image storage (Gallery, user/images/
│   │                            #   WorldInfoWorkspace/) upload/delete, owned-file cleanup
│   ├── mdExport.ts              # NEW — one-off export run (pre-flight, writes, report)
│   ├── mdImport.ts              # NEW — one-off import run (scan, uploads, apply, roots)
│   ├── mdLink.ts                # NEW — link manager: lifecycle, pull, debounced auto-push,
│   │                            #   held-back detection, apply ChangeSet, events
│   ├── workspaceActions.ts      # NEW — shared "apply tree change + notify sync engine"
│   │                            #   helpers extracted from WorkspaceApp (R10)
│   └── settingsStore.ts         # CHANGED — builds mdLink into services
├── ui/
│   ├── MarkdownControl.tsx      # NEW — header chip/menu per md-ui-contract
│   ├── ConflictDialog.tsx       # NEW — per-item conflict resolution
│   ├── OperationReport.tsx      # NEW — report modal
│   ├── MappingReference.tsx     # NEW — convention tables + sample file
│   ├── ItemEditor.tsx           # CHANGED — image upload stores into app image storage
│   └── WorkspaceApp.tsx         # CHANGED — mounts MarkdownControl; delete confirmation
│                                #   text when linked; uses workspaceActions
├── core/state/schema.ts         # CHANGED — optional NodeBase.md extras type
├── styles/wiw-theme.scss        # CHANGED — chip, diff row, report list primitives
├── global.d.ts                  # CHANGED — FSA types, SillyTavern.libs.yaml typing
└── index.ts                     # CHANGED — pull-on-open wiring via shell open handler

tests/
├── support/memoryDisk.ts        # NEW — in-memory DiskFolder with fault injection
├── unit/md-convention.test.ts   # NEW
├── unit/md-naming.test.ts       # NEW
├── unit/md-reconcile.test.ts    # NEW
├── integration/md-link.test.ts  # NEW
└── contract/disk-port.test.ts   # NEW
```

**Structure Decision**: Single-extension layout from spec 003 extended by one pure
`core/md` module, three adapters, four UI components; no new top-level directories
besides `src/core/md/` and `tests/support/`.

## Delivery Order (for /speckit-tasks)

1. Foundations: ports + types, `global.d.ts` FSA typing, `yamlCodec`, `hash`,
   `MemoryDiskFolder` + disk port contract suite.
2. US1 Export: `convention` (render), `naming`, `exportPlan`, `fsaDisk` (pick + write),
   header menu "Export to folder…", report modal.
3. US2 Import: `convention` (parse), `scan`, `importPlan`, root restoration via Phase 1
   flows, "Import folder…".
4. US3 Link: IndexedDB link store, `reconcile`, `workspaceActions` extraction, `mdLink`
   (initial link, pull, auto-push, held-back, reconnect), conflict + deletion dialogs,
   delete-confirmation disclosure, events.
5. US4: mapping reference modal; report polish.
6. Hardening pass: fault-injection integration, 300-file scale run, quickstart S0–S14,
   `AGENTS.md` update (structure, IndexedDB store, events, md semantics).

## Complexity Tracking

No constitution violations to justify.

## Post-Implementation Record (2026-09-15)

Delivered as planned, plus changes from the owner's validation (tasks T052–T058):

- Extra modules: `src/adapters/mdController.ts` (single UI-facing markdown surface: busy
  state, reports, pending decisions), `src/core/md/linkRender.ts` + `applyPull.ts` (link
  render and pure pull application split out of `reconcile.ts`), `src/core/md/folderViews.ts`
  (import selection: whole folder or chosen top-level items), `src/core/md/filesFolder.ts`
  ("Import files…"), `src/core/md/dataUri.ts`.
- Shared diff: `src/core/assistant/diff.ts` moved to `src/core/diff/lineDiff.ts`; new
  `src/ui/DiffView.tsx` used by the assistant diff modal and the conflict dialog; `.wiw-diff*`
  styles moved into the shared theme.
- Image references in entry content: `src/core/tree/imageLinks.ts` (ids, names with spaces,
  paths, Obsidian `![[…]]`, direct URLs; nearest image wins); demo seed rewrites sample ids
  to name references.
- Overlays of the header control render through a portal into `.wiw-surface` (the header's
  `backdrop-filter` made it the containing block).
- `src/ui/mount.tsx` stops editing events at the workspace container (app-wide jQuery
  delegated handlers were matching selectors on every keystroke).
- `designateRoot(folderId, 'create', proposal)` accepts a proposed book name (import restores
  recorded names).
