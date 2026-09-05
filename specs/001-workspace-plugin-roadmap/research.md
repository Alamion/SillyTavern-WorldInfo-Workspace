# Research — Integrated Lore Workspace (001-workspace-plugin-roadmap)

All findings verified against vendored app sources: `context/SillyTavern/public/scripts/`
(world-info.js 6289 lines, st-context.js, events.js, constants.js, char-data.js, script.js)
and `context/SillyTavern/src/endpoints/worldinfo.js`.

## R1. Native World Info entry format (resolves "WI spec not provided — derive from sources")

**Decision**: Workspace cards map 1:1 onto the native entry schema from
`newWorldInfoEntryDefinition` (world-info.js:4002–4045) / `newWorldInfoEntryTemplate`
(world-info.js:4047). Entries are created as `{ uid, ...structuredClone(template) }` and
stored in `book.entries[uid]`; `uid` is a free integer 0..999,999.

**Rationale**: Exact schema parity is the only way FR-005/FR-010 (full field parity,
lossless flatten-to-native) can hold; the workspace stores native fields verbatim plus its
own organizational metadata.

**Alternatives considered**: an abstract "simplified card" model with lossy mapping —
rejected: the user explicitly wants all fields preserved and no silent resets (pain #2).

Field inventory (types/defaults verbatim from source):

- Identity/content: `key: string[] = []`, `keysecondary: string[] = []`,
  `comment: string = ''`, `content: string = ''`
- Activation/logic: `constant=false`, `vectorized=false`, `selective=true`,
  `selectiveLogic=0` (enum `AND_ANY:0, NOT_ALL:1, NOT_ANY:2, AND_ALL:3`),
  `probability=100`, `useProbability=true`, `disable=false`
- Insertion: `order=100`, `position=0` (`before:0, after:1, ANTop:2, ANBottom:3,
  atDepth:4, EMTop:5, EMBottom:6, outlet:7`), `depth=4` (DEFAULT_DEPTH), `role=0`
  (`SYSTEM:0, USER:1, ASSISTANT:2`), `outletName=''`, `ignoreBudget=false`
- Recursion: `excludeRecursion=false`, `preventRecursion=false`, `delayUntilRecursion=0`
- Scan sources (all `false`): `matchPersonaDescription`, `matchCharacterDescription`,
  `matchCharacterPersonality`, `matchCharacterDepthPrompt`, `matchScenario`,
  `matchCreatorNotes`
- Inclusion groups: `group=''`, `groupOverride=false`, `groupWeight=100`
- Scan overrides (nullable → inherit global): `scanDepth=null`, `caseSensitive=null`,
  `matchWholeWords=null`, `useGroupScoring=null`
- Timed effects: `sticky=null`, `cooldown=null`, `delay=null`
- Automation: `automationId=''`, `triggers=[]` filtered to `GENERATION_TYPE_TRIGGERS`
  (`normal, continue, impersonate, swipe, regenerate, quiet`; constants.js:36)
- Character filters (excludeFromTemplate, present only when used):
  `characterFilterNames=[]`, `characterFilterTags=[]`, `characterFilterExclude=false`
- Runtime/UI: `uid` (int identity), `displayIndex` (render order;
  `entry.displayIndex ?? entry.uid`), `extensions` (passthrough object)

## R2. Native lorebook (book-level) format

**Decision**: A native book is `{ entries: { "<uid>": {…entry} } }` with optional
`name: string` and `extensions: object` (arbitrary per-book metadata, read back by
`/api/worldinfo/list`). The server rejects saves/imports lacking `entries`.

**Rationale**: `src/endpoints/worldinfo.js` enforces `data.entries` on `/edit` and
`/import`; `/list` reads only `name`/`extensions` beyond the file id.

**Alternatives considered**: none — format is fixed by the app server.

Notes:
- Scan settings (depth, budget, recursion, case sensitivity, whole words, group scoring)
  are **global app settings**, NOT per-book; only per-entry overrides exist.
- Active books for generation are tracked globally via `selected_world_info: string[]`.
- v2 character-card embedded book (`v2WorldInfoBook`, char-data.js:45): `{ name, entries }`
  with a parallel field layout inside `extensions` — `convertCharacterBook` (exposed in
  `getContext()`) converts it to the native runtime format. Relevant for md import of
  character-embedded lore and for full-fidelity round-trips.

## R3. Persistence and save mechanics

**Decision**: Workspace uses the app's own WI save pipeline, never raw fetches:
`loadWorldInfo(name)`, `saveWorldInfo(name, data, immediately=false)` (third arg is
`immediately`, NOT allowDuplicate), `createNewWorldInfo` (sanitizes via
`POST /api/files/sanitize-filename`, collides → `"Name (N)"` via `getFreeWorldName`),
`deleteWorldInfo`, `updateWorldInfoList()`.

**Rationale**: `saveWorldInfo` updates `worldInfoCache` synchronously and posts to
`/api/worldinfo/edit` (atomic write, pretty JSON, `sanitize(<name>.json)` under
`data/<user-handle>/worlds/`), then emits `WORLDINFO_UPDATED (name, data)`. Debounced
variant is 1000 ms. Calling the app API keeps cache consistency and editor refresh free.

**Caveats to honor** (from source):
- Callers MUST NOT mutate the object passed to `saveWorldInfo` afterwards (cache is not
  deep-cloned on set). → workspace must hand over a structured clone.
- `loadWorldInfo` returns clones (`StructuredCloneMap, cloneOnGet: true`) — safe to edit.

**Alternatives considered**: writing book files via a custom server endpoint — rejected:
plugin is UI-only (no server plugin needed) and app API covers everything.

Workspace's own organizational data (tree, folders, notes, assistant history) persists in
`extensionSettings['WorldInfoWorkspace']` via `saveSettingsDebounced()`; per-book workspace
metadata (root designation, workspace id) rides in the book's native `extensions` object,
which survives app round-trips (see R2). Per-chat data (if needed later) uses
`chatMetadata` + `saveMetadataDebounced()`.

## R4. App API surface the plugin will use (constitution Principle II)

**Decision**: everything via `globalThis.SillyTavern.getContext()`; the typed surface is
derived from `context/SillyTavern/public/scripts/st-context.js`.

Relevant members:
- WI: `loadWorldInfo`, `saveWorldInfo`, `reloadWorldInfoEditor`, `updateWorldInfoList`,
  `convertCharacterBook`, `getWorldInfoPrompt`, `getWorldInfoNames`
- Events/state: `eventSource`, `eventTypes`, `chat`, `chatMetadata`, `saveMetadataDebounced`,
  `saveSettingsDebounced`, `extensionSettings`, `chatId`/`getCurrentChatId`, `characterId`,
  `groupId`, `maxContext`, `name1`/`name2`, `mainApi`
- LLM: `generateQuietPrompt({ quietPrompt, quietToLoud, skipWIAN, ..., jsonSchema, ... })`
  (script.js:3025, supports `jsonSchema` for structured output), `generateRaw`,
  `sendGenerationRequest`/`sendStreamingRequest`, `ConnectionManagerRequestService.sendRequest(
  profileId, prompt, maxTokens, custom, overridePayload)` (connection profiles; throws if
  connection-manager extension disabled), `getChatCompletionModel`, `getTextGenServer`
- Commands/macros: `SlashCommandParser`, `SlashCommand`, `SlashCommandArgument`,
  `SlashCommandNamedArgument`, `SlashCommandEnumValue`, `ARGUMENT_TYPE`,
  `macros.registry.registerMacro(key, { handler, description })`
- UI/util: `Popup`/`callGenericPopup`/`POPUP_TYPE`/`POPUP_RESULT`, `renderExtensionTemplateAsync`,
  `writeExtensionField`/`writeExtensionFieldBulk`, `tokenizers`/`getTokenCountAsync`,
  `uuidv4`, `t`/`translate`/`getCurrentLocale`

**Alternatives considered**: direct imports from app script modules — rejected: fragile
against bundling and against constitution (app API first; DOM probing last resort).

## R5. Events to subscribe/emit (integration + interop hooks, FR-024)

**Decision**:
- Subscribe: `APP_READY` (init), `SETTINGS_LOADED`/`EXTENSION_SETTINGS_LOADED` (settings),
  `CHAT_CHANGED` (re-scope UI state), `WORLDINFO_UPDATED` (detect external/native-side
  edits for divergence warnings in FR-012), `GENERATION_STARTED` (flush pending saves).
- Emit (plugin-owned, namespaced `wi-workspace:*` via `eventSource.emit`):
  `wi-workspace:structure_changed`, `wi-workspace:entry_updated`, `wi-workspace:synced`,
  `wi-workspace:assistant_action` — payload-typed, additive only (constitution VII).

**Rationale**: `event_types.WORLDINFO_UPDATED` fires on every save with `(name, data)` —
the natural divergence detector; generation lifecycle events protect against save races.

## R6. AI assistant invocation model

**Decision**: assistant calls go through `generateQuietPrompt` with `jsonSchema`
(structured output) for operations, and/or `ConnectionManagerRequestService` when the user
picks a dedicated connection profile (mirrors the reference Recommender's connection-profile
approach). Recommend-current-lore feature uses `getWorldInfoPrompt` context + recent chat
messages as input.

**Rationale**: no separate credentials (FR-017); `jsonSchema` addresses the reference
plugin's "Invalid XML" fragility; profile-based calls let power users choose cheap models
for management tasks.

**Alternatives considered**: direct fetches to AI APIs — rejected (FR-017, security).

## R7. Markdown conversion conventions

**Decision**: define a documented md convention:
- Directory tree mirrors workspace tree; folders may carry a small metadata file.
- Each card = one `.md` file with YAML frontmatter carrying mapped native fields
  (keys, keysecondary, comment→title, order, position, constant, probability, etc.);
  body = `content`.
- Notes = `.md` files without WI frontmatter (or with `type: note`), preserved verbatim.
- Unmappable frontmatter keys land in the card's `extensions` passthrough (never dropped).

**Rationale**: YAML frontmatter is the de-facto standard for md metadata (Obsidian etc.);
native `extensions` object is an officially tolerated passthrough (R2), giving lossless
round-trip without server changes (FR-021/FR-022).

**Alternatives considered**: headings-only convention — rejected: too lossy for 40+ fields;
per-file JSON sidecars — rejected: breaks the "human-readable md lore repo" goal.

## R8. Prototype approach (FR-023, Phase 0)

**Decision**: prototype = the real extension shell (bundle loads in ST) rendering the
planned layout against mocked in-memory data; visually styled with app theme variables.
Cheap to iterate, discardable, but its shell/config code is reusable.

**Rationale**: satisfies "discardable if visuals rejected" while avoiding a second,
throwaway tech path; mocked data keeps Phase 0 free of persistence work.

## R9. Testing strategy alignment

**Decision**: Vitest for unit tests (pure logic: tree ops, flatten/export, md converter,
divergence detection, assistant operation planning); integration tests against
`getContext()` surfaces per constitution VI. Typecheck `tsc --noEmit`, ESLint 9 flat
config, Prettier, pnpm scripts (constitution III/IV).

**Rationale**: matches constitution gates and the 3DDiceRolls baseline (165 Vitest tests
pattern).

## Open items

None — all NEEDS CLARIFICATION from Technical Context resolved (R1–R9). FR-012 answered by
user: option A (workspace authoritative; explicit import back; divergence warnings).
