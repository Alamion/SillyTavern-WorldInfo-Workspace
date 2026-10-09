# Persistence Delta (amends spec 003 `contracts/persistence-schema.md`)

Additive, schema version stays 1. Payloads written before spec 009 load unchanged;
payloads written by spec 009 load in earlier versions (unknown fields are carried along).

## `ImageNode.prompt?: string`

- The prompt of the kept generated picture; the user may edit it.
- `migrate`: a non-string value is dropped; absent stays absent.
- Content for the stale-tab content hash (spec 008) — the projection is unchanged.
- Never part of a native book (images are workspace-only).

## `settings.images?: ImageSettings`

Fields and defaults: see `data-model.md`. Repaired field by field by `getImageSettings`;
an invalid object is replaced by defaults. Like `settings.assistant`, it is not written
while a data recovery is pending. Content for the stale-tab hash (shown as "Image
settings" in the conflict summary).
