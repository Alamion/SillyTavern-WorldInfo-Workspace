# Contract — Hooks added in Phase 6

Additive to `specs/006-hardening-interop/contracts/hooks.md`; same rules (emitted via
`adapters/hooks.ts`, never awaited, wrapped, identity not content). `docs/hooks.md` and
`WI_EVENTS` gain the entry in the same change.

| Event | Fires when | Payload |
| --- | --- | --- |
| `wi-workspace:pick-completed` | Main-chat picking finished for a generation (any outcome) | `{ chatId: string, source: 'prepared' \| 'fresh' \| 'fallback' \| 'reused', picked: Array<{ book: string, uid: number }>, ignored: number, durationMs: number }` |

`tree-changed` covers summary edits and `pickExcluded` changes (they are user-visible tree
changes). Context sets, previews and preparations emit nothing.
