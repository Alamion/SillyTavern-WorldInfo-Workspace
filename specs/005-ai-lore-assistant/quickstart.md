# Quickstart & Validation: AI Lore Assistant

## Prerequisites

- Local instance `http://127.0.0.1:8634`, account `dev`, extension working copy built
  (`pnpm run build`) and all gates green (`typecheck`, `lint`, `test`, `build`).
- Connection Manager extension enabled; profiles `openrouter free provider`
  (router, variable model) and `openrouter small gemma free` present. The Gemma free
  profile is often rate-limited upstream — that is itself scenario A7.
- A workspace with the Aldermeer demo (or equivalent): one World Info root with nested
  folders, ≥ 5 entries, one image item; an active chat with a character for A10.
- Browser: Chromium via `playwright-cli` (see `AGENTS.md`), plus one manual run in the
  owner's normal browser.

Reference: requirements in [spec.md](./spec.md); formats in
[contracts/assistant-protocol.md](./contracts/assistant-protocol.md); states and texts in
[contracts/assistant-ui-contract.md](./contracts/assistant-ui-contract.md).

## Automated

```bash
pnpm run test            # unit (protocol, validate, context, rules, undo), integration (apply + sync engine), contract (llm client, hooks)
pnpm run typecheck && pnpm run lint && pnpm run build
```

## Live scenarios

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| A0 | Availability | Disable Connection Manager, open assistant; re-enable; open settings with no profile chosen | Banner texts per UI contract; composer disabled; rest of workspace works; after choosing a profile the composer enables |
| A1 | Profile independence | Select `openrouter free provider` in assistant settings while the chat uses another profile; send a request | Request goes through the assistant profile; main chat connection unchanged; message footer shows profile + model |
| A2 | Streaming feedback | With a streaming preset: send "Create three entries about everyday life in Aldermeer" with Hearth & Home selected | Prose streams live with a growing char counter; proposals appear as blocks complete; first visible feedback within ~3 s of the provider's first token |
| A3 | Non-streaming feedback | Turn streaming off in the profile's preset; repeat | Waiting status with elapsed seconds; full reply at once |
| A4 | Create + accept subset (US1) | From A2, accept two, deny one | Only two entries created in Hearth & Home, persisted after reload, present in the root's native book after sync |
| A5 | Edit + diff + edit-before-accept | "Rewrite Bristlemark's harbor paragraph and add a city-law section"; open diff; edit the proposed content; accept | Per-field diff shown; the user-edited version is applied |
| A6 | Reorganize + delete confirmation (US2) | "Create a Taverns folder under Hearth & Home, move Bristlemark Taverns into it, delete the duplicate tavern entry" → Accept all | Folder created before the move; the deletion stays pending with its own confirmation listing affected items and books; after confirming, tree and native books match |
| A7 | Rate limit (US4) | Select `openrouter small gemma free`, send while rate-limited | "Rate-limiting" failure card, countdown auto-retry (max 2), Stop cancels, request text kept, tree unchanged |
| A8 | Stop | Send a long request, Stop mid-stream | Ends promptly; completed blocks usable; no changes applied |
| A9 | Truncation | Set response length to 150; request 5 entries | "Cut off" notice; complete blocks usable; Continue produces the rest |
| A10 | Recommendations (US6) | Enable chat (last 10) + activated entries; Discuss: "Which entries matter for this conversation?" | Prose with clickable references to existing entries; no proposals; clicking opens the item |
| A11 | Stale proposal | Get an edit proposal; manually edit that entry; Accept | Card turns stale with refreshed diff; needs a new Accept |
| A12 | Blocked dependency | Batch with folder creation + creations inside; deny the folder | Dependents show "blocked" with reason; Accept disabled |
| A13 | Destructive edit threshold | Ask to shorten an entry to one sentence (> 50 % removed) / remove a keyword | Proposal marked destructive; excluded from Accept all; own confirmation |
| A14 | Undo (FR-015) | Apply a batch of 4; edit one of the created entries; Undo batch | 3 reverted, 1 skipped with reason; toast summary; native books follow |
| A15 | Persistence (US5) | Two conversations with applied/denied proposals; reload app; switch | Both restored with decisions; pending proposals still decidable (staleness applies); "more ideas" does not repeat denied ones |
| A16 | Structure, location and keys | Select an entry in a folder of a 300-entry workspace; Current folder + "Selected and mentioned entries"; ask about an item named by another entry's key; then Whole workspace + "All entries", context limit 8000 | First request lists only that folder's structure, names the selected entry and current folder, and sends contents of the selected + key-triggered entries (notice: "N with contents (M by keys)"); new items land in the current folder; second request stays within the limit and lists omitted parts |
| A17 | Invalid operations | Use the parser fixtures via a fake profile OR ask the model to "delete item x99" | Invalid proposal with reason, not acceptable; valid ones remain; "Ask to fix" offered when none valid |
| A18 | Linked markdown folder | With a linked folder, accept an assistant edit | File updated through the Phase 3 auto-push (held-back rules unchanged) |
| A19 | Parallel chat | Start a chat generation, then an assistant request (and vice versa) | Both complete; neither cancels the other; stopping one does not stop the other |
| A20 | Interop events | Listen to `wi-workspace:assistant-applied` / `-undone` in the console during A4/A14 | Payloads match `contracts/hooks.md` |
| A21 | Text Completion (best-effort) | Select any Text Completion profile if available | Warning shown; request attempted; no acceptance requirement |

## Success criteria mapping

SC-001 → A2+A4 timing on the router profile · SC-002 → A4–A6, A11–A13 (≥ 20 proposals
across all op types) · SC-003 → A6, A13 · SC-004 → A7–A9, A17 · SC-005 → 10 typical
requests across both profiles (log valid-proposal rate) · SC-006 → A15 · SC-007 → A19 +
typing during A2 · SC-008 → A16 · SC-009 → owner session.

## Validation runs

### 2026-09-15 — automated live run (headless Chromium, `dev` account, build 0.4.0)

| # | Result | Notes |
|---|--------|-------|
| A0 | PASS | No profile → "Choose a connection profile" banner, composer disabled |
| A1 | PASS | Router profile selected in AI settings; streaming badge read from the preset; main chat profile unchanged (`selectedProfile` identical before/after); settings persisted |
| A2 | PASS | First chunk after ~2 s; two valid `create_entry` proposals placed in Sandbox (handle `f9`) |
| A4 | PASS | Accept one / deny one → only the accepted entry created |
| A7 | PASS | Gemma free → 429 classified as rate limit, visible countdown (10 s, then 30 s), provider detail "Got response status 429", Cancel stops retries, request text kept, Retry offered |
| A9 | INCONCLUSIVE | Response length 150 was not enforced by the routed free model (full five-entry reply in 86 s); truncation handling is covered by unit/integration tests |
| A14 | PASS | Undo batch removed the created entry; proposal marked reverted; Sandbox back to its original 32 items |
| A15 | PASS | Conversation, proposals and decisions restored after a page reload (IndexedDB) |
| A3, A5, A6, A8, A10–A13, A16–A21 | NOT RUN | Left for the owner walkthrough |

Defects found and fixed in this run (regression tests in `tests/unit/assistant-display.test.ts`):

- The reply bubble showed raw `<op>` blocks instead of the prose.
- Reasoning models streamed ~23 s of thinking while the counter showed "Receiving… 0 chars";
  the status now reads "Thinking… N chars" until the answer starts. The waiting timer now
  ticks every second on its own.

Observation: with nothing selected in the tree the scope falls back to the whole workspace
(spec FR-021 default), so the context notice can list every entry of the workspace.
