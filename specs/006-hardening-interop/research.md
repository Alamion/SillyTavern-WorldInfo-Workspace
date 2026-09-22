# Research: Hardening & Interop (Phase 4)

All findings below were derived by reading the working tree, not inferred. Line references
are to the tree at 2026-09-22 and were spot-verified.

## Method

Two read-only surveys were run over the real source: a performance audit of the paths that
scale with node and entry count, and a survey of every mutation route and choke point for
event emission. The load-bearing claims (whole-state clone per mutation, index rebuild per
lookup, funnel bypass, O(tombstones x n) loop) were then re-verified directly against the
files before any decision here was taken.

---

## The headline finding

One keystroke in an entry's content field currently costs, synchronously:

1. `structuredClone` of the **entire workspace** — all 2000 nodes, every entry's content
   ([store.ts:39](../../src/core/state/store.ts#L39),
   [operations.ts:32-34](../../src/core/tree/operations.ts#L32-L34))
2. `findNode`, which **builds a full 2000-entry `Map`** and throws it away
   ([schema.ts:439-444](../../src/core/state/schema.ts#L439-L444))
3. a 5-way notify fan-out, including two more full tree walks in the image GC
4. a full app re-render: every visible row (no `React.memo` anywhere in the tree), plus a
   full markdown re-parse whose `useMemo` **never hits** because its dependencies are
   fresh closures every render
5. one second later: 3 separate full hash passes over 1000 entries, plus a multi-MB
   settings `JSON.stringify`

Commit-on-change (a deliberate Phase 1 trustworthiness decision) means this is paid **per
character**. Everything else in this document follows from attacking the root rather than
the symptoms.

---

## R1 — Structural sharing replaces whole-state cloning

**Decision**: Replace `structuredClone(state)` in `WorkspaceStore.update` and
`operations.ts` with **path-copy structural sharing**: clone only the spine from root to
the changed node; leave every sibling subtree by reference. Hand-rolled
`updateNodePath(state, id, fn)` in `core/state`, not a library.

**Rationale**: This is the root cause, and its cascade is the whole point. Once unchanged
subtrees keep reference identity:

- the image-GC early-out `before.root === after.root`
  ([imageRefs.ts:26-28](../../src/core/md/imageRefs.ts#L26-L28)) — **currently dead code**,
  because every mutation clones and so root identity always changes — starts working
- entry fingerprints can be memoized by object identity (R6)
- the markdown renderer can skip unchanged nodes entirely (R8)
- `React.memo` on tree rows becomes capable of hitting at all (R5)

Four P0 problems collapse into one fix. `setExpanded`
([operations.ts:374-385](../../src/core/tree/operations.ts#L374-L385)) currently clones the
whole state to flip one boolean, so even a folder caret click pays full price; path-copy
fixes that too.

**Alternatives considered**:
- *Immer*: a new bundled runtime dependency for behaviour we need in exactly one module,
  against a codebase that deliberately owns its markdown renderer and diff. Rejected.
- *Symptom-by-symptom optimization* (debounce typing, memo rows, cache hashes by
  serialized key): strictly more code, leaves the clone on every keystroke and every
  expand click, and every cache would need a serialization-based key whose construction is
  itself O(content bytes) — the mistake already present at
  [linkRender.ts:71](../../src/core/md/linkRender.ts#L71). Rejected.
- *Mutable store with change events*: breaks the `useSyncExternalStore` contract and the
  pure-operations design the tests rely on. Rejected.

**Risk**: highest-risk change in the phase. Mitigated by landing it alone, first, with no
intended behavioural change, behind the full existing suite (including the real-engine
`sync-engine.test.ts` scenarios A–W). The documented recipe contract ("recipes must not
capture the draft beyond the call") is preserved.

## R2 — Node index cached on state identity

**Decision**: Add `core/state/nodeIndex.ts` caching `Map<id, TreeNode>` keyed by `root`
object identity (a `WeakMap<FolderNode, Map<...>>`). `findNode(state, id)` consults it;
hot loops accept an optional pre-built index parameter.

**Rationale**: `findNode` is O(n) *per call* today and is called from ~30 sites, several
inside loops. The compounding cases are the real damage: `bulkDeleteNodes`
([operations.ts:193-201](../../src/core/tree/operations.ts#L193-L201)) does `findNode` +
a full clone **per id** — deleting a 50-node selection is 50 clones and 100 walks;
`bulkSetDisable` is O(k·n) likewise. With R1 in place the cache is nearly always warm,
because unchanged roots keep identity.

**Alternatives considered**: maintaining a parallel index mutated alongside the tree
(rejected: two sources of truth, easy to desynchronize); passing an index explicitly
everywhere (rejected as the *sole* mechanism: ~30 call sites, invasive — but adopted
additionally for the few genuinely hot loops).

## R3 — Typing moves off the store

**Decision**: A shared `ui/useDraftField.ts` hook: local component state for the text
value, commit to the store on a ~250 ms debounce and on blur. Applied to entry content and
other text fields, the node-name input
([NodeHeader.tsx:47-53](../../src/ui/NodeHeader.tsx#L47-L53)), image URL/SVG/caption
([ItemEditor.tsx:235-282](../../src/ui/ItemEditor.tsx#L235-L282)).

**Rationale**: Even after R1, a store write per character is wasteful and re-runs the
notify fan-out, sync scheduling and markdown scheduling. Drafts make typing cost nothing
but a local `setState`. **The Phase 1 trustworthiness guarantees are explicitly preserved**:
commit on blur, and the existing flush-before-generation and panel-close flush paths must
also flush pending drafts — otherwise an in-flight draft could be lost, which would
violate the very property (FR-009 of spec 003) commit-on-change was introduced to protect.

**Alternatives considered**: keeping commit-on-change and relying on R1 alone (rejected:
leaves per-character sync/markdown scheduling and settings-save churn); commit only on
blur with no debounce (rejected: a crash or navigation mid-edit loses more than 250 ms of
work).

## R4 — Preview memoization and deferral

**Decision**: Wrap `resolveImage` and `substitute` in `useCallback`
([WorkspaceApp.tsx:544-553](../../src/ui/WorkspaceApp.tsx#L544-L553)) and feed the preview
a deferred value (`useDeferredValue` or a debounced mirror).

**Rationale**: The existing `useMemo` at
[FieldGroups.tsx:307-314](../../src/ui/fieldGroups/FieldGroups.tsx#L307-L314) is
**permanently invalidated** — its deps are arrow functions recreated on every
`WorkspaceApp` render, so the hand-written CommonMark parser re-runs even when the content
did not change at all (toggling a checkbox, selecting another row, sync bookkeeping). This
is a two-line fix for a milliseconds-per-render cost on the critical path.

## R5 — Tree rows: memo, stable callbacks, windowing, ref-based drag

**Decision**: (a) `React.memo` on `Row` with `useCallback`-stabilized handlers and boolean
props (`selected`, `isDragOver`) instead of the whole `Set`/ids; (b) hand-rolled windowing
in a new `ui/VirtualList.tsx`; (c) move `dragOverId` out of React state into a ref with a
direct class toggle; (d) debounce the tree search input ~150 ms; (e) reuse the sorted child
arrays `collectVisible` already computed instead of re-sorting per folder during render.

**Rationale**: Collapsed subtrees are already skipped
([StructureTree.tsx:256-258](../../src/ui/StructureTree.tsx#L256-L258)) — that part is
fine. The problem is one expanded WI folder with 1000 entries: 1000 DOM rows, no memo,
~8 fresh closures each, re-rendered on every keystroke. Worse, `selectedIds` is a fresh
`Set` threaded to every row, so **selecting one row re-renders all of them**, and
`dragOverId` updates at pointer-move frequency, re-rendering the whole visible tree per
frame during a drag. Note (a) is useless without stabilized callbacks, and (a)+(b) are
useless without R1 — the ordering matters.

**Alternatives considered**: `react-window`/`@tanstack/react-virtual` (rejected: new
bundled dependency; the needed behaviour is a fixed-row-height window of ~80 lines, and the
project precedent is to own such code). Virtualizing without memoizing (rejected: caps DOM
size but still re-renders every windowed row on each keystroke).

**Precedent to copy**: `ui/Splitter.tsx` already does exactly the right thing for drag —
DOM writes through a ref during the drag, commit to the store only on release. `dragOverId`
should adopt that pattern.

## R6 — Identity-keyed fingerprint memoization

**Decision**: Memoize `fingerprintEntry` in a `WeakMap<NativeWorldInfoEntry, string>`.

**Rationale**: One push of a 1000-entry book after editing **one** entry currently performs
three independent full passes that stringify and hash all 1000 entries — `analyzeNativeBook`
([divergence.ts:49](../../src/core/sync/divergence.ts#L49)), `planBoundImport`
([import.ts:149-158](../../src/core/sync/import.ts#L149-L158)) and `flattenRoot`
([flatten.ts:120-125](../../src/core/sync/flatten.ts#L120-L125), which also
`structuredClone`s each entry). The per-entry granularity is already the right design; it
simply is not cached. Combined with R1, the other 999 `native` objects keep identity, so
all three passes become O(1) per unchanged entry.

## R7 — Sync engine loop fixes

**Decision**: Four local, low-risk fixes:
1. Hoist `entitiesOfRoot` out of the tombstone filter predicate into a `Set<uid>` computed
   once per root ([syncEngine.ts:235-237](../../src/adapters/syncEngine.ts#L235-L237)) —
   verified: it is called *inside* the predicate, so with 100 tombstones and 2000 nodes it
   is ~300k node visits, inside an already-cloning `store.update`.
2. Make the dirty-book set incremental (`pendingBooks`) instead of re-walking every root's
   subtree per push tick ([syncEngine.ts:250-265](../../src/adapters/syncEngine.ts#L250-L265)).
3. Merge the two consecutive post-save `store.update` calls (`:387`, `:405`) into one —
   this also removes a double store notification that would otherwise complicate R9.
4. Replace `allocateLowestUid`'s linear-scan-from-zero
   ([syncEngine.ts:86-93](../../src/adapters/syncEngine.ts#L86-L93)) with a stateful cursor
   — it is O(n²) on first push/import of a 1000-entry book.

**Rationale**: Small, local, independently testable, and each has a clear O() improvement.
Unlike R1 these carry little regression risk.

## R8 — Markdown render, scan and reconcile

**Decision**: (a) Gate `renderWorkspace` on per-node identity so unchanged nodes skip
render, key construction and hashing; (b) key the entry cache by node object identity
instead of `stableStringify([...node.native...])`
([linkRender.ts:71](../../src/core/md/linkRender.ts#L71)); (c) batch `crypto.subtle.digest`
calls with a bounded `Promise.all` pool (8–16) instead of up to 2000 sequential awaits;
(d) in `scan.ts`, skip re-hashing files whose `(size, lastModified)` match the baseline and
read with bounded concurrency; (e) pre-bucket `disk` and `baseItems` into `Map`s in
`reconcile.ts` to remove the two genuine O(n²) matching passes
([reconcile.ts:134-180](../../src/core/md/reconcile.ts#L134-L180)).

**Rationale**: With a linked folder, every typing pause currently re-renders and re-hashes
the **entire** workspace. The existing caches have the right idea but their *key
construction* is itself a full serialization of every entry — the cache costs what it
saves. R1 makes (a) and (b) trivially correct.

**Note**: `scan.ts` already yields to the event loop every 25 files, so this is a
throughput problem, not a UI-freeze problem. FR-003's progress/cancel requirement is about
making that throughput visible and escapable.

## R9 — Hook architecture

**Decision**:
- New `src/adapters/hooks.ts`: a single typed emitter, `try { void ctx.eventSource.emit(...) } catch { debugLog }`,
  replacing the two duplicated inline lambdas in `settingsStore.ts`. New
  `src/core/hooks/events.ts` holds event names and **payload types** — today the
  `wi-workspace:*` payloads have no declared types anywhere in the codebase, only prose in
  `AGENTS.md` (this is the FR-008 gap).
- **Tree events**: derived from a **store-level diff subscription** in `settingsStore.ts`,
  mirroring the existing image-GC subscription pattern that already keeps a
  `previousState` snapshot, with **microtask coalescing**.
- **Book push outcome**: emitted at the terminal points inside `pushBook`, covering
  success, save-failure, conflict-blocked, validation-blocked and missing-book.
- **Root designation**: emitted inside the five engine methods (`designateRoot`,
  `undesignateRoot`, `deleteRootBook`, `renameRootBook`, `importUnboundBook`), never at
  the callers.
- **Workspace open/close**: emitted in `index.ts`, covering the already-open-at-init
  bootstrap and mode switches.

**Rationale, and the key correction to the spec's assumption**: `applyTreeChange` is *not*
the universal funnel. Verified bypasses: `WorkspaceApp.applyOperation` does a raw
`store.replace` with no sync effects
([WorkspaceApp.tsx:143-149](../../src/ui/WorkspaceApp.tsx#L143-L149)) and backs create,
expand, duplicate, rename, bulk enable/disable, field commit, image commit and inline
rename; plus reorder, demo load, markdown import, and ~11 native-sync mutation sites. The
only place no route escapes is `WorkspaceStore.notify`. FR-009 ("exactly once per
occurrence regardless of which route caused it") is therefore only satisfiable by diffing.

Coalescing is required because single logical changes legitimately notify more than once:
`applyTreeChange` calls `replace` then `refreshStructure` (itself a `store.update`), and
undo restores fields in a per-field loop. The diff must also ignore
bookkeeping-only deltas (`sync`, `native.uid`, `tombstones`, `expanded`, settings-only) so
a push does not masquerade as a user-visible tree change.

**Containment (FR-010)**: the host's own `eventSource.emit` is `async` and already
`await`s each listener inside its own try/catch, so a throwing subscriber cannot break us
today. The plugin-side `void` (never awaiting) is what guarantees a *slow* subscriber
cannot block a workspace operation — this contract is deliberately preserved, with a
plugin-side try/catch added to close the synchronous-throw gap.

**Alternatives considered**: patching all bypasses to route through `applyTreeChange`
(rejected — see Complexity Tracking); mirroring the internal `saveEvents.ts` bus to a
public hook (rejected: it also covers create/delete-book failures so it would over-fire,
and it has no "blocked" outcome so it would under-cover); emitting from `shell.ts`
(rejected: it is deliberately pure DOM with no context dependency).

**Testability constraint**: the existing contract tests inject `emit` as a callback and
assert exact payloads. The new emitter must stay injectable in that shape.

## R10 — Measuring the budgets repeatably (FR-006)

**Decision**: Two complementary mechanisms.
1. `tests/perf/` Vitest suite over `tests/support/scaleDataset.ts` (seeded, deterministic
   generator for 1000 entries / ~2000 nodes) asserting **budgets on pure core paths** —
   store mutation, bulk ops, flatten, fingerprint, reconcile, render. Deterministic and
   re-runnable, so the gate survives later changes.
2. A live procedure in `quickstart.md` using the browser Performance API (long-task and
   input-latency observation) for the genuinely UI-bound criteria (SC-001, SC-002), run on
   the reference environment.

**Rationale**: SC-001/SC-002 are user-perceived and cannot be honestly asserted in jsdom;
core-path budgets can be, and they are what regress silently. Splitting them keeps each
measurement honest about what it proves. Thresholds are set generously against the
reference environment (documented in `contracts/performance-budgets.md`) so the suite
fails on *regressions*, not on hardware variance.

**Known floor**: `saveSettingsDebounced` serializes the whole settings object (a multi-MB
`JSON.stringify` + POST for a 1000-entry workspace) on the app's own 1000 ms debounce.
This is the app's contract, not ours, and it bounds how cheap a typing pause can ever be.
Budgets must be set with that floor acknowledged rather than pretending it away.

## R11 — Documentation structure

**Decision**: `README.md` (user-facing: install, relationship to the native editor,
workspace/tree, WI roots and sync semantics, markdown convention and limits, assistant
prerequisites, environment requirements), `docs/hooks.md` (extension-author reference), and
`CHANGELOG.md`. `AGENTS.md` stays contributor-facing and gains the maintenance mechanics.

**Rationale**: The repository has **no README at all** — only `AGENTS.md`, which assumes
the spec folders. FR-015's environment limits (desktop-Chromium/secure-context markdown
linking; Connection Manager for the assistant) are exactly the things a new user hits
first and cannot currently discover.

## R12 — Maintenance process and the constitution amendment

**Decision**: Constitution 1.2.0 → 1.3.0 (MINOR) carrying the binding rule — a bounded
maintenance path exists, gated by the contract-based threshold. `AGENTS.md` carries the
mechanics. `CHANGELOG.md` is seeded with one summary entry for "0.4.11 and earlier"
referencing specs 002–005, with real per-release history from 0.4.12.

**Rationale**: Governance states the constitution supersedes other project documents, so
the rule must live there or be void where it conflicts with Principle VIII. The existing
commit convention already carries `(spec-00N)` and `release X.Y.Z` tags, so changelog
entries have a natural source. Reconstructing full history was rejected by the owner as
costly and prone to inventing detail for releases never published to users.

**Threshold (binding form)**: a change may take the fix path only if it adds no new user
capability **and** alters no delivered contract — persistence schema, markdown convention,
assistant protocol, native World Info sync semantics, hook names and payloads.
