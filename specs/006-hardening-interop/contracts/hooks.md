# Contract: Extension Interop Hooks (`wi-workspace:*`)

**Constitution VII.** Hooks are namespaced, payload-typed, documented, and extended
**additively only**. A breaking hook or payload change is a MAJOR version event.

This is the complete event surface after Phase 4. Events marked *(existing)* were
delivered by specs 004/005 and are unchanged — their names and every existing payload
field are preserved (FR-011).

## Subscribing

```js
const { eventSource } = SillyTavern.getContext();
eventSource.on('wi-workspace:tree-changed', (payload) => { /* ... */ });
```

### Guarantees

- **Exactly once per occurrence** (FR-009), regardless of which route caused it — manual
  edit, assistant apply, markdown pull, import, bulk action or delete.
- **Never awaited** (FR-010). A slow handler cannot block a workspace operation. A
  throwing handler cannot fail one: the host's `eventSource.emit` catches per listener,
  and the plugin wraps emission in its own try/catch.
- **No content.** Payloads carry identity and shape only — never entry content, chat text,
  persona or card data.
- **Identity is stable.** `nodeId` is a uuid that survives renames and moves; `bookName` is
  the opaque, collision-resolved book handle that folder renames never change (roadmap
  FR-023, spec 001).

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

## `wi-workspace:md-link-changed` *(existing, spec 004)*

```ts
interface MdLinkChangedPayload {
    state: 'none' | 'loading' | 'needs-reconnect' | 'unavailable' | 'linked';
    folderName: string;
}
```

## `wi-workspace:md-synced` *(existing, spec 004)*

```ts
interface MdSyncedPayload { report: OperationReport; }
```

## `wi-workspace:assistant-applied` *(existing, spec 005)*

```ts
interface AssistantAppliedPayload {
    conversationId: string;
    batchId: string;
    operations: Array<{ op: string; nodeId: string; name: string }>;
    failed?: unknown;
}
```

## `wi-workspace:assistant-undone` *(existing, spec 005)*

```ts
interface AssistantUndonePayload {
    conversationId: string;
    batchId: string;
    reverted: string[];
    skipped: string[];
}
```

---

## Contract testing (FR-012)

Every event above has a test in `tests/contract/hooks.test.ts` asserting its **name** and
**exact payload shape**, following the established pattern: an injected
`emit: (event, payload) => events.push({ event, payload })` collector, a real
`WorkspaceStore` over a fixture state, exact `toEqual` payload assertions, explicit
exactly-once count assertions, a negative case asserting no event when nothing changed,
and a privacy assertion that the serialized payload contains no entry content.

The documented list here and the emitted events MUST match exactly — no documented event
that never fires, no emitted event that is undocumented (SC-010).
