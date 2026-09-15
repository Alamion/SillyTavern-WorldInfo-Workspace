# Data Model: AI Lore Assistant

Types live in `src/core/assistant/types.ts` (pure). Persistence split (clarification
2026-09-15): **AssistantSettings** → shared extension settings; everything else →
IndexedDB on the device (research R10).

## AssistantSettings (shared settings)

Stored at `extensionSettings['WorldInfoWorkspace'].assistant` — optional, additive to
schema v1 (`migrate` fills defaults; no version bump).

| Field | Type | Default | Rule |
|-------|------|---------|------|
| `profileId` | `string \| null` | `null` | Must match a supported profile; otherwise UI state `no-profile` |
| `responseTokens` | `number` | `2000` | Integer 64..32768 |
| `contextTokens` | `number` | `16000` | Integer 1000..1000000, ≥ `responseTokens` + 500 |
| `instructions` | `string \| null` | `null` | `null` = built-in default; reset sets `null` |
| `defaultContext` | `ContextSettings` | see below | Copied into each new conversation; "Save as default" in the context menu overwrites it |

## ContextSettings (per conversation)

| Field | Type | Default |
|-------|------|---------|
| `scope` | `{ kind: 'selection' } \| { kind: 'folders'; folderIds: string[] } \| { kind: 'workspace' }` | `selection` |
| `includeOutline` | `boolean` | `true` |
| `chatMessages` | `number` (0 = off) | `0` |
| `characterCard` | `boolean` | `false` |
| `persona` | `boolean` | `false` |
| `activatedEntries` | `boolean` | `false` |

`selection` resolves at send time: selected folder, or the selected item's parent
folder, or the workspace root when nothing is selected. Folder ids that no longer exist
are dropped with a notice.

## Conversation (IndexedDB `conversations`, key `id`)

| Field | Type | Rule |
|-------|------|------|
| `id` | `string` (uuid) | |
| `title` | `string` | Default: first 60 chars of the first request; renameable, non-empty |
| `createdAt`, `updatedAt` | ISO string | |
| `mode` | `'propose' \| 'discuss'` | Default `propose` |
| `context` | `ContextSettings` | |
| `nextSeq` | `number` | Monotonic message sequence |

## Message (IndexedDB `messages`, key `[conversationId, seq]`)

| Field | Type | Rule |
|-------|------|------|
| `conversationId`, `seq` | `string`, `number` | |
| `role` | `'user' \| 'assistant' \| 'note'` | `note` = decision/undo summary fed back to the model (R9), rendered subtly |
| `text` | `string` | User: request; assistant: raw reply (blocks included) |
| `reasoning` | `string?` | Never parsed (FR-030) |
| `status` | `MessageStatus` | see state machine |
| `failure` | `AssistantFailure?` | `{ kind, message, retryable }` (R7) |
| `mode` | `'propose' \| 'discuss'` | Mode used for this request |
| `origin` | `{ profileId, profileName, api, model }?` | Assistant messages (FR-034) |
| `context` | `ContextSnapshot?` | Assistant messages: what was sent |
| `batch` | `ProposalBatch?` | Assistant messages in propose mode |
| `previousText` | `string?` | Last replaced version after a regenerate |
| `createdAt` | ISO string | |

### MessageStatus (assistant message)

```text
pending ──first chunk──▶ receiving ──end──▶ received
   │                        │
   ├──error─────────────────┴──▶ failed ──Retry──▶ (new assistant message, old one kept collapsed)
   └──Stop──────────────────────▶ stopped  (partial text kept; complete blocks still become proposals)
retry-wait (automatic retry countdown, R7) sits between failed attempts and pending
```

Regenerate replaces the last assistant message: `regenerate({ sameContext: false })`
rebuilds the context from the current tree (FR-004); `regenerate({ sameContext: true })`
re-sends `context.requestMessages` unchanged (FR-027). The previous version is kept as a
collapsed "previous version" on the new message (`previousText`) until the next request;
messages after it are removed (`deleteMessagesAfter`). Continue appends a continuation turn
whose text is concatenated for parsing. Proposals of a replaced reply that were already
applied keep their `AppliedBatch` (moved onto the new message's batch record) so undo
stays available.

## ContextSnapshot

| Field | Type |
|-------|------|
| `handles` | `Record<string, string>` — handle (`e12`) → node id (R5) |
| `scopeNodeIds` | `string[]` — nodes valid as operation targets |
| `included` | `{ outline: boolean; fullItems: number; chatMessages: number; characterCard: boolean; persona: boolean; activatedEntries: number }` |
| `omitted` | `OmittedPart[]` — `{ what: 'item' \| 'outline-depth' \| 'chat' \| 'history'; label: string; count?: number }` (FR-023) |
| `estimatedTokens` | `number` |
| `requestMessages` | `LlmMessage[]` — the exact messages sent; "Regenerate with the same context" re-sends them unchanged and reuses `handles`/`scopeNodeIds` (FR-027) |

## ProposalBatch

| Field | Type |
|-------|------|
| `id` | `string` |
| `proposals` | `OperationProposal[]` (reply order) |
| `unparsed` | `{ kind: 'malformed-block' \| 'truncated'; excerpt: string; reason: string }[]` (FR-027) |
| `applied` | `AppliedBatch[]` — one per apply action (accept item / accept all) |

## OperationProposal

| Field | Type | Rule |
|-------|------|------|
| `id` | `string` | Stable within batch |
| `op` | `'create_entry' \| 'edit_entry' \| 'create_folder' \| 'rename' \| 'move' \| 'delete'` | FR-006 |
| `targetId` | `string?` | Node id (edit/rename/move/delete) resolved from handle |
| `parent` | `{ nodeId } \| { ref }?` | create/move destination |
| `ref` | `string?` | Temporary ref declared by a creation |
| `values` | `ProposedValues` | `title?`, `keys?`, `secondaryKeys?`, `content?`, `fields?: Partial<NativeWorldInfoEntry>` (validated) |
| `userEdited` | `ProposedValues?` | User edits before accepting (FR-009) — applied instead of `values` |
| `baseline` | `{ updatedAt: string; fingerprint: string }?` | Target state at parse time (staleness, FR-013) |
| `dependsOn` | `string[]` | Proposal ids (refs, parent creations) |
| `destructive` | `boolean` | R8 rule (FR-010) |
| `duplicateOf` | `string?` | Existing node id (FR-016) |
| `invalidReason` | `string?` | Set ⇒ `decision = 'invalid'` |
| `decision` | `Decision` | see below |
| `revisionOf` | `string?` | Proposal replaced by a feedback revision (FR-017) |

### Decision state machine

```text
                 ┌────────── deny ──────────▶ denied
pending ─────────┤
  │  ▲           └─ accept ─▶ (validate now) ─ ok ─▶ applied ── undo ──▶ reverted
  │  │                              │                    └─ undo, item changed ─▶ applied (skipped reported)
  │  └── refresh (user re-decides) ─┴─ target changed ─▶ stale
  ├── dependency denied/failed/invalid ─▶ blocked (auto-returns to pending if dependency re-accepted)
  ├── parse/validation failure ─▶ invalid (terminal, not acceptable)
  └── feedback revision replaces it ─▶ superseded (terminal)
failed (apply error) — terminal for this attempt; retry = accept again
```

Accept-all takes every `pending` non-destructive proposal whose dependencies are
accepted/applied or in the same accept-all set; destructive ones stay `pending` and get
an individual confirmation (FR-010).

## AppliedBatch (undo record)

| Field | Type |
|-------|------|
| `id` | `string` |
| `appliedAt` | ISO string |
| `items` | `AppliedItem[]` in application order |
| `failed` | `{ proposalId: string; reason: string }?` (FR-028) |
| `undone` | `{ at: string; reverted: string[]; skipped: { proposalId: string; reason: string }[] }?` |

`AppliedItem = { proposalId; op; nodeId; afterUpdatedAt; inverse }` where `inverse` is:

| op | inverse |
|----|---------|
| `create_entry`, `create_folder` | `{ kind: 'delete-created' }` |
| `edit_entry` | `{ kind: 'restore-fields'; name: string; native: Partial<NativeWorldInfoEntry> }` |
| `rename` | `{ kind: 'restore-name'; name: string }` |
| `move` | `{ kind: 'restore-position'; parentId: string; index: number }` |
| `delete` | `{ kind: 'reinsert'; parentId: string; index: number; subtree: TreeNode }` |

Undo walks items in reverse; an item whose node `updatedAt` ≠ `afterUpdatedAt` (or whose
parent no longer exists) is skipped with a reason.

## AssistantFailure

`kind: 'rate-limit' | 'provider' | 'network' | 'timeout' | 'aborted' | 'profile' |
'connection-manager-disabled' | 'empty' | 'truncated' | 'malformed'`, `message: string`
(readable), `retryable: boolean`, `detail?: string` (raw provider text, collapsible).

## Relationships

```text
AssistantSettings (shared) ──defaultContext──▶ Conversation.context (copied)
Conversation 1 ── * Message
Message(assistant) 1 ── 0..1 ProposalBatch 1 ── * OperationProposal
ProposalBatch 1 ── * AppliedBatch 1 ── * AppliedItem ──nodeId──▶ WorkspaceState tree node
Message(assistant).context.handles ──▶ tree node ids
```

Deleting a conversation deletes its messages (and with them batches and undo records).
