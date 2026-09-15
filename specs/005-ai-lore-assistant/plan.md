# Implementation Plan: AI Lore Assistant (Roadmap Phase 2)

**Branch**: `master` (feature dir `005-ai-lore-assistant`) | **Date**: 2026-09-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/005-ai-lore-assistant/spec.md`

## Summary

Replace the Phase 0 assistant mock with a working in-workspace AI assistant: conversation
turns through a connection profile chosen in the assistant's settings (independent of the
main chat), live streaming feedback when the profile's preset streams, batch proposals of
tree operations (create/edit entries, create folders, rename, move, delete) with per-item
review, diffs, destructive confirmations, staleness/dependency checks and batch undo;
persisted conversations per device; discuss mode and chat-aware lore recommendations.

Technical approach: requests go through `ConnectionManagerRequestService.sendRequest`
behind a pure `LlmPort` (R1, R2). The model answers in prose with embedded **tagged
operation blocks** (R3) — a protocol that streams, needs no provider features (the owner's
free models vary per request and lack strict schema output), and is parsed tolerantly
block by block. A pure `core/assistant` module owns the protocol parser, short per-request
handles (R5), context assembly with a character-based budget (R6), validation and
proposal rules (R4, R8), and undo planning (R9). Adapters own the LLM client, IndexedDB
conversation storage (R10), and application of accepted operations through the existing
tree operations and `workspaceActions` (including the delete flow extracted from
`WorkspaceApp`), so persistence, native World Info sync and markdown link behavior are
identical to manual edits (FR-011). Details: [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 5.x, `strict` (constitution III)

**Primary Dependencies**: React 18, Webpack 5, shared SCSS system (mock styles move from
`src/styles/prototype.scss` into `wiw-theme.scss`); app APIs via
`getContext()`: `ConnectionManagerRequestService` (`sendRequest`, `getSupportedProfiles`,
`getProfile`), `getPresetManager`, `eventSource` + `CONNECTION_PROFILE_*`,
`WORLD_INFO_ACTIVATED`, `CHAT_CHANGED`, `chat`, `characters`/`characterId`,
`getCharacterCardFields`, `powerUserSettings.persona_description`, `name1`/`name2`.
Browser IndexedDB. New devDependency: `fake-indexeddb` (tests only, never bundled).

**Storage**: Assistant settings in `extensionSettings['WorldInfoWorkspace'].assistant`
(optional, additive to schema v1); conversations, messages, proposal batches and undo
records in IndexedDB `WorldInfoWorkspace-assistant` (per browser profile; clarification).

**Testing**: Vitest — unit (protocol incl. streaming chunk boundaries + recorded live
fixture, validation, handles, context budget, destructive/duplicate rules, ordering,
undo planning, failure classification), integration (apply/undo + real store + real sync
engine on the existing FakeHost harness; conversation controller with `FakeLlm` and a
memory conversation store), contract (`llmClient` vs a fake `ConnectionManagerRequestService`
mirroring `shared.js`; hook payloads). Live: quickstart A0–A21 on both owner profiles.

**Target Platform**: SillyTavern web UI (desktop + mobile layouts), Connection Manager
enabled.

**Project Type**: SillyTavern UI extension (single bundle)

**Performance Goals**: first visible feedback as soon as the provider streams (UI update
throttle 100 ms); parsing + validation of a 50-operation reply < 50 ms; context assembly
for a 300-entry workspace < 200 ms; no typing lag while streaming (SC-007).

**Constraints**: no credentials handled (roadmap FR-017); never apply unaccepted
operations (FR-028); never interfere with main chat generation (FR-029); all mutations
through existing tree ops + `workspaceActions` (FR-011); free-tier rate limits are normal
(bounded visible retries, R7); English-only artifacts (IX).

**Scale/Scope**: single user; conversations up to hundreds of messages; workspaces of
hundreds of entries; replies up to ~50 operations.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Check | Status |
|-----------|-------|--------|
| I. Holistic, modular | New pure `core/assistant` module with explicit exports; adapters `llmClient`, `conversationStore`, `assistantApply`, `assistantController`, `chatContext`; UI under `ui/assistant/`; no entry-point scripts | ✅ |
| II. App API first | LLM via `ConnectionManagerRequestService` (profiles, preset, secrets resolved by the app); profiles/events/chat/character/persona via `getContext()`; activated entries via the app event; tree changes via existing ops. IndexedDB is a browser API with no app equivalent for per-device storage — isolated in `conversationStore.ts` (same justification as spec 004 `fsaDisk.ts`) | ✅ |
| III. Strict TS | `global.d.ts` grows: `ConnectionManagerRequestService`, `getPresetManager` subset, connection profile type, `chat` message subset, `getCharacterCardFields`, event names; generator return typed as a union narrowed in the adapter | ✅ |
| IV. Lint & format | Unchanged tooling | ✅ |
| V. Test-first | Parser, validation, context, rules and undo planning are pure and table-driven → tests first; recorded live reply as fixture | ✅ |
| VI. Integration testing | Apply/undo against real store + sync engine (FakeHost); `llmClient` contract against `shared.js` signatures; hook payload contract tests | ✅ |
| VII. Interop hooks | Additive `wi-workspace:assistant-applied` / `wi-workspace:assistant-undone` (contracts/hooks.md), documented in `AGENTS.md` | ✅ |
| VIII. Proven pattern / speckit | spec → clarify → plan → tasks; improves on the reference recommender's documented failure modes | ✅ |
| IX. Language | English artifacts and UI; conversation in Russian | ✅ |
| Shared style system | Proposal cards, badges, streaming footer, banners, menus extend `wiw-theme.scss` primitives (the mock's `.wiw-proposal*`, `.wiw-bubble*` move into the theme) | ✅ |

Post-design re-check (after data-model/contracts): no violations. One requirement
interpretation is recorded in Complexity Tracking (FR-025).

## Project Structure

### Documentation (this feature)

```text
specs/005-ai-lore-assistant/
├── spec.md
├── plan.md              # This file
├── research.md          # R1–R14
├── data-model.md
├── quickstart.md        # A0–A21
├── contracts/
│   ├── assistant-protocol.md
│   ├── llm-port.md
│   ├── assistant-ui-contract.md
│   └── hooks.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks (not created here)
```

### Source Code (repository root)

```text
src/
├── core/
│   └── assistant/                 # NEW — pure, framework-free
│       ├── types.ts               # data-model types (settings, conversation, message,
│       │                          #   proposal, applied batch, failure)
│       ├── ports.ts               # LlmPort, ConversationStorePort, ChatContextPort
│       ├── protocol.ts            # incremental tolerant parser + model-facing text
│       ├── handles.ts             # per-request handle map (f/e/i + n)
│       ├── context.ts             # message assembly, outline, budget trimming, omitted list
│       ├── prompts.ts             # default instructions, mode rules, decision notes
│       ├── validate.ts            # block → proposal (scope, refs, fields via md FIELD_SPECS,
│       │                          #   Phase 1 validation)
│       ├── rules.ts               # destructive (50 % / keyword removal), duplicates,
│       │                          #   dependencies/blocked, staleness fingerprint
│       ├── scope.ts               # scope resolution (selection / folders / workspace)
│       ├── settingsOps.ts         # pure assistant-settings update + repair
│       ├── plan.ts                # apply order (topological), accept-all selection
│       ├── undo.ts                # inverse records + undo plan with skip detection
│       └── failures.ts            # error → AssistantFailure classification, retry policy
├── adapters/
│   ├── llmClient.ts               # NEW — LlmPort over ConnectionManagerRequestService
│   │                              #   (availability, profiles, preset streaming, run, timeout)
│   ├── conversationStore.ts       # NEW — IndexedDB WorldInfoWorkspace-assistant + memory fallback
│   ├── chatContext.ts             # NEW — chat messages, character card, persona,
│   │                              #   activated entries cache (WORLD_INFO_ACTIVATED, CHAT_CHANGED)
│   ├── assistantApply.ts          # NEW — apply/undo via tree ops + workspaceActions, events
│   ├── assistantController.ts     # NEW — UI-facing surface: conversations, send/stop/retry/
│   │                              #   continue/regenerate, streaming state, decisions
│   ├── workspaceActions.ts        # CHANGED — deleteNodes() extracted from WorkspaceApp
│   ├── settingsStore.ts           # CHANGED — builds assistant services
│   └── logger.ts                  # USED — all user-visible toasts go through notify*
├── core/state/schema.ts           # CHANGED — optional `assistant` settings + migrate defaults
├── ui/
│   ├── AssistantPanel.tsx         # REWRITTEN — real region root (mock removed)
│   ├── assistant/                 # NEW — ConversationView, Composer, ProposalCard,
│   │                              #   ProposalEditor, ProposalDiff, BatchBar, ReplyNotices,
│   │                              #   FailureCard, SettingsMenu, ContextMenu, ConversationSwitcher
│   └── WorkspaceApp.tsx           # CHANGED — uses workspaceActions.deleteNodes; passes
│                                  #   selection + open-item callback to the assistant
├── styles/wiw-theme.scss          # CHANGED — proposal/bubble/badge/streaming primitives
└── global.d.ts                    # CHANGED — typed app surfaces listed in Constitution III

tests/
├── fixtures/assistant/            # NEW — recorded replies + hand-made protocol cases
├── support/fakeLlm.ts             # NEW — scripted LlmPort (chunks, failures, delays)
├── unit/assistant-*.test.ts       # NEW — protocol, handles, context, validate, rules, plan,
│                                  #   undo, failures
├── integration/assistant-apply.test.ts      # NEW — FakeHost + store + sync engine
├── integration/assistant-controller.test.ts # NEW — FakeLlm + memory store
└── contract/llm-client.test.ts    # NEW; hooks.test.ts CHANGED
```

**Structure Decision**: Single-extension layout extended by one pure `core/assistant`
module, five adapters, and a `ui/assistant/` component folder; the delete flow moves from
`WorkspaceApp.tsx` into `workspaceActions.ts` so UI and assistant share it (as spec 004
R10 did for tree changes).

## Delivery Order (for /speckit-tasks)

1. **Foundations**: types + ports; `global.d.ts` typing; `llmClient` (availability,
   profiles, preset streaming, run, error classification) with contract tests;
   `conversationStore` (IndexedDB + memory); settings schema addition; `FakeLlm`.
2. **US3 + US4 core (P1)**: settings menu (profile, limits, instructions), availability
   banners; conversation controller with send/stop/streaming/elapsed, failure cards,
   bounded auto-retry; discuss-mode chat without proposals (end-to-end request path first).
3. **US1 (P1)**: protocol parser (fixtures first), handles, context builder (selection
   scope + outline, budget, omitted notice), validation, proposal cards with diff and
   edit-before-accept, apply for create/edit via `assistantApply`, staleness, duplicates,
   feedback revisions, truncation → Continue, "Ask to fix".
4. **US2 (P1)**: create_folder/rename/move/delete, dependency ordering and blocked state,
   destructive rules, `workspaceActions.deleteNodes` extraction + assistant confirmation,
   accept-all semantics.
5. **Undo (FR-015)**: inverse records, undo planning with skip detection, batch bar,
   events.
6. **US5 (P2)**: conversation switcher (new/switch/rename/delete), persistence of
   decisions/undo, decision notes in history, per-conversation context settings.
7. **US6 (P3)**: context menu options (scope folders/workspace, chat messages, character
   card, persona, activated entries via `chatContext`), item references in prose.
8. **Hardening**: 300-entry context run, typing-while-streaming check, quickstart A0–A21
   on both profiles, `AGENTS.md` update (structure, settings schema, IndexedDB store,
   events, assistant semantics), version bump to 0.4.0.

## Complexity Tracking

| Item | Why Needed | Simpler Alternative Rejected Because |
|------|------------|--------------------------------------|
| FR-025 read as "validation + repair turn" instead of provider-enforced output (tools / JSON schema) in v1 | Streaming feedback (clarified) is incompatible with tool calls in the app's stream parser; the owner's free models lack strict schema support; router models vary per request | Tool calls: no streaming, per-model support varies; JSON schema: no prose streaming, one syntax error loses the whole reply. The protocol-independent operation model keeps a later tool/schema front end cheap |
| Separate IndexedDB database for conversations | Clarified per-device storage; must not grow shared settings | Reusing the md link DB couples unrelated schemas and upgrades; localforage adds an untyped dependency |
