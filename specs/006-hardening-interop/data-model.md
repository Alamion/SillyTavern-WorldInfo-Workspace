# Data Model: Hardening & Interop (Phase 4)

This phase introduces **no persisted data**. Schema v1, the IndexedDB stores and the
markdown baseline are untouched (spec Assumptions: no product contract changes). The
entities below are in-memory types, documentation artifacts and process records.

---

## 1. Event surface (`src/core/hooks/events.ts`)

Today the `wi-workspace:*` payloads have **no declared types anywhere** — only prose in
`AGENTS.md`. This module is the fix for FR-008 and the source of truth for `docs/hooks.md`
and the contract tests.

### Shared identity types

Derived from the real schema (`src/core/state/schema.ts`):

```
NodeRef          { nodeId: string; kind: 'folder' | 'entry' | 'image';
                   name: string; parentId: string | null;
                   bookName: string | null }   // nearest enclosing WI root, if any
```

`nodeId` is the stable uuid from `NodeBase.id`. `bookName` is the opaque, collision-resolved
book handle from `BookBinding.bookName` (roadmap FR-023, spec 001: never renamed by folder
renames), which makes it the correct stable identifier for book-scoped events.

**Deliberately excluded**: filesystem paths. There is no `path` field on nodes, and the
markdown-relative paths that exist live only inside the link baseline. Exposing them would
leak a markdown-link implementation detail into a general tree contract and would be
meaningless for users without a linked folder.

### Event payloads

| Event | Payload | Fires when |
|---|---|---|
| `wi-workspace:tree-changed` | `{ changes: TreeChange[] }` | Any user-visible tree mutation, coalesced per microtask |
| `wi-workspace:book-pushed` | `{ bookName, rootId, outcome, exported?, skipped?, reason? }` | A native book push reaches a terminal state |
| `wi-workspace:root-changed` | `{ folderId, folderName, bookName, action }` | A folder's World Info root designation changes |
| `wi-workspace:workspace-shown` / `:workspace-hidden` | `{ mode: 'workspace' \| 'native' }` | The workspace surface becomes visible / stops being visible |

```
TreeChange       { change: 'create' | 'delete' | 'move' | 'rename' | 'update';
                   node: NodeRef }

outcome          'success' | 'save-failed' | 'conflict-blocked'
                 | 'validation-blocked' | 'book-missing'
exported         number        // entries written (success only)
skipped          Array<{ nodeId: string; reason: string }>
reason           string        // human-readable, failure/blocked outcomes only
action           'designated' | 'undesignated' | 'book-renamed' | 'book-deleted' | 'imported'
```

### Invariants

- **Additive only** (FR-011): the four events delivered by specs 004 and 005
  (`md-link-changed`, `md-synced`, `assistant-applied`, `assistant-undone`) keep their
  names and every existing payload field.
- **Exactly once per occurrence** (FR-009): guaranteed for tree events by deriving from
  the store diff (the only funnel no route escapes) plus microtask coalescing.
- **Bookkeeping is not a change**: deltas confined to `sync`, `native.uid`,
  `book.tombstones`, `expanded` or `settings` MUST NOT produce a `tree-changed` event.
  Without this filter every push would masquerade as a user edit.
- **Content is never included.** Payloads carry identity and shape, never entry content,
  chat text or persona data. The existing contract test already asserts this for assistant
  events and the assertion extends to the new ones.
- **Fire and forget** (FR-010): emission is never awaited, so a slow subscriber cannot
  block a workspace operation, and is wrapped in try/catch so a synchronous throw cannot
  either.

### State transitions — `tree-changed` derivation

Computed by diffing the previous and next published state by node id:

| Previous | Next | Emitted |
|---|---|---|
| absent | present | `create` |
| present | absent | `delete` |
| different `parentId` | — | `move` |
| different `name` | — | `rename` |
| any other user-visible field differs | — | `update` |
| only bookkeeping fields differ | — | *(nothing)* |

A node that is both moved and renamed in one coalesced window emits one `move` and one
`rename` entry in the same `changes` array, not two events.

---

## 2. Performance entities (in-memory only)

| Entity | Where | Purpose |
|---|---|---|
| **Node index** | `core/state/nodeIndex.ts` | `WeakMap<FolderNode, Map<string, TreeNode>>` keyed by root identity. Replaces the full index rebuild per `findNode`. Invalidated implicitly: a new root object means a cache miss, so it can never go stale. |
| **Fingerprint memo** | `core/sync/fingerprint.ts` | `WeakMap<NativeWorldInfoEntry, string>`. Correct only because structural sharing (R1) keeps unchanged entries reference-identical. |
| **Draft field value** | `ui/useDraftField.ts` | Per-field local string plus a pending-commit flag. **Must be flushed** on blur, before generation, and on panel close, or an in-flight edit could be lost. |
| **Scale dataset** | `tests/support/scaleDataset.ts` | Seeded deterministic generator (1000 entries / ~2000 nodes). Test-only; never shipped and never user-visible. The Aldermeer demo dataset remains the user-facing sample. |

---

## 3. Documentation artifacts

| Artifact | Audience | Contract |
|---|---|---|
| `README.md` | Users | Install, native-editor relationship, tree, WI roots and sync, markdown convention and limits, assistant prerequisites, environment requirements (FR-013, FR-015) |
| `docs/hooks.md` | Extension authors | Every event, payload, firing condition, additive-only promise (FR-014). Generated from and kept consistent with `core/hooks/events.ts` |
| `CHANGELOG.md` | Users | One entry per user-visible change under its release version; seeded with one "0.4.11 and earlier" summary; real history from 0.4.12 (FR-019) |
| `AGENTS.md` | Contributors | Gains maintenance mechanics (FR-024) |
| `.specify/memory/constitution.md` | Governance | 1.2.0 → 1.3.0, binding maintenance rule (FR-024) |

---

## 4. Process entities

Documents, not code — defined in `contracts/maintenance-process.md`.

**Maintenance Change**
- `report` — what was done / expected / actual / area (FR-021)
- `triage` — `fix-path` | `needs-spec`, decided by the contract-based threshold (FR-018)
- `changelog entry` — one user-visible line under a release version (FR-019)
- `rationale record` — present **only** when the change embeds a non-obvious decision (FR-020)

**Backlog Item** — a reported item accepted but deliberately not fixed yet; persists
beyond the reporting session (FR-022). Items fixed immediately never become one.

Lifecycle: `reported → triaged → (fix-path → fixed → released) | (needs-spec → new spec) | (deferred → backlog)`
