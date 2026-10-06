# Contract — Markdown Convention: summary (delta)

Base: `specs/004-markdown-folder-sync/contracts/markdown-convention.md`. The addition
is an optional key: files and folder records without them read and write exactly as
before (minimal metadata rule — defaults are never written).

## Entry front matter

| Key | Native field | Type | Default | Notes |
| --- | --- | --- | --- | --- |
| `wi_summary` | `extensions.wiw_summary` | string | absent | Hoisted out of `wi_extensions` on export; `wi_extensions` is omitted when nothing else remains |

Import: `wi_summary` → `extensions.wiw_summary`. If `wi_extensions.wiw_summary` is also
present and differs, `wi_summary` wins and the import report lists the item.

## Folder record

No change: `FolderNode.pickExcluded` is a workspace setting about main-chat picking, not
lore content, and is NOT written to `.wiw-folder.yaml` (like `expanded`; decided during
implementation 2026-10-07 — writing it would have pulled folder attributes into
three-way reconcile for no lore value).

## Reference table

`MappingReference` (UI) and the README convention table list `wi_summary`.
