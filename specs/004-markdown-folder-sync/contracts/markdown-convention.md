# Contract — Markdown Convention v1

The user-visible mapping between the workspace and a folder of markdown files (spec
FR-001..FR-005, FR-018, FR-023). This document is the source for the in-workspace
mapping reference; the reference view MUST render the same tables. Rationale: research
R3–R6.

**Minimal metadata principle**: every key below is optional. A plain markdown/Obsidian
folder is valid as-is; the plugin never writes a key whose value equals its default,
never writes ids, and creates a folder record only for folders with non-default folder
information. Importing or linking a folder does not modify any file by itself.

## Layout

```text
<linked or exported folder>/
├── Kingdoms/                 # workspace folder → directory
│   ├── .wiw-folder.yaml      # folder record — present because Kingdoms is a WI root
│   ├── Aldermeer.md          # entry → markdown file
│   ├── Aldermeer map.png     # image item → image file
│   └── Houses/               # no record: default name, default order, no designation
│       └── House Varn.md
├── Notes.md                  # plain note without front matter = entry with defaults
└── .obsidian/                # foreign — ignored, never touched
```

Scanner rules:

- Recognized: directories, `*.md`, image files (`png jpg jpeg gif webp svg avif bmp`,
  case-insensitive), `.wiw-folder.yaml`.
- Ignored and never modified/deleted: any other dot-entry (`.obsidian/`, `.git/`,
  `.trash/`), `*.crswap`, any other file type.
- A directory without `.wiw-folder.yaml` is a folder named after the directory with
  default folder settings; no record is created unless the folder gains non-default
  information.

## Entry file

```markdown
---
wi_keys: [Aldermeer, the river city]
wi_order: 120
wi_position: at_depth
wi_depth: 2
tags: [kingdom]          # foreign key — preserved verbatim
---

Aldermeer is a river city …
```

- The front matter block exists only if the first line is exactly `---`; it ends at the
  next line that is exactly `---` (or `...`). Anything else in the file is body.
- **Body** = `content` verbatim. Writer: `---\n<yaml>---\n\n<content>`. Reader: drops
  exactly one empty line directly after the closing delimiter, if present. No block →
  the whole file is the body.
- **Title** = node name = native `comment`: the file stem, unless `wi_title` is present.
  `wi_title` is written only when the name differs from the stem (sanitization or
  collision suffix).
- Keys starting with `wi_` are owned by this convention; unknown `wi_*` keys are
  reported as warnings and preserved. Keys without the prefix are foreign: preserved
  with their values and original relative order, written after the owned keys.
- Owned keys equal to the default are omitted on write. On read, a missing key = default.
- Malformed YAML: the file imports as an entry whose content is the whole file text;
  warning in the report; the file is not rewritten until the user edits that entry.

### Field mapping

Defaults are those of `createDefaultNativeEntry` (`src/core/state/schema.ts`).

| Key | Native field | Type in file | Default |
|-----|--------------|--------------|---------|
| `wi_id` | node id (not native) — read-only hint | string | never written; honored for matching when present |
| `wi_title` | `comment` / node name | string | file stem |
| `wi_keys` | `key` | list of strings | `[]` |
| `wi_secondary_keys` | `keysecondary` | list of strings | `[]` |
| `wi_selective` | `selective` | boolean | `true` |
| `wi_selective_logic` | `selectiveLogic` | `and_any` \| `not_all` \| `not_any` \| `and_all` (or 0–3) | `and_any` |
| `wi_enabled` | `disable` (inverted) | boolean | `true` |
| `wi_constant` | `constant` | boolean | `false` |
| `wi_vectorized` | `vectorized` | boolean | `false` |
| `wi_order` | `order` | number | `100` |
| `wi_position` | `position` | `before_char` \| `after_char` \| `an_top` \| `an_bottom` \| `at_depth` \| `em_top` \| `em_bottom` \| `outlet` (or 0–7) | `before_char` |
| `wi_depth` | `depth` | number | `4` |
| `wi_role` | `role` | `system` \| `user` \| `assistant` (or 0–2) | `system` |
| `wi_outlet_name` | `outletName` | string | `""` |
| `wi_probability` | `probability` | number | `100` |
| `wi_use_probability` | `useProbability` | boolean | `true` |
| `wi_ignore_budget` | `ignoreBudget` | boolean | `false` |
| `wi_exclude_recursion` | `excludeRecursion` | boolean | `false` |
| `wi_prevent_recursion` | `preventRecursion` | boolean | `false` |
| `wi_delay_until_recursion` | `delayUntilRecursion` | number or boolean | `0` |
| `wi_match_persona_description` | `matchPersonaDescription` | boolean | `false` |
| `wi_match_character_description` | `matchCharacterDescription` | boolean | `false` |
| `wi_match_character_personality` | `matchCharacterPersonality` | boolean | `false` |
| `wi_match_character_depth_prompt` | `matchCharacterDepthPrompt` | boolean | `false` |
| `wi_match_scenario` | `matchScenario` | boolean | `false` |
| `wi_match_creator_notes` | `matchCreatorNotes` | boolean | `false` |
| `wi_group` | `group` | string | `""` |
| `wi_group_override` | `groupOverride` | boolean | `false` |
| `wi_group_weight` | `groupWeight` | number | `100` |
| `wi_scan_depth` | `scanDepth` | number or null | `null` |
| `wi_case_sensitive` | `caseSensitive` | boolean or null | `null` |
| `wi_match_whole_words` | `matchWholeWords` | boolean or null | `null` |
| `wi_use_group_scoring` | `useGroupScoring` | boolean or null | `null` |
| `wi_sticky` | `sticky` | number or null | `null` |
| `wi_cooldown` | `cooldown` | number or null | `null` |
| `wi_delay` | `delay` | number or null | `null` |
| `wi_automation_id` | `automationId` | string | `""` |
| `wi_triggers` | `triggers` | list of generation types | `[]` |
| `wi_character_filter` | `characterFilter` | `{ exclude: bool, names: [..], tags: [..] }` | empty, include |
| `wi_add_memo` | `addMemo` | boolean | `true` |
| `wi_extensions` | `extensions` | object (verbatim) | `{}` |
| *(body)* | `content` | markdown text | `""` |
| *(never written)* | `uid`, `displayIndex`, per-book sync | — | assigned per book by native sync |

Native fields not listed above that an entry carries (future app fields) are written
under `wi_native` as an object and restored verbatim, so no native field is dropped.

Enum values: numbers outside the documented range and unknown names are kept as given
and flagged by the workspace validation (never coerced).

## Folder record `.wiw-folder.yaml`

Written only when at least one key below would be non-default (or foreign keys must be
preserved); deleted by the plugin when the folder returns to all-default information and
the record contains no foreign keys.

```yaml
wi_title: "Kingdoms: East"  # only when the directory name differs from the folder name
wi_root: true               # World Info root designation (omitted when false)
wi_book: "Kingdoms East"    # bound native book name (with wi_root only)
wi_order: [Houses, Aldermeer.md, Aldermeer map.png]
                            # custom child order by child file/directory name; only when it
                            # differs from the default order (folders first, then
                            # case-insensitive name); unknown names ignored, unlisted
                            # children follow in default order
wi_images:                  # only images with non-default metadata
  "Aldermeer map.png":
    wi_title: "Aldermeer — map"   # only when it differs from the file stem
    wi_caption: "Old survey map"  # only when non-empty
  "Remote portrait":              # URL-only image (no file could be written)
    wi_src: "https://example.org/p.png"
```

| Key | Meaning | Default |
|-----|---------|---------|
| `wi_title` | folder name | directory name |
| `wi_root` | World Info root designation | `false` |
| `wi_book` | bound native book name (with `wi_root`) | proposal from folder name via the Phase 1 naming flow |
| `wi_order` | custom child order by name | folders first, then case-insensitive name |
| `wi_images.<file>.wi_title` | image item name | file stem |
| `wi_images.<file>.wi_caption` | image caption | `""` |
| `wi_images.<name>.wi_src` | URL of an image without a file | — |

Foreign keys in the record are preserved like in entry files. Expand/collapse state and
the global sort mode are UI state and are not written.

## Images inside the workspace

Image files imported from a folder (and images uploaded in the editor) are stored in the
app's user image storage under `user/images/WorldInfoWorkspace/` (Gallery storage) and
referenced by path; SVG/AVIF and other formats the storage does not accept stay embedded.
Export writes the image bytes back as files regardless of where they are stored.

## File names

Per research R5: sanitized stem, case-insensitive sibling uniqueness with ` (N)`
suffixes, existing paths kept while still valid (no churn), `.md` for entries, the MIME
extension for images. Directory names follow the same rules.

## Image references inside entry content

Entry bodies are written verbatim. When the workspace previews content, an image
reference resolves in this order: `img:<node id>`; a direct source (`https://…`,
`data:…`, `user/images/…`); otherwise an image item name — with or without extension or
folder path, in `<angle brackets>` or URI-encoded — preferring the image closest to the
entry. Both `![alt](Name)` and Obsidian `![[Name.png|alt]]` are rendered.
