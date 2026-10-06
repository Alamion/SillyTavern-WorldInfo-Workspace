# Contract — Markdown Convention: summary and pick exclusion (delta)

Base: `specs/004-markdown-folder-sync/contracts/markdown-convention.md`. Both additions
are optional keys: files and folder records without them read and write exactly as
before (minimal metadata rule — defaults are never written).

## Entry front matter

| Key | Native field | Type | Default | Notes |
| --- | --- | --- | --- | --- |
| `wi_summary` | `extensions.wiw_summary` | string | absent | Hoisted out of `wi_extensions` on export; `wi_extensions` is omitted when nothing else remains |

Import: `wi_summary` → `extensions.wiw_summary`. If `wi_extensions.wiw_summary` is also
present and differs, `wi_summary` wins and the import report lists the item.

## Folder record (`.wiw-folder.yaml`)

| Key | Workspace field | Type | Default |
| --- | --- | --- | --- |
| `pick_excluded` | `FolderNode.pickExcluded` | boolean | `false` (not written) |

## Reference table

`MappingReference` (UI) and the README convention table list both keys.
