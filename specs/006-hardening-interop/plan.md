# Implementation Plan: Hardening & Interop (Roadmap Phase 4)

**Branch**: `master` (feature dir `006-hardening-interop`) | **Date**: 2026-09-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/006-hardening-interop/spec.md`

## Summary

Make the delivered workspace trustworthy at realistic sizes (1000-entry book, ~2000-node
tree), open it to other extensions through a complete documented event surface, document
it for users and extension authors, and establish a standing maintenance-change process
so small fixes are documented without a full spec cycle.

Technical approach: the performance work is **not** a collection of micro-optimizations
but one root-cause fix plus its cascade. Every workspace mutation currently
`structuredClone`s the entire state ([store.ts:39](../../src/core/state/store.ts#L39),
[operations.ts:32-34](../../src/core/tree/operations.ts#L32-L34)) and every node lookup
rebuilds a full index ([schema.ts:439-444](../../src/core/state/schema.ts#L439-L444)).
Because commit-on-change writes per keystroke, one character costs a multi-MB deep clone,
~5 full tree walks and an unmemoized re-render of every visible row. Replacing the clone
with **structural sharing (path-copy)** and caching the **node index on state identity**
makes unchanged subtrees keep reference identity, which in turn revives dead early-outs
and unlocks identity-keyed caching in the image GC, the sync fingerprints and the markdown
renderer — three separate O(n) passes that become O(1) per unchanged entry for free (R1,
R2). Typing then moves off the store entirely via local drafts (R3), and the tree gains
memoized rows plus hand-rolled windowing (R5).

The hook work hinges on one finding: `applyTreeChange` is **not** the universal funnel the
spec assumed — nine UI routes, markdown import and every native-sync mutation bypass it
([WorkspaceApp.tsx:143-149](../../src/ui/WorkspaceApp.tsx#L143-L149)). Tree events are
therefore derived from a **store-level diff subscription with microtask coalescing**, the
only place no route can escape, while book-push, root-designation and open/close events
are emitted at their genuine choke points (R9).

Details and alternatives: [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 5.x, `strict`, no `any` (constitution III)

**Primary Dependencies**: React 18, Webpack 5, shared SCSS system. App APIs via
`getContext()`: `eventSource.emit` (hooks), `saveSettingsDebounced`, `saveWorldInfo`.
**No new runtime dependencies** — list windowing is hand-rolled (R5), consistent with the
project's precedent of owning its markdown renderer and diff rather than pulling deps.
Test-only: none new beyond the existing Vitest setup.

**Storage**: Unchanged. Persistence schema v1, IndexedDB stores (`WorldInfoWorkspace-md`,
`WorldInfoWorkspace-assistant`) and `sessionStorage` draft key all stay exactly as
specified — this phase alters no product contract (spec Assumptions).

**Testing**: Vitest — new `tests/perf/` budget suite over a seeded generated dataset
(deterministic, assertable thresholds, CI-able); new contract tests for every added event
following the existing collector pattern in
[tests/contract/hooks.test.ts](../../tests/contract/hooks.test.ts); the existing 54 test
files serve as the regression net for the store refactor. Live: quickstart H0–H26 on the
local instance.

**Target Platform**: SillyTavern web UI (desktop + mobile), local instance
`http://127.0.0.1:8634`, `dev` account, system Chromium.

**Project Type**: SillyTavern UI extension (single bundle)

**Performance Goals** (from spec SC-001/SC-002, measured on the reference environment):
routine interaction < 1 s; no single task blocking input > 200 ms; 0 dropped or re-ordered
keystrokes and 0 focus losses over a 5-minute scripted session with background saves,
native pushes and markdown auto-pushes running.

**Constraints**: additive-only hook changes (FR-011); no product-contract changes; the
app's own 1000 ms settings-save debounce sets an unavoidable floor on per-pause cost
(R10); markdown linking stays desktop-Chromium/secure-context only.

**Scale/Scope**: 1000-entry book, ~2000-node workspace (clarified target). Graceful
degradation beyond, not gated. Full virtualization rework for 5000+ is out of scope.

## Constitution Check

*GATE: checked before Phase 0 and re-checked after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Holistic, modular plugin | PASS | New surfaces fit existing module boundaries: `core/state` (index + sharing), `ui/VirtualList.tsx`, `adapters/hooks.ts`. No new bundle or manifest. |
| II. App API first | PASS | Hooks go through `ctx.eventSource.emit`; no app internals forked; `context/SillyTavern/` stays read-only reference. |
| III. Strict TypeScript | PASS | New event payloads are declared types, not `unknown` casts — this is the fix for the current state where `wi-workspace:*` payloads have **no** declared types anywhere (R9). |
| IV. Lint & format | PASS | No new config. |
| V. Test-first for core logic | PASS | Perf budgets, the node index, the diff→event derivation and the changelog/threshold rules are all pure core logic with tests written first. |
| VI. Integration tests vs `getContext()` | PASS | New events exercised on the existing `tests/support/fakeHost.ts` harness, which wires a real sync engine. |
| VII. Extension interop hooks | PASS — and materially advanced | Additive only (FR-011). This phase is the one that finally satisfies VII's "documented" requirement for the Phase 1 core. |
| VIII. Proven pattern, spec-driven | PASS with deliberate amendment | This phase **amends the constitution** to 1.3.0 to legitimize the maintenance path (spec FR-024). Governance-compliant: documented rationale + MINOR bump. Tracked below. |
| IX. Language policy | PASS | All artifacts English-only. |

**Gate result: PASS.** One item is carried into Complexity Tracking (the store refactor),
and one is a deliberate, spec-mandated governance change rather than a violation.

## Project Structure

### Documentation (this feature)

```text
specs/006-hardening-interop/
├── plan.md              # This file
├── research.md          # Phase 0 output — R1–R12 decisions
├── data-model.md        # Phase 1 output — event payloads, perf entities, process entities
├── quickstart.md        # Phase 1 output — validation scenarios H0–H26
├── contracts/
│   ├── hooks.md                 # The full wi-workspace:* event surface (existing + new)
│   ├── performance-budgets.md   # Measurable budgets + how they are measured
│   └── maintenance-process.md   # Threshold, report template, changelog/record formats
├── checklists/requirements.md
└── tasks.md             # Phase 2 output (NOT created by /speckit-plan)
```

### Source Code (repository root)

Changed and added files only; everything else stays as documented in `AGENTS.md`.

```text
src/
├── core/
│   ├── state/
│   │   ├── store.ts              # CHANGED: structural sharing; no whole-state clone
│   │   ├── schema.ts             # CHANGED: identity-cached node index; findNode(index?)
│   │   ├── nodeIndex.ts          # NEW: index cache keyed by root identity (R2)
│   │   └── sharing.ts            # NEW: updateNodePath path-copy helper (R1)
│   ├── tree/
│   │   └── operations.ts         # CHANGED: path-copy instead of clone(); bulk ops batch
│   ├── sync/
│   │   └── fingerprint.ts        # CHANGED: identity-keyed memo (WeakMap) (R6)
│   ├── md/
│   │   ├── linkRender.ts         # CHANGED: identity-gated render, batched digests (R8)
│   │   ├── scan.ts               # CHANGED: bounded-concurrency reads (R8)
│   │   └── reconcile.ts          # CHANGED: pre-bucketed matching, no O(n^2) (R8)
│   └── hooks/
│       ├── events.ts             # NEW: event names + payload types (R9)
│       └── treeDiff.ts           # NEW: pure previous→next diff + bookkeeping filter (R9)
├── adapters/
│   ├── hooks.ts                  # NEW: typed, contained emitter (replaces inline lambdas)
│   ├── settingsStore.ts          # CHANGED: tree-event diff subscription; wires emitter
│   ├── syncEngine.ts             # CHANGED: push + root-designation events; loop fixes (R7)
│   └── ...                       # mdLink/assistantApply migrate to the shared emitter
├── ui/
│   ├── VirtualList.tsx           # NEW: hand-rolled windowing (R5)
│   ├── StructureTree.tsx         # CHANGED: memoized rows, stable callbacks, ref-based drag
│   ├── WorkspaceApp.tsx          # CHANGED: useCallback handlers; applyOperation retained
│   ├── ItemEditor.tsx            # CHANGED: local-draft text fields (R3)
│   ├── fieldGroups/FieldGroups.tsx # CHANGED: draft fields; deferred preview (R4)
│   └── useDraftField.ts          # NEW: shared local-draft + debounced-commit hook (R3)
└── index.ts                      # CHANGED: workspace open/close events

tests/
├── perf/
│   ├── scale.bench.test.ts       # NEW: budget assertions on the generated dataset
│   └── ...
├── support/
│   └── scaleDataset.ts           # NEW: seeded generator (1000 entries / 2000 nodes)
├── contract/hooks.test.ts        # CHANGED: extended to every new event
└── unit/, integration/           # regression net; targeted additions per fix

docs/
└── hooks.md                      # NEW: extension-author hook reference (FR-014)
README.md                         # NEW: user-facing documentation (FR-013)
CHANGELOG.md                      # NEW: seeded "0.4.11 and earlier"; real from 0.4.12 (FR-019)
AGENTS.md                         # CHANGED: maintenance mechanics (FR-024)
.specify/memory/constitution.md   # CHANGED: 1.2.0 → 1.3.0, binding maintenance rule
```

**Structure Decision**: The existing `core/` (pure, tested) vs `adapters/` (app boundary)
vs `ui/` separation is kept unchanged and is what makes this phase tractable — the event
payload derivation and the perf-critical data structures are pure core logic that can be
tested without the app, while emission and measurement live at the adapter boundary. Two
genuinely new concerns get their own modules rather than being bolted onto existing files:
`core/hooks/events.ts` (the typed event surface, absent today) and `ui/VirtualList.tsx`.

## Complexity Tracking

> Filled because the performance approach carries real risk that must be justified.

| Violation / Risk | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Refactoring `WorkspaceStore.update` and `operations.ts` from whole-state `structuredClone` to structural sharing — the single most load-bearing change in the codebase, touching the path every one of the 57 test files exercises | It is the **root cause**. Without reference-stable unchanged subtrees, the image-GC early-out stays dead code, fingerprints cannot be memoized by identity, the markdown renderer cannot skip unchanged nodes, and `React.memo` on tree rows cannot ever hit. Four separate P0 problems collapse into one fix. | Optimizing each symptom separately (debounce typing, memo rows, cache hashes by serialized key) was evaluated and rejected: it is strictly more code, leaves the multi-MB clone on every keystroke and every expand/collapse click, and each cache would need a serialization-based key whose construction is itself O(content bytes) — the exact mistake already present at [linkRender.ts:71](../../src/core/md/linkRender.ts#L71). |
| Deriving tree events from a store-level **diff** rather than from explicit call sites | `applyTreeChange` is not the universal funnel; 9 UI routes, markdown import and all native-sync mutations bypass it. FR-009 demands exactly-once per occurrence *regardless of route*. | Patching every bypass to route through `applyTreeChange` was rejected: each missed site is a silently absent event (an untestable, open-ended correctness risk), and the native-sync bypasses alone are a large refactor of `syncEngine`. The diff approach cannot miss a route by construction. |
| Microtask coalescing on the tree-event stream | Single logical changes legitimately produce multiple store notifications (`applyTreeChange` → `refreshStructure`; `pushBook`'s two post-save updates; per-field undo loops), which would violate FR-009's exactly-once. | Emitting per notification was rejected as it double- and N-fires. Removing the internal double-updates entirely was rejected as a larger, riskier change to sync bookkeeping for no user-visible gain. |
| Amending the constitution (1.2.0 → 1.3.0) | Spec FR-024. Governance makes the constitution supersede other documents, so a maintenance path documented only in `AGENTS.md` would be void where it conflicts with Principle VIII. | Documenting the process only in `AGENTS.md` was rejected by the owner during `/speckit-clarify` for exactly this reason. |

**Risk control for the store refactor**: it lands first, alone, behind the full existing
test suite (57 files incl. the real-engine `sync-engine.test.ts` scenarios A–W), with no
behavioural change intended — a pure representation change. Perf budgets are asserted
before and after so the gain is evidenced, not assumed.
