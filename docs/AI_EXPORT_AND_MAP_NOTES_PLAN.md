# AI-Agent Export Plan (plan only, not implemented — decisions locked, ready to build)

One feature, correctly scoped after a round of clarification: a way to
export a `.kanvaz` file's full hierarchy — every board, card,
connection, and each card's own notes/annotation text — in a form
**any** AI agent can read, entirely offline, with **no MCP server
connection required**. This is not a second feature bolted onto Map
View; the "notes must be visible" requirement is a requirement on the
*export's content*, not on the live Map View UI. Map View itself is
untouched by this plan.

## Ground truth first (audited against the real code, not assumed)

- The `.kanvaz` save format (`boards.js:serialise()`) already has the
  whole hierarchy: `{ version, boards[], sharedCards, connections[],
  tasks[] }`, each board holding its own `cards[]`. It is **not**
  agent-friendly as-is: every image/video/GIF/audio/3D card embeds its
  full `dataUrl` inline — a single board with a dozen reference images
  can be tens of megabytes of base64 that no LLM should ever have
  stuffed into its context.
- `KanvazPluginAPI.getCards()` / `getConnections()` (the same Runtime
  Data API MCP Bridge already uses) return the **active board only**,
  already cleaned card objects, no engine internals leaking through.
  Multi-board isn't native to that API, but `KanvazBoards.switchBoardById`
  and `listBoards` are both exposed, so a plugin can walk every board
  and collect the same data — no new core hook is required for any of
  this.
- "A card's notes" is two distinct kinds of content in the real code,
  and the export needs to pull from **both**, merged into one field:
  - A **Note-type card**'s own `card.text` (its whole reason to exist)
  - **Annotate-tool text labels** (`annotate.js`'s `drawText`) — small
    callouts drawn *on top of* an image/video/3D card, stored in that
    card's own `annotations[]` array, unrelated to the Note card type
  - *Not* in scope: Task Tracker entries linked to a card (`cardLink`)
    — those live in a completely separate file-level list, not on the
    card at all, and stay out of this export.

## Decisions (locked)

| Decision | Outcome |
|---|---|
| Export format | **JSON + a Markdown digest**, both produced from the same underlying data — the JSON is the machine-parseable contract, the Markdown is what a human pastes straight into any chat UI with zero setup |
| Embedded media | **Metadata only** — type, name, tags, dimensions, custom properties, and now the merged notes text. No pixels, no dataUrls. Keeps the export small and reliably pasteable into any agent's context window |
| Where a card's notes come from | **Merged**: Note-card `text` + every Annotate-tool text-label on that card, combined into one `notes[]` array per card |
| Ships as | **A new official plugin** — its own install, its own version, its own release cadence, matching the existing Theme Creator / Template Maker / MCP Bridge pattern exactly |

## Schema (JSON)

```json
{
  "kanvazExportVersion": 1,
  "exportedAt": "2026-09-30T12:00:00.000Z",
  "sourceApp": { "name": "Kanvaz", "version": "9.6.0" },
  "boards": [
    {
      "id": "board-...", "name": "Filmmaking",
      "cards": [
        {
          "id": "card-...", "type": "image", "name": "Hero shot ref",
          "tags": ["lighting", "mood"],
          "notes": ["warm key, 45° camera left", "matches the palette card"],
          "customProperties": { "artist": "...", "source": "..." },
          "media": { "kind": "image" }
        }
      ],
      "connections": [
        { "from": "card-...", "to": "card-...", "type": "RelatedTo" }
      ]
    }
  ],
  "sharedCards": [ "...same content registry, minus embedded media..." ],
  "tasks": [ "...file-level task list, unchanged shape..." ]
}
```

`notes[]` is always present (empty array if the card has neither a
Note-card body nor any text annotations) — an agent should never have
to guess whether the field's absence means "no notes" or "not
extracted yet."

This is a genuinely **new, separate schema** from the `.kanvaz` save
format — not a stripped copy passed through a filter at save time. It
carries its own version counter (`kanvazExportVersion`), decoupled
from the app's own version, with a stated compatibility policy
(additive changes bump the minor version; anything that removes or
renames a field bumps the major version) — because unlike the save
format, this one is a public contract the moment it leaves the app.

## Markdown digest (sketch)

Generated from the same walked data, not a second pass over the
board:

```
# Filmmaking

## Hero shot ref (image)
Tags: lighting, mood
Notes:
- warm key, 45° camera left
- matches the palette card
Connects to: Palette (Related To)
```

## Where it lives: plugin, not core

Everything this needs — reading every board's cards/connections,
walking shared-card content, reading tasks, merging note/annotation
text, writing a file via a save dialog — is already reachable through
the existing public `KanvazPluginAPI`, the same surface MCP Bridge
already builds on. No core engine change is required.

- A new official plugin — working name **"AI Export"** — with a single
  Settings-panel action ("Export board(s) for an AI agent…") producing
  both the `.json` and the `.md` file in one go.
- If MCP Bridge is *also* installed, a thin `exportForAI` MCP tool can
  wrap the same export function so an already-connected agent can
  request it live — additive, built last, and MCP Bridge is not a
  dependency of AI Export either direction.
- Zero new permissions needed beyond what Template Maker already uses
  (Runtime Data API + a save-file dialog) — not gated the way MCP
  Bridge's `server` permission is, since it never opens a network
  listener.
- Keeps this out of the base install's footprint and release cadence
  entirely, matching "off the critical path unless you want it" — the
  same reasoning already applied to every other official plugin.

## Audit — user POV

Read as a first-time user who just clicked "Export for AI agent,"
not as the person who designed it:

- **The original "always export everything" default was wrong.** A
  real multi-board portfolio file (the exact kind of file this feature
  exists for) could produce a huge export the moment someone with 8
  boards clicks the button once, with no way to scope it down. Fixed
  below — scope is now a real, required choice, current-board first.
- **Silence about size is a trap.** Even metadata-only, a board with
  200 tagged, noted cards produces a JSON/Markdown pair that's too
  large to comfortably paste into a chat window. The export needs to
  say its own size back to the user before they go paste it somewhere,
  not let them discover the limit by having a paste silently truncate.
- **"Notes" needs to earn its keep on boards that have none.** Most
  cards on most boards will have an empty `notes[]` — the Markdown
  digest must not print a dangling "Notes:" heading with nothing under
  it for every single card; that's noise an agent (and a human
  skimming it) has to visually filter out on every card, every time.
- **Where does the button even live?** Nowhere yet — the plan
  described the schema in detail but never located the entry point.
  Fixed below.
- **Trust**: nothing here should read as ambiguous about staying
  local. The export dialog/panel needs its own one-line disclosure
  (same posture as MCP Bridge's own "off by default, every change
  lands in undo history" line) — something like "written to a file on
  this machine; Kanvaz never sends it anywhere."

## Audit — developer POV

Read as the person who has to build, ship, and then maintain this
without the whole plan in their head:

- **"No core change required" was incomplete — corrected.** Reading
  through the real plugin API, there is no generic "save this text to
  a file" hook exposed to plugins today — every existing export
  (`exportTemplateFile`, `exportImageSave`) is a **narrow, single-
  purpose** IPC handler + save dialog, one per feature. AI Export
  needs exactly the same treatment: one new, narrow main-process
  handler (`ai-export-save-file`, mirroring `templates-export-file`'s
  existing shape in `main.js`/`preload.js`) that takes a JSON string
  and a Markdown string, shows one save dialog, and writes both files
  as siblings. This is a small, disclosed, single-purpose core
  addition — not a generic filesystem-access permission, and not a
  reason to reconsider the plugin-not-core call for everything else.
- **Two formatters drifting apart is the most likely long-term bug.**
  The JSON serializer and the Markdown serializer must both read from
  one walked-and-normalized in-memory tree, built once — never two
  independent walks of `getCards()`/`getConnections()`/etc. that
  happen to agree today and quietly diverge the first time someone
  edits only one of them.
- **Future card types must degrade, not break.** Kanvaz has added new
  card types before (3D models shipped after the original type set,
  and more than one earlier module — `map-view-utils.js`,
  `reference-types.js` — had a real bug where a new type fell through
  a stale switch/map to a default case). The export's per-card-type
  handling must have an explicit fallback branch (name/type/tags/notes
  only, `media: { kind: type }`) for any type it doesn't specifically
  know about, so a future card type exports as "generic but present,"
  never a crash or a silently dropped card.
- **A stale shared-card reference must not abort the whole export.**
  `sharedCards` entries can already be pruned when unused
  (`pruneUnusedSharedCards`); a board instance pointing at a since-
  removed shared ID needs a defined, tested fallback (skip that card
  with a `"error": "shared content unavailable"` marker) rather than
  the walk throwing partway through a multi-board export.
- **Notes need a source tag, not a flat string list.** `notes:
  ["text", "text"]` throws away exactly the distinction an agent might
  actually want (a deliberate Note-card body vs. an in-context
  callout scribbled on an image). Changed below to
  `notes: [{ text, source: "note" | "annotation" }]` — a one-time
  schema decision that's far cheaper to make now than as a breaking
  v2 change later.
- **This needs a real automated test**, same standard as MCP Bridge's
  `test/mcp-bridge-e2e-test.mjs` — construct a real multi-board file
  in memory (including a future-unknown card type, a stale shared-card
  reference, and a card with both a Note body and an annotation label)
  and assert the JSON/Markdown output handles every one of those
  cases correctly, not just the happy path.
- **Export filenames must not silently overwrite.** `kanvaz-ai-export`
  with no timestamp means a second export today clobbers the first
  with only the save dialog's own overwrite prompt as a safety net.
  Default filename includes the export timestamp.

## Plan changes from this audit

- **Scope is now a real, required choice** at export time: *this
  board* (default) or *every board in this file* — not an unscoped
  "always everything."
- **`notes[]` is now `notes: [{ text, source }]`**, `source` one of
  `"note"` (a Note-card's own body) or `"annotation"` (an Annotate-
  tool text label) — see the schema below.
- **The Markdown digest omits an empty Notes section entirely** for a
  card with no notes, instead of printing a heading with nothing
  under it.
- **The export result reports its own size** (bytes, card count) back
  to the user in the confirmation toast, so "this might be too big to
  paste" is visible immediately, not discovered later.
- **Entry point, decided**: Settings → the AI Export plugin's own
  panel — a scope selector (This board / All boards) and one "Export
  for AI agent…" button, mirroring Template Maker's own panel layout.
- **A one-line local-only disclosure** in that panel, matching MCP
  Bridge's own disclosure convention.
- **A new, narrow main-process IPC handler** (`ai-export-save-file`)
  is part of this plan after all — mirroring `templates-export-file`
  exactly, not a generic file-write capability.
- **Every card type gets an explicit fallback branch** in the walker,
  so a type the export doesn't specifically know about still exports
  as a minimal, present, valid entry.
- **A stale/missing shared-card reference degrades to an `error`
  marker on that one card**, never aborts the export.
- **Default export filename carries a timestamp.**

## Updated schema (JSON)

```json
{
  "kanvazExportVersion": 1,
  "exportedAt": "2026-09-30T12:00:00.000Z",
  "sourceApp": { "name": "Kanvaz", "version": "9.6.0" },
  "scope": "board",
  "boards": [
    {
      "id": "board-...", "name": "Filmmaking",
      "cards": [
        {
          "id": "card-...", "type": "image", "name": "Hero shot ref",
          "tags": ["lighting", "mood"],
          "notes": [
            { "text": "warm key, 45° camera left", "source": "annotation" }
          ],
          "customProperties": { "artist": "...", "source": "..." },
          "media": { "kind": "image" }
        }
      ],
      "connections": [
        { "from": "card-...", "to": "card-...", "type": "RelatedTo" }
      ]
    }
  ],
  "sharedCards": [ "...same content registry, minus embedded media..." ],
  "tasks": [ "...file-level task list, unchanged shape..." ]
}
```

`notes` is always present (`[]` if none) — an agent should never have
to guess whether an absent field means "no notes" or "not extracted."
An unrecognized future card type still produces a full entry:
`{ id, type: "<the unknown type>", name, tags, notes, customProperties,
media: { kind: "<the unknown type>" } }` — nothing about it is
dropped, it just carries no type-specific fields Kanvaz doesn't
already know how to fill in.

## What ships in what order

1. The `notesForCard(card)` merge helper (Note-card text + Annotate-
   tool text labels, each tagged with its `source`) — small, testable
   in isolation against a real board before anything else is built on
   top of it.
2. The `ai-export-save-file` main-process handler + preload +
   `KanvazPluginAPI.exportAIData` — the narrow core addition this plan
   now explicitly includes, mirrored from `templates-export-file`.
3. The AI Export plugin: walk the chosen scope into one normalized
   tree, format it to JSON and Markdown from that same tree, one
   Settings-panel action (scope selector + button) that writes both
   files and reports size back to the user.
4. The automated test (multi-board, future-unknown type, stale shared
   card, mixed note sources) — before this is considered done, not
   after.
5. `exportForAI` MCP Bridge tool, only if MCP Bridge is installed —
   thin wrapper around the same walk+format functions, last, since
   it's additive and has no users until the export itself exists.
