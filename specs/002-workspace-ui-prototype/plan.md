# Implementation Plan: Workspace UI Prototype (Phase 0)

**Branch**: `002-workspace-ui-prototype` | **Date**: 2026-09-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/002-workspace-ui-prototype/spec.md`

## Summary

Deliver the Phase 0 prototype of the World Info Workspace: a clickable, fully mocked
interface inside SillyTavern that demonstrates the three-region layout (structure tree /
item editor / assistant panel), the flexible lore tree with World Info root designations
(including nested roots and per-root settings), a batch-proposal assistant mock, and the
active-books control — all driven by in-memory sample data, styled dynamically from the
app's `--SmartTheme*` theme variables, and reachable through the re-bound native World
Info editor entry point. The prototype is discardable; its purpose is the owner's
approve/iterate/discard decision before production UI work. Technical approach: mount the
workspace UI into the native `#WorldInfo` drawer (the proven full-replacement pattern
from WorldInfoDrawer research — no click interception, no host patching), render with
React, keep sample data as pure testable logic, and isolate all host-DOM composition in
one adapter module.

## Technical Context

**Language/Version**: TypeScript 5.x, `strict: true` (constitution III) — tooling already
initialized in spec 001 (pnpm, webpack, ESLint 9, Prettier, Vitest)

**Primary Dependencies**: React 18 (ReactDOM manual root), SCSS consuming the app's
`--SmartTheme*` custom properties, SillyTavern `getContext()` + host drawer DOM
composition (isolated adapter), Webpack bundle from spec 001

**Storage**: None — the prototype is fully in-memory (sample dataset module); no
`extensionSettings` writes, no `loadWorldInfo`/`saveWorldInfo` calls (spec FR-008)

**Testing**: Vitest — unit tests for the sample dataset builder and tree shaping (the
only pure logic in this phase); shell behavior verified via quickstart manual scenarios
(spec VI applied proportionately to a mock-only phase)

**Target Platform**: SillyTavern web UI, desktop; the `#WorldInfo` navbar drawer (opens
regardless of active chat — chat-independent by construction)

**Project Type**: SillyTavern UI extension increment (same single bundle as spec 001)

**Performance Goals**: Sample tree (25+ nodes) renders with no perceptible delay
(spec SC-002); interactions (expand/collapse/select) respond instantly

**Constraints**: Zero reads/writes of real lorebooks/settings/chat data (FR-008);
visual-only editing that resets on close (FR-009); visible "prototype" labeling
(FR-009); review guide built in (FR-010); discardable isolation (FR-011); host DOM
composition (`#WorldInfo` mount, body class, MutationObserver) confined to a single
adapter module (constitution II last-resort clause); teardown = page reload (no runtime
unmount path — see research.md R6)

**Scale/Scope**: One prototype screen; sample dataset of ~10+ cards, 3+ notes, 3+ folder
levels, 2+ WI roots (one nested); ~10 UI components; decision gate at the end

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Evidence |
|-----------|--------|----------|
| I. Holistic, Modular Plugin | PASS | Same single bundle/manifest; prototype is a phase of the one plugin, not a separate artifact; modules isolated (sample/core, shell adapter, UI) |
| II. App API First | PASS (justified) | App access via `getContext()` where needed; the entry-point replacement composes with host DOM (`#WorldInfo` mount, body class, MutationObserver) — the constitution's last-resort DOM case, confined to one adapter module (`src/adapters/shell.ts`), no host function patching, no direct host imports (research.md R1) |
| III. Strict TypeScript | PASS | New code under `strict`; sample dataset and components fully typed; no `any` |
| IV. Lint & Format Discipline | PASS | Gates from spec 001 apply; `pnpm run lint`/`typecheck` must stay green |
| V. Test-First | PASS | Sample dataset builder and tree shaping are pure, written Vitest-first; UI shell verified via quickstart scenarios (proportionate for mock-only phase) |
| VI. Integration Testing | PASS | Shell mount/open/close behavior covered by manual quickstart scenarios against a running app; automated contract tests for the sample dataset schema |
| VII. Extension Interop Hooks | PASS | No hooks in this phase — deferred per spec 002 Out of Scope; contracts remain as specified in spec 001 |
| VIII. Proven Pattern, Spec-Driven | PASS | React + webpack + SCSS per 3DDiceRolls pattern; entry-point replacement follows the WorldInfoDrawer co-optation pattern (research.md R1) delivered through speckit flow |
| IX. Language Policy | PASS | All artifacts and sample UI text English-only |

**Post-design re-check (Phase 1)**: still PASS. Notes: the only constitution-sensitive
point is the host DOM composition for entry-point replacement — it is the documented
last-resort path (constitution II), isolated in one adapter, uses host-stable IDs only
(`#WorldInfo`, `#wi-holder`), and adds zero host-function patching (research.md R1, R6).

## Project Structure

### Documentation (this feature)

```text
specs/002-workspace-ui-prototype/
├── plan.md              # This file
├── research.md          # Phase 0 output — entry-point replacement, layout, theming, sample data
├── data-model.md        # Phase 1 output — sample dataset entities, field groups, review decision
├── quickstart.md        # Phase 1 output — validation scenarios
├── contracts/
│   └── contracts.md     # Phase 1 output — dataset schema, UI interaction contract, shell contract
└── tasks.md             # Phase 2 output (/speckit.tasks — NOT created here)
```

### Source Code (repository root)

```text
src/
├── core/                        # FIRST USE (spec 001 plan target)
│   └── sample/                  # Pure sample-lore logic (Vitest-first, no app imports)
│       ├── dataset.ts           #   Sample lore dataset definition (spec FR-003 shape)
│       └── tree.ts              #   Tree shaping: order, nesting, WI-root markers, membership
├── adapters/                    # FIRST USE
│   └── shell.ts                 # Host drawer composition: mount into #WorldInfo, body class,
│                                #   open/close MutationObserver, teardown-on-reload (isolated)
├── ui/                          # FIRST USE
│   ├── WorkspacePrototype.tsx   # Three-region layout root (tree / editor / assistant)
│   ├── StructureTree.tsx        # Region 1: tree, expand/collapse, selection, WI-root markers
│   ├── ItemEditor.tsx           # Region 2: card field-group view, note view, WI-root settings view
│   ├── fieldGroups/             # Editor sections for the native WI field groups (spec FR-005)
│   │   └── FieldGroups.tsx      #   All nine groups (identity/content … automation/filters)
│   ├── AssistantPanel.tsx       # Region 3: scripted mock conversation, batch proposal preview
│   ├── ActiveBooksControl.tsx   # Mock control for the active-books list (spec FR-013)
│   ├── ReviewGuide.tsx          # Built-in review checklist (spec FR-010)
│   └── mount.tsx                # React root creation inside the shell-mounted container
├── styles/
│   └── prototype.scss           # Three-region layout + theme-variable-driven styling
├── global.d.ts                  # Extended only if a new getContext() member is needed
└── index.ts                     # Init: shell adapter mount + React root (prototype path)

tests/
├── manifest.test.ts             # Existing (spec 001)
└── unit/
    └── sample-dataset.test.ts   # Dataset shape contract + tree shaping rules
```

**Structure Decision**: Continue the single-project layout from spec 001; this increment
creates the first real `src/core/`, `src/adapters/`, `src/ui/`, and `src/styles/`
contents (no empty directories). Pure sample logic stays framework-free and
Vitest-first; host composition stays in exactly one adapter; React components stay
presentational over the in-memory dataset.

## Complexity Tracking

No constitution violations to justify — table intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
