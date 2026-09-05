# Implementation Plan: Integrated Lore Workspace (Phased Roadmap)

**Branch**: `001-workspace-plugin-roadmap` | **Date**: 2026-09-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-workspace-plugin-roadmap/spec.md`

## Summary

Build a SillyTavern extension ("WorldInfo Workspace") that unifies a flexible lore-tree
editor (folders/cards/notes at any depth), workspace-authoritative sync to the native
World Info format via user-designated WI-root folders (with divergence warnings on
import), an in-workspace AI lore assistant (generation, editing, reorganization,
recommendations via the app's configured AI connections), and bidirectional markdown
conversion — delivered in phases starting with a discardable UI prototype. Technical
approach: UI-only plugin consuming the app exclusively through `getContext()`; workspace
state in extension settings; cards stored as verbatim native entries plus organizational
metadata; books written only through `saveWorldInfo`; namespaced `wi-workspace:*` event
hooks for other extensions. Full format/field research in [research.md](./research.md);
entities in [data-model.md](./data-model.md); interfaces in
[contracts/contracts.md](./contracts/contracts.md).

## Technical Context

**Language/Version**: TypeScript 5.x, `strict: true` (constitution III)

**Primary Dependencies**: React 18, Webpack, SCSS (app theme variables), SillyTavern
`getContext()` API only (no direct app imports); pnpm scripts per constitution

**Storage**: App-provided persistence — `extensionSettings['WorldInfoWorkspace']`
(workspace tree/notes/assistant history/settings), native lorebooks via
`loadWorldInfo`/`saveWorldInfo` (books: `{ entries, extensions }` on app server), per-book
workspace metadata in the book's native `extensions` passthrough

**Testing**: Vitest (unit + integration against `getContext()` surfaces), `tsc --noEmit`,
ESLint 9 flat config + Prettier (constitution III/IV/V/VI)

**Target Platform**: SillyTavern web UI (desktop browsers; runs wherever SillyTavern
runs), loaded as a third-party UI extension bundle

**Project Type**: SillyTavern UI extension (single webpack bundle, single `manifest.json`)

**Performance Goals**: Tree interactions and card editing feel instant for 100+ cards
(within the spec's SC-003/SC-006 budgets); debounced saves to avoid generation races

**Constraints**: App API first (constitution II — no app source forking, no raw
fetches to app endpoints); `saveWorldInfo` objects must not be mutated post-call
(research.md R3); English-only artifacts (constitution IX); prototype phase gates all UI
work (FR-023)

**Scale/Scope**: Single-user, local; target book sizes up to hundreds of entries per WI
root; 5 delivery phases (prototype → core MVP → assistant → md conversion → hardening)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Evidence |
|-----------|--------|----------|
| I. Holistic, Modular Plugin | PASS | Single bundle/manifest; plan separates pure logic (tree, flatten, converter, divergence) from UI and adapters (data-model.md modules are independently testable) |
| II. App API First | PASS | All app access via `getContext()` (research.md R4); persistence via `saveWorldInfo`/`loadWorldInfo` (R3); no raw endpoint calls; DOM probing not planned |
| III. Strict TypeScript | PASS | TS strict mandated; typed surface derived from `st-context.js`; no `any` escapes planned |
| IV. Lint & Format Discipline | PASS | ESLint flat config + `.prettierrc` + pnpm gates in quickstart.md |
| V. Test-First | PASS | Core logic (flatten/export, converter, divergence detection, assistant ops) is pure and Vitest-first (R9) |
| VI. Integration Testing | PASS | Integration tests against `getContext()` surfaces; contract tests for `wi-workspace:*` payloads (contracts C1) |
| VII. Extension Interop Hooks | PASS | Namespaced `wi-workspace:*` events, payload-typed, additive-only (contracts C1) |
| VIII. Proven Pattern, Spec-Driven | PASS | 3DDiceRolls pattern adopted (React/webpack/pnpm/AGENTS.md); this plan produced via speckit flow from spec 001 |
| IX. Language Policy | PASS | All artifacts and UI text English-only; plan/spec/design docs in English |

**Post-design re-check (Phase 1)**: still PASS. No violations requiring justification in
Complexity Tracking. Notes: the divergence-warning design (FR-012) uses
`WORLDINFO_UPDATED` + content hashes — the simplest mechanism that avoids two-way sync
complexity the user rejected; AI ops go through one structured-output schema (contracts
C4) rather than per-feature prompting.

## Project Structure

### Documentation (this feature)

```text
specs/001-workspace-plugin-roadmap/
├── plan.md              # This file
├── research.md          # Phase 0 output — WI format, app API, events, md conventions
├── data-model.md        # Phase 1 output — entities, state transitions, sync semantics
├── quickstart.md        # Phase 1 output — validation scenarios
├── contracts/
│   └── contracts.md     # Phase 1 output — events, slash commands, macro, AI ops schema, md contract
└── tasks.md             # Phase 2 output (/speckit.tasks — NOT created here)
```

### Source Code (repository root)

```text
src/
├── core/                # Pure logic (Vitest-first; no app imports)
│   ├── tree/            #   tree ops: create/move/rename/delete, ordering, validation
│   ├── wi/              #   native field schema, defaults, flatten/export, divergence
│   ├── md/              #   markdown converter (frontmatter mapping, round-trip)
│   └── assistant/       #   operation schema parsing, proposal planning, atomic apply
├── adapters/            # App boundary (only place importing getContext()-typed surface)
│   ├── books.ts         #   loadWorldInfo/saveWorldInfo wrappers (clone discipline)
│   ├── storage.ts       #   extensionSettings persistence + migrations
│   ├── events.ts        #   subscriptions (APP_READY, CHAT_CHANGED, WORLDINFO_UPDATED...)
│   └── llm.ts           #   generateQuietPrompt / connection-profile service wrappers
├── ui/                  # React components (tree, card editor, assistant panel, converter UI)
├── interop/             # Public event API (contracts C1), slash commands (C2), macro (C3)
├── styles/              # SCSS using --SmartTheme* variables
├── index.ts             # Entry point: init order, prototype/phase gates
└── global.d.ts          # SillyTavern API ambient types (from st-context.js research)

tests/
├── unit/                # core/ logic (tree, wi, md, assistant)
├── integration/         # adapters against mocked getContext() surfaces
└── contract/            # wi-workspace:* payload shapes, AI ops schema, md round-trip

dist/                    # webpack bundle (manifest.json points here)
manifest.json            # ST extension manifest (display_name, js, version, auto_update)
package.json             # pnpm scripts: build/dev/test/lint/lint:fix/typecheck
eslint.config.mjs        # ESLint 9 flat config
.prettierrc              # Prettier config
AGENTS.md                # Living project map (constitution governance)
```

**Structure Decision**: Single-project extension layout (constitution I) modeled on the
proven 3DDiceRolls pattern (constitution VIII), with a strict `core/` ↔ `adapters/` ↔
`ui/` layering so core logic stays framework-free and testable (constitution V) and all
app access funnels through one typed adapter boundary (constitution II).

## Complexity Tracking

No constitution violations to justify — table intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
