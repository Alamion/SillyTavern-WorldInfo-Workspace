# Maintenance backlog

Reported items that are accepted but deliberately **not fixed yet**. Items fixed straight
away never appear here — `CHANGELOG.md` is their record. Items that turn out to touch a
delivered contract are removed from here and routed to a spec.

Format: the report verbatim, plus why it was deferred.

---

## B1 — An open tab silently overwrites workspace changes made elsewhere (2026-10-09)

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
