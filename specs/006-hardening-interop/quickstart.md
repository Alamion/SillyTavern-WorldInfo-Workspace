# Quickstart: Hardening & Interop (Phase 4)

Validation guide for the phase gate. Scenarios H0–H26 map to the spec's success criteria.
Implementation detail belongs in `tasks.md`, not here.

## Prerequisites

- Local instance `http://127.0.0.1:8634`, `dev` account (safe to modify)
- Production build: `pnpm run build` (never watch mode — source maps distort timings)
- System Chromium via `playwright-cli` for scripted runs
- All four gates green: `pnpm run typecheck && pnpm run lint && pnpm run test && pnpm run build`

## Setup

```bash
pnpm install
pnpm run test          # full suite incl. new tests/perf budgets
pnpm run build
```

Load the scale dataset into the `dev` account's workspace (seeded generator, see
`contracts/performance-budgets.md`): ~2000 nodes, one 1000-entry World Info root book, a
second smaller book, nesting depth ~5.

---

## A. Performance at scale (SC-001, SC-002, SC-004)

| # | Scenario | Expected |
|---|---|---|
| H0 | Run `tests/perf` against the generated dataset | All budgets P-1…P-9 pass; each reports its pre-fix baseline so the improvement is evidenced |
| H1 | Expand, then collapse, the 1000-entry folder | No perceptible freeze; surrounding scroll position preserved (US1 #1) |
| H2 | Select single rows, then a 50-row multi-selection | Selection is immediate; selecting one row does not visibly re-render the whole tree |
| H3 | Type a known 200-character string at speed into an entry's content, with native sync and markdown auto-push both active | Committed text matches the sent text **exactly** — 0 dropped or re-ordered characters; caret and focus never leave the field (US1 #2, L-3, L-4) |
| H4 | Drag a subtree across the large folder | Drag feedback tracks the pointer without whole-tree re-renders per frame |
| H5 | Search and filter in the Lorebooks panel | Results appear without perceptible delay (US1 #3) |
| H6 | Trigger a push of the 1000-entry book | UI stays interactive throughout; no long task > 200 ms (L-2) |
| H7 | Run a 5-minute scripted editing session with background saves, pushes and markdown auto-pushes throughout | 0 dropped keystrokes, 0 focus losses (SC-002) |
| H8 | Pull a large linked markdown folder on workspace show | Progress reported; work can continue or be cancelled (US1 #5, FR-003, L-5) |
| H9 | Compare sync/import/export/markdown round-trip output at 1000 entries vs the equivalent small fixture | Byte-identical after normalization — 0 differences attributable to scale (SC-004) |
| H10 | Repeat H1–H6 at roughly double the target size | Degrades gracefully: slower, but no corruption, no lost edits, no hang without escape |
| H11 | Close the workspace on the scale dataset, then use the host app normally (chat, character switch, native panels) | Host responsiveness is unaffected; large working data (indexes, memo caches, rendered state) is released (FR-005) |

## B. Correctness at scale (SC-003)

| # | Scenario | Expected |
|---|---|---|
| H12 | Sync a 100-card nested lore space and exercise the entries in real chat generation | Every entry behaves identically to a natively created entry (roadmap SC-003, finally verified on live data) |
| H13 | Force a save failure mid-push on the large book, then Retry | Failure banner appears; retry pushes the unsent payload with **no false divergence**; behaviour identical to the small-book case |

## C. Interop hooks (SC-005, SC-006, SC-010)

Use a small consumer extension subscribing to every documented event.

| # | Scenario | Expected |
|---|---|---|
| H14 | Create, rename, move and delete items by **each** route: manual UI edit, assistant apply, markdown pull, native import, bulk action | `tree-changed` fires **exactly once** per occurrence for every route, payload matching `contracts/hooks.md` (FR-009) |
| H15 | Push a book to success; then force save-failure, conflict-block, validation-block and missing-book | `book-pushed` fires once per terminal state with the correct `outcome` |
| H16 | Designate a root, rename its book, undesignate it, delete a bound root, import a native book | `root-changed` fires once per transition with the right `action`; markdown-restored roots do **not** double-fire |
| H17 | Open/close the drawer, switch Workspace ⇄ Worlds/Lorebooks, and reload with the drawer already open | `workspace-shown`/`workspace-hidden` fire once per transition, including the already-open-at-init case |
| H18 | Edit an entry and let a push complete | **No** `tree-changed` for the push's bookkeeping updates (sync status, uid, tombstones) — only for the real edit |
| H19 | Subscribe a consumer whose every handler throws, and one that blocks for 5 s | 0 failed or blocked workspace operations; errors logged, not surfaced to the user (SC-006, FR-010) |
| H20 | Diff the documented event list against the events actually emitted | Exact match — no documented event that never fires, no emitted event undocumented (SC-010) |

## D. Documentation and process (SC-007, SC-009)

| # | Scenario | Expected |
|---|---|---|
| H21 | Give `README.md` to someone who has never seen the plugin | They install it, create an entry, designate a World Info root, confirm native sync, and link a markdown folder — using the docs alone, without reading source or spec folders (SC-007) |
| H22 | Look up the markdown convention, the assistant prerequisites and the environment limits in the docs | All found, including desktop-Chromium/secure-context linking and the Connection Manager requirement (FR-015) |
| H23 | An extension author reads `docs/hooks.md` and writes a consumer without reading plugin source | Succeeds; every event, payload, firing condition and the additive-only promise are documented (FR-014) |
| H24 | Take **one real fix** end to end through the maintenance path | Reported with the template, triaged against the threshold, fixed, and recorded as a changelog entry — **no spec written** (SC-009) |
| H25 | Triage a sample set of ≥ 5 changes spanning both sides of the threshold | 100% routed correctly (fix vs. spec) using the written rule alone (SC-009) |
| H26 | Read the constitution and `AGENTS.md` | Binding rule and mechanics both discoverable; no contradiction; constitution at 1.3.0 with a sync impact report (FR-024) |

---

## Gate

The phase closes when H0–H26 pass, all four quality gates are green, and the owner confirms
SC-008 — typical lore-management workflows completed entirely within the workspace, without
opening the previous separate plugins, over a week of real use.

## Results

### Quick live pass — 2026-10-06 (dev account, scale dataset of 2164 nodes / 1000-entry root, production build)

Gates: typecheck, lint, `pnpm run test` (668 unit/integration + 11 perf), build — all green.
Method: seeded dataset loaded into the account, Chromium via `playwright-cli`, longtask observer + CDP profiler.
Account restored from backup afterwards. This was a fast pass, not the full H0–H26 sweep.

| # | Result |
|---|---|
| H0 | PASS — `tests/perf` P-1…P-9 green (sequential run) |
| H1 | PASS — collapse/expand of the 1000-entry folder: long tasks 106–136 ms, none above 200 ms |
| H3 | PASS — 200 chars typed into an entry's content with native sync active: appended text identical, focus kept, no long tasks while typing |
| H6 | **PARTIAL** — push of the 1000-entry book persisted correctly (1000 entries on disk), but long tasks of 470 ms and 191 ms occur around the push. Profile: host `fetch` 186 ms + GC 151 ms + `saveSettings` 70 ms dominate; plugin code is ~70 ms per function spread over several tasks. L-2 (< 200 ms) is not met on a 2 MB book |
| H14 | PARTIAL — manual rename gave exactly one `tree-changed`; other routes covered by `hooks-engine` tests only |
| H15 | PARTIAL — `book-pushed` `success` once with the right payload; failure outcomes covered by tests (scenario W) |
| H17 | PASS (hidden transition seen live; shown after switching back) |
| H18 | PASS — the push after an edit produced no extra `tree-changed` |
| H19 | PASS — consumers that throw and one that busy-blocks 5 s: edit, push and events all completed, error only in the console |
| H20 | PASS — documented-vs-emitted match is asserted by the test suite |
| H22, H26 | PASS by reading — README states the Chromium/secure-page and Connection Manager requirements; constitution at 1.3.0 |
| H2 | PASS — single select ~180 ms incl. automation overhead; 50 ctrl-click toggles, each task 51–77 ms |
| H4 | PASS — drag of an entry across the 1000-entry folder moved it; long tasks 116 ms and one 209 ms at the drop (commit) |
| H5 | PASS — tree search 58 ms, Lorebooks panel search no long task |
| H6 | ACCEPTED by the owner as a host limitation (see the L-2 note in `contracts/performance-budgets.md`) |
| H7 | PASS (shortened) — 90 s of continuous typing with background pushes: 1554 chars, text identical, focus kept, no long task > 200 ms, edit reached the native book. Markdown auto-push not part of this run |
| H11 | PARTIAL — host stayed responsive after closing the workspace (longest task 73 ms); heap unchanged only because the large dataset had been deleted by then; hidden workspace keeps ~200 DOM nodes mounted |
| H13 | PASS on a 200-entry book — save failure raised the banner and a `save-failed` event, Retry pushed the unsent text, `success` event, banner cleared, no false divergence. Not repeated on the 1000-entry book |
| H16 | PASS — `designated`, `undesignated`, `imported`, `book-deleted` each fired once. `book-renamed` not exercised |
| H14, H15 | ACCEPTED by the owner on the evidence above |
| H8, H9, H10 | NOT RUN (H8 needs the folder picker, H10 a double-size dataset; H9 is covered by the integration suite) |
| H12 | PARTLY COVERED 2026-10-09 — entries of a workspace-managed WI root (Realm of Aldermeer) were activated in real main-chat generation and appear in the prompt in the server log (spec 007 live pass 2, C33). The full 100-card space in real chat stays with the owner's day-to-day use |
| H21 | PASS — owner: an outside tester followed the README; the problems they found were fixed in earlier sessions |
| H24 | WAITING for a real candidate — the report template is now the GitHub issue form (`.github/ISSUE_TEMPLATE/report.yml`, blank issues disabled), so the first real report goes through it |
| H25 | see the triage sample below |

Harness note: a leftover `data-shot` attribute made a scripted click toggle a root off; the plugin behaved correctly ("Disable World Info root" shares the button).

### H25 triage sample (rule: AGENTS.md "Maintenance changes" — no new user capability AND no delivered contract altered; doubt → spec)

| # | Change | Route | Deciding rule |
|---|---|---|---|
| 1 | Fix a typo in the "Make World Info root" tooltip | maintenance | label fix, no contract |
| 2 | Preview renders `==highlight==` wrongly inside a table cell | maintenance | preview rendering bug |
| 3 | Drag a folder onto its own descendant shows no "not allowed" feedback | maintenance | drag-drop edge case |
| 4 | Tree scrolling is slow at 5000 nodes | maintenance | perf fix, behaviour unchanged |
| 5 | The failure banner stays after its book was deleted | maintenance | bug in banner clearing, no sync semantics changed |
| 6 | Add `entryCount` to the `book-pushed` payload | **spec** (hooks) | new hook field |
| 7 | Assistant retries rate limits three times (10/30/60 s) instead of two | **spec** (assistant protocol/behaviour) | changed retry behaviour |
| 8 | Add a "Duplicate folder" bulk action | **spec** | new user capability |
| 9 | Export `wi_group_weight` under another key name | **spec** (markdown convention) | convention key |
| 10 | Persist `settings.layout.assistantCollapsed` | **spec** (persistence schema) | additive, but still the schema |
| 11 | Raise the native push debounce from 1000 ms to 1500 ms | **spec** (native sync semantics) | AGENTS.md states 1000 ms as the contract |

Result: 11/11 routed by the written rule alone; 5 maintenance, 6 spec. Owner confirmation of the routing: pending.

Applied in practice (2026-10-09): backlog item B1 (a stale tab overwrites the workspace)
touched the persistence contract, was routed to a spec by the rule, and the owner
agreed — delivered as spec 008.
