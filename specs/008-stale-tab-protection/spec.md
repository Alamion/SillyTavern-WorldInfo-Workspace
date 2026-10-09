# Feature Specification: Stale-Tab Protection

**Feature Branch**: `008-stale-tab-protection`

**Created**: 2026-10-09

**Status**: Draft

**Input**: Maintenance backlog item B1 (moved here, see "Original report" at the end), owner
choice 2026-10-09: "option 1 — the cheap staleness check". Observed on the `dev` account:
summaries filled in one browser were saved and pushed to the native book; about an hour
later a tab in another browser, opened earlier, saved its in-memory workspace over them.
The workspace lost the summaries without any warning; the native book kept them.

## Baseline and Scope

- **Cause**: the workspace is stored inside the app's settings. Every open tab or device
  saves its own copy of ALL settings for many reasons (a workspace edit, a chat switch,
  another extension, a UI toggle), and the server accepts whatever arrives last. A tab
  that has been open for a while therefore writes its old workspace back.
- **This feature**: each saved workspace carries a small marker that says how new it is
  and who wrote it. A tab compares its own copy with the saved one at the moments it
  matters and then picks up the newer workspace, restores its own newer one, or asks.
- **Out of scope** (owner decision): moving the workspace into its own storage file,
  same-browser tab messaging, and stopping the app from saving a stale copy for reasons
  unrelated to the workspace (an extension cannot prevent those saves). That residual
  risk is documented, and the README warning stays, reworded.
- **Delivered contracts touched** (why this is a spec): the persistence schema (spec 003)
  gains an optional, additive marker and new load rules. The hook surface is NOT changed
  (FR-012).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A tab picks up newer changes when you come back to it (Priority: P1)

The user edits the workspace on device B. Later they return to tab A, which was opened
before those edits and has not been changed since. As soon as tab A is shown again, it
quietly loads the newer workspace and says so briefly. Nothing is lost, and tab A's later
saves carry the new workspace.

**Why this priority**: this is the observed failure. Most stale tabs are simply tabs left
open; picking up the newer copy when they come back closes the common case.

**Independent Test**: open the workspace in two browsers on the same account; change an
entry in B; switch to A — the change appears in A without a reload and a short notice is
shown; then trigger any app settings save in A — the change is still in the saved file.

**Acceptance Scenarios**:

1. **Given** tab A open with no edits since it loaded, **When** the workspace is changed
   and saved in tab B and the user returns to tab A (the page or the workspace becomes
   visible, or the window regains focus), **Then** tab A shows B's workspace and a short
   notice "Updated with changes made in another tab or device".
2. **Given** tab A has just picked up B's workspace, **When** tab A saves settings for
   any reason, **Then** the saved workspace is B's (with any later edits of A), never A's
   old one.
3. **Given** the workspace has not changed anywhere else, **When** tab A is shown again,
   **Then** nothing visible happens.

---

### User Story 2 - Both sides changed: the user decides, nothing is lost silently (Priority: P1)

Tab A is stale and the user edits something in it before A has noticed the newer saved
workspace. Before A saves that edit, it notices the difference and does not overwrite.
A banner explains that the workspace was changed in another tab or device and offers:
use the saved version (A's edit is discarded) or keep this version (the other changes are
overwritten). Until the user chooses, A does not save its workspace.

**Why this priority**: without it, story 1 only moves the loss to the case where the
user edits first and switches later.

**Independent Test**: two browsers; change entry X in B; in A (without returning focus
to it in between, e.g. both visible side by side) edit entry Y; the banner appears in A
and the saved file still holds B's version; each banner choice gives the described
result.

**Acceptance Scenarios**:

1. **Given** A is stale and the user edits in A, **When** A is about to save its
   workspace, **Then** it does not save, and a banner offers "Use the saved version" and
   "Keep this version".
2. **Given** the banner, **When** the user picks "Use the saved version", **Then** A shows
   the saved workspace and A's unsaved edit is gone (the banner said so before the
   choice).
3. **Given** the banner, **When** the user picks "Keep this version", **Then** A's
   workspace is saved and becomes the newest; other tabs pick it up by story 1.
4. **Given** the banner is open, **When** the user keeps editing in A, **Then** the edits
   are kept in A and included if "Keep this version" is chosen; nothing of A's is saved
   before the choice.

---

### User Story 3 - A newer tab repairs an overwrite by a stale one (Priority: P2)

A stale tab overwrites the saved workspace anyway — for a reason the extension cannot
stop (the app saving all settings after a chat switch, for example) or because it runs an
older version of the extension. When a tab holding a newer workspace notices that the
saved copy is OLDER than its own, it saves its own copy back and tells the user.

**Why this priority**: the residual risk cannot be prevented, but as long as the tab with
the newest workspace is still open somewhere, the loss is repaired instead of permanent.

**Independent Test**: A stale, B newer and still open; trigger an app settings save in A
before A is shown again (so A writes its old workspace); then show B — B restores its
workspace, shows a notice, and the saved file holds B's workspace again.

**Acceptance Scenarios**:

1. **Given** B holds the newest workspace and the saved copy was replaced by an older one,
   **When** B is shown again or is about to save, **Then** B saves its workspace back and
   shows "Restored the newer workspace from this tab; another tab had saved an older copy".
2. **Given** the saved copy was written by a tab with the extension's previous version
   (no marker update), **When** B notices that the saved workspace differs from the last
   one B saw, **Then** B does not guess which is newer: it shows the story 2 banner.

---

### User Story 4 - The remaining risk is stated plainly (Priority: P3)

The README tells users what is protected now and what is not: a stale tab can still write
an old copy when the app saves settings for its own reasons, and the newest tab repairs
it only while it is open. The workspace's lorebooks are not affected by this.

**Why this priority**: honest documentation; no new behaviour.

**Independent Test**: read the README section; it matches the behaviour of stories 1–3.

**Acceptance Scenarios**:

1. **Given** the README, **When** a user reads the sync section, **Then** it states what
   is detected and repaired, and what still needs a reload of other tabs.

---

### Edge Cases

- **No marker yet** (a workspace saved before this feature, or by the previous version):
  treated as "unknown age". The first save by the new version adds the marker. A
  difference from the last seen copy without a usable marker goes to the story 2 banner,
  never to a silent load or restore.
- **Equal age, different content** (both tabs edited from the same starting point): this
  is a conflict — story 2 banner in whichever tab notices it first.
- **Recovery pending** (the tab loaded an invalid workspace and the recovery banner is
  open): a newer valid saved workspace is offered through the banner, never loaded or
  overwritten silently; the existing recovery rule (nothing is published before the
  user's first edit) stays in force.
- **The server cannot be reached** for a check: no decision is made; the tab keeps
  working, retries at the next check, and the workspace's own save is not held back by a
  failed check longer than one retry (an unreachable server fails the save anyway).
- **Native World Info books after a load**: entries pulled from another device are
  already in sync with their books there; loading them must not push books again or
  raise divergence banners. Books changed natively in between follow the usual
  clean-side merge.
- **Markdown folder link** (per browser): a loaded newer workspace counts like workspace
  edits for the linked folder (pushed to disk by the usual rules); conflicts with disk
  changes follow the existing link rules.
- **Unsent text in an editor field** when a newer workspace is loaded silently: the field
  draft is a local edit; it turns the situation into story 2 instead of being dropped.
- **Many checks in a row** (fast window switching): at most one check runs at a time,
  and checks closer together than a few seconds reuse the last result.
- **Very large workspaces** (spec 006 scale, ~1000 entries): a check and a load must not
  make the workspace feel stuck.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every save of the workspace by this extension MUST record a marker of its
  age (increasing with every save) and of the writing tab. The marker is additive and
  optional; a workspace without it loads as before.
- **FR-002**: A tab MUST remember the marker and content identity of the workspace it
  last loaded or saved ("last seen copy").
- **FR-003**: A tab MUST compare the saved workspace with its last seen copy (a "check")
  when the page becomes visible, when the window regains focus, when the workspace is
  shown, and before every save of its own workspace.
- **FR-004**: If the saved workspace is newer than the last seen copy and the tab has no
  local edits since then, the tab MUST load it without asking and show a short notice
  (story 1).
- **FR-005**: If the saved workspace is newer and the tab has local edits (including
  uncommitted field drafts), or the age cannot be decided (FR-009), the tab MUST NOT save
  its workspace and MUST show a banner with "Use the saved version" and "Keep this
  version", stating what each discards (story 2).
- **FR-006**: "Use the saved version" MUST load the saved workspace and drop the tab's
  local edits; "Keep this version" MUST save the tab's workspace as the newest.
- **FR-007**: If the saved workspace is OLDER than the tab's own (a stale writer replaced
  it), the tab MUST save its own workspace back and show a notice (story 3).
- **FR-008**: Detection MUST also work for changes written without a marker update
  (previous extension versions): a saved workspace whose content differs from the last
  seen copy while its marker does not is a change of unknown age.
- **FR-009**: A change of unknown age MUST go to the FR-005 banner; it is never loaded or
  overwritten silently.
- **FR-010**: Loading a newer workspace MUST NOT trigger native book pushes or
  divergence banners for entries that are already in sync with their books, and MUST
  NOT discard the tab's assistant conversations, composer draft, or markdown link
  (those live per browser, outside the workspace).
- **FR-011**: While a data recovery is pending, a newer valid saved workspace MUST be
  offered, not loaded or overwritten, and the existing no-publish rule MUST hold.
- **FR-012**: A load MUST be announced to other extensions through the existing
  `wi-workspace:tree-changed` event (it is a user-visible tree change); no new hook is
  added.
- **FR-013**: A failed check (server unreachable) MUST NOT change anything; the next
  check retries.
- **FR-014**: The README MUST describe what is protected, the residual risk (stale tabs
  can still write an old copy through the app's own saves; repaired only while a newer
  tab is open), and that lorebooks are unaffected (story 4).

### Key Entities

- **Save marker**: part of the saved workspace — age (a number that grows with every
  save), writer (an id of the tab that saved), time of the save.
- **Last seen copy**: per tab, in memory — the marker and a content identity of the
  workspace the tab last loaded or saved.
- **Staleness check result**: unchanged / newer elsewhere / older elsewhere / conflict
  (unknown age or both changed).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In the observed scenario (edit in B, return to an untouched A, any save in
  A), 0 of B's changes are lost in 10 of 10 runs.
- **SC-002**: A tab shows the newer workspace within 2 seconds of being shown again, for
  a workspace of up to 1000 entries.
- **SC-003**: When both sides edited, no save silently replaces the other side's changes
  in 10 of 10 runs; the user's choice decides every time.
- **SC-004**: When a stale tab overwrote the saved workspace and the newest tab is still
  open, the newest workspace is back in the saved file after that tab is shown once
  (10 of 10 runs).
- **SC-005**: Loading a newer workspace causes 0 native book saves and 0 divergence
  banners for entries already in sync.
- **SC-006**: With a single tab, the user notices no difference: no extra notices, no
  banners, and edits save as quickly as before.

## Assumptions

- Checks happen at the moments in FR-003; there is no background polling while a tab
  stays visible and untouched. A tab left visible next to another device's edits catches
  up when the user returns focus to it or edits in it (story 2 then applies).
- Reading the saved settings for a check is acceptable in cost at these moments; the plan
  verifies this and may narrow what is read.
- The workspace's own saves still go through the app's settings save; only the decision
  of whether to save (and with which workspace) is new.
- A tab's identity lives only as long as the tab; reloading the page makes it a new
  writer that starts from the saved workspace.
- Assistant settings and layout sizes are part of the saved workspace and travel with a
  load like the tree.
- The native books keep being the safety net they are today: they are per-book files with
  their own divergence guards and are not part of this feature.

## Original report (backlog B1) — An open tab silently overwrites workspace changes made elsewhere (2026-10-09)

**Did:** Workspace open in tab A (owner's browser). In tab B (another browser) filled the
summaries of 10 Aldermeer entries through the editor; they were saved to `settings.json`
and pushed to the native book. Then kept working in tab A without reloading it.
**Expected:** Tab A picks up the changes, or at least warns before replacing them.
**Actual:** About an hour later tab A saved its in-memory workspace over the file; the
summaries vanished from the workspace (the native book kept them). No warning.
**Area:** other (persistence)

**Mechanism.** The workspace lives in `extensionSettings['WorldInfoWorkspace']`. The app's
`saveSettings()` posts the tab's WHOLE settings object, `extension_settings` included,
to `/api/settings/save`; the server stores it without revisions or conflict checks. Any
save in a stale tab — a workspace edit, but also a chat switch, another extension, a UI
toggle — writes that tab's old tree back. Native books are not affected the same way
(per-book files, our divergence guards), which is why the book kept the summaries.

**Why deferred, and where the fix goes.** Every real fix changes the persistence contract
(`specs/003-core-workspace-mvp/contracts/persistence-schema.md`), so it is routed to a
spec, not a maintenance change. Options to weigh there:

1. **Staleness check (cheap, partial).** A `revision` + `writerId` in the payload; on
   `visibilitychange`/focus and before our own saves, fetch `/api/settings/get` and
   compare. Newer on the server → reload the tree when there are no local edits, otherwise
   a banner "changed in another tab/device: reload / keep mine". Shrinks the window but
   cannot stop the app saving a stale copy for unrelated reasons (an extension cannot
   veto `saveSettings`).
2. **Same-browser tabs (cheap, partial).** `BroadcastChannel` to tell other tabs of the
   same profile to reload or go read-only. Does nothing across devices.
3. **Own storage file (real fix).** Move the tree out of extension settings into its own
   server file (e.g. user files API, one document per workspace) written with a revision
   check (read-compare-write); settings keep only a pointer and small preferences. A stale
   tab then cannot write the tree through unrelated app saves, and our own saves detect
   the conflict. Costs: migration, a storage port, offline/failed-write handling, and
   checking what the user-files endpoints guarantee.

Likely shape: 3 as the fix, 1 as its conflict UI, 2 as a bonus. Until then: README note —
reload other open tabs/devices before editing the workspace elsewhere.
