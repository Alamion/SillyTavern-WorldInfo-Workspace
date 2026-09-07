# Feature Specification: Workspace UI Prototype (Phase 0)

**Feature Branch**: `002-workspace-ui-prototype`

**Created**: 2026-09-05

**Status**: Draft

**Input**: User description: "let's create the prototype (phase 0)" — i.e., deliver Phase 0
of the approved roadmap in `specs/001-workspace-plugin-roadmap/spec.md` (US1, FR-023,
SC-008): an interactive prototype of the World Info Workspace interface, populated with
representative sample lore data, that the owner can evaluate to approve, iterate on, or
discard the visual direction before any production interface work is started.

## Clarifications

### Session 2026-09-05

- Q: What role should the Workspace play in lore work — the primary working home or a
  companion next to the native editor? → A: Full replacement of the native editor: like
  WorldInfoDrawer, the plugin re-binds the native editor's open button to itself (the
  native editor is not reachable while the plugin is enabled). Future plan: two hubs —
  the built-in Workspace and any custom hub working through .md files (e.g., Obsidian).
- Q: Should there be one global workspace or multiple named workspaces, and how do nested
  World Info designations behave? → A: One single unified workspace; world separation is
  non-linear and worlds may intersect, so the user decides inside the workspace which
  folder(s) become World Info roots, at any nesting depth. Every designated folder is its
  own book with its own settings; it recursively collects only cards (not folders)
  beneath it, traversing nested designations as ordinary folders — so a nested designation
  also exports its own book, and its cards legitimately appear in both books (world
  intersection by design).
- Q: What is the maximum scope of assistant actions per turn — single operation, batch
  operations, or autonomous modes? → A: Batch operations: the assistant can create/modify
  a set of cards in one turn (e.g., "fill this folder"), presented as one batch preview
  with a single batch confirmation; destructive operations are always confirmed
  separately; autonomous/auto-apply modes are deferred until after real-world use.
- Q: Is the plugin a personal tool or a community release, and how should theming be
  handled? → A: Community release (via the extension installer). The interface MUST style
  itself dynamically from the app's theme variables (63+ `--SmartTheme*` custom
  properties, user-configurable in app settings — e.g., ChatTintColor, BlurStrength,
  BlurTintColor), never from fixed colors. The owner validates on the app's default
  themes before publishing; issues on custom community themes are fixed as they are
  reported.
- Q: Since the Workspace replaces the native editor screen entirely, should it also manage
  which books are active for generation, or does that stay native? → A: The Workspace
  manages the active-books list itself (part of the replaced editor screen); book bindings
  to characters/personas/chats live in other app panels and remain native.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Open the Prototype Workspace (Priority: P1)

The owner uses the app's World Info editor entry point — which the prototype re-binds to
itself, since the product is positioned as a full replacement of the native editor (like
WorldInfoDrawer) — and a workspace panel opens over the chat interface, showing the three
planned regions side by side: the structure tree (left), the item editor (center), and
the assistant panel (right, toggleable). The panel visually matches the app's active
theme, so it reads as part of the product.

**Why this priority**: Without the shell being openable and readable, nothing else in the
prototype can be evaluated.

**Independent Test**: Can be fully tested by opening the panel from a running app and
confirming the three regions render in the active theme.

**Acceptance Scenarios**:

1. **Given** the extension is loaded, **When** the owner uses the World Info editor entry
   point, **Then** the workspace panel opens (in place of the native editor) showing all
   three regions with sample content.
2. **Given** the panel is open, **When** the owner closes and reopens it, **Then** it
   reopens cleanly with no leftover artifacts from the previous session.
3. **Given** the app's theme is switched, **When** the panel is reopened, **Then** the
   panel reflects the new theme's colors.

---

### User Story 2 - Browse the Sample Lore Tree (Priority: P1)

The owner explores the sample lore dataset in the structure tree: folders expand and
collapse, nodes are selectable, entries and images are visually distinguishable, and
folders designated as World Info roots carry a clear marker. A tree toolbar provides
sorting (custom/title/position/depth/order/trigger), kind filters and title/prompt
search, plus creation of new folders, entries, and images; drag-and-drop moves nodes
between folders (and reorders them in custom mode). The sample data demonstrates the
flexible structure promise: deep nesting, mixed node types, and multiple WI roots.

**Why this priority**: The flexible tree is the structural core of the product; its
visual behavior is a primary review target.

**Independent Test**: Can be fully tested by walking the sample tree: expanding,
collapsing, selecting items of each type, and observing markers and scrolling.

**Acceptance Scenarios**:

1. **Given** the sample dataset, **When** the owner expands nested folders, **Then** at
   least three levels of depth are visible at once with correct indentation.
2. **Given** a folder designated as a World Info root, **When** the owner views the tree,
   **Then** the folder carries a distinct visual marker distinguishing it from normal
   folders.
3. **Given** a folder with many children, **When** the owner scrolls its contents, **Then**
   the list scrolls smoothly without breaking the layout.
4. **Given** a node with a long name, **When** the owner views it, **Then** the name
   truncates gracefully without pushing other elements out of place.
5. **Given** a World Info root nested inside another World Info root, **When** the owner
   views the tree, **Then** both designations carry markers and the nesting relationship
   is visually apparent.

---

### User Story 3 - Inspect a Sample Card in the Editor (Priority: P1)

Selecting a card in the tree fills the editor region with that card's fields, grouped the
way the production editor is planned to group them: identity/content, activation and
keys, insertion order/position, recursion controls, scan sources, inclusion groups,
per-entry scan overrides, timed effects, and automation/character filters. Every field
group of the native World Info entry is represented with realistic sample values, so the
owner can judge the editor's organization. Selecting a note shows its free-form content
view instead.

**Why this priority**: Field organization is the make-or-break UX decision for the card
editor; it must be reviewable now, not after implementation.

**Independent Test**: Can be fully tested by selecting each node type in the sample data
and checking that every field group is visible and populated.

**Acceptance Scenarios**:

1. **Given** a selected card, **When** the owner reviews the editor, **Then** every native
   World Info field group is visible (directly or via a clearly labeled collapsible
   section).
2. **Given** the owner switches selection between a card and a note, **When** the editor
   refreshes, **Then** the note shows the free-form content view and the card shows the
   field-group view.
3. **Given** any selected card, **When** the owner looks for a specific field, **Then**
   they can reach it within two interactions from the card's default view.

---

### User Story 4 - Review the Assistant Panel Mock (Priority: P2)

The owner reviews the assistant region populated with a scripted sample conversation: a
user request, the assistant's reply, a batch change proposal rendered as a preview
listing several proposed operations with a single batch confirm/deny control (inert), and
a recommendation-style answer pointing at existing entries. The panel is clearly labeled
as a mock so no one expects live AI behavior.

**Why this priority**: The assistant's presentation (how proposals and recommendations
will look) matters for the visual direction but is not blocking the core layout decision.

**Independent Test**: Can be fully tested by opening the assistant region and stepping
through the scripted conversation.

**Acceptance Scenarios**:

1. **Given** the assistant region, **When** the owner reads the sample conversation,
   **Then** the batch proposal preview is visually distinct from plain replies, lists
   several proposed operations, and shows a single batch confirm/deny control.
2. **Given** the mock, **When** the owner interacts with any control, **Then** nothing
   calls a real AI service and nothing mutates the sample data.
3. **Given** the panel, **When** the owner toggles it away and back, **Then** the
   scripted conversation state is unchanged.

---

### User Story 5 - Record the Visual Direction Decision (Priority: P2)

The owner walks a short review guide (presented with the prototype) covering: layout
regions, tree behavior, editor organization, assistant presentation, and theme fit. The
owner then records a decision — approve, iterate (with specific notes), or discard —
before any production interface work begins.

**Why this priority**: The decision is the entire purpose of Phase 0; it must be an
explicit, traceable outcome.

**Independent Test**: Can be fully tested by completing the review guide and recording a
decision with notes.

**Acceptance Scenarios**:

1. **Given** the completed walkthrough, **When** the owner records "approve", **Then**
   production UI work may begin on that basis.
2. **Given** specific visual complaints, **When** the owner records "iterate", **Then**
   each complaint is captured as an actionable note for the next prototype round.
3. **Given** fundamental dissatisfaction, **When** the owner records "discard", **Then**
   the invested effort is limited to this prototype and the direction restarts from
   sketches.

---

### Edge Cases

- What happens when sample content contains extremely long strings (a 2,000-word card,
  a 200-character folder name) — does the layout overflow, wrap, or truncate cleanly?
- What happens when a folder contains a large number of children (50+) — scrolling and
  performance of the static tree?
- What happens when the panel is opened on a narrow window — does the three-region layout
  degrade acceptably (best effort, not a mobile target)?
- What happens when the prototype is opened while no chat is active — it must render from
  sample data only, independent of chat state.
- What happens with themes that set unusual variable values (very low contrast, dark on
  dark) — does the panel remain legible by relying on theme variables rather than fixed
  colors?
- What happens on rapid expand/collapse clicking — no visual glitches or stuck states?
- What happens when a card sits beneath nested World Info designations — does the
  prototype make multi-book membership (world intersection) visible enough to evaluate?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The prototype MUST take over the app's World Info editor entry point
  (re-binding it, consistent with the full-replacement positioning) and open the
  workspace panel from it without leaving the current chat context.
- **FR-002**: The prototype MUST present the three planned workspace regions — structure
  tree, item editor, assistant panel — as a full-editor surface (the stand-in for the
  replaced native editor). Its styling MUST be driven dynamically by the app's theme
  variables (the user-configurable `--SmartTheme*` custom properties), never by fixed
  colors, so user-tuned theme settings flow through automatically.
- **FR-003**: The sample dataset MUST include: at least three levels of folder nesting, at
  least 10 entries, at least 2 images, at least 2 folders designated as World Info roots,
  and at least one World Info root nested inside another World Info root, with
  representative English lore content.
- **FR-004**: The tree MUST support expand/collapse and selection for sample nodes, MUST
  visually distinguish cards from notes, and MUST mark World Info root folders — including
  designations nested inside other designations, so the intersection structure is visible.
- **FR-005**: The editor MUST present every native World Info field with representative
  values for a selected entry, organized into three sections: Essentials (activation and
  insertion fields, drawer-style horizontal rows with info/question icons), Content (a
  large textarea with a live markdown preview supporting embedded images), and Advanced
  (scan overrides, recursion, timed effects, automation, character filters, metadata).
  A selected image MUST render its preview and caption; a selected folder MUST show its
  World Info root settings with a live WI-mode toggle.
- **FR-006**: The assistant panel MUST render a scripted mock conversation with a batch
  change-proposal preview where every operation has its own accept/deny decision plus
  accept-all/deny-all controls; edit proposals MUST open a before/after diff modal with
  removed and added parts highlighted. The panel MUST be clearly labeled as a
  non-functional mock and include an inert AI-settings entry point.
- **FR-007**: Import/export and settings entry points MAY appear as visible controls but
  MUST be clearly inert (no real operations behind them).
- **FR-008**: The prototype MUST NOT read, modify, create, or delete any real lorebooks,
  app settings, or chat data; it MUST operate entirely on in-memory sample data.
- **FR-009**: Any edit-like interaction inside the prototype MUST be visual-only and
  non-persistent; state resets when the panel closes. The prototype MUST communicate this
  (e.g., a visible "prototype" label) so it sets no false expectations.
- **FR-010**: The prototype MUST include a visible review guide (short checklist of what
  to evaluate: layout, tree, editor, assistant, theme fit) supporting the decision
  walkthrough.
- **FR-011**: The prototype MUST be discardable: it can be removed or hidden after the
  decision without leaving dead dependencies in future production work.
- **FR-012**: When a folder designated as a World Info root is selected, the editor MUST
  present a mock view of that designation's own book settings, demonstrating the model
  where every World Info root carries its own configuration.
- **FR-013**: The prototype layout MUST include a visible mock control for the active
  books list (which World Info roots participate in generation), consistent with the
  full-replacement positioning; bindings to characters/personas/chats are out of the
  panel's scope and remain native.

### Key Entities *(include if feature involves data)*

- **Sample Lore Dataset**: Fabricated in-memory lore content (folders, cards, notes, WI
  root designations) representing realistic usage; independent of any real app data.
- **Prototype Layout**: The three-region arrangement (tree / editor / assistant) and its
  mapping to the app's theme variables.
- **Field Group Map**: The grouping of native World Info fields into editor sections —
  the presentation hypothesis under review.
- **Review Decision**: The owner's recorded outcome (approve / iterate / discard) plus
  actionable notes; the Phase 0 exit gate.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The owner can complete the full review walkthrough (all regions plus the
  review guide) in 15 minutes or less.
- **SC-002**: The sample tree with the full dataset renders with no perceptible delay
  when the panel opens.
- **SC-003**: Every native World Info field group is reachable within 2 interactions from
  a selected card's default view.
- **SC-004**: A visual adjustment requested during review can be demonstrated within one
  working day (the iteration loop stays cheap).
- **SC-005**: A decision (approve / iterate / discard) with notes is recorded before any
  production interface implementation begins.
- **SC-006**: Zero writes to real lorebooks, settings, or chat data occur during any
  prototype session (verifiable by inspection).

## Phase 0 Outcome (2026-09-05)

The prototype was delivered and iterated through six review rounds; the owner approved
the visual direction and closed Phase 0. Beyond the original stories, the review rounds
established: entries and images are one merged entity model (export membership is derived
solely from enclosing World Info roots - no note kind); the tree gained a toolbar
(sort/filter/create) and drag-and-drop with custom-order reordering; folders toggle their
World Info role live; the editor uses the Essentials/Content/Advanced layout with a live
markdown preview; the assistant works in batch proposals with per-item decisions and a
diff modal (recommendation lists were dropped - AI settings will be a dedicated menu);
PC layout has a resizable/collapsible tree splitter; mobile uses bottom sheets with drag
sizes (peek/half/tall/full). Deferred follow-ups are recorded in research.md Open items
(ST macro resolution in previews, touch-friendly tree DnD).

## Assumptions

- The prototype reuses the extension shell initialized in spec 001 and contains no
  persistence, sync, or AI integration code; sample data lives in memory only.
- Sample content is a generic fantasy realm written in English, fabricated for review
  purposes.
- The starting layout hypothesis is the three-region panel (tree left, editor center,
  assistant right/toggleable), consistent with the reference plugins' patterns; the
  prototype exists precisely to test and iterate on this hypothesis.
- Interactions are limited to navigation, selection, and expansion; editing is
  visual-only.
- The owner is the sole reviewer; the decision is recorded in the review conversation and
  reflected in the spec checklist.
- Positioning: the product replaces the native World Info editor outright (entry point
  re-bound while the plugin is enabled); the md conversion capability is future-facing
  toward external .md-based hubs (e.g., Obsidian) as second hubs — the prototype itself
  remains fully mocked and touches none of that.
- Product scope: the Workspace owns the active-books list (part of the replaced editor
  screen); character/persona/chat bindings stay in their native panels. The prototype
  shows this as an inert mock control.
- Assistant philosophy: batch operations with a single batch confirmation; destructive
  operations always confirmed separately; autonomous/auto-apply modes are out of scope
  until after real-world use.
- Audience: community release via the extension installer. Prototype validation happens
  on the app's default themes; custom community themes are supported dynamically through
  theme variables and corrected post-release as users report issues.
- "Iterate" may loop through additional prototype rounds; each round remains bound by
  SC-004 (cheap turnaround) and the discard option stays open.

## Dependencies

- Completed project initialization and tooling from spec 001 (extension shell loads in
  the app).
- Layout and field knowledge from `specs/001-workspace-plugin-roadmap/`:
  `research.md` (native World Info fields), `data-model.md` (tree entities), and
  `plan.md` (target structure).
- The app's theme variables as the styling source.

## Out of Scope

- Any persistence (workspace state, settings, history).
- Real World Info read/save or sync (including divergence warnings).
- Real AI calls or assistant functionality beyond the scripted mock.
- Markdown import/export beyond inert entry-point visuals.
- Interop events, slash commands, and macros.
- A dedicated mobile-first redesign (the shipped bottom sheets are responsive
  adaptation) and localization.
