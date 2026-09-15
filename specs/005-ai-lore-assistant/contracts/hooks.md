# Contract — Assistant Interop Events

Additive to the existing `wi-workspace:*` surface (constitution VII, spec FR-036).
Emitted via `ctx.eventSource.emit(name, payload)`; documented in `AGENTS.md`; payloads
verified in `tests/contract/hooks.test.ts`.

```ts
export interface AppliedOperationSummary {
    op: 'create_entry' | 'edit_entry' | 'create_folder' | 'rename' | 'move' | 'delete';
    nodeId: string;       // created, changed, or deleted node
    name: string;         // node name after the operation (before, for delete)
}

// 'wi-workspace:assistant-applied' — after each successful apply action (single accept,
// accept all, confirmed destructive item), once per AppliedBatch.
export interface AssistantAppliedPayload {
    conversationId: string;
    batchId: string;
    operations: AppliedOperationSummary[];
    failed?: { op: AppliedOperationSummary['op']; reason: string };
}

// 'wi-workspace:assistant-undone' — after an undo of an AppliedBatch.
export interface AssistantUndonePayload {
    conversationId: string;
    batchId: string;
    reverted: string[];   // node ids
    skipped: string[];    // node ids not cleanly revertible
}
```

Rules: payloads contain no prompt text, model output or profile data; events fire after
the store change is published; a failed apply with zero applied operations emits nothing.
