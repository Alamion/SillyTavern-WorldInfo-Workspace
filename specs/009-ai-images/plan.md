# Implementation Plan: AI Images and Feature Availability

**Branch**: `master` (feature dir `009-ai-images`) | **Date**: 2026-10-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/009-ai-images/spec.md`

## Summary

Image items get three AI actions in the image editor: generate a picture from a prompt,
let a model draft that prompt from the lore around the image, and write a caption with a
vision-capable model. A folder action captions every image without a caption in one
reviewed pass. A single availability rule marks every function whose dependency is
missing before the user tries it.

Technical approach:

- **Generation** through the Image Generation extension's `imagine` command object, called
  directly (no slash parsing). Arguments: `quiet`, `gallery=false`, `extend=false`,
  `multimodal=false`, plus an abort target. The result is a temporary file in
  `user/images/`; on Keep it is copied into our storage and the temporary file is deleted
  (R1, R2).
- **Captions and prompt drafts** through `ConnectionManagerRequestService`.
  - `LlmMessage` gains an optional `images` field (data URLs), which becomes OpenAI-style
    content parts.
  - An optional model override per task is sent as `overridePayload.model`.
  - Pictures are downscaled to a 1024 px JPEG in a canvas (R3, R4).
- **Bulk captions** run sequentially with Stop, assistant-style retries and one review
  list (R5).
- **Availability** is pure facts → states in `core/availability.ts`, with an adapter that
  collects the facts and a shared gated-control helper in `ui/formControls.tsx`. The
  existing dependents are moved onto it: assistant, picking, markdown, Memory Books, DES,
  DeepLore (R6, R7).

## Technical Context

**Language/Version**: TypeScript 5.x, `strict` (constitution III)

**Primary Dependencies**: React 18, Webpack 5, shared SCSS. App APIs via `getContext()`:
- `SlashCommandParser.commands.imagine`;
- `ConnectionManagerRequestService.sendRequest` (with `overridePayload`);
- `extensionSettings` (`disabledExtensions`, `sd.source`, `connectionManager.profiles`);
- `eventSource` / `eventTypes` (`SETTINGS_UPDATED`, `EXTENSION_SETTINGS_LOADED`);
- `getRequestHeaders`, `callGenericPopup`.

Endpoints: `/api/images/upload`, `/api/images/delete`, both already used. Browser: canvas,
`createImageBitmap`, `fetch`. No new runtime dependencies.

**Storage**: additive `settings.images` and `ImageNode.prompt`
(contracts/persistence-delta.md), markdown `wi_prompt` (contracts/markdown-delta.md).
Candidates and runs live only in the session.

**Testing**: Vitest.
- Unit: availability, sanitizer, draft builder and cleanup, caption failure
  classification, settings repair, markdown prompt.
- Integration: generation lifecycle against a fake command and a fake image endpoint; LLM
  client content parts; bulk caption run.
- Style guard.

**Target Platform**: SillyTavern 1.13+ in desktop and mobile browsers.

**Project Type**: Browser extension (single bundle).

**Performance Goals**: no work at all until an action is pressed. The editor stays
responsive during requests. Picture preparation for captions takes < 300 ms for a 4 MP
picture.

**Constraints**:
- Only `getContext()` surfaces and documented endpoints (constitution II).
- Never the main generation abort controller.
- No credentials touched.
- Images stay workspace-only (never pushed to books).
- The recovery no-save rule applies to `settings.images`.

**Scale/Scope**: bulk caption runs of up to a few hundred images, sequential.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Check | Status |
|-----------|-------|--------|
| I. Holistic, modular | Pure modules `core/images/` (settings, sanitize, draftRequest, captionRequest, failures) and `core/availability.ts`; adapters `imageGeneration.ts`, `imageCaption.ts`, `availability.ts`; UI pieces in `ui/images/`; one bundle | ✅ |
| II. App API first | `imagine` via the public `SlashCommandParser` on `getContext()`; LLM via `ConnectionManagerRequestService`; images via the app's own endpoints; no imports from app files (the Captioning extension's internal helper is rejected) | ✅ |
| III. Strict TS | `global.d.ts`: `SlashCommandParser.commands` (minimal callback type), `sendRequest` `overridePayload` parameter, `sd` settings shape (source only) | ✅ |
| IV. Lint & format | Unchanged | ✅ |
| V. Test-first | Availability table, sanitizer, draft builder and failure classification written test-first | ✅ |
| VI. Integration testing | Fake `imagine` command + image endpoint; fake LLM with image parts | ✅ |
| VII. Interop hooks | No new events; kept results are `tree-changed` updates | ✅ |
| VIII. Pattern + speckit | Full speckit path; delivered contracts touched: persistence (delta), markdown convention (delta); assistant protocol untouched | ✅ |
| IX. Language | English UI and artifacts | ✅ |

Post-design re-check (after Phase 1 artifacts): still ✅. Calling a registered command
object's callback is the documented way extensions invoke each other's commands. It is
equivalent to `/imagine`, but the user's text is never parsed as script.

## Project Structure

### Documentation (this feature)

```text
specs/009-ai-images/
├── spec.md
├── plan.md                 # this file
├── research.md             # R1–R8
├── data-model.md
├── quickstart.md           # live scenarios I0–I14
├── contracts/
│   ├── persistence-delta.md
│   ├── markdown-delta.md
│   └── ui-contract.md
├── checklists/requirements.md
└── tasks.md                # /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── core/
│   ├── availability.ts        # NEW: facts → feature states (reason, fix, reload)
│   ├── images/                # NEW
│   │   ├── settings.ts        #   ImageSettings defaults + getImageSettings repair
│   │   ├── sanitize.ts        #   trigger-word guard for generation prompts
│   │   ├── draftRequest.ts    #   prompt-draft messages: entry selection, budget, basis;
│   │   │                      #   reply cleanup
│   │   ├── captionRequest.ts  #   caption messages; bulk target selection
│   │   └── failures.ts        #   no-vision / generation failure classification
│   ├── state/schema.ts        # ImageNode.prompt?, settings.images?; migrate
│   ├── state/staleness.ts     # conflict summary line "Image settings"
│   ├── assistant/types.ts     # LlmMessage.images?
│   └── md/convention.ts       # wi_images.<file>.wi_prompt read/write
├── adapters/
│   ├── availability.ts        # NEW: collects facts, re-checks on events, subscribe
│   ├── imageGeneration.ts     # NEW: imagine call, candidates, keep/discard file lifecycle
│   ├── imageCaption.ts        # NEW: picture preparation (canvas), caption/draft requests,
│   │                          #   bulk run with retries
│   ├── llmClient.ts           # image content parts; model override
│   ├── fsaDisk.ts             # frame detection; SecurityError → unavailable for the session
│   └── settingsStore.ts       # services: availability, images
├── ui/
│   ├── formControls.tsx       # useAvailability + gated()
│   ├── images/                # NEW: ImageAiSection (prompt, generate, candidate,
│   │                          #   caption proposal), ImageSettingsPanel, BulkCaptionPanel
│   ├── ItemEditor.tsx         # mounts ImageAiSection; folder "Images" section
│   ├── StructureTree.tsx      # folder menu item "Caption images without captions…"
│   ├── MarkdownControl.tsx    # gated look instead of opacity
│   ├── WorkspaceApp.tsx       # picking button gated; bulk panel mount
│   └── assistant/*            # Send / empty state gated
└── styles/wiw-theme.scss      # .wiw-unavailable badge, candidate pair, review rows
tests/
├── unit/availability.test.ts, images-*.test.ts, md-convention (prompt)
├── integration/image-generation.test.ts, image-captions.test.ts
└── unit/form-controls.test.ts  # gated style guard
README.md (Images, Optional dependencies, markdown browser note), AGENTS.md, CHANGELOG.md,
specs/003 persistence-schema.md + specs/004 markdown-convention.md (amended),
specs/001 roadmap FR-027 amendment
```

**Structure Decision**: new pure logic goes in `core/images/` and `core/availability.ts`.
Host interaction stays in three new adapters next to the existing ones, and UI pieces go
in `ui/images/`. The existing layout is otherwise unchanged.

## Complexity Tracking

No constitution violations to justify.
