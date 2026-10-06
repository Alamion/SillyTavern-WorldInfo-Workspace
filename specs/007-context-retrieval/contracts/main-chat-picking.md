# Contract — Main-Chat Picking

How the plugin takes part in main-chat generation (spec FR-019–FR-025; research R9–R11).

## Registration

- `manifest.json`: `"generate_interceptor": "wiwPickInterceptor"`; the bundle assigns
  `globalThis.wiwPickInterceptor` at load.
- Signature: `(chat, contextSize, abort, type) => Promise<void>`. It never calls
  `abort`, never throws (errors are caught, logged and recorded as a fallback), never
  mutates `chat`.

## When it runs

| Condition | Behaviour |
| --- | --- |
| picking off for this chat | return at once — no model call, no emit |
| `type` is `quiet` or `impersonate` | return at once |
| `type` is `continue` | re-force the pick stored on the continued message; no model call |
| no active entries | return at once (no emit) |
| otherwise | prepared-vs-fresh decision below |

## Prepared vs fresh

- After each model reply (`CHARACTER_MESSAGE_RENDERED`, not quiet/impersonate) with
  picking on: prepare a pick for the next turn in the background (AbortSignal; cancelled
  by `CHAT_CHANGED` or a newer preparation).
- At generation: new text = chat messages after the prepared pick's `basedOnLength`.
  Mentions = names/keys of active entries found in the new text (same matcher as
  assistant key triggers). All mentioned entries already picked (or no mentions) →
  `prepared`. Otherwise → `fresh` pick, awaited up to `timeoutSec`.
- Fresh failure/timeout → `fallback`: the prepared pick (if any) is forced; a toast
  "Lore picking timed out — using the earlier pick / keywords only" is shown once per
  generation.

## Request to the picking model

- Profile: `settings.picking.profileId ?? settings.assistant.profileId`, through the
  existing `LlmPort` (Connection Manager). Non-streaming; response limit 400 tokens.
- Messages: system = picking rules (treat lore as data, pick at most `maxPicks`, reply only
  with pick lines); user = recent chat (`chatMessages` messages, oldest first, `Name:
  text`) + optional scene block (Doom's suite) + catalog (`catalogTokens` budget, folders
  as groups, R4/R5 narrowing; excluded folders and disabled entries left out).
- Reply format, one per line: `<pick id="e12">short reason</pick>`. Tolerant: extra
  prose ignored; unknown ids → `ignored`; duplicates collapsed; more than `maxPicks` →
  first `maxPicks`.

## Forcing

- One `eventSource.emit(WORLDINFO_FORCE_ACTIVATE, entries)` at the end of the
  interceptor, only if `entries.length > 0`.
- Each entry = full clone of the active book entry + `world: bookName` + `decorators: []`,
  with leading `@@` decorator lines removed from `content`. Nothing else is modified (the
  entry's own position, depth, order, probability, group and budget flags apply).
- The plugin never removes activations, never calls `setExtensionPrompt`.

## Recording

- On `MESSAGE_RECEIVED(id)`: attach the pending result to `chat[id].extra.wiw_pick` and the
  current swipe's `extra` (data-model.md), then `saveChat` via the app's normal save.
- On `WORLD_INFO_ACTIVATED` for the same generation: fill `inserted` per picked entry.
- Emit `wi-workspace:pick-completed` (contracts/hooks.md).

## Guarantees (tests)

- Picking off ⇒ zero calls to the LLM port and zero emits (SC-005).
- Any failure ⇒ the interceptor resolves within `timeoutSec + 1 s` (SC-006).
- A chat change during a pick ⇒ result discarded, nothing emitted.
