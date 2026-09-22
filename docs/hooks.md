# World Info Workspace — extension hooks

Reference for authors of other SillyTavern extensions who want to react to what happens
in the World Info Workspace. Nothing here requires reading the plugin's source.

Every event is namespaced `wi-workspace:*`, carries a typed payload, and is extended
**additively only** — an existing event name or payload field is never removed or
repurposed. A breaking change would be a MAJOR version of the plugin.

This is the complete surface. The authoritative declaration lives in
`src/core/hooks/events.ts`, and a contract test asserts that this document and that module
list exactly the same events.

## Subscribing

```js
const { eventSource } = SillyTavern.getContext();
eventSource.on('wi-workspace:tree-changed', (payload) => { /* ... */ });
```

### Guarantees

- **Exactly once per occurrence**, regardless of which route caused it — manual
  edit, assistant apply, markdown pull, import, bulk action or delete.
- **Never awaited**. A slow handler cannot block a workspace operation. A
  throwing handler cannot fail one: the host's `eventSource.emit` catches per listener,
  and the plugin wraps emission in its own try/catch.
- **No content.** Payloads carry identity and shape only — never entry content, chat text,
  persona or card data.
- **Identity is stable.** `nodeId` is a uuid that survives renames and moves; `bookName` is
  the opaque, collision-resolved book handle that folder renames never change.

### Not guaranteed

- Ordering *between* different event families.
- That a `tree-changed` batch is minimal — a coalesced batch may contain several changes.
- Delivery to handlers registered after the event fired.

---

## Shared types

```ts
type NodeKind = 'folder' | 'entry' | 'image';

interface NodeRef {
    nodeId: string;
    kind: NodeKind;
    name: string;
    parentId: string | null;
    bookName: string | null;   // nearest enclosing World Info root, if any
}
```

---

## `wi-workspace:tree-changed`

Fires when the workspace tree changes in a user-visible way.

```ts
interface TreeChangedPayload {
    changes: Array<{
        change: 'create' | 'delete' | 'move' | 'rename' | 'update';
        node: NodeRef;
    }>;
}
```

**Coalescing**: changes occurring within one microtask are delivered as a single event
with multiple entries. One logical user action therefore produces one event even though it
may publish several internal state updates.

**Does NOT fire** for bookkeeping-only changes: sync status and hashes, native uid
assignment, tombstones, folder expand/collapse, or settings. Consumers can therefore treat
every `tree-changed` as a real content or structure change rather than filtering push
noise themselves.

---

## `wi-workspace:book-pushed`

Fires when a push of a native World Info book reaches a terminal state — including
failures and blocks, not only successes.

```ts
interface BookPushedPayload {
    bookName: string;
    rootId: string;                      // the designated World Info root folder's id
    outcome: 'success' | 'save-failed' | 'conflict-blocked'
           | 'validation-blocked' | 'book-missing';
    exported?: number;                   // entries written (success only)
    skipped?: Array<{ nodeId: string; reason: string }>;
    reason?: string;                     // human-readable (failure/blocked outcomes)
}
```

**Note**: `conflict-blocked` and `validation-blocked` mean nothing was written — the
workspace is waiting on the user. Consumers that mirror workspace data must not treat a
blocked push as a completed one.

---

## `wi-workspace:root-changed`

Fires when a folder's World Info root designation changes.

```ts
interface RootChangedPayload {
    folderId: string;
    folderName: string;
    bookName: string | null;             // null after 'undesignated'
    action: 'designated' | 'undesignated' | 'book-renamed'
          | 'book-deleted' | 'imported';
}
```

`imported` covers a native book imported into the workspace, which creates a designated
root folder in one step.

---

## `wi-workspace:workspace-shown` / `wi-workspace:workspace-hidden`

Fires when the workspace surface becomes visible or stops being visible — covering both
drawer open/close and the Workspace ⇄ Worlds/Lorebooks mode switch.

```ts
interface WorkspaceVisibilityPayload {
    mode: 'workspace' | 'native';
}
```

---

## `wi-workspace:md-link-changed` 

```ts
interface MdLinkChangedPayload {
    state: 'none' | 'loading' | 'needs-reconnect' | 'unavailable' | 'linked';
    folderName: string;
}
```

## `wi-workspace:md-synced` 

```ts
interface MdSyncedPayload { report: OperationReport; }
```

## `wi-workspace:assistant-applied` 

```ts
interface AssistantAppliedPayload {
    conversationId: string;
    batchId: string;
    operations: Array<{ op: string; nodeId: string; name: string }>;
    failed?: unknown;
}
```

## `wi-workspace:assistant-undone` 

```ts
interface AssistantUndonePayload {
    conversationId: string;
    batchId: string;
    reverted: string[];
    skipped: string[];
}
```

---

## Stability

Every event above is covered by a contract test asserting its name and exact payload
shape, including the negative cases (no event for bookkeeping-only changes) and a check
that payloads never carry entry content.

If you need something that is not here, open an issue — the surface is extended additively,
so new events can be added without breaking your consumer.
