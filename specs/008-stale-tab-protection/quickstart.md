# Quickstart: Stale-Tab Protection

Live validation guide. Scenario ids T0–T14 map to the spec's stories and success
criteria; implementation detail belongs in `tasks.md`.

## Prerequisites

- Local instance `http://127.0.0.1:8634`, `dev` account, production build, four gates
  green.
- Two independent browser contexts on the same account ("A" and "B"): two
  `playwright-cli` sessions from different directories, or Chromium + another browser.
  No other tab of the account may be open.
- The server log (own process, `.live/` notes) to confirm what was saved.

## Scenarios

| # | Story | Steps | Expected |
|---|---|---|---|
| T0 | — | Single tab: edit, reload, edit, switch windows for 5 min | No notice, no banner; edits saved as before (SC-006) |
| T1 | 1 | Open A, then B; edit entry X in B; switch to A | A shows X's edit within 2 s, notice "Updated with changes…" (SC-002) |
| T2 | 1 | After T1, change the chat in A (an app settings save) | `settings.json` still holds B's edit (SC-001) |
| T3 | 1 | A visible, untouched, B edits; wait | A updates within 2 min without focus (SC-007) |
| T4 | 1 | A has folders expanded and a resized tree; B edits; switch to A | A loads B's edit, keeps its expand state and sizes (FR-015) |
| T5 | 2 | B edits X; in A (no focus change) edit Y | Banner in A with "Changed here: Y", "Changed there: X"; file still has B's version (SC-003) |
| T6 | 2 | From T5: "Use the saved version" | A shows X edited, Y not; no native push of Y happened |
| T7 | 2 | From T5 again: "Keep this version" | File holds A's version; B picks it up on focus |
| T8 | 2 | Banner open; keep editing in A, then "Keep this version" | Later edits included |
| T9 | 3 | A stale; trigger an app save in A before focusing it (e.g. switch chat via script) while B is open with newer content; focus B | B restores, notice "Restored…"; file holds B's version (SC-004) |
| T10 | 3 | Write a payload with new content but the old marker (simulates a previous extension version); focus A | Banner, no silent load or restore (FR-008/FR-009) |
| T11 | — | B edits; in A only expand folders; focus A | Silent load, no banner (bookkeeping, FR-015) |
| T12 | — | Stop the server; focus A; edit | No change, no banner; save behaves as today once the server is back (FR-013) |
| T13 | — | Recovery pending in A (invalid payload); B saves valid content; focus A | Recovery banner plus "Use the saved version"; nothing published silently (FR-011) |
| T14 | — | Linked markdown folder in A; B edits; focus A | Loaded edit is written to the folder by the link's rules; no divergence banner, no native push (FR-010, SC-005) |

## Automated coverage

- Unit: content hash projection (bookkeeping excluded), marker trust, classification
  table, conflict summary (10 + "and N more").
- Integration (fake host with a mutable server payload): T1, T2, T5–T11, T13 as
  scenarios; native push held during conflict; no push after a load.
- Perf: content hash of the 1000-entry scale dataset within budget (P-12).

## Results

*(to be filled in by the live pass)*
