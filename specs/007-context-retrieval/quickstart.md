# Quickstart: Context & Retrieval (Phase 6)

Live validation guide. Scenario ids C0–C40 map to the spec's user stories and success
criteria. Implementation detail belongs in `tasks.md`.

## Prerequisites

- Local instance `http://127.0.0.1:8634`, `dev` account (safe to modify); production
  build (`pnpm run build`); all four gates green.
- A connection profile that answers (owner: "openrouter free provider" — replies take
  ~30 s; allow for it).
- For US4: Memory Books installed on the `dev` account (Doom's Enhancement Suite and
  DeepLore optional — their scenarios are skipped, not failed, when absent).
- Datasets: the Aldermeer demo (small) and the scale dataset generator from spec 006
  (`tests/support/scaleDataset.ts`, ~1000-entry book) for catalog scenarios.

## A. Context preview (US1, SC-001)

| # | Scenario | Expected |
|---|---|---|
| C0 | Open the preview for a request with a selected entry whose keys trigger two others | 3 entries: "selected", 2× "key 'x'"; each ≈tokens; total matches the budget display |
| C1 | Send it; open "Context" on the sent message; then edit one of the entries; reopen | Same items as before sending; unchanged after the edit (snapshot) |
| C2 | Shrink the context budget until entries drop | Left-out list "over budget"; one entry "truncated NN %" ending at a sentence end with "[…]" (FR-012) |
| C3 | Repeat C0–C2 for 20 requests across scopes/modes | Preview = sent request every time (SC-001) |

## S. Summary round trip (US2, SC-003 — owner: test thoroughly)

| # | Scenario | Expected |
|---|---|---|
| C4 | Type a summary in the editor; reload the page | Summary present; tree tooltip shows it |
| C5 | Entry in a WI root: wait for the push; open the book file on disk | `extensions.wiw_summary` present; nothing else changed |
| C6 | Edit another field of that entry in the NATIVE editor; return to the workspace | Summary still there in both |
| C7 | Edit the summary in the native data (book JSON via the app's API) | Pulled into the workspace as a clean-side change |
| C8 | Markdown export → open the file → `wi_summary` present, not duplicated in `wi_extensions` → edit the summary on disk → Sync | Workspace shows the edited summary; native book updated |
| C9 | Import a markdown folder whose files carry `wi_summary` | Summaries present after import and in the native book |
| C10 | Embed the book into a character card and import it back as a book | Summary survives |
| C11 | Over 300 chars | Saved; warning shown; catalog shows it shortened with a mark |
| C12 | Ask the assistant to write summaries for a folder of 10 entries | 10 reviewable proposals (summary only); accept 7, reject 3; undo the batch → summaries gone |

## B. Catalog selection (US2, SC-002)

| # | Scenario | Expected |
|---|---|---|
| C13 | Small library, Catalog = Auto | Request identical to before this phase (no catalog section) |
| C14 | 1000-entry library, Auto, ask a question answered by an entry no key matches | Catalog sent; model emits `read`; status "Reading…"; continuation in the same reply uses the entry |
| C15 | Same with a folder too big to list | Folder shown as "(folder, N entries)"; `open` lists it; then `read` |
| C16 | Model tries to edit an entry it never read | Proposal invalid "read the entry first" |
| C17 | Force three read rounds | Fourth request carries "No more reads…"; reply finishes |
| C18 | Stop during a read round | Reply ends with what arrived; nothing applied |
| C19 | 10 test questions per SC-002 with catalog on vs off | ≥ 8/10 answered from the right entries with catalog on |

## C. Fuzzy, sets (US3)

| # | Scenario | Expected |
|---|---|---|
| C20 | Fuzzy on; text "forged seal", entry keyed "forge" only | Entry added as "fuzzy match", after key-triggered ones, max 5 |
| C21 | Save a context set; new conversation; apply it | Same choices; chip shows the set name |
| C22 | Edit the set; check an old request's snapshot | Old snapshot unchanged |
| C23 | Delete a folder referenced by a set; apply the set | Notice "1 missing item"; the rest applies |

## D. Interop (US4, SC-004, SC-008)

| # | Scenario | Expected |
|---|---|---|
| C24 | Create 3 memories with Memory Books in a chat whose lorebook is a WI root | Badges "Memory" on 3 entries |
| C25 | Edit one memory's content in the workspace; let it push | All `STMB_*`/`stmemorybooks` fields byte-identical; Memory Books still lists, numbers, regenerates and rolls back the memory |
| C26 | Reorder the memories in the tree | Native `displayIndex`/`order` unchanged |
| C27 | Rename "[001] - Arrival" to "Arrival" | Confirmation warns about numbering |
| C28 | "Create memory (Memory Books)" button | Runs Memory Books' command; its UI appears |
| C29 | Doom's suite tracking present characters; enable "Scene cast" | Request lists the cast; entries named after present characters preferred |
| C30 | DeepLore installed; enable "DeepLore matches" | One item "DeepLore matches" with its text |
| C31 | Disable all three extensions; full session | No interop options, no badges' buttons (badges remain data-driven), 0 console errors from the plugin |

## E. Main-chat picking (US5, SC-005–SC-007)

| # | Scenario | Expected |
|---|---|---|
| C32 | Picking off; chat 5 turns | 0 picking requests (network panel); WI result identical to before (SC-005) |
| C33 | Picking on; active book with an entry no key matches; write about its subject | Entry in the prompt (prompt itemization); reply icon → popup lists it "inserted" with a reason |
| C34 | Next turn without new entities | Popup source "prepared", 0 ms wait |
| C35 | Next turn naming an entry not in the prepared pick | Source "fresh"; wait ≤ timeout |
| C36 | Timeout 5 s with a slow profile | Reply not delayed beyond ~6 s; toast; source "fallback" (SC-006) |
| C37 | Quiet generation (e.g. a summarize extension) and impersonate | No picking |
| C38 | Swipe; continue | Swipe: own pick per swipe; continue: "reused" |
| C39 | Exclude a folder; next fresh pick | None of its entries in the catalog request |
| C40 | 10 test turns per SC-007 | ≥ 8/10 contain the relevant unkeyed entry; ≥ 9/10 no-new-entity turns use the prepared pick |

## Gate

The phase closes when C0–C40 pass (interop scenarios for absent extensions: skipped and
noted), the summary matrix C4–C12 passes completely, and the four gates are green.

## Results

### Live pass — 2026-10-07 (dev account, free OpenRouter router, fixtures in `.live/README-fixtures.md`)

Gates: typecheck, lint, 796 tests + 13 perf budgets (incl. P-10/P-11, run uncontended), build — green.

| # | Result |
|---|---|
| C0 | PASS — preview lists request, structure, key/recursion entries with the chain ("step 3 from Lamp Night (key Bristlemark)"), catalog, ≈tokens vs budget |
| C1 | PASS — the layers icon on a reply shows that reply's snapshot |
| C2, C3 | Automated (`assistant-context` truncation/budget tests; preview = sent request in `assistant-controller`); not repeated live |
| C4 | PASS — summary typed in the editor; counter, tree tooltip |
| C5 | PASS — pushed into the book file as `extensions.wiw_summary`, nothing else changed |
| C6 | PASS — native edit of the content pulled; summary kept on both sides; no banner |
| C7 | PASS — native edit of the summary pulled into the field |
| C8–C10 | Automated only (summary matrix S6–S8: markdown export/import, on-disk edit, character-card round trip) |
| C11 | PASS — 303/300 shown with the warning; saved unshortened |
| C12 | PASS — the assistant proposed summaries for the 3 entries of a folder; 2 accepted reached the book, 1 denied did not; "Undo all" removed both |
| C13 | Automated (Auto + library that fits = byte-identical request) |
| C14 | PASS after a fix — first run: the model wrote "Let me read those two." without a block (rules only in the user turn); with the rules in the system message it wrote `<op type="read" ids="e12,e13">`, round 1 delivered both, the reply continued with details from them |
| C15–C18 | Automated (`assistant-controller` read rounds: open, unread edit rejected, 3-round limit, Stop) |
| C19, C40 | NOT RUN — the 10-question / 10-turn rates need the owner's real library and time; left to the week of use |
| C20 | Automated (fuzzy tests); option visible and saved in a set live |
| C21 | PASS — set saved from the menu, chip shows its name, applied in a new conversation with all choices |
| C22, C23 | Automated (`assistant-context-sets`, controller sets) |
| C24 | PASS — the Memory Books chat book imported as a root; three entries badged "Memory" |
| C25 | PASS — content edit pushed; all `STMB_*`/`stmemorybooks` fields, `displayIndex`, `order`, title unchanged (missing native defaults filled, as every import does) |
| C26 | PASS — tree order 1,3,2; native `displayIndex` stays 1,2,3 after the next push |
| C27 | PASS — renaming away "003 - " asks; Cancel keeps the name |
| C28 | PASS — the button runs Memory Books' `/creatememory` (it refused an overlapping scene by its own rules) |
| C29 | PASS — "Current scene" item, 1 present, ≈30 tokens |
| C30 | PASS after a fix — 2 DeepLore matches (≈1037 tokens) for a vault-related message; an empty result now reads "no matches for the recent chat" instead of a bare "unavailable" |
| C31 | Automated (`NO_INTEROP`, lazy probes); not run live (would disable the owner's extensions) |
| C32 | PASS — picking off: 1 generate request (the reply), no pick event, no record |
| C33 | PASS after a fix — fresh pick 11.5 s, two memories with reasons, both forced; one inserted, one cut by the native WI budget (25 % of 4095) and shown "not inserted"; a 400-token response limit had been spent on thinking — now the assistant's response length |
| C34 | PASS — next neutral turn used the prepared pick (0 ms wait, 12 s whole turn) |
| C35 | Automated (`picking` integration: named entry outside the prepared pick → fresh) |
| C36 | PASS — fresh pick exceeded 20 s on the free router: reply went ahead with keywords only, record "fallback / timed out" |
| C37, C38 | Automated (quiet/impersonate skipped; continue re-forces the stored pick) |
| C39 | Automated (excluded folder never offered) |

Fixes made during the pass (each with a test): catalog rules in the system message;
picking response length; read-round continuation on a new paragraph; DeepLore
"no matches" label; catalog lines use the cached node index (P-10).

### Live pass 2 — 2026-10-09 (own server process with request logging)

The server ran as a separate process (`~/apps/SillyTavern/start.sh`, output to a log), so
every request body could be checked; streamed replies of picking requests were captured
in the page (`.live/pick-tap.js`).

| # | Result |
|---|---|
| C8 | PASS — export of a folder: `wi_summary` in front matter, no `wi_extensions` duplicate; linked folder: summary edited on disk → Sync → workspace and native book updated (the push first hit a conflict banner: stale sync hashes left by the B1 incident, resolved with Push anyway — not a code defect) |
| C9 | PASS — the exported folder imported back: summaries kept; designated as a WI root: the new book file carries `extensions.wiw_summary` |
| C10 | PASS — a test character bound to that book: the exported card's `character_book` entries keep `extensions.wiw_summary`; the app's own `convertCharacterBook` brings them back; test character, book and folder removed afterwards |
| C16 | PASS (compliant branch) — catalog-only "Cinderhollow" asked for without naming it: the model wrote only `<op type="read" ids="e2">`, round 1 delivered it, the edit came after the read; the non-compliant branch stays covered by tests |
| C33 | PASS — "where the charcoal burners trade" with no key of Cinderhollow: fresh pick chose Cinderhollow by its summary (+ Verdant Span, Pale Roads); the server log shows all three in the main prompt |
| C34 | PASS — neutral turn after a finished background pick: `prepared`, 0 ms, 16 s whole turn. An earlier neutral turn sent while a slow background pick (2.5 min) was still running correctly fell back to the earlier pick after the 20 s limit |

Fixes from this pass (each with a test): the summary leaked into the assistant's entry
`fields:` line as `summary=[object Object]`, and `<fields>summary=…</fields>` could have
replaced the whole `extensions` object; a picking reply in another format (the free
router once sent a pick to a safety classifier: "User Safety: safe") passed for an empty
pick — now `<none/>` is the explicit "nothing needed" and anything else is a visible
failure; a fallback recorded "0 ms" instead of the time the reply waited.

