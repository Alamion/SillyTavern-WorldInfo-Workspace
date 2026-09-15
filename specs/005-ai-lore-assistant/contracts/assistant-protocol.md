# Contract — Assistant Operation Protocol v1

The text protocol between the plugin and the model (research R3). The default system
instructions embed the "Model-facing description" section verbatim; the parser in
`src/core/assistant/protocol.ts` implements "Parser rules". Changing either is a
protocol version change (update both, the fixtures and this document).

## Context the model receives

```text
## Workspace outline
(handle | kind | name — extra)
f1 | folder | Aldermeer — World Info root
  f2 | folder | Cities
    e1 | entry | Bristlemark — keys: bristlemark, harbor city
    e2 | entry | Bristlemark Taverns — keys: tavern, alehouse
  f3 | folder | Hearth & Home
  i1 | image | Aldermeer map — caption: Hand-drawn map of the river delta

## Items in scope
[e1] Bristlemark
keys: bristlemark, harbor city
fields: position=at_depth, depth=2
content:
Capital of Aldermeer, built on the confluence of the Lira and the Ossen.
```

- Handles are per request (`f`/`e`/`i` + number); only handles listed under "Items in
  scope" or folders inside the scope are valid targets (the outline is for placement and
  awareness). Images are read-only context (captions only).
- `fields:` lists only non-default values, using the markdown convention names
  (`contracts/markdown-convention.md` of spec 004: `position`, `depth`, `order`,
  `probability`, `constant`, `selective_logic`, …, enum names like `at_depth`).

## Model-facing description (propose mode)

```text
Reply with a short explanation in plain prose, then one operation block per change.
Only use handles from the workspace context. Name new items with a temporary ref
("new1", "new2") that later blocks may use as parent or id.

<op type="create_entry" parent="HANDLE_OR_REF" ref="new1">
<title>Entry title</title>
<keys>keyword one, keyword two</keys>
<content>
Entry text (markdown allowed)
</content>
</op>

<op type="edit_entry" id="HANDLE">
(only the tags you change: title, keys, secondary_keys, content, fields)
<fields>position=at_depth, depth=2</fields>
</op>

<op type="create_folder" parent="HANDLE_OR_REF" ref="new2"><title>Folder name</title></op>
<op type="rename" id="HANDLE"><title>New name</title></op>
<op type="move" id="HANDLE_OR_REF" parent="HANDLE_OR_REF"></op>
<op type="delete" id="HANDLE"></op>

Edits replace the whole value of each tag you include (send the full new content).
Do not repeat ideas the user denied. If nothing should change, reply with prose only.
```

Discuss mode replaces the block section with: "Answer in prose only. Do not output
operation blocks. Refer to items as [[HANDLE]]." Propose mode also allows `[[HANDLE]]`
references in prose (FR-005).

## Parser rules

1. **Reasoning**: `<think>…</think>` / `<thinking>…</thinking>` spans (closed, or unclosed
   at the very start while streaming) are removed from the text and appended to
   `reasoning`.
2. **Block recognition**: a block starts at `<op` (case-insensitive) followed by
   attributes and `>`; it ends at the next `</op>`. Self-contained attribute values may use
   `"` or `'`; unquoted values up to whitespace are accepted. Unknown attributes are
   ignored. Blocks inside fenced code (```` ``` ````) are still recognized (models often
   fence them); the fences are dropped from prose.
3. **Tags inside a block**: `title`, `keys`, `secondary_keys`, `content`, `fields`. Value
   = raw text between `<tag>` and the matching `</tag>`, taken verbatim (no entity
   decoding). One leading and one trailing newline are trimmed for `content`; other tags
   are trimmed. A missing closing tag for `content` inside a closed block takes the text
   up to `</op>`.
4. **Lists**: `keys` / `secondary_keys` split on commas and newlines, trimmed, empties
   dropped, case-preserving de-duplication.
5. **Fields**: `name=value` pairs split on commas/newlines; names and enum values per
   the markdown convention field table; booleans `true/false/yes/no`; numbers as
   decimals; `null` clears nullable fields. Supported: the scalar rows of `FIELD_SPECS`
   (types boolean, number, number-or-boolean, enum, string, nullable-*), key without the
   `wi_` prefix. Not assistant-editable in v1: `keys`/`secondary_keys` (own tags),
   `triggers`, `character_filter`, `extensions`. Unknown or unsupported names → the block
   is invalid with the reason `unknown field "x"`.
6. **Streaming**: the parser is incremental: `feed(accumulatedText)` returns completed
   blocks and prose segments since the last call; a partially received block is not
   exposed. At end of stream, an unclosed `<op` → `unparsed: truncated`.
7. **Malformed**: a closed block with an unknown `type`, missing required attributes, or
   no usable content → `unparsed: malformed-block` with an excerpt (≤ 200 chars) and a
   reason; parsing continues with the next block.
8. **Prose**: everything outside blocks (after removing reasoning) is the reply text;
   `[[HANDLE]]` becomes an item reference resolved through the message's handle map.

## Required attributes / tags per type

| type | attributes | tags | validation (research R4) |
| ---- | ---------- | ---- | --------- |
| `create_entry` | `parent` (req), `ref` (opt) | `title` (req), `keys`, `secondary_keys`, `content`, `fields` | parent is an in-scope folder or earlier ref; name valid |
| `edit_entry` | `id` (req) | ≥ 1 of `title`, `keys`, `secondary_keys`, `content`, `fields` | id is an in-scope entry; values valid; no-op edits dropped with a notice |
| `create_folder` | `parent` (req), `ref` (opt) | `title` (req) | parent in-scope folder or ref |
| `rename` | `id` (req) | `title` (req) | id in scope, not the workspace root |
| `move` | `id` (req), `parent` (req) | — | both resolvable; no move into own subtree; not a no-op |
| `delete` | `id` (req) | — | id in scope, not the workspace root |

Refs: must be declared by a creation earlier in the same reply; duplicates → later block
invalid; a ref used as `parent` must be a folder creation.

## Fixtures

`tests/fixtures/assistant/` stores real replies: `probe-2026-09-15-router.txt` (five
blocks, prose interleaved), plus hand-made cases: truncated block, fenced blocks, think
tags, unknown field, broken attribute quoting, chunk boundaries inside tags.
