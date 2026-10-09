# Feature Specification: AI Images and Feature Availability

**Feature Branch**: `009-ai-images`

**Created**: 2026-10-09

**Status**: Draft

**Input**: Roadmap Phase 5 (US7, FR-025–FR-027) with the owner's decisions of 2026-10-09,
plus a cross-cutting rule for functions whose dependency is missing. Owner decisions:
generation through the app's own Image Generation extension, using what the user already
configured there; captions written by a vision-capable model through a connection profile
(the assistant's mechanism), not the Captioning extension; the image prompt is typed by the
user or drafted by a model from the lore around the image and edited before use; both
actions live in the image editor, plus "Caption all images without captions" for a folder;
nothing is added to the entry editor or the folder menu for generating images. Any function
that needs a disabled or unconfigured extension or browser capability is marked as
unavailable up front and says what to enable.

## Baseline and Scope

- **Today**: image items hold a picture (file stored in the app's image storage, a link or
  an inline SVG) and a hand-written caption. Nothing generates pictures or captions.
  Functions that need another extension (the assistant and lore picking need Connection
  Manager) fail only after the user tries them; markdown folders look faded in unsupported
  browsers, explain themselves only through a hover hint or a click, and do not detect
  embedded browsers where the folder picker exists but cannot be used. The README claims
  that one-off markdown export and import work in every browser, which is not true.
- **This feature**:
  1. Generate a picture for an image item from a prompt, preview it, and keep it only on
     confirmation.
  2. Draft that prompt with a model from the lore around the image; the user edits it.
  3. Write a caption for an image item with a vision-capable model, previewed before it is
     stored; and caption every uncaptioned image of a folder in one reviewed pass.
  4. A single availability rule for every function with an optional dependency.
- **Dependency audit (2026-10-09)**: no built-in extension is required by the core
  workspace (tree, World Info sync, markdown folders use only the app itself). Optional:
  Connection Manager (assistant, lore picking, prompt drafting, captions), Image Generation
  (generating pictures), the browser's folder access on a secure page (markdown folders),
  and the third-party Memory Books, Doom's Enhancement Suite and DeepLore (already
  detected). Data Bank, Token Counter, Vector Storage and the Captioning extension are not
  used.
- **Out of scope**: an assistant operation that generates images (a protocol change, left
  for later); image generation from the entry editor or the folder menu; choosing the
  picture size, style or model inside the workspace (the Image Generation extension's
  settings apply); editing or inpainting existing pictures; captions through the Captioning
  extension.
- **Delivered contracts touched**: the persistence schema (spec 003) gains optional
  image-generation settings and an optional remembered prompt on image items; the markdown
  convention (spec 004) carries that prompt for image files. Both are additive. Roadmap
  FR-027 is amended: captions use a connection profile chosen in the workspace (no separate
  credentials, as FR-027 requires) instead of the Captioning extension's connection.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Generate a picture for an image item (Priority: P1)

A writer adds an image item to the "Cinderhollow" folder, types "a mining town carved into
a red cliff at dusk, lanterns in the windows", and presses Generate. After a short wait the
new picture appears next to the current one (or an empty frame); the writer keeps it, and
the image item now shows it, saved with the workspace and exported with markdown like any
uploaded picture. Generating again produces another candidate; the writer can discard it
and keep the previous picture.

**Why this priority**: generating pictures for lore is the phase's purpose (FR-025); it is
useful on its own with a typed prompt.

**Independent Test**: with Image Generation enabled and configured, create an empty image
item, type a prompt, generate, keep; reload the page and confirm the picture is still
there and its file is in the workspace's image storage.

**Acceptance Scenarios**:

1. **Given** an image item without a picture and Image Generation configured, **When** the
   user enters a prompt and presses Generate, **Then** a progress state is shown and the
   generated picture is offered as a candidate with Keep and Discard.
2. **Given** a candidate, **When** the user presses Keep, **Then** the image item shows the
   new picture, the prompt is remembered on the item, and the picture is stored in the
   workspace's own image storage.
3. **Given** an image item that already has a picture, **When** a new candidate is
   generated, **Then** the current and the candidate picture are shown side by side, and
   the current picture is replaced only on Keep.
4. **Given** a kept replacement, **When** no image item refers to the old file any more,
   **Then** the old stored file is removed by the existing cleanup.
5. **Given** a candidate, **When** the user presses Discard or leaves the item, **Then**
   nothing changes and no file is left behind in the workspace's storage.
6. **Given** generation fails (no connection, provider error, rejected prompt), **When** it
   ends, **Then** the reason is shown in the editor and the item is unchanged.

---

### User Story 2 - Let a model draft the prompt from the lore (Priority: P2)

The writer does not want to write prompts by hand. In the image editor they press "Write
prompt"; a model reads the image's name and caption and the lore entries next to it
(in the same folder), and drafts a picture prompt. The draft lands in the prompt field,
where the writer edits it before generating.

**Why this priority**: it is the owner's chosen way to make generation practical for
lore-heavy folders; it depends on Story 1 to be useful.

**Independent Test**: in a folder with a few entries, open an image item, press Write
prompt, confirm the prompt field fills with a prompt that mentions details from those
entries and that nothing is generated until the user presses Generate.

**Acceptance Scenarios**:

1. **Given** an image item in a folder with entries, **When** the user presses Write
   prompt, **Then** a draft prompt built from the image's name, caption and the nearby
   entries fills the prompt field, replacing any text only after the user confirms when
   the field was not empty.
2. **Given** the user typed a short idea into the prompt field, **When** they press Write
   prompt, **Then** the idea is used as guidance for the draft.
3. **Given** the drafting model fails or is rate-limited, **When** the request ends,
   **Then** the reason is shown and the prompt field is unchanged.
4. **Given** the user sees which entries were used, **When** the draft arrives, **Then**
   the editor lists the entries the draft was based on.

---

### User Story 3 - Caption an image with a vision model (Priority: P2)

A writer imported a folder of reference pictures without captions. In the image editor
they press "Write caption"; a vision-capable model looks at the picture and proposes a
caption, shown next to the current one; the writer keeps, edits or discards it.

**Why this priority**: captions make images useful to the assistant and to search
(FR-026); it is independent of generation and works for any picture, including uploaded
ones.

**Independent Test**: choose a caption profile with a vision-capable model, open any image
item with a picture, write a caption, keep it, and confirm it is saved and still editable.

**Acceptance Scenarios**:

1. **Given** an image item with a picture and a caption profile chosen, **When** the user
   presses Write caption, **Then** a proposed caption is shown with Keep, Edit and Discard.
2. **Given** a proposed caption and an existing caption, **When** it is shown, **Then** both
   are visible, and the existing one is replaced only on Keep.
3. **Given** the chosen profile's model cannot read images, **When** the request fails or
   returns no description, **Then** the editor says the model likely does not accept
   images and suggests choosing a vision-capable profile.
4. **Given** an image item without a picture, **When** the editor is shown, **Then** Write
   caption is not offered.

---

### User Story 4 - Caption all uncaptioned images of a folder (Priority: P3)

The writer opens a folder and chooses "Caption all images without captions". The workspace
lists the images it will caption (in that folder and its subfolders), asks for
confirmation, then writes captions one after another with visible progress. At the end the
writer reviews the proposals in one list, keeps all, keeps some, or edits single ones.

**Why this priority**: a convenience over Story 3 for imported libraries.

**Independent Test**: in a folder with three uncaptioned images and one captioned image,
run the folder action, confirm only three are captioned, review and keep two, and confirm
the third stays uncaptioned.

**Acceptance Scenarios**:

1. **Given** a folder with uncaptioned images, **When** the user chooses the action,
   **Then** a confirmation shows how many images will be sent and with which profile.
2. **Given** the run is in progress, **When** the user presses Stop, **Then** remaining
   images are skipped and proposals already received stay reviewable.
3. **Given** some requests fail, **When** the run ends, **Then** the review lists them as
   failed with the reason, and the rest can still be kept.
4. **Given** the review, **When** the user keeps proposals, **Then** only those captions are
   stored, as one change that can be undone like other edits.
5. **Given** a folder without uncaptioned images, **When** the menu is shown, **Then** the
   action is shown as having nothing to do.

---

### User Story 5 - See up front what is unavailable and why (Priority: P2)

A user who disabled Connection Manager opens the workspace. The assistant's send button,
lore picking, Write prompt and Write caption are visibly marked as unavailable; hovering
or tapping explains "Needs the Connection Manager extension — enable it in Extensions".
Another user without Image Generation configured sees Generate marked with "Choose an
image source in Image Generation settings". A user in a browser without folder access sees
markdown linking marked as unavailable with the reason, while functions that do work there
stay usable.

**Why this priority**: owner rule for every optional dependency; without it the new image
functions would fail only after the user has typed a prompt.

**Independent Test**: disable Connection Manager and Image Generation, reload, and check
that every dependent control is marked and explains itself on tap (touch) and hover
(mouse); re-enable and confirm the marks disappear without editing anything.

**Acceptance Scenarios**:

1. **Given** a function whose dependency is disabled, missing or unconfigured, **When** the
   control is shown, **Then** it is visibly marked as unavailable before any attempt.
2. **Given** a marked control, **When** the user activates it by click or tap, **Then** a
   message names exactly what to enable or configure, and nothing else happens.
3. **Given** the user enables the dependency, **When** they return to the workspace,
   **Then** the mark is gone without a page reload where the app allows it, otherwise the
   message says that a reload is needed.
4. **Given** a browser where the folder picker exists but cannot be used (an embedded
   browser), **When** linking fails for that reason, **Then** markdown linking is marked as
   unavailable with the reason, instead of failing silently.
5. **Given** a touch device, **When** a marked control is shown, **Then** the reason is
   reachable by tap, not only by hover.

### Edge Cases

- The prompt is exactly one of Image Generation's special words ("you", "background"…),
  which would switch it into a different mode: the workspace sends it as a plain
  description, never as a mode switch.
- Image Generation is enabled but its source needs a key or address that is missing: the
  error from the source is shown as is; the control is not pre-marked for problems that
  cannot be known without trying.
- A generation is slow (some sources take a minute or more): the editor shows progress and
  stays usable; leaving the item keeps the request running and shows the candidate when
  the user comes back, or drops it if the item was deleted.
- Another tab changed the same image item while a candidate was pending (spec 008): Keep
  applies to the current item and goes through the usual stale-tab protection.
- The picture is a link to another site or an inline SVG: captioning sends the picture as
  the model can read it; SVGs and unreachable links are reported as not captionable.
- A very large picture: it is reduced before it is sent for a caption, so the request
  stays within common provider limits.
- Image Generation also keeps its own copy of the picture in its own folder: the workspace
  stores its own copy and removes the extra one where the app allows it.
- The drafting or caption profile is deleted later: the setting falls back to "none" and
  the functions are marked unavailable until a profile is chosen.
- A folder action runs into rate limits: retries follow the assistant's rule (two automatic
  retries, visible and stoppable).
- A workspace with a pending data recovery (spec 003): generation and captions work, and
  their results are saved under the recovery rules like any other edit.

## Requirements *(mandatory)*

### Functional Requirements

**Generation**

- **FR-001**: Users MUST be able to generate a picture for any image item from the image
  editor, by entering a prompt and starting generation; the result is a candidate.
- **FR-002**: Generation MUST use the app's Image Generation extension with the source,
  model, size, style and negative prompt the user configured there; the workspace adds no
  separate generation settings or credentials (roadmap FR-027).
- **FR-003**: A candidate MUST be previewed beside the current picture (or an empty frame)
  and MUST replace it only when the user keeps it; discarding leaves the item and the
  workspace's storage unchanged.
- **FR-004**: A kept picture MUST be stored in the workspace's own image storage, so it
  follows the item, is exported with markdown, and is cleaned up when no item refers to it.
- **FR-005**: The prompt used for a kept picture MUST be remembered on the image item, shown
  in the editor, and travel with markdown export/import.
- **FR-006**: Generation MUST NOT post anything into the current chat or change the chat,
  the character, or the Image Generation settings.
- **FR-007**: Generation failures MUST be shown in the image editor with the reason; the
  item stays unchanged.

**Prompt drafting**

- **FR-008**: The image editor MUST offer "Write prompt": a model drafts a picture prompt
  from the image's name and caption, the user's text in the prompt field (as guidance),
  and the lore entries in the image's folder within a size limit.
- **FR-009**: The draft MUST go into the prompt field for editing; it never starts
  generation by itself, and replacing non-empty prompt text needs confirmation.
- **FR-010**: The editor MUST show which entries the draft was based on.
- **FR-011**: Prompt drafting MUST use a connection profile chosen in the workspace's image
  settings, defaulting to the assistant's profile.

**Captions**

- **FR-012**: The image editor MUST offer "Write caption" for an item with a picture; a
  vision-capable model receives the picture and returns a proposed caption.
- **FR-013**: A proposed caption MUST be shown beside the current caption with Keep, Edit
  and Discard; the stored caption changes only on Keep or a confirmed edit, and stays
  editable afterwards.
- **FR-014**: Captions MUST use a connection profile chosen in the workspace's image
  settings (a vision-capable model), with a caption instruction the user can edit there.
- **FR-015**: Folder menus MUST offer "Caption all images without captions" for the folder
  and its subfolders: a confirmation with the count and profile, sequential requests with
  progress and Stop, then one review list where proposals are kept all, partly or edited;
  kept captions are applied as one undoable change.
- **FR-016**: A failure caused by a model that cannot read images MUST be explained as such
  and suggest a vision-capable profile.

**Availability**

- **FR-017**: Every function whose dependency (an app extension, its configuration, a
  connection profile, or a browser capability) is disabled, missing or unconfigured MUST
  be visibly marked as unavailable before the user tries it.
- **FR-018**: Activating a marked function (click, tap, keyboard) MUST show what exactly to
  enable or configure and where, and do nothing else.
- **FR-019**: Availability MUST be re-checked when the workspace is shown and when the app
  reports a settings or extension change, so marks follow the user's changes.
- **FR-020**: The rule MUST cover at least: the assistant, lore picking, Write prompt and
  Write caption (Connection Manager and a chosen profile), Generate (Image Generation
  enabled with a source chosen), markdown folder linking and folder picking (browser folder
  access on a secure page, including embedded browsers where the picker exists but fails),
  and the existing Memory Books, Doom's Enhancement Suite and DeepLore options.
- **FR-021**: Functions that do not need the missing dependency MUST stay fully usable;
  the core workspace has no required extension.
- **FR-022**: The README MUST list every optional dependency, what it enables, and what
  happens without it, and MUST correct the statement about markdown export and import
  outside supported browsers.

**Records**

- **FR-023**: Accepted generations and captions MUST be ordinary edits: saved with the
  workspace, covered by stale-tab protection, reported through the existing tree-change
  hook, and not pushed to World Info books (images are workspace-only).

### Key Entities

- **Image item** (existing): picture and caption; gains an optional remembered generation
  prompt.
- **Image settings** (new, optional): profile for captions, profile for prompt drafting,
  caption instruction, prompt-drafting instruction.
- **Candidate**: a generated picture or a proposed caption awaiting Keep/Discard; lives
  only in the open session, never saved.
- **Availability**: for each dependent function, whether it can run now and, if not, the
  reason and what to do.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From an empty image item, a user with Image Generation configured gets a kept
  picture in 3 actions (prompt, Generate, Keep) plus the source's own generation time.
- **SC-002**: 100% of discarded candidates leave the image item and the workspace's image
  storage unchanged (verified by file listing).
- **SC-003**: A kept picture survives reload, markdown export and re-import with its
  prompt and caption.
- **SC-004**: A folder of 10 uncaptioned images is captioned and reviewed in one pass; a
  Stop takes effect before the next image is sent.
- **SC-005**: With Connection Manager or Image Generation disabled, 100% of the dependent
  controls listed in FR-020 are marked before use and explain themselves on tap and on
  hover; none fails silently.
- **SC-006**: In an embedded browser where the folder picker cannot be used, markdown
  linking reports why instead of doing nothing.
- **SC-007**: A drafted prompt names at least one detail from the entries it lists as its
  basis in 4 of 5 trials on the Aldermeer demo folders.

## Assumptions

- Image Generation's quiet mode returns the picture without posting it to the chat; the
  workspace copies the result into its own storage.
- Connection profiles can send a picture together with text to vision-capable chat models
  (verified 2026-10-09 with an OpenRouter profile); text completion profiles are not
  supported for captions.
- Picture size, style and model are chosen in Image Generation's own settings; the
  workspace does not override them.
- Captions are written in the language the caption instruction asks for (English by
  default).
- Live testing on `dev` uses a separate spend-limited OpenRouter key: generation
  `google/gemini-3.1-flash-lite-image` (fallback `google/gemini-2.5-flash-image`), captions
  `google/gemma-3-12b-it` (fallback `qwen/qwen3.7-flash`). Free OpenRouter offers no
  picture-generating model; the free router accepts pictures but sometimes routes to a
  safety classifier.
