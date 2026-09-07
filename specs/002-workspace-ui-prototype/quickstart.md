# Quickstart — Workspace UI Prototype (002-workspace-ui-prototype)

Validation scenarios for the approved prototype (Phase 0, closed 2026-09-05). Keep for
regression checks when the production editor reuses these patterns.

## Prerequisites

- Spec 001 tooling initialized (pnpm, gates); SillyTavern running with the extension
  built and enabled.
- Rebuild after checkout: `pnpm install && pnpm run build` (hard-reload the browser tab —
  extension bundles are served without cache-busting).

## Automated gates (every change)

```bash
pnpm run typecheck   # zero errors (constitution III)
pnpm run lint        # zero errors / zero new warnings (constitution IV)
pnpm run test        # Vitest: manifest, dataset, tree ops, markdown, diff contracts
pnpm run build       # dist/index.js produced
```

## Scenario 1 — Entry-point replacement (shell)

1. Load SillyTavern with the extension enabled; open any chat (or none — must work
   without an active chat).
2. Click the native World Info button (`#WIDrawerIcon`) in the top navbar.
3. **Expect**: the workspace surface opens INSTEAD of the native editor; native
   `#wi-holder` not visible; compact header (Workspace badge, guide/assistant icons);
   "PROTOTYPE" wording as the badge tooltip.
4. Close via the drawer title, outside click, another navbar drawer; pin via
   `#WI_panel_pin` — all behave natively.

## Scenario 2 — Tree toolbar and structure (US2)

1. Expand nested folders — ≥ 3 levels with indentation; entries vs images distinguished
   by icons; WI badges on ≥ 2 designated folders (one nested).
2. Sort: switch title/position/depth/order/trigger — entries reorder everywhere;
   "Custom order" restores drag-ordering.
3. Filter: toggle kind chips and search by Title / Prompt / Title+Prompt — non-matching
   nodes disappear while ancestor folders of matches stay visible.
4. Create: New folder/entry/image lands in the selected folder (or parent of selection).
5. Drag-and-drop (PC): move an entry between folders; in Custom order, drop it onto a
   sibling to insert before it.
6. Wide Sandbox folder scrolls; long names truncate.

## Scenario 3 — Editor views (US3)

1. Select the default entry — Essentials (title row with disable toggle, keys row,
   strategy + insertion row, probability/inclusion row), Content, Advanced.
2. Edit the title; toggle disable via the header icon; duplicate (a "(copy)" appears
   right after) and delete (confirmation prompt, selection clears).
3. Content: textarea with live markdown preview (headings, lists, bold, links, code,
   embedded image); drag the split divider (PC); Hide/Show preview.
4. Select a WI-root folder — per-root settings grid + "Disable World Info root";
   select a plain folder — "Make World Info root" (badges and memberships update live).
5. Select an image — preview and caption.

## Scenario 4 — Assistant mock (US4)

1. Open the assistant (icon button) — scripted conversation: user request → batch
   proposal listing several operations, each with its own Accept/Deny and a decision
   badge; Accept/Deny all pending; clear "MOCK - no AI calls" labeling and an inert
   AI-settings button.
2. "Diff" on the edit proposal opens a modal: Before/After panes with removed parts
   highlighted red (`--crimson70a`) and added parts green (`--okGreen70a`).
3. No network calls (devtools); state stable across panel toggles.

## Scenario 5 — PC layout (splitter)

1. Drag the tree/editor divider — tree width adjusts (clamped); drag far left or
   double-click — tree collapses to a rail; restore via the side button.

## Scenario 6 — Mobile bottom sheets

1. Narrow viewport (≤ 900px) or phone: tree is the base view; tapping an entry opens
   the editor as a bottom sheet; assistant opens via the icon button.
2. Drag the sheet bar: height follows the finger; release snaps to peek (~14%) /
   half (50%) / tall (~82%) / full (100%, capped below the system top bar); drag down
   past the smallest size closes; Close button always works.
3. Field grids render in two columns on mobile; wide fields span both columns.

## Data-safety check (FR-008, runs during every scenario)

- DevTools: no calls to `/api/worldinfo/*`; `extensionSettings` untouched; after
  disabling the extension and reloading, the native World Info editor opens normally.
