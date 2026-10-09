# Implementation Plan: Stale-Tab Protection

**Branch**: `master` (feature dir `008-stale-tab-protection`) | **Date**: 2026-10-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/008-stale-tab-protection/spec.md`

## Summary

Stop a tab or device that was opened earlier from silently writing its old workspace over
newer changes. Each save by this extension stamps the saved workspace with a marker
(revision, writer, content hash). A tab compares the saved workspace with the copy it last
saw at the moments that matter, then does one of four things: picks up newer changes,
restores its own newer copy over a stale overwrite, asks when both sides changed, or
does nothing.

Technical approach:

- **Reading the saved workspace**: `POST /api/settings/get` (measured 430 KB / ~10 ms on
  `dev`), parse `settings`, take the namespace (R1).
- **Marker** `_save = { rev, writer, at, hash }`, trusted only when its hash matches the
  payload's content hash, so writes by earlier extension versions are detected as
  "unknown age" (R2).
- **Content hash**: a projection without bookkeeping (expand flags, layout, sort mode,
  sync status, the marker), using the existing FNV fingerprint helpers (R3).
- **Save gate** in `settingsStore.ts`: a mutation schedules a guarded save — check, then
  publish + save, load, or open the conflict state. Native pushes wait for the same gate.
  While in conflict, nothing from the tab is published (R4).
- **Load**: migrate, keep the tab's bookkeeping, `store.replace`; the existing
  store-level diff emits `tree-changed`; no new hook (R5).
- **Checks**: visibility, focus, workspace shown, before saves and pushes, and every
  2 minutes while visible (R6).
- **Conflict banner** with two difference lists from the existing `diffTree` (R7).

## Technical Context

**Language/Version**: TypeScript 5.x, `strict` (constitution III)

**Primary Dependencies**: React 18, Webpack 5, shared SCSS system. App APIs via
`getContext()`: `extensionSettings`, `saveSettingsDebounced`, `getRequestHeaders`,
`eventSource`. Browser: `fetch('/api/settings/get')`, `document.visibilityState`,
`visibilitychange`, `window` `focus`. No new runtime dependencies.

**Storage**: `extensionSettings['WorldInfoWorkspace']` gains the optional `_save` key
(contracts/persistence-delta.md). Schema version stays 1. Nothing new in IndexedDB.

**Testing**: Vitest.
- Unit: hash projection, marker trust, classification, conflict summary.
- Integration: a fake host whose "server" payload other writers change; real store, sync
  engine and settings bridge.
- Perf: P-12, the content hash of the 1000-entry dataset.

**Target Platform**: SillyTavern 1.13+ in desktop and mobile browsers.

**Project Type**: Browser extension (single bundle).

**Performance Goals**:
- A newer workspace is shown within 2 s of returning (SC-002).
- The content hash of 1000 entries takes under 100 ms (P-12).
- A check never blocks typing: it runs asynchronously, and the store stays responsive.

**Constraints**:
- An extension cannot veto the app's own settings saves (R8, documented risk).
- The recovery no-publish rule takes precedence.
- Single-tab behaviour must look unchanged (SC-006).

**Scale/Scope**: workspaces up to the spec 006 scale (~1000 entries, ~1–2 MB payload).
Two or three concurrent tabs or devices.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Check | Status |
|-----------|-------|--------|
| I. Holistic, modular | Pure module `core/state/staleness.ts` (content projection + hash, marker trust, classification, conflict summary); the gate is a factory in `adapters/saveGate.ts` wired by `adapters/settingsStore.ts`, plus a small `adapters/savedSettings.ts` (fetch + parse); banner component `ui/StaleBanner.tsx`; one bundle | ✅ |
| II. App API first | Saved settings read through the app's own endpoint with `getRequestHeaders()`; saves still through `saveSettingsDebounced`; no app internals imported | ✅ |
| III. Strict TS | `global.d.ts`: nothing new beyond what is typed (`getRequestHeaders` exists); the `_save` type in `schema.ts` | ✅ |
| IV. Lint & format | Unchanged | ✅ |
| V. Test-first | Classification table and projection are pure and written test-first; integration scenarios mirror quickstart T1–T13 | ✅ |
| VI. Integration testing | Fake host extended with a server payload and a second writer; sync engine push gate covered | ✅ |
| VII. Interop hooks | No new event; loads surface as the existing `tree-changed` (decided in spec FR-012) | ✅ |
| VIII. Pattern + speckit | Full speckit path; delivered contract touched: persistence schema (contracts/persistence-delta.md) | ✅ |
| IX. Language | English UI strings and artifacts | ✅ |

Post-design re-check (after Phase 1 artifacts): still ✅. Holding native pushes while in
conflict changes when a push happens, never what it writes. Native sync semantics
(contract) are unchanged.

## Project Structure

### Documentation (this feature)

```text
specs/008-stale-tab-protection/
├── spec.md
├── plan.md                 # this file
├── research.md             # R1–R8
├── data-model.md
├── quickstart.md           # live scenarios T0–T14
├── contracts/
│   ├── persistence-delta.md
│   └── ui-contract.md
├── checklists/requirements.md
└── tasks.md                # /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── core/state/
│   ├── schema.ts           # SaveMarker type on WorkspaceState (`_save?`)
│   └── staleness.ts        # NEW: contentHash (projection), markerTrusted, classify,
│                           #   withBookkeeping (copy tab bookkeeping onto a loaded state),
│                           #   conflictSummary (diffTree → names, 10 + more)
├── adapters/
│   ├── savedSettings.ts    # NEW: read the saved namespace (/api/settings/get), parse
│   ├── saveGate.ts         # NEW: createSaveGate(deps) — seen copy, guarded save, load,
│   │                       #   restore, conflict state, check scheduling (testable: store,
│   │                       #   readSaved, publish/save, timers and visibility injected)
│   ├── settingsStore.ts    # wires the gate instead of publish-on-every-change; check
│   │                       #   triggers (visibility, focus, 2-minute visible interval)
│   ├── syncEngine.ts       # pushes await the gate; held while in conflict
│   └── shell.ts            # workspace-shown → check (existing callback)
├── ui/
│   ├── StaleBanner.tsx     # NEW: conflict banner (two lists, two buttons)
│   └── WorkspaceApp.tsx    # mounts the banner in the banner area
└── styles/wiw-theme.scss   # list styling inside the shared banner, if needed
tests/
├── unit/staleness.test.ts
├── integration/stale-tabs.test.ts   # fake host with a mutable server payload
└── perf/scale.bench.test.ts         # P-12
README.md, AGENTS.md (Settings + persistence), CHANGELOG.md,
specs/003-core-workspace-mvp/contracts/persistence-schema.md (amended per the delta)
```

**Structure Decision**: The existing layout is unchanged. The pure logic goes in
`core/state/` next to the schema it protects. All host interaction stays in the two
adapters that already own persistence and pushes.

## Complexity Tracking

No constitution violations to justify.
