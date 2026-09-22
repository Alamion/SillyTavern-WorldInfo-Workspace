# Contract: Maintenance Change Process

How a change too small for a full spec cycle gets reported, triaged, fixed and recorded.

Binding rule: **constitution 1.3.0** (Principle VIII qualification). Mechanics: `AGENTS.md`.
This document is the design source for both.

---

## 1. The threshold (FR-018)

A change may take the fix path **only if both** hold:

1. it adds **no new user capability**, and
2. it alters **no delivered contract**.

The delivered contracts are exactly:

| Contract | Defined in |
|---|---|
| Persistence schema (`extensionSettings['WorldInfoWorkspace']`, v1) | spec 003 `contracts/persistence-schema.md` |
| Markdown convention (front matter, folder records, round-trip guarantees) | spec 004 `contracts/markdown-convention.md` |
| Assistant protocol (`<op …>` blocks, handles, refs) | spec 005 `contracts/assistant-protocol.md` |
| Native World Info sync semantics (authority, tombstones, naming invariant, divergence) | spec 003 + `AGENTS.md` |
| Hook names and payloads | spec 006 `contracts/hooks.md` |

**Anything touching those goes to a spec.** Not "usually" — always. The threshold exists
because the dangerous change in this codebase is not the large one; it is the small one
that quietly alters sync or persistence behaviour.

Adding a **new** hook event is additive and does not alter an existing payload, but it
extends the published surface and is documented, so it takes the spec path. Fixing an
event that does not match its documented payload is a fix.

### Worked examples

| Change | Path | Why |
|---|---|---|
| A button's label is wrong | Fix | No capability, no contract |
| A drag-drop edge case throws | Fix | Behaviour restored to what the spec already promised |
| Preview mis-renders nested lists | Fix | Preview output is not a delivered contract |
| A field is added to a hook payload | **Spec** | Alters a published contract |
| An unknown `wi_*` key is dropped on markdown import | **Spec** | Alters the markdown convention's preservation guarantee |
| A new "duplicate subtree" action | **Spec** | New user capability |
| A sync push is made to retry twice on failure | **Spec** | Alters native sync semantics |
| A perf fix making the tree render faster | Fix | No capability, no contract |

When genuinely ambiguous, the answer is **spec**. The asymmetry is deliberate: an
unnecessary spec costs time, a wrongly-skipped one costs a broken contract.

---

## 2. Report template (FR-021)

Reported in conversation, minimal by design:

```
**Did:**       <what you did, enough to reproduce>
**Expected:**  <what should have happened>
**Actual:**    <what happened>
**Area:**      <tree | editor | sync | markdown | assistant | lorebooks | other>
```

Sufficient to reproduce without follow-up questions. Several may be reported at once.

---

## 3. Triage

Each reported item gets exactly one outcome:

- **fix-path** — threshold passes; fix now
- **needs-spec** — threshold fails; route to a new spec, state which contract it touches
- **deferred** — threshold passes but not now; written to the backlog (FR-022)

Items fixed immediately do **not** get a backlog entry — the changelog is their record.

---

## 4. Records

### `CHANGELOG.md` (FR-019)

Keep a Changelog style, newest first, grouped by release version. One line per
user-visible change, written for users — what changed, not how.

```markdown
## 0.4.12 — 2026-09-30

### Fixed
- Dragging a folder onto its own child no longer clears the selection.

### Changed
- The tree keeps its scroll position when a large folder is collapsed.

## 0.4.11 and earlier

Initial development across roadmap Phases 0–3 — workspace, native World Info sync,
markdown folder sync and the AI lore assistant. See `specs/002`–`specs/005` for the
delivered increments.
```

Internal-only changes (refactors, test additions) do not need an entry.

### Rationale record (FR-020)

Written **only** when the change embeds a non-obvious decision — where a future reader
would reasonably ask "why this way?". Appended to the maintenance log:

```markdown
### 0.4.12 — Tree keeps scroll position on collapse

**Decision:** Anchor on the first visible row rather than restoring a saved pixel offset.
**Why:** Pixel offsets are meaningless after a collapse changes row count; anchoring is
stable and needs no saved state.
**Rejected:** Saving scrollTop per folder — grows unboundedly and is wrong after edits.
```

A change with no such decision gets no record. This is what keeps the common case to a
single changelog line.

### Backlog (FR-022)

Deferred items only, with the report verbatim plus why it was deferred. Removed when fixed
(the changelog takes over) or when routed to a spec.

---

## 5. Regression tests (FR-023)

Each fix is covered by a regression test where the behaviour is testable — pure core logic
always, adapter behaviour through the existing harnesses. Purely visual changes (spacing,
colour) need none; state, data or event behaviour always does.

---

## 6. Documentation discipline (FR-016)

Documentation is updated **in the same change** as the behaviour or contract it describes
— never in a follow-up. A fix that changes what `README.md` or `docs/hooks.md` states is
not finished until those files state the new truth. All documentation is English-only
(constitution IX).

## 7. Quality gates

Unchanged and non-negotiable: `typecheck`, `lint`, `test`, `build` all pass before any
commit (constitution III–VI). The maintenance path shortens *documentation*, never
verification.

---

## 8. Constitution amendment (FR-024)

Version **1.2.0 → 1.3.0** (MINOR — materially expanded guidance). Principle VIII is
qualified so a bounded maintenance path is legitimate rather than a documented violation:

> Improvements over that pattern MUST go through the speckit workflow. Changes that add no
> new user capability and alter no delivered contract MAY instead take the documented
> maintenance path (`AGENTS.md`), which requires the same quality gates and records the
> change in `CHANGELOG.md`. Any change touching a delivered contract MUST take the full
> workflow.

Requires a sync impact report and rationale in the constitution header, per Governance.
