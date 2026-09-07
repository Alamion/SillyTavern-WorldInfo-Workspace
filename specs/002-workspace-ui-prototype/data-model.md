# Data Model — Workspace UI Prototype (002-workspace-ui-prototype)

Prototype-level entities only. Production entities live in
`specs/001-workspace-plugin-roadmap/data-model.md`; sample data deliberately mirrors
those shapes so approved design transfers.

## Entities

### SampleDataset

The single in-memory dataset rendered by the prototype (spec FR-003). Held in component
state (structuredClone of the constant) so WI-mode toggles, drag-and-drop and creation
update it live.

| Field | Type | Notes |
|-------|------|-------|
| `meta` | DatasetMeta | Title, 'PROTOTYPE - nothing is saved' label |
| `root` | SampleFolder | The single workspace tree root (clarification Q2: one unified workspace) |

### SampleNode (union)

```
SampleNode = SampleFolder | SampleEntry | SampleImage
```

Mirrors production `TreeNode` (spec 001 data-model). Common fields: stable `id`,
`parentId`, `kind`, `name`; folder children arrays carry the (custom) order.

### SampleFolder

| Field | Type | Notes |
|-------|------|-------|
| `isWiRoot` | boolean | Live-togglable in the editor; multiple roots, any depth, may nest |
| `wiSettings` | WiRootSettingsMock | null | Present when `isWiRoot` (per-clarification Q2 each designation has its own settings) |
| `expanded` | boolean | UI state |

### WiRootSettingsMock

Mock of one designation's own book settings (spec FR-012): `bookName`,
`scanDepthOverride`, `caseSensitiveOverride`, `recursiveScanning`, `notes`.

### SampleEntry

Former card/note kinds are merged (iteration decision): every text entity is an entry
carrying the full native field set (spec 001 research R1). Export membership is derived
solely from enclosing World Info roots, so 'notes' are simply entries placed outside
roots (or, in the future, with a per-entry export exclusion).

| Field | Type | Notes |
|-------|------|-------|
| `fields` | NativeWiEntry | Verbatim native fields incl. `uid` and `extensions` passthrough |
| `bookMemberships` | string[] | Derived from enclosing roots; 0..n (world intersection is by design) |
| `contentLengthClass' | 'normal' | 'long' | Long-content exercise card (~2,000 words) |

### SampleImage

| Field | Type | Notes |
|-------|------|-------|
| `source` | string | Image data (prototype: SVG data URIs); production: png/jpg/webp files |
| `caption` | string | Display caption; also the prompt-side text used by search |

### Field schema and layout

`FIELD_SCHEMA` (src/core/sample/fieldGroups.ts) types every native field
(text/number/boolean/nullable/enum/stringList/json) with labels, info tooltips and docs
links. `ADVANCED_LAYOUT` groups the non-essential fields into drawer-style horizontal
rows; Essentials rows and the Content section are rendered explicitly in the editor
component. The contract test enforces full field coverage.

### PrototypeLayout

| Region | Content | Behavior |
|--------|---------|----------|
| Header | Workspace badge (prototype label as tooltip), review-guide and assistant icon buttons | Compact |
| Structure tree | Toolbar (sort/filter/create) + filtered tree with WI badges; DnD between folders, reorder in custom mode | In-memory interactivity |
| Item editor | Essentials / Content / Advanced (entry) - image preview - folder settings with WI toggle | Swaps with selection |
| Assistant panel | Scripted batch-proposal conversation with per-item decisions and a diff modal; inert AI-settings button | Toggleable |
| Bottom sheets (mobile) | Editor/assistant as absolute overlays with drag sizes: peek/half/tall/full | Snap on release |

### ReviewDecision

Not software - the Phase 0 exit artifact recorded by the owner (approve / iterate /
discard + notes), captured in the review conversation and spec checklist.

## Relationships

```
SampleDataset 1—1 SampleFolder(root)
SampleFolder 1—* SampleNode          (arbitrary depth; nested SampleFolder may itself be isWiRoot)
SampleFolder(isWiRoot) 1—1 WiRootSettingsMock
SampleCard 0..*—0..* book (via bookMemberships)   — intersection is by design
FieldGroupMap 1—* SampleCard fields   (grouping only, no data duplication)
```

## Validation rules (dataset contract, tested)

- Exactly one root; every node's `parentId` resolves; no cycles.
- ≥ 3 nesting levels, ≥ 10 cards, ≥ 3 notes, ≥ 2 WI roots, ≥ 1 nested WI root
  (spec FR-003).
- Every card's fields grouped by `FieldGroupMap` cover the full native field set
  (spec 001 research R1) — no orphan fields.
- ≥ 1 card with `bookMemberships.length ≥ 2`; ≥ 1 folder with ≥ 30 children;
  ≥ 1 card with ~2,000-word content (edge cases).
- All sample text English-only (constitution IX).

## State transitions

- `expanded` (folders), selection, assistant-panel visibility: in-memory only, reset on
  close (spec FR-009). No persisted transitions in this phase.
