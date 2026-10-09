---
description: "Task list for AI Images and Feature Availability (009-ai-images)"
---

# Tasks: AI Images and Feature Availability

**Input**: Design documents from `/specs/009-ai-images/` (plan.md, spec.md, research.md
R1–R8, data-model.md, contracts/persistence-delta.md, contracts/markdown-delta.md,
contracts/ui-contract.md, quickstart.md I0–I14)

**Tests**: INCLUDED. Constitution V requires test-first for pure core logic, and VI
requires integration tests against `getContext()` surfaces. Every test task precedes its
implementation task and must fail first.

**Organization**: phases run in this order:
1. Setup.
2. Foundational: schema, settings, LLM image parts, availability core and the gated
   control.
3. US1: generate a picture (P1, MVP).
4. US5: availability marking (P2). It is placed before US2–US4 because their buttons are
   gated controls.
5. US2: prompt drafting (P2).
6. US3: single caption (P2).
7. US4: bulk captions (P3).
8. Polish.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US5 (spec.md)
- Paths are project-relative; single-project layout per plan.md

## Key rules for every task

- **Purity**: `src/core/**` is pure (no `getContext()`, no DOM, no fetch).
- **Host access** stays in `src/adapters/**`.
  - Adapters receive host capabilities as injected dependencies, so integration tests can
    drive them with fakes.
  - The `imagine` command is called through `getContext().SlashCommandParser.commands.imagine.callback`
    and never through a parsed slash string (research R1).
- **LLM requests** go only through `adapters/llmClient.ts`.
  - Never `generateRaw` or `generateQuietPrompt`.
  - Never the app's main abort controller.
  - Never credentials.
- **Storage**: nothing enters `user/images/WorldInfoWorkspace/` before Keep (SC-002).
  Temporary files of the Image Generation extension are deleted on Keep, on Discard, on a
  replacement candidate, and when the item is deleted (R2).
- **Settings**: `settings.images` is not saved while a data recovery is pending (same rule
  as `settings.assistant`).
- **UI**:
  - UI strings and icons exactly as in contracts/ui-contract.md.
  - Panels from `ui/formControls.tsx` (MenuPanel, FormSection, FormField, NumberField,
    OptionRow).
  - Shared SCSS only (AGENTS.md "Style system").
- **Documentation** moves with the code (README, AGENTS.md, CHANGELOG, amended contracts).

---

## Phase 1: Setup

**Purpose**: app API typings and test support used by every story

- [X] T001 Extend `src/global.d.ts`:
  - `SlashCommandParser.commands: Record<string, { callback(args: Record<string, unknown>, value: string): Promise<unknown> }>`;
  - the `overridePayload` (5th) parameter of `ConnectionManagerRequestServiceApi.sendRequest`;
  - `extensionSettings.sd?: { source?: string }`;
  - `eventTypes` `SETTINGS_UPDATED` / `EXTENSION_SETTINGS_LOADED` if missing.
- [X] T002 [P] (Done inside `tests/integration/image-generation.test.ts`: the fakes are local to that file.) Add to `tests/support/fakeHost.ts` (or a new `tests/support/fakeImageHost.ts`):
  - a fake `imagine` command that records args, returns a configurable URL or `''`, and
    honours an `abort` event on `args._abortController`;
  - a fake image endpoint map (upload/delete/fetch bytes) listing files under
    `user/images/`.
- [X] T003 [P] (`FakeLlm.requests` already exposes `images` and `model`; no change needed.) Extend `tests/support/fakeLlm.ts` so a run can inspect `images` on messages
  and the model override, and script replies, failures and 429s per call.

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: data, settings, image-capable requests, and the availability core that every
story uses

- [X] T004 [P] Unit tests `tests/unit/images-settings.test.ts`: `getImageSettings` defaults,
  field-by-field repair (non-string ids, model trim, empty instruction → default,
  `promptContextTokens` clamped to 200–16000), invalid object → defaults (data-model.md).
- [X] T005 [P] Unit tests in `tests/unit/state.test.ts` (or new
  `tests/unit/image-prompt-schema.test.ts`): `migrate` keeps a string `ImageNode.prompt`,
  drops a non-string one, and leaves an absent prompt absent; `settings.images` survives
  migrate.
- [X] T006 Add `ImageNode.prompt?: string` and `WorkspaceSettings.images?: ImageSettings`
  with migrate rules in `src/core/state/schema.ts`; create `src/core/images/settings.ts`
  (types, defaults incl. the R4 prompt instruction and the caption instruction text from
  data-model.md, `getImageSettings`). Makes T004/T005 pass.
- [X] T007 Add the "Image settings" line to the conflict summary in
  `src/core/state/staleness.ts` (same mechanism as "Assistant settings") + case in
  `tests/unit/staleness.test.ts`.
- [ ] T008 Keep `settings.images` out of saves while a recovery is pending, exactly like
  `settings.assistant`, in `src/adapters/settingsStore.ts`, and add a settings update
  helper `updateImageSettings(patch)` on services.
- [X] T009 [P] Unit test `tests/unit/llm-client-images.test.ts`: a message with
  `images: [dataUrl]` is sent as `[{type:'text',text}, {type:'image_url',image_url:{url}}]`
  for chat-completion profiles; a model override is passed as
  `overridePayload = { model }`; no images → plain string content (unchanged behaviour).
- [X] T010 Add `LlmMessage.images?: string[]` in `src/core/assistant/types.ts` and
  `LlmRequest.model?: string` in `src/core/assistant/ports.ts`.
  - Implement both in `src/adapters/llmClient.ts`: content parts, and the 5th
    `sendRequest` argument when `model` is non-empty.
  - Make T009 pass; existing assistant tests stay green.
- [X] T011 [P] Unit tests `tests/unit/availability.test.ts`: every row of the data-model
  facts → states table (reason, fix, `reload`), incl.:
  - Connection Manager disabled vs absent;
  - no profiles; chosen profile missing;
  - caption profile is text completion;
  - `stable-diffusion` disabled; `imagine` missing; no `sd.source`;
  - insecure page; no picker; in a frame; picker `SecurityError` this session;
  - prompt profile unset → the assistant's profile is used.
- [X] T012 Create `src/core/availability.ts` (`FeatureId`, `AvailabilityFacts`,
  `computeAvailability(facts)`). Make T011 pass.
- [X] T013 Create `src/adapters/availability.ts`.
  - It collects the facts from `getContext()`:
    - `disabledExtensions`, `ConnectionManagerRequestService`, profiles;
    - assistant, picking and image settings;
    - `SlashCommandParser.commands.imagine`, `sd.source`;
    - `fsaAccess` support, frame detection `window.top !== window.self` (in try/catch);
    - the session `SecurityError` flag;
    - the existing interop probes (`interopSources.ts`).
  - It recomputes on workspace shown, `SETTINGS_UPDATED`, `EXTENSION_SETTINGS_LOADED`, and
    profile changes, plus `subscribe`/`get` for React.
  - Wire it as `services.availability` in `src/adapters/settingsStore.ts`, and trigger a
    re-check from `onWorkspaceShown` in `src/index.ts`.
- [X] T014 [P] Extend `tests/unit/form-controls.test.ts`:
  - `gated()` on an unavailable state renders `aria-disabled`, the warning badge and the
    reason title;
  - click, Enter and Space open the explanation and do NOT call the action;
  - an available state calls the action.
  - Style guard: no inline `opacity` used for unavailability under `src/ui/**`.
- [X] T015 Add `useAvailability(feature)` and `gated(state, onRun)` (plus a
  `<GatedButton>` convenience) to `src/ui/formControls.tsx`.
  - The explanation popup goes through `adapters/popups.ts`.
  - Add `.wiw-unavailable` and the badge styles to `src/styles/wiw-theme.scss`.
  - Make T014 pass.

**Checkpoint**: settings, image-capable LLM requests and the gated control exist; no
visible change yet.

---

## Phase 3: User Story 1 — Generate a picture for an image item (Priority: P1) 🎯 MVP

**Goal**: prompt → Generate → candidate beside the current picture → Keep stores the
picture in our storage with the prompt remembered; Discard leaves nothing behind.

**Independent Test**: quickstart I1–I6 (empty item, keep, discard, replace, prompt
"you", stop).

### Tests for User Story 1

- [X] T016 [P] [US1] Unit tests `tests/unit/images-sanitize.test.ts`.
  - A prompt equal to a trigger word (any case, surrounding spaces) gets a trailing
    period; other prompts are unchanged except trimming.
  - Empty → rejected.
  - Trigger list mirrored from the extension: `you, me, scene, last, raw_last, background,
    face, portrait, character, …`; copy the exact list from
    `context/SillyTavern/public/scripts/extensions/stable-diffusion/index.js` `triggerWords`.
- [X] T017 [P] [US1] Integration tests `tests/integration/image-generation.test.ts` with the
  fake `imagine` command and fake image endpoint:
  - args are `quiet:'true', gallery:'false', extend:'false', multimodal:'false'`;
  - a candidate keeps the temp URL;
  - Keep uploads the bytes into `WorldInfoWorkspace/` with a stem from the item name,
    commits `src` + `prompt`, and deletes the temp file;
  - Discard deletes the temp file and changes nothing;
  - a second generation replaces and deletes the first candidate;
  - deleting the item deletes a pending temp file;
  - `''` result → failure "Image Generation did not return a picture — see its
    notification" and the item is unchanged;
  - Stop dispatches `abort` and leaves no candidate;
  - a kept replacement leaves the old owned file to the existing cleanup.

### Implementation for User Story 1

- [X] T018 [US1] Create `src/core/images/sanitize.ts` (trigger words +
  `sanitizeGenerationPrompt`). Make T016 pass.
- [X] T019 [US1] Create `src/adapters/imageGeneration.ts`
  (`createImageGeneration(deps: { getImagine, imageStore, fetchBytes, deleteImage, store,
  applyImageChange })`).
  - State per image id: run, candidate, error.
  - Operations `generate(imageId, prompt)`, `stop`, `keep`, `discard`, `subscribe`,
    `get(imageId)`.
  - Deletion hook `onNodesDeleted(ids)`.
  - Keep goes through the same commit path as manual image edits
    (`workspaceActions`/store), so tree-changed and stale-tab protection apply.
  - Make T017 pass.
- [X] T020 [US1] (Deleted items are detected through a store subscription inside the adapter — covers folders above the image and loads from other tabs — instead of a call from `deleteNodes`.) Wire `services.imageGeneration` in `src/adapters/settingsStore.ts`, and
  call `onNodesDeleted` from the single delete path in `src/adapters/workspaceActions.ts`.
- [X] T021 [US1] Create `src/ui/images/ImageAiSection.tsx`, part 1:
  - prompt textarea (draft state; shows `image.prompt` when set; editing commits `prompt`
    on blur via `useDraftField`);
  - Generate button gated `image-generate`, disabled when empty;
  - running spinner + Stop;
  - candidate pair (current / candidate, stacked below 560 px) with Keep / Discard /
    Generate again;
  - inline failure line.
  
  Mount it in the image view of `src/ui/ItemEditor.tsx` per contracts/ui-contract.md
  order; styles in `src/styles/wiw-theme.scss`.
- [X] T022 [US1] Add `prompt` to the image commit patch type (`onCommitImage` in
  `src/ui/ItemEditor.tsx` and its handler in `src/ui/WorkspaceApp.tsx`).

**Checkpoint**: US1 works end to end with a configured Image Generation (MVP).

---

## Phase 4: User Story 5 — See up front what is unavailable and why (Priority: P2)

**Goal**: every dependent control is marked before use and explains itself on
click/tap/hover; the markdown control detects frames.

**Independent Test**: quickstart I11–I13.

### Tests for User Story 5

- [X] T023 [P] [US5] Unit test in `tests/unit/markdown-menu.test.ts` (or a new
  `fsa-access.test.ts`):
  - `fsaAccess.isSupported()` is false inside a frame;
  - a `SecurityError` from the picker marks folder access unavailable for the session and
    reports the reason instead of failing silently.

### Implementation for User Story 5

- [X] T024 [US5] `src/adapters/fsaDisk.ts`: frame detection in `isSupported`; `pick`
  records a `SecurityError` in a session flag read by the availability adapter. Make T023
  pass.
- [X] T025 [US5] `src/ui/MarkdownControl.tsx`: replace the opacity look and the custom
  popup with `gated(useAvailability('md-folders'), …)`; keep `UNSUPPORTED_MESSAGE` as the
  fix text source in `src/adapters/mdController.ts`.
- [X] T026 [P] [US5] Assistant: gate Send and "answer last" in
  `src/ui/assistant/Composer.tsx` and show the reason in the empty state of
  `src/ui/AssistantPanel.tsx` (feature `assistant`). The existing failure card for
  `connection-manager-disabled` stays as a fallback.
- [X] T027 [P] [US5] Lore picking: gate the header picking button (`src/ui/WorkspaceApp.tsx`)
  and the enable options in `src/ui/PickingSettings.tsx` (feature `picking`). The settings
  panel still opens, so a profile can be chosen.
- [X] T028 [P] [US5] (Resolved without change: the Memory Books, DES and DeepLore controls only appear while the extension is present, so none can fail silently; they were dropped from `FeatureId`.) Interop: move the Memory Books "Create memory" button
  (`src/ui/WorkspaceApp.tsx` folder extras) and the DES/DeepLore options in
  `src/ui/assistant/ContextMenu.tsx` onto `gated` with their existing probe reasons.

**Checkpoint**: disabling Connection Manager / Image Generation marks every listed
control; nothing fails silently.

---

## Phase 5: User Story 2 — Let a model draft the prompt from the lore (Priority: P2)

**Goal**: "Write prompt" fills the prompt field with a draft based on the image's folder
entries and lists them.

**Independent Test**: quickstart I7.

### Tests for User Story 2

- [ ] T029 [P] [US2] Unit tests `tests/unit/images-draft.test.ts` for
  `buildPromptDraftRequest`:
  - entry selection order: direct entries, then subfolder entries, then the parent's
    entries when the folder has none;
  - disabled entries skipped;
  - summary included;
  - content cut at a sentence boundary within `promptContextTokens` (3.5 chars/token);
  - basis = entries actually included;
  - the user's idea and the image name/caption are in the user message.
  
  Also test `cleanPromptReply`: code fences, quotes and a leading "Prompt:" are stripped;
  only the first paragraph is kept.

### Implementation for User Story 2

- [ ] T030 [US2] Create `src/core/images/draftRequest.ts` (reuse
  `src/core/assistant/truncate.ts`, `src/core/tree/summary.ts`). Make T029 pass.
- [ ] T031 [US2] In `src/adapters/imageCaption.ts`, add `draftPrompt(imageId, idea)`:
  - profile = `promptProfileId` or the assistant's `profileId`, plus model override;
  - non-streamed `llmClient.run`;
  - result `{ text, basis }` or a failure;
  - per-image running state + Stop.
- [ ] T032 [US2] Add to `ImageAiSection.tsx`, part 2:
  - Write prompt button gated `image-prompt`;
  - confirm before replacing non-empty text;
  - "Based on: …" hint;
  - running/Stop and the failure line.

---

## Phase 6: User Story 3 — Caption an image with a vision model (Priority: P2)

**Goal**: "Write caption" proposes a caption beside the current one; Keep/Edit/Discard.

**Independent Test**: quickstart I8–I9.

### Tests for User Story 3

- [ ] T033 [P] [US3] Unit tests `tests/unit/images-caption.test.ts`:
  - `buildCaptionRequest`: instruction + one user message with `images: [dataUrl]`;
  - `classifyCaptionFailure`:
    - empty reply → `no-vision`;
    - HTTP 400/404 text mentioning image/vision/modality → `no-vision`;
    - "I can't see the image"-style replies → `no-vision`;
    - 429/network → retryable;
    - else generic;
  - `cleanCaptionReply`: strips a "Here's a caption:" preamble and quotes.
- [ ] T034 [P] [US3] Integration test `tests/integration/image-captions.test.ts`, part 1,
  with the fake LLM:
  - a single caption request carries the image and the model override;
  - a proposal is returned;
  - a failure is classified;
  - a text-completion caption profile → unavailable.

### Implementation for User Story 3

- [ ] T035 [US3] Create `src/core/images/captionRequest.ts` and
  `src/core/images/failures.ts`. Make T033 pass.
- [ ] T036 [US3] In `src/adapters/imageCaption.ts`:
  - `preparePicture(src)`:
    - fetch same-origin or `data:`;
    - `createImageBitmap`, or an `Image` element for SVG;
    - canvas downscale to ≤ 1024 px long side;
    - JPEG 0.85 data URL;
    - tainted/unreachable → `not-captionable`.
  - `writeCaption(imageId)` with per-image proposal state.
  - Make T034 pass (inject `preparePicture` in tests).
- [ ] T037 [US3] Add to `ImageAiSection.tsx`, part 3:
  - Write caption button next to the Caption field, gated `image-caption`, hidden without
    a picture;
  - proposal block with an editable text, Keep / Discard;
  - failure line with the FR-016 message.
- [ ] T038 [US3] Create `src/ui/images/ImageSettingsPanel.tsx` (MenuPanel).
  - Captions section: chat-completion profiles, model, instruction.
  - Prompt drafting section: profile with "Same as the assistant", model, instruction,
    lore size NumberField.
  - Footer hint.
  - Open it from a gear button in `ImageAiSection.tsx`; it saves through
    `updateImageSettings`.

---

## Phase 7: User Story 4 — Caption all uncaptioned images of a folder (Priority: P3)

**Goal**: one confirmed, sequential, stoppable run with a single review list.

**Independent Test**: quickstart I10.

### Tests for User Story 4

- [ ] T039 [P] [US4] Unit test in `tests/unit/images-caption.test.ts`:
  `selectUncaptioned(folder)` returns images at any depth that have a picture and an empty
  (trimmed) caption, in tree order.
- [ ] T040 [P] [US4] Integration test `tests/integration/image-captions.test.ts`, part 2:
  - a run over 3 images is sequential;
  - Stop before the 2nd request sends nothing more;
  - a 429 retries after the backoff (fake timers), at most twice;
  - failed items appear with their reason;
  - `keepSelected` applies the checked captions in ONE store update and leaves the others
    untouched.

### Implementation for User Story 4

- [ ] T041 [US4] Add `selectUncaptioned` to `src/core/images/captionRequest.ts`; add
  `startBulk(folderId)`, `stopBulk`, `keepSelected(edits)` and the bulk state to
  `src/adapters/imageCaption.ts`, with retries reused from
  `src/core/assistant/failures.ts`. Make T039/T040 pass.
- [ ] T042 [US4] Create `src/ui/images/BulkCaptionPanel.tsx` (MenuPanel "Captions for
  <folder>").
  - Progress, Stop.
  - Rows with thumbnail, name, editable caption or failure, Keep checkbox.
  - Footer Keep selected / Close; confirm when closing with unkept proposals.
  - Mount it in `src/ui/WorkspaceApp.tsx`.
- [ ] T043 [US4] Entry points:
  - folder editor section "Images" (count + button, disabled "No images without
    captions" at 0) via `folderExtras` in `src/ui/WorkspaceApp.tsx`;
  - tree folder context menu item "Caption images without captions…" in
    `src/ui/StructureTree.tsx`.
  
  Both are gated `image-caption`, and both show the confirmation popup "Send N pictures
  to <profile> (<model>) for captions?".

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T044 [P] Markdown prompt (contracts/markdown-delta.md):
  - write and read `wi_images.<file>.wi_prompt` in `src/core/md/convention.ts`, plus the
    image metadata comparison in `src/core/md/reconcile.ts`;
  - tests in `tests/unit/md-convention.test.ts` and `tests/unit/md-reconcile.test.ts`
    (round trip; non-string ignored).
- [ ] T045 [P] Amend `specs/003-core-workspace-mvp/contracts/persistence-schema.md` and
  `specs/004-markdown-folder-sync/contracts/markdown-convention.md` per the deltas; add the
  FR-027 amendment line (captions via a connection profile) to
  `specs/001-workspace-plugin-roadmap/spec.md`.
- [ ] T046 [P] Update `README.md`:
  - "Images" section: generate, write prompt, write caption, caption all; temp-file note
    on reload during a pending candidate.
  - "Optional dependencies" table (FR-022): Connection Manager, Image Generation, browser
    folder access, Memory Books / DES / DeepLore, with what each enables and what happens
    without it.
  - Correct the markdown note: all markdown functions need desktop Chromium on a secure
    page, not embedded frames.
- [ ] T047 [P] Update `AGENTS.md`:
  - increment line for spec 009;
  - structure entries (`core/images/`, `core/availability.ts`, `adapters/availability.ts`,
    `imageGeneration.ts`, `imageCaption.ts`, `ui/images/`);
  - Settings paragraph (`settings.images`, `ImageNode.prompt`);
  - Style system rule: "functions with an optional dependency use `gated()`; never fade
    a control without a reason".
- [ ] T048 [P] Add a `CHANGELOG.md` entry under a new 0.6.0 (unreleased) section, and bump
  the version in `package.json` / `manifest.json` per the release decision at closing.
- [ ] T049 Run all four gates (`pnpm exec tsc --noEmit`, `pnpm run lint`, `pnpm run test`,
  `pnpm run build`) and commit `dist/`.
- [ ] T050 Live pass of quickstart I0–I14 on `dev` (own server, spend-limited key); record
  the results in `specs/009-ai-images/quickstart.md`; fix findings with regression tests.

---

## Dependencies & Execution Order

- **Setup (T001–T003)** → **Foundational (T004–T015)** → stories.
- **US1 (T016–T022)** depends only on Foundational. It is the MVP.
- **US5 (T023–T028)** depends on T012–T015 and is independent of US1.
  - Its gating of the image buttons is done inside US1–US4 through `gated`.
- **US2 (T029–T032)** and **US3 (T033–T038)** depend on Foundational and on T021 (the
  section exists). They are independent of each other except for shared files:
  - T031 and T036 both edit `adapters/imageCaption.ts`, so run them sequentially;
  - T032 and T037 both edit `ImageAiSection.tsx`, so run them sequentially.
- **US4 (T039–T043)** depends on US3 (T035, T036).
- **Polish**: T044–T048 can run in parallel after the stories; T049 → T050 last.

## Parallel Example: Foundational

```text
T004 images-settings tests   | T005 schema prompt tests | T009 llm-client image tests
T011 availability tests      | T014 gated-control tests
```

## Implementation Strategy

1. **MVP**: Setup + Foundational + US1. You can generate and keep pictures with a typed
   prompt. Validate quickstart I1–I6.
2. **Then**:
   - US5 makes missing dependencies visible everywhere (owner rule);
   - US2 and US3 add prompt drafting and captions;
   - US4 adds the bulk pass.
3. Each story ends green on all four gates. Commit per story.

## Notes

- Live spend: on the spend-limited key, one picture with `gemini-3.1-flash-lite-image`
  costs ~$0.002 and one caption with `gemma-3-12b-it` costs < $0.0001. These are estimates
  from the model price list, not measured costs.
- The ST server for live checks is the agent's own background process; the owner's tabs
  are closed during live passes.
