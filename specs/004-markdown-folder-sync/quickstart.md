# Quickstart — Markdown Folder Sync validation

Validation guide for spec 004. Contracts: [markdown convention](./contracts/markdown-convention.md),
[disk port](./contracts/disk-port.md), [UI](./contracts/md-ui-contract.md); structures:
[data-model.md](./data-model.md).

## Prerequisites

- Gates green: `pnpm run typecheck && pnpm run lint && pnpm run test && pnpm run build`.
- Local instance `http://127.0.0.1:8634` (secure context via `localhost`), account `dev`,
  desktop Chromium/Chrome.
- A scratch disk folder, e.g. `~/wiw-md-test/` (empty), and a copy of a hand-written
  sample library `~/wiw-md-sample/` containing: nested directories, files with full /
  partial / no front matter, unknown `wi_*` and foreign keys (`tags`, `aliases`), a
  malformed front matter file, a CRLF file, a UTF-8 BOM file, an image referenced by no
  entry, a `.obsidian/` directory, and a PDF.
- Obsidian (or any markdown editor) for S4/S7.
- Automated browser runs: Playwright with
  `page.addInitScript(() => { window.showDirectoryPicker = () => navigator.storage.getDirectory(); })`
  (OPFS stands in for the native picker; research R13).

## Scenarios

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| S0 | Environment gate | Open the workspace in Chromium at `127.0.0.1`; then open it in Firefox (or at `http://<LAN-IP>:8634`) | Chromium: Markdown menu enabled. Firefox / LAN http: control disabled with the explanation text; no errors in console |
| S1 | Export subtree (US1) | Load demo data; add a nested WI root, an entry with every field set, an SVG and a PNG image, two siblings named `A/B` and `a/b`; Export the whole workspace to `~/wiw-md-test/` | Directory tree mirrors the workspace; one `.md` per entry; images as files; `.wiw-folder.yaml` ONLY in directories with non-default info (WI roots, custom order, captions); a default-only entry has no front matter; sanitized unique names with `wi_title`; no ids in files; report lists every file |
| S1b | Plain vault stays untouched (FR-023) | Hash every file of `~/wiw-md-sample/`; Import it, then Link the workspace to a copy of it, Sync twice | All file hashes unchanged; no `.wiw-folder.yaml` created |
| S1c | Image storage (FR-024) | Import a folder with a PNG and an SVG; upload a JPG in the editor; delete the PNG item | PNG/JPG `src` = `user/images/WorldInfoWorkspace/…` (visible in that server folder); SVG stays `data:`; deleting the last PNG reference removes its server file; a duplicated item keeps the file until both are deleted |
| S2 | Export idempotence (SC-005) | Export again to the same folder without changes | Zero files modified (compare mtimes / hashes); report shows 0 updated |
| S3 | Round-trip (SC-001) | Import `~/wiw-md-test/` into an empty workspace (or a new folder) | Structure, names, content, all fields, roots, custom order identical to the source (field-by-field diff script); restored roots are not activated; duplicate ids imported as copies |
| S4 | Hand-written import (US2, SC-002) | Import `~/wiw-md-sample/`; edit nothing; Export to a new folder; diff with the sample | Every md file imported; missing metadata → defaults; malformed file → content = whole file + warning; foreign & unknown keys preserved; `.obsidian/` and PDF ignored and reported; unreferenced image → image item; diff limited to documented normalizations (key order, comments, blank line rule) |
| S5 | Link + auto-push (US3 sc. 2) | Link the workspace to an empty folder; edit an entry's content, rename one, move one, create one, delete one (confirm) | Within ~2 s files are written/renamed/moved/created/removed; no Sync click needed; header chip shows synced |
| S6 | Pull on Sync and on open (US3 sc. 1, 3) | In Obsidian: edit an entry body and a `wi_keys` value, rename a file, move a file to another directory, create a new `.md`; click Sync; repeat one edit and reopen the workspace instead | Workspace reflects all changes (unchanged-content move/rename keep identity — same node id); the new file is imported and left byte-identical on disk; entries under a WI root reach the native book (check in the native editor) |
| S7 | Conflict (US3 sc. 4, 6; SC-004) | Edit the same entry in the workspace AND in Obsidian before syncing (disk first, then workspace) | Auto-write held back (badge count 1); Sync opens the conflict modal with both versions; Skip changes nothing; Keep file / Keep workspace each apply exactly that side |
| S8 | Disk deletion (US3 sc. 5) | Delete a file and a whole directory in the file manager; Sync | Confirmation lists the affected items; Cancel keeps them (files re-written on next push); Confirm deletes them in the workspace (native-copy disclosure shown for synced entries) |
| S9 | Reconnect (FR-017) | Restart the browser (without "allow on every visit"); open the workspace | At most one click (inside the open click or the Reconnect chip) restores access and pulls; edits made meanwhile on another device appear on disk after reconnect |
| S10 | Unavailable folder | Rename the linked folder on disk; open the workspace | "Folder unavailable" chip; Re-link… to the renamed folder reconciles without duplicates or conflicts |
| S11 | Interruption (FR-016) | Automated: fault injection on the N-th write in `MemoryDiskFolder` for every N of a 50-item sync; live: close the tab during a large first export | Next Sync completes the operation; no duplicate items, no lost edits, no stray `*.crswap` treated as content |
| S12 | Scale (SC-006) | Generate 300 entries in nested folders; link, then Sync after editing 50 files on disk | Progress visible; UI never frozen > 3 s; results correct |
| S13 | Mapping reference (US4, SC-007) | Open Mapping reference; hand-write one entry file using only it; Sync | Every documented key lands in the right field; the operation report lists the file |
| S14 | Obsidian readability (SC-003) | Open `~/wiw-md-test/` as an Obsidian vault | No errors; properties panel shows `wi_*` keys and preserved foreign keys; images render; no `.wiw-folder.yaml` clutter in the file list |

## Automated suites (must be green)

- `tests/unit/md-convention.test.ts`, `md-naming.test.ts`, `md-reconcile.test.ts`
- `tests/integration/md-link.test.ts` (scripted two-sided sessions, idempotence, fault
  injection)
- `tests/contract/disk-port.test.ts` (port guarantees against `MemoryDiskFolder`)

## Validation run — 2026-09-14 (implementation close)

Gates: typecheck and lint clean; 34 test files / 260 tests green (unit: convention,
naming, export/import plans, scan, reconcile, image refs, image store, reference;
integration: export runner, import runner, link manager incl. conflicts, deletions,
reconnect, restart, plain vault, fault injection at every write, 300-entry scale run;
contract: disk port, YAML codec, `wi-workspace:md-*` hooks); production build OK
(`yaml` not bundled).

Live run on `http://127.0.0.1:8634` (account `dev`, headless Chromium, OPFS substituted
for the picker): 13/13 automated checks passed — S0 (control enabled), S1 (70 files
exported, no ids), S2 (repeat export changes nothing), S4 + S1b (plain vault imported,
`wi_keys` mapped, foreign `tags` preserved, source files byte-identical), S5 (link wrote
72 files, status chip), S6 (disk edit pulled on Sync), SC-005 (repeated sync leaves files
identical), no plugin console errors. Side effect on the `dev` account: an imported
`vault` folder and one entry body edited by the S6 check.

Found and fixed during implementation (each now covered by a test): URL-only images
missing from `wi_order`; items arriving from disk appended at the end of folders without
a custom order (would have invented a `.wiw-folder.yaml` in plain vaults); exact user
file names with characters the sanitizer replaces would have been renamed after linking.

Pending owner checks (manual by nature): S9 (browser restart and the permission prompt
in a real Chrome profile), S14 (open an exported folder as an Obsidian vault), S1c
(image upload into `user/images/WorldInfoWorkspace/` through the real server), S7/S8
through the real UI dialogs.

## Owner validation — 2026-09-15

Owner tested in the real Chromium with real disk folders: export (e.g. into
`/tmp/vscode-typescript1000/123/`), import, linked folder with Obsidian-style edits, and
conflict resolution — all working as intended. Findings fixed in tasks T052–T058: header
overlays clipped by the header, import shape (now whole folder or chosen top-level items,
plus "Import files…"), typing cost from app-wide jQuery handlers, weak choice highlighting,
shared diff in the conflict dialog, and image references in content (Bristlemark preview).
Gates at close: typecheck and lint clean, 36 test files / 272 tests green, production
build OK. The spec is closed by the owner.
