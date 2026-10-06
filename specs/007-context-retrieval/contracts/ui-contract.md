# Contract — UI (Phase 6)

All styling through `wiw-theme.scss` primitives; Font Awesome icons; English strings.

## Entry editor

- **Summary** field (single-line growing textarea) in the Essentials group under the
  title; counter "n/300", warning style above 300. Tree tooltip shows the summary.
- Memory Books entries: badge in the editor header and the tree row (kind: Memory,
  Tier N, Side prompt, Clip); renaming away a `[NNN]` prefix → confirm popup.

## Folder editor

- "Exclude from lore picking" toggle (affects main-chat picking only).

## Assistant context menu (per conversation)

- **Catalog**: Auto / On / Off (segmented).
- **Fuzzy matches** toggle.
- **Sources** (only when detected): "Scene cast (Doom's Enhancement Suite)", "DeepLore
  matches".
- **Context sets**: apply (list), "Save current as…", rename, delete; applied set name
  shown on the context chip.
- **Preview context** button → panel listing items grouped Included / Truncated / Left
  out, each row: icon, label, reason chip with detail, ≈tokens; totals vs budget.
- Sent messages: "Context" action opens the same panel for that request (snapshot).
- Read rounds: inline status line "Reading N entries… (round k/3)" with Stop.

## Memory Books actions

- When its commands exist: buttons in the assistant/context area or the bound book
  folder's header menu: "Create memory (Memory Books)" → runs `/creatememory`; results
  are Memory Books' own UI.

## Lore picking (main chat)

- Settings (workspace header menu → "Lore picking"): global default, profile, timeout,
  chat messages, max picks, catalog size; per-chat toggle for the current chat.
- Main chat: an icon in the message's extra buttons on replies with `wiw_pick`; click →
  popup: source (prepared/fresh/fallback/reused), picked entries with reasons and an
  "inserted / not inserted" mark, ignored names, timing, failure text, "Pick fresh next
  time" action.
