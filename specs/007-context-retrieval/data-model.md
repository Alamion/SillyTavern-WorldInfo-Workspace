# Data Model: Context & Retrieval

All additions are optional and additive; loaders repair them field by field (schema stays
v1). Decisions referenced as R-numbers are in [research.md](./research.md).

## Persisted in the workspace state (`extensionSettings['WorldInfoWorkspace']`)

### Entry summary (R1)

| Where | Type | Rules |
|---|---|---|
| `EntryNode.native.extensions.wiw_summary` | `string` | Absent = no summary; blank on save → key removed; trimmed; > 300 chars flagged "too long" (saved); part of the entry fingerprint (pushes like any field) |

No new node field: the native entry is already stored verbatim.

### Folder exclusion from picking (R11)

| Where | Type | Rules |
|---|---|---|
| `FolderNode.pickExcluded` | `boolean?` | Absent/false = included; applies to the whole subtree; workspace-only (never exported to native books or markdown folder records) |

### Assistant settings additions (`settings.assistant`)

| Field | Type | Default | Rules |
|---|---|---|---|
| `defaultContext.catalog` | `'auto' \| 'on' \| 'off'` | `'auto'` | invalid → default |
| `defaultContext.fuzzy` | `boolean` | `false` | |
| `defaultContext.sources` | `{ scene: boolean; deeplore: boolean }` | both `false` | ignored when the extension is absent |
| `contextSets` | `ContextSet[]` | `[]` | names unique (case-insensitive), 1–60 chars; max 50 sets; invalid items dropped |

`ContextSet = { id: string; name: string; context: ContextSettings }`.

### Picking settings (`settings.picking`, new)

| Field | Type | Default | Range |
|---|---|---|---|
| `defaultEnabled` | `boolean` | `false` | |
| `profileId` | `string \| null` | `null` (= assistant profile) | must exist, else falls back with a notice |
| `timeoutSec` | `number` | `20` | 5–120 |
| `chatMessages` | `number` | `6` | 1–30 |
| `maxPicks` | `number` | `8` | 1–30 |
| `catalogTokens` | `number` | `4000` | 500–32000 |

Not saved while a data recovery is pending (same rule as assistant settings).

## Per conversation (IndexedDB `WorldInfoWorkspace-assistant`, repaired on load)

`ContextSettings` gains `catalog`, `fuzzy`, `sources` (defaults above) and
`Conversation.contextSetName?: string` (name at the time it was applied).

### ContextItem (in `ContextSnapshot.items`, R3)

| Field | Type | Notes |
|---|---|---|
| `kind` | `'entry' \| 'outline' \| 'catalog' \| 'chat' \| 'card' \| 'persona' \| 'activated' \| 'source' \| 'history'` | |
| `nodeId?` | `string` | entries, catalog lines |
| `label` | `string` | name or description |
| `reason` | `'selected' \| 'scope' \| 'key' \| 'recursion' \| 'fuzzy' \| 'catalog-read' \| 'context-set' \| 'interop' \| 'option'` | FR-002 |
| `detail?` | `string` | matching key; `step 2 from "Salt Guild"`; source name |
| `tokens` | `number` | estimate |
| `state` | `'included' \| 'truncated' \| 'omitted'` | |
| `keptShare?` | `number` | 0–1 when truncated |
| `omitReason?` | `'budget' \| 'scope' \| 'unavailable'` | when omitted |

`ContextSnapshot` keeps its existing fields; `items` is added (absent on older
messages → the preview shows the old summary only). Read rounds (R4) append items with
reason `catalog-read` to the same snapshot.

## Per chat (`chatMetadata.WorldInfoWorkspace`)

| Field | Type | Notes |
|---|---|---|
| `picking` | `'on' \| 'off'` | absent = `settings.picking.defaultEnabled` |

## Per reply (`chat[id].extra.wiw_pick`, mirrored to the swipe's `extra`) — R10

| Field | Type | Notes |
|---|---|---|
| `v` | `1` | shape version |
| `source` | `'prepared' \| 'fresh' \| 'fallback' \| 'reused'` | `reused` = continue of the same message |
| `picked` | `Array<{ book: string; uid: number; name: string; reason: string; inserted: boolean \| null }>` | `inserted` from `WORLD_INFO_ACTIVATED`; `null` = unknown |
| `ignored` | `string[]` | names/ids the model returned that do not exist (max 20) |
| `durationMs` | `number` | 0 for prepared/reused |
| `failure?` | `{ kind: 'timeout' \| 'failed' \| 'malformed'; message: string }` | |
| `profileName` | `string` | |
| `at` | ISO string | |

Names are stored so the popup works after books change; nothing else from entry content.

## In memory only

- **ActiveEntriesCache**: last `WORLDINFO_ENTRIES_LOADED` payload flattened to
  `{ book, uid, entry }[]`, plus a `valid` flag (R9).
- **PreparedPick**: `{ chatId, basedOnLength, picks, preparedAt }` — dropped on
  `CHAT_CHANGED`, replaced by a newer preparation.
- **Bm25Index**: memoized per entry fingerprint (R5).

## State transitions

Pick lifecycle per generation: `idle → (prepared available? → check new text) →
use-prepared | fresh-running → done | timed-out | failed → forced (emit) → recorded
(after MESSAGE_RECEIVED) → inserted flags filled (after WORLD_INFO_ACTIVATED)`. A chat
change at any point → `discarded`.

Read rounds per assistant reply: `streaming → finished with read/open blocks → fetching
(round n ≤ 3) → streaming (continuation) → … → finished`; Stop at any point ends the
reply with what arrived.
