# UI contract: stale-tab protection

## Conflict banner (FR-005, FR-006, FR-016)

- Place: the workspace banner area (same component family as the save-failure and
  divergence banners), shown on every workspace surface (desktop regions and phone
  sheets) until a choice is made.
- Text: "The workspace was changed in another tab or device. Nothing from this tab is
  saved until you choose."
- Two lists, each titled and at most 10 lines + "and N more":
  - "Changed here (lost if you use the saved version)" — `seen → this tab`;
  - "Changed there (overwritten if you keep this version)" — `seen → saved`.
  Lines read "Bristlemark — edited", "Old Mill — added", "Faction hooks — removed",
  "Assistant settings — changed".
- Buttons: **Use the saved version** · **Keep this version**. No dismiss without a
  choice; editing stays possible (edits join "Changed here").
- During a pending recovery the banner replaces neither the recovery banner nor its
  buttons; it adds "A valid workspace was saved elsewhere" with **Use the saved
  version**.

## Notices (toasts, `notifyInfo`)

| When | Text |
|---|---|
| silent load (FR-004) | "Updated with changes made in another tab or device." |
| restore (FR-007) | "Restored the newer workspace from this tab; another tab had saved an older copy." |
| "Keep this version" done | "Saved this version." |

No notice for `unchanged`, for failed checks, or with a single tab (SC-006).

## README (FR-014)

The "One open tab at a time" warning in "World Info sync" becomes "Several tabs and
devices": what is detected and repaired, the residual risk (a stale tab saved by the app
for its own reasons is repaired only while a newer tab is open), and that native
lorebooks keep pushed changes either way.
