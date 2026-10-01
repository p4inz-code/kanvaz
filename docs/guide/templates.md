---
title: "Templates"
layout: default
---

# Templates

*Verified against Kanvaz v9.7.0.*

Three ways to start from an existing layout instead of a blank board:
built-in templates, your own saved templates, and community templates
— the last two both via the official **Template Maker** plugin.

## Built-in templates

14 curated starter boards, reachable from the Home Screen's **Start
from a template** row or **Browse all**:

Filmmaking · Game Art · Mood Board · VFX — Beginner ·
VFX — Intermediate · VFX — Professional Pipeline ·
Game Dev — Concept to Production · Music Production ·
Animation Pipeline (2D/3D) · Photography / Concept Art Reference ·
Architecture & Product Design · UI/UX Design Reference ·
Branding & Identity · Character Design

Each ships with real starter cards laid out for that discipline — not
just an empty grid with a label.

## Your own templates (Template Maker plugin)

The official **Template Maker** plugin (see [Plugins](plugins.md) for
installing it) adds a Settings panel with:

| Action | What it does |
|---|---|
| **Save current board as template** | Snapshots every card on the current board into a named, locally-stored template |
| **My templates → Insert** | Adds a saved template's cards onto the current board, offset so repeated inserts don't stack |
| **My templates → Export…** | Saves a template as a portable `.kanvaztemplate` file to hand to someone else |
| **My templates → Rename / Delete** | Inline rename (no native dialog), delete with confirmation |
| **Import Template…** | Loads a `.kanvaztemplate` file someone sent you |

Templates are stored as plain JSON — the same card-array shape the
plugin's own `getCards()` API returns, so there's no invented file
format to reverse-engineer.

## Community templates

The same panel's **Browse** button fetches a catalog from Kanvaz's own
GitHub repository (`community-templates/`) — the only network call
this plugin ever makes, and only when you explicitly click it.
Installing one both inserts it immediately and saves a local copy, so
reusing it later never needs the network again.

## Related

- [Plugins](plugins.md) — installing/enabling Template Maker
- [Import & Export](import-export.md) — other ways media gets onto a board
