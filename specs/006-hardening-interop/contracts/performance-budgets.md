# Contract: Performance Budgets

Budgets exist so regressions fail loudly. They are **comparative**, measured on the
reference environment, not absolute hardware guarantees (spec Assumptions).

## Reference environment

Owner's development machine; local instance `http://127.0.0.1:8634`, `dev` account; system
Chromium (`/usr/bin/chromium-browser`) via `playwright-cli`. Production build
(`pnpm run build`) — never watch mode, whose source maps and unminified output distort
timings.

## Scale dataset

`tests/support/scaleDataset.ts`, seeded and deterministic: ~2000 nodes, one World Info root
book of 1000 entries, realistic content lengths, nesting depth ~5, plus a second smaller
book so multi-book paths are exercised. Test-only; never shipped.

---

## A. Core-path budgets (`tests/perf/`, Vitest, assertable)

Measured on the generated dataset in isolation from React and the app. These are the
numbers that regress silently.

| # | Path | Budget | Rationale |
|---|---|---|---|
| P-1 | Single field commit (`store.update` + operation) | < 5 ms | Today a full `structuredClone` of the workspace; the target is path-copy cost only |
| P-2 | `findNode` on a warm index | < 0.1 ms | Today O(n) with a full `Map` rebuild per call |
| P-3 | Bulk delete of 50 selected nodes | < 50 ms | Today O(k·n) with a deep clone **per item** |
| P-4 | `setExpanded` (one boolean) | < 2 ms | Today a whole-state clone for a caret click |
| P-5 | Push of a 1000-entry book, one entry changed | < 150 ms excluding host I/O | Today 3 full stringify+hash passes over all 1000 entries |
| P-6 | `fingerprintEntry` over 1000 entries, 1 changed, warm memo | < 5 ms | Identity-keyed memo (R6) |
| P-7 | `renderWorkspace` (markdown), 1 of 2000 items changed | < 100 ms | Today re-renders and re-hashes everything |
| P-8 | `reconcile` over 2000 items | < 200 ms | Today two genuine O(n²) matching passes |
| P-9 | Peak retained memory for the dataset | no growth across 100 successive edits | Guards against the index/memo caches leaking |

Budgets are set with headroom above measured post-fix values so the suite fails on
**regressions**, not on machine variance. Each budget records its pre-fix baseline in the
suite so the improvement is evidenced rather than asserted.

### Acknowledged floor

`saveSettingsDebounced` serializes the **entire** settings object — a multi-MB
`JSON.stringify` plus POST for a 1000-entry workspace — on the app's own 1000 ms debounce
(`relaxed: 1000`). This is the host's contract, not ours. It bounds how cheap a typing
pause can ever be and is deliberately **excluded** from P-1; no budget here pretends it
away.

---

## B. Interaction budgets (live, browser Performance API)

These map to spec SC-001 and SC-002 and cannot be honestly asserted in jsdom.

| # | Criterion | Budget | Method |
|---|---|---|---|
| L-1 | Routine interaction (expand/collapse, select, open entry, search books) | < 1 s to visible result | Manual timing + `performance.measure` |
| L-2 | No task blocks input | no long task > 200 ms | `PerformanceObserver({ type: 'longtask' })` during the scripted session |
| L-3 | Typing fidelity | 0 dropped or re-ordered keystrokes | Type a known string at speed into a 1000-entry book's entry with sync + markdown auto-push running; compare committed text to the sent text exactly |
| L-4 | Focus stability | 0 focus losses | `document.activeElement` sampled throughout the 5-minute scripted session |
| L-5 | Large operation escapability | progress visible; cancel works or the operation is declared uninterruptible beforehand (FR-003) | Run a full scan/import on the large linked folder |

---

## C. Scale-invariance check (SC-004)

Sync, import, export and markdown round-trip results on the 1000-entry dataset must be
**identical** to results for the equivalent small dataset — scale changes duration, never
outcome. Verified by running the same fixture shape at both sizes and comparing normalized
output. 0 differences attributable to scale.

## D. Graceful degradation (beyond target)

Above the 1000-entry / 2000-node target there is no budget, but three properties still
hold: no data corruption, no lost edits, and no hang without visible progress or an escape.
Verified once at roughly double the target.
