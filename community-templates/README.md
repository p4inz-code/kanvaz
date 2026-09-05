# Community Templates

This folder is what the **Template Maker & Manager** official plugin's
"Browse community templates" button reads — a small, static catalog, fetched
directly from this repo's `main` branch, no server involved. Same trick
`official-plugins/catalog.json` already uses for "Browse Official Plugins".

## Submitting a template

1. Export your template as a plain JSON file — a card array, the exact shape
   Kanvaz's own save format and the plugin's "Save current board as template"
   button already produce. Put it in this folder, e.g. `my-template.json`.
2. Add one entry to `catalog.json`:

```json
{
  "name": "My Template",
  "description": "One sentence describing what it's for.",
  "author": "Your Name",
  "contentUrl": "https://raw.githubusercontent.com/p4inz-code/kanvaz/main/community-templates/my-template.json"
}
```

3. Open a pull request. That's it — no ongoing maintainer curation loop,
   no account, no upload dashboard. A maintainer reviews the PR like any
   other code change (mainly: does the JSON parse, is the description
   accurate, nothing obviously abusive) and merges it.

## Format

`catalog.json` is a flat array of `{ name, description, author, contentUrl }`
objects. `contentUrl` must point at a **raw.githubusercontent.com** URL in
this repo — Kanvaz's own template-fetch code only allows that host, the same
restriction `official-plugins/catalog.json`'s plugin downloads already have,
so a compromised or careless catalog entry can't redirect a user's client
anywhere else.

Each template file itself is just the card array — open any file you've
saved with Kanvaz's own "Save current board as template" button to see the
exact shape expected (card `type`, content fields like `text`/`dataUrl`/
`color`/`url`, and `x`/`y` position — position is normalized relative to the
template's own top-left corner when it's inserted, so it doesn't matter
whether your original board started at `(0,0)` or somewhere else).

No binary assets (images/video/audio) are supported in a community template
today — `dataUrl` fields would make these JSON files huge, and there's no
CDN behind this catalog to host them. A template built entirely from
note/text/color/url cards works great; a template that depends on embedded
media won't fetch back its media on someone else's machine.
