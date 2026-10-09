# Quickstart: AI Images and Feature Availability

Live validation guide. Scenario ids I0–I14 map to the spec's stories and success
criteria; implementation detail belongs in `tasks.md`.

## Prerequisites

- Local instance `http://127.0.0.1:8634`, `dev` account, production build, four gates green.
- Image Generation: source OpenRouter, model `google/gemini-3.1-flash-lite-image`
  (fallback `google/gemini-2.5-flash-image`), key with a spending limit.
- Profile "openrouter almost free"; image settings: captions with model
  `google/gemma-3-12b-it` (fallback `qwen/qwen3.7-flash`), prompt drafting on the same
  profile (model `openrouter/free` or a cheap text model).
- A file listing of `user/images/` and `user/images/WorldInfoWorkspace/` before each
  generation scenario.

## Scenarios

| # | Story | Steps | Expected |
|---|---|---|---|
| I0 | — | Open an existing image item with no settings changed | Editor as before plus Prompt/Generate/Write caption; nothing sent |
| I1 | 1 | New empty image item in Cinderhollow, type a prompt, Generate | Progress, candidate beside "No picture yet"; chat unchanged (SC-001, FR-006) |
| I2 | 1 | Keep | Picture shown; file in `WorldInfoWorkspace/`; no extra file left in `user/images/`; prompt remembered; reload keeps it (SC-003) |
| I3 | 1 | Generate again on the same item, Discard | Item unchanged; no new file anywhere (SC-002) |
| I4 | 1 | Generate, Keep a replacement | Old owned file removed by cleanup |
| I5 | 1 | Prompt exactly "you" | Generates a plain picture, no character portrait mode |
| I6 | 1 | Stop during generation | Nothing kept; editor usable |
| I7 | 2 | Image in a folder with entries, Write prompt | Draft in the field, "Based on: …" lists entries; nothing generated; 4 of 5 drafts use a detail from the listed entries (SC-007) |
| I8 | 3 | Write caption on an uploaded picture | Proposal beside the current caption; Keep stores it; field stays editable |
| I9 | 3 | Caption profile model set to a text-only model | Message: the model likely does not accept images (FR-016) |
| I10 | 4 | Folder with 3 uncaptioned + 1 captioned image: caption all, keep 2 | Confirmation says 3; review; only 2 stored; Stop before the next request when pressed (SC-004) |
| I11 | 5 | Disable Connection Manager and Image Generation, reload | Every control from FR-020 marked; tap and hover explain; nothing fails silently (SC-005) |
| I12 | 5 | Open the workspace in the VS Code browser and on a phone | Markdown control marked with the reason, or works (SC-006); owner checks the phone |
| I13 | 5 | Re-enable both, reload | Marks gone |
| I14 | — | Export the folder to markdown and re-import | Picture, caption and prompt survive (SC-003) |

## Automated coverage

- Unit: availability facts → states; trigger-word sanitizer; prompt-draft request builder
  (entry selection order, budget, basis list) and reply cleanup; caption failure
  classification; image settings repair; markdown `wi_prompt` read/write.
- Integration: generation adapter against a fake `imagine` command and a fake image
  endpoint (keep/discard/replace file lifecycle); LLM client builds image content parts;
  bulk caption run with stop and retries (fake LLM).
- Style guard: gated controls use the shared helper.

## Results

### Live pass — 2026-10-09 (owner's server, `dev`, Image Generation on OpenRouter `google/gemini-3.1-flash-lite-image`, captions and prompt drafts on profile "openrouter almost free" with model `google/gemma-3-12b-it`)

| # | Result |
|---|---|
| I0 | PASS — existing items show the new section; nothing is sent until a button is pressed |
| I1 | PASS — new image item "Cinderhollow cliffs": prompt → Generate (~4 s) → candidate beside "No picture yet"; chat unchanged |
| I2 | PASS — Keep: file in `user/images/WorldInfoWorkspace/`, temporary file deleted (server log), prompt on the item, survives reload |
| I3 | PASS — Discard on "Aldermeer map sketch": temporary file deleted, item unchanged |
| I4 | PASS — a kept replacement: the previous owned file was deleted by the existing cleanup |
| I5 | PASS — prompt "you": the extension logged `mode FREE triggered with "you."`; its prompt prefix was applied |
| I6 | PASS — Stop during generation: no candidate, no file left |
| I7 | PASS — Write prompt (with confirmation over existing text): a draft naming cliffs, lanterns and stone dwellings; "Based on: Bristlemark, Cinderhollow, City naming ideas" |
| I8 | PASS — Write caption: proposal beside the empty caption, Keep stored it |
| I9 | PASS after a fix — a text-only model (`mistralai/mistral-nemo`): the app passes only "Not Found" on (OpenRouter's "No endpoints found that support image input"); a 404 for a caption request is now explained as "The model likely does not accept pictures…" |
| I10 | PASS — Geography folder: confirmation "Send 1 picture to openrouter almost free (google/gemma-3-12b-it)", review list, Keep selected stored it. Stop and retries: automated |
| I11 | PASS — Connection Manager and Image Generation disabled (`/extension-disable`), reload: lore picking button, Send, Write prompt, Write caption and Generate carry the badge and the reason; pressing Generate opened "Not available" with reason, fix and the reload note |
| I12 | Owner (VS Code browser, phone) — frame detection is automated |
| I13 | PASS — both re-enabled, reload: no marks |
| I14 | Automated only (folder record round trip with `wi_prompt`; reconcile compares the record text) |

Fixes from this pass: the image source type now follows a stored file that arrives from
elsewhere (it stayed "Resource URL" after Keep); captions and prompt drafts never stream
(`LlmRequest.stream = false`); a 404 for a caption request is classified as "no image
support". Note for live automation: Playwright refuses to click `aria-disabled` buttons —
click marked controls from inside the page.
