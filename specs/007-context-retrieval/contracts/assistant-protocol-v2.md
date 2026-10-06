# Contract — Assistant Operation Protocol v2 (delta to v1)

Base: `specs/005-ai-lore-assistant/contracts/assistant-protocol.md` (v1). Everything in v1
stays valid; v2 adds a catalog section, two read operations and the `summary` tag. The
default instructions, the parser (`src/core/assistant/parser.ts`), the fixtures and this
document change together.

## Context the model receives (additions)

Entries in the full-item section gain an optional `summary:` line. In catalog mode
(research R4) a catalog section follows the outline:

```text
## Catalog (request full text with <op type="read">; open folders with <op type="open">)
(handle | folder path | name | ≈tokens — summary or excerpt)
e12 | Aldermeer/Cities | Bristlemark | ≈180 — Capital; relevant for trade, the harbor, the council.
e13 | Aldermeer/Cities | Bristlemark Taverns | ≈90 — "The Salted Eel is the oldest tavern…"
f7  | Aldermeer/Factions | (folder, 42 entries: Salt Guild, Lantern Wardens, …) — not listed, open to see
```

Excerpts are quoted; summaries are not. Folders listed with `(folder, N entries …)` are
narrowed (R4) and must be opened to see their entries.

## Model-facing description (added to propose and discuss modes)

```text
The catalog lists entries without their text. Before you rely on or change an entry
from the catalog, request it:
<op type="read" ids="e12,e13"></op>
To list the entries of a folder shown as "(folder, N entries)", use:
<op type="open" ids="f7"></op>
After read/open blocks, stop your reply; it continues once the content is provided.
Only change entries whose full text you have received.
```

Propose mode also documents the summary tag:

```text
<op type="edit_entry" id="HANDLE"><summary>When this entry matters, one or two sentences</summary></op>
```

## Parser rules (additions)

1. `read` and `open` blocks: required attribute `ids` (comma/space separated handles);
   no tags. Unknown handles → listed in the follow-up as "not found"; never an error.
2. `summary` is a recognized tag in `create_entry` and `edit_entry` (trimmed, single
   value). An empty `<summary></summary>` clears the summary.
3. A reply that ends with ≥ 1 read/open block is "waiting"; change blocks in the same
   reply are parsed and shown as usual.

## Follow-up turn (plugin → model)

```text
<workspace-read round="1">
[e12] Bristlemark
keys: bristlemark, harbor city
summary: Capital; relevant for trade, the harbor, the council.
content:
…
## Folder f7 (Aldermeer/Factions)
e40 | Salt Guild | ≈220 — …
not found: e99
</workspace-read>
Continue your reply.
```

Sent as a user turn after the reply so far (assistant turn). The continuation is
appended to the same reply. Max 3 rounds per reply; after the limit, the plugin sends
"No more reads are available; answer with what you have." once.

## Validation (additions to v1 table)

| type | attributes | tags | validation |
| --- | --- | --- | --- |
| `read` | `ids` (req) | — | handles of catalog entries or in-scope entries |
| `open` | `ids` (req) | — | handles of catalog folders |
| `edit_entry` (catalog mode) | as v1 | + `summary` | target's full text must have been sent in this reply chain, else invalid "read the entry first" |

## Fixtures

Add: a reply with read blocks then a continuation; a read of an unknown handle; a
summary-only edit; a reply that reaches the round limit.
