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

*(Filled during live validation, as in specs 003–005.)*
