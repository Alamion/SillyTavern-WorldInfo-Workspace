# Contract — Native World Info Sync: Phase 6 changes

Base: spec 003 sync semantics and `AGENTS.md` "World Info sync". Two narrow changes.

1. **Summary travels in the native entry.** `extensions.wiw_summary` is part of the
   entry like any field: workspace edits push it; native-side changes to it pull like
   other clean-side changes; it is part of the entry fingerprint. The native app ignores
   and preserves it (including character-card embedding).
2. **Memory Books order exception.** For entries whose native object has
   `stmemorybooks === true`, a push keeps the stored native `displayIndex` and `order`
   instead of writing the tree position. Every other field syncs as before; other
   entries keep the "tree order → native order" rule. Renaming such an entry so that a
   leading `[NNN]` prefix is removed requires confirmation.

Unchanged: tombstones, orphans, divergence guards, naming, debounce.
