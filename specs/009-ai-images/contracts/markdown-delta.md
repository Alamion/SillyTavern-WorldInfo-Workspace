# Markdown Convention Delta (amends spec 004 `contracts/markdown-convention.md`)

Folder record `.wiw-folder.yaml`, map `wi_images`:

| Key | Workspace field | Default (not written) |
|---|---|---|
| `wi_images.<file>.wi_prompt` | image generation prompt (`ImageNode.prompt`) | `""` |

- Written only when non-empty; an image whose only non-default metadata is the prompt gets
  an entry in `wi_images`.
- Import: a string is read into `prompt`; any other type is ignored and kept as a foreign
  value per the existing unknown-key rule.
- Three-way reconcile (linked folder): the prompt participates in the image item's
  metadata comparison like `wi_caption`.
