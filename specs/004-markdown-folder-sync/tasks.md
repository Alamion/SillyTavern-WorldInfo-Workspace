---
description: "Task list for Markdown Folder Sync — roadmap Phase 3 (004-markdown-folder-sync)"
---

# Tasks: Markdown Folder Sync (Roadmap Phase 3)

**Input**: Design documents from `/specs/004-markdown-folder-sync/` (plan.md, spec.md,
research.md, data-model.md, contracts/, quickstart.md)

**Prerequisites**: all listed documents are present in `specs/004-markdown-folder-sync/`.

**Tests**: INCLUDED — constitution V (test-first for pure core logic) and VI
(integration + contract tests) mandate them; research.md R13 enumerates the suites.
Every test task precedes its implementation task and must fail first (red → green).

**Organization**: Grouped by user story — US1 Export (P1), US2 Import incl. app image
storage (P1), US3 Linked sync (P2), US4 Mapping reference & reports (P3).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1–US4)
- All paths are project-relative; single-project layout per plan.md

## Path Conventions

- `src/core/md/**` — pure logic, no app/browser-global imports (ports injected)
- `src/adapters/**` — app and browser boundary (FSA, IndexedDB, endpoints, `libs.yaml`)
- `src/ui/**` — React components; styles only via `src/styles/wiw-theme.scss`
- `tests/unit|integration|contract/**`, shared fakes in `tests/support/**`

## Key rules for every task (from spec clarifications and research)

- **Minimal metadata (FR-023)**: never write ids into files; never write a key equal to
  its default; write `.wiw-folder.yaml` only when the folder has non-default info;
  importing/linking never modifies a file by itself.
- **Identity (FR-003, R7)**: match optional `wi_id` → path → unique content hash (moves)
  → folder moves; leftovers are confirmed deletions / creations.
- **Images (FR-024, R6)**: imported and editor-uploaded images go to the app image
  storage `user/images/WorldInfoWorkspace/` via `/api/images/upload`; formats outside
  `bmp png jpg jpeg jfif gif webp` stay `data:` URIs; owned files are deleted when the
  last referencing item goes.
- UI text English; styles extend the shared system (constitution IX, amendment 1.2.0).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Types, test dependency, and test fakes the whole feature relies on

- [X] T001 Add devDependency `yaml@^2` (tests only — never imported from `src/`) in `package.json` via `pnpm add -D yaml@^2`; confirm webpack does not bundle it (only `tests/**` import it)
- [X] T002 [P] Extend `src/global.d.ts`: File System Access types missing from TS `lib.dom` (`Window.showDirectoryPicker(options?: { id?: string; mode?: 'read' | 'readwrite'; startIn?: ... })`, `FileSystemHandle.queryPermission/requestPermission({ mode })` returning `Promise<PermissionState>`, `FileSystemDirectoryHandle.entries()/values()` async iterators if absent); typed `SillyTavern.libs.yaml` subset `{ parse(text: string): unknown; stringify(value: unknown, options?: { lineWidth?: number }): string }` on the global `SillyTavern` object (research R1, R3)
- [X] T003 [P] Create `src/core/md/ports.ts` exactly per `contracts/disk-port.md`: `RelPath`, `DiskEntryInfo`, `DiskFolder`, `AccessState`, `DiskFolderAccess`, `DiskError` class with `code: 'not-found' | 'permission' | 'io' | 'invalid-path'` and `path`, `assertRelPath(path)` (rejects `..`, leading `/`, empty segments, backslashes); plus `YamlCodec` (`parse`, `stringify`), `Digest` (`(bytes: Uint8Array) => Promise<string>` hex), and `ImageStorePort` (`upload(input: { bytes: Uint8Array; ext: string; stem: string }): Promise<string>` returning the stored `src`, `remove(src: string): Promise<void>`, `isOwned(src: string): boolean`, `accepts(ext: string): boolean`)
- [X] T004 [P] Create `tests/support/memoryDisk.ts`: `MemoryDiskFolder implements DiskFolder` (Map of path → bytes plus directory set, implicit parent creation on write, recursive remove, `list()` with `/` paths), fault injection `failOnWrite(n: number, code)` / `failOnRemove(n)`, `snapshot()` returning `{ path → sha256 }` for idempotence assertions; `nodeDigest` using `node:crypto` SHA-256; `nodeYaml` wrapping the `yaml` package as `YamlCodec`; `MemoryImageStore implements ImageStorePort` recording uploads/removals

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Port contract, hashing, YAML adapter, naming, convention core, report
model, header control shell — blocks ALL user stories

**⚠ CRITICAL**: No user story work can begin until this phase is complete

- [X] T005 [P] Write failing contract suite `tests/contract/disk-port.test.ts` as an exported `runDiskPortSuite(factory)` applied to `MemoryDiskFolder`: the six guarantees of `contracts/disk-port.md` (byte round-trip; failed write keeps previous content; parent directory creation; recursive remove + missing-path no-op; `list` completeness and `/` separators; invalid paths throw `DiskError('invalid-path')`)
- [X] T006 [P] Write failing unit tests `tests/unit/md-naming.test.ts` per research R5: illegal characters `< > : " / \ | ? *` and control chars → `_`; trailing dots/spaces trimmed; Windows reserved names (`CON`, `com1`, …) suffixed `_`; 120-unit cap; empty → `Untitled`; case-insensitive + NFC sibling collisions → ` (2)`, ` (3)`; Cyrillic names kept readable; stability: `assignPaths(tree, previousPaths)` keeps an existing path while its sanitized stem still matches (ignoring suffix) so a second run returns identical paths; default child order = folders first then case-insensitive name
- [X] T007 [P] Write failing unit tests `tests/unit/md-convention.test.ts` per `contracts/markdown-convention.md`: (a) `renderEntryFile` writes NO front matter for an all-default entry whose name equals the file stem, (b) every mapped field round-trips `render → parse` for non-default values incl. enum names (`at_depth`, `assistant`, `not_all`), numbers accepted for enums on parse, nullable fields, `wi_character_filter`, `wi_triggers`, `wi_extensions`, unknown native fields via `wi_native`, (c) `wi_title` only when name ≠ stem, (d) body blank-line rule: content starting with `\n`, empty content, CRLF body preserved exactly, (e) foreign keys (`tags`, `aliases`) preserved in original order after owned keys; unknown `wi_*` keys preserved + warning, (f) malformed YAML → whole file text as content + warning + `rawOnParseError`, (g) no front matter → defaults + body = whole file, BOM stripped, (h) `wi_id` is parsed as a hint and NEVER rendered, (i) `renderFolderRecord` returns `null` for all-default folders, includes only non-default `wi_title`/`wi_root`/`wi_book`/`wi_order`/`wi_images` entries and preserved foreign keys, (j) invalid values (e.g. `wi_probability: 250`, `wi_position: sideways`) are kept as given, not coerced
- [X] T008 Implement `src/core/md/hash.ts`: `sha256Hex(bytes, digest: Digest)`, `textBytes(text)` (UTF-8 `TextEncoder`), `decodeText(bytes)` (UTF-8 `fatal: true`, BOM stripped; throws `DiskError('io')`-free typed `DecodeError` on invalid UTF-8)
- [X] T009 Implement `src/core/md/naming.ts` to pass T006: `sanitizeStem`, `uniqueSiblingNames`, `assignPaths(root: FolderNode, previous: Map<nodeId, RelPath>, scopeRootId?)` → `Map<nodeId, RelPath>` (entries `.md`, images by MIME/extension, folders as directories; URL-only images get no path), `defaultChildOrder(children)`
- [X] T010 Implement `src/core/md/convention.ts` to pass T007: field mapping table (single source reused by the mapping reference UI) with key, native field, type, default (`createDefaultNativeEntry`), enum name maps from `world_info_position` / `world_info_logic` / `extension_prompt_roles` values; `renderEntryFile(entry, fileStem, yaml)`, `parseEntryFile(text, fileStem, yaml)` → `EntryFileModel`, `renderFolderRecord(folder, childPaths, yaml)` → `string | null`, `parseFolderRecord(text, yaml)` → `FolderRecordModel`; front matter delimiter rules (`---` / `...`), no id rendering, extras via `NodeBase.md`
- [X] T011 [P] Add optional `md?: { foreign?: Record<string, unknown>; unknownOwned?: Record<string, unknown>; nativeExtra?: Record<string, unknown>; rawOnParseError?: boolean }` to `NodeBase` in `src/core/state/schema.ts` (schema stays v1; `migrate` already preserves unknown keys) and add a case to `tests/unit/state-schema.test.ts` proving a payload with `md` extras loads without recovery
- [X] T012 [P] Implement `src/adapters/yamlCodec.ts`: `createYamlCodec()` returning `YamlCodec` over `globalThis.SillyTavern.libs.yaml` (`stringify` with `lineWidth: 0` to avoid folding); throws a clear error when `libs.yaml` is missing; add a jsdom case in `tests/contract/native-wi.test.ts` style verifying it calls the app library
- [X] T013 [P] Implement `src/core/md/report.ts`: `OperationReport` / `ReportLine` types per `data-model.md`, `createReportBuilder(operation)` with `add(path, outcome, message?)`, counters derived from outcomes (`created updated moved deleted skipped preserved conflict warning`), `finish()`
- [X] T014 Implement `src/adapters/fsaDisk.ts` (production port, research R1/R2/R8): `FsaDiskFolder implements DiskFolder` over a `FileSystemDirectoryHandle` (path walking with `getDirectoryHandle({ create })`, writes via `createWritable()` + `write` + `close()` and `abort()` on error, `removeEntry(name, { recursive: true })`, `list()` via async iteration, maps `NotFoundError`/`NotAllowedError`/others to `DiskError` codes); `fsaAccess implements DiskFolderAccess`: `isSupported()` = `isSecureContext && typeof window.showDirectoryPicker === 'function'`, `pick(mode)` with picker `id: 'wiw-md'` (AbortError → `null`), IndexedDB store (`WorldInfoWorkspace-md` / `links` / key `default`) for `loadLink/saveLink/clearLink`, `queryAccess/requestAccess` mapping to `AccessState` (`unavailable` when the handle throws)
- [X] T015 [P] Add shared style primitives to `src/styles/wiw-theme.scss`: status chip (neutral / warning / busy with spinner / badge count), report list rows with outcome icons, two-column diff rows, reference tables — all colors from `--SmartTheme*` variables; no component-local styles
- [X] T016 [P] Implement `src/ui/OperationReport.tsx`: modal over the existing modal primitive showing counters and a collapsible per-file list (`contracts/md-ui-contract.md` "Operation report"); props `{ report, onClose }`
- [X] T017 Implement `src/ui/MarkdownControl.tsx` shell and mount it in the header of `src/ui/WorkspaceApp.tsx`: unsupported state (disabled `fa-folder-tree` button + info popup text from `contracts/md-ui-contract.md`) vs. supported menu with placeholders wired later (Export to folder…, Import folder…, Link folder…, Mapping reference); receives `DiskFolderAccess` and a `showReport(report)` callback; add `mdAccess` (fsaAccess) to services in `src/adapters/settingsStore.ts`

**Checkpoint**: Port suite, naming, and convention tests green; the header shows the
Markdown control (enabled in Chromium on localhost, disabled with explanation elsewhere)

---

## Phase 3: User Story 1 — Export the Lore Tree to a Markdown Folder (Priority: P1) 🎯 MVP

**Goal**: Export the whole workspace or any folder subtree into a picked folder following
the convention, with a report (spec US1, FR-001..FR-007, FR-019).

**Independent Test**: quickstart S1 (structure, minimal metadata, names, images, report)
and S2 (a second export changes zero files).

### Tests for User Story 1

- [X] T018 [P] [US1] Write failing unit tests `tests/unit/md-export-plan.test.ts`: `planExport(state, scopeFolderId, existingDisk: Map<path, hash>)` on the demo dataset with a nested WI root, custom order, two siblings colliding case-insensitively, a data-URI PNG, an SVG data URI, a same-origin `user/images/...` image and an external URL image → expected file list (paths, texts, `.wiw-folder.yaml` only where non-default, URL-only image recorded as `wi_src` in the record, no ids anywhere); unchanged files already on disk produce `skip` items (SC-005); overwrites of files not in the plan's previous output are flagged `overwrite-foreign`
- [X] T019 [P] [US1] Write failing integration test `tests/integration/md-export.test.ts`: `runExport` (T021) against `MemoryDiskFolder` — export writes every planned file, a second export writes zero bytes (snapshot equal, report `updated: 0`), a pre-existing unrelated file (`.obsidian/app.json`, `notes.pdf`) is untouched, image fetch failure yields a warning and a `wi_src` record entry, an injected write failure reports `io` for that file and the rest still completes

### Implementation for User Story 1

- [X] T020 [US1] Implement `src/core/md/exportPlan.ts` to pass T018: walk the scope subtree, use `assignPaths` and `convention.render*`, image bytes resolution via an injected `resolveImage(src) => Promise<{ bytes, ext } | null>`, compare rendered bytes' hash with `existingDisk` to emit `write | skip | overwrite-foreign` items; folder records only when `renderFolderRecord` ≠ `null`
- [X] T021 [US1] Implement `runExport({ folder, state, scopeFolderId, digest, yaml, resolveImage, onProgress })` in `src/adapters/mdExport.ts`: list + hash existing target files, build plan, return a pre-flight summary (counts + `overwrite-foreign` list) for confirmation, then write sequentially yielding every 25 files, building an `OperationReport`; `resolveImage` implementation: `data:` URI decode (MIME → extension), otherwise same-origin `fetch(src)` with failure → `null`
- [X] T022 [US1] Wire "Export to folder…" in `src/ui/MarkdownControl.tsx` and a tree folder context-menu action "Export folder to markdown…" in `src/ui/StructureTree.tsx`: `pick('readwrite')` inside the click handler → pre-flight → confirmation popup (FR-007 text from `contracts/md-ui-contract.md`, shown only when foreign files would be overwritten or the target is non-empty) → run with busy chip progress → `OperationReport` modal; errors via `src/adapters/logger.ts`

**Checkpoint**: US1 works standalone — exported folders open in Obsidian (quickstart S14)

---

## Phase 4: User Story 2 — Import a Markdown Folder into the Workspace (Priority: P1)

**Goal**: Import any markdown folder (hand-written vaults included) into a chosen
workspace folder, with minimal-metadata defaults, preserved extras, and images stored in
the app image storage (spec US2, FR-005, FR-008, FR-009, FR-023, FR-024).

**Independent Test**: quickstart S1b (plain vault untouched), S1c (image storage), S3
(round-trip), S4 (hand-written library).

### Tests for User Story 2

- [X] T023 [P] [US2] Write failing unit tests `tests/unit/md-scan.test.ts`: `scanFolder(folder, digest, yaml)` on a `MemoryDiskFolder` sample — ignores dot-entries except `.wiw-folder.yaml`, `*.crswap`, non-md/non-image files (reported as `skipped`); directories without records become folders with defaults; invalid UTF-8 file → `skipped` + unreadable warning; BOM/CRLF handled; progress callback called; returns `ScannedItem[]` with `diskHash`, `parentPath`, parsed models; the scan never writes (snapshot unchanged)
- [X] T024 [P] [US2] Write failing unit tests `tests/unit/md-import-plan.test.ts`: `planImport(scan, state, targetFolderId, newId)` → new subtree nodes under the target: names from `wi_title` or stem, custom order from `wi_order` else default order, entries with parsed native fields and `md` extras, images as pending uploads, WI root designations returned as `rootRequests` (not applied directly), fresh ids (an unused `wi_id` hint is honored, a taken one ignored + warning); export (T020) → import → compare equals the source subtree except ids (SC-001)
- [X] T025 [P] [US2] Write failing unit tests `tests/unit/image-store.test.ts` for `src/adapters/imageStore.ts` with mocked `fetch` and `getRequestHeaders`: `accepts` true only for `bmp png jpg jpeg jfif gif webp`; `upload` posts `{ image: base64, format, ch_name: 'WorldInfoWorkspace', filename: '<stem>-<6 random chars>' }` to `/api/images/upload` and returns the `path` (normalized without a leading slash); `isOwned` only for `user/images/WorldInfoWorkspace/…`; `remove` posts `{ path }` to `/api/images/delete` and treats 404 as success; non-owned `src` is never deleted
- [X] T026 [P] [US2] Write failing unit tests `tests/unit/image-refs.test.ts` for `src/core/md/imageRefs.ts`: `ownedSrcsReleasedBy(stateBefore, stateAfter, isOwned)` returns owned `src` values referenced before and by no item after (delete, source replacement, bulk delete); a duplicated item keeps the file until its last reference goes

### Implementation for User Story 2

- [X] T027 [US2] Implement `src/core/md/scan.ts` to pass T023 (sequential walk, yield every 25 files via an injected `yieldNow`, uses `convention.parse*` and `hash.decodeText`)
- [X] T028 [US2] Implement `src/core/md/importPlan.ts` to pass T024 (pure; images carried as `{ nodeId, bytes, ext, stem }` upload requests; oversize > 1 MiB warning only for images that must stay `data:` URIs)
- [X] T029 [P] [US2] Implement `src/adapters/imageStore.ts` to pass T025 (`ImageStorePort` over `ctx.getRequestHeaders()`; base64 encoding of bytes in chunks to avoid call-stack limits; header comment citing app `saveBase64AsFile` in `public/scripts/utils.js` and constitution II justification)
- [X] T030 [P] [US2] Implement `src/core/md/imageRefs.ts` to pass T026
- [X] T031 [US2] Wire owned-image cleanup: in `src/adapters/settingsStore.ts` subscribe to store transitions and call `imageStore.remove` for `ownedSrcsReleasedBy(prev, next)` (fire-and-forget with `logger` warning on failure; never blocks edits)
- [X] T032 [US2] Change image upload in `src/ui/ItemEditor.tsx`: files whose extension `imageStore.accepts` are uploaded and `src` set to the stored path (busy state on the control, failure → toast + keep previous `src`); other formats (SVG, AVIF) keep the Phase 1 `FileReader` data-URI path; URL and inline SVG modes unchanged
- [X] T033 [US2] Implement `runImport({ folder, state, targetFolderId, ... })` in `src/adapters/mdImport.ts`: scan → plan → upload images through `imageStore` (failure → keep `data:` URI + warning) → apply all nodes in ONE `store.replace` → apply `rootRequests` through the existing designation flow of the sync engine (`matchBookForAdopt` → adopt-or-create, collision-resolved naming, never activated) → `OperationReport`; nothing is written to the source folder
- [X] T034 [US2] Wire "Import folder…" in `src/ui/MarkdownControl.tsx`: `pick('read')` → target = folder next to the current tree selection (same rule as the Phase 1 lorebook import) → run with progress → report modal; imported entries with rule-violating values show the existing validation markers (spec FR-009)

**Checkpoint**: US1 + US2 give a complete manual round-trip (quickstart S1–S4, S1b, S1c)

---

## Phase 5: User Story 3 — Keep a Linked Folder in Sync (Priority: P2)

**Goal**: One whole-workspace link with hybrid sync — auto-push on save, pull on Sync and
on open, three-way conflicts, confirmed deletions, move detection without ids, reconnect
flow (spec US3, FR-010..FR-016, FR-020, FR-021).

**Independent Test**: quickstart S5–S11.

### Tests for User Story 3

- [X] T035 [P] [US3] Write failing unit tests `tests/unit/md-reconcile.test.ts` for `reconcile({ workspace, scan, baseline, renderedPaths })` → `ChangeSet`: every row of the research R7 decision table (entry, image, folder record); matching order `wi_id` → path → unique content move → folder move; ambiguous content matches fall back to delete + create; rename+edit on disk → pending deletion + creation; interrupted workspace move (both paths byte-identical, render maps to new path) → remove old path; both sides changed to identical canonical text → auto-resolved, not a conflict; initial link without baseline (R9): equal → in-sync baseline, different → conflict, one-sided → create on the other side; plain vault link produces zero `toDisk` writes for unchanged default-only items (FR-023)
- [X] T036 [P] [US3] Write failing integration tests `tests/integration/md-link.test.ts` driving `createMdLink` (T039) with `MemoryDiskFolder`, real `WorkspaceStore`, fake access (`queryAccess` scripted), fake timers and a sync-engine stub recording `refreshStructure` / `recordEntityDeletions` / `markBooksDirty`: (1) link empty folder → full write; (2) workspace edit/rename/move/create/delete → files after debounce (1000 ms), no pull needed; (3) disk edit/rename/move/new file → applied on `syncNow()` and on `onWorkspaceOpened()`, identity preserved, native hooks called for entries under a root; (4) disk changed then workspace edit → write held back, `status.heldBack === 1`, conflict at next sync, `skip` leaves both sides, `keep-disk`/`keep-workspace` apply exactly one side (SC-004); (5) disk deletions wait for `confirmDeletions` and cancel re-writes files on next push; (6) repeated sync with no changes → zero writes, zero store updates (SC-005); (7) fault injection on every N-th write of a 50-item sync, then `syncNow()` → final disk and workspace equal the no-fault run (FR-016); (8) access `prompt` → no writes, `needs-reconnect`, `reconnect()` grants and pulls; (9) plain vault link + two syncs → disk snapshot unchanged (FR-023)

### Implementation for User Story 3

- [X] T037 [US3] Implement `src/core/md/reconcile.ts` to pass T035 (pure; consumes `ScannedItem[]`, workspace render map `{ nodeId → { path, text|bytesHash, kind } }`, baseline; emits `ChangeSet` per `data-model.md` incl. `matches` and `warnings`)
- [X] T038 [US3] Extract the post-edit sync-engine choreography from `src/ui/WorkspaceApp.tsx` (the `refreshStructure` / `recordEntityDeletions` / `markBooksDirty` calls around move, delete, bulk delete, root toggles) into `src/adapters/workspaceActions.ts` (`applyTreeChange(services, nextState, effects)`), switch `WorkspaceApp.tsx` to it with no behavior change, and keep `tests/integration/sync-engine.test.ts` green
- [X] T039 [US3] Implement `src/adapters/mdLink.ts` to pass T036: `createMdLink({ store, sync, access, digest, yaml, imageStore, workspaceActions, clock })` exposing `status` (`none | reconciling | linked | needs-reconnect | unavailable | busy` + `folderName`, `lastSyncAt`, `heldBack`, `conflicts`, `progress`), `subscribe`, `link()`, `relink()`, `unlink()`, `syncNow()`, `onWorkspaceOpened({ userActivation })`, `reconnect()`, `resolveConflicts(decisions)`, `confirmDeletions(ids | null)`; pull = scan → reconcile → await UI decisions → one `store.replace` via `workspaceActions` → disk writes (new path before old-path removal) → baseline saved to IndexedDB after every written batch; auto-push = store subscription + 1000 ms debounce + re-read target hash before each write (held-back on mismatch); root restorations through the same designation flow as T033; emits `wi-workspace:md-synced` `{ report }` and `wi-workspace:md-link-changed` `{ state }` via `ctx.eventSource`
- [X] T040 [US3] Wire pull-on-open in `src/adapters/shell.ts` / `src/index.ts`: the native "Workspace" button click handler calls `mdLink.onWorkspaceOpened({ userActivation: true })` synchronously before any `await`, so `requestAccess` runs within transient activation (research R2); panel re-open without a click passes `false`
- [X] T041 [P] [US3] Implement `src/ui/ConflictDialog.tsx` per `contracts/md-ui-contract.md`: row per conflict (path, kind, side states), expandable field diff (front matter keys) + body text diff using the shared diff-row primitive, per-row Keep workspace / Keep file / Skip, bulk actions, Apply returns decisions
- [X] T042 [US3] Complete `src/ui/MarkdownControl.tsx` link states: chip with folder name + relative last-sync time + held-back/conflict badge, Sync now, Link folder… (non-empty folder confirmation with counts), Reconnect, Re-link…, Unlink (confirmation: files and workspace stay), busy progress; opens `ConflictDialog` and the disk-deletion confirmation (lists items; appends the spec 003 FR-021 native-copy disclosure for synced entries) when `mdLink` requests decisions
- [X] T043 [US3] Extend the delete confirmations in `src/ui/WorkspaceApp.tsx` (single and bulk) with "Its file(s) in the linked folder will be removed." when `mdLink.status` is linked and the items have baseline paths

**Checkpoint**: Two-hub workflow with Obsidian works end-to-end (quickstart S5–S11)

---

## Phase 6: User Story 4 — See and Trust the Mapping (Priority: P3)

**Goal**: In-workspace mapping reference and always-available last report (spec US4,
FR-018, FR-019).

**Independent Test**: quickstart S13 (hand-author a file from the reference alone).

- [X] T044 [P] [US4] Write failing unit test `tests/unit/md-reference.test.ts`: the reference model built from `convention.ts` lists every key of `contracts/markdown-convention.md` (entry table + folder record table) with type and default, and the sample entry file it produces parses back into the documented non-default values
- [X] T045 [US4] Implement `src/ui/MappingReference.tsx`: modal rendering the reference model (entry keys, folder record keys, scanner rules, naming rules, minimal-metadata note, image storage note) and a copyable sample entry; wire "Mapping reference" menu item in `src/ui/MarkdownControl.tsx`
- [X] T046 [US4] Keep the last `OperationReport` in `mdLink`/control state and add a "Last report" menu item and chip click target in `src/ui/MarkdownControl.tsx`; reports from import/export/sync/link all flow into it

**Checkpoint**: All user stories independently functional

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Scale, live validation, documentation

- [X] T047 [P] Add a 300-file scale case to `tests/integration/md-link.test.ts` (generated nested tree; link + edit 50 files on disk + sync) asserting correctness and that progress callbacks fire at least every 25 files (SC-006)
- [X] T048 [P] Add hooks `wi-workspace:md-synced` and `wi-workspace:md-link-changed` with payload types to the contract tests in `tests/contract/native-wi.test.ts` (or a new `tests/contract/hooks.test.ts`) per constitution VI/VII
- [X] T049 Update `AGENTS.md`: current increment → spec 004; project structure (`src/core/md/`, new adapters/UI, `tests/support/`); link storage (IndexedDB `WorldInfoWorkspace-md`, per browser profile); markdown semantics summary (minimal metadata, identity matching, hybrid sync, held-back writes); image storage (`user/images/WorldInfoWorkspace/`, owned-file cleanup); new hooks; browser requirement (desktop Chromium + secure page) and the Playwright OPFS picker substitution
- [X] T050 Run gates `pnpm run typecheck && pnpm run lint && pnpm run test && pnpm run build`, fix until green, rebuild `dist/index.js`
- [X] T051 Live validation per `specs/004-markdown-folder-sync/quickstart.md` S0–S14 on `http://127.0.0.1:8634` (account `dev`): automated scenarios via Playwright with `page.addInitScript(() => { window.showDirectoryPicker = () => navigator.storage.getDirectory(); })`; manual S9 (browser restart / permission), S14 (Obsidian); record results and any fixes in a "Validation run" section of `quickstart.md`, turning every live discrepancy into a regression test first (constitution V)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies; T002–T004 parallel after T001
- **Foundational (Phase 2)**: depends on Setup; blocks all stories
  - T005, T006, T007 (tests) parallel → T008 → T009 (after T006) and T010 (after T007, T008)
  - T011, T012, T013, T015, T016 parallel; T014 after T003; T017 after T014, T016
- **US1 (Phase 3)**: after Foundational
- **US2 (Phase 4)**: after Foundational; reuses US1's `exportPlan` only in the T024
  round-trip test (implement US1 first or mark that single case pending)
- **US3 (Phase 5)**: after US1 and US2 (uses render/paths from US1 and scan/import/image
  store from US2)
- **US4 (Phase 6)**: after Foundational (reference) — T046 after T039
- **Polish (Phase 7)**: after the stories in scope

### Within Each User Story

- Tests first and failing → pure core → adapters → UI wiring
- US3: T038 (extraction, no behavior change) before T039

### Parallel Opportunities

- Phase 1: T002, T003, T004
- Phase 2: T005, T006, T007, T011, T012, T013, T015, T016
- US1: T018, T019
- US2: T023, T024, T025, T026, then T029, T030 alongside T027/T028
- US3: T035, T036, then T041 alongside T037
- Polish: T047, T048

---

## Parallel Example: User Story 2

```bash
# Tests together (all different files):
Task: "T023 [US2] tests/unit/md-scan.test.ts"
Task: "T024 [US2] tests/unit/md-import-plan.test.ts"
Task: "T025 [US2] tests/unit/image-store.test.ts"
Task: "T026 [US2] tests/unit/image-refs.test.ts"

# Then independent implementations:
Task: "T029 [US2] src/adapters/imageStore.ts"
Task: "T030 [US2] src/core/md/imageRefs.ts"
Task: "T027 [US2] src/core/md/scan.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 Setup → Phase 2 Foundational
2. Phase 3 US1 Export → validate quickstart S1, S2, S14 → usable backup / Obsidian reading

### Incremental Delivery

1. + US2 Import (with app image storage) → manual round-trip, adopt existing vaults
2. + US3 Linked sync → the "second hub" goal
3. + US4 Mapping reference → hand-authoring support
4. Polish → scale run, hooks, AGENTS.md, live validation

### Notes

- Commit after each task or tight logical group; all four gates must pass before a commit
- Never write ids or default-valued keys into files; never touch foreign files
- Every live discrepancy found in validation becomes a failing test before the fix

---

## Phase 8: Owner Validation Follow-ups (2026-09-15)

**Purpose**: Fixes and adjustments from the owner's hands-on testing

- [X] T052 Render MarkdownControl dropdown and overlays through a portal into `.wiw-surface` (header `backdrop-filter` squeezed them) and stop the mapping-reference tables from collapsing (`flex-shrink: 0`) in `src/ui/MarkdownControl.tsx`, `src/styles/wiw-theme.scss`
- [X] T053 Import selection: picked folder imported as one folder, or chosen top-level folders/files each as their own item (`src/core/md/folderViews.ts`, `ImportSelectDialog` in `src/ui/MarkdownControl.tsx`, `src/adapters/mdController.ts`; tests `tests/unit/md-folder-views.test.ts`)
- [X] T054 "Import files (.md, images)…" via `showOpenFilePicker` (`pickFiles` port, `src/core/md/filesFolder.ts`, `src/adapters/fsaDisk.ts`; test in `tests/integration/md-import.test.ts`)
- [X] T055 Typing performance: stop editing events at the workspace container in `src/ui/mount.tsx`; skip unchanged auto-pushes and memoize entry renders in `src/adapters/mdLink.ts`, `src/core/md/linkRender.ts`
- [X] T056 Conflict dialog: accent-colored selected option, rows collapsed by default, no redundant decision badge (`src/ui/ConflictDialog.tsx`, `src/styles/wiw-theme.scss`)
- [X] T057 Shared diff: move `src/core/assistant/diff.ts` → `src/core/diff/lineDiff.ts`, add `src/ui/DiffView.tsx`, use it in `src/ui/AssistantPanel.tsx` and `src/ui/ConflictDialog.tsx`, move `.wiw-diff*` styles into `src/styles/wiw-theme.scss`
- [X] T058 Image references in entry content: `src/core/tree/imageLinks.ts` resolver (ids, names with spaces, paths, `![[…]]`, URLs), preview syntax in `src/core/preview.ts`, demo seed rewrites sample ids in `src/core/demo/dataset.ts` (tests `tests/unit/image-links.test.ts`)
