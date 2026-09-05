# AGENTS.md — WorldInfo Workspace

## Project

SillyTavern UI extension: **World Info Workspace** — a single integrated workspace for
lore management. It unifies a flexible folder tree (cards, notes, any depth),
workspace-authoritative sync into the native World Info format via designated "World
Info" root folders, an in-workspace AI lore assistant, and bidirectional markdown
conversion. Roadmap and full requirements: `specs/001-workspace-plugin-roadmap/`.

**Current increment (spec 001)**: project initialization + tooling only. Feature work is
deferred — see the Deferred Work table in `specs/001-workspace-plugin-roadmap/tasks.md`.

## Key Reference

**Always check `specs/001-workspace-plugin-roadmap/research.md`** for the native World
Info field inventory, save mechanics (`saveWorldInfo` clone discipline, debounce, server
contract), the `getContext()` API surface, and event constants — all derived from the
vendored app source in `context/SillyTavern/`.

## Commands

| Command                      | Purpose                                        |
| ---------------------------- | ---------------------------------------------- |
| `pnpm install`               | Install dependencies                           |
| `pnpm run build`             | Production build to `dist/index.js` (webpack)  |
| `pnpm run dev`               | Watch mode (webpack, source maps)              |
| `pnpm run test`              | Vitest suite                                   |
| `pnpm exec tsc --noEmit`     | Typecheck (also `pnpm run typecheck`)          |
| `pnpm run lint` / `lint:fix` | ESLint 9 flat config + TS                      |

All four gates (`typecheck`, `lint`, `test`, `build`) MUST pass before any commit
(constitution III/IV/V/VI).

## Constitution

`.specify/memory/constitution.md` — principles I–IX:

1. Holistic, modular plugin (single manifest/bundle, explicit module surfaces)
2. App API first — everything via `globalThis.SillyTavern.getContext()`; never fork app
   internals; `context/SillyTavern/` is read-only reference and is never bundled
3. Strict TypeScript — `strict`, no `any`, app types in `src/global.d.ts`
4. Lint & format discipline — ESLint 9 flat config + `.prettierrc`; zero errors
5. Test-first for core logic (Vitest)
6. Integration tests against `getContext()` surfaces
7. Extension interop hooks — namespaced `wi-workspace:*` events, additive only
8. Proven pattern (SillyTavern-3DDiceRolls) + spec-driven execution (speckit)
9. Language policy — conversation in any language; ALL artifacts (code, specs, UI,
   docs, commits) English-only

## Project Structure

Target layout (from `specs/001-workspace-plugin-roadmap/plan.md`). **No empty
files/folders**: directories are created only by the tasks of the feature that first
needs them.

```
src/
├── core/        # Pure logic (tree, wi, md, assistant) — Vitest-first, no app imports   [future specs]
├── adapters/    # App boundary: books, storage, events, llm wrappers                    [future specs]
├── ui/          # React components (tree, card editor, assistant panel)                 [future specs]
├── interop/     # Public event API, slash commands, macro                               [future specs]
├── styles/      # SCSS using --SmartTheme* variables                                    [future specs]
├── global.d.ts  # Typed SillyTavern API surface (grows per feature)
└── index.ts     # Entry point: idempotent init, APP_READY subscription
tests/
├── manifest.test.ts   # Manifest contract test (tooling validation)
└── unit|integration|contract/                                                         [future specs]
dist/           # Built bundle — TRACKED in git (manifest.json points here)
manifest.json   # ST extension manifest (display_name, js: dist/index.js, semver)
```

## Settings

Workspace state will persist under `extensionSettings['WorldInfoWorkspace']` (see
`specs/001-workspace-plugin-roadmap/data-model.md`). Not implemented yet.

## SillyTavern Integration

- `globalThis.SillyTavern.getContext()` — main API, typed in `src/global.d.ts`
- Extension docs: https://docs.sillytavern.app/for-contributors/writing-extensions/
- World Info docs: https://docs.sillytavern.app/usage/core-concepts/worldinfo/

## Context

Read-only reference material lives in `context/` (git-ignored, never bundled):

- `context/SillyTavern/` — vendored app source (`public/scripts/st-context.js`,
  `public/scripts/world-info.js` are the primary references)
- `context/SillyTavern-3DDiceRolls/` — author's previous extension; baseline pattern
- `context/SillyTavern-WorldInfo-Recommender/`, `context/SillyTavern-WorldInfoDrawer/` —
  functional baselines this plugin unifies
- `context/variables.css` — all SillyTavern theme variables

## Symbols and emojis

The source app uses `Font Awesome 6 Free` for custom symbols; follow the same pattern
where the font has a suitable icon.
