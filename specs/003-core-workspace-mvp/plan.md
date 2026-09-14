# Implementation Plan: Core Workspace MVP (Phase 1)

**Branch**: `003-core-workspace-mvp` | **Date**: 2026-09-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-core-workspace-mvp/spec.md` (Phase 1 of
the roadmap: US2 flexible tree, US3 reliable persistence, US4 native WI sync + import),
building on the delivered Phase 0 shell and approved UI.

## Summary

Turn the approved prototype into the production core workspace: the three-region surface
switches from in-memory sample data to a real persisted workspace (tree of folders /
entries / images) that survives UI close, chat switch, and app restart; every edit saves
reliably (no focus steal, visible failures with retry, flush before generation); folders
designated as World Info roots own native books — created on designation (inactive),
flattened from the subtree on sync through the app's World Info save pipeline, divergence-
guarded in both push and import directions — and native lorebooks import into the tree
losslessly. The workspace also provides the replacement book-management surface (all-books
list with activation) that the native editor used to own.

Key technical approach (details in research.md): workspace state persists under
`extensionSettings['WorldInfoWorkspace']` with debounced app settings saves; books are
written via `saveWorldInfo` (structured clones, debounce/immediately); sync bookkeeping
per entity (uid, fingerprint, status) drives workspace-authoritative push, orphan
handling, and import/divergence flows; capabilities missing from `getContext()`
(book create/delete, active-books state) are composed inside isolated adapters from the
app's own documented endpoints and controls.

## Technical Context

**Language/Version**: TypeScript (strict, `noUncheckedIndexedAccess`) compiled by webpack
to a single ES bundle for the SillyTavern browser runtime.

**Primary Dependencies**: React 18 (manual roots, no host widget), SCSS consuming
`--SmartTheme*` variables, Font Awesome 6 Free icons; app APIs exclusively via
`globalThis.SillyTavern.getContext()`; toastr via window global (not context-exposed).

**Storage**: (a) workspace organizational state — `extensionSettings['WorldInfoWorkspace']`
persisted inside the app's `settings.json` via `saveSettingsDebounced()` (1000 ms debounce;
whole-payload save); (b) native World Info book files — written only through the app's
World Info save pipeline (`saveWorldInfo` → `POST /api/worldinfo/edit`, 1000 ms debounce or
immediate); (c) active-books activation state — the app's own `selected_world_info`
(runtime) / `settings.world_info_settings.world_info.globalSelect` (persisted), driven
through the native `#world_info` control (adapter-isolated).

**Testing**: Vitest unit suite (pure core logic), contract tests asserting adapter usage
against the verified app API surface (`context/SillyTavern/`), manual quickstart
validation in a running app.

**Target Platform**: SillyTavern UI extension (desktop browsers + touch devices; the app
hosts the drawer).

**Project Type**: Browser UI extension (single `manifest.json` + `dist/index.js`).

**Performance Goals**: Per spec SC-006/SC-007 — folder+entry creation < 30 s, move < 10 s;
300+ node tree renders/scrolls/edits without perceptible delay; 100-entry sync does not
block interaction for more than a few seconds (sync is incremental and debounced).

**Constraints**: Strict TypeScript (no `any`); all four gates (typecheck/lint/test/build)
green; English-only artifacts; app theme variables only; `context/` never bundled;
no server plugin; no `wi-workspace:*` interop events in this phase (Phase 4).

**Scale/Scope**: One global workspace per installation; hundreds of tree nodes; multiple
World Info roots (nested allowed); 100-entry books must round-trip losslessly.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Holistic, modular plugin | PASS | Core logic split into pure modules with explicit surfaces (`core/tree`, `core/sync`, `core/state`, `core/demo`); app boundary confined to `adapters/`; UI in `ui/`. Single bundle/manifest unchanged. |
| II. App API first | PASS with documented exceptions | Everything via `getContext()`; three capabilities are not exposed by the context (book create/delete APIs, active-books state) — composed from the app's own documented endpoints/controls inside isolated adapters; see Complexity Tracking. |
| III. Strict TypeScript | PASS | `src/global.d.ts` grows to cover every used context member; no `any`; no unchecked assertions (justified inline if unavoidable). |
| IV. Lint & format discipline | PASS | Existing ESLint 9 flat config + Prettier apply to all new modules; gates run before commit. |
| V. Test-first | PASS | Vitest-first modules enumerated in research R9 (tree ops, flatten, fingerprints, divergence, import mapping, naming, validation, demo seed). |
| VI. Integration testing | PASS | Contract tests for context usage (world-info round-trip payloads, settings save discipline, event payloads verified against vendored sources); quickstart manual pass. |
| VII. Interop hooks | PASS (n/a this phase) | No new `wi-workspace:*` events in Phase 1 (spec out-of-scope); no breaking changes to existing surface. |
| VIII. Proven pattern, spec-driven | PASS | React+webpack+SCSS pattern per 3DDiceRolls baseline; this plan follows speckit flow. |
| IX. Language policy | PASS | All artifacts English; UI strings English. |

## Project Structure

### Documentation (this feature)

```text
specs/003-core-workspace-mvp/
├── plan.md              # This file
├── research.md          # Phase 0 output — app API verification + design decisions
├── data-model.md        # Phase 1 output — persisted state, sync bookkeeping, transitions
├── contracts/           # Phase 1 output — persistence schema + native WI usage contract
│   ├── persistence-schema.md
│   └── native-wi-contract.md
├── quickstart.md        # Phase 1 output — end-to-end validation guide
└── tasks.md             # Phase 2 output (/speckit.tasks) — NOT created here
```

### Source Code (repository root)

```text
src/
├── core/                        # Pure logic — no app imports (Vitest-first)
│   ├── state/
│   │   ├── schema.ts            # WorkspaceState types, defaults, version migration
│   │   └── store.ts             # Framework-free observable store + reducers over schema
│   ├── tree/
│   │   ├── operations.ts        # create/rename/move/reorder/delete (+cycle checks)
│   │   ├── browse.ts            # sort modes, kind filters, title/prompt search
│   │   └── validation.ts        # name rules, native field rules (surface, never reset)
│   ├── sync/
│   │   ├── flatten.ts           # root subtree → native book payload (uid alloc, displayIndex)
│   │   ├── convert.ts           # image entity ↔ native entry encoding (FR-013 merged model)
│   │   ├── fingerprint.ts       # deterministic stringify + FNV-1a entry fingerprint
│   │   ├── divergence.ts        # workspace vs native comparison, push guards
│   │   ├── import.ts            # native book → workspace folder/entities mapping
│   │   └── bookNaming.ts        # free-name resolution ("Base (N)" pattern)
│   └── demo/
│       └── dataset.ts           # 'Aldermeer' seed as a WorkspaceState (no WI designations)
├── adapters/                    # App boundary — the only host-facing modules
│   ├── shell.ts                 # (existing, Phase 0) drawer co-opt
│   ├── appApi.ts                # single getContext() accessor + typed surface
│   ├── settingsStore.ts         # extensionSettings load/save (debounced), migrations
│   ├── worldInfoAdapter.ts      # load/save books; create/delete/rename composition
│   ├── activeBooksAdapter.ts    # read + drive the native active-books control
│   ├── eventsAdapter.ts         # WORLDINFO_UPDATED / GENERATION_STARTED / SETTINGS_* wiring
│   └── popups.ts                # confirmations via app Popup APIs
├── ui/                          # React (reworks Phase 0 components onto the real store)
│   ├── WorkspaceApp.tsx         # replaces WorkspacePrototype as layout root
│   ├── StructureTree.tsx        # real tree ops, toolbar, multi-select, DnD + touch menu
│   ├── ItemEditor.tsx           # live editing, validation display, focus-safe fields
│   ├── fieldGroups/FieldGroups.tsx
│   ├── ActiveBooksPanel.tsx     # replacement book list (all books, activation, roots)
│   ├── AssistantPanel.tsx       # Phase 0 mock retained (Phase 2 scope)
│   ├── ReviewGuide.tsx          # removed with prototype phase
│   └── mount.tsx
├── global.d.ts                  # app API types (grows)
└── index.ts                     # init: shell mount, store bootstrap, event wiring

tests/
├── unit/                        # Vitest — pure core modules (schema, tree, sync, demo)
└── contract/                    # adapter usage vs verified app surface (payload shapes)
```

**Structure Decision**: Single-project extension layout established in specs 001/002,
extended with pure `core/` domains (`state`, `tree`, `sync`, `demo`) and the adapter set
listed above. The prototype's throwaway parts (`ReviewGuide`, sample-as-default) are
removed or demoted per FR-001; `AssistantPanel` stays as the labeled mock until Phase 2.

## Complexity Tracking

> Justified deviations from the constitution / app-API-first rule. Both stem from the
> same verified fact: `getContext()` does not expose `createNewWorldInfo`,
> `deleteWorldInfo`, or `selected_world_info` (verified against
> `context/SillyTavern/public/scripts/st-context.js` and `world-info.js`).

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Adapter calls the app's own documented server endpoints directly (`POST /api/worldinfo/delete`, `POST /api/files/sanitize-filename`) inside `worldInfoAdapter` | FR-019 (root deletion offers keep-or-delete of the book) and FR-022/FR-023 (book list with delete; collision-resolved naming) require book deletion and name sanitization; no context member exists for either | Forking/copying app internals violates Principle II; skipping delete breaks the spec; the endpoints are the same ones the app's own `world-info.js` client uses (not side-channel file writes) |
| Adapter drives the native `#world_info` select (read values; set values + `change` trigger) inside `activeBooksAdapter` | FR-017 (workspace owns the active-books list) needs a runtime write path into the app's module-level `selected_world_info`, which generation reads directly; the host's own change handler is the only sanctioned writer (it also persists `globalSelect` and emits `WORLDINFO_SETTINGS_UPDATED`) | Writing `settings.world_info_settings…globalSelect` directly does not update the runtime module state; patching host functions is forbidden (Principle II); DOM composition is the documented last resort and stays isolated in one adapter |