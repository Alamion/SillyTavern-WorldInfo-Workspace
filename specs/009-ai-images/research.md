# Research: AI Images and Feature Availability

Decisions for spec 009. Facts were checked against the vendored app source
(`context/SillyTavern/`), the running server and live calls on `dev` (2026-10-09, profile
"openrouter almost free" with a spend-limited key).

## R1 — How a picture is generated

- **Decision**: call the Image Generation extension's own `imagine` command object
  directly: `getContext().SlashCommandParser.commands['imagine'].callback(args, prompt)`
  with `args = { quiet: 'true', gallery: 'false', extend: 'false', multimodal: 'false',
  _abortController }`. The return value is the stored file's URL, or `''` on failure.
- **Why each argument**:
  - `quiet=true` — no chat message (FR-006); verified live: the chat did not change.
  - `gallery=false` — the file goes to the root of `user/images/` instead of the current
    character's gallery folder, so the location is predictable and does not depend on
    which character is open.
  - `extend=false`, `multimodal=false` — the extension's "extend free prompts with the
    main model" and avatar-captioning modes are turned off for this call only; the
    extension restores its settings after the call (`applyCommandArguments`).
- **Why the callback, not `executeSlashCommandsWithOptions`**: no parsing of the prompt —
  `|`, `{{…}}`, `{:` and `/` in a prompt cannot break or inject commands. The command
  object is part of the public `getContext()` surface (`SlashCommandParser`), so this stays
  within constitution II.
- **Special words**: the extension switches modes when the WHOLE prompt equals a trigger
  word ("you", "face", "background", …, compared case-insensitively after trim). A prompt
  that equals a trigger word gets a trailing period, which makes it an ordinary FREE
  prompt. Tested by unit test on the sanitizer.
- **What applies from the user's settings**: source, model, size, style, prompt prefix and
  negative prompt (FR-002). Observed: `gemini-3.1-flash-lite-image` ignored the 512×512
  setting and returned 1024×1024 — sizes are the source's business.
- **Failure**: the extension shows its own error toast and returns `''`. The workspace
  shows "Image Generation did not return a picture — see its notification" in the editor
  (FR-007); the item is unchanged.
- **Chat switch during generation**: the extension discards the result ("Chat changed,
  generated image discarded"). Reported the same way.
- **Stop**: the extension listens for `abort` on `args._abortController` and shows its own
  loader with a Stop button; the workspace passes an `EventTarget` and dispatches `abort`
  on Stop.
- **Measured**: 4.1 s for one picture via OpenRouter `gemini-3.1-flash-lite-image`.

## R2 — Where generated pictures live

- **Decision**: the candidate stays as the extension's file in `user/images/` (shown
  directly). **Keep**: fetch its bytes → `imageStore.upload` (our
  `user/images/WorldInfoWorkspace/`, stem from the item name) → commit `src` and `prompt`
  → delete the temporary file. **Discard**, a newer candidate, or deleting the item:
  delete the temporary file. Deleting uses `/api/images/delete`, which accepts any path
  under the user's image folder.
- **Rationale**: nothing enters our storage before Keep (SC-002); kept pictures are owned
  files, so the existing owned-file cleanup (spec 004) and markdown export handle them.
- **Residual**: a page reload while a candidate is pending leaves the temporary file in
  `user/images/` (visible in the app's gallery). Accepted; noted in the README.

## R3 — Captions through a connection profile

- **Decision**: `LlmMessage` gains an optional `images?: string[]` (data URLs). The LLM
  client turns such a message into OpenAI-style content parts
  `[{type:'text'}, {type:'image_url', image_url:{url}}]` for chat-completion profiles.
  Text-completion profiles are not offered for captions.
- **Verified live**: content parts pass through `ConnectionManagerRequestService
  .sendRequest` to OpenRouter unchanged; `google/gemma-3-12b-it` captioned a JPEG in 1.7 s.
  The free router `openrouter/free` also accepts images but in 2 of 3 trials was routed to
  a safety classifier ("User Safety: safe").
- **Model override**: a profile binds a connection (and key) to one model; the owner's
  "almost free" profile has `openrouter/free`. Image settings therefore allow an optional
  model per task, sent as `sendRequest(..., overridePayload: { model })` (verified live).
  Empty = the profile's model.
- **Picture preparation**: fetch the item's picture (same-origin stored files and `data:`
  URIs; external URLs only when the site allows it), decode, scale to at most 1024 px on
  the long side, encode as JPEG (quality 0.85) through a canvas. SVG `data:` URIs are
  rasterized the same way (the browser draws them into the canvas) — better than the
  spec's "not captionable" default; unreachable or tainted links are reported as not
  captionable.
- **"Model cannot read images"** (FR-016): an empty reply, an HTTP 400/404 mentioning
  image/vision/modality, or a reply that refers to a missing image ("I can't see") →
  failure kind `no-vision` with the suggestion to pick a vision-capable model.
- **Alternative rejected**: the Captioning extension's `getMultimodalCaption` (owner
  decision; also not on `getContext()`).

## R4 — Drafting the prompt

- **Decision**: one non-streamed request through the chosen profile (default: the
  assistant's profile). Messages: a system instruction (editable in image settings) +
  a user message with the image's name, caption, the user's idea (prompt field text), and
  the entries of the image's folder: direct child entries first, then entries of
  subfolders, then — if the folder has none — the parent folder's entries; each entry as
  name, summary (if any) and content cut at a sentence boundary (`core/assistant/truncate`),
  within ~2000 tokens (3.5 chars/token). Disabled entries are skipped.
- **Reply handling**: strip code fences, surrounding quotes and a leading "Prompt:"; keep
  one paragraph. The basis list (FR-010) is the entries actually included.
- **Default instruction**: "Write one image-generation prompt (comma-separated visual
  description, under 80 words) for a picture of the subject, using concrete visual details
  from the lore. No names the model cannot draw, no story, no quotes."

## R5 — Bulk captions

- **Decision**: images under the folder (any depth) with a picture and an empty caption;
  confirmation popup with the count, profile and model; sequential requests; progress and
  Stop in a review panel (MenuPanel) that fills as replies arrive; rate-limit/network
  failures retry twice (10 s, 30 s) like the assistant (`core/assistant/failures`).
  Review: each row has picture thumbnail, proposed caption (editable), Keep checkbox;
  "Keep selected" applies all checked captions in one store update.
- **Entry points**: the folder editor (an "Images" section) and the tree's folder context
  menu. The action is disabled with "No images without captions" when the count is 0.

## R6 — Availability

- **Decision**: a pure module `core/availability.ts` maps facts → per-feature state
  `{ ok: true } | { ok: false, reason, fix, reload? }`. An adapter collects the facts:
  - `disabledExtensions` contains `connection-manager` / `stable-diffusion`;
  - `ConnectionManagerRequestService` present; profiles exist; the chosen profile id
    still exists and is chat-completion (captions);
  - `SlashCommandParser.commands.imagine` exists; `extensionSettings.sd.source` is set;
  - folder access: secure context, `showDirectoryPicker` present, and the page is not
    inside another page's frame (`window.top !== window.self`) — embedded browsers such as
    VS Code's show the page in a frame, where the picker exists but throws `SecurityError`;
    a `SecurityError` from the picker at runtime also marks it unavailable for the session;
  - Memory Books / DES / DeepLore: the existing probes.
- **What cannot be known up front**: missing keys of an image source or a provider
  outage (the app does not expose secret state on `getContext()`). Those surface as the
  source's own error (spec edge case).
- **Re-check**: on workspace shown, on `SETTINGS_UPDATED`, `EXTENSION_SETTINGS_LOADED`,
  and the connection manager's profile events (already subscribed by the LLM client).
  Enabling or disabling an app extension needs a page reload in SillyTavern; the message
  says so (`reload: true`).
- **UI**: one shared piece in `ui/formControls.tsx` (`useAvailability` + `Gated` wrapper /
  `gatedProps`): the control keeps its normal look plus a small warning badge and
  `aria-disabled`; title = reason; click/tap/Enter opens a popup with reason and fix; the
  original action does not run. Asserted by a style guard test like the form controls.

## R7 — Markdown folders and the README

- Today: the header button is faded with a tooltip and a click popup in browsers without
  `showDirectoryPicker` (Firefox confirmed by the owner), but looks normal in the VS Code
  browser (frame) and possibly on phones. With R6 the frame case is detected up front;
  the phone case is re-checked by the owner (quickstart I12).
- All markdown functions — link, export, import folder, import files — need the browser's
  file pickers; the README's "one-off export and import still work everywhere" is wrong
  and is corrected (FR-022).

## R8 — Contracts touched

- Persistence (spec 003): `settings.images?` (repaired field by field, not saved while a
  recovery is pending, like assistant settings) and `ImageNode.prompt?` (optional
  string). Schema version stays 1; both are additive. Prompt changes are content for the
  stale-tab hash (spec 008) — no projection change needed.
- Markdown convention (spec 004): `wi_images.<file>.wi_prompt` in the folder record, only
  when non-empty.
- Hooks: none new; kept pictures and captions are tree updates (`tree-changed`).
- Assistant protocol: unchanged (images still read-only for the assistant; the prompt is
  not part of the assistant's context in this spec).
