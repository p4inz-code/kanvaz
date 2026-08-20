# Kanvaz — Roadmap: v4.3 → v5.0 (final stretch)

*Living doc. Decided jointly (product judgement: user; technical scoping: assistant) — 2026-08-20.*

## Framing

This is the last planned stretch of active feature development on Kanvaz. Three versions, then development stops and the app is considered finished/shipped. Versions 1 and 2 are build/polish; version 3 is a pure finish-line pass — nothing new gets started there, only open threads get closed.

Standing constraint carried through all three: **100% offline core, no accounts, no telemetry.** Any network-touching feature must be a separate opt-in plugin, off by default, disclosed plainly — never baked into core, never silent.

---

## v4.3.0 — Command Palette & Plugin Runtime API

**Goal:** finish the load-bearing layer of the plugin system. Per `PLUGIN_SYSTEM_DRAFT.md`'s own build order, nothing after this works without it.

Ships:
- `registerCommand(id, {label, run, shortcut, showInPalette, contextMenu})`
- Command Palette UI — **Ctrl+K** (not Ctrl+Shift+P; more standard, and unclaimed in Kanvaz today)
- `KanvazPluginAPI.on(event, handler)` — `cardCreate`, `cardUpdate`, `cardDelete`, `boardLoad`, `boardSave`, `selectionChange`
- The Runtime Data API sketched but never shipped: `getCards()`, `getSelected()`, `getConnections()`, `getActiveBoard()` — required by v4.4's MCP Bridge, so it ships here regardless
- Dogfooding: expose Kanvaz's own existing shortcuts as palette commands; Theme Creator (or a new sample plugin) registers at least one real command, proving the API isn't just theoretical

**Done bar:** a plugin can register a command, bind it to a shortcut, and have it appear in the palette. `validate.js` covers command registration. Palette open/close, fuzzy search, and keyboard nav manually smoke-tested.

---

## v4.4.0 — Plugin Ecosystem: Hardening, Distribution & MCP Bridge

**Goal:** close the audit-flagged gaps (permission enforcement, packaging automation) and ship the flagship reference plugin — replacing the original "AI suggest-tags" idea with something better suited to 2026: **Kanvaz becomes agent-controllable via MCP**, not just AI-assisted.

### MCP Bridge (flagship official plugin)
A local MCP server exposing the active board to any MCP-compatible client — Claude Code, Claude Desktop, or any other agent the user already runs. Kanvaz doesn't call out; agents call in, locally.

Candidate tool surface (final shape decided during implementation, not locked here):
- `getActiveBoard()`, `listCards(filters?)`, `getCard(id)`
- `createCard({type, x, y, data})`, `updateCard(id, patch)`, `deleteCard(id)`
- `addReference({path | url})` — creates an image/video/note card from a file or URL
- `tagCard(id, tags)`, `search(query)`
- `getConnections()`, `connectCards(fromId, toId)`

Transport: local server (stdio or localhost HTTP/SSE — decide at implementation time based on how Claude Code vs. Desktop actually discover local MCP servers). No cloud calls originate from Kanvaz itself.

**Non-negotiable guardrails, given an external agent now has write access to real boards:**
- Off by default. Explicit enable in Settings, same consent-dialog pattern as any other plugin permission.
- Every AI-driven change lands in undo history exactly like a manual edit — nothing an agent does is invisible or unreversible.
- Declared-permission enforcement (see below) applies here first and hardest.

### Permission enforcement (the trust-model decision)
Evaluated full per-plugin process isolation vs. scoped sandboxing vs. enforcing the permission model as originally designed. Full isolation is high-effort (multi-week rearchitect, breaks the existing `<script>`-tag plugin convention) against a two-version budget and an ecosystem of one official plugin — not worth it now, logged as deliberate future work in `SECURITY.md`, not a gap.

What ships instead: **the permission model as already specced but never enforced.** `network`/`fs` (and the new server-listening capability MCP Bridge needs) are literally absent from the API object handed to a plugin that didn't declare them — not just unauthorized, not present to call. Low effort, closes the honesty gap between what the consent dialog promises and what's actually true, and matters more now that MCP Bridge exists as a high-permission plugin.

### Distribution
- CI step: zip `official-plugins/*` into a release asset automatically on tag push (audit-flagged, never built)
- "Browse Official Plugins" tab — one deliberate network call, same pattern as Check for Updates, fetches a small catalog JSON, one-click install. Raw GitHub-URL install stays an escape hatch, never the primary flow
- "Load unpacked plugin" dev-mode workflow — cheap, and the thing that actually lowers the barrier for the community to keep extending Kanvaz after development stops

**Done bar:** MCP Bridge works end-to-end against a real MCP client (Claude Code or Desktop) in a manual test. Permission model is enforced, not just documented. Official plugins install without folder-dragging.

---

## v5.0.0 — Finish Line

**Goal:** nothing new starts here. Every open thread gets closed — built or explicitly declined with a reason — and the app is considered done.

- Resolve `V4_PLAN.md`'s deferred backlog: URL card type, color card multi-swatch/palette mode, note markdown preview
- Remaining 2G cross-card polish never finished: card entrance animation, universal card borders/shadow, tag autocomplete
- Fix the known cosmetic gap flagged in the plugin draft: `[data-theme="light"]` hardcoded CSS selectors → luminance-derived, so third-party light themes stop silently inheriting dark-tuned edge cases
- The two deferred `canvas.js` findings from the 4.2.1 audit (viewport clamp at extreme pan, additive zoom-step inconsistency)
- One more full-stack audit, same 6-cluster methodology as 4.2.1 — the actual last checkpoint before calling it shipped
- Plugin scaffold template + written authoring docs, including an MCP Bridge quickstart ("ask Claude Code to add a reference to your board")
- Final version bump, final CHANGELOG "state of the app" entry

**Done bar:** `validate.js` + `format-roundtrip-test.js` clean. Every card type and the palette manually smoke-tested. Zero "defer to v5" language left anywhere in the docs. `SECURITY.md`/`README.md` fully accurate as of the actual final state. No further versions planned after this one.

---

## Not a version, flagged so it doesn't get lost

The website update has been explicitly held off twice this session — release/CHANGELOG work first, website is a separate deliberate joint step. Once v5.0 ships, that's the natural moment to revisit it.
