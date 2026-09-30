# Studio Tier — Plan: paid Hierarchy/Node app + custom-build services

*Drafted 2026-09-30. Two separate initiatives that got raised together — kept apart here on purpose, because they carry very different risk profiles. Neither has started implementation; this doc exists to think it through before any code, matching how AI Export was planned (see `AI_EXPORT_AND_MAP_NOTES_PLAN.md`) before it was built.*

**Ground truth going in (from the same-session honest rating of Kanvaz v9.7.0):** Kanvaz is a free, unsigned, single-maintainer, offline-only app with no collaboration story. Map View already renders cards as a node graph; AI Export already produces a hierarchy export for AI agents. Anything built under this doc has to justify why it isn't redundant with what already ships for free.

---

## Track A — standalone paid Hierarchy/Node app

### What it is, per the user's own framing
A separate app, not a Kanvaz plugin. Scope: node graphs + hierarchy + **studio planning-phase** work — explicitly broader than "Map View, but paid." Industry-grade. Priced $19–40, one-time (no subscription confirmed, no exact number picked yet). Kanvaz keeps its own free Map View/AI Export unchanged — this is additive, not a downgrade of the free app.

### Locked decision (2026-09-30) — what it's for, who it's for, how AI agents plug in

**Purpose.** Not a general reference board (that's Kanvaz). A dedicated **studio pre-production planning tool**: build asset hierarchies, shot/sequence breakdown trees, and task dependency graphs as a node graph, purpose-built for the planning phase — the thing small studios currently do in a spreadsheet, a whiteboard, or a PureRef-style board because ShotGrid/ftrack/Shotgun-class tools are overkill for their size and budget.

**Target audience.** 2–50 person indie VFX, animation, and game-dev studios, plus freelance pipeline supervisors/production coordinators — people who need real hierarchy/dependency structure but can't justify enterprise pipeline software licensing. Not aimed at large studios with an existing ShotGrid/ftrack install — that's a different, much harder sales motion this doesn't need to fight.

**AI-agent integration — the actual differentiator.** Kanvaz's AI Export is a one-shot static export: click a button, get a JSON/Markdown snapshot. That's already free and already good enough for "paste this into a chat." What justifies a separate paid app is going **live**: a local MCP server built into the app core from first launch (not bolted on as an optional plugin, the way Kanvaz's MCP Bridge is) so an AI agent can query and update the hierarchy *during* a planning session — "what's blocking shot 040," "add a dependency from asset X to task Y," "summarize what's left before the animation pass." Static export stays as a fallback/offline path; the MCP server is the headline feature that makes this worth paying for over the free tool.

**Money constraint, taken as a real design input.** "Less money, more usability, not a loss" means: no recurring costs on this app's own books. No hosting, no cloud, no backend service — the MCP server is local-only (stdio, same trust model as Kanvaz's own MCP Bridge), so there's nothing to keep paying for after the sale. One-time price, low end of the $19–40 range the user set (working target: $25), justified by the live-MCP feature rather than by hierarchy-drawing alone (which Map View already gives away free).

### Audit of that decision — user POV
- A studio evaluator will ask "does this replace ShotGrid" within the first minute. Answer has to be "no, and it's not trying to" — positioning must stay explicitly pre-production/planning-phase, not a pipeline-tracking system, or it invites a comparison it will lose.
- "Live MCP server on by default" needs a visible on/off + a clear explanation of what's exposed and to whom (local-only, same machine, no network) — a studio's IT-cautious lead will ask "does this mean any AI agent on my network can touch our production breakdown" and the honest answer (local stdio only, same posture as Kanvaz's MCP Bridge) needs to be stated up front, not discovered by reading source.
- $25 one-time for a tool whose headline feature (MCP server) most buyers won't have an AI-agent workflow ready to plug into yet — real risk that the differentiator is ahead of the market. Mitigate by making the static export path (no AI agent required) fully useful on its own, so the app isn't worthless to someone not yet using agents.

### Audit of that decision — developer POV
- Reuse, don't reinvent: Kanvaz's `mcp-bridge` plugin (v1.5.0, `@modelcontextprotocol/sdk`, stdio transport, tool-per-action pattern) is the proven template for the MCP server here. Building it in-core instead of as a plugin is a structural choice (always-on, not opt-in-install) but the underlying SDK usage and tool-definition pattern should be copied, not redesigned.
- "No recurring cost" is only true if the MCP server stays local/stdio. The moment this app's MCP server accepts remote connections (even "for convenience"), it inherits the exact hosting-liability problem flagged in Track B — keep it local-only by design, not just by default.
- Second Electron app, second release pipeline — reuse the just-hardened Kanvaz CI workflow (title derivation, checksum-filename fix, dual-arch mac build) as the literal starting template rather than rebuilding it from scratch and re-discovering the same bugs.

### The real differentiation question
"All three" was the answer to what makes this different from Map View + AI Export: deep hierarchy features, pipeline/DCC integration, and a studio review/annotation layer. That's three genuinely different products bolted into one scope line, and they don't cost the same to build:

| Direction | What it needs | Relative cost |
|---|---|---|
| Deep hierarchy (nested/collapsible sub-graphs, dependency trees, parent-child rollups) | Pure UI/data-model work, no external deps | Low–medium |
| DCC/pipeline integration (reads real Maya/Houdini/Blender/USD scene graphs) | Per-DCC parsers or plugins, ongoing maintenance as each DCC updates its format | High, and never "done" — a permanent maintenance tax |
| Studio review/annotation layer (supervisor comments on a hierarchy) | Needs *some* multi-user story to be useful (a solo artist doesn't "review" their own hierarchy) — collides with the zero-collaboration gap from the honest rating | Medium, but blocked on Track B's identity/access thinking below |

**Recommendation:** don't try to ship all three in v1. Ship **deep hierarchy** first — it's the part that's self-contained, doesn't need external DCC format maintenance, and doesn't need a login/multi-user system to be useful solo. DCC integration and the review layer are both real v2/v3 directions, not v1 scope, and both should get their own audit before committing (DCC integration in particular is an ongoing maintenance commitment, not a one-time build).

### Locked decisions
- Separate app, separate binary, separate install — not a Kanvaz plugin.
- Kanvaz's own Map View/AI Export are unaffected and stay free.
- One-time paid, ceiling $40, floor not below what covers real maintenance (see pricing note below) — exact price still open.
- Same "Northbyte Studios" branding umbrella as Kanvaz, own product name still open.

### Open questions (need a decision before scoping v1 further)
1. **Product name** — needs to read as its own thing, not "Kanvaz Pro," to avoid exactly the cannibalization confusion flagged earlier.
2. **v1 scope** — confirm "deep hierarchy only" for v1, or push back if DCC/review-layer is the actual priority.
3. **Data source for v1** — does it import Kanvaz `.kanvaz` files (reuse existing parser, fastest path to a working v1), or is it meant to stand fully independent of Kanvaz? Reusing the Kanvaz format is the cheap path and doesn't require the two apps to interoperate at runtime.
4. **License/anti-piracy** — a $19–40 one-time desktop app with no account system is trivially shareable. Decide now whether that's accepted as a cost of doing business (same posture as Kanvaz itself — "not signed, not DRM'd, that's fine") or whether some lightweight license-key check is wanted. This should be decided once, not discovered after complaints.

### Audit — user POV (a studio evaluating this app)
- Will ask "why is this not just Map View" within the first five minutes — v1 needs an answer that's obvious from using it, not from marketing copy.
- Will ask about DCC integration immediately if pitched as "studio planning phase" — planning phase in a real studio means Maya/Houdini/ShotGrid-adjacent, not a green-field node canvas. If v1 ships without any DCC awareness, be upfront in positioning that this is "phase 1: standalone planning tool," not "phase 1: pipeline tool."
- Will ask what happens on refund/multi-seat — one-time $19–40 apps still get "we bought one for the studio, can everyone use it" requests informally. Decide the seat policy before selling, even if it's simple ("per-machine, buy more for more machines").

### Audit — developer POV
- Reusing the Kanvaz `.kanvaz` parser for v1 import is the single biggest scope-reduction available — don't rebuild file I/O from scratch.
- A second Electron app doubles the release-pipeline surface area that was *just* hardened for Kanvaz this session (CI title derivation, checksum-filename fix, dual-arch mac builds). Reuse that CI workflow as a template rather than hand-rolling a new one — the bugs already found and fixed there will otherwise recur independently in a second repo.
- If "studio review/annotation layer" ever gets built, it needs *some* identity/access system to mean anything (a review needs to know who's reviewing) — that's the same primitive Track B's "studio pass system" needs. Don't build two different auth systems for two different products; if both ever need identity, design it once.

---

## Track B — custom builds for hire (services business)

### What it is, per the user's own framing
Studios or individuals commission custom builds — could be a modified Kanvaz, could be something else entirely, could include a studio user/pass system restricting access to that studio's own users, could include a cloud-hosted version. Priced per engagement based on scope. Fully bespoke, no fixed catalog yet.

### The honest risk flag (the one that actually matters here)
Everything about Kanvaz's current design — offline-only, no accounts, no telemetry, nothing leaves the machine — is a deliberate trust boundary and a real selling point (see `SECURITY.md`, the "100% offline" badge on the README). **The moment a custom build adds hosting + a login/pass system gating studio users, that boundary is gone for that build.** At that point the offering isn't "a modified app," it's "hosting infrastructure holding a client's confidential production references, with a login system I built and operate." That's a different category of liability entirely — a breach, an outage during a client deadline, or a support gap isn't a bad review, it's a contract dispute with a paying studio over their own confidential assets.

This isn't a reason not to offer it — it's a reason to **not start with the cloud-hosted version**, and to have the boring paperwork in place before taking money for any hosted engagement:
1. **A written scope-of-work per engagement** — what's built, what's excluded, timeline, what "done" means. Solves the "depending on what/why/how/which features" pricing vagueness by forcing scope to be written down before a price is quoted, not guessed at.
2. **A basic services contract / ToS** for anything involving hosting or a client's data — even a short one. Uptime is not promised beyond best-effort unless explicitly priced for; data-handling responsibilities are stated; liability is capped. This exists specifically to protect against the failure mode above.
3. **Decide hosting scope up front**: self-hosting the client's own server (you build it, they run it — no ongoing liability for you) versus you-hosted (you run it — ongoing liability, ongoing cost, needs uptime/backup planning). These are very different offerings and should probably be priced and positioned as different tiers, not one blurry "cloud-based Kanvaz" line.

### Recommended sequencing
1. **White-label / custom feature builds, delivered as a binary the studio runs themselves** — no hosting, no login system, no ongoing liability. This is the same offline-first model Kanvaz already trusts, just customized per client. Start here — it's the version of this business with the least risk and the most reuse of what already exists.
2. **Studio pass/user system, still self-hosted by the studio** (e.g. a license file or local user list they manage, not a server you run) — adds access control without adding hosting liability.
3. **Actually-cloud-hosted builds** — only after 1 and 2 have real engagements under them, and only with the contract/ToS groundwork above in place first. This is the highest-liability, highest-effort tier and should be priced accordingly (recurring, not one-time — hosting has recurring cost, so recurring revenue is the only model that makes sense here).

### Open questions
1. Rate card or day-rate baseline, even a rough internal one, so quotes aren't reinvented from zero each time.
2. Whether Track A's app becomes something custom-build clients can also license/white-label, or stays a separate shrink-wrapped product — worth deciding once both exist, not now.

---

## What ships in what order

1. Nothing yet — this doc is the plan, not a commitment to start.
2. If Track A proceeds: scope v1 to "deep hierarchy only," reusing the `.kanvaz` parser, reusing the just-hardened Kanvaz CI workflow as a template.
3. If Track B proceeds: start with self-hosted white-label/custom-feature builds only. Do not take on a hosted/cloud engagement before a scope-of-work template and a basic services contract exist.
4. Revisit "studio review layer" (Track A) and "studio pass system" (Track B) together later, since they likely want the same identity primitive — don't build it twice.
