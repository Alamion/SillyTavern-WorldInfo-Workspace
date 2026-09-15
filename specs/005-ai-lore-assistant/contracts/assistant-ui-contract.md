# Contract — Assistant UI

Replaces the Phase 0 mock `src/ui/AssistantPanel.tsx` in the same region (desktop aside,
mobile sheet). All styles extend `src/styles/wiw-theme.scss` (constitution: shared style
system); icons Font Awesome 6 Free.

## Region layout

```text
┌ Assistant ─────────────────────────────── [conversations ▾] [+] [⚙] ┐
│ ⚠ state banner (no profile / Connection Manager disabled / no storage)│
│ conversation (scrolls)                                                │
│   user bubble                                                         │
│   assistant bubble: prose with [item refs] · Thinking (collapsed)     │
│     context notice: "Sent: structure (12 items) · 3 with contents (2 by keys). Omitted: …"    │
│     proposal list (per item) · batch bar · unparsed report            │
│     footer: profile · model · status/elapsed or "1 240 chars…"        │
│ composer: [Propose|Discuss] textarea  [Send] / [Stop]                 │
│   context chip: "Cities · by keys · chat 10" (opens context)  │
└───────────────────────────────────────────────────────────────────────┘
```

## Components

| Component | Responsibility | Requirements |
|-----------|----------------|--------------|
| `AssistantPanel.tsx` | Region root: state banners, conversation switcher, composer | FR-001, FR-019, FR-032 |
| `assistant/ConversationView.tsx` | Messages, statuses, reasoning toggle, item references (click → select + open item in editor; missing → toast "This item no longer exists") | FR-002, FR-005, FR-030 |
| `assistant/ProposalCard.tsx` | One proposal: op icon (reuse mock icon map), summary with tree path, badges (destructive, duplicate, stale, blocked, invalid + reason), Accept / Deny / Edit / Diff / Feedback | FR-007–FR-009, FR-013, FR-014, FR-016, FR-017 |
| `assistant/ProposalEditor.tsx` | Edit title/keys/content/fields of a proposal before accepting | FR-009 |
| `assistant/BatchBar.tsx` | Accept all pending / Deny all pending / Feedback… / Undo batch | FR-009, FR-015, FR-017 |
| Destructive confirmation (via `src/adapters/popups.ts`) | Deletions: `workspaceActions.describeDeletion` disclosure (affected items, books, linked files); destructive edits: removed-content summary | FR-010 |
| `assistant/Composer.tsx` | Textarea, Send/Stop, Propose/Discuss toggle, context chip | FR-002, FR-003 |
| `assistant/ProposalDiff.tsx` | Per-field diff built on `DiffView.tsx` | FR-008, FR-013 |
| `assistant/ReplyNotices.tsx` | Context notice, truncated notice, broken-blocks notice (Show broken blocks, Regenerate with the same context, Ask to fix) | FR-004, FR-023, FR-027 |
| `assistant/FailureCard.tsx` | Failure reason, retry countdown, Retry / Retry now / Cancel | FR-026 |
| `assistant/SettingsMenu.tsx` | Profile select (with api + streaming badge), response/context limits, instructions editor with Reset | FR-018–FR-020, FR-024 |
| `assistant/ContextMenu.tsx` | "Assistant context" dialog in three sections — Structure (Current folder following the selection with its live name and size / Chosen folders with an indented folder tree, children of a chosen folder shown as included / Whole workspace with its size), Entry contents (Selected and mentioned entries — recommended / All entries of the structure), Current chat (Recent messages + count, character card, persona, activated entries); footer [Use as default] … [Done] | FR-021, FR-021a, FR-022, FR-035 |
| `DiffView.tsx` (existing) | Per-field before/after for edits and stale refresh | FR-008 |

## States and texts (English, source locale)

| Situation | UI |
|-----------|----|
| Connection Manager disabled | Banner: "The assistant needs the Connection Manager extension. Enable it in Extensions → Manage extensions." Composer disabled. |
| No / missing profile | Banner: "Choose a connection profile for the assistant." + button opening settings. Composer disabled. |
| Text Completion profile | Inline warning under the select: "Text Completion profiles are supported on a best-effort basis; proposals may be unreliable." |
| Recovery banner unresolved | Settings menu read-only with note: "Assistant settings can be changed after the workspace recovery banner is resolved." |
| Text Completion without instruct template | Warning adds: "This profile has no instruct template." |
| Storage unavailable | Banner: "Conversations cannot be saved in this browser; they last until the page is reloaded." |
| Pending (no stream) | Footer: spinner + "Waiting for the model… 12 s" + Stop |
| Receiving (stream) | Prose streams live; footer: "Receiving… 1 240 chars" + Stop; proposals appear as blocks complete |
| Rate limit | Failure card: "The provider is rate-limiting requests (temporary)." + auto-retry countdown "Retrying in 30 s" [Cancel] / [Retry now] |
| Other failures | Failure card: readable reason per `AssistantFailure.kind`, [Retry], collapsible provider detail; the request text stays in the conversation |
| Truncated | Notice: "The reply was cut off." [Continue] [Regenerate]; complete proposals stay usable |
| Regenerate | [Regenerate] rebuilds the context from the current tree; [Regenerate with the same context] re-sends the stored request; the replaced text stays viewable as "Previous version" |
| Some blocks broken | Compact notice: "2 operation blocks could not be used." [Show broken blocks] [Regenerate with the same context]; expanding lists each raw excerpt + reason (collapsed by default) |
| Zero valid proposals with broken blocks | Same notice, plus [Ask to fix] |
| Context trimmed | Context notice lists omitted parts |
| Discuss mode | Composer toggle "Discuss"; no proposal list |

## Interaction rules

- Send: Enter sends, Shift+Enter newline (desktop); button only on mobile. Editing
  events stay inside the workspace container (spec 004 typing-performance rule).
- Only one request per conversation at a time; other conversations can be viewed.
- Accept on a proposal validates immediately; stale → the card switches to the stale
  state with a refreshed diff and needs a new Accept.
- Accept all: applies pending non-destructive proposals; then, if destructive ones
  remain, the card of the first one scrolls into view with its own "Confirm delete…" /
  "Confirm edit…" button.
- Applying selects nothing and does not move the tree view; the tree highlights changed
  nodes briefly (existing selection styles).
- All user-visible toasts go through `src/adapters/logger.ts` (`notify*`).
- Undo batch shows a result toast: "Reverted 4 changes; 1 skipped (edited since)" with
  details in the batch bar.
- Conversation switcher: list (title, updated time), rename, delete (confirm), new.
