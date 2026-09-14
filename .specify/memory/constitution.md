<!--
=== SYNC IMPACT REPORT ===
Version change: 1.0.0 → 1.1.0 (MINOR: new principle added)
Modified principles: None renamed
Added sections:
  - Core Principle IX. Language Policy
Removed sections: None
Follow-up TODOs: None
Previous change: 1.0.0 initial ratification (Principles I–VIII, Additional Constraints,
  Development Workflow & Quality Gates, Governance)
=== END REPORT ===
-->

<!--
=== SYNC IMPACT REPORT (2026-09-08) ===
Version change: 1.1.0 → 1.2.0 (MINOR: expanded guidance in Additional Constraints)
Modified principles: None renamed
Added sections:
  - Additional Constraints → "Shared UI style system" (owner decision 2026-09-08:
    one shared SCSS system; extend it, never add one-off component styles)
Removed sections: None
Follow-up TODOs: None
Previous change: 1.1.0 (Core Principle IX. Language Policy)
=== END REPORT ===
-->

# SillyTavern-WorldInfo-Workspace Constitution

## Core Principles

### I. Holistic, Modular Plugin

The extension ships as one coherent SillyTavern plugin (single `manifest.json`, single
webpack bundle) composed of self-contained modules. Each module MUST have a single clear
purpose, an explicit public surface, and be independently testable. Cross-module access
MUST go through a module's exported API, never its internals. Features MUST NOT be built
as throwaway scripts wired directly into the entry point.

### II. App API First (Context-Driven)

The plugin MUST use SillyTavern's own APIs — accessed via
`globalThis.SillyTavern.getContext()` — instead of reimplementing or forking app behavior.
The vendored reference at `context/SillyTavern/public/scripts/st-context.js` (and the rest
of `context/SillyTavern/`) is the source of truth for available signatures and MUST be
consulted before writing any integration code. When a capability is missing, prefer
documented extension points (events, slash commands, macros, `setExtensionPrompt`) or
upstream APIs; direct DOM probing of app-internal state is a last resort and MUST be
isolated in a single adapter module.

### III. Strict TypeScript (NON-NEGOTIABLE)

All source MUST be TypeScript compiled under `strict`. `any` and type assertions that
bypass checking MUST be justified inline at the escape site. Module boundaries, setting
schemas, and all app-API call sites MUST be fully typed, with SillyTavern API types
declared in a dedicated ambient declaration (e.g. `global.d.ts`). `tsc --noEmit` MUST
pass with zero errors before any commit is accepted.

### IV. Lint & Format Discipline (NON-NEGOTIABLE)

The repository MUST ship ESLint (flat config, TypeScript-aware) and Prettier
(`.prettierrc`); formatting belongs to Prettier and lint rules MUST be tuned to complement
it, not fight it. `lint` and `tsc --noEmit` MUST pass with zero errors and zero new
warnings for a change to merge. Any lint suppression (`eslint-disable`) MUST carry an
inline justification.

### V. Test-First

Core logic (world-info parsing, diffing, persistence, command handling) MUST be pure and
framework-free so it is unit-testable with Vitest. Tests are written first and approved
before implementation (red → green → refactor). A bug fix MUST begin with a failing
regression test.

### VI. Integration Testing

Integration tests MUST cover: the `getContext()` surfaces this plugin depends on
(verified against `context/SillyTavern/` references), world-info read/save round-trips,
settings persistence, and UI injection points. Any change to the plugin's public
event/hook contracts MUST update contract tests in the same change.

### VII. Extension Interop Hooks

The plugin MUST expose a small, stable, event-based hook surface for other extensions,
following the proven pattern in `context/SillyTavern-3DDiceRolls`
(`ctx.eventSource.emit('<ext>:action', payload)`). Hooks MUST be namespaced
(`wi-workspace:*`), payload-typed, and documented in `AGENTS.md`. Hooks are extended only
additively; a breaking hook/payload change is a MAJOR version event for the plugin.

### VIII. Proven Pattern, Spec-Driven Execution

The architecture, tooling, and conventions of `context/SillyTavern-3DDiceRolls`
(React 18 + Webpack + SCSS with theme variables, `utils/`/`components/` separation,
settings module, logging module, `AGENTS.md`) are the baseline pattern for this project.
Improvements over that pattern MUST go through the speckit workflow
(specify → plan → tasks → implement) so each improvement is specified, reviewed, and
traceable rather than ad-hoc.

### IX. Language Policy

Conversation with the assistant MAY be in any language, and responses MUST match the
language the user is writing in. All project artifacts MUST be English-only: source code,
comments, specs, plans, task lists, UI text, documentation (`AGENTS.md`, README),
commit messages, and hook/setting identifiers. UI strings MUST be authored in English
(through the app's i18n mechanism where applicable, with English as the source locale) so
localization can layer on later without rewriting code.

## Additional Constraints

Technology stack and environment requirements:

- Runtime: SillyTavern UI extension. `manifest.json` carries `display_name`,
  `js: dist/index.js`, semver `version`, and `auto_update`.
- Language: TypeScript (strict). UI: React 18. Bundler: Webpack. Styles: SCSS using
  SillyTavern `--SmartTheme*` CSS variables. Icons: Font Awesome 6 Free.
- Package manager: pnpm. Package scripts MUST include `build`, `dev` (watch), `test`
  (Vitest), `lint` / `lint:fix`, and `typecheck` (`tsc --noEmit`).
- `context/` is read-only reference material (SillyTavern app source, prior extensions,
  `variables.css`). It MUST NOT be imported into or bundled with the plugin.
- State: extension settings live under `extension_settings[MODULE_NAME]` with getters
  returning copies; per-chat state lives in `chat_metadata`; saves use app-provided
  debounced savers.
- Logging MUST go through a namespaced logging util (console debug in dev, toastr
  info/warn/error for user-visible feedback).
- Slash commands MUST be registered through the app's slash-command API with typed
  arguments; macros via `macros.register` with a plugin-owned namespace.
- UI is injected at documented mount points via manual React roots and styled to match
  the active app theme.
- Shared UI style system (amendment 1.2.0): ALL component styling MUST use the shared
  SCSS system in `src/styles/` (`wiw-theme.scss` primitives + theme variables; partials
  composed through `prototype.scss`), styled only through the app's `--SmartTheme*`
  custom properties. One-off component styles are forbidden: when a surface needs
  something new, EXTEND the shared system so every surface stays consistent and easy
  to adjust; rework the system, never the individual element.

## Development Workflow & Quality Gates

- Every feature or material change follows the speckit pipeline:
  `/speckit.specify` → `/speckit.plan` → `/speckit.tasks` → `/speckit.implement`.
  Code without a corresponding spec MUST NOT be accepted.
- Quality gates, all of which MUST pass before commit/merge: typecheck, lint, full test
  suite.
- `AGENTS.md` is the living map of the project (structure, settings schema, public API,
  hook surface) and MUST be updated in the same change that alters any of those.
- Any deviation from a principle requires written justification in the plan and MUST be
  revisited at review.

## Governance

- This constitution supersedes all other project practices and documents; conflicts
  resolve in its favor.
- Amendments require a documented change with rationale, a semver version bump
  (MAJOR: principle removal or incompatible redefinition; MINOR: new principle or
  materially expanded guidance; PATCH: wording/clarification), and a migration note when
  behavior-affecting.
- Compliance review: every plan and code review MUST verify adherence to Principles
  I–IX; unjustified complexity MUST be rejected.
- Runtime development guidance lives in `AGENTS.md`; `.specify/templates` defines the
  spec/plan/task document structure.

**Version**: 1.2.0 | **Ratified**: 2026-09-05 | **Last Amended**: 2026-09-08
