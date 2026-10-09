# Data Model: AI Images and Feature Availability

## Persisted (namespace `extensionSettings['WorldInfoWorkspace']`, schema v1, additive)

### ImageNode (existing) — new optional field

| Field | Type | Rule |
|---|---|---|
| `prompt` | `string?` | The prompt of the picture. Written as typed in the image editor (and by Write prompt) and on Keep of a generated picture; absent or `''` = none. Content for the stale-tab hash. Never pushed to books (images are workspace-only). |

### `settings.images?: ImageSettings` (new)

| Field | Type | Default | Repair |
|---|---|---|---|
| `captionProfileId` | `string \| null` | `null` (none) | non-string → default; unknown id kept (shown as missing → feature unavailable) |
| `captionModel` | `string` | `''` (profile's model) | trimmed string |
| `captionInstruction` | `string` | "Describe this picture in one or two sentences for a lore library: what it shows, notable details, mood. No preamble." | empty → default |
| `promptProfileId` | `string \| null` | `null` (= the assistant's profile) | as above |
| `promptModel` | `string` | `''` | trimmed string |
| `promptInstruction` | `string` | R4 default | empty → default |
| `promptContextTokens` | `number` | 2000 | integer 200–16000, else default |

Repaired by `getImageSettings(settings)` (`core/images/settings.ts`). Not saved while a data
recovery is pending (same rule as `settings.assistant`).

## Session only (never saved)

### GenerationCandidate

`{ imageId, prompt, tempUrl, startedAt }` — one per image item at most; a new generation
replaces (and deletes) the previous candidate. Removed on Keep, Discard, item deletion.

### GenerationRun

`{ imageId, prompt, state: 'running' | 'failed', error?, abort() }` — running request per
image item; survives leaving the editor (the editor re-attaches when the item is opened).

### CaptionProposal

`{ imageId, text, state: 'pending' | 'ready' | 'failed', failure? }` — from a single
"Write caption" or a bulk run.

### BulkCaptionRun

`{ folderId, items: CaptionProposal[], index, state: 'running' | 'stopped' | 'done',
retry? }` — one at a time; the review list is its view.

### PromptDraft

`{ imageId, text, basis: { id, name }[] }` — delivered into the prompt field.

### Availability

`Record<FeatureId, { ok: true } | { ok: false; reason: string; fix: string; reload?: boolean }>`

`FeatureId = 'assistant' | 'picking' | 'image-prompt' | 'image-caption' | 'image-generate'
| 'md-folders'` — Memory Books, DES and DeepLore are not listed: their controls only
appear while the extension is present (implementation decision, so none can fail
silently).

Facts → states table (core/availability.ts, unit-tested):

| Feature | Unavailable when | Fix text (summary) |
|---|---|---|
| assistant, picking | CM disabled / absent; no profiles; chosen profile missing | Enable Connection Manager (reload) / create a profile / choose a profile |
| image-prompt | as above for the prompt profile (or the assistant's when unset) | same |
| image-caption | CM disabled; no caption profile chosen; profile missing or text completion | choose a chat-completion profile with a vision model |
| image-generate | `stable-diffusion` disabled (reload) or `imagine` missing; no source selected | enable Image Generation / choose a source in its settings |
| md-folders | insecure page; no folder picker; inside a frame; picker raised `SecurityError` this session | open SillyTavern directly in desktop Chrome/Edge over HTTPS or localhost |

## Markdown (folder record `.wiw-folder.yaml`)

`wi_images.<file>.wi_prompt: string` — only when non-empty; read back into `ImageNode.prompt`.
