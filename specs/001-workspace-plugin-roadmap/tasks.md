---

description: "Task list for 001-workspace-plugin-roadmap — Scope: project initialization + tooling only"
---

# Tasks: Integrated Lore Workspace — Project Initialization & Tooling

**Input**: Design documents from `/specs/001-workspace-plugin-roadmap/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Scope guard (owner decision, 2026-09-05)**: This increment implements ONLY full project
initialization and working-tool setup (linters, testers, build, project map). Feature
work (spec user stories US1–US6 / roadmap Phases 0–4) is explicitly DEFERRED to future
feature specs — see "Deferred Work" at the bottom. No user-story tasks appear here.

**No empty artifacts rule**: Every created file/folder MUST receive real, complete content
in its task. Target directories from plan.md (`src/core/`, `src/adapters/`, `src/ui/`,
`src/interop/`, `tests/unit|integration|contract/`) are NOT pre-created; they are created
by the tasks of the future specs that first need them. `AGENTS.md` (T012) documents the
target layout meanwhile.

**Tests**: One real test is included (manifest contract test, T011) as tooling validation.
Feature test suites arrive with their stories in future specs.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (none in this increment — stories deferred)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Minimal working SillyTavern extension skeleton — real code only, no stubs.

- [x] T001 Create the extension manifest in `manifest.json`: `display_name: "World Info Workspace"`, `loading_order`, `requires: []`, `optional: []`, `js: "dist/index.js"`, `css: ""`, `author: "Alamion"` (same author as `context/SillyTavern-3DDiceRolls/manifest.json`), `version: "0.1.0"` (semver), `auto_update: true`; omit `homePage` until the repository URL exists. Reference: `context/SillyTavern-3DDiceRolls/manifest.json` pattern.
- [x] T002 Create `package.json`: name `sillytavern-worldinfo-workspace`, `private: true`, `version: "0.1.0"`; scripts per constitution IV/plan.md: `build` (webpack production), `dev` (webpack watch), `test` (vitest run), `lint` / `lint:fix` (eslint), `typecheck` (`tsc --noEmit`); devDependencies: TypeScript 5.x, React 18 + ReactDOM + `@types/react` + `@types/react-dom`, Webpack 5 + webpack-cli + ts-loader, css-loader + style-loader + sass + sass-loader, Vitest 3.x, ESLint 9 + `@eslint/js` + `typescript-eslint` + `eslint-config-prettier`, Prettier. Then run `pnpm install` to generate `pnpm-lock.yaml`.
- [x] T003 [P] Create `tsconfig.json`: `strict: true` (constitution III), `target: "ES2020"`, `module: "ESNext"`, `moduleResolution: "bundler"`, `jsx: "react-jsx"`, `esModuleInterop: true`, `skipLibCheck: true`, `noUncheckedIndexedAccess: true`, `noEmit: false`, `sourceMap: true`, `outDir: "dist"`; `include: ["src/**/*", "tests/**/*"]`, exclude `dist`, `node_modules`.
- [x] T004 [P] Create `.gitignore`: `node_modules/`, `coverage/`, `.idea/`, `*.log`, `.DS_Store`. Do NOT ignore `dist/` — the built bundle MUST be committed because `manifest.json` points to `dist/index.js` (extensions are installed from the repository).
- [x] T005 Create `src/index.ts` — a genuinely working minimal entry point (constitution II): define an idempotent `initWorkspace()` that (1) guards double initialization via a flag on `globalThis`, (2) reads `globalThis.SillyTavern.getContext()`, (3) subscribes to `eventTypes.APP_READY` on `ctx.eventSource`, (4) on ready emits one `console.debug('[WorldInfoWorkspace] initialized')` and nothing else; call it at module load; export `initWorkspace` for tests. No placeholder functions, no TODOs.

## Phase 2: Foundational (Tooling & Quality Gates)

**Purpose**: The working-tool layer the constitution mandates — all gates runnable before
any feature work begins.

- [x] T006 [P] Create `eslint.config.mjs` (ESLint 9 flat config, TS-aware): `@eslint/js` recommended + `typescript-eslint` recommended (type-checked where cheap) + `eslint-config-prettier` last; ignore `dist/`, `node_modules/`, `pnpm-lock.yaml`; forbid unused vars/args, enforce `no-explicit-any` as error (constitution III), allow inline disables only with a preceding justification comment (documented in file header comment).
- [x] T007 [P] Create `.prettierrc` (`tabWidth: 4`, `printWidth: 120`, `semi: true`, `singleQuote: false`, `trailingComma: "all"`, `endOfLine: "lf"`) and `.prettierignore` (`dist/`, `node_modules/`, `pnpm-lock.yaml`, `specs/`, `.specify/`) — formatting owned by Prettier, lint rules complement it (constitution IV).
- [x] T008 Create `webpack.config.js`: entry `src/index.ts`, output `dist/index.js` (clean build, source maps in dev); rules: `.ts`/`.tsx` via ts-loader (honoring `tsconfig.json`), `.scss` via sass-loader + css-loader + style-loader (theme variables come later with UI phases); resolve `.ts`, `.tsx`; production mode via `--env`/mode flag consumed by the `build`/`dev` scripts.
- [x] T009 [P] Create `vitest.config.ts`: node environment, include `tests/**/*.test.ts`, alias-free (core logic stays import-relative for now), no global test APIs (explicit `import { describe, it, expect } from 'vitest'`).
- [x] T010 [P] Create `src/global.d.ts` — typed app API surface (constitution III, research.md R4): declare `interface SillyTavernContext` with the members this increment actually touches (`eventSource`, `eventTypes` including `APP_READY`, `extensionSettings`, `saveSettingsDebounced`, plus WI members `loadWorldInfo`, `saveWorldInfo`, `getWorldInfoNames` typed per research.md R1/R3) and declare `interface Window { SillyTavern?: { getContext(): SillyTavernContext } }` + `globalThis` equivalent; header comment states this file grows per feature, sourced from `specs/001-workspace-plugin-roadmap/research.md` — no `any`.
- [x] T011 Create `tests/manifest.test.ts` — real tooling-validation test: read `manifest.json`, assert required ST manifest contract (per `context/SillyTavern-3DDiceRolls/manifest.json` shape): `display_name` is a non-empty string, `js === "dist/index.js"`, `version` matches semver, `author` non-empty, `auto_update` is boolean, `requires`/`optional` are arrays; assert `css` is a string.
- [x] T012 Create `AGENTS.md` — the living project map ("где что лежит"): project purpose (1 paragraph, references spec 001), commands table (`pnpm install/build/dev/test/lint/lint:fix/typecheck`), constitution pointer (`/speckit.constitution` artifacts live in `.specify/memory/constitution.md` — principles I–IX summarized in one line each), a "Project Structure" section listing the TARGET layout from plan.md with an explicit note that directories appear only when a feature first needs them (no empty dirs policy), pointers to `specs/001-workspace-plugin-roadmap/research.md` (native WI field inventory, save mechanics) and `contracts/contracts.md`, settings namespace `WorldInfoWorkspace`, and the English-only artifacts rule (constitution IX).
- [x] T013 Final gate — run and fix until green: `pnpm install` (if not yet), then `pnpm run typecheck && pnpm run lint && pnpm run test && pnpm run build`; verify `dist/index.js` exists and `manifest.json` references it; manually load the extension in a running SillyTavern (`context/SillyTavern/`) and confirm the console.debug line from T005 appears with no console errors (quickstart.md Scenario 1 smoke, limited to initialization). — AUTOMATED PORTION COMPLETE (all gates green, `dist/index.js` built); in-app load is the owner's manual step.

**Checkpoint**: Foundation ready — `typecheck`, `lint`, `test`, `build` all pass; the
extension loads in SillyTavern and initializes cleanly. Feature work may now begin, but
only in future feature specs (see Deferred Work).

## Deferred Work (NOT tasks in this increment)

Per owner decision (2026-09-05), the following are intentionally excluded from this
tasks.md. Each future increment runs its own `/speckit.specify` → `/speckit.plan` →
`/speckit.tasks` cycle and will introduce its directories/files then (no empty artifacts):

| Roadmap phase | Spec stories | Future feature spec |
|---------------|--------------|---------------------|
| 0 — Prototype | US1 (prototype validation) | next spec: workspace UI prototype with mocked data |
| 1 — Core Workspace MVP | US2 (flexible tree), US3 (persistence), US4 (native WI sync) | following spec(s) |
| 2 — AI Assistant | US5 | later spec |
| 3 — Markdown Conversion | US6 | later spec |
| 4 — Hardening & Interop | hooks/events surface, performance, docs | later spec |

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: T001–T005 — T002 must precede `pnpm install`; T005 depends on T003 (tsconfig) and T010's types file may land in parallel (T005 compiles once both exist).
- **Phase 2 (Foundational)**: T006–T012 depend on Phase 1 files existing (T002 scripts, T003 tsconfig, T008 webpack). T013 (final gate) is last and blocks nothing inside this increment — it validates everything.
- **No user-story phases exist** in this increment (deferred by owner decision).

### Task Parallelism

- **Parallel batch 1 (after T002/T003)**: T003, T004, T006, T007, T009, T010
- **Parallel batch 2**: T008 (webpack), T012 (AGENTS.md)
- **Sequential**: T001 → T002 → T005 → T011 → T013

### Parallel Example

```bash
# After package.json + tsconfig.json exist, run together:
Task: "T003 tsconfig.json"
Task: "T004 .gitignore"
Task: "T006 eslint.config.mjs"
Task: "T007 .prettierrc + .prettierignore"
Task: "T009 vitest.config.ts"
Task: "T010 src/global.d.ts"
```

---

## Implementation Strategy

- **This increment IS the MVP scope**: Phases 1–2 complete with all four gates green and
  a clean load in SillyTavern. Nothing else ships here.
- Commit after each task (or tight logical group); the repo has no remote branches yet —
  work directly on the default branch until the owner decides otherwise.
- Every file created by a task contains complete, functional content — placeholders,
  TODO-only files, and empty directories are forbidden (owner rule).

## Notes

- [P] tasks = different files, no dependencies between them.
- Tests are limited to tooling validation (T011); feature tests belong to future story
  phases (constitution V applies to feature logic when it arrives).
- Stop at the Phase 2 checkpoint and validate (T013) before scheduling any future feature
  spec.
