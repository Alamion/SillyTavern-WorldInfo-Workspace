# Research — Workspace UI Prototype (002-workspace-ui-prototype)

Reuses `specs/001-workspace-plugin-roadmap/research.md` (R1–R9) as the base; this file
covers only what the prototype phase adds or decides.

## R1. Entry-point replacement — the proven pattern (resolves the key unknown)

**Decision**: Do NOT intercept clicks and do NOT patch host functions. Co-opt the native
`#WorldInfo` drawer exactly as WorldInfoDrawer does:
1. Append the extension's root `<div>` into the native `#WorldInfo` drawer-content
   (`document.querySelector('#WorldInfo').append(root)`).
2. Toggle a body-level class (e.g., `body.wiw-active`) whose CSS (a) hides the native
   `#wi-holder`, (b) stretches `#WorldInfo` to a fullscreen editor surface
   (`width: 100vw; height: calc(100dvh - var(--topBarBlockSize))`).
3. Detect open/close with a MutationObserver on `#WorldInfo`'s `class`/`style`
   attributes (the host toggles `openDrawer`/`closedDrawer`; older builds wrote inline
   `display:none` — observe both).
4. Treat teardown as page reload only; guard double-init with a `data-*` witness.

**Rationale** (verified against sources): the native button `#WIDrawerIcon` is a generic
navbar drawer (`script.js:12088` binds `doNavbarIconClick` to all `.drawer-toggle` once;
`doNavbarIconClick` at `script.js:10893` only flips classes). Riding the host's own
state machine means every open path keeps working for free: the physical button, pin
(`#WI_panel_pin`), outside-click autoclose, and programmatic opens
(`openWorldInfoEditor()` → `$('#WIDrawerIcon').trigger('click')`, used by `#world_button`
and select2 quick-select; `world-info.js:5818`). Click-interception or function patching
would have to re-implement all of those and would break on host updates.

**Constitution note (II)**: this is DOM composition against host-stable IDs
(`#WorldInfo`, `#wi-holder`, `--topBarBlockSize`) — the documented last-resort path,
isolated entirely in `src/adapters/shell.ts`. No jQuery-triggered host internals, no
direct imports of host modules (WorldInfoDrawer imports `getWorldEntry`/`worldInfoCache`
by relative path — NOT reproducible for a bundled extension and NOT needed: the
prototype renders its own mock UI). Caveat accepted: the native editor still renders
into the hidden `#wi-holder` underneath (harmless at prototype scale).

**Alternatives considered**: (a) click interception on the icon + stopPropagation —
rejected: misses `openWorldInfoEditor()`, `#world_button`, select2 paths; (b) own
floating overlay independent of the drawer — rejected: loses pin/autoclose/programmatic
opens and the "replacement" positioning; (c) patching `showWorldEditor` — rejected:
host-function patching violates constitution II and is fragile.

## R2. Layout approach

**Decision**: Three-region layout INSIDE the stretched native drawer: header strip
(title + "prototype" label + review-guide toggle), then a flex row: structure tree
(left, fixed min-width, own scroll), item editor (center, flexible), assistant panel
(right, toggleable; collapsible to a rail). Narrow windows degrade to stacked/scrollable
(best effort per spec edge cases; no mobile target).

**Rationale**: matches the full-editor-surface positioning (spec FR-002) and the
WorldInfoDrawer fullscreen CSS pattern (`width: 100vw; height: calc(100dvh -
var(--topBarBlockSize))`), while keeping all host drawer machinery (pin, autoclose).

**Alternatives considered**: tabs-only (regions swap) — rejected for review purposes:
the owner must judge the simultaneous three-region composition; floating panel —
rejected (see R1).

## R3. Theming

**Decision**: All colors, blurs, borders and radii come from `--SmartTheme*` custom
properties consumed directly in SCSS (`var(--SmartThemeBorderColor)` etc.). The app
defines 63 unique `--SmartTheme*` variables (vendored `public/style.css`,
user-configurable via power-user settings); the 3DDiceRolls baseline already consumes
the key ones (`BlurStrength`, `BlurTintColor`, `ChatTintColor`, `BodyColor`,
`BorderColor`, `EmColor`, `QuoteColor`, `GoodColor`, `BadColor`). Prototype uses the
same set; no fixed colors anywhere (spec FR-002). Validation on the app's default
themes; custom community themes corrected post-release (spec assumption).

**Alternatives considered**: own CSS variable namespace with fallbacks — rejected for
the prototype (adds a mapping layer the decision doesn't need); the production UI may
add a small `--wiw-*` derived-variable layer later if needed.

## R4. Sample dataset design

**Decision**: A single typed in-memory dataset module satisfying spec FR-003/FR-004:
- ≥ 3 levels of folder nesting; ≥ 10 cards; ≥ 3 notes; ≥ 2 WI roots; ≥ 1 WI root nested
  inside another WI root (per clarifications: nested root also "exports" its own book in
  the product; the prototype visualizes membership).
- Shapes mirror the production model in `specs/001-workspace-plugin-roadmap/
  data-model.md` (TreeNode kinds, native WI field groups from R1 there) so the
  prototype previews real structures, not throwaway shapes.
- Content: a generic fantasy realm in English (e.g., "Aldermeer" — realm/city/character
  cards + research notes), written to exercise long strings (a 2,000-word card) and a
  many-children folder (30+ entries) per spec edge cases.
- Each WI root carries a settings mock (its own book settings view — spec FR-012); cards
  under nested roots carry a multi-book membership annotation (spec edge case).

**Rationale**: the dataset is the prototype's backbone; aligning it with the production
data model means approved design decisions transfer directly.

**Alternatives considered**: random generator — rejected: review needs stable,
deliberate content; minimal 5-node toy data — rejected: hides real-world density.

## R5. Interactivity scope

**Decision**: In-memory interactivity only: expand/collapse, selection, region toggles,
scroll; "editing" interactions are visual-only (inputs accept text, state lost on
close — spec FR-009); confirm/deny and import/export controls are inert. A visible
"PROTOTYPE — nothing is saved" label persists in the header.

**Rationale**: spec FR-008/FR-009; zero risk to real data; keeps the prototype free of
persistence code so it stays discardable (FR-011).

## R6. Lifecycle and discardability

**Decision**: Init path in `src/index.ts`: after APP_READY, the shell adapter mounts the
root container into `#WorldInfo`, adds the body class, starts the MutationObserver; the
React root renders `WorkspacePrototype` inside it. Teardown = page reload (no runtime
unmount; single `beforeunload` observer cleanup as WorldInfoDrawer does). Discard path:
the prototype modules are leaf modules reachable only from `mount.tsx`/`index.ts` —
removing the prototype call sites removes the phase with no dead dependencies
(spec FR-011).

**Rationale**: matches the host's extension lifecycle reality (disable ⇒ reload) and
keeps the phase isolated.

## R7. Chat-independence and events

**Decision**: The drawer lives in the fixed top navbar — it opens regardless of active
chat; the prototype renders purely from the sample dataset, so no `CHAT_CHANGED`
handling is needed beyond letting the host close/open freely (observer-driven). Init
still waits for `APP_READY` (spec 001 pattern). No `eventSource` subscriptions to WI
events in this phase (no real data involved).

**Rationale**: verified in R1 research — the navbar drawer is chat-independent by
construction; spec edge case "opened while no chat is active" is satisfied
automatically.

## R8. React mounting

**Decision**: Manual `ReactDOM.createRoot()` into the shell-mounted container (the
3DDiceRolls body-injection pattern; no react_widget host machinery). One root for the
whole three-region surface; state kept in local component state (no global store needed
at mock scale).

**Rationale**: proven in the author's prior extension; minimal surface for a
discardable phase.

## Open items

- **Mobile drag-and-drop in the tree** (iteration 5, deferred): HTML5 DnD does not
  fire on touch devices; the tree needs a touch-friendly move mechanism (long-press drag, move-to-folder context action, or a dedicated reorder mode). Design during the
next planning step.

- **ST macro resolution in the md preview** (iteration 2, deferred by owner): preview
  should eventually replace ST macros (`{{user}}`, `{{char}}`, `{{roll:...}}`, ideally
  universally) with their real values resolved by the app. Requires research into an app
  API for macro substitution (candidates from spec 001 research R4:
  `substituteParams`/`substituteParamsExtended`, `macros` registry). Recorded for the
  next planning step — intentionally NOT implemented in the prototype.
- R1–R8 from the original plan: all resolved.
