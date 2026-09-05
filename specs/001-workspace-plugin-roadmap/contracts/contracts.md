# Contracts — Integrated Lore Workspace (001-workspace-plugin-roadmap)

Interface contracts the plugin exposes and consumes. Everything app-facing goes through
`getContext()` (research.md R4); everything third-party-facing is the namespaced event API
below (constitution Principle VII).

## C1. Public event API (for other extensions)

Namespace: `wi-workspace:*`, emitted on `ctx.eventSource` via `eventSource.emit(name, payload)`.
Payloads are frozen plain objects; listeners must not mutate them. Events are additive-only;
breaking a payload is a MAJOR plugin version bump.

| Event | Payload | Emitted when |
|-------|---------|--------------|
| `wi-workspace:structure_changed` | `{ rootId: string, change: 'create'\|'delete'\|'move'\|'rename', nodeId: string }` | Folder/node structure changes |
| `wi-workspace:entry_updated` | `{ nodeId: string, bookName: string \| null, fields: string[] }` | Any card field edited (pre-sync) |
| `wi-workspace:synced` | `{ bookName: string, rootId: string, exported: number, removed: number }` | A WI root was flattened and saved to a native book |
| `wi-workspace:assistant_action` | `{ sessionId: string, ops: { op: string, targetId: string \| null }[], status: 'proposed'\|'applied'\|'rejected' }` | Assistant proposal lifecycle |

## C2. Slash commands

Registered via `SlashCommandParser.addCommandObject(SlashCommand.fromProps(...))` with
typed `SlashCommandNamedArgument`s (ARGUMENT_TYPE) and `SlashCommandEnumValue` completions.

| Command | Arguments | Behavior |
|---------|-----------|----------|
| `/wi-workspace` (alias `/wiw`) | `action` (enum: `open`, `sync`, `export-md`, `import-md`), `quiet` (bool, default false) | `open` — toggle workspace panel; `sync` — export all WI roots; `export-md`/`import-md` — run converter on configured path; `quiet` suppresses toasts |
| `/wi-workspace-ask` (alias `/wiw-ask`) | `message` (string, required), `apply` (bool, default false) | Sends one message to the lore assistant; with `apply=true` auto-applies non-destructive proposals (destructive still confirm unless `quiet`) |

Returns: human-readable summary string (chat-visible unless `quiet`); errors via toastr
error + command failure.

## C3. Macro

Registered via `macros.registry.registerMacro(key, { handler, description })`.

| Macro | Expansion |
|-------|-----------|
| `{{wiw::entry=<comment or key>}}` | Content of the first matching card in exported books (empty string if none) — useful in prompts/quick replies |

## C4. Assistant operation schema (LLM structured output)

Assistant responses are requested as JSON (via `generateQuietPrompt(jsonSchema)` or
profile-based request) conforming to:

```jsonc
{
  "reply": "string",                    // user-facing explanation
  "operations": [                        // may be empty
    {
      "op": "create-card" | "edit-card" | "delete-node" | "move-node"
          | "create-folder" | "delete-folder" | "rename-node",
      "targetPath": "string | null",    // workspace path; resolved to node id
      "card": {                          // for card ops; subset of native fields
        "key": ["string"], "keysecondary": ["string"], "comment": "string",
        "content": "string", "constant": false, "disable": false,
        "order": 100, "position": 0, "probability": 100
        // ...any native field; unknown fields → extensions passthrough
      },
      "name": "string | null",          // rename/create target name
      "destinationPath": "string | null" // move/create destination
    }
  ]
}
```

Parsing rules: unknown ops → rejected with warning; missing required fields → op rejected;
all ops land as pending `AssistantProposal`s (never auto-applied without confirmation,
except non-destructive ops with `/wiw-ask apply=true`).

## C5. Markdown conversion contract (research.md R7)

**Import (md → workspace)**:
- A directory tree is walked depth-first; each directory becomes a FolderNode (root
  directory maps to the chosen import parent).
- `*.md` with recognized frontmatter (YAML) → CardNode: frontmatter keys map via
  `MdConversionMapping.frontmatterToField`; file body (after frontmatter) → `content`.
- `*.md` with `type: note` in frontmatter, or any `.txt` file, or `*.md` without
  frontmatter → NoteNode with verbatim content.
- Unrecognized frontmatter keys → card `native.extensions` passthrough (never dropped).
- File/folder names sanitize to node names; collisions get numeric suffixes.

**Export (workspace → md)**:
- FolderNode → directory; CardNode → `<name>.md` with YAML frontmatter (all mapped fields)
  and body = `content`; NoteNode → `<name>.md` with `type: note` frontmatter.
- `bookName`/`isWiRoot` recorded in an optional `_workspace.md` metadata file per exported
  root so re-import restores designation.
- Round-trip guarantee: export→import→export is byte-stable for content and mapped fields
  (FR-022); unknown keys survive via `extensions`.

## C6. Native persistence contract (consumed)

- Books read/written only via `loadWorldInfo` / `saveWorldInfo(name, data, immediately?)`;
  payload shape `{ entries: { "<uid>": NativeWiEntry } }` (+ `extensions` for book
  metadata); save receives a structured clone; app handles sanitization, atomic write, and
  `WORLDINFO_UPDATED` emission (research.md R3).
- Workspace's own state under `extensionSettings['WorldInfoWorkspace']`, saved with
  `saveSettingsDebounced()`.
