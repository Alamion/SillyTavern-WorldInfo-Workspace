# Contract delta: persistence schema (spec 003) — stale-tab protection

Amends `specs/003-core-workspace-mvp/contracts/persistence-schema.md`. Schema version
stays **1**; every change is additive.

## Shape

```text
WorldInfoWorkspace = {
  version: 1,
  root, settings,            // unchanged
  _recovered?,               // unchanged
  _save?: { rev: number, writer: string, at: string, hash: string }   // NEW, optional
}
```

`_save` semantics: data-model.md (SaveMarker). Readers that do not know it keep it
untouched (rule 7, already in force).

## Save rules (replace "saved debounced after every mutation")

1. A mutation no longer publishes immediately. It schedules a **guarded save**
   (1000 ms debounce): read the saved payload (`/api/settings/get`), classify it against
   the tab's last seen copy (research R2), then:
   - `unchanged` / `older` → publish this tab's state with a new `_save`, then
     `saveSettingsDebounced()`; for `older` also show the restore notice (FR-007);
   - `newer` and no local edits → load it (Load rules below), no save;
   - `newer` with local edits, or `conflict` → publish nothing; open the conflict state;
   - `failed` → retry once, then publish and save as before this feature.
2. While the conflict state is open, the namespace keeps the last seen copy; the app's
   unrelated saves therefore write that copy, never unconfirmed edits.
3. Native book pushes wait for the same gate and are held while the conflict state is
   open.
4. The recovery no-publish rule is unchanged and takes precedence.

## Load rules (new: load while running)

- A newer saved payload is migrated, receives this tab's bookkeeping (folder `expanded`
  by node id, `settings.layout`, `settings.sortMode`), and replaces the store. It is
  published but not saved again.
- The load is a store replacement; the existing store-level diff emits
  `wi-workspace:tree-changed` (no new hook — `specs/006-hardening-interop/contracts/hooks.md`
  is unchanged).

## Checks

Visibility gained, window focus, workspace shown, before guarded saves and native
pushes, and every 2 minutes while the page is visible. One at a time; a result younger
than 3 s is reused.
