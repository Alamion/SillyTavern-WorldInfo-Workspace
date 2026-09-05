# Quickstart — Integrated Lore Workspace (001-workspace-plugin-roadmap)

Validation scenarios proving the feature works end-to-end. Commands reference the pnpm
scripts mandated by the constitution (`build`, `dev`, `test`, `lint`, `typecheck`).

## Prerequisites

- SillyTavern instance running (vendored reference: `context/SillyTavern/`).
- Dependencies installed: `pnpm install` (repo root of the extension).
- Extension built and present in the SillyTavern extensions directory, enabled in the
  extensions panel; page reloaded after rebuilds.

## Automated gates (every change)

```bash
pnpm run typecheck   # tsc --noEmit, zero errors (constitution III)
pnpm run lint        # ESLint, zero errors / zero new warnings (constitution IV)
pnpm run test        # Vitest suite, all green (constitution V/VI)
```

## Scenario 1 — Loads and initializes (smoke)

1. Start SillyTavern, open any chat.
2. **Expect**: no console errors on load; workspace launcher visible in the extensions UI.
3. Click the launcher → **Expect**: workspace panel opens with the tree view and assistant
   tab; closing and reopening shows the same state.

## Scenario 2 — Flexible tree + persistence (US2/US3)

1. In the workspace: create folders nested ≥ 3 levels; create a card and a note in
   different folders; fill EVERY card field (keys, secondary keys, content, order,
   position, probability, inclusion group, timed effects, etc.).
2. Rename and move items; type continuously in a content field for ~30 s.
3. Close the panel, switch chats, reload the page.
4. **Expect**: structure and every field value exactly as entered; no focus loss during
   typing; duplicate-name and empty-name attempts are rejected with visible validation.

## Scenario 3 — Native World Info round-trip (US4, FR-010/FR-011/FR-012)

1. Create a folder, designate it as a World Info root, add 2+ cards with real keys.
2. Run sync (`/wiw sync` or panel button).
3. Open the app's native World Info editor → **Expect**: book exists; entries match all
   field values; entries activate in a live chat (trigger a key in a message).
4. Export scenario: create a native book in the app editor → workspace Import → **Expect**
   cards appear with all fields preserved.
5. Divergence: edit an entry in the native editor, then Import again → **Expect** a
   warning listing affected workspace cards before anything is overwritten; no silent
   clobbering.
6. Move a card out from under its WI root → sync → **Expect**: card flagged orphaned and
   native counterpart removed or flagged per confirmation — never silent.

## Scenario 4 — AI assistant (US5)

1. Open the assistant tab; ask it to "create a card about <concept> in folder X".
2. **Expect**: a preview proposal (pending) with summary; nothing applied yet.
3. Confirm → **Expect**: card appears in folder X; after sync, present in native book.
4. Ask it to delete a folder → **Expect**: explicit destructive confirmation required.
5. With an active chat, ask for relevant existing lore → **Expect**: recommendations
   reference existing workspace cards.
6. Disconnect network mid-request → **Expect**: batch marked failed, workspace state
   unchanged (all-or-nothing).

## Scenario 5 — Markdown round-trip (US6, FR-019–FR-022)

1. Export a workspace subtree to md → **Expect**: directory tree mirrors folders; cards
   have YAML frontmatter; notes carry `type: note`; `_workspace.md` present per root.
2. Import the exported md into a fresh folder → **Expect**: identical tree, fields, and
   notes; unknown frontmatter keys preserved in card extensions.
3. Import a sample external md lore collection → **Expect**: hierarchy preserved;
   unmappable content kept as notes; import report lists anything unusual.

## Scenario 6 — Interop hooks (FR-024)

1. From any other extension's console:
   `SillyTavern.getContext().eventSource.on('wi-workspace:synced', p => console.log(p))`.
2. Run a sync → **Expect**: payload `{ bookName, rootId, exported, removed }` logged.
3. `/wiw-ask message="hello"` → **Expect**: reply appears; `/wiw open` toggles the panel.

## Scenario 7 — Prototype gate (Phase 0 exit)

1. Evaluate the prototype build against the approved layout.
2. **Expect**: decision recorded (approve / iterate / discard) BEFORE any production UI
   work proceeds.
