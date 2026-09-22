# Changelog

All notable changes to Kanvaz are documented here.

## [9.3.0] — 2026-09-23 — OBJ material support, HDR/EXR previews, more recognized formats

*Verified with real, spec-built test files (not just synthetic fixtures) run
through the actual decoders: an OBJ+MTL round-tripped through the real
Three.js MTLLoader and rendered red as specified (screenshot-verified before
this session's later work went static-only), and Radiance HDR / OpenEXR
files built from the public file-format specs decode back to their source
pixel values within expected quantization error (`test/hdr-preview-test.js`).
The renderer-side preview UI for HDR/EXR (the actual `<img>`/worker-thread/
IPC wiring, `src/hdr-worker.js` → `hdr-preview` IPC → `buildHdrPreview`) is
unit-tested at the decode layer and consistency-checked end to end (every
IPC channel name, function export and CSS class cross-referenced statically)
but not yet live-screenshotted — flagged honestly rather than claimed done;
first thing to confirm next session.*

### Added
- **`.obj` files now respect a companion `.mtl`** — diffuse/specular/
  ambient colour, opacity and shininess (not texture maps referenced by
  the `.mtl`, for the same reason external FBX textures already aren't
  loaded — see Known limitations). `main.js`'s `findCompanionMtl` reads
  the real `mtllib` reference from the `.obj` text (falling back to a
  same-basename guess), embeds it as text alongside the model the same
  way the model itself is embedded, and `MTLLoader` (newly vendored,
  Three.js r186, same local-only network guard as every other loader)
  builds the materials before the `.obj` is parsed.
- **HDR/EXR previews**: Radiance `.hdr`/`.pic` and OpenEXR `.exr` files
  now show a real in-card preview — decoded, auto-exposed and tone-mapped
  (Reinhard) down to a normal image, the same "reference thumbnail, not a
  colour-managed viewer" honesty as everywhere else previews are built
  from scratch in this app. OpenEXR support covers uncompressed and
  RLE-compressed files; ZIP/PIZ/PXR24/B44/DWA-compressed EXRs are refused
  with a specific, honest reason naming the compression method, not a
  silent misread — PIZ alone is roughly a thousand lines of wavelet+
  Huffman decoding in Three.js's own EXRLoader, more risk than this round
  was worth taking on blind. Same Low/Medium/High quality control and
  per-card override as PDF/Adobe previews already have.
- **Four more recognized-but-unsupported formats**: ZBrush (`.ztl`),
  Houdini (`.hip`/`.hipnc`), Cinema 4D (`.c4d`) and Maya (`.ma`/`.mb`) now
  get "Open with Kanvaz" from the OS and a real file-type label/icon
  instead of a generic unknown-file badge — none of the four have a
  command-line export path the way Blender does, so there's no route to
  an actual preview yet, but a VFX/game pipeline lives among these
  formats daily and "recognized, opens with the default app" beats
  pretending Kanvaz doesn't know what they are.

### Fixed
- Two "second whitelist" bugs from 9.2.0's preview-quality work:
  `buildFullCardRecord()` (board save) and `createFromMedia()` (card
  creation) both needed `previewQuality` added — a card's per-card
  quality override was being silently dropped on save, and read as
  never-set on every fresh creation, because adding a new card field to
  only ONE of the several places card fields are whitelisted isn't
  enough. Same bug pattern, caught a third time while building `.mtl`
  support and building the habit of checking every copy site, not just
  the first one found: `relinkCard()` (Properties → Relink) also has its
  own independent field-copy list and was missing `mtlText` — relinking
  an `.obj` card to a different file kept rendering the *previous*
  file's material until this was added.
- `findCompanionMtl()` now stats a candidate `.mtl` before reading it
  (a same-named or `mtllib`-referenced file that happened to be huge —
  plausible in a downloaded asset pack — would otherwise be fully read
  into memory before its size was ever checked), strips a UTF-8 BOM some
  Windows exporters write, and rejects a colon in the referenced name
  (blocks an NTFS alternate-data-stream reference, closing the same class
  of gap `openable-types.js`'s own ADS check exists for).
- A genuine bug in `src/hdr-preview.js`'s own EXR RLE codec, caught by
  its own test suite before ever shipping: the byte-deinterleave step
  used `length >> 1` (floor) to split reordered bytes back in half, which
  is wrong for an odd-length buffer (OpenEXR's real per-scanline byte
  counts are always even — every sample is 2 or 4 bytes — so no real file
  would have hit this, but the function is still correct now for any
  input, not just the common case).

### Tests
- `test/hdr-preview-test.js`: builds real, spec-valid HDR (RLE-encoded)
  and EXR (NONE and RLE compression, channels deliberately written
  out-of-order to prove the reader sorts them) files from scratch and
  round-trips them through the real decoder; verifies an unsupported EXR
  compression is refused with a specific reason; stress-tests the EXR RLE
  codec against 0–4096-byte random buffers including every odd length;
  checks tone-mapping stays in valid 8-bit range (including an all-black
  input, which used to be a plausible divide-by-zero) and that downscale
  respects its max side without upscaling a smaller image.

## [9.2.0] — 2026-09-23 — Preview quality gates, Blender picker in Settings

*Checked against the running app (Electron scratch profile): built every card
type, toggled the global setting live (High's warning toast fires, an
already-open 3D card re-renders at the new pixel-ratio cap immediately), set
a per-card override on a 3D, a PDF and a PSD card from Properties, and
confirmed a real local Blender install is found and shown in the new
Settings row.*

### Added
- **Preview quality: Low / Medium / High**, in Settings → Preview Quality.
  Caps the 3D renderer's pixel ratio, the PDF preview canvas's DPI, and the
  decoded size of a PSD/PSB/etc. preview. Default is **Low** — a deliberate,
  conservative default, since (unlike every other setting in this list) this
  one trades sharpness for real GPU/CPU cost on a board with several heavy
  cards; High shows a specific, friendly warning ("may run slower or get
  warm on a laptop") instead of a bare toggle. Changing it live re-renders
  every already-open 3D and PDF card immediately — no reload needed.
- **Per-card override**, in Properties → "Preview quality" (3D, PDF and
  Adobe-file cards): the one heavy model or scan that needs to look sharper
  (or lighter) than the rest of the board, without changing the global
  default. `src/preview-quality.js` is the single source of truth for the
  actual numbers, shared by main.js (the Adobe-preview worker), cards.js
  (3D/PDF) and Properties, and is unit tested directly.
- **A Blender row in Settings** ("Blender (.blend preview)"): shows what
  Kanvaz found (or didn't) with its version, a **Choose…** button to point
  at a specific Blender install, and **Auto-detect** to forget that choice
  and go back to searching PATH/the registry/standard locations. The
  detection and persisted-choice logic already existed (`src/blender-
  detect.js`, `main.js`'s `blender-status`/`blender-choose`/`blender-clear`
  IPC) — this is the first UI that actually calls it.

### Fixed
- Merged in a same-day fix from a separate session: `doc.destroy is not a
  function` on PDF/AI-preview cards after a delete-while-loading followed
  by undo (a per-card-id generation counter now refuses to let a
  superseded load register its document).

Co-authored with a background session's fix cherry-picked in as `6bbcf72`.

## [9.1.0] — 2026-09-23 — 13 render modes, Kanvaz Link, Adobe previews, Open With, auto-update UX

*Checked against the running app (Electron 44 dev run, scratch profile) with a
real `.blend` and every card type built for the purpose, over two sessions.*

### Added (2026-09-22/23)
- **13 render modes** (up from 6): Clay, Wire on Shaded, Normal Map, UV Grid,
  Roughness, Metalness and Occlusion joined Shaded/Normals/Matcap/Wireframe/
  Albedo/Alpha, grouped (Shading/Topology/Surface/Texture) in one picker with
  unavailable modes greyed and reasoned ("no UV map", "no roughness texture").
  Camera view presets (front/back/left/right/top/bottom) and a turntable
  toggle live in the same picker.
- **"Open with Kanvaz" from the OS** for every previewable type — Explorer's
  right-click "Open with", macOS Finder, Linux file managers — not just
  `.kanvaz` boards. `src/openable-types.js` is the single list every part of
  this shares; `src/platform.js` gives Mac and Linux their own correct
  shortcut wording (Apple notation on macOS) instead of Windows-only labels.
- **Blender auto-detection** now checks the Windows registry, PATH, package
  managers and every drive, not just `C:\Program Files\Blender Foundation`;
  a manually-chosen Blender install is remembered across restarts.
- Shader-compile-error fallback and WebGL context-loss recovery for 3D cards
  (a crashed GPU driver used to leave the card permanently blank).
- `tools/release-notes.js` fills a GitHub release's body from its matching
  `CHANGELOG.md` section — used to patch v8.8.5, the one release out of 65
  that actually shipped with an empty body.

### Fixed (2026-09-22/23) — "Check for updates" was slow and confusing
- The click used to fire two independent checks: a real `electron-updater`
  one, and a second raw GitHub-API fetch that answered fast. Nothing
  listened for `electron-updater`'s own "checking"/"not available" events
  and the real check had no timeout — the fast path would already say
  "you're up to date," the user would move on, and the slow path could pop
  an "Update available" dialog out of nowhere up to a minute later, or hang
  silently. Now there is one path: every outcome is forwarded over IPC, a
  15-second ceiling guarantees one of them always fires, and the manual
  fetch is gone.
- **Mac/Windows parity:** the unsigned macOS build (no Apple Developer ID
  yet) and the portable Windows `.exe` both get the same fast, honest
  fallback — a direct link to the release page — instead of a check that
  could only error or hang trying to auto-install where there's nothing to
  replace.

### Fixed (2026-09-22/23) — installer no longer hijacks Windows file defaults
- `electron-builder`'s NSIS target ignores `role`/`rank` entirely (its own
  docs call both macOS-only) and unconditionally sets every listed
  extension's Windows *default* handler. Every previewable type — PNG, JPG,
  MP4, MP3, PDF, PSD, GLB, `.blend`, etc. — was in that shared list, so
  installing Kanvaz silently took over the default photo/video/audio/PDF
  viewer from whatever the user already had, on every install. Only
  `.kanvaz` (which really should be Kanvaz's own) is in `fileAssociations`
  now; every other type is registered per platform in ways that cannot set
  a default — macOS via its own `CFBundleDocumentTypes` (a real
  `LSHandlerRank: Alternate` guarantee there), Windows via a generated NSIS
  include (`build/installer.nsh`, from `tools/gen-nsis-associations.js`)
  that only adds Kanvaz to `OpenWithProgids`. Linux was already independent
  and never set a default.
- Alternate-data-stream paths (`photo.png:payload.exe`) passed as a launch
  argument are now refused, matching the same check the Kanvaz Link file
  reader already had.
- A launch argument ending in `.kanvaz` used to open even as part of a flag
  (`--something=x.kanvaz`) — the `.kanvaz`-specific argv path lacked the
  same "skip anything starting with `-`" guard `openable-types.js`'s own
  filter already had.
- macOS: all windows can close while Kanvaz keeps running; a Finder "Open
  With" that arrived with none open queued the file, but clicking the dock
  icon to reopen never delivered the queue — the new window opened with
  nothing in it. Reactivating now drains it.
- `.blend` → `.glb` conversion now runs one at a time instead of spawning a
  full Blender process per concurrent request; every failure path (not just
  the oversize case) now deletes its partial output instead of leaking a
  temp file; a conversion still running when Kanvaz quits is killed instead
  of orphaned.

### Fixed (2026-09-22/23) — Kanvaz Link hardening
- An unauthenticated connection is now dropped after a fixed timeout
  instead of being able to hold a connection slot indefinitely.
- Client names are Unicode-normalised and case-folded before being used as
  a consent key, so whitespace, control characters, bidi overrides and
  case variants of an already-denied name can't slip back in as "new."
- Consent is kept in null-prototype maps — a program naming itself
  `__proto__` or `constructor` is just an ordinary string key now, never a
  write through the prototype chain.
- The remembered consent list is now trimmed while the app is running, not
  only when its file is loaded — a flood of distinct client names can no
  longer push it past its cap.
- Two overlapping `start()` calls (e.g. a double-fired init path) can no
  longer split the listener's token from the listener that's actually
  running.

### Added (2026-09-21/22, same arc as the [Unreleased] work below)
- **Adobe previews in file cards** (`src/adobe-preview.js`): PSD/PSB show
  the full flattened image decoded straight from the file; AI files that
  are PDF-compatible use the PDF viewer; XD shows its largest rendition;
  InDesign its embedded thumbnail; Fresco explains it can't be previewed
  locally. Decoding runs on a worker thread so a large file never blocks
  the UI.
- **Kanvaz Link connector** (the Kanvaz side of the not-yet-built Blender
  add-on): a local listener (named pipe / Unix socket, no network), a
  per-start token, a native permission prompt the first time a program
  asks (default: don't allow), a private drop folder, the renderer never
  receiving a file path.
- **Render modes are a registry** (`src/model3d-modes.js`), module-private
  bookkeeping via `WeakMap`/`WeakSet` rather than `node.userData` (a
  hostile glTF's `extras` could otherwise forge helper/material state
  through `userData`), source materials shared across meshes that reuse
  one material, the UV-grid checker texture shared across every 3D card.
- Animation clip picker, read-only model statistics (triangles, vertices,
  meshes, materials, textures, size) in Properties.
- **Shift+L** opens and closes the Layers panel.

### Fixed (2026-09-21/22)
- Camera near/far clip planes now refit to the model's actual size on
  restore and on every view preset — a saved or preset camera used to keep
  a fixed 0.01–1000 range, clipping a large model away entirely or a tiny
  one down to a speck.
- The camera position is now saved on "Reset view", a view preset, and
  when the turntable stops — previously only a manual orbit/pan/zoom saved it.
- Turntable rotation is now delta-based (same speed at 60 Hz and 144 Hz);
  the Properties panel's turntable checkbox now follows if a drag
  interrupts it.
- Alpha mode now renders solid white for an opaque material instead of
  black — an OPAQUE material's texture alpha is ignored by the real
  renderer too, so the view matched what was rendered, not what the raw
  channel data said.
- The 3D card's popup menu (render mode / camera view) now closes when the
  card is deleted or disposed, instead of staying open pointing at nothing.
- 3D card teardown no longer disposes materials/textures shared with other
  cards (the UV-grid checker, the wireframe occluder), and now calls
  `forceContextLoss()` so a closed card's GPU context is freed immediately
  rather than waiting on garbage collection — a page can hold roughly 16
  live WebGL contexts before new ones start failing.
- The animation play bar no longer overlaps the viewport or the card name
  (moved into the hover strip below the card).
- Wireframe is unlit and colour-true instead of a lit copy of the material
  (lines used to render white or black regardless of the model's colour).
- Colour card contrast chips show the real WCAG ratio of white/black text
  on that colour instead of two unlabelled samples.
- PDF preview fits the page to the card width and draws at the screen's
  pixel density (was 1 CSS pixel per PDF point, top-left corner only).
- File cards with a preview: "Open with default app" / "Change file" are
  now reachable (were hidden under the card's name bar).
- The 3D hover strip is no longer clipped by the card's own overflow.
- Matcap keeps colour, opacity, texture and double-sidedness (used to
  rebuild every material from scratch, losing all of it).
- `.blend` preview no longer exports hidden objects or other scenes; an
  export over the size limit retries once with WebP textures.
- Properties panel refreshes after undo/redo and once a 3D viewer finishes
  loading.
- A note/text card's edit-then-click-away no longer adds a no-op undo step.
- Map View connection labels no longer overlap when several connections
  share a pair of cards.
- Tag editor: focus stays in the "+ tag" box after Enter; a comma list adds
  several tags at once; long tags truncate with a tooltip.

### Tests
- `test/model3d-modes-test.js`, `test/auto-update-support-test.js`,
  `test/platform-test.js`, `test/blender-export-test.js` run against the
  real vendored Three.js / real Blender (skipped where Blender isn't
  installed, as on CI).
- `test/link-server-test.js` / `test/link-controller-test.js` add
  regression coverage for `normalizeName`, the auth timeout, a client named
  `__proto__`, name-variant spoofing, a 30-client consent flood, and two
  overlapping `start()` calls.
- `test/openable-types-test.js` adds alternate-data-stream refusal,
  case-fold dedupe, and checks `build/installer.nsh` is committed and in
  sync with `src/openable-types.js`.

### Fixed (2026-09-23, final pass before release)
- Blender export now warns in the log (`KANVAZ_TEXTURE_MISSING:`) when a
  material references a texture Blender's sandboxed conversion process
  can't reach (a UNC network path, most commonly) instead of silently
  exporting it blank.
- A `file://` URI in a launch argument (some Linux file managers/`xdg-open`
  hand the app one instead of a plain path) is now decoded the same as a
  bare path, on both the media and `.kanvaz`-board argv paths.
- Launching with both a `.kanvaz` board and loose media now logs which
  media files were ignored, instead of silently dropping them.
- Fixed 6 findings from a same-session bug-bounty pass on the night's own
  diff: a Blender-conversion-timeout temp-file cleanup that could lose a
  race against the killed process's file handle; a regression-test regex
  that could never match (so it never actually tested anything — now
  self-tested against a deliberately reintroduced copy of the bug it
  guards); a 3D-card bounding-box finite-check that only validated one
  axis; the shared 3D mode-picker popup closing when an unrelated card
  was deleted; a duplicate `update-error` IPC send for one failure; and
  `.kanvaz`'s own default-handler registry key surviving an uninstall
  (found via a real install → registry inspection → uninstall → registry
  inspection pass, not just reasoning about the code).

### Known, not fixed (see `docs/ROADMAP.md` for the fuller list)
- Materials built from procedural nodes (noise, gradients) have no image to
  export, so they come through as a flat colour.
- Preview quality gates (low/medium/high, with a friendly warning on high)
  and a Settings-panel Blender picker (Choose…/Auto-detect/status) were
  planned this cycle but not built — next.
- Presentation Mode still steps through cards in creation order, not
  reading order.
- A `.blend` texture referenced via a UNC network path can export as a
  blank/missing texture (Blender's own behaviour in the sandboxed
  conversion context, not yet worked around).
- A launch argument list containing both a `.kanvaz` board and loose media
  files opens only the board; the media is silently dropped rather than
  placed on it.

### Added (later the same day)
- **Adobe previews in file cards** (`src/adobe-preview.js`, tested with PSD/PSB/XD files built to the
  published layout; Photoshop itself was not available to write test files):
  **PSD and PSB** show the full flattened image, decoded straight from the file (raw or RLE, 8 and 16 bit,
  RGB, grayscale, indexed and CMYK, transparency only when the file says the merged image has it), streamed
  and averaged down to at most 3072 px so a huge file never loads into memory. A file saved without
  "Maximize Compatibility" has no flattened image, so its small embedded thumbnail is shown with a plain
  explanation. **AI** files that are PDF-compatible (Illustrator's default) use the PDF viewer, others their
  embedded thumbnail. **XD** shows its largest rendition. **InDesign** shows its embedded thumbnail.
  **Fresco** keeps its native files in Creative Cloud and cannot save them locally, so the card says how to
  export PSD or PDF from Fresco instead. CMYK is shown with a plain conversion (no colour profile), and says so.
- **Kanvaz Link connector** (the Kanvaz side of the Blender add-on; nothing on the Blender side exists yet):
  a local listener (named pipe / Unix socket, no network) with a per-start token, a proof so the add-on can
  tell it is the real app, four methods only, a private drop folder, and a native permission prompt the first
  time a program asks (default answer: don't allow). The renderer never receives a file path. Tested over a
  real pipe with hostile clients; the first delivery inside the running app has not been exercised yet.

### Fixed (later the same day)
- **3D card:** the animation play bar was a translucent band over the bottom of the viewport, hiding part
  of the model and the card name, with its time text cut off. It now lives in the hover strip under the card.
- **Wireframe** was a lit copy of the material, so lines came out white or black whatever the colour. It is now
  unlit and keeps the material's colour or texture (very dark colours are lifted so they show on the dark board).
- **Colour card "Aa" chips** were two unlabelled samples at 30% opacity. They now show the real WCAG contrast
  ratio of white and black text on that colour, update when the colour changes, and explain themselves on hover.
- **PDF preview** opened at 1 CSS pixel per PDF point (only the top-left corner of a large page) and drew at
  1x on high-DPI screens. It now fits the page to the card width and draws at the screen's pixel density.
- **File cards with a preview (PDF, image, text, Adobe): the "Open with default app" and "Change file"
  buttons were hidden underneath the card's name bar and could not be clicked.** Found with a real hit test.
  They are now a small control in the preview's top-right corner, shown on hover or when selected.

### Fixed
- **The 3D hover strip (render modes, background, reset) never showed.** It is drawn
  below the card, but cards clip their contents, so it was cut off. A DOM check said
  "visible, opacity 1"; only a screenshot showed it missing. 3D cards now overflow and
  round their own children, and their resize handles are no longer half-clipped.
- **Matcap threw away colour and transparency.** It rebuilt every material from scratch
  (only the texture survived), so a coloured or see-through model became an opaque
  blue-grey blob. Every mode now carries colour, opacity, alpha map, texture and
  double-sidedness across. The matcap itself is neutral grey now instead of blue.
- **`.blend` preview showed things you had hidden.** Objects hidden in the viewport or
  render, and objects from other scenes in the file, were exported. Now only visible
  objects of the active scene. If the converted model is over the size limit (large PNG
  textures are the usual cause) it is retried once with WebP textures, which keep alpha.
- The Properties panel now refreshes after undo/redo (undoing a Matcap switch left
  Matcap highlighted) and once a 3D viewer finishes loading (its 3D section was missing
  after a rebuild).
- Clicking into a note or text card and back out added an identical undo step every
  time, so the first Ctrl+Z looked like it did nothing.
- Map View connection labels no longer print on top of each other when several
  connections share a pair of cards or their midpoints coincide.
- **Tag editor (Properties):** focus stays in the "+ tag" box after Enter, so several tags
  can be typed in a row (it used to drop focus every time); "a, b, c" adds three tags;
  a very long tag is one line with an ellipsis and a tooltip instead of a two-line blob;
  the remove × is a bigger target. Text typed and then clicked away from still commits,
  without pulling focus back.

### Added
- **Render modes are a registry now** (`src/model3d-modes.js`): **Shaded** (the old
  "Normal"; the saved key is still `normal`, so existing boards are unaffected),
  **Normals**, **Matcap**, **Wireframe**, **Albedo** (base colour and texture, unlit)
  and **Alpha** (opacity as a black-to-white ramp: material opacity, texture alpha and
  alpha maps). Six buttons on the strip, in Properties and in the right-click 3D View.
- **Animation clip picker.** Models with several animations (a Blender file with more than
  one action) get a dropdown in Properties, 3D View. Before, only the first clip could
  play. The choice is saved with the card and survives undo.
- Read-only model statistics in Properties: triangles, vertices, meshes, materials,
  textures and size.
- **Shift+L** opens and closes the Layers panel (plain L still switches theme).

### Tests
- `test/model3d-modes-test.js` runs the real vendored Three.js and checks colour, opacity,
  sidedness and textures survive every mode, and that original materials are never mutated.
- `test/blender-export-test.js` builds a real `.blend` (skipped where Blender is not
  installed, as on CI) and asserts hidden objects and other scenes are left out and alpha
  blending survives.

### Known, not fixed
- Materials built from procedural nodes (noise, gradients) have no image to export, so
  they come through as a flat colour. Baking them would need a much heavier conversion.
- One unexplained hang of the test instance was seen once while driving the app over the
  debug port; a reload with Map View active did not reproduce it.

## [9.0.0] — 2026-09-21 — Security & platform hardening

*Major version because it drops 32-bit Windows and macOS before 12. Everything
below was tested against the running app (Electron 22 and the packaged Electron 44
build) unless marked otherwise. Not yet exercised: the plugin-approval native
dialog, macOS and Linux builds, and the new CI steps on GitHub.*

### Platform
- **Electron 22.3.27 to 44.4.3** (Chromium 108 to 152) and **electron-builder 24 to 26**.
  `npm audit` went from 13 findings (1 critical, 12 high) to 0. **32-bit Windows and
  macOS before 12 are no longer supported.** Dropped-file paths now go through
  `webUtils.getPathForFile` because `File.path` no longer exists.

### Security
- File IPC scoped to files the user chose; UNC/remote paths refused everywhere (NTLM leak); wider `shell-open-path` blocklist; SSRF guard on URL previews; MCP Bridge per-start token; plugin approval bound to the reviewed code (content hash), symlink plugins refused; `.blend` import with `--disable-autoexec`; decompression limits on `.kanvaz` files; embedded-media/`objectFit` validation on load; glTF/USD external URIs neutralised; renderer `sandbox: true`; local crash log; CI hardening. Details in `SECURITY.md`.
- **One-time effect:** plugins you approved before this version ask for consent again (approval now records the plugin's content hash).
- MCP Bridge plugin **1.3.0**: shim sends the token; a shim older than 1.3.0 is refused until updated. The catalog entry now points at the 1.3.0 zip published with this release.

### Fixed
- **Undo silently wiped card fields** (group, hidden, highlighted, 3D format/render mode/background/camera, image adjustments): any Ctrl+Z reset them. History now copies every field; regression test fails on the old code.
- **`.blend` files were reported as needing Blender even when installed** (detection only checked `C:\Program Files\Blender Foundation` for versions 3.0 to 5.0). Now finds any drive/version via PATH, standard roots, the Windows registry and package managers; `BLENDER_PATH` overrides.
- Clicking outside a card now leaves edit mode; the `S` shortcut works again after the window loses focus; the 3D render-mode buttons moved to a strip under the card (hover) with a right-click "3D View" option; video frame-step and onion skin moved to the Properties panel; Map View no longer leaves a stuck dashed wire when you click the node or port a wire started from.
- **STL files loaded lying on their back** (STL is Z-up). They now load upright, and 3D cards have an Up axis (Y/Z) switch in Properties for PLY or anything else.

### Added
- **Text and PDF file references render inside the card** (drop a `.txt`, `.md`, `.json`, `.log`, code file, or PDF). Text is read from the first 256 KB only and shown literally.
- Local crash log; SBOM and release checksums in CI.

### Known limitations found during testing
- A skinned/rigged model exported to USD renders lying down and off-centre (static USD is correct). Use GLB for rigged models.
- External textures next to an FBX are not loaded (the model shows untextured).

## [8.9.8] — Live verification: templates confirmed working end-to-end

*No code changes — closes out the one queued live check disclosed in
8.9.6/8.9.7's own entries, once the user was free for the app to be
relaunched for testing.*

### Verified
- **Clicked the real "Use" button in the Templates gallery, not a
  console shortcut** — `KanvazBoards.useTemplate()` isn't exported for
  direct calling, so this genuinely exercised the same click path an
  actual user takes: Home Screen → Templates nav → gallery row → "Use"
  button, located and clicked via its real bounding-rect coordinates
  with a full `mousedown`/`mouseup`/`click` sequence, not a bare
  synthetic `click` event on an arbitrary element.
- **VFX — Professional Pipeline**: loaded a real board named after the
  template with the correct 20 cards and all 10 connections seeded
  into `KanvazConnections` — confirmed by reading the live connection
  data back out, not just checking a card count. Switched to Map View
  and confirmed exactly 10 `.conn-line` SVG paths (plus 20 `.conn-glow`
  paths, 2 per connection — the wire's own glow effect), a precise
  count match against the template's 10 connections, not just "some
  paths exist." Read one line's actual `d` attribute and confirmed real
  bezier coordinates connecting two visibly distinct node positions on
  screen, not degenerate/zero-length data.
- **Game Art** (a second template, deliberately chosen for its
  different `tpl-ga-`-prefixed card ids rather than re-testing the same
  `tpl-N` shape): loaded through the same real UI path, correct 12
  cards and all 5 connections present with the right endpoints — the
  id-prefix variation was a real edge case worth checking, not
  redundant coverage.
- Regression-checked the rest of this session's shipped features
  weren't disturbed by the templates work stacked on top of them:
  normal card selection still works outside Presentation Mode (its
  cards.js mousedown guard doesn't leak into normal use), the Layers
  panel's highlight star toggles and persists correctly, the Cycle
  Grid Style command still cycles and round-trips back to its starting
  value, and Presentation Mode's full entry → arrow-step → Escape exit
  lifecycle still works end-to-end.
- **Not checked**: a real screenshot. `Page.captureScreenshot` hangs
  indefinitely against this Electron instance in this sandbox
  specifically — confirmed via a raw CDP call with full message
  logging, unrelated to anything in this session's own code (the same
  hang occurred both with and without `Page.enable` first, and while
  the renderer itself stayed fully responsive to `Runtime.evaluate`
  throughout). Structural DOM/SVG verification (exact element counts,
  real coordinate data, live data read-back) stood in for the visual
  check this time; a real screenshot is still worth getting next time
  screenshot capture works in this environment.

## [8.9.7] — Templates rebuild finished: 13 of 14

*Direct continuation of 8.9.6 — closing out the remaining 7 templates
rather than leaving the rebuild half-done.*

### Changed
- **The remaining 6 non-freeform templates now carry the same real
  pipeline-dependency connections as the 7 shipped in 8.9.6**:
  `filmmaking` (3), `branding-identity` (8), `ui-ux-design` (8),
  `architecture-product` (6), `photography-concept` (6),
  `music-production` (7) — same methodology, same validation (every
  connection checked to reference a real card id in that file, use a
  valid connection type, no self-loops, no duplicate ids).
- **`mood-board` deliberately left untouched, not an oversight**: its
  own manifest description is "a loose, freeform layout for general
  inspiration gathering" — imposing a forced pipeline-dependency
  structure on a template whose entire point is having none would be a
  real design mistake, not a completeness win. 13 of 14 templates now
  demonstrate Connections/Map View; the one holdout holds out on
  purpose.
- Same disclosed verification scope as 8.9.6: connections validated
  structurally by script, the IPC load path verified live via CDP in
  the previous release — this pass only added more of the same
  already-proven pattern, so no new live-verification category was
  needed. The Templates gallery UI click-through is still the one
  queued live check, unchanged from 8.9.6's own note.

## [8.9.6] — Templates carry real Connections, 7 rebuilt

*Backlog item: "Templates are still text/note-only — correctly called
out as not a real professional pre-production starting point. Needs
real research and a full rebuild, not another patch."*

### Changed
- **Templates can now ship real typed Connections between their own
  cards, not just a flat list of notes.** Surveyed the actual content
  of all 14 bundled templates before touching anything: every single
  one was already text/note (plus a few color swatches) with real,
  accurately-named industry pipeline stages — the v8.8.0 content pass
  had already fixed the "generic placeholder text" problem. The real
  gap this pass found: zero connections anywhere, meaning no template
  ever demonstrated Connections/Map View — Kanvaz's own actual
  differentiator against every flat moodboard competitor (PureRef,
  Milanote, Are.na, ArtDeck) — at all. A new user opening any template
  had no way to discover the feature exists.
- **7 templates most aligned with the v8 line's named personas
  (3D/VFX, game dev, animation) rebuilt with real pipeline-dependency
  connections**: `vfx-professional` (10), `vfx-intermediate` (8),
  `vfx-beginner` (8), `game-dev` (9), `game-art` (5),
  `animation-pipeline` (9), `character-design` (10) — each connection
  reflects a real production dependency (e.g. game-dev's Technical
  Budget `Supports` the Asset List — the exact cross-discipline
  dependency-visibility gap named in this session's own positioning
  research, made visible on first open rather than left implicit).
  **The other 7 templates (filmmaking, branding-identity, ui-ux-design,
  architecture-product, photography-concept, music-production,
  mood-board) are unchanged this pass** — a deliberate scope decision,
  not an oversight, given the size of doing this rigorously across all
  14; flagged as a real follow-up in ROADMAP.md.
- **New file format, fully backward compatible**: a template file can
  now be `{cards, connections}` instead of a bare card array. Every
  template on disk before this release (all 7 untouched built-ins, and
  every existing user-saved template) stays a bare array and loads
  exactly as before — `template-load`'s handler (`main.js`) detects the
  shape with `Array.isArray()` rather than a version field, so the
  common connections-less case never grows on disk. `template-save`
  (Save-as-Template) now accepts and writes a real `connections` array
  too, when there's one worth saving — so a user's own custom templates
  can carry their own connections from now on, not just the bundled
  ones. `KanvazBoards.newBoard()` gained an optional `initialConnections`
  param; `useTemplate()` passes it through to `KanvazConnections.
  deserialise()` instead of the previous unconditional `.clear()`.
  - Verified: a Node script checked every rebuilt template's
    connections reference real card ids that exist in that same file,
    use only the 7 valid connection types, have no self-loops, and no
    duplicate connection ids — zero problems found. Live-verified the
    IPC boundary specifically via CDP: `KanvazBridge.loadTemplate(
    'vfx-professional')` against the real running app returned the
    correct `{ok, cards, connections}` shape with the exact connection
    data expected. **Not yet live-clicked through the actual Templates
    gallery UI end-to-end** (interrupted mid-session to avoid
    interfering with the user's own concurrent use of the app) — the
    `useTemplate()`/`newBoard()`/`deserialise()` code path was verified
    by reading and tracing the source, not by a live click, and is
    queued for a real click-through pass next session.

## [8.9.5] — Presentation Mode

*Backlog item: "Presentation/kiosk mode for presenting a board from
inside the app."*

### Added
- **A new read-only Presentation Mode** (Command Palette → "Toggle
  Presentation Mode", `core.togglePresentationMode`), distinct from Top
  Mode: Top Mode is a working-session convenience (still fully
  editable); this is for showing a board TO SOMEONE ELSE — a client or
  director review — so it goes further. On entry: the toolbar and side
  panel are hard-hidden (`display:none`, never revealed on hover the
  way Top Mode's auto-hide-chrome is — a presenter's mouse will pass
  near the top of the window, and the toolbar popping back in
  mid-presentation would defeat the point), any active selection is
  cleared, and the view zoom-fits every card on the board. Left/Right
  arrow steps through every card one at a time (`KanvazCanvas.zoomFit`,
  the same instant, non-animated framing every other zoom action in
  this app already uses — no new animation system introduced), Escape
  exits and restores the side panel to whatever it was before.
  Mutually exclusive with Top Mode (entering one exits the other first)
  since both compete for the same side-panel-restore bookkeeping.
- **Read-only is enforced at two deliberately narrow choke points**
  rather than threaded through every individual drag/resize/delete/
  rename/duplicate/group call site across the codebase: `cards.js`'s
  one delegated mousedown handler (already where every card mouse
  interaction in this app funnels through, per this file's own
  docblock) and its `contextmenu` handler both return immediately while
  Presentation Mode is active. Keyboard shortcuts get their own single
  guard, placed in `shortcuts.js` before even the "always fire
  regardless of focus" section (Save/Open/Undo/Redo) — an allowlist of
  exactly Escape and Left/Right, blocking everything else, rather than
  auditing and gating every one of the ~30 individual shortcuts further
  down that dispatcher one at a time. A card selected before entering
  is also explicitly deselected on entry, closing the one gap neither
  choke point alone would catch (a stray Delete/Ctrl+D keypress acting
  on a pre-existing selection).
  - Live-verified via CDP with real dispatched mouse/keyboard events
    (not direct function calls standing in for user input): a
    synthetic `mousedown` and `contextmenu` on a real card both
    produced no selection and no menu while active; a dispatched
    `Delete` keydown left the card count unchanged; four consecutive
    `ArrowRight` keydowns stepped through 3 real cards' distinct
    framed viewport positions and correctly wrapped back to the first;
    `Escape` restored the toolbar, side panel, and pre-entry state
    exactly; toggling Presentation Mode while Top Mode was active
    correctly exited Top Mode first with no leftover body class.

## [8.9.4] — Grid style design review + a Command Palette toggle

*Backlog item: "Grid style feature (Reference/3D-origin/Game-Dev tile)
questioned directly by the user's own stated 'senior real feedback' —
worth a real design review of whether tile grid earns its keep against
reference mode."*

### Changed
- **Design review verdict: keep all three grid styles, no removal.**
  Read the actual implementation before judging the idea in the
  abstract: "3D" mode is the existing reference grid plus a ~20-line
  two-line red/green origin-axis overlay, not a separate grid; "Game
  Dev" mode is its own ~55-line function with a genuinely different
  pixel-alignment semantic (uniform 32px tile spacing + a chunk line
  every 8 tiles) serving a real, distinct tile/sprite-alignment use
  case, not a reskin of the reference grid. Both map directly onto two
  of this project's three explicitly named target personas (game
  developers, 3D/VFX artists). Cutting either would remove real, cheap,
  persona-aligned value against a vague "maybe nobody uses it" worry
  with no usage data behind it.

### Added
- **A real, smaller gap the review DID find**: switching grid styles
  required opening Settings — no quick toggle. Added `Cycle Grid Style
  (Reference / 3D / Game Dev)` to the Command Palette
  (`core.cycleGridStyle`, `commands.js`), cycling through the same
  order the Settings dropdown lists, writing through the existing
  generic `KanvazUI_Extended.updateSettings()` path (`applySettings()`
  already redraws the grid on any settings change, so no extra
  plumbing needed) and confirming the new style with a toast.
  - Live-verified via CDP: ran the command three times in a row against
    a real settings.json, confirmed it cycled `gamedev → reference →
    3d → gamedev` (a full loop back to the starting value, so this
    verification pass left no drift in the profile it ran against),
    and confirmed the command is registered with the correct label via
    `KanvazCommands.getCommand('core.cycleGridStyle')`.

## [8.9.3] — Real Map View thumbnails for video and 3D cards

*Backlog item, from live-testing feedback: "Map View node cards and
3D-model/video thumbnails need real preview/visual work, not
placeholder icons."*

### Added
- **Video cards now show a real decoded frame in Map View**, not the
  generic type glyph every non-image/GIF card fell back to before.
  `map-view.js` decodes one frame off-screen (a `<video>` element never
  attached to the DOM, seeked to 10% into the clip — not frame 0, which
  is very often a black fade-in on real footage), draws it to a small
  160×120 canvas, and caches the result per card id for the rest of the
  session. Fully self-contained: doesn't depend on the card ever having
  been opened in Board view.
- **3D model cards now show a real rendered thumbnail too**, captured
  from the live board viewport itself rather than a second render
  pipeline. The 3D card's own WebGL canvas already renders one correctly
  -framed frame as soon as a model finishes loading (`buildModel3DCard`,
  `cards.js`) — right after that `renderFrame()` call, the same drawing
  buffer is read into a small canvas and cached (`KanvazCards.
  getModel3DThumbnail(id)`), while it's still valid and before the next
  clear/swap (safe without `preserveDrawingBuffer` only because the read
  happens synchronously in the same task as the render call). Building a
  dedicated offscreen Three.js renderer just for a static preview would
  have duplicated the entire loader/material/lighting setup
  `loadModelIntoScene()` already does — this reuses it instead of
  re-implementing it. **Real, disclosed trade-off**: a model3d card that
  has never been opened in Board view this session has no frame to
  borrow yet, and falls back to the plain type icon until it has been.
  - Live-verified via CDP, not just DOM-property checks: generated a
    real synthetic test video (ffmpeg, red frame with a blue square) and
    a minimal valid `.glb` triangle mesh, loaded both as real cards,
    decoded the resulting cached thumbnail data URLs to actual JPEG
    files and visually confirmed pixel content in both cases — the
    video thumbnail shows the real red/blue frame, the 3D thumbnail
    shows the real rendered triangle, not a blank or generic image.

## [8.9.2] — Layers panel: highlight and grouping

*Direct request, from live-testing feedback on the Layers panel: "layer
labels? to highlight any layer if user wants? pin layers? since
locking is diff pinning and then add grouping of layers like maya does
and other softwares too."*

### Added
- **A star icon on every Layers row toggles a "highlight" state** — an
  amber left-border accent on that row, independent of the pin/lock
  icon next to it. Named `highlighted`, not "pin," on purpose: this
  app's existing `pinned` field is already UI-labeled "Pin" everywhere
  (right-click menu, the `P` shortcut, the Shortcuts overlay) but
  actually means lock, documented in cards.js's own lockBtn comment.
  Reusing "pin" for a new, different feature in the same panel would
  give one word two meanings in one place. Persisted per card
  (`card.highlighted`, defaults `false`) via `toggleHighlight(id)`,
  mirroring the existing `toggleCardVisibility()` pattern exactly —
  same markDirty/history-push/refresh sequence.
- **Grouped cards now show a small group indicator in the Layers
  panel, click it to select every member of that group.** Card
  grouping (Ctrl+G/Ctrl+Shift+G, `card.groupId`, `getGroupMembers()`)
  has existed at the data-model level since v7.19.0, but this panel
  rendered a flat z-order list with zero group-awareness — the real
  gap behind "add grouping of layers like maya does." A full
  collapsible-tree Outliner is a much bigger UI commitment than a
  feedback-driven pass like this scopes to; a clickable glyph that
  selects the whole group in one action delivers the actual value
  (spot and grab a group from the layer list) without it. Only shown
  for 2+ members, since a lone leftover member with no one left
  sharing its `groupId` isn't meaningfully "a group" to indicate.
  - Live-verified via CDP: created 3 cards, grouped 2, highlighted the
    third; confirmed the row DOM (border-accent, star fill/title, group
    icon presence) matched `card.highlighted`/`card.groupId` exactly,
    and that clicking the group icon calls `setMultiSelection()` with
    precisely the 2 group member ids — screenshotted for a real visual
    check, not just a DOM-property read.
- Caught by the same live pass: `toggleHighlight` existed in cards.js
  but was never added to the module's exported `KanvazCards` object —
  harmless for the Layers panel's own internal click handler (same
  closure), but would have silently broken for any future external
  caller. Exported alongside `toggleCardVisibility`/`togglePin`.

## [8.9.1] — 3D cards no longer trap you inside their orbit controls

*Direct request: "when in 3d mode if user has zoomed a lot how will he
move even if he focuses to card since 3d is interactive — add
something like ctrl and middle mouse [to pan]."*

### Added
- **Alt+drag or Ctrl/Cmd+middle-mouse now pans the whole board even
  with the cursor over a 3D model card's interactive viewport.** Real
  gap: the viewport's own mousedown handler called
  `e.stopPropagation()` unconditionally, swallowing Alt+drag — the
  gesture this app already uses to pan from anywhere, over any other
  card type — the moment the cursor crossed into a 3D card. Worse,
  OrbitControls binds its own listener directly to the inner
  `<canvas>` (a descendant of the viewport), which always sees a raw
  mousedown before anything registered on an ancestor in the bubble
  phase — a same-phase override could never win that race. Fixed with
  a new capture-phase listener on the viewport (capture is the one
  DOM event ordering that lets an ancestor pre-empt a descendant's own
  listener) that intercepts Alt+drag or Ctrl/Cmd+middle-mouse
  specifically and hands off to a new `KanvazCanvas.startExternalPan()`
  — plain middle-mouse is deliberately left alone, still reaching
  OrbitControls for its own dolly/zoom, a real convention worth
  keeping rather than an oversight.
  - Live-verified via CDP against a synthetic 3D card: both triggers
    moved the board's `tx`/`ty` by the exact mouse delta; plain
    middle-mouse correctly did nothing; the card did not get selected
    mid-pan, matching how Alt-drag already behaves for every other
    card type.

## [8.9.0] — Tags moved to Properties, real titlebar avatar, more stacking fixes

*Direct requests plus a "quality over speed" audit pass on the areas
those requests touched.*

### Changed
- **Tag editing moved out of each card's own on-card tag bar entirely,
  into the Properties panel only.** Direct, repeated request. The
  in-card tag bar (`buildTagBar`/`showTagInput` in `cards.js`, ~250
  lines) is deleted — no card type shows tag chips on the canvas
  anymore. The Properties panel's own Tags section (already existed,
  already went through the same `KanvazCards.setTags()` API) is now
  the sole editor, and picked up the in-card version's one real
  feature it would otherwise have lost: tag autocomplete, ported as a
  native `<datalist>` (recent tags first, then every other tag used
  anywhere on the board) instead of rebuilding the old floating
  dropdown's own positioning logic — simpler, and it behaves correctly
  inside the side panel's own scroll container for free. `setTags()`
  itself, `KanvazCards.getAllTags()`/`getRecentTags()` (new, small
  exports for the datalist), and every existing tag-search/Smart-Folder
  behavior are unaffected — this only ever touched the on-card UI.
- **The Board View titlebar's account button now shows a real profile
  avatar** — the active profile's photo or initial in a colored circle,
  matching the Home Screen's own account button exactly (and how
  Figma/Notion/Linear all treat a top-right profile control) — instead
  of a plain three-dot glyph. Same dropdown menu (Profile/Manage
  Profiles/Home/About/Shortcuts) underneath, unchanged; only the
  trigger button's look changed, via a new `syncAccountButtonAvatar()`
  in `sidepanel.js` called once at boot and again every time the menu
  opens (self-healing after a rename or new avatar photo, same
  reasoning already used for the menu's own profile-name label — a
  profile *switch* relaunches the whole app, so that path needs no
  separate handling here).

### Fixed
- **The About screen, Shortcuts overlay, and Official-Plugins browser
  were all completely invisible whenever the Home Screen was open** —
  the same `#startup-screen` (z-index 99998) stacking bug v8.8.2 found
  for Top Mode's badge, just never audited across the rest of this
  app's overlays until now. All three reachable from the Home Screen
  itself (its own account menu, or the "Show Shortcuts" link), so this
  was a real, common dead end, not a corner case. Raised to z-index
  99999, matching the already-correct first-run overlay.
- **The Shortcuts overlay's own 3-column layout was too narrow for its
  content** — 480px total split three ways left ~125px per column,
  cramping entries like "Ctrl+drag / V" badly enough to force a
  horizontal scrollbar just to read the third column. Only ever
  discoverable once the z-index fix above made the overlay visible at
  all. Widened to `min(760px, 90vw)`.
- **`Ctrl+Scroll` fine-zoom didn't work with Cmd on Mac** — the one
  place in the app that checked `e.ctrlKey` alone instead of the
  `e.ctrlKey || e.metaKey` every other shortcut already uses.
- **Mac users saw "Ctrl"/"Alt"/"Shift" in shortcut labels for keys that
  already worked with Cmd/Option/Shift** — the Shortcuts overlay and
  Command Palette both hard-coded the Windows/Linux modifier names
  regardless of platform. Display-only fix (`navigator.platform`
  check swaps the word for the Mac symbol at render time); the
  underlying data and the actual key handling are untouched.
- **`.blend` drop error message named a requirement with no context**
  — "Install Blender to preview .blend files live" didn't say what
  Blender is, where to get it, or that it's optional. Now names it as
  the free app at blender.org and states plainly that the file was
  already added as a real reference either way.

## [8.8.5] — Properties panel refresh bug, .blend conversion-failure fallback

*More direct hands-on testing, plus a live screenshot that caught the
Properties panel bug in the exact act of happening.*

### Fixed
- **The Properties panel silently stopped updating on card selection**
  — confirmed live via a screenshot showing a card selected with
  visible handles on canvas while the panel still read "Select a card
  to see its properties." Root cause: `isOpen()` (properties.js) gated
  on its own internal `activeId`, which only ever gets set by this
  module's own `open(refId)` — but the Properties SECTION can become
  visible without ever going through that function (clicking its rail
  icon directly calls `KanvazSidePanel.showSection('properties')`
  straight away; the side panel can also restore "properties" as its
  persisted last-open section on launch). In either case `activeId`
  stayed `null` forever, so `refresh()`/`refreshPropertiesIfOpen()` —
  both gated on `isOpen()` — silently no-op'd on every subsequent
  selection change, exactly matching the reported "I have to refresh
  it" behavior. Fixed with a new `isSectionVisible()` that asks the
  real question ("is the Properties section the one currently showing")
  with no `activeId` dependency; `refresh()` and
  `refreshPropertiesIfOpen()` now gate on that instead.
  `isOpen()` itself is untouched — `app.js`'s `closeAll()` still uses
  its original, narrower meaning correctly.
- **A `.blend` file that fails to convert (Blender installed, but the
  file is corrupt or uses a feature the conversion script can't
  handle) added nothing to the board at all** — just an error toast.
  The sibling case one branch up (Blender not installed at all)
  already correctly fell back to a plain file-reference card; this
  case never got the same treatment. Now it does, with an adjusted
  toast explaining why.
- **Extended the Blender version-detection candidate list** from 5
  entries (4.3-3.6) to 14 (5.0 down through 3.0), covering the default
  install-path pattern for every stable Blender release in that range
  — on top of, not instead of, the existing bare-`blender`-on-PATH
  fallback that already covered anything this list doesn't guess.

## [8.8.4] — Drag-to-scrub, and two more real bugs from live testing

*Direct user testing of v8.8.3, launched and driven by hand. Two real,
concrete bugs plus one direct feature request, all fixed same-session.*

### Added
- **Drag-to-scrub on the Properties panel's Transform fields** — drag
  the X/Y/W/H label left or right to change the value live, the same
  interaction Maya, every Adobe app, and Figma all use for numeric
  fields. Hold Shift while dragging for fine control (0.2 units/px vs
  1). The card visibly moves/resizes on the canvas in real time as you
  drag; only ONE undo step gets recorded per drag gesture, not one per
  pixel of mouse movement — `KanvazCards.setTransform()` gained an
  optional third `persist` argument (default `true`, so every existing
  caller is unaffected) that the live-drag ticks pass `false` for, then
  the real commit fires once on mouseup. Same "debounce the history,
  not the visual feedback" pattern this codebase's own `nudge()`
  already established for holding an arrow key.

### Fixed
- **The right-click context menu got stuck open if you clicked a card
  right after opening it** — a real accessibility bug, not cosmetic:
  the menu becomes unreachable clutter sitting over the board. Root
  cause: `app.js`'s "close context menu on outside click" listener
  lives on `document`, but `cards.js`'s own card-click handler calls
  `e.stopPropagation()` on every plain card click (needed to keep a
  card click from also triggering canvas-level pan/deselect) — so the
  event never bubbled far enough to reach that listener. Fixed by
  closing the context menu directly at the top of the card mousedown
  handler, before any of its own stopPropagation branches run, so
  every one of them is covered at once instead of patched individually.
- **The dev FPS overlay sat directly on top of the Kanvaz logo** — on
  both the board titlebar and the Home Screen wordmark, which both live
  in that exact top-left corner. Moved to `bottom:70px;left:8px`,
  clear of the status bar, Top Mode's badge, and the Home Screen's own
  footer version label on every screen it can appear on.

## [8.8.3] — Escape didn't close the Shortcuts overlay

*Found by the persona-based usability pass (`docs/FULL_AUDIT_SUITE.md`
section 4) — the exact scenario a brand-new user hits: press `?` for
help, then Escape to leave.*

### Fixed
- **The Shortcuts overlay (`?`) never closed on Escape**, confirmed
  live (opened it, dispatched a real Escape keydown, overlay was still
  there). `KanvazUI.closeAll()` — the function Escape calls to close
  "whatever's open" everywhere else in the app (dialogs, context menu,
  annotation mode, Properties, the side panel) — never included it.
  Worse: Escape's OTHER side effects (`KanvazCards.deselectAll()`) ran
  anyway, so pressing Escape to leave the help overlay silently cleared
  your card selection while leaving the overlay open. Fixed:
  `closeAll()` now also removes `#shortcuts-overlay` if present, the
  same direct-DOM-removal its own Close button and backdrop-click
  handler already use. Re-verified live: Escape now closes it cleanly.

## [8.8.2] — Two more Top Mode bugs, found by live CDP verification

*The first release this line actually verified against a real running
instance (`docs/FULL_AUDIT_SUITE.md`'s CDP procedure — launch with
`--remote-debugging-port`, drive it with raw CDP messages, screenshot
the result) rather than static review alone. Found real bugs static
review, including the 4-agent v8.8.1 review, both missed.*

### Fixed
- **Top Mode's badge and accent-border indicator were completely
  invisible whenever the Home Screen was open.** Both were scoped to
  `#app` / a `z-index: 950` fixed element, but `#startup-screen` (the
  Home Screen) is `position: fixed`, opaque, and `z-index: 99998` —
  above both. Confirmed with an actual screenshot: toggling Top Mode
  from the Home Screen showed the toast, but neither cue appeared, so
  the only visible sign Top Mode was active vanished the moment you
  weren't looking at an open board. Fixed: the badge's `z-index` raised
  to `99999` (above every full-screen overlay this app has except
  toasts/dialogs, which should always win regardless); the border moved
  from `#app.top-mode-active`'s `box-shadow` to a `body.top-mode-active
  ::after` pseudo-element, since `body` is an ancestor of every overlay
  including `#startup-screen`, unlike `#app`.
- **Follow-on catch from the same screenshot**: raising the badge's
  z-index exposed a second, previously-hidden collision — the Home
  Screen's own "Kanvaz vX.Y.Z" footer label sits in the same
  bottom-left corner. `bottom: 10px` → `36px` clears it on every screen
  this badge can appear on.

Verified live: toggled Top Mode on a fresh, real running instance,
confirmed `document.body.classList`/`getComputedStyle` values and two
before/after screenshots, then loaded the actual v8.8.0 template
content (`vfx-professional.json`) onto a real board and screenshotted
the result — the new "drop your references" section renders exactly as
written, no overlap, no console exceptions.

## [8.8.1] — Top Mode conflict fixes (found by self-review)

*Found by a 4-agent multi-angle review run against the whole v8.6.0-
v8.8.0 diff before calling it done for the night. Two real, concrete
bugs, both the same root cause.*

### Fixed
- **Top Mode's forced always-on-top/auto-hide could be silently
  defeated by an unrelated Settings change.** `ui.js`'s
  `applySettings()` runs on every Settings-panel change, not just
  those two checkboxes, and unconditionally re-applied the plain
  persisted `alwaysOnTop`/`autoHideChrome` values — with no awareness
  Top Mode existed. Toggling the theme, Smart Search, or anything else
  in Settings while Top Mode was active would snap the window back to
  its normal (non-forced) state while the Top Mode badge and accent
  border stayed on screen claiming it was still active. Fixed: both
  re-apply points now check `KanvazApp.isTopModeActive()` and, if
  active, call a new `KanvazApp.noteSettingChangedDuringTopMode(key,
  value)` instead of live-applying — keeps Top Mode's forced state in
  effect, but still updates what `exitTopMode()` restores to, so the
  user's latest real preference isn't discarded either.
- **Toggling Always on Top from the Command Palette during Top Mode
  could corrupt the persisted setting.** `toggleAlwaysOnTop()` (`core.
  toggleAlwaysOnTop`) was reachable regardless of Top Mode and both
  flipped the live window state and wrote straight to `settings.json`
  — invoking it while Top Mode had forced always-on-top true would
  write `false` to disk (Top Mode's own restore-on-exit would then
  fight that stale write on the next Settings change or app restart).
  Fixed: `toggleAlwaysOnTop()` now refuses to run while Top Mode is
  active, with a toast pointing at the actual way out (`Ctrl+Shift+T`).

## [8.8.0] — Templates actually reference something now

*The one piece of "verify everything, improve the templates, improve
the restore dialog and all dialogues and notifications" left undone
across v8.6.0/v8.6.1/v8.7.0. Real research this time: read every
bundled template file directly rather than assuming.*

### Fixed
- **All 14 bundled templates were text/note/color only — zero image,
  video, 3D, URL, or file cards anywhere, across ~200 cards total.**
  Found by a script auditing every template's actual card types, not
  a guess. The written pipeline content (asset review stages, shot
  tracking, delivery checklists) was genuinely good, but a reference
  board with nowhere to put actual references, on an app whose whole
  identity is reference media, is a real gap — a new user opens one of
  these and finds a checklist, not a start on their actual board.
  - Every production-pipeline template (both VFX tiers plus
    Professional, Game Dev, Character Design, Architecture & Product,
    Animation Pipeline, Photography/Concept Art, Game Art, Filmmaking,
    Music Production, UI/UX Design, Branding & Identity, and Mood
    Board) now has its own "drop your references here" section: a
    text header plus a note naming exactly what real media belongs
    there for that domain — plates, concept art, lookdev turntables,
    a real 3D model card (`.glb`/`.fbx`/`.usd` — the format each
    domain would actually use, not a generic mention), reference
    audio, competitor screenshots, and so on, tailored per template
    rather than one copy-pasted line.
  - Added as a genuinely new column/section beyond each template's
    existing bounding box, verified by script (dupe-id check, overlap
    check, bounding-box recompute) against every one of the 14 files
    both before and after — zero overlaps, zero id collisions.
  - **Self-audit catch mid-implementation**: the first pass computed
    each new card's id by parsing the numeric suffix off the file's
    last existing id (`tpl-N` → `N+1`) — three templates
    (`filmmaking.json`/`mood-board.json`/`game-art.json`) use a
    per-template id prefix (`tpl-fm-N`/`tpl-mb-N`/`tpl-ga-N`) instead
    of the plain `tpl-N` every other template uses, which the parser
    didn't account for, producing two literal `"tpl-NaN"` ids in each
    of those three files. Caught by re-running the same dupe-id audit
    script immediately after generation (not by assuming it worked) —
    fixed by re-deriving each file's own real prefix before shipping.
  - Verified compatible with how a template is actually loaded
    (`template-load` IPC handler in `main.js` returns the raw card
    array unmodified; `KanvazBoards.useTemplate()` passes it straight
    into `KanvazCards.deserialise()` — the exact same function real
    `.kanvaz` file loading uses) rather than assumed; the new cards
    use the identical plain `text`/`note` shape every sibling card in
    the same file already used successfully.
- **README's "13 board templates" was stale — it's 14, and didn't
  name Character Design, Filmmaking, Game Art, or Mood Board at all.**
  Fixed to the real count with every template named.

## [8.7.0] — Top Mode is back

*Direct request. Removed entirely in v6.0.0 on the reasoning that
always-on-top + auto-hide chrome had become the app's own persistent
default, making a dedicated mode for the same two things feel
redundant — see that entry below for the original removal reasoning.*

### Added
- **Top Mode — `Ctrl+Shift+T`, a clean, previously-unclaimed binding.**
  One keystroke: forces the window always-on-top, forces the toolbar
  auto-hide behavior on, and closes the side panel — a genuine
  floating-reference view with everything but the canvas out of the
  way. Press it again (or trigger it from `KanvazApp.toggleTopMode()`)
  to restore always-on-top, auto-hide, and the side panel to exactly
  whatever they were before, whether that was on/off/open/closed.
  - **Deliberately session-only** — nothing is ever written to
    `settings.json`. Entering/exiting goes through the exact same
    functions the Settings checkboxes themselves call
    (`KanvazApp.syncAlwaysOnTop()`, `KanvazUI.setChromeAutoHide()`),
    neither of which persists on its own — so the user's real,
    persisted preferences are untouched by Top Mode either way.
  - A small, low-opacity, non-interactive badge stays on screen the
    entire time ("Top Mode — Ctrl+Shift+T to exit"), plus a thin
    accent-colored inset border around the whole window — two
    independent cues, so it's never a "wait, why is my window
    stuck?" moment.
  - **Self-audit catch before shipping**: an early draft's exit path
    blindly called `KanvazSidePanel.toggle()` to reopen the panel if
    it had been open before Top Mode. If the user manually reopened
    the panel WHILE Top Mode was active (clicking a rail icon),
    `toggle()`'s own "already open on this section" branch would then
    close it right back out — fighting the user's own action on exit.
    Fixed to check `isOpen()` again at exit time and only reopen it if
    it's still actually closed.
  - Bound as an "always fire" shortcut (same section as Ctrl+S/Ctrl+F/
    Ctrl+H) since it has no native textarea meaning to fight — reachable
    even mid-typing in a note, and works identically in both Board and
    Map view.
  - Added to the in-app Shortcuts overlay (`?`) and this README's
    shortcut table.

## [8.6.1] — Two more dialog-safety gaps, domain workflow docs

### Fixed
- **Two `showDialog()` call sites missed by v8.6.0's Cancel-safe-default
  sweep**, found by re-grepping the WHOLE codebase for `showDialog(`
  instead of just the four files checked last time: `sidepanel.js`'s
  "Delete profile" dialog (`[Delete(danger), Cancel]`, nothing marked
  primary — the exact risky shape v8.6.0 was hunting for) and
  `annotate.js`'s "Clear annotations?" dialog (same shape). Both now
  mark Cancel `cls: 'primary'`, matching every other delete/destructive
  dialog in the app.
- **Verified profile export/import end-to-end while auditing the
  request that led to this.** `main.js`'s `profiles-export`/
  `profiles-import` IPC handlers (zip-slip path guard, declared- and
  actual-decompressed-size caps matching the plugin-install path,
  partial-import cleanup on failure) are real and correctly wired
  through `preload.js` to `sidepanel.js`'s Manage Profiles dialog — no
  dead code, no gap found.

### Added
- **README: a "Workflows by domain" section** — concrete, numbered
  pipelines for VFX/previz, 3D/look-dev, and game dev, plus a
  "Handing a pipeline to a team" note tying together board templates
  (`.kanvaztemplate`) and profile export (`.kanvazprofile`) as the two
  portable files a team already has for sharing a pipeline setup
  without an account or server. Every button/menu name referenced was
  checked against the actual source, not assumed (the template-import
  button lives in the Template Maker & Manager plugin's own Settings
  panel, not a "New Board screen" as an earlier draft of this section
  incorrectly assumed).

## [8.6.0] — Recovery dialog, dialog safety, video scrim polish

*Follow-up to a direct "verify everything, improve the templates, improve
the restore dialog and all dialogs and notifications" request. Templates
research is still pending; this release covers the dialog/notification and
video-card-usability portions.*

### Changed
- **Recovery dialog now tells you what it's actually offering to
  restore.** Previously a blind "An unsaved board was found. Restore
  it?" with zero information to decide on. Now reads the recovery file
  first, parses it, and reports real numbers: how many boards, how
  many cards total, and when it was last saved (`formatRelativeTime()`,
  promoted from a `boards.js`-private helper to a shared export for
  this). If the file is corrupt or unrecognized, skips the dialog
  entirely and clears it with an explanatory toast instead of
  presenting Restore/Discard buttons for something there's nothing
  meaningful to restore.
- **Dialogs now default Enter to the safe choice, not whichever button
  happened to be last.** `KanvazUI.showDialog()` now auto-focuses a
  button only when it's explicitly marked `cls: 'primary'`, so pressing
  Enter without touching the mouse confirms deliberately, not by
  accident. Applied to every delete/reset/remove-style confirmation
  dialog in the app (board delete, card delete — both single and
  multi-select, Map View card delete, Reset Kanvaz, Remove plugin) by
  marking their **Cancel** button primary — matching how macOS and
  other well-designed apps default focus to the non-destructive option
  in a destructive-action dialog.
  - Caught during this work: an early draft of the auto-focus logic
    used a `primaryBtnEl || btnsEl.lastElementChild` fallback. Auditing
    every `showDialog()` call site turned up "Remove plugin?"
    (`[Cancel, Remove(danger)]`, Remove last, no primary marked) —
    that fallback would have made Enter delete a plugin by default.
    Removed the fallback before it ever shipped; auto-focus now only
    ever happens on an explicit `primary` button.
- **Video cards' scrub bar and tag bar are no longer flat opaque slabs
  stamped over the video frame.** Both used a plain themed background
  color (`var(--color-chrome)` / `var(--color-surface)`) — fine for
  audio, which sits on a themed icon-area background, but wrong for
  video: the pixels underneath are unpredictable, and in light theme
  specifically a near-white bar clamped over a video frame on hover
  reads like a rendering glitch, not a control surface. Both now use a
  translucent, blurred dark scrim (`rgba(10,10,16,0.6)` +
  `backdrop-filter: blur(8px)`) — the same fixed-dark-glass treatment
  every real video player's control bar uses regardless of the host
  page's own theme — with icon/text colors switched to a matching
  fixed light tone so contrast holds in both app themes. Audio's own
  scrub/tag styling is untouched; this is scoped to video only via
  `:has(.video-scrub)`.

## [8.5.0] — Video card fullscreen, real 3D icons/colors in Map View

*A dedicated audit pass on video/audio cards and Map View node styling,
per direct request — not new format work.*

### Added
- **Video cards: a real fullscreen button.** Flagged as missing since
  v7.0.0's own control-polish pass, never built until now. Calls
  `requestFullscreen()` on the `<video>` element itself (not a custom
  CSS-simulated fullscreen), giving native browser fullscreen video
  chrome for free — the same pattern any browser-based video player
  already uses, not a new mechanism invented for this. New Feather-
  style `EXPAND_ICON` matching the rest of the scrub bar's icon set.
- **Audio cards reviewed, no changes needed.** Checked the waveform
  rendering, icon area, control-collapse thresholds at small card
  sizes, and the play/mute/loop/volume control set specifically for
  weak spots — found the existing implementation (real waveform from
  decoded audio, pulse animation while playing, proper `clamp()`/
  container-query responsive sizing already shared with video's own
  scrub bar) already solid. Documented as "checked and fine," not
  silently skipped.

### Fixed
- **Three real gaps, all the same root cause: `model3d` was never
  added to a few type registries when 3D support shipped in v7.4.0.**
  Found while auditing Map View's node rendering for weak UI spots,
  not hypothetical:
  - `reference-types.js`'s `TYPES` registry had no `model3d` entry —
    every `KanvazRefTypes.getIcon('model3d')` call (Map View node
    thumbnails, the Connections Inspector's title/connection rows) has
    been silently showing a generic ❓ instead of a real icon, on
    exactly the card type this v8.x line is meant to make the
    flagship identity. Added a real entry.
  - `plugin-api.js`'s `BUILTIN_CARD_TYPES` collision list was also
    missing `model3d` — a plugin could have registered `model3d` as
    its own id with the built-in-collision warning never firing, even
    though it genuinely is a built-in type that always wins. Added.
  - `map-view.js`'s `NODE_TYPE_COLORS` was missing `model3d` too —
    every 3D model node fell through to the plain neutral border-color
    fallback instead of getting its own accent like every other type,
    reading as visually undefined at a glance. Added a real, distinct
    teal (`#2FB8A8`).
- **3D model cards never got the "N annotations" count badge** every
  other annotatable card type (image/gif, video, audio) already has —
  a v7.4.0 oversight, not a functional bug (annotating a 3D card
  already worked regardless, since `KanvazAnnotate.activate()` lazily
  attaches its own overlay by card id, independent of this badge).
  Added the same `buildAnnotationDot()` call the other types make,
  synchronously at card-build time, not gated on the model's async
  load finishing.

## [8.4.0] — 3D camera position persistence

### Added
- **3D model cards now remember their camera orbit position across
  saves and reloads.** Deliberately NOT persisted through v7.4.0–v8.2.0
  ("every load reframes to a default view") — revisited now that 3D is
  this line's flagship identity, not a launch-scope footnote. Saved on
  `OrbitControls`' own `end` event (fires once per orbit/pan/zoom
  gesture, not per mousemove frame the way `change` does) — same
  one-history-entry-per-gesture convention `setRenderMode`/`setBgColor`
  already use, not a new pattern. Stored as plain `{x,y,z}` objects
  (not `THREE.Vector3` instances) so it round-trips through the
  `.kanvaz` JSON format like every other card field. "Reset view"
  still always re-frames to the computed default regardless of what's
  saved, by design — the saved position is only ever restored on the
  card's first load in a session.
  - New persisted fields `cameraPosition`/`cameraTarget`, added to
    `buildFullCardRecord()`'s whitelist and the deserialize-defaults
    block — the two places this codebase's own established convention
    requires touching for any new per-card field, done both times.
  - README's "Known limitations" line calling this out as a disclosed
    trade-off removed, since it's no longer true.

## [8.3.0] — .blend support via an optional external tool (Blender)

### Added
- **`.blend` preview, via a locally-installed Blender — not a bundled
  parser.** `.blend` has no viable pure-JS/WASM parser (researched and
  rejected twice now, see `docs/ROADMAP.md`'s Tier 3 entry). Instead:
  if Blender is found (checked at a handful of common per-OS install
  locations, falling back to `PATH`), Kanvaz shells out to its headless
  batch mode to convert the file to `.glb`, then renders that through
  the existing, unmodified Three.js pipeline — the same trust boundary
  every other 3D format already goes through. If Blender isn't found,
  the file becomes a plain file-reference card (same pattern `.pdf`
  cards already use) instead of failing outright, with a toast
  explaining why.
  - **First time this app has ever spawned an external process** —
    treated as a real, new security surface, not a routine addition.
    Every argument is passed to `child_process.spawn()` as a real array
    element, never concatenated into a shell string, so there's no
    command-injection path even though the input `.blend` path is
    renderer-supplied. The converted output path is always generated by
    this app itself (an unpredictable temp filename), never derived
    from renderer input — closes the other half of that risk (a crafted
    "output path" overwriting an arbitrary file). `SECURITY.md` updated
    with an explicit disclosure of this new capability.
  - Maya (`.mb`/`.ma`) and Houdini formats are explicitly NOT
    implemented this round, despite being part of the same planned
    abstraction — this ships Blender only, honestly scoped, rather than
    guessing at CLI invocations for tools this session couldn't verify
    as confidently. Same abstraction shape (detect → headless-convert →
    render via the existing pipeline) is meant to extend to them later.
  - New `.blend` routing is its own list (`EXTERNAL_CONVERT_EXTS` in
    `media.js`), separate from the direct-embed `MODEL_EXTS` list every
    other 3D format uses, since this path can fail in a way (tool not
    installed) none of the others can, and needs its own fallback
    handling in the drop pipeline (`app.js`) and relink flow
    (`cards.js`'s `relinkCard`).

## [8.2.0] — 3D format support: the USD family

### Added
- **`.usd`/`.usda`/`.usdc`/`.usdz` support** — Pixar's Universal Scene
  Description, the industry-standard 3D interchange format backed by the
  Alliance for OpenUSD (Apple, Adobe, Autodesk, NVIDIA, Pixar). Vendored
  Three.js's own `USDLoader` (r186) and its full dependency chain into
  `src/vendor/three/loaders/` and `src/vendor/three/loaders/usd/`:
  `USDAParser.js` (ASCII USD text), `USDCParser.js` (binary "crate" USD),
  `USDComposer.js` (builds the actual Three.js scene graph from either
  parser's output), and `fflate.module.js` for `.usdz`'s zip decompression
  — this one, it turns out, was already silently sitting in
  `src/vendor/three/libs/` since v7.4.0's original Three.js vendoring
  (undocumented until now, presumably pulled in as part of copying
  Three's own `examples/jsm/` tree wholesale). Newly put to actual use
  here, and given its own real `THIRD_PARTY_NOTICES.md` entry to close
  that prior gap — it's a separate, standalone MIT-licensed project
  Three.js bundles rather than owns, and should have had its own
  attribution line from the start.
  - **This turned out to be a much bigger vendoring job than the v8.x
    plan originally assumed — corrected here, not glossed over.** The
    plan's own wording was "evaluate whether vendoring USDLoader.js
    ... is sufficient" as a hoped-for cheap alternative to a custom
    WASM build. Checking the actual source before writing any
    integration code found ~10,100 lines across 5 files, not a
    single-file loader like STL/PLY/VOX. Still the right call to make
    (it's official, actively-maintained Three.js code, not a
    fringe dependency, and avoids a custom WASM toolchain entirely) —
    just not the "collapses into Tier-1 cost" outcome originally hoped
    for. `docs/ROADMAP.md`'s Tier 2 entry updated with the real cost.
  - `USDLoader.parse()` is callback-based, unlike every other 3D loader
    already in this codebase (which parse synchronously) — it awaits
    per-texture load promises before firing `onLoad`, since a `.usdz`'s
    textures may need decompressing first. `loadModelIntoScene()`
    (`cards.js`) passes its own `onLoad`/`onError` straight through
    rather than wrapping them, since the shapes already match.
  - The loader content-sniffs the actual bytes (a zip's `PK` magic,
    USDC's `PXR-USDC` crate header, else assumes ASCII USDA text)
    rather than trusting the file extension — one code path correctly
    handles all four extensions.
  - No animation-clip extraction path is exposed by USDLoader today;
    matches OBJLoader's existing no-animation contract, not a new gap.

## [8.1.0] — 3D format support: VOX (MagicaVoxel)

### Added
- **`.vox` (MagicaVoxel) 3D model support.** Vendored Three.js's own
  `VOXLoader` (r186) into `src/vendor/three/loaders/` — self-contained,
  single file, same cost class as `.stl`/`.ply` from v8.0.0.
  `VOXLoader.parse()` returns an array of chunks (one per model in a
  multi-model `.vox` file); only the first renders if there's more than
  one, same "first only" scope decision already made for multi-clip
  GLTF animations elsewhere in this card type. The vendored `buildMesh()`
  helper turns a chunk into a real, fully colored `THREE.Mesh` (greedy-
  meshed voxel geometry + a palette-texture material), not a placeholder
  — fits the existing render-mode pipeline unchanged, same as STL/PLY.
  Extension lists updated everywhere the other 3D formats already were:
  `model-load`'s allowlist/MIME map, both file-dialog filters,
  `DROP_MEDIA_EXTS`, `KanvazMedia.MODEL_EXTS`.
- **Investigated and deliberately deferred: `.dae` (Collada).** The v8.x
  plan originally assumed this was "same cost class" as STL/PLY/VOX —
  checking Three.js's actual r186 source proved that wrong before any
  code was written: `ColladaLoader.js` is a thin wrapper around a
  ~2000-line parser and a ~3000-line composer, plus a `TGALoader`
  dependency — roughly 5,700 lines of real COLLADA-XML scene-graph
  parsing across 4 files, nothing like the other three formats'
  single self-contained loader. See `docs/ROADMAP.md`'s Tier 1 entry
  for the corrected cost assessment; not shipped this round.

## [8.0.0] — 3D format support: STL and PLY

*First release of the v8.x line — see `docs/ROADMAP.md`'s "The v8.x line" for
the full plan. Per that plan's own build sequencing, this and the releases
that follow it are real, official versions but not yet "the" industry-grade
v8 milestone — that distinction is earned at the end of a 3-session audit
gate, not by a version number alone.*

### Added
- **`.stl` and `.ply` 3D model support**, alongside the existing `.glb`/
  `.gltf`/`.obj`/`.fbx`. Tier 1 of the v8.x format plan — vendored Three.js's
  own `STLLoader`/`PLYLoader` (r186, matching the already-vendored Three.js
  version) into `src/vendor/three/loaders/`, same pattern already used for
  `OBJLoader`/`FBXLoader`/`GLTFLoader`: real source files, zero native
  dependencies, no new architecture. Unlike those three loaders, `STLLoader`/
  `PLYLoader.parse()` return a bare `BufferGeometry`, not an `Object3D` tree —
  wrapped in a `THREE.Mesh` with a flat default `MeshStandardMaterial` (both
  formats carry no material of their own) so the existing render-mode/
  wireframe/matcap pipeline (built around `root.traverse()` + `node.isMesh`)
  needed zero changes to support them. `computeVertexNormals()` runs only
  when a file doesn't already ship normals (STL always does; PLY doesn't
  always).
  - Updated everywhere a 3D-format extension list already existed rather
    than adding a new one: `model-load`'s IPC allowlist and MIME map,
    every file-dialog filter (`dialog-open-media`/`dialog-import-media`),
    the drop-handler's `DROP_MEDIA_EXTS`, and the renderer's own
    `KanvazMedia.MODEL_EXTS` type-detection list.

### Fixed
- **Right-click on a Layers panel row did nothing.** Every other card
  surface in the app (the canvas card itself, a Smart Folder chip) had
  a `contextmenu` handler; the Layers panel row never got one when the
  panel was first built. Right-clicking a row now shows the exact same
  context menu (Rename, Pin, Bring to front/Send to back, Delete, etc.)
  as right-clicking the card on canvas.
- **Selecting a layer silently bumped it to the front.** The row's
  click handler called `bringToFront()` on every select — meant as a
  convenience ("jump to what I clicked"), but it actively fights the
  one thing a layers list exists for: reordering without moving
  through z-order first. Selecting a row now only selects it.

### Added
- **Drag-to-reorder in the Layers panel.** Rows are draggable; dropping
  one above or below another reassigns real z-order via a new
  `KanvazCards.reorderLayers()`, persisted and undo-reversible like any
  other structural change (`markDirty()` + `KanvazHistory.push()`), the
  same way Photoshop or Figma's own layers list works.

Both bugs were caught by direct user feedback from manual testing
("right click doesn't work"), not by the static suite or code review —
a `contextmenu` handler is a DOM wiring gap `node test/validate.js`
has no way to see. Verified live via CDP against a real running
instance: right-clicked a layer row (context menu appeared, same item
count as the on-canvas menu), then simulated a drag from the top row
to the bottom and confirmed both the panel's row order and the actual
canvas cards' `z`/`zIndex` updated to match.

## [7.25.0] — Export board/selection as image

### Added
- **Export board or selection as a PNG image.** "Export board as image"
  in the canvas right-click menu (every card); "Export selection as
  image" in a card's own right-click menu once 2+ are selected. Unlike
  the Home Screen thumbnail (v7.24.0, deliberately simplified colored
  rectangles for speed since it runs on every save), this draws each
  card's REAL content: actual image/video/GIF pixels via `drawImage`,
  a note's actual text with manual word-wrapping (canvas has no built-
  in text-wrap), a color card's actual fill. Card types with no single
  obvious "real content" (URL/file/3D model/audio/plugin/unknown) get a
  plain labeled rectangle instead — still useful as a layout reference,
  just not pixel-faithful. Capped at 4096px on the long edge so a
  sprawling board doesn't produce an unreasonably large canvas. Same
  main-process split as every other export in this app: the renderer
  renders the PNG, `export-image-save` only handles the save dialog and
  file write. Verified live: exported a mix of a note (real wrapped
  text), an image (real pixels via `drawImage`), and a color card (real
  fill) to a single PNG and visually confirmed all three rendered
  correctly.

## [7.24.0] — Real board thumbnails

### Added
- **Real board thumbnails** on the Home Screen's "Recent" tiles,
  replacing the generic gradient-banner placeholder. A small offscreen
  canvas draws one colored rectangle per card (same type-color scheme
  and fit-everything framing as the existing minimap), exported as a
  compact JPEG and generated at save time — `writeSerialisedBoardTo`
  (the one chokepoint every save path already funnels through) calls
  `KanvazCards.generateThumbnail()` and hands it to a new
  `board-thumbnail-save` IPC call. Stored in its own small
  `thumbnails.json` map (`{absolutePath: jpegDataUrl}`), deliberately
  NOT inside the `.kanvaz` board files themselves — the Home Screen's
  recent-boards list only ever needed one cheap `fs.statSync()` per
  entry before this, and reading every recent board's full JSON just
  to pull one field out would defeat that, especially for a board with
  embedded video or 3D data. Capped at 50 entries so the map can't grow
  unbounded across a long-running profile. Older boards saved before
  this feature, or an empty board, fall back to the original gradient
  placeholder. A lint warning caught a hardcoded dark background color
  in the canvas draw before it shipped — fixed to read the theme's real
  surface color instead, matching the minimap's own convention.
  Verified live end-to-end: generated a thumbnail from two real note
  cards, saved a board via `saveBoardToPath`, confirmed the `recent-get`
  IPC response carried the matching thumbnail, and confirmed the Home
  Screen tile actually renders it as a background image.

## [7.23.0] — Double-click to rename in the Layers panel

### Added
- **Double-click a Layers row's name to rename it inline**, planned as
  follow-up work after the panel's first pass (v7.20.0), built now.
  Writes through `updateCardData(id, {name: val})` — the same single
  path the on-canvas card-bar rename already uses, not a second
  parallel mechanism — so a commit fires the exact same `cardUpdate`
  event and the panel redraws with the new name for free. Enter
  commits, Escape or an empty/unchanged value cancels, matching the
  on-canvas rename's own behavior exactly.

### Fixed
- **A real double-click did nothing** — caught live when manually
  tested, not by an automated check. The row's own click handler
  rebuilt the entire Layers list (to update the selection highlight)
  on every single click, including the first of the two clicks that
  make up a native double-click — destroying the original name
  element before the browser's `dblclick` event ever got a chance to
  fire on it. Fixed by checking `event.detail` (the browser's own
  click-count for the current sequence) and skipping the rebuild when
  it's greater than 1, so the second click's target — which the
  browser resolves fresh, at the same visual spot — survives long
  enough for `dblclick` to fire correctly. Verified live by manually
  sequencing real `mousedown`/`mouseup`/`click`/`dblclick` events with
  the correct `detail` values end to end: create the input, type a
  name, commit with Enter, and confirm the new name survives a
  `serialise()` round trip.

## [7.22.0] — Layers panel terminology/icon audit, broken release fix

### Fixed
- **Terminology audit across the Layers panel** (direct feedback: "must
  say no layers on this board not cards"):
  - The empty-state message said "No cards on this board yet." inside a
    panel titled "Layers" — now says "No layers on this board yet."
  - The pin icon's tooltip said "Lock"/"Unlock" for the exact same
    `pinned` property the rest of the app already calls "Pin"/"Unpin"
    everywhere else (right-click menu, the P shortcut, the Shortcuts
    overlay) — now says "Pin"/"Unpin" to match.
  - A card with no custom name fell back to its own ad-hoc
    capitalization (`charAt(0).toUpperCase() + slice(1)`), producing
    "Url" instead of "URL", "Gif" instead of "GIF", "Model3d" instead of
    "3D" — now reuses `getCardTypeLabel()`/`CARD_TYPE_LABELS`, the exact
    display names the rest of the app already has for this.
- **Replaced the Layers panel's emoji icons** (🔒/🔓/👁/🚫) with Feather
  Icons SVG paths — MIT-licensed, the same icon set already used across
  the rest of the app (titlebar, toolbar, media controls, annotation
  tools) — since colored emoji glyphs clashed with the app's flat
  line-icon look. Direct feedback: "use only gud svgs from mit lic
  librabires... replace em and put gud ones which will look
  professional."
- **8 consecutive releases (v7.14.0–v7.21.0) shipped with zero Windows/
  macOS/Linux installers** — only the 3 official-plugin zips landed on
  each release page; "Download for Windows" on a broken release gave
  users nothing. Root cause: `gh release create` was run manually right
  after pushing each tag, before the CI build workflow's own draft
  release existed. electron-builder's `--publish always` refuses to
  attach installers to a release that's already published (not draft)
  for that tag — it logs "GitHub release not created — existing type
  not compatible with publishing type" and skips every file, while the
  workflow still reports green because that's just a log line, not a
  failure. Only the separate plugin-zip upload step (plain `gh release
  upload`, no draft-only restriction) actually landed anything. Fixed
  by deleting each broken release (tags kept) and re-running that tag's
  original workflow run so electron-builder gets a clean draft to
  publish into, then re-editing/publishing each one properly. The
  correct sequence is now written directly into
  `.github/workflows/build.yml`'s header comment — wait for CI, find
  the draft it creates, edit and publish THAT one, never create the
  release first.

## [7.21.0] — Home Screen "What's New", New Board color fix

### Added
- **A "What's New" section** on the Home Screen, filling the empty
  space below the template previews on a fresh profile with no recent
  boards yet. Reads the last 3 entries straight off `CHANGELOG.md`
  (main.js's new `changelog-recent` handler — no network call, same
  offline discipline as the bundled templates) rather than a second,
  hand-maintained source of truth. Clicking an entry opens the matching
  GitHub release, same disclosed external-link pattern as the About
  screen's "View on GitHub" button. Verified live: the IPC handler
  returned the real top 3 versions with correct headlines, and the
  panel rendered them exactly as returned.

### Fixed
- **The Home Screen's "New Board" tile was jarringly bright** — direct
  feedback: "new board card look too bright." It used a full 100%-
  opacity solid `var(--color-accent)` fill, while every other accent
  usage in the app (including the exact same "selected" state on a
  canvas card) is a 14%-opacity tint with the solid color reserved for
  small badges, borders, and text. Switched to that same tint-plus-
  border treatment — still visually primary, no longer a wall of raw
  saturated color. Verified live via computed style: background is now
  `rgba(157, 127, 255, 0.14)` with a solid accent border, matching the
  rest of the app's accent convention exactly.

## [7.20.0] — Layers panel

### Added
- **A Layers panel**, its own tab on the side-panel icon rail. Lists
  every card in top-to-bottom z-order (topmost first, matching
  Photoshop/Figma), with a click-to-select row, an eye icon toggling a
  new persisted `hidden` property (distinct from Isolate View's
  transient hide — the two never share a CSS class), and a lock icon
  that's just the existing `pinned` concept exposed here rather than a
  second flag meaning the same thing. Deliberately basic for a first
  pass: no drag-to-reorder yet — z-order still changes via the existing
  Bring to Front / Send to Back actions. Stays live-synced with
  selection changes, card edits, and deletes. Verified live end-to-end:
  the rail button, the list rendering both cards, the eye toggle
  actually hiding the element (`display:none`, confirmed via
  `getComputedStyle`) and surviving a `serialise()` round trip, the
  lock icon, clicking a row actually selecting that card, and clicking
  the eye/lock icons NOT also selecting the row underneath them.

## [7.19.0] — Card grouping, live Shift-resize lock fix

### Added
- **Card grouping (Ctrl+G / Ctrl+Shift+G)**, in the canvas right-click
  menu too. Clicking any member of a group later re-selects the whole
  group (same as clicking one shape in an Illustrator/Figma group), and
  dragging any member already moves the whole group for free via the
  existing multi-select group-drag. Just a shared `groupId` string on
  each card — no separate group entity to keep in sync. Caught and
  fixed while wiring this up: the canvas right-click handler
  unconditionally collapsed the selection to just the right-clicked
  card before building the context menu, which meant the new "Group"
  item (needs 2+ selected) could never actually appear after a real
  multi-select — fixed to preserve an active selection/group the same
  way the plain-click handler already did.

### Fixed
- **Shift-to-lock-aspect-ratio while resizing only worked if Shift was
  already held down before the drag started** — reported as "the shift
  characteristic while resize doesn't work at all." `aspectLock` was
  read once from the initial mousedown event and never rechecked; the
  natural workflow (start dragging freely, then hold Shift once you
  want to lock it) did nothing. Now reads the live modifier state from
  each mousemove event, so toggling Shift up or down mid-drag
  engages/disengages the lock in real time, matching Figma/Photoshop.
  Verified live: dragged a corner freely (ratio drifted to 1.077 on a
  1.5-ratio card), held Shift mid-drag (snapped to exactly 1.500), then
  released Shift and kept dragging (unlocked again to 1.280).
- The Home Screen footer still showed the old two-part "P4inz | Atharva
  Patil" credit — missed in the branding pass that fixed this
  everywhere else (About screen, README, LICENSE, package.json).

## [7.18.0] — Non-destructive image/video adjustments

### Added
- **Brightness/Contrast/Saturation adjustments**, in a new Properties
  panel section for image, GIF, and video cards. Applied as a CSS
  `filter()` on the img/video element itself — never touches the
  card's own `dataUrl`, so nothing is re-encoded and a "Reset
  adjustments" button always gets back to pixel-identical to the
  original. Caught and fixed during implementation, before it ever
  shipped: `buildFullCardRecord()` (cards.js) is a hand-maintained
  field whitelist with its own comment warning about exactly this trap
  — a new persisted per-card field that isn't added there gets silently
  dropped on every save. Added the three new fields there and to the
  matching read-back defaults; a `!= null` check (not `!== undefined`)
  in the filter-string builder handles a deserialised card's missing
  fields coming back as `null` rather than `undefined`, which would
  otherwise emit a silently-broken `brightness(null%)`. Verified live
  end-to-end: set 150%/80%/50%, confirmed the CSS filter and the
  Properties panel both reflected it, ran an actual
  `serialise()`/`deserialise()` round trip and confirmed the values
  survived, and confirmed Reset restores all three to 100%.

## [7.17.0] — Isolate View

### Added
- **Isolate View (Shift+I)** — Maya/Blender's own binding for the same
  feature: hides every card except the current selection, so a busy
  board doesn't visually compete with whatever you're focused on.
  Toggle again or press Escape to bring everything back. Implemented as
  a pure DOM class (`.card-isolated-hidden`) rather than a stored id
  list, so it stays correct even if a card is created or deleted while
  isolated — exiting just strips the class from whatever currently has
  it. Toggling with nothing selected shows a toast instead of silently
  hiding the entire board. Plain `I` still toggles the About screen;
  only `Shift+I` isolates. Verified live: the selected card stayed
  visible, the other two were hidden via `display:none`, and Escape
  restored all three.

## [7.16.0] — Numbered view bookmarks

### Added
- **View bookmarks** — Ctrl+1..9 saves the current pan/zoom to a
  numbered slot, plain 1..9 jumps back to it, Maya/Photoshop-style.
  Deliberately session-only (never written to the board file): the same
  scoping decision this codebase already made for 3D card orbit
  position ("NOT persisted by design"), and it sidesteps any board-file
  schema question entirely. Recalling an unset slot shows a toast
  telling you how to set it instead of doing nothing silently. Digits
  1-9 were completely unbound before this. Verified live: saved a view,
  moved away, recalled it — tx/ty/scale matched exactly; recalling an
  empty slot showed the expected toast and didn't throw.

## [7.15.0] — Tidy up

### Added
- **Tidy up**, the closest thing this app has to Miro/Figma's "Tidy up"
  or Blender's "Arrange." Two entry points: "Tidy up board" in the
  canvas right-click menu (packs every card on the board, no selection
  needed) and "Tidy up selection" in the Properties panel (useful at 2+
  cards, unlike Distribute which needs 3+). Sorts cards by current
  reading order (top-to-bottom, then left-to-right) before laying them
  into a uniform grid sized off the largest card in the set, anchored at
  the group's own top-left corner rather than a fixed board origin, so
  tidying a cluster in the middle of a busy board doesn't relocate it
  across the canvas. Verified live: four scattered cards packed into a
  clean 2×2 grid with zero overlap, in the same reading order they
  started in.

## [7.14.0] — Distribute evenly, Shift+F zoom to selection

### Added
- **Distribute evenly**, in the Properties panel's Align section (shown
  once 3+ cards are selected — with only 2 there's a single gap, nothing
  to make even). Keeps the two outermost cards fixed as anchors and
  spaces every card between them so the *gaps* are equal (Figma's
  "Distribute spacing", not "Distribute centers" — the right choice on a
  reference board where cards are usually different sizes). Verified
  live: three unevenly-spaced cards ended with identical gaps on both
  sides of the middle one.
- **Shift+F — Zoom to Selection**, a real keybinding for a command that
  has existed since v4.9.0 (`KanvazCanvas.zoomToSelection`, reachable
  only via the Command Palette until now) but had no dedicated key,
  unlike everything else in the app. Map View already had this exact
  Shift+F binding for its own separate viewport; Board view's
  `shortcuts.js` just never got the equivalent. Falls back to fitting
  everything when nothing is selected. Verified live: dispatching `F`
  and `Shift+F` routes to `zoomFit` and `zoomToSelection` respectively,
  with no cross-firing.

## [7.13.0] — Group drag, template export/import, confirm-dialog stacking fix

### Added
- **Ctrl/Cmd-click multi-select, with an actual group drag.** Before this,
  the only way to select more than one card was Select All (Ctrl+A), and
  even then dragging any card only moved that one card — reported live
  as "when I select two cards I can't move them together... if a group
  is selected at once it must move, it's common sense." Ctrl/Cmd-clicking
  a card now adds or removes it from the selection, and dragging any
  member of an active multi-selection moves the whole group by the same
  delta. Alignment-snap and grid-snap stay single-card-only during a
  group move — snapping each member independently would distort the
  group's relative spacing instead of preserving it.
- **Export/Import for a single template** in the Template Maker &
  Manager plugin, requested so a template built in Kanvaz "can be given
  to anyone with a compatible version." Export writes a plain-JSON
  `.kanvaztemplate` file via a native save dialog; Import reads one back
  via a native open dialog. The file carries its own format-version
  number, and importing a file from a newer format than this build
  understands fails with a clear message instead of loading a partially
  understood card array.

### Fixed
- **Confirm/delete dialogs could render invisibly behind whatever opened
  them.** `#dialog-overlay` — the single shared surface behind every
  delete/discard/reset confirmation in the app — was styled at
  `z-index: 50000`, lower than the About screen (60000), the Manage
  Profiles dialog (99997), and the Home Screen (99998). Deleting a
  profile from Manage Profiles, for one concrete repro, showed the
  confirmation stuck behind the profile dialog with no visible way to
  confirm or cancel. Caught live, from a screenshot, while testing the
  Manage Profiles flow. `#dialog-overlay` now sits above every other
  modal overlay in the app.
- **The platform badge in README claimed Windows only.** Kanvaz builds
  for Windows, macOS, and Linux (see `package.json`'s `build.win` /
  `build.mac` / `build.linux` targets) — the badge undersold that.
- Standardized the full credit line everywhere it appears (About screen,
  README footer, LICENSE, THIRD_PARTY_NOTICES.md, `package.json`) to
  "Atharva Patil | P4inz | Northbyte Studios" — all three names, in that
  order, consistently.
- The Import toolbar button only ever imported a PureRef `.pur` file —
  every other supported media type (images, GIFs, video, audio, 3D
  models) had no toolbar entry point at all, only the right-click canvas
  menu. Import now opens a multi-select file dialog for every supported
  type; `.pur` import stays on the right-click menu, since it's a
  board-replacing action, not a drop-in-media one.
- **"play() request was interrupted" toast on ordinary video playback.**
  A rapid pause/interrupt rejects the `<video>` element's `play()`
  promise with a benign `AbortError`, which the app's unhandled-
  rejection handler was surfacing as a scary error toast. Non-`AbortError`
  failures still warn; the benign case is now silently swallowed.
- Resize handles were a fixed 12px regardless of card size, and drifted
  off-center on very small or very large cards because their offset was
  hardcoded to match. Both are now `clamp()`-based and share one
  `calc()` half-offset constant, so they stay centered at every size.
- **Properties panel edits could land on the wrong card** — reported
  live as "each property we change in the properties panel must show
  effect quickly, it's like A has B but C has A." Root cause: a note
  card's own textarea fires a card-update event on every blur, even with
  no real change, and focusing the Properties panel's own "+Add
  property" input blurred whichever OTHER note still had DOM focus,
  firing that update for the wrong card mid-edit — an over-broad refresh
  from an earlier fix in the same area re-rendered the panel for that
  wrong card. Fixed by scoping the refresh to the card whose id actually
  matches the open panel, and skipping it entirely while an add-property
  form is mid-edit. Verified live under the exact repro: editing card A
  while card B still holds focus, then saving a property on A, no longer
  touches B.
- The on-card loop/mute toggle and the same toggle in the Properties
  panel could disagree with each other after a click, since only one
  side ever refreshed. Both now stay in sync immediately.
- **The grid became a stretched rectangle whenever the side panel opened
  or closed.** The canvas's pixel buffer was only ever resized on a
  native `window.resize` event; the side panel's flexbox-driven resize
  of its container never fires one, so the grid's bitmap kept its old
  buffer size while its CSS box changed shape around it. Replaced with a
  `ResizeObserver` on the canvas container, verified live: the buffer
  now tracks the container's actual pixel size on every panel toggle,
  square grid cells preserved.
- Deleting or switching away from a board with a heavy embedded 3D model
  could look frozen for several seconds with zero feedback — a genuinely
  slow synchronous parse, not a hang. Both actions now show a "Loading
  board…" toast, deferred just long enough to actually paint before the
  blocking work starts.
- A fast double-click on the titlebar logo, or Ctrl+H pressed twice in
  quick succession, could stack two Home Screen overlays before the
  first one's async data fetch finished — closed with an in-flight
  guard.
- Maya-style Alt+drag now pans the canvas from anywhere, including over
  a card, instead of only working on empty canvas.
- The About screen was rewritten with real Kanvaz-specific copy (it
  previously read as generic placeholder text) and gained a Keyboard
  Shortcuts button; the Shortcuts list documents the new Alt+drag pan.

## [7.12.0] — Search finds Settings, Smart Folder context menu, Home Screen polish

### Fixed
- **The Home Screen could be stacked twice** — a fast double-click on
  the titlebar logo, or Ctrl+H pressed twice in quick succession (or
  held, triggering OS key-repeat), could both pass the "is it already
  open" check before the first call's IPC round trip (fetching recent
  boards/profiles/templates) had actually finished creating the
  overlay — a genuine race, not just a theoretical one, caught during
  this session's own bug-bounty pass. A synchronous in-flight guard
  closes the window. The titlebar logo's click handler was also still
  calling the non-toggling `showHomeScreen()` while every other entry
  point (Ctrl+H, the account menu, the Command Palette) had already
  been switched to `toggleHomeScreen()` — fixed to match.
- **A Home Screen template tile had no double-click guard** (unlike the
  equivalent button in the Boards panel, which disables itself first)
  — a fast double-click could fire the load-template flow twice
  concurrently.
- **Searching "grid" (or any other individual Settings label) returned
  nothing** — direct repro: "when i search a grid which is grid type or
  style why no search results are there?" The search bar's command
  dropdown only ever matched entries in the Command Palette registry,
  and no individual Settings row (Grid style, Grid lines, Autosave,
  etc.) was ever registered there — only the generic "Open Settings"
  command was. Every real Settings row now has its own searchable
  command ("Settings: Grid style"); picking one opens Settings, jumps
  to that row (auto-expanding the collapsed Advanced section if
  needed), and briefly highlights it.
- **The search bar's type-filter dropdown could be left orphaned on
  screen** two different ways: pressing Escape closed the search bar
  but not the dropdown (it renders into `document.body`, not inside the
  search bar itself), and closing the search bar by any other means
  never closed it either. Both fixed.
- **The Home Screen's logo didn't match the real app logo** — direct
  feedback: "why not using same logo as in inside." It was a hand-drawn
  inline SVG approximation instead of the actual icon artwork the
  titlebar and taskbar use. Now the same `icon-128.png`, same circular
  crop, in both places.
- **About screen's version number was hardcoded in three separate
  places**, independent of the real version constant — a real version
  bump only had to be forgotten in one of the three for About to start
  quietly lying about what's installed. Now reads the single source of
  truth.

### Added
- **Ctrl+H toggles the Home Screen** on and off from anywhere, including
  while typing in a note — direct feedback: "keep one shortcut other
  than [the logo] to go and come back to home and canvas, like h or
  whatever feels easy." (Plain H was already taken — Hide Annotations.)
  Also wired into the account menu's "Home Screen" item and the Command
  Palette's "Go to Home Screen" entry, both of which used to risk
  stacking a second overlay if triggered while the Home Screen was
  already open.
- **Smart Folders can now be right-clicked** — direct feedback: "right
  click on search will give options open, fav it with heart svg and
  more." Open / Add to Favorites / Rename / Edit query / Delete, on both
  the search bar's own chip row and the persistent list in the Boards
  side panel. Favorited folders show a filled heart and sort to the
  top in both places. The side panel's Smart Folders section also no
  longer disappears entirely when empty — a short "how to create one"
  hint takes its place instead of nothing.
- **Properties panel: Tags and Info sections** — Tags mirrors the
  on-card tag bar (add/remove chips) without needing to shrink a small
  card down to find it; Info shows the card's own ID with a Copy button,
  useful alongside "Show card/connection IDs" and for anyone scripting
  the MCP Bridge tools.
- **About screen links to Keyboard Shortcuts** and the Shortcuts overlay
  now lists Ctrl+H — the app's two "help" surfaces used to be dead ends
  with no way from one to the other.
- **The Shortcuts overlay has a filter box** — the list passed 30+
  entries across this session's additions with no way to jump straight
  to one; typing narrows both the rows and their column headings.
- **Home Screen header now has one-click Boards / Settings links** —
  direct feedback: "something can be opened directly inside home
  [screen] instead of going to canvaz." Both close the Home Screen and
  land straight on that side-panel section, instead of closing blind
  onto a plain canvas and having to find the rail icon afterward.

### Removed
- **Titlebar's dedicated Save As button** — direct feedback: "remove
  save as in corner near minimize totally since save and save as are
  almost the same so one of em must be removed completely." Save As
  itself isn't gone — Ctrl+Shift+S and the Command Palette still reach
  it — only the redundant titlebar shortcut to it.

### Added
- **Map View: Cluster by Tag (G key)** — a visual grouping toggle, not
  a spatial rearrangement: draws a soft rounded highlight + label
  behind every group of 2+ nodes sharing a primary tag, colored to
  match that tag's existing node-accent color. Deliberately doesn't
  move any node — repositioning saved `mapPosition` data is real work
  with real risk (undo/redo interplay, saved-file drift) a visual-only
  pass sidesteps while still answering "what belongs together."
- **Map View: a mini-map overview**, same idea and position as Board
  View's own (bottom-right, click to pan there), scoped to Map View's
  own independent viewport and node positions rather than sharing
  Board View's minimap module. Respects the existing "Show minimap"
  setting.
- **3D card controls mirrored into the Properties panel** — shading
  mode, background color, and Reset Camera, driven through the same
  live per-card registry the card's own on-canvas toolbar already
  uses (`KanvazCards.getModel3DControls()`), not a second copy of the
  state. Caught and fixed while building this: an always-persisting
  background setter would have pushed a new undo-history entry on
  every drag tick of the color picker instead of once on release —
  split into a live-preview call and a separate commit call, same
  pattern the on-card swatch itself already used.

### Fixed
- **Saving a Smart Folder threw `showPrompt is not defined` and did
  nothing** — caught live, with a screenshot. `showPrompt` is defined
  inside `KanvazUI`'s own IIFE; the search bar's save-folder click
  handler (a different module, `KanvazApp`) called it as a bare
  identifier instead of `KanvazUI.showPrompt(...)`, the same mistake
  the codebase's own established pattern (every other cross-module
  call in this file already goes through the full `KanvazUI.` path)
  would have caught on a read-through. A real, embarrassing miss from
  earlier this session's own `window.prompt()` replacement work.

### Added
- **Search bar now also matches app commands** — Settings, About,
  Shortcuts, and everything else already registered with the Command
  Palette (Ctrl+K) shows up directly under the board search results
  when it matches your query. Direct feedback: "the search tool can
  search settings, tools and about... can be searched from it." The
  capability already existed behind Ctrl+K; this surfaces the same
  matches under the search habit people already reach for first,
  instead of requiring a second shortcut to be discovered separately.

### Changed
- **The search bar's color filter was a bare colored dot** — direct
  feedback: "what is need of color swatch in search panel... put
  logical tools there or else remove." It didn't read as a tool at
  all without hovering for the tooltip. Now a filter-funnel icon,
  tinted to the active filter color instead of a separate swatch —
  the action (filter) and the state (which color) are both visible
  in one glance.

### Added
- **A real Home Screen**, replacing the small centered popup shown on
  launch. Direct feedback: "i want proper it like photoshop not this
  same but liek this... dont keep taht anmoying pop up." Now a genuine
  full-screen surface (no backdrop over the canvas) with a logo header,
  New Board / Open / Start from Template up front, and Recent as a
  real grid of tiles instead of a plain list. The existing "Show Home
  Screen on startup" setting (renamed from "Show recent on startup")
  still turns it off entirely if you don't want it — freedom stays in
  the user's hands, nothing forced.
- **Search bar is now draggable** (a grip handle on the left) —
  direct feedback: "make search bar movable as user want." Position
  is remembered for the session; the command-results and Smart
  Folder chip rows move with it.
- **Smart Folders are now visible in the Boards side panel**, not just
  as chips under a reopened search bar — direct feedback: "i made
  smart folder but i cnat see it anywhere." Click one to reopen the
  search bar with that query applied; delete from the same list.

### Fixed
- **The Kanvaz logo showed square corners around its own circular
  badge artwork** — direct feedback: "logo... lok liek block... make
  it circle." The source icon is a genuine circular badge on a square
  canvas; both places it renders in the UI (titlebar, About screen)
  only applied a small corner-round (4px/9px) instead of a true circle
  mask, leaving the icon's own square canvas edges visible around it.
  Both now use `border-radius: 50%`.

### Changed
- **Branding updated app-wide**: "P4inz | Atharva Patil" — the About
  screen, README footer, package.json's author/copyright, and the Home
  Screen's footer all use the same order. (An earlier pass in this same
  cycle briefly read this as "P4inz Studios" primary/Atharva Patil
  secondary — direct correction: "its not p4inz studio its only p4inz
  | then my name." There is no "Studios" in the name.) The installer's
  internal `appId` is deliberately left as-is (an OS-level identifier,
  not display text — changing it risks breaking auto-update continuity
  for anyone with Kanvaz already installed).
- **The search bar's type filter really is a type filter now** —
  earlier this session it went from a color swatch to a clearer
  filter-funnel icon, but it was still filtering by color underneath.
  Direct correction: "types of ref cards not the color swatch!!!!!!!"
  Replaced outright: click the funnel for a dropdown of card types
  (Image, Video, Note, Color, URL, File, 3D Model, etc.), not a color
  picker. The old color-proximity matching code (dominant-color
  sampling, color-distance threshold) had no other caller once this
  button changed, so it's removed rather than left as dead code.

### Fixed
- **The search bar's command-results dropdown was left orphaned on
  screen after clicking a result** — `hideSearchBar()` cleaned up the
  search bar and the Smart Folder chip row but never the new command-
  results element, so clicking "Open Settings" (for example) closed
  the search bar but left the results box floating on the canvas with
  nothing above it. Caught live, with a screenshot, immediately after
  the feature shipped.
- **Comprehensive live tooltip audit** (84 title/data-tooltip elements
  across the titlebar, toolbar, side panel, search bar, account menu,
  cards, the annotation toolbar, and Map View): zero failures — every
  one correctly suppresses its native title and shows Kanvaz's own
  dark tooltip.
- **The search bar's "Filter by color" swatch still used the old
  native color picker** — missed in the original sweep since it lives
  in the search bar, not on a card; same corner-anchoring bug as the
  color-card swatch had, now using Kanvaz's own picker like every
  other color entry point in the app.
- **Titlebar buttons (Save As, Minimize, Maximize, Close) could still
  show a native OS tooltip**, unstyled — confirmed live. They sit
  inside `#titlebar`'s `-webkit-app-region: drag` region (individually
  marked `no-drag` so clicks work), and Windows' own drag-region hit-
  testing can apparently still let a native tooltip through for a
  plain `title` attribute there, bypassing `tooltip.js`'s suppression
  entirely. Switched those 4 buttons to a `data-tooltip` attribute
  instead — not a real HTML attribute the browser acts on, so there's
  nothing native left to leak — and taught `tooltip.js` to read it as
  a second source alongside `title`.
- **`colorpicker.js`: pressing Escape mid-drag** (dragging the
  saturation/hue square while still holding the mouse button) left the
  drag's `mousemove` listener attached to `document` against a now-
  detached canvas — the very next mouse move computed against a
  zero-size `getBoundingClientRect()`, producing `NaN` saturation/
  value that silently propagated as a garbage hex (`"#NaNNaNNaN"`)
  through the live-preview callback. Found in a static bug-bounty pass
  (no live app run, working alongside the user's own PC use) rather
  than live reproduction — the listener now self-checks and unhooks
  the instant a close is detected, instead of waiting for the mouseup
  that a mid-drag Escape skips past.
- **`KanvazCanvas.drawGrid()` had no null-guard** for its own grid
  canvas/context, unlike Map View's equivalent function — harmless
  while only ever called from canvas.js's own controlled init sequence,
  but this pass added a new call site from `applySettings()` (an
  async, IPC-driven settings load) that didn't exist before. Guarded
  defensively rather than relying on the async timing always working
  out.

### Changed
- **The titlebar's "Save As" button used a share-tray icon** — the
  exact glyph iOS uses for its own Share action, right next to the
  toolbar's plain-disk "Save" button, with no shared visual language
  between the two and a real feature (network sharing) Kanvaz doesn't
  have. Now uses a "copy" icon instead, matching what Save As actually
  does (write a new file with the same content).

### Added
- **A custom Kanvaz-styled color picker** (`colorpicker.js`), replacing
  the native OS/Chromium color dialog everywhere it was used: the
  color-card swatch, the annotation toolbar's custom-color button, and
  the 3D card's background swatch. Saturation/value square, hue strip,
  and a hex field — no more native popups to fight for on-screen
  positioning.
- **Three grid styles**, chosen in Settings → Appearance → "Grid
  style": **Reference** (the existing multi-tier accent grid, default),
  **3D** (adds red/green X/Y origin axis lines, the same convention
  most 3D modeling software uses for its ground plane — useful for
  centering/mirroring reference work), and **Game Dev** (a uniform,
  single-weight tile grid at a 32px base cell with no major/minor
  blending, for pixel/tile alignment work).
- **Map View: Zoom to Selection (Shift+F)** — Board view has had this
  since v4.9.0, but Map View runs its own entirely separate viewport
  and never got an equivalent. Falls back to fitting everything when
  nothing's selected, same as fit-all's own behavior.
- **Per-card-type Properties panel sections**: URL cards get an editable
  link field plus Open/Copy, mirroring the card's own inline controls
  for when the card itself is too small to comfortably use. File-
  reference cards get the resolved path plus Open/Reveal in folder/Copy
  path (a new "Reveal in folder" IPC call, `shell.showItemInFolder`).
  Video and audio cards get a volume slider, playback speed (video),
  and loop toggle (audio) — previously only reachable through the
  card's own hover-only on-canvas controls, easy to miss on a small
  card.
- **Canvas grid stays visible at extreme zoom-out** via a third, coarser
  reference tier (every 25th cell) that keeps its own on-screen spacing
  above the visual-merge threshold even at the lowest zoom level,
  instead of everything density-fading to a blank canvas together.
- **Annotate straight from the Properties panel** — no right-click
  needed. A new "Annotate" section shows the same tool set (pen,
  highlighter, line, arrow, rectangle, ellipse, text, measure,
  eyedropper) and color swatches as the on-card floating toolbar, and
  they drive the exact same shared state — picking a tool here is
  picking it there, not a second, independently-tracked notion of
  "what's selected." Shows a "Start Annotating" button first for cards
  that support it; hidden entirely for card types that don't (note,
  color, URL, file-ref, audio, plain text).

### Fixed
- **The color-card swatch's color picker opened anchored to the
  window's top-left corner, overlapping the side panel** — direct
  feedback: "once spawning it does go to corner and block properties
  opanel." The hidden `<input type="color">` proxy behind the swatch
  had no explicit position, so it defaulted to (0,0), and Chromium's
  own built-in color popup anchors to wherever that underlying input
  actually sits. Fixing the CSS position alone wasn't enough — verified
  with a real screenshot, not just a DOM property check, that the popup
  still opened at (0,0) — because `pointer-events:none` on the proxy
  apparently keeps Chromium from resolving its true on-screen position
  for anchoring. Fixed by sizing and positioning the proxy exactly over
  the real swatch instead (so it's safe to make hit-testable — it can
  only ever intercept a click on the same area the visible swatch
  already occupies, and it's removed the instant the picker closes).
- **Canvas grid faded to fully invisible at maximum zoom-in** — the
  same shape of bug as the zoom-out fade fixed earlier (fades linearly
  to a true 0 right at the reachable extreme), just at the other end.
  Floored instead of zeroed, same fix as before.
- **Undoing a stroke mid-annotation silently kicked you out of
  annotate mode** — direct feedback: "when i ctrl z the annotate tab
  vanishes and i hv to re right click and make it come." Undo/redo
  works by fully rebuilding every card's DOM element from the
  snapshot, which necessarily tears down the annotation overlay and
  toolbar tied to the old element — there's no way around that part.
  What was missing was putting it back: `KanvazHistory.restore()` now
  captures which card had annotate mode active before the rebuild and,
  if that card still exists afterward, re-activates it immediately.
- **Chromium's native spellcheck (red squiggle + inline correction
  bubble) was showing on note and text cards**, unstyled and out of
  place next to the rest of the app's own dark-panel look — and, being
  a Blink text-input behavior rather than something gated by the DOM
  `contextmenu` event, it couldn't be suppressed from the renderer side
  the way a native right-click menu can. Turned off globally via
  `webPreferences.spellcheck: false` in `main.js`, the same call
  already made per-field for rename inputs.
- **Two native `window.prompt()` dialogs** (naming a Smart Folder,
  bulk-tagging cards in Map View) replaced with a Kanvaz-styled prompt
  reusing the existing dialog overlay, now with an optional text field
  (`KanvazUI.showPrompt`).

### Changed
- **Canvas grid** now tints its major lines and intersection points
  with the app's own accent color instead of plain gray/white, at a
  low enough alpha to stay a quiet structural cue — a small step
  toward the grid reading as a real measuring surface rather than a
  flat tiled background.
- **Bare text-label cards** get a quiet dashed outline on hover (hint
  that they're editable, since they otherwise render with zero chrome
  by design) and a higher-contrast placeholder color.

## [7.11.1] — Auto-hide toolbar polish + custom tooltips

### Fixed
- **Auto-hide toolbar (moodlock) hover-reveal reported as unreliable** —
  never reproduced live via CDP even across a full reveal → hide →
  re-reveal cycle, but `-webkit-app-region: drag` strips are a known
  fragile spot for real OS-level mouse hit-testing versus simulated
  input. Added a defensive `mousemove`-based fallback
  (`chromeEdgeMouseMove` in `app.js`) alongside the existing
  `mouseenter`/`mouseleave` handling, gated to `clientX > 44` so
  hovering the always-visible side-panel rail doesn't spuriously
  trigger a reveal.
- **Reveal and hide used the same transition speed** — direct feedback:
  reveal should be fast, the fade back out should be slow. The timing
  actually governing an animation is the one declared on the
  *destination* state's own CSS rule, not the state being left, so the
  hidden-state rule and the revealed-state rule now carry different
  transition durations (0.55s hide, 0.12s reveal) instead of sharing
  one value.
- **Revealed toolbar covered the side panel's top two rail icons** —
  `#top-chrome` and its hover zone spanned `left: 0`, overlapping the
  44px-wide rail once the toolbar left normal flex flow on reveal.
  Both now start at `left: 44px`.

### Added
- **Custom-styled tooltips app-wide**, replacing the browser's native
  title-attribute box. A single global listener (`src/tooltip.js`)
  suppresses the OS tooltip for any element carrying a `title`
  attribute and shows a small dark-panel-styled one instead — every
  existing `title="..."` across the whole codebase gets this for free,
  no per-button changes needed.

## [7.11.0] — Profile export/import, per-profile plugins, Properties Layer section

### Added
- **Export/Import a profile as a portable `.kanvazprofile` file** — take
  a profile (settings, recent files, recovery data, plugin
  enable-state and storage, saved templates) to another machine.
  Import reuses the same zip-slip and zip-bomb guards already built
  for catalog plugin installs (declared-size pre-check, a running
  decompressed-bytes cap, and a resolved-path containment check
  against directory traversal).
- **Plugin enable-state and plugin storage are now per-profile**, not
  shared machine-wide — a plugin you enabled and configured under one
  profile no longer leaks its state into another. Plugin code itself,
  and the catalog of installed plugins, stay machine-wide by design
  (they're not per-user data).
- **File-reference cards now show a real inline image preview** for
  image paths (`.jpg/.jpeg/.png/.gif/.bmp/.webp`), matching the
  existing PDF-preview pattern (read fresh from disk on demand, never
  persisted into the saved board) — plus a bigger default card size
  for both when a preview is available.
- **Start Screen shows a profile indicator and switcher** once more
  than one profile exists, so you don't have to open the side panel
  just to see or change which profile you're in.
- **Properties panel — Layer section**: opacity slider, Bring to
  Front / Send to Back, and (for a 2+ card selection) six alignment
  modes against the selection's shared bounding box.

### Fixed
- **Send to Back didn't reliably send a card behind an *earlier*
  back-sent card** — both landed at a hardcoded `z: 0`, and CSS breaks
  equal-z-index ties by paint order, not by which action happened
  more recently. Now uses an always-decreasing counter, mirroring how
  Bring to Front already used an always-increasing one.
- **Properties panel stuck showing the first card you opened it for**
  — `activeId` was only synced to the live selection once, then never
  again, so switching selection while the panel stayed open kept
  showing stale data. Now resyncs on every render.

### Also in this release
- 6 templates upgraded with real professional-pipeline detail
  (shot-naming conventions, WCAG contrast ratios, render-pass/AOV
  checklists, and similar concrete detail in place of generic
  placeholders), plus a new Character Design template — 14 templates
  total.
- README rewritten for tone (`/humanizer`) — factual content unchanged,
  phrasing and rhythm varied throughout.

## [7.10.0] — 10 new templates + Save as Template

### Added
- **10 new board templates** covering VFX (Beginner, Intermediate, and
  a full studio-scale Professional Pipeline — bid/breakdown through
  asset production, lighting, dailies, and delivery), Game Dev
  (Concept to Production), Music Production, Animation Pipeline
  (2D/3D), Photography/Concept Art Reference, Architecture & Product
  Design, UI/UX Design Reference, and Branding & Identity. 13 templates
  total, up from 3.
- **Save the current board as a new template** — "+ Save current board
  as template" in the side panel's Template gallery. User-saved
  templates live under a separate userData folder (never inside the
  app's own installed package, which is read-only and gets replaced on
  every update) and show a "Yours" badge with a delete option; built-in
  templates can't be deleted this way.

## [7.9.1] — Exceptional-level error debugging

### Fixed
- **Error toasts vanished before they could be read or screenshotted**
  — every toast, error or not, auto-dismissed after a flat 2.8s. Error
  toasts (which can carry real technical detail as of v7.9.0's fix
  below) now stay up 12s, pause on hover, and get an explicit close
  button.
- **An error toast's status icon and its new dismiss button were both
  an "×" shape** — confusing, caught via a live screenshot. The error
  status icon is now a circled exclamation mark instead.
- **The annotation toolbar never scaled with canvas zoom** — direct
  feedback: "the card remains big and the toolbar goes small." The
  toolbar now scales with the current zoom level (clamped to a sane
  range), anchored so it grows away from the card rather than into it.
- Every handled error is now recorded in a session-scoped log (last 25)
  and folded into the "Export debug info" button's clipboard output —
  a bug report now carries the real error history regardless of
  whether a toast was caught in time.

## [7.9.0] — Redesign v1 Phase 3: card visual polish

Card visuals were directly flagged as "outdated" against a design
reference the user provided. This is Phase 3 of the redesign v1 sprint
(`docs/REDESIGN_V1_SPRINT.md`), implemented against that reference
screenshot as the literal spec.

### Changed
- **Every card's name/metadata footer is now always visible**, not a
  hover-only overlay — a card's name and one line of at-a-glance
  metadata (resolution for images/GIFs, duration for video/audio,
  character count for notes) plus a single, consistently-styled type
  pill on the right. Replaces the old single row of small, per-type-
  colored badges (amber for video, red for audio, etc.) crammed next to
  a monospace filename that only appeared on hover.
- **Cards get a larger corner radius** (a new `--radius-card` token,
  independent of `--radius-md` used everywhere else in the app) and a
  real hover elevation (a gentle lift + shadow), replacing a flatter,
  smaller-radius look.
- GIF cards now show their actual resolution in the metadata line
  (`naturalWidth`/`naturalHeight` off the `<img>` element, same as a
  static image) rather than a bare "GIF" badge with no detail — no
  loop-duration data exists anywhere in this codebase to show
  truthfully instead.

## [7.8.0] — Kanvaz Redesign v1: unified side panel + offline Profiles

The "Kanvaz redesign v1" sprint (planned in `docs/REDESIGN_V1_SPRINT.md`),
merged from the `redesign-v1` branch. Two flagship-scale changes plus a
handful of real bugs found and fixed along the way.

### Added
- **A unified left side panel** replacing the old top board-tab strip and
  the floating Settings popover entirely — an always-visible icon rail
  (Boards / Properties / Settings) plus a content pane that opens/closes
  with `S` or a rail click. Boards is now a vertical list (name, card
  count, New board, Start from Template, a Quick Drop zone). Settings is
  reorganized into Appearance / General / Canvas & Input / Files &
  Search / Plugins, plus a collapsible Advanced section split into
  Diagnostics / Plugin Dev / Reset sub-groups. The corner account icon
  (About/Shortcuts/Profile) replaces the old Settings|About|? cluster.
- **A fully offline, multi-profile system** — no login, no cloud, no
  sync: settings, recent boards, and crash-recovery data are now
  partitioned per profile under `userData/profiles/<id>/`. An existing
  install auto-migrates its current settings/recent/recovery into a new
  default profile (named from the OS username) the first time it
  launches after this update — nothing resets. "Manage Profiles…" in the
  corner account menu lists every profile with an avatar (pick any local
  image, auto-downscaled), name, optional description, and a "Guest"
  quick-create; switching relaunches the app after the same unsaved-
  changes save gate the rest of the app already uses. Per-profile plugin
  storage and a Start Screen profile picker are explicitly deferred —
  see `docs/PROFILES_SYSTEM_PLAN.md`.
- **Properties panel now has Transform and Media sections**, Photoshop/
  Illustrator-style: editable X/Y/W/H fields (pinned cards lock X/Y),
  read-only resolution for image/gif/video cards, format for 3D models,
  and an annotation count with a one-click Clear. The panel now also
  correctly follows whatever card is currently selected — it used to
  latch onto the first card it ever showed and never update again.
- The Start Screen (recent boards + New board on a plain launch) is now
  correctly skipped when Kanvaz is opened directly with a `.kanvaz` file
  — it used to still flash on screen underneath the board that was about
  to load.

### Fixed
- **Map View: every node drag threw an uncaught `ReferenceError` and
  surfaced the generic "E999" toast** — reported live. A helper function
  was nested where its own caller (the drag's mousemove handler, in a
  separate top-level function) couldn't reach it; the connection lines
  also silently never redrew mid-drag as a result. Moved to module
  scope; verified with simulated drags that both the crash and the
  stale-line symptom are gone.
- **The Import toolbar button did nothing when clicked** — same class of
  bug as above: it called a method on the wrong module object, which
  didn't exist there, throwing on every click.

## [7.7.0] — Feather Icons + a real crash fix

### Changed
- **Icon set switched to [Feather Icons](https://github.com/feathericons/feather) (MIT License)** across the titlebar (save-as, minimize, maximize/restore, close), the main toolbar (New, Open, Import, Save, zoom in/out, undo/redo, Board/Map view toggle, Settings, About, Shortcuts), video/audio card controls (play, pause, mute, muted, frame-step back/forward, onion-skin), the file-reference card's Open/Change buttons, the annotation dot indicator, and the annotation toolbar (pen, highlighter, arrow, rectangle, ellipse, text — line/measure/eyedropper redrawn at the same convention since Feather has no exact equivalent for those three). Every icon uses Feather's actual path data verbatim at its native 24×24 viewBox/stroke-width-2, so they scale correctly at any rendered size instead of being hand-approximated. Play/pause keep a solid fill instead of Feather's default outline — legibility at 14px matters more than perfect consistency for exactly those two, and solid play/pause is the near-universal convention even in otherwise outline-icon apps. Feather Icons and Three.js (vendored since 7.4.0 but never listed) are now both credited in `THIRD_PARTY_NOTICES.md`.

### Fixed
- **A text annotation could throw an uncaught `NotFoundError` and surface the generic "E999: unexpected error" toast** — found live while verifying the icon changes, unrelated to them. `finishTextInput()`'s `el.parentNode` check wasn't a reliable guard against a specific timing race (a card switch or `deactivate()` detaching the input element between the check and the `removeChild()` call); wrapped the actual removal in a try/catch, since the intent — "make sure this input isn't in the DOM anymore" — holds regardless of which code path actually removed it first.

## [7.6.0] — box-select + a real Import button

### Added
- **Box-select (marquee/rubber-band multi-select)** — Ctrl+left-drag on empty canvas (or press `V` to toggle a mode where a plain left-drag does it, without needing to hold Ctrl) draws a selection box; every card it overlaps becomes the new multi-selection. This capability genuinely didn't exist before — the only way to build a multi-card selection was `Ctrl+A` (everything) or duplicating an existing multi-select; there was no way to select an arbitrary subset by dragging. `KanvazCards.setMultiSelection()` (already existed internally, used by bulk-duplicate) is now also exported publicly for this. `Esc` exits the mode, same convention as every other modal-ish state in the app. The fill color is computed at drag-start via a 1x1-canvas readback of the theme's actual `--color-accent` (a plain CSS variable can't be given partial alpha without `color-mix()`, which isn't available on this app's Electron/Chromium baseline) rather than a hardcoded color that would mismatch a plugin theme.
- **A visible Import toolbar button** — "Import .pur file" existed only buried in the empty-canvas right-click context menu, the least discoverable place for a real, named, README-highlighted feature. Added next to Open/Save where a user would actually look for it.

## [7.5.0] — 3D preview fixes + Reference Mode removed

Direct user feedback on the just-shipped 3D preview feature, acted on the same day: textures weren't loading, wireframe was broken, and orbiting inside a 3D card was dragging the whole board underneath it. All three are real bugs, all three are fixed, all found and verified live (not by static review). Reference Mode was also removed after the user reported it non-functional and unrecoverable (couldn't turn it off, escape hatch didn't work) and asked for it to be deleted rather than kept half-working.

### Fixed
- **Embedded textures silently failed to load on every `.glb`/`.gltf`.** Root cause: Three.js's `GLTFLoader` prefers `ImageBitmapLoader` for embedded texture images (this Chromium supports `createImageBitmap`), and `ImageBitmapLoader`'s load path is `fetch()`-based — it creates a `blob:` URL for each embedded texture and `fetch()`s it. A `fetch()` of ANY scheme, including `blob:`, is governed by CSP's `connect-src`, not `img-src` (which only gates direct `<img>`/CSS `url()` loads and already allowed `blob:`). Kanvaz's `connect-src` never had `blob:`, so every one of these fetches was silently blocked — Normal mode rendered untextured, and Matcap's own `map` passthrough had nothing to show either. Added `blob:` to `connect-src` — a same-process, locally-generated object reference, never real network egress, so this doesn't touch the offline-only guarantee at all. Verified live with a hand-built textured `.glb` fixture: texture loads with zero console errors after the fix, confirmed still failing with a clear `THREE.GLTFLoader: Couldn't load texture` error before it.
- **Wireframe (and Matcap) crashed on any mesh with more than one material slot** — routine in real-world multi-part exports, not an edge case. A mesh's `.material` is an ARRAY when it has multiple geometry groups, not a single `Material` object; the render-mode code called `.clone()`/read `.map` directly on whatever `node.material` was, which threw on an array (no such methods) and silently aborted that part of the scene traversal. `applyRenderMode()` and the disposal path (`disposeModel3DScene()`) now handle both shapes uniformly via a small `model3dAsMaterialArray()` normalizer, building the wireframe/matcap replacement as the same shape (array in, array out) so the renderer and disposal both keep working exactly like the single-material case.
- **Orbiting/panning/zooming inside a 3D card also dragged and zoomed the whole board underneath it.** The 3D viewport never stopped mouse/wheel event propagation — `cards.js`'s world-level mousedown delegate falls through to `startDrag()` for any mousedown on a card that isn't one of a short list of known interactive regions (video scrub bar, tag chips, etc.), and the 3D viewport/toolbar were never added to that list, so every orbit-drag also started a real card drag, and every scroll-to-dolly also zoomed the canvas. Fixed with the same `stopPropagation()` pattern the PDF preview already established for exactly this reason — the viewport's own mousedown now also replicates select/bring-to-front first, so clicking into it still selects the card, it just never starts a board-level drag. Verified live via simulated mouse drag: card position (`x`/`y`) confirmed unchanged before and after a 250px drag inside the viewport.
- **A zero-mesh model (a `.glb`/`.obj`/`.fbx` with only lights/cameras/empty nodes, or a degenerate export) produced a NaN camera** — `THREE.Box3().setFromObject()` on an object with no real geometry leaves the box at its default empty state (`min=+Infinity`, `max=-Infinity`); `getSize()` then yields `-Infinity` per axis and `getCenter()` yields `NaN`. The old `Math.max(...) || 1` fallback never caught this since `-Infinity` is truthy. `frameModel3DCamera()` now detects a non-finite box and substitutes a small default one before computing anything from it.
- **Renaming (or any `updateCardData()` patch on) a 3D card leaked its entire Three.js viewer** — renderer, GPU context, geometries, textures, ResizeObserver, the render loop. `updateCardData()` removes and rebuilds a card's whole DOM element to apply type-dependent structure changes, and `buildModel3DCard()` unconditionally overwrites the `model3dInstances` registry entry with a fresh instance on every rebuild — the OLD one's `dispose()` was never called. A few renames of a 3D card (or an MCP Bridge `updateCard` call) could exhaust Chromium's WebGL context limit. Now calls `disposeModel3D()`/`disposePdfPreview()` before the rebuild, mirroring what `rebuildCardMedia()` already does on its own rebuild path.
- A 3D viewer whose Three.js setup threw partway through construction (plausible cause: hitting the WebGL context limit on a board with several 3D cards already open) leaked whatever renderer/controls/matcap-texture had already been created, since dispose-registration was the very last line of that setup. Moved registration earlier and made the outer error handler call it defensively.
- Multi-clip animated models now disclose (via a tooltip on the scrub bar) that only the first clip plays, instead of silently dropping the rest with no indication anything was skipped.

### Removed
- **Reference Mode (click-through + adjustable window opacity)** — the titlebar button, popover, `T`/`Ctrl+Shift+T` shortcuts, the Command Palette entry, the MCP Bridge `setClickThrough`/`setWindowOpacity` tools, and every IPC/settings plumbing path behind them. Reported by the user as non-functional in a way with no way back (couldn't toggle it off, the keyboard escape hatch didn't respond) and asked for outright, after a scoped attempt to fix it in place first. `alwaysOnTop` (a plain, independently-useful window-manager setting, not click-through-specific) stays — its own Settings section is renamed from "Reference Mode" to "Window" since that was the only real survivor of the old grouping. A new settings migration (v3→v4) drops the now-dead `windowOpacity` key from existing users' saved settings, same "don't leave dead keys sitting in settings.json forever" precedent as `topModeAutoOnTop`'s removal in v6.3.0. MCP Bridge drops from 34 to 32 tools; bumped to 1.2.0.

### Verified
Live via the same Chrome DevTools Protocol technique this whole line has used since v6.6.1. Rebuilt a hand-built textured `.glb` test fixture (previous session's fixture had genuinely corrupt PNG bytes — caught and fixed as a test-fixture bug, not an app bug, by confirming a real PNG decoded fine via `createImageBitmap` before re-testing) and confirmed the texture-load error disappears with the CSP fix in place. Simulated a real orbit-drag via CDP mouse events and confirmed card position is bit-for-bit unchanged before/after. Loaded a genuine user-saved `.kanvaz` file containing a 3D card from an earlier test session and confirmed it now opens and renders with zero errors — it had never actually been corrupted at the container/JSON level, but likely *looked* broken to the user before these exact fixes landed. `node test/validate.js` (all sections, MCP Bridge e2e updated for 32 tools) and `node test/lint.js` both clean.

## [7.4.0] — real 3D model preview (Kanvaz's 5th flagship feature)

The centerpiece of the v7.x line: a genuinely usable 3D model viewer on the canvas, not a static thumbnail. Built to a specific brief — exact-file rendering with a shading-mode toggle now, architecture left open for a future plugin to add custom textures later, plain/functional UI since the real UI is being designed separately in Figma.

### Added
- **New `model3d` card type** — drop in a `.glb`, `.gltf`, `.obj`, or `.fbx` (150MB cap, separate from and tighter than the general 500MB media cap — a model that large is almost always an authoring mistake) and get a live, orbitable 3D viewport right on the card.
- **Three render modes**: Normal (the file's own materials/baked textures, exactly as loaded — no reinterpretation), Wireframe, and Matcap (a procedurally-generated gradient texture in code — no shipped asset file). Switches are instant after the first toggle (materials are built lazily per-mesh and cached, not rebuilt every click).
- **Mouse-drag orbit** via Three.js's `OrbitControls`, plus a background-color swatch and a one-click "reset view" that reframes the camera on the model's bounding box.
- **Animation playback** — play/pause and a scrub bar (styled to match the existing video card's scrub bar), shown only when the loaded model actually has animation clips. Scrubbing while paused seeks exactly; resuming playback re-baselines the clock so the idle gap doesn't jump the clip forward.
- **Render-on-demand, not a continuous loop**: an idle 3D card (not being orbited, no animation playing) costs zero CPU — it re-renders only on an actual camera-move event or an active animation frame. Several idle 3D cards on one board stay cheap.
- Vendored Three.js 0.186.0 (`src/vendor/three/`, ~2.5MB — core + GLTFLoader/OBJLoader/FBXLoader/OrbitControls and their transitive deps, out of a ~0-dependency npm package) rather than the full published package.
- New `model-load` main-process IPC handler (own size cap + extension allowlist, kept separate from `media-load` the same way `pdf-read-bytes` was kept separate in v7.2.0) and `KanvazMedia.loadModelFromPath()`. Drag-drop, folder-drop expansion, and Relink all route `.glb`/`.gltf`/`.obj`/`.fbx` through it automatically based on extension.
- New per-card fields (`modelFormat`, `renderMode`, `bgColor`, `animationPlaying`) added to the save-format whitelist and `deserialise()`'s defaults. Camera orbit position is deliberately **not** persisted — every load starts from the same reframed default view, a disclosed simplicity trade-off.
- **Architecture note for future work**: the card embeds the model's bytes (like image/video/audio), not a file-reference — a deliberate "reference boards should stay self-contained" decision, unlike the PDF preview's disk-reread approach. Material/texture access wasn't restricted in a way that would block a future plugin adding user-swappable custom textures — that capability just isn't built yet.

### Fixed
- **Found while vendoring, not before**: the vendored `three.module.js` (r186+ splits Three's core into `three.module.js` + `three.core.js`, the former re-exporting the latter) was copied without its `three.core.js` half — every loader/controls file that ultimately imports from `three.module.js` failed to load with a generic, misleading "Failed to fetch dynamically imported module" error (Chromium collapses a module-graph resolution failure into this message instead of surfacing the real `net::ERR_FILE_NOT_FOUND` for the missing file). Caught live via CDP, not by static review — `node --check` happily parses a file whose *import target* doesn't exist. Copied the missing 1.4MB file in; net-zero `package.json`/`package-lock.json` diff preserved via the same install-copy-uninstall vendoring discipline as every other vendored library.
- **Found in self-review**: a 3D viewer whose Three.js setup threw partway through construction (most plausible cause: Chromium's WebGL context limit, if a board already has many live 3D cards open) had its dispose-registration as the very last line of that setup — any earlier throw meant the renderer/controls/matcap-texture already created were never released. Moved the dispose registration to right after those objects are created, and the outer error handler now calls it defensively too.
- Single-card delete (`removeCardCore`) never fully released video/audio decoders — it called `.pause()` but not `.removeAttribute('src')` + `.load()`, the fuller release sequence `clearAll()` (board switch/undo/redo) already used. A single deleted video/audio card kept its decoder alive and, if unmuted, audible, until GC eventually caught up. Matched to `clearAll()`'s sequence.

### Verified
Live via the same Chrome DevTools Protocol technique this whole line has used since v6.6.1 — hand-built valid `.glb` (triangle mesh + a 2-second rotation animation clip) and `.obj` test fixtures, created real cards from both, confirmed the viewport renders, all three render-mode buttons switch and persist correctly, background color and reset-view work, animation play/pause toggles correctly and the scrub bar's fill % updates live frame-by-frame during playback, a full `serialise()` → `clearAll()` → `deserialise()` round trip preserves every new field and re-renders cleanly, and delete produces zero uncaught exceptions (confirming disposal doesn't throw). Zero exceptions logged across the entire test run.

## [7.3.0] — annotation, upgraded toward Figma-level

The biggest item on the v7.x line's plan, minus one deliberately-deferred piece (select/move/delete an individual existing stroke — flagged from the start as its own dedicated pass since it touches the stroke data model, not just adds draw tools).

### Added
- **Ellipse, line, and highlighter tools** join pen/arrow/rectangle. Ellipse/line share rect/arrow's existing `{x1,y1,x2,y2}` bounding-box storage, so they get the same 0..1 normalization and legacy-file migration handling for free. Highlighter shares pen's point-array storage and hard-clamps to a max 35% opacity and a minimum 10px width regardless of the toolbar's own width/opacity settings — a highlighter that isn't actually translucent isn't a highlighter.
- **Real text tool** — click to place a genuine `<input>` right over the click point, Enter/blur-with-content commits it as a stroke stamped onto the canvas, Escape or blur-while-empty cancels with nothing drawn or stored.
- **Custom color picker + a recent-colors row**, replacing the fixed-swatch-only palette. A native color input behind a small "+" swatch; anything picked that isn't already a built-in or recent color joins a session-scoped recent-colors row (capped at 6), same in-memory-only scope decision `cards.js`'s own recent-tags feature already made.
- **Per-stroke opacity** (15–100%, via a toolbar slider with a live percentage readout) on every tool. Old files have no `opacity` field at all and default to fully opaque, so they redraw pixel-identical to before this feature.
- Toolbar hover feedback on every tool/width/color button (previously only the width/color swatches showed any interactive state at all), and the toolbar now wraps onto a second row instead of running off-screen — it grew from 5 tools to 9 plus a color picker, recent-colors row, and an opacity slider.

### Fixed
- **Found while adding opacity, not before**: pen and highlighter strokes used to build one continuous canvas path for the whole gesture and re-stroke the ENTIRE path on every single mouse-move frame — invisible at the old fixed 100% opacity (redrawing something fully opaque on top of itself is a no-op visually), but with translucent strokes now possible, that per-frame full-path re-composite would visibly darken a stroke as more points got added, worst wherever the path curved back over itself. Fixed by drawing exactly one short two-point segment per move event instead of the whole cumulative path — the standard approach for translucent multi-segment strokes.

### Verified
Live via the same Chrome DevTools Protocol technique this whole line has used since v6.6.1 — created a real card, drew a real ellipse via simulated mouse drag (correct bounding-box stroke saved), switched to highlighter and confirmed the 35%-opacity/10px-width clamp applied to the saved stroke, opened the text tool and confirmed both the commit path (Enter → stroke saved with the right color/opacity/text) and the cancel path (Escape → nothing saved), set a custom color and confirmed the recent-colors row rendered it, and round-tripped all four new stroke shapes through `loadStrokes()`/`redraw()` with zero uncaught exceptions. One real testing-tool caveat found and worked around: CDP's `Input.dispatchKeyEvent` doesn't reliably route Enter/Escape to a focused `<input>` in this Electron version — verified those two paths by dispatching a real in-page `KeyboardEvent` instead, which exercises the exact same listener code a real keypress would.

## [7.2.0] — real PDF preview on file-reference cards

### Added
- A file-reference card pointing at a `.pdf` now shows a real scroll/zoom/page-nav preview inside the resizable card, instead of just an icon+filename. Powered by pdf.js, vendored as two runtime files in `src/vendor/pdfjs/` (~1.7MB) rather than the full ~35MB npm package (locale data, CJK cmaps, and a demo viewer this app never uses). Never embeds the PDF's bytes into the save file — re-reads from disk on render, same disclosed "breaks if the file moves" limitation every other file-reference card already has. Current page/zoom persist per-card (`pdfPage`/`pdfZoom`).
- New main-process IPC (`pdf-read-bytes`) reads a PDF's raw bytes for preview only — deliberately separate from `media-load`'s embed-forever path.

### Fixed
- pdf.js assumes JS runtime features (`Promise.withResolvers`, the `Iterator` global helpers) newer than what Electron's bundled Chromium ships — hit this twice, once on the main thread and once inside pdf.js's own Worker (which has an entirely separate global scope a main-thread polyfill can't reach). Fixed both with a small, targeted `Promise.withResolvers` polyfill (main thread) and a thin worker wrapper that applies the same patch inside the worker's own scope before loading the real worker script — rather than chasing an older pdfjs-dist version hoping to dodge the gap.

### Verified
Live via the same Chrome DevTools Protocol technique this whole line has used since v6.6.1 — created a real file-reference card pointing at a real (generated) PDF, confirmed the canvas renders at the correct size, page navigation and zoom both work and persist correctly through `serialise()`, and zero uncaught exceptions on the full load/zoom cycle.

## [7.1.0] — MCP Bridge, made flagship-level

A dedicated polish pass on the MCP Bridge official plugin — real bugs fixed, real new capability added, not just a version bump.

### Fixed
- **`updateCard`'s schema was silently missing `properties`.** The plugin's own README already documented "properties" as a supported field (bolded, no less), but `server.js`'s zod schema for `updateCard`'s patch object never actually included it — an AI client trying to set custom Properties-panel metadata through this tool got silently stripped fields instead of an error, since zod drops unrecognized object keys by default rather than rejecting them. Added `properties: z.record(z.string(), z.string())` to match `src/cards.js`'s own `UPDATABLE_FIELDS`.
- **`updateSettings`'s schema still offered `topModeAutoOnTop`**, a setting removed from Kanvaz itself back in v6.0.0 when Top Mode was deleted entirely. Calling it did nothing (the settings-load reconciliation loop only copies known keys), silently. Removed, and added `windowOpacity`/`smartSearchEnabled` — two real, current settings that simply never got added to this schema when they shipped.
- **The in-app "Browse Official Plugins" catalog (`official-plugins/catalog.json`) had been serving stale plugin zips since v4.4.0.** CI's `Package official plugins` step rebuilds a fresh zip for every official plugin at every single tagged release — confirmed via `gh release view v7.0.0` showing `kanvaz-mcp-bridge-7.0.0.zip`, `kanvaz-theme-creator-7.0.0.zip`, etc. already sitting on that release. But the catalog's `downloadUrl` fields were never updated to point at them — Theme Creator and MCP Bridge had been pointing at their original v4.4.0-era assets this entire time, meaning anyone installing via "Browse Official Plugins" got a years-outdated build regardless of how many fixes shipped since. Updated to point at the current release; this needs updating at every future release where one of these plugins actually changes — flagged as a real, disclosed process gap (see `docs/HANDOFF.md`), not something CI enforces automatically yet.

### Added
- **Reference Mode control**: `setClickThrough(enabled)` and `setWindowOpacity(value)` — an AI client can now turn click-through on/off and adjust window opacity directly. `setClickThrough` is idempotent (pass the state you want; it only toggles if that's not already the current state) via a new `KanvazApp.isClickThroughOn()` getter, deliberately friendlier for a tool call than KanvazApp's own raw toggle.
- **Shared cards across boards**: `shareCardToBoard(id, targetBoardId)` and `unlinkSharedCard(id)` — thin pass-throughs to the `KanvazPluginAPI` wrappers added in v6.5.0 specifically so a plugin like this one could reach them.
- 34 tools total now (up from 30), verified end-to-end in `test/mcp-bridge-e2e-test.mjs` — a real MCP client driving the real, unmodified `server.js`, not a mock of the protocol layer. Two of the four new tools get real round-trip assertions against a fake Kanvaz-side listener (`setClickThrough`, `shareCardToBoard`'s refusal path); the other two (`setWindowOpacity`, `unlinkSharedCard`) are covered by the tool-registration/schema checks.
- Plugin version bumped to 1.1.0 (`plugin.json`/`package.json`/the MCP server's own `McpServer({version})`).

### Fixed while writing this entry
Caught mid-edit, before it ever reached a commit: an inserted doc-comment paragraph in `main.js` accidentally closed the enclosing block comment early (a stray `*/`), which would have left the next few lines of real documentation sitting as bare, unparseable text at module scope. Caught by `node --check` before shipping.

## [7.0.0] — resize semantics, media control polish, first release of the v7.x line

The v6.x arc closed out clean at v6.6.2. This is the first release of what comes next: Kanvaz keeps getting developed, now as an ongoing side project driven by real feedback rather than a fixed "final arc" — see `docs/ROADMAP.md`'s "The v7.x line" section for the standing plan.

### Fixed
- **Resize modifier-key semantics were backwards.** Every other design tool (Figma, Photoshop, Illustrator) resizes freely by default and uses Shift to lock proportions. Kanvaz did the opposite — aspect-locked by default, Shift freed it to distort. Flipped to match convention: **free resize by default, Shift locks proportions.** A deliberate, disclosed behavior change, same discipline as v6.3.0's `alwaysOnTop` default flip.
- **A real related bug, found while fixing the above.** The aspect-lock exclusion for card types with no meaningful "natural" ratio (note/audio/url/file/text) was only checked in one of two code paths in `startResize()` — the second path re-derived height from width unconditionally whenever aspect-lock was active, regardless of card type. A note or text card could still get its corner-drag aspect-locked despite the exclusion existing specifically to prevent that. Fixed by computing the lock decision once (`lockThisResize`) and using it in both paths. Verified live: shift-resizing a color card now locks its ratio exactly; shift-resizing a note card stays free, as intended.

### Added
- **Video/audio control icons, redrawn.** `PLAY_ICON`/`PAUSE_ICON`/the frame-step and onion-skin icons sat on a mix of 10x10 and 14x14 viewBoxes with no shared margin convention, rendering at visibly different apparent sizes next to `MUTE_ICON`/`LOOP_ICON`'s 16x16 grid in the same toolbar. All redrawn onto that same 16x16 grid — play/pause stay solid fills (the universal media-player convention), everything else keeps the app's stroke-outline style.
- **Real per-card volume control**, not just mute on/off. A compact slider next to the mute button on video and audio cards, persisted as a new `volume` field (0–1) in the save format — fully additive, old files load with the default (1.0). Raising the slider above 0 while muted auto-unmutes, matching how every OS/browser volume control already behaves. Not delegated through the card engine's central click handler (unlike the play/mute/loop buttons) — a native `<input type="range">` needs its own direct `input` listener to track a drag.

### Verified
Live, via the same Chrome DevTools Protocol technique introduced fixing v6.6.1/v6.6.2 — not a static read-through. Confirmed: free resize distorts a color card's aspect ratio, Shift-resize locks it to exactly the original ratio, a note card stays free even with Shift held, the volume slider updates both the live media element and the persisted card field, and raising volume while muted correctly auto-unmutes. Zero uncaught exceptions across all of it.

## [6.6.2] — the escape hatch out of click-through was also broken

Immediately after v6.6.1 shipped (fixing Reference Mode's button/shortcut/palette entry points), a live follow-up test of the actual Escape-key exit path found a second, more serious bug in the same feature — reported by a user as "after turning on, [it] becomes unclickable" and "I can't even close Kanvaz."

### The bug
`closeAll()` (the function behind the Escape key, in `src/app.js`) still referenced the bare `clickThroughOn`/`toggleClickThrough` identifiers directly — correct back when Reference Mode's code lived in the same scope as `closeAll()`, but v6.6.1 moved that code to `KanvazApp`'s own scope and left this one reference behind. The result: pressing Escape while click-through was on threw its own `ReferenceError`, silently failing to turn click-through back off. Since click-through makes every mouse click (including Kanvaz's own custom close button — this is a frameless window with no native titlebar) pass through to whatever's underneath, a user who enabled click-through via the popover and then relied on Escape to exit had no working mouse-based OR keyboard-based way out short of force-quitting the process. The only thing that could have saved them was the Ctrl+Shift+T global hotkey — which works independently of this bug, but had never been confirmed to register successfully, either.

### Fixed
- `closeAll()` now calls `KanvazApp.toggleClickThrough()` (checked via a new `KanvazApp.isClickThroughOn()` getter) instead of referencing the moved identifiers directly.
- `main.js`'s global-hotkey registration (`Ctrl+Shift+T`) now checks `globalShortcut.register()`'s return value — it silently returns `false` if another running application already owns that exact accelerator system-wide — and tells the renderer immediately if it failed, which shows a clear toast explaining Escape is still the fallback. Previously this failure mode was completely silent: a user could enable click-through with their one safety hotkey already dead and have no way to find out except by needing it.

### Verified, this time with a real reproduction technique
Both this bug and v6.6.1's were found and confirmed fixed by actually driving the running packaged app — not a static read-through. Launched with `electron --remote-debugging-port=NNNN .`, connected over the real Chrome DevTools Protocol using the `ws` package (already a project dependency, no new one added), and used `Runtime.evaluate` to call the real exported functions and `Runtime.exceptionThrown`/console capture to confirm zero uncaught errors on the full on → Escape → off cycle. This is a real, if lightweight, upgrade over the boot-test-only verification every prior release in this arc disclosed — still not a substitute for a proper Playwright/`_electron` driver, but a meaningfully better bar than before.

## [6.6.1] — Reference Mode was actually broken since v6.0.0

A user reported "Reference Mode did an error" right after v6.6.0 shipped. This is that fix.

### The bug
Clicking the Reference Mode titlebar button threw `ReferenceError: showReferenceModePopover is not defined` instead of opening its click-through/opacity popover. The `T` keyboard shortcut and the Command Palette's "Toggle Click-Through" entry were equally broken — both call `KanvazApp.toggleClickThrough()`, which didn't exist. **This has been broken since v6.0.0 first shipped Reference Mode** — every release since then, including this arc's own dedicated v6.6.0 UI-polish pass, missed it.

Root cause: the entire Reference Mode implementation (`toggleClickThrough`, `setWindowOpacity`, `showReferenceModePopover`, the click-through-escape-hatch listener) had been written inside the wrong internal module in `src/app.js` — nested inside the `window.KanvazUI` IIFE instead of `KanvazApp`'s own scope, where `bindGlobalUI()`'s button handler and `shortcuts.js`/`commands.js`'s calls actually look for it. A plain scoping mistake, invisible to every static check this project runs (syntax check, lint, `node --check` all passed — the code was valid JavaScript, just unreachable from where it needed to be called), and invisible to the boot-test verification every release in this arc has relied on, since starting the app cleanly never requires clicking the button that was actually broken.

### How this was actually found and verified this time
Every prior release in this arc disclosed the same limitation — "not yet manually GUI-verified, no Playwright/`_electron` driver exists for this project." This fix was different: launched the packaged app with `--remote-debugging-port`, connected directly to its real running renderer over the Chrome DevTools Protocol (`ws` npm package, already a dependency), and used `Runtime.evaluate` to actually click the Reference Mode button and read back both the console's `ReferenceError` and, after the fix, confirm the popover opens, `KanvazApp.toggleClickThrough` exists and works, and the button's active state toggles correctly — a real reproduction and a real verification, not a static read-through.

### Fixed
- Moved the whole Reference Mode block to `KanvazApp`'s own scope (next to `toggleAlwaysOnTop`/`syncAlwaysOnTop`, the closely related always-on-top toggle it was designed to pair with). `toggleClickThrough`/`setWindowOpacity` are now genuinely on `KanvazApp`'s returned API (they were previously, incorrectly, only on `KanvazUI`'s).

## [6.6.0] — Final UI polish, closing the v6.x arc

Seventh and last release of the v6.x arc — the dedicated polish pass planned from the start to happen only once every pillar was functionally complete, so it reflects what actually shipped instead of getting redone every time a feature underneath it changed.

### Audit
A full pass over every screen/control this whole arc added: Reference Mode's click-through/opacity popover (v6.0.0), the measure/eyedropper toolbar and video frame-stepping/onion-skin controls (v6.1.0), Smart Folders chips and the color-search swatch (v6.2.0), the Smart Search settings row (v6.3.0), the shared-card badge and "Share to board"/"Unlink" context-menu items (v6.4.0), and the new Template Maker & Manager plugin's settings panel (v6.5.0) — checked each for CSS-variable usage (vs. a hardcoded color that would look wrong in the other theme), spacing/typography consistency against the rest of the app, and hover/transition parity with equivalent existing controls.

**Result: the arc held up well.** Every new surface was already built on Kanvaz's existing theme-variable system (`var(--color-*)`) rather than hardcoded colors — a `grep` sweep across every file this arc touched for a raw hex color outside an actual color-picker/swatch context turned up exactly one hit.

### Fixed
- Reference Mode popover's click-through toggle switch was missing the `transition: left 0.2s` its own thumb needed to animate smoothly between states — every other toggle switch in Settings (and the plugin-enable switches) already has it. One-line fix; the popover's toggle now feels identical to every other toggle in the app instead of snapping instantly.

### Scope, disclosed
This was a code-level audit, not an interactive click-through in a live window — the standing limitation every release in this arc has disclosed (no Playwright/`_electron` driver built for this project yet; a boot-test confirming the app starts cleanly is as far as automated verification goes today). A future session building that driver (see the `run` skill's Electron pattern) would be a genuine improvement to how confidently future UI changes can be verified.

**This closes the v6.x arc.** All three pillars — Live Reference (v6.0.0–v6.1.0), Never Lose Anything Again (v6.2.0–v6.4.0), and Wide-Open Plugin Ecosystem (v6.5.0) — are shipped, tested, and documented. Per `docs/ROADMAP.md` and `README.md`, this really is the plan reaching its stated end.

## [6.5.0] — Wide-Open Plugin Ecosystem

Sixth release of the v6.x arc, and the whole of Pillar 3. The final pillar before this arc's last phase (a dedicated UI-polish pass across everything shipped since v6.0.0).

### Added
- **A richer plugin API — fully additive, zero breaking changes.** `createCardFromData(data, x, y)` inserts any card type (including a built-in like `image` or `video`) from a plain object shaped like `getCards()`'s own output — the missing piece that makes a real template importer possible without a plugin reimplementing every built-in card type's construction logic. `shareCardToBoard`/`unlinkSharedCard` expose v6.4.0's shared-cards mechanism directly. `showToast`/`showConfirmDialog` let a plugin's own UI match Kanvaz's built-in look instead of reinventing it. `fetchCommunityTemplates`/`fetchTemplateContent` read the new community-templates catalog (below). `kanvazApiVersion` stays at `1` — it's an exact-match compatibility gate for a genuinely breaking change (see `plugin-loader.js`), not a feature counter, the same precedent 4.3.0 already set when it added `registerCommand`/`on()`/the Runtime Data API without bumping it. Every existing plugin — `theme-creator`, `mcp-bridge`, and any third-party one already installed — keeps working completely unchanged.
- **`docs/PLUGIN_AUTHORING.md`, rewritten** with all of the above, plus a new, explicit **"Selling your plugin"** section: yes — sell your plugin wherever you want (Gumroad, itch.io, your own site), at whatever price, with zero revenue sharing or registration required. Kanvaz will never add in-app payments or a marketplace — a considered decision, not an oversight, since the moment Kanvaz itself processes money it's on the hook for refunds/fraud/tax forever, exactly the kind of ongoing liability this entire arc has been trying to avoid everywhere else. One real constraint is disclosed rather than glossed over: a plugin's own network calls are subject to the same page-wide Content-Security-Policy as Kanvaz's own renderer (plugins share the page context, not a sandboxed iframe), so a phone-home license check silently won't work — sell it as a one-time download instead, the same trust model as any other paid desktop tool.
- **Template Maker & Manager**, a new official plugin (`official-plugins/template-maker/`, zero permissions requested): save the current board as a reusable template, manage your own collection (insert/rename/delete), and browse/install community-submitted ones. Community templates live in a new `community-templates/catalog.json` in this repo, fetched through the same fixed-URL, main-process-only, no-server pattern "Browse Official Plugins" already established (`main.js`'s new `templates-catalog-fetch`/`templates-catalog-fetch-item` IPC handlers, restricted to `raw.githubusercontent.com`) — submitting one is a plain pull request (see `community-templates/README.md`), not something requiring ongoing manual curation.

### Fixed (found while building the Template Maker plugin's own storage path)
- Per-plugin storage has a real 5MB cap (`plugin-loader.js`) that an image/video-heavy board's embedded `dataUrl`s can exceed easily — the plugin's "save as template" and "install from community" flows now actually check `storage.save()`'s `{ ok, error }` result instead of assuming a resolved Promise means a successful write; a rejected save now surfaces a clear error instead of claiming "Saved" while persisting nothing.

### Scope, disclosed
- Community templates are JSON-only (no embedded media) — a template built from note/text/color/url cards works great; one that depends on embedded images/video won't fetch its media back on someone else's machine, since there's no CDN behind this catalog to host binary assets.
- Full per-plugin process isolation (a real sandbox, not the current same-page-context trust model) remains explicitly declined — see `SECURITY.md`; this release doesn't change that trade-off, only what's reachable *within* it.

## [6.4.0] — Shared cards across boards

Fifth release of the v6.x arc, and the last piece of the "Never Lose Anything Again" pillar (see `docs/ROADMAP.md`) — deliberately saved for last in that pillar specifically so it got the most scrutiny before shipping, since it's the most invasive change of the three.

### Added
- **Shared cards** (Are.na-style) — the same card can now live on more than one board in one `.kanvaz` file with zero duplication. Right-click any card → **Share to board**, pick a board, and a linked instance appears there. Edit the card's content (text, media, tags, annotations — anything except its position/size on a given board) from *either* board and the change is there the next time you open the other one. A small chain badge (⛓) on the card bar marks a card as shared; **Unlink from shared card** forks it back into its own independent copy.
- **Format**: a new top-level `sharedCards` registry in the `.kanvaz` file holds each shared card's content once, keyed by a stable `sharedId`; each board's own `cards[]` array stores only a lightweight stub (`sharedId` + position/size/z/pinned/opacity) for every instance. Old files simply have no stubs referencing anything, so they load as an empty registry — no migration needed, fully additive.
- **A real regression test** (`test/shared-cards-test.js`, wired into `validate.js`) — round-trips the actual `src/boards.js` registry logic: content persists and updates across a simulated board switch, per-instance position/size stay independent, sharing to the currently-open board is correctly refused, and an unreferenced shared card gets pruned from the file on save.

### Fixed (found by this release's own review pass, before shipping)
- **Undo/redo used to corrupt a shared card outright.** `KanvazHistory`'s snapshot relied on the same `KanvazCards.serialise()` used for the save file — which, for a shared card, returns a content-less stub (no `type`, no `text`, no `sharedId` even). Every undo push was silently losing that card's entire content and its shared link; restoring one turned it into a broken card. Fixed with a dedicated `KanvazCards.serialiseForHistory()` that always snapshots the complete, unsplit record — undo/redo now has nothing to do with the save-file registry split. See `src/history.js` and `src/cards.js` for the full reasoning in-line.
- Restoring an old undo snapshot's content for a shared card would previously have been silently overwritten by whatever the *current*, mutable registry held — meaning undo couldn't actually revert a text/content edit on a shared card. Fixed: a full-content restore (from history) now writes back into the registry instead of reading from it, exactly like any other edit to a shared card would.
- **Duplicate (Ctrl+D)** used to keep the same `sharedId` on the copy, silently turning "make an independent copy" into "add another linked instance to this board" — a surprising result given every other duplicated field is independent. Duplicate now always forks to a private copy; use *Share to board* if a linked instance is actually what you want.

### Scope, disclosed
- Text cards don't show the shared-card badge (they render as a bare floating label with no card-bar chrome) — sharing still works correctly, it's just not visually flagged on that one card type.
- Sharing only works one board at a time via the context-menu picker; there's no bulk "share these 5 cards to board X" yet.
- This is local-file sharing across boards in the same `.kanvaz` file, not real-time multi-user collaboration — only one board is ever "live" at once, so an edit is visible on another board the next time *you* switch to it, not instantly in a second open window.

## [6.3.0] — Smart Search: on-device, pure-JS, zero native dependencies

Fourth release of the v6.x arc: the first genuinely "AI-adjacent" piece of the "Never Lose Anything Again" pillar. Comes with a real architecture story worth reading, not just a feature list.

### The dependency decision
The original plan was a real transformer model (`@xenova/transformers`) for true semantic search. Installing it revealed a real problem before any of it shipped: it pulls in `onnxruntime-node` and `sharp`, both **native binary dependencies** — compiled per-OS/per-architecture, requiring Electron-ABI rebuilds this project has no CI step for, and exactly the kind of dependency that silently breaks on a future Electron upgrade with nothing catching it. That's the opposite of "leave it needing no attention for 2 years."

Reversed that decision (uninstalled before anything was committed) and rebuilt Smart Search on **`wink-nlp` + `wink-eng-lite-web-model` + `wink-distance`** instead — pure JavaScript, zero native code, zero dependencies of their own, ~4.5MB total. Less powerful than a full transformer model (lemmatization + fuzzy bag-of-words matching, not deep semantic understanding), but something that will still work, unmodified, on every platform, forever — no rebuild step, no ABI to break.

### Added
- **Smart Search** — an on-device enhancement layer over the existing substring search: type "cars" and it finds a card whose text only says "car" (lemmatization handles plurals/tenses); type "red car" and cards with more of those words rank above cards with fewer (bag-of-words cosine similarity). Runs in its own long-lived worker thread, exactly like `.pur` import's own worker pattern, so it never blocks the UI.
- **A real, explicit off switch** (Settings → Smart Search, default **off**) — when it's off, the ~4MB language model never loads into memory, the worker never spawns, nothing NLP-related exists in the running process. Built first, before the feature itself, specifically so the off switch was never a bolted-on afterthought.
- **A real regression test** (`test/smart-search-test.js`, wired into `validate.js`) — spawns the actual worker process (not just the lemmatization logic in isolation) and verifies plural/tense matching, ranking order, empty-query safety, and re-index behavior against it directly.

### Fixed (found by this release's own review pass, before shipping)
- Smart Search's async reveal used to ignore an active color filter (v6.2.0), silently breaking the "must match both" contract between the two features.
- Turning Smart Search off while a search was still in flight left that request's promise permanently unresolved — a real dangling-promise leak, now resolved the same way a worker crash already correctly was.
- A worker crash used to leave the Settings checkbox claiming Smart Search was still on while the feature was actually dead — the worker now tells the renderer directly, which flips the setting off and explains why.
- No timeout guard existed on worker calls, unlike the project's own established pattern for this exact risk (MCP Bridge, `.pur` import) — added.
- The full board's text got re-lemmatized on every single debounced keystroke instead of once per search session — fixed; a card edited while search stays open won't reflect in Smart Search until the bar is reopened, a disclosed, accepted staleness window (the always-accurate substring pass never depends on this index).

### Verified beyond the usual `validate.js` pass
Directly launched the packaged Electron app (not just static checks) to confirm it boots cleanly with the new worker-thread dependency present — the one thing this release genuinely couldn't have skipped given a brand-new dependency surface was involved.

## [6.2.0] — Smart Folders + color search

Third release of the v6.x arc: the first two, safest pieces of the "Never Lose Anything Again" pillar (see `docs/ROADMAP.md`) — no save-format changes, no new dependencies, both built directly on the existing Board View search.

### Added
- **Smart Folders** — a saved search that keeps re-running itself (Eagle's own standout feature). Type a search, click the star button to name and save it, then click that saved chip any time to instantly re-apply it. Stored in `settings.json`, not per-board — these are reusable query patterns, not board-specific content.
- **Color search** — click the swatch button in the search bar to pick a color; cards get dimmed exactly like a text mismatch already does, based on each card's dominant color. Color cards use their own known color directly; image/GIF cards get a cheap 8×8 downscale-and-average sample, computed once per session and cached in memory only (never written to the `.kanvaz` file — no save-format change, no migration). Combines with a text query via AND when both are active.

### Scope, disclosed
- Video cards are skipped for color search — sampling a live `<video>`'s current frame would tie the cached "dominant color" to whatever frame happened to be showing the first time search ran, a worse inconsistency than not supporting it yet.
- Map View's own search bar doesn't get Smart Folders or color search this pass — it already duplicates Board View's search logic wholesale (a known gap flagged in v5.3.0's audit), and this pass deliberately didn't add more to that duplicated surface rather than grow the debt further.

## [6.1.0] — Measure, eyedropper, video frame-stepping, onion-skin

Second release of the v6.x arc, closing out the rest of the "Live Reference" pillar (see `docs/ROADMAP.md`) — the ArtDeck-inspired half of "beat PureRef at its own game."

### Added
- **Measure tool**, in the same annotation toolbar as pen/arrow/rectangle. Drag to draw a line and see its pixel distance live; the finished measurement is saved and stays on the card like any other annotation. Stored with the exact same `{x1,y1,x2,y2}` shape arrow/rectangle already use, so it gets the same 0–1 size-independent positioning and legacy-file migration handling automatically — no separate code path needed for either.
- **Eyedropper tool** — click anywhere on an image or video card to sample the actual pixel color under the cursor (not just an annotation drawn on top of it), copy it to the clipboard, and set it as the active annotation color. Correctly accounts for `object-fit: cover`/`contain` cropping so the sampled point matches what's actually visible, not the raw underlying image coordinates.
- **Video frame-stepping** — two new buttons in the video scrub bar step backward/forward by roughly one frame (a fixed 1/30s approximation; disclosed rather than claimed as frame-accurate, since HTML5 `<video>` has no reliable cross-browser way to detect a file's real frame rate or seek to an exact frame index).
- **Onion-skin for video** — a toggle that ghosts the previous frame at reduced opacity while you step through, for checking animation timing/spacing the way a real onion-skin tool does.

### Carried forward
Pinning the window on top of one specific app only (PureRef 2.0's newer trick) remains unattempted — flagged from the start as needing real per-OS focus-tracking code, and still an open question whether it's worth the platform-specific complexity versus the plain always-on-top this arc already shipped in v6.0.0. The rest of the v6.x arc (local AI search, Smart Folders, color search, cards shared across boards, the plugin-ecosystem pillar, and the final UI-polish pass) hasn't started — see `docs/ROADMAP.md`.

## [6.0.0] — Reference Mode: click-through, opacity, always-on-top by default

**Development has reopened.** v5.3.0 called itself the finish line — that stands as an honest record of the decision made at the time, not a promise that was broken. The user chose to start a new, deliberately final arc instead: a full market analysis against PureRef and every other major competitor in this space, aimed at closing every remaining real gap in one considered push, then genuinely stopping. This is the first release of that arc.

### Why this one first
PureRef's actual reason for existing isn't the reference board — it's Always-on-Top paired with click-through, so an artist can trace or color-match straight through the window into Photoshop/ZBrush/whatever else, without ever switching focus. Kanvaz had an Always-on-Top toggle but not the click-through half, and it defaulted off — so the one feature that defines this entire category was both incomplete and not even on by default. This release closes that gap directly.

### Changed
- **Always-on-top now defaults to on**, for new installs and existing ones alike (a genuine, disclosed behavior change — see the settings migration below, not something quietly different for new users only). Still one click away from off, via Settings → Reference Mode, or the Command Palette.
- **Top Mode is removed entirely** — its whole reason to exist (a one-key way to float the window on top and get the chrome out of the way) is now just how Kanvaz behaves by default, so a separate toggle-into-a-special-mode for it made no sense to keep. Its Tab/Ctrl+Shift+F shortcuts, its Settings toggle, and its on-screen badge are all gone. The Auto-hide-toolbar setting it used to share machinery with is untouched and still works exactly as before.
- **The `T` key and the titlebar's pin-style button** used to toggle Always-on-Top; both are repointed to the new click-through toggle instead, since Always-on-Top no longer needs a dedicated fast toggle once it's just always on.

### Added
- **Click-through** — toggle it (T, the titlebar button, or Command Palette) and the Kanvaz window stops intercepting clicks, letting them pass straight to whatever's underneath, while itself staying visible on top. Exiting works two ways: Escape (while Kanvaz still has focus) or **Ctrl+Shift+T**, registered as a real system-wide hotkey only while click-through is active, specifically because clicking through very likely hands OS focus to the app underneath — an ordinary in-app shortcut can't be trusted to still fire at that point.
- **Window opacity slider**, in the same new "Reference Mode" popover as the click-through toggle. Floored at 20%, never lower — a window you can no longer see and can no longer click is a dead end, not a feature.

### Carried forward, not attempted this pass
This is one focused slice of a larger plan, not the whole thing — the rest ships as its own tested releases rather than one giant, harder-to-verify change:
- Pinning the window on top of one specific app only (PureRef 2.0's newer trick) — flagged from the start as the hardest part of this pillar; needs OS-specific focus-tracking code on each platform, and isn't attempted here.
- Video frame-stepping, onion-skinning, a measuring tool, and a color eyedropper (the ArtDeck-inspired half of this pillar).
- The search/organization pillar (local AI search with a full off switch, Smart Folders, color search, and cards shared across boards).
- The plugin-ecosystem pillar (richer plugin API, an official "you can sell this" guide, and the Template Maker/Manager plugin).
- The dedicated UI-polish pass across everything from this whole arc, planned as the last phase once the rest is done.

## [5.3.0] — Finish line: bug bounty, fixes, and what's next

The final planned release of this development arc. No new features — a real audit/bug-hunt pass across the full v4.7.0–v5.2.0 diff (8 finder passes covering correctness, removed-behavior regressions, cross-file breakage, reuse, simplification, efficiency, and architectural depth), with real fixes applied before shipping, not just a list handed back unactioned.

### Fixed (found by this release's own audit pass)
- **Annotation data corruption when Map View is active.** `getCardSize()` read `offsetWidth`/`offsetHeight` first, which reads `0` for any element inside a `display:none` ancestor — exactly what Map View does to the whole board while it's the active view. Opening a pre-4.9.1 board while Map View was open silently migrated legacy annotation coordinates against a wrong fallback size and wrote the corrupted result straight back into the save file. Fixed by reading the card's own inline `style.width`/`style.height` first — set at render time regardless of visibility, so it never depends on layout at all.
- **Legacy-stroke migration only checked a stroke's first point.** A stroke that happened to start near a card's corner (e.g. `x1=1, y1=1`) but extended well past it was misclassified as already-normalized and skipped migration entirely, corrupting its position on the next redraw. Now every coordinate in a stroke is checked, not just the first.
- **Pinned + selected card shadow broke in light theme** — a real regression from this same arc's own v5.2.0 theme-variable cleanup. Removing the old `!important` (needed to beat `.card.selected.pinned`'s higher CSS specificity) left that rule's stale hardcoded dark-theme literal winning unconditionally in both themes. Fixed by having `.card.selected.pinned` reference the same `--shadow-card-selected` variable `.card.selected` already does — nothing left to win, since both rules now agree.
- **Remembered card sizes and recent tags leaked across boards.** Both were introduced in v5.2.0 as module-level state with no reset path. Resizing a Note on Board A and switching to Board B meant new Notes on B silently inherited Board A's size, and B's tag autocomplete showed A's recent tags — a real cross-board leak, wider than the "session-scoped" description in the v5.2.0 entry above. Fixed with a dedicated reset tied to the actual board-transition boundary (new board / switch / open / recovery / template-restore), deliberately *not* wired into the same path undo/redo uses, so a plain Ctrl+Z no longer wipes them either.
- **Bulk-tagging via Map View flooded the recent-tags list with old tags.** `setTagsCore()` marked every tag in a card's full new tag list as "recently used," including tags the card already had — bulk-tagging 50 cards each carrying 5 unrelated tags buried the one tag actually just typed. Now only genuinely new tags count.
- **Starting a board from a template fired the `boardLoad` plugin event before any cards existed.** Every other board-load path deserialises cards first and fires the event after; the Template Gallery did it backwards. A plugin reacting to `boardLoad` via `getAll()` would see zero cards. `newBoard()` now accepts an optional initial-cards argument so this path matches every other one.

### Fixed — performance
- **Map View group-drag re-queried the DOM and rebuilt the connection SVG on every mousemove.** Dragging a large multi-selection issued one `document.querySelector` per selected node plus a full `renderLines()` SVG rebuild per mousemove event — the same per-frame-rebuild cost the existing window-resize handler had already learned to coalesce through a single `requestAnimationFrame`, just not yet applied to this newer drag path. Fixed the same way: element references cached once at drag start, `renderLines()` coalesced through one in-flight rAF during a drag (with a final synchronous call on drag-end so the very last frame is never left stale).
- **Dropping a large folder froze the whole app.** The folder-drop handler used `fs.statSync`/`fs.readdirSync` in a loop on Electron's main process — which also owns the native window's message pump — so a folder with thousands of files, or one on a slow network drive, blocked every window and all IPC for the duration (the same class of bug the v4.6.0 `.pur`-import hang was). Switched to `fs.promises` with per-folder entries stat'd in parallel.

### Known, deliberately not refactored this pass
Two reuse/duplication findings from the audit were left alone rather than risked this close to the final release: `src/main.js`'s new URL-preview fetch helper duplicates most of the pre-existing `httpsGetBuffer()`'s redirect/timeout/size-cap logic instead of sharing it, and the Template Gallery's overlay construction (`ui.js`) copies the Official Plugins browser's overlay pattern verbatim rather than through a shared helper (the same floating-panel pattern is separately hand-duplicated a third time in Map View's search bar and bulk-action bar). Both are real, nameable cleanup opportunities — logged here rather than quietly refactored under time pressure with no further testing pass to catch a mistake.

### What's next for Kanvaz

**This is the last actively-developed version of Kanvaz for the foreseeable future.** Four feature releases (v5.0.0–v5.2.0) plus this audit/finish-line pass close out the development arc that began after v4.6.1. There's no dated plan for a v5.4.0.

This doesn't mean Kanvaz stops working, or that real bugs go unfixed — it means new feature development isn't on a continued release cadence. If you hit a real bug, or have a feature you'd genuinely find valuable, [open a GitHub issue](https://github.com/p4inz-code/kanvaz/issues) on this repo, or email **atharva.patil.cg@gmail.com** directly. Both are read; neither is guaranteed a release, but both are how anything further happens from here.

## [5.2.0] — Backlog sweep: tags, sizing, guides, palette, notes, plugin docs

Third release of the post-v4.9.0 arc: every item still open from v4.9.0's original "Closing the Drawer" list gets closed out here.

### Added
- **Recently-used tags** — the tag-input autocomplete now shows up to 8 recently-used tags immediately on focus (before typing anything), for one-click re-add. Session-scoped (in-memory), not persisted across restarts — the pain point this solves is re-tagging many cards in one sitting, not remembering tags from a week ago.
- **Remembered card size per type** — Note/Text/Color/URL/File cards now default to whatever size you last resized that type to, instead of a fixed default every time. Also session-scoped. Media types (image/video/gif/audio) are deliberately excluded — their initial size is already driven by the actual file's dimensions.
- **Snapping/alignment guides** — dragging a card now snaps its left/center/right and top/center/bottom to any other card's matching edge within a small threshold, with a thin guide line while it's active (same idea as Figma/Illustrator smart guides). Deliberately only active when grid-snap is off, so the two features don't fight card-by-card.
- **Color card: palette mode** — a color card can now hold a small strip of saved swatches, not just one color. Click "+" to save the current color, click a saved swatch to switch to it, right-click a swatch to remove it.
- **Note: Markdown preview** — a toggle button renders a note's text as basic Markdown (headings, bold/italic, inline code, links, lists) instead of plain text. Deliberately small — a readability preview, not a spec-complete parser — and HTML-escapes the source text before any markdown substitution runs, so a note can never inject a live tag into the page.
- **Plugin authoring docs + scaffold** — [`docs/PLUGIN_AUTHORING.md`](docs/PLUGIN_AUTHORING.md) is a practical, task-oriented walkthrough (as opposed to `docs/PLUGIN_SYSTEM_DRAFT.md`, which is the internal design/status doc); [`docs/plugin-scaffold/`](docs/plugin-scaffold/) is a copy-and-rename starting point with a working example command/storage/event hookup. Deliberately kept outside `official-plugins/` since that folder is CI-zipped as release assets — this is a template, not a shippable plugin.

### Fixed
- **Bulk-tag undo batching** (flagged since v4.7.0) — Map View's bulk "Tag" action used to call `setTags()` once per selected card, pushing one undo step per card instead of one for the whole batch. New `KanvazCards.setTagsMultiple()` applies the change to every card first, then pushes exactly one history entry for the batch — same pattern `deleteMultiple()` already used for bulk delete.
- **`[data-theme="light"]` CSS cleanup** — 5 rules (`.card`, `.card.selected`'s shadow, `#context-menu`, `.ctx-item:hover`, `.view-toggle-btn.view-toggle-active`) used to live only as hardcoded `[data-theme="light"]`-scoped overrides, invisible to any plugin theme (a plugin sets its own `data-theme` id, never the literal string `"light"`). Promoted to real CSS variables (`--shadow-card`, `--shadow-card-selected`, `--shadow-context-menu`, `--shadow-toggle-active`, `--tint-hover`) defined in both the dark and light theme blocks — a plugin theme with a light background can now correctly override them too, the same way it already can for every other `--color-*` token. Zero visual change for the two built-in themes; `.card.selected`'s accent-ring border-color override is the only rule that remains theme-selector-scoped, since it's a genuine per-theme color choice, not a luminance-tunable shadow.

## [5.1.0] — Template gallery

Second release of the post-v4.9.0 arc: the free template-gallery idea raised mid-session (referencing [storyflow.so/templates/filmmaking](https://storyflow.so/templates/filmmaking) as a growth/onboarding reference point), scoped and shipped.

### Added
- **"Start from Template"** — new button next to "New board" in the board tab bar. Opens a small gallery listing bundled starter boards; picking one creates a new board pre-populated with that template's cards.
- **Three starter templates**, bundled with the app (`assets/templates/`) — Filmmaking (shot references, mood, color palette), Game Art (concept art, style references, materials/FX, palette), and Mood Board (a looser, freeform layout). Each is a plain JSON array of card objects (text/note/color cards only, no embedded binary assets), read via a new main-process-only `templates-list`/`template-load` IPC pair (renderer has no filesystem access of its own).
- **Shape decision, made explicit**: this is an in-app feature reusing the same bundled-catalog pattern Browse Official Plugins already established — not a separate website/landing page — and needs **zero network exception**, unlike Browse Official Plugins or the new v5.0.0 URL preview: the templates ship inside the installer itself.

### Not included this release
Only 3 templates shipped, matching the "at least 3" done-bar in `docs/ROADMAP.md` — more can be added later without any code change (just a new JSON file + a manifest entry), so this isn't treated as a gap needing a follow-up release.

## [5.0.0] — Annotation drift fix, URL/File card previews

First release of the new post-v4.9.0 arc: four feature releases plus a fifth polish/future-proofing pass to close out this stretch of Kanvaz's active development. This one finishes v4.9.0's biggest carried-forward item and adds the two card-preview features the user asked for directly.

### Fixed
- **Annotation resize-drift**, flagged as a known bug since 4.6.0. Root cause: `annotate.js` stored every stroke's points as absolute CSS-pixel coordinates from the moment they were drawn, but `redraw()` (used both live and on file load) replayed them at those same absolute coordinates regardless of the card's current size — so any card that was ever resized after being annotated, then saved and reloaded, showed its strokes in the wrong place relative to the new size. Fixed by storing stroke points as 0–1 fractions of the card's width/height instead, denormalized against the card's *current* size on every redraw — annotations now track the card correctly across any resize, including across a save/reload. Old saves migrate automatically and silently: a point value clearly outside the 0–1 range is recognized as pre-5.0.0 absolute-pixel data and converted once, using the card's current size (best-effort for a card resized between drawing and this fix shipping — still strictly better than the unbounded drift it replaces). No new save-format version field needed; the migration is self-describing.

### Added
- **URL card: "Fetch preview" button.** Click it to pull a title and thumbnail image for the pasted link — the one deliberate, disclosed exception to Kanvaz's "no background network calls" rule (see SECURITY.md). It is opt-in *per click*, never automatic: nothing fires on paste, on typing, or on loading a board. The main process fetches the page's HTML (capped 512KB) to read `og:title`/`<title>` and `og:image`, then the image itself (capped 2MB) if present, and embeds both into the card — a saved preview never re-fetches on reload.
- **File reference card: type-specific icon.** Previously every file card showed the same flat folder icon regardless of what it pointed at. Now shows a document-shaped icon with a short extension-derived label (PDF, ZIP, DOC, XLS, PPT, or the raw extension) — derived from the path string alone, no file read, no network.

### Carried forward from v4.9.0, not attempted this pass
Recently-used tags, remembered card size per type, snapping/alignment guides, `[data-theme="light"]` CSS selector cleanup, plugin authoring docs + scaffold template, and bulk-tag-per-card undo batching are all still open — see `docs/ROADMAP.md` for where they're now scoped (v5.2.0).

## [4.9.0] — Auto-update progress, Zoom to Selection

A deliberately small, fast release under real time pressure (three releases requested in one sitting) — picked the smallest, safest, highest-confidence items from the planned v4.9.0 scope rather than rush the larger, riskier ones. See "Carried forward" below for what that means was NOT attempted this pass, and why.

### Added
- **Auto-updater download progress.** The update flow used to go straight from "found" to total silence until "ready to restart" — `autoUpdater`'s own `download-progress` event was already firing the whole time, nothing was listening to it. Now surfaces at 25% milestones via toast (not a live progress bar — `toast()` always creates a fresh element per call with no in-place-update path, and progress events fire far more often than every 25%, so a toast per event would spam the corner of the screen).
- **"Zoom to Selection"** — new command (Ctrl+K → Zoom to Selection). Falls back to the normal fit-everything behavior when nothing is selected. No dedicated keyboard shortcut: `F`/`Shift+F` both already resolve to the existing "Zoom to Fit," and every other easy modifier combination is already claimed — Command Palette is enough surface for something used this occasionally.

### Carried forward, not attempted this pass
Given the time constraint this release shipped under, everything higher-risk or more time-consuming than the two items above was deliberately left for a dedicated future pass rather than rushed:
- Annotation resize-drift fix (needs a real data-migration decision, not a quick patch — see the v4.6.0 entry for the original writeup of the bug)
- Recently-used tags, remembered card size per type, snapping/alignment guides
- URL card completeness check, color-card multi-swatch/palette mode, note markdown preview
- `[data-theme="light"]` CSS selector cleanup
- Plugin authoring docs + scaffold template
- Bulk-tag-per-card undo batching (flagged as a known gap since v4.7.0)

## [4.8.0] — `.pur`: broader formats, plus a folder-drop shortcut

The first slice of the planned ".pur: Full Round-Trip" release — scoped down deliberately this pass (see "Not included" below) rather than rush the riskier pieces after v4.6.1's lesson that `.pur` format assumptions need real verification, not just confidence.

### Added
- **WebP detection in `.pur` import.** Extracted via WebP's own RIFF chunk-size header field — no scanning ambiguity, same reliable approach BMP already used. "RIFF" alone is too generic a signature (WAV/AVI share it), so the WEBP fourCC is explicitly verified before accepting a match; a non-WebP RIFF file is correctly rejected rather than misread as one (regression-tested with a synthetic fake-WAV case).
- **Folder-drop auto-arrange.** Dropping a folder of loose images/video/audio onto the canvas now expands it (non-recursive — a folder's own direct contents, not a full directory tree) and grid-arranges everything inside, the same fast "dump it in" workflow `.pur` import's own grid fallback (v4.6.1) already gives PureRef users, now available to everyone else too. The renderer has no filesystem access of its own (`contextIsolation`, no `nodeIntegration`), so a new main-process-only IPC handler resolves what a dropped folder actually contains.

### Not included this release, deliberately
`.pur` export and deeper import fidelity (groups, rotation, exact scale, z-order) are real, larger pieces of work that deserve actual verification against real PureRef files before shipping — exactly the lesson v4.6.1 already paid for once. Rather than rush them to hit a version-count target, they're carried forward to the next `.pur`-focused release instead of shipped half-checked. TIFF detection is also deferred: unlike every format detected so far, TIFF has no simple fixed-offset length field or reliable trailer — determining a TIFF image's true size means actually parsing its IFD (tag directory) structure, meaningfully more work to get right than the box this release scoped.

## [4.7.0] — Organize & Connect

First release of the new post-v4.6.1 arc: users are showing real interest in Map View and `.pur` import specifically, so those get continued dedicated investment instead of the old, now-superseded v5.0.0 backlog (see `docs/ROADMAP.md`). This release covers everything about seeing and managing a growing board.

### Added
- **Board View: card renaming.** There was previously no rename UI anywhere in Board View — only Map View (since 4.6.0). Double-click a card's name in its card-bar, or right-click → Rename. Goes through the same `updateCardData()` path everything else uses, so undo/dirty-flag/MCP Bridge all stay in sync. Shares its "what does the name label actually show" logic (note-content preview vs. plain name) with the card-bar's normal render, via one extracted helper, so the two can't quietly drift apart.
- **Map View: search/filter.** Ctrl+F or `/` opens a search bar (matching Board View's own — same name/type/tag substring matching), dimming non-matching nodes. Fixed a real routing bug in the process: pressing Ctrl+F while Map View was open used to silently open Board View's search overlay instead, which sits behind Map View's fullscreen container — invisible and useless until Map View was closed.
- **Map View: multi-select + bulk actions.** Shift+click a node to toggle it into a multi-selection; Shift+drag on empty space to marquee-select. Dragging any node that's part of an active selection moves the whole group together. A floating bar appears with Tag / Delete / Clear actions for everything selected. Bulk delete goes through one `deleteMultiple()` call (a single undo step for the whole batch, not one per card) — bulk tag currently pushes one undo step per card, a known minor gap (still fully undoable, just needs more than one Ctrl+Z for a large batch).
- **Map View: color-code nodes by tag or type.** A thin accent stripe on each node — by the card's first tag if it has one (a deterministic hash so the same tag always gets the same color), otherwise by card type. Implemented as a separate child element rather than the node's own border-color, so it never fights with hover/selection/multi-select, all three of which already claim that.

### Fixed
- **Tag chips ignored card size entirely.** Flat `9px` in `main.css`, unlike the video/audio scrub-time label right next to them (already using a container-query-relative `clamp()`). Now scales proportionally with the card instead of staying frozen — cramped-and-tiny on a huge card, unreadable on a small one.
- **Video/audio controls popped in and out of existence instead of resizing smoothly.** The scrub-time label and mute button used a hard `display:none` at fixed card-width breakpoints (140px/200px) — `display` can't be animated, so they'd simply vanish or appear mid-drag with no transition. Switched to `max-width`/`opacity`/`margin` collapsing, which — unlike `display` — actually animates, so crossing those same breakpoints now shrinks the controls away instead of snapping.
- **The dot-grid background faded to fully invisible right at maximum zoom-out**, in both Board View and Map View — exactly the moment a spatial reference matters most on a large board. The fade curve was written to reach zero exactly at `ZOOM_MIN`; retargeted to a floor below the reachable zoom range instead, so the grid stays faintly visible everywhere the user can actually zoom to. The separate density-based fade (screen-space line spacing, unrelated to this) still handles the original "lines merge into a wash" problem on its own.

### Known, deliberately not fixed this pass
- Bulk-tagging via Map View's multi-select pushes one undo-history entry per card instead of one for the whole batch (unlike bulk-delete, which already batches correctly). Still fully reversible, just not in a single Ctrl+Z for a large selection.

## [4.6.1] — `.pur` importer: fixed for real files, not just test fixtures

v4.6.0's `.pur` fix solved the hang, but every test up to that point ran
against hand-built synthetic files. Live-tested against an actual PureRef
file this release and found the importer still silently failing — "0
images" on a file that genuinely had a photo in it. Two real format
assumptions were wrong, not one.

### Fixed
- **Only PNG was ever recognized.** A real PureRef board can embed JPEG
  (confirmed: the test file's one photo was JPEG, not PNG, and the
  scanner never even looked for a JPEG signature). Generalized to a
  format table — PNG, JPEG, GIF, BMP — the scan now finds whichever
  signature occurs earliest, not just PNG's. JPEG/GIF/BMP images now also
  get the correct MIME type in their `data:` URL instead of being
  mislabeled `image/png`.
- **The fixed 224-byte header assumption didn't hold.** A real PureRef
  2.1.x file has a variable-length version-string preamble instead — its
  one embedded image started at byte ~106, well before where the old code
  started scanning (224), so it was skipped entirely regardless of the
  PNG/JPEG issue above. `canvas`/`zoom` were never used in this function's
  return value anyway, so the image scan now starts from byte 0 — finds
  the same images either way on an older-format file, no longer misses
  them on a file with a shorter or differently-shaped header.
- **Real files interleave item records between images, not strictly
  after them.** The scanner used to treat every byte between one image
  and the next detected image signature as filler ("duplicate" 4-byte
  transform-id refs) — but a real file's actual position/scale data for
  image #1 sat in that gap, ahead of an internal PureRef thumbnail that
  happened to be the "next image." That data was getting shredded into
  meaningless 4-byte chunks and skipped past entirely, which is why the
  import still came back with zero results even after the JPEG fix. Now
  stops scanning for more images the instant a real item marker is seen,
  handing off to item-parsing at exactly that point instead of sailing
  past it.
- **New: grid-fallback when transform-linking still finds nothing.** The
  byte-level item layout above is reverse-engineered and won't hold for
  every PureRef version forever. If linking produces zero results despite
  real images being found in the file, every real (non-thumbnail-sized)
  image now gets placed on a simple grid instead of the import coming
  back empty — a working import beats a silent failure. This fallback is
  also what a real PureRef file in this release actually exercises, not
  a hypothetical safety net.
- **Caught and fixed a genuine perf regression while building the above**,
  before it shipped: an early version of the multi-format scan re-ran
  `indexOf` for all 4 formats on every single iteration regardless of
  whether anything changed, which re-amplified the exact O(n²) blowup
  4.6.0 had just fixed (measured: 40,000 images regressed from ~50ms back
  up to ~51 seconds). Fixed with per-format position caching — each
  format's next occurrence is only re-searched once the scan has advanced
  past its last known position. `test/pur-import-test.js`'s existing
  performance regression test caught this immediately.
- Regression-tested: `test/pur-import-test.js` gained a synthetic
  JPEG-only, no-linkable-item fixture (Test E) exercising the new format
  detection and grid fallback together — the real test file itself isn't
  shippable as a checked-in fixture (personal file, real copyrighted
  content), so this synthetic case stands in for it. The extracted image
  from the real file was independently verified by writing it back out
  to a real `.jpg` and visually confirming it decoded correctly.

## [4.6.0] — Text cards, Map View rename/preview, and a real bug-hunt pass

Three requests landed at once: a bare text-label card type, bigger resize
handles, and an urgent fix for `.pur` imports hanging the whole app. Fixing
the importer meant reading through the rest of the app's mutation/undo/
viewport code with the same scrutiny, which turned up a dozen more real
bugs — most of them long-standing, none of them hypothetical.

### Fixed — auto-updater, caught by live-testing this release
- **Auto-download had no confirmation step.** `autoUpdater.autoDownload`
  was `true` — the moment a newer version was found, it silently started
  downloading, with no way to say no. Now `false`; the renderer asks
  first ("Download automatically" / "Open release page" / "Later"), and
  only calls the new `download-update` IPC once the user actually agrees.
- **The portable build's update flow was actively misleading.** Live-
  tested running `Kanvaz 4.5.1.exe` (the portable target, not the NSIS
  Setup installer) — it still found an update, "downloaded" it, and
  offered "Restart & Install" as if it were the installed build. It
  isn't: electron-updater has no concept of a portable Windows target at
  all (confirmed — zero mentions of "portable" anywhere in its source),
  and `quitAndInstall()` would run the downloaded NSIS installer against
  an exe that was never actually "installed" anywhere, which does not
  update the running portable file in any well-defined way. Now detected
  via `process.env.PORTABLE_EXECUTABLE_FILE` (electron-builder's own
  documented signal for a portable-launched process) — a portable build
  never gets the auto-download option at all, only a link to the release
  page with an explanation of why.

### Added
- **Text card** (`type: 'text'`) — a bare floating label with no
  background/border/card-bar chrome, for titling a section of the board
  directly. Distinct from Note (a boxed textarea) on purpose. Resizes,
  tags, and is MCP-Bridge-creatable exactly like every other card type;
  excluded from flip/annotate/reset-size the same way Note/Color/Audio
  already are, since there's no visual media to act on.
- **Map View: inline rename** — double-click a node's name, or right-click
  → Rename. There was no rename UI anywhere in Kanvaz before this;
  Properties panel only ever displayed the name read-only. Goes through
  the same `updateCardData()` path MCP Bridge's `updateCard` tool uses, so
  undo/dirty-flag/Board-View's own card-bar all stay in sync.
- **Map View: hover preview** — hovering a node for ~350ms shows a bigger
  look at its actual content: the real image for image/gif, a swatch+hex
  for color, a text excerpt for note/text, the URL/path for url/file. No
  cheap way to grab a real video frame or waveform from Map View (those
  elements only exist in Board View's DOM), so video/audio fall back to
  an icon — an honest scope limit, not an oversight.
- **Bigger resize handles** — 8px → 12px hit area, repositioned to stay
  centered on the same point relative to the card edge. The handle
  actively being dragged now also grows further and every handle on that
  card stays fully visible for the drag's duration — previously handle
  opacity was pure CSS `:hover`, so dragging one away from the card made
  it (and its siblings) fade out mid-drag.

### Fixed — critical: `.pur` (PureRef) import could hang the entire app
- **Ran synchronously on Electron's main process** (`main.js`'s
  `pur-import` IPC handler) — the same process that owns the native
  window's message pump, so any nontrivial file (real PureRef boards
  routinely embed hundreds of images) froze the whole app, not just the
  import, showing as "(Not Responding)". Now runs in a `worker_thread`
  (`src/pur-import-worker.js`) with a 30s timeout backstop.
- **O(n²) transform-linking** in `pur-import.js` — nested scans over an
  `images` array that routinely holds thousands of entries on real files.
  Replaced with `absStart`/`transform-id`-keyed maps, O(n). Measured
  directly: 40,000 images went from ~1.2s to ~50ms.
  Also added a hard cap so a genuinely malformed file fails fast with a
  clear error instead of grinding.
- Caught a second bug while wiring the worker thread itself:
  `postMessage` structured-clones a Node `Buffer` down to a plain
  `Uint8Array` on the receiving side, which lacks the `.readDoubleBE()`/
  `.readUInt32BE()` methods the parser depends on — fixed with an
  explicit re-wrap in the worker.
- Regression-tested at three levels (`test/pur-import-test.js`):
  correctness on a hand-built synthetic file, the O(n)-vs-O(n²) timing
  gap (verified failing against the reverted code before trusting it),
  and the real `worker_thread` round trip — not just the pure function.

### Fixed — found during the resulting audit pass
- **Undo could silently corrupt its own history.** `history.js`'s
  `restore()` handed `KanvazCards.deserialise()` the undo stack's own
  objects directly; `deserialise()` adopts whatever it's given as the
  live cards, so any edit made right after an undo (drag, resize, a tag
  removal's splice) rewrote that stored snapshot in place. Concretely:
  move A, move B, undo, drag A again, undo — the second undo no longer
  moved A back, because the snapshot it restored had been overwritten
  in the meantime. Fixed by always handing `deserialise()` fresh clones.
- **Board switching/opening could land at the wrong pan position.**
  `panTo()` followed by `setZoom()` fought each other — `setZoom`'s
  pivot math rewrites tx/ty based on the ratio from whatever scale the
  *previous* board happened to be at, throwing away the pan just
  restored. New `KanvazCanvas.setViewport(tx, ty, scale)` assigns all
  three in one shot.
- **Video/audio kept playing (and leaking decoders) after board switch,
  file open, or undo/redo.** `clearAll()` removed card DOM elements
  without pausing media first, unlike single-card delete. Fixed to
  pause + release the decoder before removal, every time.
- **Annotations drew in the wrong place at any zoom other than 100%.**
  A HiDPI fix along the way had dropped the `/scale` term needed to
  convert screen pixels back to the card's own coordinate space.
- **Annotations didn't flip with their card.** `flipCard()` only ever
  transformed the media element; the annotation overlay is a sibling,
  not a child, so a circled detail stayed put while the image mirrored
  under it. Now the overlay gets the same transform, on both live flip
  and board load.
- **Autosave ran unconditionally every tick**, re-serializing every
  card's full embedded media even when nothing had changed, with no
  guard against overlapping writes. Now skips clean boards and won't
  start a new write while one's still in flight.
- **Every save spent real CPU DEFLATE-compressing already-compressed
  media** (JPEG/PNG/MP4/...) for zero size benefit — measured 15x
  slower than STORE for identical output size. Assets now use STORE;
  `board.json` itself is unaffected.
- **Dragging a GIF card paused/unpaused it every time** — the GIF image
  is the only media element built without `pointer-events:none` (needed
  for click-to-pause), so a drag's mouseup fired a native click the same
  as an intentional pause toggle. Now shares the same post-drag
  suppression every other card-body click handler already uses.
- **Resize handles could detach a card from the cursor's opposite edge**
  — dragging a left/top handle past the card's own far edge kept
  tracking the raw pointer delta even after width/height had floored at
  the minimum, so the card ran away with the mouse. Position is now
  derived from the fixed opposite edge using the final clamped size,
  which also fixes aspect-lock's corner-anchor drift on the same path.
- **Zoom was additive, not multiplicative** — wildly non-uniform steps
  (huge near the zoom floor, invisible near the ceiling), 100% could
  become permanently unreachable once either limit was touched, and a
  wheel event with `deltaY === 0` (Shift+wheel, trackpad horizontal
  scroll) zoomed out with no vertical input at all. Now multiplicative
  and magnitude-aware, with an explicit `deltaY === 0` no-op.
- **Minimap click-to-pan landed in the wrong place at non-100% zoom** —
  passed world coordinates to a screen-space API without the missing
  `* scale` conversion `map-view.js`'s equivalent code already had right.
- **A card patched via MCP Bridge's `updateCard` (or any plugin) lost
  its visible annotations** until a full reload — `updateCardData()`
  rebuilds the card's DOM element without telling the annotation system,
  which then refused to reattach to a fresh element for that card id.
  The strokes were never actually lost, just invisible.

### Known, deliberately not fixed this pass
- Annotations still drift after save/reload if the card was ever
  resized — the canvas *bitmap* rescales correctly, but the *stored
  stroke coordinates* don't, so replaying them against the card's new
  size lands them at the old scale. Fixing this properly means either
  normalizing stored coordinates to 0..1 or versioning the save format
  to migrate existing absolute-coordinate strokes — a deliberate decision
  to make, not a quick patch, so it's flagged here rather than rushed.

## [4.5.1] — Release build fix (CI only, no app changes)

v4.4.0 and v4.5.0's GitHub Release builds never actually finished: the
macOS leg of CI failed identically on all three of the last three tag
pushes (v4.3.0, v4.4.0, v4.5.0) with `EEXIST: file already exists, link
'...icon.icns' -> '...icon.icns'` — a long-standing, still-unfixed
electron-builder bug where its hard-link-instead-of-copy optimization
collides with an already-existing target file
([electron-builder#6570](https://github.com/electron-userland/electron-builder/issues/6570)
and related reports going back to the 22.x line). Windows and Linux built
fine every time; only the mac `.dmg` was ever missing, which is why v4.4.0
and v4.5.0's releases sat stuck as incomplete drafts instead of publishing.

### Fixed
- `.github/workflows/build.yml` now sets `USE_HARD_LINKS: false` on the
  build step — the documented community workaround, forcing electron-builder
  to copy instead of hard-link. Costs a little extra CI disk I/O, not worth
  caring about.
- The `v4.4.0` and `v4.5.0` tags are left exactly as they were (never
  rewritten — they're the accurate historical record of that code); their
  incomplete draft releases were deleted since they were never public and
  this release supersedes them as the first one that actually publishes
  cleanly with all three platform installers plus the official plugin zips.

No application code changed in this release — see the 4.5.0 entry below for
what's actually new to use.

## [4.5.0] — MCP Bridge: Whole-App Access

Widens MCP Bridge from "read/write cards" to nearly the entire app, on
request, once the goal became clear: automate as much of Kanvaz as possible
from an AI agent. One deliberate exclusion — plugin management — kept for
the same reason it's always been off-limits, and structurally enforced, not
just a rule nobody's supposed to break: plugin enable/disable/approval state
lives entirely in `plugin-state.json`, a file nothing in `KanvazPluginAPI`
has ever had a path to touch.

### Added — 19 new MCP tools (30 total)
- **Board management**: `createBoard`, `listBoards`, `switchBoard`,
  `renameBoard`, `deleteBoard`, `saveBoard`. Everything operates by board id,
  never array index — an index isn't safe to assume stable across separate
  AI-issued calls. `deleteBoard` is the one tool on the whole surface that
  isn't undo-reversible (undo history is per-board, wiped on every
  switch/load) — it's stateless-confirm-gated as a result: call once without
  `confirm` to see what would be deleted, again with `confirm:true` to
  actually delete it. `saveBoard` never opens the native OS Save dialog
  (which would just hang waiting for a mouse click that isn't coming) —
  it uses the board's existing path if it has one, otherwise takes an
  explicit `path` argument to establish one.
- **History & view**: `undo`, `redo`, `zoomIn`/`zoomOut`/`zoomReset`/
  `zoomFit`, `toggleMapView`.
- **Card extras**: `flipCard`, `duplicateCard`, `bringCardToFront`/
  `sendCardToBack`. `updateCard`'s patch also gained a `properties` field
  (the same custom key-value object the Properties panel edits — no new
  plumbing needed, it was already a plain object field on the card, exactly
  like `tags`).
- **Settings**: `getSettings`/`updateSettings`, covering everything Settings
  → Appearance/Behavior/Files/Developer exposes except plugin management.

### Meta
- Wrote up the multi-lens review process from 4.4.0 as a standing practice —
  `docs/AUDIT_METHODOLOGY.md` — instead of a one-off, per explicit request to
  keep running it every time.
- **Run for this release, with one deviation worth recording honestly**: the
  usual 8-parallel-agent fan-out (one per lens) hit a background-agent
  session capacity limit and every agent failed before producing findings.
  Rather than skip the pass, it ran as a single-threaded manual review
  covering the same lenses — security, correctness, Electron/IPC boundary,
  privacy/offline-ethos, end-user QA, and cross-file consistency (plugin
  ergonomics and performance were reasoned through but less exhaustively
  than a dedicated pass would). Verified directly: the confirm-gate on
  `deleteBoard` can't be bypassed; `updateSettings`'s key whitelist holds
  against unknown/prototype-style keys; `switchBoard` reuses the same
  non-destructive path the tab bar already uses (no data-loss risk);
  `saveBoard`'s Promise correctly resolves before crossing the IPC pipe
  (traced through the existing `onInvoke` promise-chain wrapper); the
  hand-kept settings zod schema in `server.js` matches `SETTINGS_DEFAULTS`
  in `src/ui.js` key-for-key (18/18); every `server.registerTool` call has
  exactly one matching `case` in `main.js`'s `handleInvoke` and vice versa
  (30/30, no orphans either direction); `listBoards` doesn't leak file
  paths the way card tools intentionally do. No defects found — a clean
  result, not a skipped one. Full test suite (`validate.js`, the MCP
  bridge e2e test, `format-roundtrip-test.js`) reconfirmed passing after.

## [4.4.0] — Plugin Ecosystem: Hardening, Distribution & MCP Bridge

The flagship reference plugin the plugin system was always building toward:
Kanvaz becomes agent-controllable via MCP, not just AI-assisted. Ships
alongside the audit-flagged gaps (permission enforcement, CI packaging) that
made sense to finally close now that a high-permission official plugin
exists to actually test them against.

### Added — MCP Bridge (flagship official plugin)
- **A local MCP server** (`official-plugins/mcp-bridge`) exposing the active
  board to any MCP-compatible AI client (Claude Desktop, Claude Code, ...) —
  list/get/create/update/delete/tag cards, add a reference from a file path
  or URL, search, list/create connections. **Off by default** — installing
  it does nothing, approving it does nothing, the local listener itself only
  opens once you separately flip it on in Settings → Plugins.
- **Local IPC only, never a network port.** A named pipe on Windows, a Unix
  domain socket on macOS/Linux — nothing outside this machine's kernel can
  reach it. Kanvaz doesn't call out; an already-running AI client's own
  stdio MCP process (`server.js`, spawned by that client, not by Kanvaz)
  connects in.
- **Every AI-driven change lands in undo history exactly like a manual
  edit** — the tool handlers call the same `KanvazCards`/`KanvazConnections`
  functions the UI itself already uses, by construction, not a bolted-on
  safety net.
- A card's embedded media (`dataUrl`) is never sent over the bridge — only a
  `hasMedia` boolean. Verified end-to-end (`test/mcp-bridge-e2e-test.mjs`) with
  a real MCP client driving the real, unmodified `server.js`.

### Added — Runtime API extensions (support for the above)
- `KanvazCards.updateCardData(id, patch)`, `setTags(id, tags)`,
  `deleteCardImmediate(id)`, `search(query)`, `createFileRefCardAtPath(x, y, p)`
  — general-purpose additions (not MCP-only), reusable by any future plugin
  or internal feature that needs to mutate a card programmatically.

### Added — real per-plugin permission enforcement
- **A permission-gated capability (currently: `KanvazPluginAPI.mcpBridge`,
  unlocked by the new `server` permission) is now genuinely absent from an
  unapproved plugin's own view of the API** — not just undocumented, as it
  was for every permission through 4.3.0. `KanvazPluginLoader` now injects
  plugins one at a time and points `window.KanvazPluginAPI` at a scope built
  for whichever plugin is currently loading; each plugin captures its own
  scoped reference at top-level load time (the same convention already used
  for per-plugin storage's `PLUGIN_ID`). Verified in a real browser
  (`test/plugin-scope-test.js`) — including the specific regression a global-
  scope aliasing bug caused during development, caught by that same test
  before it ever shipped.
- This closes the honesty gap for the one capability dangerous enough to be
  worth it this pass; `cardTypes`/`commands`/`network`/`filesystem` remain
  informational-only in the consent dialog, as documented in SECURITY.md.
  Full per-plugin process isolation remains explicitly out of scope (see
  SECURITY.md).

### Added — distribution
- **CI now actually builds official-plugin release assets** on every tagged
  release (audit-flagged for two releases running as never built) — zips
  each `official-plugins/*` folder and uploads it alongside the installers.
- **"Browse Official Plugins" tab** (Settings → Plugins) — one deliberate
  network call (same disclosure discipline as Check for Updates, routed
  through the main process so no new CSP `connect-src` host becomes
  fetchable from the renderer) fetches a small catalog JSON and installs
  with one click. Raw-URL/folder-drop install remains the escape hatch.
- **"Load unpacked plugin"** (Settings → Developer) — Chrome-extension-dev-
  mode pattern: point at any folder with a `plugin.json`, it loads
  immediately, bypassing both the real plugins directory and the consent
  dialog. Clicking it again after editing the plugin's files reloads it.

### Fixed — found and fixed before release, via a structured multi-lens review
The MCP Bridge/permission-scoping work above was checked by an independent
security, correctness, Electron/IPC, plugin-ergonomics, privacy, performance,
and end-user-flow pass before anything shipped. What it found and what
changed as a result:
- **Critical: the permission scope builder leaked itself into every plugin's
  own scoped API**, letting ANY plugin (regardless of declared permissions)
  call it on itself with a forged manifest and synthesize full `mcpBridge`
  access — completely defeating the gate. Fixed by excluding the builder from
  the copy; `test/plugin-scope-test.js` now asserts this specific bypass is
  closed.
- **Two independent plugin-loading operations could corrupt each other's
  permission scoping** if triggered concurrently (e.g. "Load unpacked plugin"
  clicked while startup's plugin scan was still in flight) — there was only
  one `window.KanvazPluginAPI` slot and no coordination between the two
  callers mutating it. Fixed with a shared queue serializing every
  scope-swapping operation; `test/plugin-scope-test.js` now includes a
  deliberately-engineered concurrent-load race, checked against a temporarily
  reverted build to confirm it actually fails without the fix.
- **Re-enabling MCP Bridge stacked a duplicate IPC listener**, silently
  double-firing every tool call (two cards created instead of one, etc.) on
  a disable→enable cycle. Fixed — registering a new handler now replaces the
  last, and the plugin properly releases its own listener on disable.
- **The `mcp-invoke` channel is a shared broadcast any loaded plugin can
  subscribe to**, not scoped per-permission the way `KanvazPluginAPI.
  mcpBridge` is — Electron gives no way to tell which script in a shared
  page context made an IPC call. This is a real, disclosed limitation, not
  something this pass could fully close (would require the per-process
  isolation already declined for this stretch) — see SECURITY.md's MCP
  Bridge section for the full disclosure and the "only install plugins you
  trust just as much" guidance that follows from it.
- **The `server` permission read as generic but only ever authorized one
  hardcoded plugin id** — a well-behaved third-party plugin declaring it
  got a misleading "not approved" error. Now fails with an honest
  explanation of the single-tenant restriction.
- Zip-bomb protection (decompressed-size cap, not just compressed-download
  cap), redirect-target host re-validation, and an unbounded-buffer cap
  added to the catalog install and MCP listener paths.
- `stopMcpBridgeServer()` now actually waits for the OS handle to release
  before a restart is allowed, instead of racing a fast disable→enable click.
- `addReference`'s "fall back to a plain file-reference card" path was dead
  code for the missing-file case (checked an error string the real code path
  never produces) — broadened so it actually works as documented.
- Several smaller fixes: `updateCardData`/`setTags`/`deleteCardImmediate`
  now log a clear error on an unknown card id instead of failing silently;
  duplicate-overlay and stale-"Install"-button bugs in Browse Official
  Plugins; a few copy tightenings.

## [4.3.0] — Command Palette & Plugin Runtime API

The load-bearing layer of the plugin system that everything else (including
v4.4's planned MCP Bridge) depends on — sketched in `docs/PLUGIN_SYSTEM_DRAFT.md`
back in 4.2.0, never shipped until now.

### Added
- **Command Palette — Ctrl+K.** Type to fuzzy-search and run any command by
  name: every one of Kanvaz's own shortcuts (Save, Undo, Select All, Zoom to
  Fit, Toggle Theme, and more) plus anything a plugin registers. Arrow keys
  to navigate, Enter to run, Escape to close.
- **`KanvazPluginAPI.registerCommand(id, { label, run, shortcut, showInPalette, contextMenu })`** —
  a plugin command and a core Kanvaz command are indistinguishable once
  registered; both show up in the palette automatically. Theme Creator now
  registers one ("Randomize Preview") as a working reference example, not
  just a doc sketch.
- **`KanvazPluginAPI.on(event, handler)`** — react to `cardCreate`,
  `cardUpdate`, `cardDelete`, `boardLoad`, `boardSave`, and
  `selectionChange`. Returns an unsubscribe function. A handler that throws
  is isolated — it can't take down the other handlers or the core mutation
  that triggered it.
- **Runtime Data API** — `KanvazPluginAPI.getCards()`, `getSelected()`,
  `getConnections()`, `getActiveBoard()`. Read-only snapshots (cloned, not
  live references), so a plugin can inspect board state without risking a
  silent desync from mutating what it got back.

### Changed
- Settings → Plugins consent model, storage, and every previously-shipped
  `registerCardType`/`registerTheme`/`registerSettingsPanel` API are
  unchanged — this release is purely additive to the plugin surface.

## [4.2.2] — Visual polish and reliability pass

No new features — a dedicated design-consistency audit (every modal, panel,
and overlay checked against every other one) plus a reliability re-check
specifically of the interactive/geometry-sensitive code touched in 4.2.1
(Top Mode's chrome reveal, Map View's connection rendering).

### Changed — visual polish
- **Unified every modal/panel's border-radius, shadow, and entrance animation.** Settings, Shortcuts overlay, First-run screen, the About card, and the standard confirm/warn Dialog now all share the same 10px radius and theme-aware shadow, and none of them pop in instantly anymore — each fades and scales in like About already did. Inspector and Properties (structurally identical side panels) now both slide in from their docked edge; only Properties did before.
- **Replaced every emoji and stray Unicode glyph with the app's own icon language.** The search bar's 🔍, and the first-run screen's ⬇/✱ tip icons, are now small hand-drawn stroke SVGs matching the toolbar's existing icon convention instead of OS-emoji-font glyphs that visually clashed with an otherwise all-vector UI.
- **Connection-type colors are no longer a raw, unmodified Tailwind palette.** The 7 relationship-type colors (Related To, Inspired By, etc., in the Inspector and Map View) are now drawn from Kanvaz's own palette instead of stock Tailwind blue/violet/emerald/amber/red/indigo, which read as a different design system pasted into the app.
- **Toasts get an icon.** A small check/✕ glyph now sits next to success/error toast text, matching the icon treatment already used everywhere else in the app — toasts were the one remaining text-only UI element.
- **The empty-canvas state is no longer the flattest screen in the app.** Its icon is more visible (was practically invisible at 0.18 opacity), lightly accent-tinted, and now animates in — previously a static, undesigned drop straight after the animated First-run screen closes.
- Fixed two mismatched "delete" hover reds (Inspector and Properties each used a different, non-token red) — both now use the same `--color-red`.

### Fixed — reliability
- **Top Mode's drag-to-move-the-window bar could vanish mid-drag**, killing the drag before the window actually moved. The auto-hide timer that reveals/hides the top chrome didn't know a native window drag was in progress and could fire in the middle of one. Now suspended for the whole mousedown-to-mouseup gesture, with a window-blur fallback so it can never get stuck permanently disabled if focus is lost mid-drag (a UAC prompt, Alt+Tab, or OS snap-assist appearing while the mouse button is still down).
- **Map View connections could drift out of alignment after resizing the window** — only the background grid was redrawn on resize; the connection lines themselves weren't. Now re-derived from the live DOM (same source of truth as the initial render), throttled through a single animation-frame so a continuous drag-resize doesn't rebuild every connection's SVG on every intermediate frame.
- Annotation overlays now read the display's current pixel density live instead of trusting a value cached when annotating started — dragging the window to a different-scaling monitor and then resizing a card no longer leaves that card's annotations rendered at the wrong sharpness.
- The floating annotation toolbar now repositions on a plain window resize, not only when the canvas itself pans or zooms — previously a resize-driven layout shift (not a pan/zoom) could leave it anchored to the wrong spot.

## [4.2.1] — Full-stack audit and hardening pass

No new features — a systematic audit of every source file added in the
4.2.0 plugin-system work (and a re-check of everything else), followed by
fixes for everything it found. Two independent audit passes: one for
code-level bugs and security, a second specifically for UI copy that no
longer matched actual app behavior.

### Fixed — data loss & correctness
- **Annotations (pen/arrow/rectangle strokes) weren't marked dirty or pushed to undo history** — closing the app right after annotating (with no other change to trigger a save prompt) silently lost the annotation. Now marks the board dirty and pushes an undo step the moment a stroke is committed.
- **`pluginData` wasn't cloned in undo/redo snapshots** — a plugin card's data object was captured by reference, so a later in-place mutation could retroactively corrupt an already-pushed history snapshot. Now deep-cloned like every other mutable card field, with a safe fallback if the data isn't JSON-serializable.
- **A non-serializable card (bad `pluginData`) could abort an entire save or asset-pack operation** — `JSON.stringify()` and the board-container packing loop now isolate failures to the one offending card instead of losing the whole board.
- **`deserialise()` let one malformed card crash loading the entire board** — each card now loads inside its own try/catch; a bad card is skipped and logged, the rest of the board still opens.
- **Windows path-separator bug in Save As** — the "Board saved as …" toast used a forward-slash-only split, so on Windows it displayed the entire absolute path instead of just the filename.
- **Recent-boards list built its rows with string-concatenated `innerHTML`** — a board or folder name containing HTML-like characters could inject markup into the startup screen. Rebuilt with safe DOM text nodes.
- Several silent `.catch()` blocks (save, save-as, open) now surface a toast on failure instead of failing invisibly with only a console log.

### Fixed — plugin system robustness
- **Plugin storage writes could race** — overlapping saves for the same plugin shared one temp filename; switched to a unique temp file per write plus async file I/O, and capped storage at 5MB per plugin.
- **A plugin registering `id: "dark"` or `"light"` could silently hijack a built-in theme app-wide** — `registerTheme()` now rejects Kanvaz's own reserved theme ids.
- **A plugin card type or Settings panel throwing during render could take down more than itself** — card rendering, context-menu building, and settings-panel rendering are now individually try/catch-isolated with a visible fallback instead of an app-wide break.
- **Settings panels rendered by a plugin were built before being attached to the page**, breaking any `getComputedStyle`/`getBoundingClientRect` call inside a plugin's `render()`. Panel rendering is now deferred until after the container is actually in the DOM.
- **`plugins-remove` could wipe the wrong plugin's stored data** if called with a mismatched folder/id pair — now requires a verified match before touching disk.
- Removed the dead `pdf` ghost entry from the card-type registry (no creation path ever existed for it).

### Fixed — shortcuts & input
- **Every Ctrl-combo shortcut broke under Caps Lock** — comparisons against `e.key`'s hardcoded case silently failed when Caps Lock flipped the reported case; now compares a lowercased key against the modifier booleans only.
- **The Properties and Inspector panels swallowed Ctrl+S/Ctrl+Z and friends while open**, so saving or undoing didn't work with a panel focused. Modifier-held shortcuts now bubble through; plain keys still don't leak into card-level handlers.
- Pressing L to toggle theme no longer bypasses the cleanup that removes a stale plugin-theme stylesheet.

### Fixed — smaller issues
- Media metadata reads (`getNaturalSize`/`getVideoSize`) could hang indefinitely on a malformed file; now time out after 8s with a sane fallback size.
- Map View's `setState()` and port-position math no longer accept negative/NaN/out-of-range values, and the sanity bound was widened to stop clipping ports on very large auto-laid-out boards (2,700+ cards).
- `formatTime()` no longer prints garbage for a non-finite duration.
- Fixed two dead/duplicate CSS rules and hardcoded color literals in the light theme that should have referenced the shared accent-color variable.

### Security
- Added `will-navigate` and `setWindowOpenHandler` guards in the main process, closing off a class of exfiltration/redirect attempts a compromised renderer script could otherwise attempt.
- Added `worker-src 'self'` to the CSP.
- Rewrote the plugin-permission code comments, the install-consent dialog text, and a new "Plugin System — trust model" section in [SECURITY.md](SECURITY.md) to honestly state that the declared permission list is not currently enforced at the IPC layer — an approved plugin has the same practical access as Kanvaz's own code. This was previously implied to be more restrictive than it actually is; nothing about the underlying behavior changed, only the documentation now matches it.

### Fixed — UI copy & documentation accuracy
A dedicated pass checked every user-facing claim (tooltips, the Shortcuts overlay, the first-run screen, context menus, README/CHANGELOG/SECURITY.md) against what the app actually does:
- The Shortcuts overlay, the canvas right-click menu, and the first-run welcome screen all described double-click-to-create-a-note as if it always works — it's off by default (`doubleClickCreatesNote` in Settings). All three now reflect the actual setting, or hide the hint when it doesn't apply.
- Added the missing `Ctrl+F` / `/` search shortcut and the `Ctrl+Shift+F` Top Mode alternate binding to the Shortcuts overlay.
- The titlebar's "Export board" button actually performs a Save As to the same `.kanvaz` format (not a format conversion) — relabeled to "Save board as…".
- README and SECURITY.md both claimed the update check was "a single request" to GitHub — it's actually two independent requests per click (the bundled updater's own check, plus a separate version-info lookup). Both docs now say so.
- SECURITY.md still described `.kanvaz` files as "plain JSON with base64 media" — stale since 4.1.0's zip-container format change. Corrected.
- README described the `pdf` card type as "still in the type registry" — it was removed this pass (see above); README updated to match, and no longer calls Theme Creator "planned" now that it has shipped.
- CHANGELOG's 4.2.0 entry said "no first-party plugins ship yet," directly contradicting the Theme Creator plugin that shipped in that same release — corrected, and the 4.2.0 entry now actually lists everything that shipped in it (registerTheme, registerSettingsPanel, storage API, Theme Creator).

## [4.2.0] — Plugin system (foundation) + Theme Creator

The first piece of a plugin system: third parties can now extend Kanvaz
without forking it — custom card types, full-peer themes, and settings
panels. This is the foundation layer only — commands, event hooks, and a
command palette are a later phase. Theme Creator ships alongside it as
Kanvaz's first official plugin, proving the API end-to-end with something
genuinely useful rather than a toy example.

### Added
- **Plugin system, Layer 1** — a plugin is a folder (`plugin.json` manifest + one plain JS entry file, no build step) dropped into a `plugins` folder Kanvaz manages for you. A plugin's entry script loads as a normal `<script>`, same trust model as a browser extension, not an iframe-sandboxed one.
- **`window.KanvazPluginAPI`** — `registerCardType()` (new card types with a working create/render/context-menu path), `registerTheme()` + `applyTheme()` (a plugin theme is a full peer of the built-in dark/light themes, not a partial override layered on top of one), `registerSettingsPanel()` (a plugin can add its own labeled section to Settings), and size-capped per-plugin persistent storage (`storage.load`/`storage.save`).
- **Theme Creator (official plugin)** — a full in-app theme editor: live color pickers with instant preview across the whole app, save-as-preset, a presets list with pin/star/rename/apply/edit/delete, and one-click reset to Kanvaz's own defaults. Installs the same way any plugin does (Settings → Plugins → Add a Plugin…) — not bundled into the base installer, ships as a separate release asset.
- **Settings → Plugins** — lists installed plugins with an enable/disable toggle (once approved) or a "Review & Enable" prompt (before first approval, or after a permission-escalating update), and a Remove button. "Add a Plugin…" opens the plugins folder directly — no manual path-typing, no knowing where `%APPDATA%` is.
- **Native consent dialog** — enabling a plugin for the first time (or after it requests new permissions) shows an OS-native dialog listing exactly what it's asking for, read directly from the plugin's own `plugin.json` at approval time.
- **Graceful degradation for missing plugins** — a board card whose type belongs to a since-disabled or removed plugin shows a clear "Unknown card type — needs plugin: X" placeholder instead of breaking anything else on the board.
- New test (`test/plugin-loader-test.js`, wired into `npm run validate`) covering manifest validation, permission-escalation-forces-re-consent, and path-traversal rejection in plugin removal.

### Security
- **Consent is enforced entirely in the main process, not the renderer.** An early draft had the renderer able to directly approve a plugin's permissions over IPC — since a plugin's own script runs in the same page context as the rest of the app (the deliberate, disclosed convention-based sandbox model, not iframe-isolated), that meant a plugin could in principle call the same IPC method on itself and silently self-grant permissions with no real dialog ever shown. Fixed before shipping: the approval IPC now takes only a folder name, re-reads that plugin's manifest itself, and gates the actual approval behind a native `dialog.showMessageBox` — a real OS modal a co-resident script cannot script or auto-click. Enabling a plugin is also re-checked fresh against its current consent status server-side, so it can't be used as a side door around the dialog either.
- **CSP change, disclosed**: `script-src` gained `file:` (was `'self'` only) so a plugin's entry file can load as a real script — `'unsafe-inline'` and `'unsafe-eval'` were not added, and inline scripts/`eval`/`Function`-from-string remain fully blocked everywhere in the app, including inside plugin code.
- Plugin removal validates that a supplied plugin id actually matches the folder being deleted before touching disk, and every filesystem path plugin-loader.js touches is checked to resolve inside the plugins directory before use.

## [4.1.0] — Reference types, safer file format, more bug fixes

### Added
- **URL reference cards** — paste a link, open it in your default browser or copy it. Never fetches previews/favicons; stays fully offline like everything else in Kanvaz.
- **File reference cards** — point at a file anywhere on disk (a source PSD, a script, a brief) without embedding it. Open with its default app, or re-point it to a different file anytime. Opening deliberately refuses executable/script file types (`.exe`, `.bat`, `.ps1`, `.js`, `.lnk`, etc.) for safety, since a shared `.kanvaz` file's card data isn't necessarily trustworthy — every legitimate reference use (documents, source files) is unaffected.
- **New `.kanvaz` container format** — a `.kanvaz` file is now a zip container (`board.json` + one file per embedded asset with a SHA-256 integrity hash) instead of one giant JSON blob with everything base64-encoded inline. Fixes the ~33% base64 size bloat and means a single damaged asset degrades to that one card, not the whole board. Old plain-JSON files still open exactly as before — this only changes how new saves are written. Covered by a new permanent test (`test/format-roundtrip-test.js`, wired into `npm run validate`).

### Removed
- **`outcome` reference type** — was registered in the type system with an icon and no defined fields, no creation UI, and no spec for what it was meant to do differently from a Note. Removed rather than left as a permanent ghost entry.

### Fixed
- **Color swatch cards felt impossible to drag** — dragging any card still fires a native `click` on mouseup over the same element; every other card type ignores that, but the color card's swatch/label/copy-button all had click handlers (open color picker, cycle format, copy hex) that fired immediately after every drag attempt, undoing the feel of moving it at all.
- **`.kanvaz` files could silently save without their extension** — Windows' native Save dialog only auto-appends the filter extension when the typed filename has no dot at all; any board name with a dot in it (dates, version numbers) saved with no `.kanvaz` extension, which broke both its file icon and its visibility in the Open dialog's `*.kanvaz` filter. The save handler now forces the extension unconditionally.
- **Map View connections misaligned on some Windows machines, never on others** — traced to a hand-measured pixel offset constant (`PORT_INSET`) calibrated against one specific Chromium render, plus a fixed-timeout guess for when entrance animations had "definitely" finished. Both assumptions break on different display-scaling setups. Replaced with always preferring the live-measured DOM position (safe per-node fallback already existed) and a frame-driven settle loop instead of a timing guess.
- **Video codec failures looked identical to a moved/deleted file** — an MKV/AVI file Chromium can't decode showed the same generic "Missing media" state as an actually-missing file, even though Relink can't fix a codec problem. Now says so plainly and suggests re-exporting as MP4/WebM.
- Replaced the placeholder app icon/logo (in the taskbar, `.kanvaz` file association, and in-app titlebar/About screen) with the real Kanvaz mark.

### Security
- Hardened the CSP further and closed the file-reference "Open" action against launching executable/script files from untrusted `.kanvaz` data (see File reference cards above).
- Corrected a code comment in `connections.js` that implied cross-board connections were just a future flip of a switch — the data model doesn't block it, but there's genuinely no UI path to it today (only one board's cards are ever loaded at a time).

## [4.0.1] — Foundation hardening pass

A full bug-hunt audit across every file in `src/`, followed by fixes for
everything it found — from a save-file data-loss bug down to CSP
hardening. v4.0 is the last planned major version; this batch is meant
to leave the foundation solid before only small fixes ship from here.

### Fixed
- **Image fit, video speed, audio loop, and color format were silently
  lost on every save** — `KanvazCards.serialise()`'s save-file whitelist
  never listed `objectFit`/`playbackRate`/`audioLoop`/`colorFormat`.
  Each feature worked perfectly for the rest of the session (render code
  reads the live card object directly) but reverted to its default the
  moment the file was reloaded. The same 4 fields (plus a newly-added
  persisted `muted` state, see below) were also missing from
  `KanvazHistory`'s undo/redo snapshot, so even undo/redo inside a
  single session would strip them. Both whitelists now include all 5 fields.
- **"Select All" only ever selected one card for real** — Ctrl+A visually
  highlighted every card, but the underlying selection state
  (`selectedId`) tracked just the last one, so Delete/Duplicate/Pin/nudge
  afterward silently acted on a single card while the rest stayed
  untouched. Added real multi-select tracking and bulk-aware
  `deleteSelected()`/`duplicateSelected()`/`togglePinSelected()`, each
  behind exactly one confirm dialog / history entry / toast for the
  whole batch — falls through to the exact previous single-card
  behavior whenever only one card is selected.
- **Minimap click-to-pan was only correct at exactly 100% zoom** — the
  click handler used the raw screen-pixel viewport size instead of
  dividing by the current zoom scale, so panning via the minimap drifted
  further off the more zoomed in or out the canvas was.
- **Escape committed instead of cancelling, in two places** — renaming a
  board tab and typing a card tag both tore down the DOM to "cancel,"
  which fires a native `blur` on the still-focused input first; since
  both had a commit-on-blur handler, Escape ended up saving whatever was
  typed, identically to Enter. Fixed in both `boards.js` and `cards.js`.
- **macOS could skip the unsaved-changes prompt after the first window
  closed** — the `allowClose` flag that gates the close-confirmation
  dialog was never reset per window; since macOS keeps the app running
  after the last window closes and can spawn a new one, a second window
  could inherit a stale `true` and skip the check on its first close.
- **A crashed renderer could hang the app forever** — there was no
  `render-process-gone` handling, so if the renderer process actually
  died (not just a caught JS error) while the main process was waiting
  on the close-confirmation handshake, that wait never resolved.
- **Video/audio mute state wasn't saved** — same class of bug as the
  serialise() issue above; muting a video or audio card reverted to the
  type's default (muted for video, unmuted for audio) on every reload.
  Now persisted as `card.muted`.
- **Tall portrait images could land wildly oversized** — the initial
  drop-size cap only checked width, so an image like 300×3000 passed
  through completely unscaled instead of being fit to a bounding box.
- **Clipboard-pasted audio silently failed to import** — the
  mimetype-based type detector used for paste (as opposed to the
  extension-based one used for file drops) had no `audio/` case.
- **Deleting the active board could orphan connections** — the
  cascade-delete read a snapshot of the board's cards that's only
  refreshed on switch/save, so any card added since the last switch
  wasn't in it, and its connections survived the board's deletion.
- **Shortcuts overlay (`?`) listed "Cards" twice**, with Delete/Ctrl+D/P/H
  duplicated across both — merged into one section.
- **Properties panel couldn't be closed with Escape or E** once focus
  was anywhere inside it — a blanket `stopPropagation` meant to keep
  Delete/P/etc. from leaking to the global shortcut handler also
  swallowed the panel's own documented close shortcuts. Both now close
  the panel directly.
- **Annotations rendered soft on HiDPI/Retina displays** — the drawing
  canvas was sized in CSS pixels with no `devicePixelRatio` scaling.
  Fixed by rendering at native resolution while keeping every stored
  stroke coordinate in the same CSS-pixel space as before, so existing
  saved annotations are unaffected and portable across displays.

### Hardening / polish
- Single-key shortcuts (T, 0, L, etc.) no longer get suppressed just
  because a checkbox, color swatch, or range slider happens to be
  focused — only genuine text-input focus blocks them now.
- Context menus are now built with DOM APIs instead of `innerHTML`.
- `markDirty()`/`markClean()`/`setCurrentPath()` no-op when nothing
  actually changed.
- The pen tool no longer pays for a full-canvas pixel readback it never
  used (that snapshot is only needed by the rect/arrow tools).
- CSP now also sets `object-src 'none'` and `base-uri 'self'`.
- `KanvazBridge.off()` now respects the same channel allowlist as `on()`.
- The Reset Kanvaz recovery-file cleanup no longer aborts entirely if it
  ever encounters a subdirectory instead of a file.

## [4.0.0] — V4.0 Quality Release: card polish, infra, and auto-updates

Completes the v4.0 quality pass that [3.8.1](#381--hotfix-8-verified-bugs-from-the-v40-pre-audit)
started: every card type got a full pass of UI/UX polish, plus a round
of infrastructure work (installer, CI, auto-updater) to make releases
easier to ship and easier to trust.

### Added
- **Per-card-type polish, all 6 types** — image gets a cover/contain
  fit toggle; image/GIF/video get a loading skeleton and a clear
  broken-media error state with a one-click **Relink** button; GIF
  gets a pause overlay; video gets drag-to-scrub, a 0.5×/1×/2×
  playback-speed picker, and a duration badge; audio gets a generated
  waveform, a loop toggle, and a duration badge; notes get a live
  character count and a live filename preview as you type; color
  cards can cycle hex/rgb/hsl format with one click and copy the
  value to the clipboard, plus a black/white contrast preview.
- **Live annotation indicator** — a small dot on any annotated card
  that now updates in real time as you draw or clear, instead of only
  reflecting what was true at last save.
- **Tag autocomplete** — typing a tag now suggests existing tags from
  across the board.
- **Unsaved-changes dot** in the window titlebar, next to the
  filename.
- **App reset v2** — an optional "Reset & Clear Caches" mode that also
  wipes Electron's HTTP/GPU/local-storage caches, for the rare case a
  normal reset doesn't clear up something visually broken.
- **Polished NSIS installer** — custom sidebar art and bundled license
  text, so the Windows installer looks and reads like a finished
  product instead of an electron-builder default.
- **GitHub Actions CI** — lint and syntax validation on every push and
  PR, plus a full Windows/macOS/Linux build-and-publish pipeline that
  runs automatically on version tags.
- **Auto-updater** — checks GitHub Releases for a newer build,
  downloads it in the background, and prompts to restart once it's
  ready. Strictly user-triggered from the existing "Check for
  updates" button in About — Kanvaz still makes zero network calls on
  its own.

### Fixed
- **`.card-error-state` wasn't positioned** — on image/GIF cards it
  rendered clipped and invisible behind the still-visible broken
  `<img>` element instead of showing the intended error state.
- **Annotation dot could go stale mid-session** — it read a
  save-time-only field instead of the live stroke data, so it never
  appeared while drawing and never disappeared after clearing.
- **Tag autocomplete dropdown could be clipped** by a card's
  `overflow: hidden` — now rendered outside the card and positioned
  against it directly.
- **Update-check status text used `innerHTML`** with a string built
  from a network response — switched to safe DOM APIs.

### Internal
- Consolidated titlebar text into a single writer
  (`KanvazBoards.updateTitle()`), replacing two competing code paths
  that could disagree with each other.
- Added `electron-updater` as a real dependency, wrapped in try/catch
  so a missing or broken install degrades to "no updates available"
  rather than crashing the app.

## [3.8.1] — Hotfix: 8 verified bugs from the v4.0 pre-audit

Ships the Phase 1 fixes from the v4.0 quality pass ahead of the card
UI/UX polish work — all eight were verified with exact file/line
references before fixing.

### Fixed
- **Annotate shortcut opened on color cards** — the `A` key guard in
  `shortcuts.js` excluded `note` and `audio` cards but not `color`,
  so pressing A on a color swatch activated the annotation overlay on
  a card type that can't render one.
- **Color picker leaked DOM elements** — clicking a color swatch
  appended a hidden `<input type="color">` to `<body>`, only removed
  on the `change` event. Cancelling the OS picker (Escape, click
  away) left it orphaned in the DOM permanently. Now cleans up any
  leftover picker before creating a new one and removes it on `blur`
  as a fallback.
- **Context menu showed irrelevant items for color/audio cards** —
  "Flip horizontal/vertical" and "Reset size" only excluded `note`;
  "Clear annotations" had no type guard at all. Both now exclude
  `color` and `audio`.
- **`flipCard()` corrupted state on non-visual cards** — flipping a
  note, color, or audio card toggled `flipH`/`flipV` flags and tried
  to transform a nonexistent `img`/`video` element, leaving garbage
  flip state in the saved file. Now returns early for those types.
- **No single-instance lock** — nothing called
  `app.requestSingleInstanceLock()`, so launching Kanvaz twice (or
  double-clicking a second `.kanvaz` file) could open two processes
  against the same recovery/settings files. A second launch now
  focuses the existing window instead.
- **No `.kanvaz` file-open handling** — double-clicking a `.kanvaz`
  file did nothing; there was no `process.argv` parsing on startup
  and no macOS `open-file` handler. Both now forward the file to the
  renderer, which opens it the same way File → Open does.
- **Window title never updated** — the taskbar/Alt-Tab title stayed
  hardcoded to "Kanvaz" regardless of which file was open. The
  in-app custom titlebar showed the filename, but the real OS window
  title never got `setTitle()` called on it. Now reflects the open
  file and an unsaved-changes marker.
- **No `.kanvaz` file association** — `package.json`'s build config
  had no `fileAssociations` entry, so the OS didn't know `.kanvaz`
  files belonged to Kanvaz (no icon, no "Open with", no double-click
  launch). Added for Windows/macOS/Linux via electron-builder.

### Internal
- Added `.gitattributes` (`* text=auto eol=lf`) and normalized all
  tracked text files to LF — the working tree had drifted to CRLF,
  producing full-file diffs on every commit that had nothing to do
  with the actual change.

## [3.8.0] — Crash-safe save, .pur import, properties panel, color cards

### Added
- **Crash-safe save** — writes to a temp file first, then atomically renames
  to the target path. A crash or power loss mid-save can no longer corrupt
  your `.kanvaz` file.
- **Settings migration system** — version-aware migration pipeline that
  automatically upgrades settings across versions without data loss.
  Supports future schema changes with per-version migration functions.
- **Error diagnostics v2** — enhanced diagnostic system with structured
  error codes, contextual metadata, and one-click debug-info export from
  Developer settings.
- **`.pur` file import** — import PureRef `.pur` files via drag-drop or
  right-click canvas menu. Parses the binary format, extracts embedded
  PNG images, and preserves position and scale from PureRef's transform
  matrices.
- **Properties panel (E)** — press E on any selected card to open a
  left-side panel for editing custom key-value metadata. Add, edit, and
  delete properties per card.
- **Color picker card type** — create color swatch cards from the canvas
  right-click menu. Click the swatch to open the native OS color picker.
  Card bar shows a colored circle badge.

---

## [3.7.2] — Polish: Map View UX, tab badges, Top Mode drag bar, dist alias

### Added
- **Top Mode visible drag bar** — a subtle accent-colored strip at the top
  of the screen when Top Mode is active, so you can see where to grab to
  move the window. Brightens on hover for clear feedback.
- **Map View zoom-to-fit (F key)** — press F in Map View to fit all nodes
  into the viewport, matching Board View behavior.
- **Double-click-to-jump** — double-click any Map View node to switch to
  Board View with that card selected and centered.
- **Card count badges** — board tabs now show the number of cards in each
  board as a small badge next to the tab name.
- **Resize handle cursor** — card resize handles now show `nwse-resize`
  cursor on hover, giving clear visual feedback that the handle is draggable.
- **`npm run dist` alias** — shortcut for `npm run build:win` so
  `npm run dist` works out of the box.
- **`ship.bat`** — one-click ship script: lint → syntax check → version
  consistency check → git commit/tag/push → build installers.

---

## [3.7.1] — Hotfix: startup crash, dead buttons, map ports, media controls

### Critical: startup crash blocking all mouse input
v3.7.0 shipped with two broken calls that crashed during `init()`,
preventing `bindGlobalUI()` from executing — which meant **every mouse
click in the app was silently dead** (Settings, About, Shortcuts, Save,
zoom, everything routed through a button listener). Keyboard shortcuts
and canvas pan/zoom still worked because they're wired earlier in boot.

- Fixed: `initTabMmbWindowDrag()` called from `init()` (parent scope)
  but defined inside the `KanvazUI` IIFE (child closure). JS closures
  don't let parents see into children → ReferenceError on every launch.
  Moved the call inside the KanvazUI IIFE after the function definition.
- Fixed: `KanvazApp.showSearchBar/hideSearchBar` → `KanvazUI.showSearchBar/hideSearchBar`
  (`src/boards.js` x2, `src/shortcuts.js` x2).

### Map View: port positions converging at (0,0) on some PCs
Connections drew correctly on most machines but all port endpoints
collapsed to the top-left corner on Windows displays with non-100% DPI
scaling. Root cause: `domPort()` read port positions via
`getBoundingClientRect()` during the entrance animation, when
`translateY(10px) scale(0.96)` shifted coordinates. On standard scaling
the error was small enough to look correct; on 125%/150% scaling it
produced visually broken results. Additionally, `renderLines(false)` was
passing `false` instead of `true` on first open, killing the line
entrance animation.

- Fixed: added `useMathOnly` flag — on first open, port positions use
  pure arithmetic from `card.mapPosition` (always correct). After all
  entrance animations finish (~900ms), re-renders with DOM-accurate
  positions for pixel-perfect alignment.
- Fixed: `domPort()` now validates `getBoundingClientRect` results —
  returns null on zero-size rects or wildly out-of-range coordinates,
  triggering the math fallback instead of returning garbage.

### Media controls: too small, unclickable, didn't scale with card resize
The scrub bar was 3px tall (nearly impossible to click), the mute button
had an inline `font-size:9px` overriding the responsive CSS, and fixed
px values prevented controls from scaling when the card was resized.

- Fixed: all media control dimensions now use `cqw` (container query
  width) units with `clamp()` so they scale proportionally with the
  card. Resize a video card larger → controls grow. Resize smaller →
  controls shrink to a usable minimum.
- Fixed: scrub bar increased from 3px to `clamp(4px, 1.5cqw, 8px)` with
  `padding: clamp(4px, 1.5cqw, 8px) 0` for an 18px+ click target area.
- Fixed: removed inline `font-size:9px` from mute button (was overriding
  the responsive `clamp(12px, 4.5cqw, 22px)` CSS rule).
- Fixed: play/pause SVG icons enlarged from 14×14 to 18×18 base size.
- Fixed: scrub container height, padding, gap, button min-sizes all
  converted from fixed px to responsive cqw clamp values.

### Other fixes
- Fixed: `.tag-bar` (invisible, z-index:2) captured pointer events on
  top of video/audio scrub bars (z-index:3 now, plus `pointer-events:
  none` when hidden, `auto` on hover/selected).
- Fixed: update checker always reported "no internet" — CSP had no
  `connect-src`. Added `connect-src 'self' https://api.github.com;`.
- Fixed: added `.catch()` to all remaining unguarded promise chains in
  `boards.js` (×7), `media.js` (×1), `ui.js` (×1), `app.js` (×1) to
  prevent unhandled rejection error toasts.

## [3.7.0] — Tags, Search, and a Real Polish Pass
The first minor-version milestone since v3.5.4 — closes out the original
v4.0 Phase 1 scope (tag editing, search) that had been deferred across
an extended run of user-reported bug fixes, and does a real audit pass
rather than shipping on hope.

### New features
- **Tag editing UI.** Tags have existed in the data model since v3.0
  with no way to actually add or edit them — that's now fixed. Chips
  appear on hover/selection, click `+` to add, click a chip's `×` to
  remove. Autocomplete draws from tags already used elsewhere on the
  board.
- **Search/filter** (`Ctrl+F` or `/`). Live filter by name, type, or
  tag. Non-matching cards dim and desaturate rather than disappearing
  — keeps spatial context so you're not disoriented when you clear
  the search. Automatically clears when switching boards or opening
  a different file, so a stale query never silently applies to
  content it was never run against.

### Fixes
- **Video/audio control sizing.** Play/pause icons and the scrub bar
  were fixed-size (10×10px icons, 20px bar) regardless of card size —
  functionally unusable once a card was resized down. Now scales with
  `clamp()` against card width, with a sane minimum touch target.
- **Annotation toolbar drift on pan/zoom** — a real, previously
  undocumented-as-fixed limitation. The toolbar was positioned once
  via `getBoundingClientRect()` at open time and never repositioned;
  panning or zooming while annotating left it stuck in place while the
  card moved underneath it. Now watches the canvas transform via a
  `MutationObserver` and repositions live; cleaned up on toolbar close
  so it doesn't linger watching a card that's no longer being
  annotated.
- **Dev Mode's "Show card/connection IDs" was hiding video/audio
  cards.** The injected CSS set `.card { position: relative }`,
  overriding the inline `position: absolute` every card already has,
  and the ID badge itself was positioned at the bottom-right — directly
  over the video/audio scrub bar and controls. Badge moved to the
  top-left, and the position override removed entirely (cards already
  had the right positioning; nothing needed to be set).
- **Top Mode's chrome reveal/hide was abrupt** — sped past as a snap
  rather than a deliberate motion. Eased from 0.22s to 0.4s with a
  softer curve, and the hide-delay grace period extended from 450ms to
  700ms so moving from the hover-zone into the toolbar doesn't
  accidentally dismiss it.
- **Caught during this round's bug hunt, before shipping:**
  - Tag chip remove/add buttons were falling through the card's
    `mousedown` delegation with no exclusion, meaning a click on a tag
    chip could also select/drag the card underneath before the chip's
    own click handler ever ran (mousedown fires first). Added the same
    kind of exclusion the media controls already had.
  - A linter false-positive (`\blet\s` matching the English word "let"
    inside a code comment, not an actual `let` statement) — reworded
    the comment rather than loosening the regex, since that rule is
    correctly strict everywhere else.
  - Stale search state could persist across a board switch or file
    open, showing a query that no longer applied to anything on
    screen. Now explicitly cleared on both paths.

### About screen redesign
Rebuilt from inline `style.cssText` blobs (version number baked
directly into an `innerHTML` string, in two places) into real CSS
classes — same visual content, properly styled: rounded card, clean
type hierarchy, a pill-style version badge, and the update-check
button visually integrated instead of bolted on. Version number now
reads from `KanvazBoards.getVersion()` in one place instead of being
duplicated as a literal string.

### Housekeeping
- Removed the resolved "tags have no editing UI" and "annotation
  toolbar doesn't follow the canvas" lines from Known Limitations —
  properly removed rather than left in place with a note announcing
  the fix.
- Fixed a stale CHANGELOG entry still marked "not fixed yet" for the
  Map View port-alignment issue that was confirmed resolved back in
  v3.6.10.
- Fixed a stale CSS comment ("Dot grid overlay") that had survived
  since the grid changed to lines in v3.6.7.

### Audit
Full 10-pass audit before shipping: syntax ×2, static lint ×2 (caught
1 real false-positive, fixed), real-Chromium port alignment ×2, plus
4 targeted passes verifying every fix above is actually present and
wired — not just claimed. `npm run validate` passes clean.

## [3.6.12] — Clean Reset, Reliable Update Checker
- **Add: "Reset Kanvaz" (Settings → Reset).** Clears settings, the
  recent-files list, and the autosave/recovery cache, then restarts
  with defaults. Built as an in-app feature rather than hooking the
  NSIS uninstaller — an uninstall-hooked approach would only ever
  cover the installer distribution path, not the portable `.exe` or
  running from source, and hand-written NSIS scripting isn't something
  that could be compile-tested in the environment this was built in.
  The in-app version works identically regardless of how Kanvaz is
  being run, and is provably safe: the handler only ever constructs
  paths under `app.getPath('userData')`, and saved `.kanvaz` boards
  always live wherever the user chose via the save dialog — a location
  structurally outside `userData`, not something that needs excluding.
- **Investigated the installer-upgrade question further:**
  `deleteAppDataOnUninstall` (electron-builder's built-in option) was
  deliberately not used — it has a known bug with scoped package names
  (not applicable here, `name` is unscoped) but more importantly it
  would fire during routine version upgrades too, not just intentional
  uninstalls, silently wiping settings on every update unless very
  carefully scripted around. The in-app reset sidesteps this risk
  entirely.
- **Reliability pass on the "Check for updates" feature**, tested
  against GitHub's live API rather than assumptions:
  - Added an 8-second timeout (`fetch()` never times out on its own —
    without this, a hanging connection could leave the button
    disabled indefinitely).
  - Added specific handling for GitHub's rate-limit response
    (HTTP 403 with `X-RateLimit-Reset`) instead of lumping it into a
    generic "unreachable" message — verified against a real live
    rate-limited response encountered while testing this, not a mock.
  - Verified the success path against the real API too: confirmed
    version comparison correctly reports "up to date" for a build
    ahead of the latest published GitHub release.

## [3.6.11] — Installer Upgrade Behavior, Opt-In Update Check
- **Investigated: "many Kanvaz installs on one PC."** Checked the
  actual electron-builder/NSIS config: `appId` has been stable
  (`com.northbytestudios.kanvaz`) since v3.5.4, and electron-builder
  derives a deterministic upgrade/uninstall GUID from `appId` when one
  isn't explicitly set — meaning every installer-based install across
  every past version has already been sharing the same upgrade
  identity, and should already replace in place regardless of install
  path. Almost certainly explained by dev-testing folders and portable
  `.exe` builds instead (neither registers with Windows, so there's
  nothing for an installer to "clash" with) rather than an installer
  bug. Added an explicit `perMachine: false` to the NSIS config for
  defensive clarity — deliberately did **not** add a new custom GUID,
  since that would have broken upgrade continuity for every existing
  install rather than fixing anything (caught before shipping it).
- **Add: opt-in "Check for updates" in the About screen.** Fetches
  GitHub's latest release tag and compares it numerically against the
  running version (not as strings — `"3.6.10"` vs `"3.6.9"` sorts
  wrong under plain string comparison since `1` < `9`). This is the
  **only** network call anywhere in Kanvaz, fires only on click, never
  automatically or on startup. Given how central "zero network calls"
  has been to Kanvaz's identity, this wasn't added quietly — the
  About screen's copy, README, and the generated PDF's Privacy section
  were all updated to precisely disclose this one exception rather
  than leave an now-imprecise blanket "no internet" claim standing.

## [3.6.10] — Real Bug Root Causes, Top Mode Ergonomics
- **Fix: grid snap didn't work.** Root cause, confirmed by tracing the
  actual math: snap was only ever wired into **resize**, never into
  **moving** a card — and moving is the far more commonly tested
  interaction. Extended snap to card repositioning too. Also fixed a
  secondary correctness bug found while tracing this: aspect-locked
  resizes were snapping width and height independently, which could
  distort the locked aspect ratio — now snaps width only and re-derives
  height from it for aspect-locked corner drags.
- **Fix: Delete key "losing focus."** Root cause: after deleting a
  card, `selectedId` just went to `null` with nothing re-selected — so
  a keyboard-only bulk delete (Delete, Delete, Delete...) went dead
  after the first one, since the shortcut handler requires a selection
  to act on. Now auto-selects another remaining card after a delete.
- **Add: Top Mode auto-enables Always on Top**, gated behind a new
  Settings toggle (off by default). Remembers whether Always on Top
  was already on beforehand so exiting Top Mode restores that instead
  of just forcing it off — doesn't fight a separate, deliberate
  Always-on-Top preference if the user already had one set.
- **Add: Tab+MMB whole-window drag** — hold Tab and drag with the
  middle mouse button to move the window from anywhere on screen, not
  just a titlebar strip. Gated behind Tab specifically because plain
  middle-mouse-drag is already canvas-pan in both views. Known,
  disclosed tradeoff: Tab already toggles Top Mode on keydown, so
  holding Tab to start this drag also flips Top Mode as a side effect
  of that same keypress — living with it for now rather than adding
  toggle latency to fix a rare combination.
- **Add: thicker titlebar during Top Mode's reveal** (36px → 48px) and
  made the top hover-zone a real OS-level drag region — addresses
  "dragging is hard in Top Mode" directly, independent of the Tab+MMB
  feature above.
- **Confirmed fixed: the Map View port start-point discrepancy**
  reported by users. No longer reproducible — removed from Known
  Limitations in the README.
- **Docs**: caught two more stale "Mood lock" references that had
  survived the Top Mode rename — both were baked directly into the
  generated PDF (the feature list and the shortcuts table), so they'd
  been shipping in every release since without anyone noticing since
  they're not in the source Markdown that gets reviewed directly.
  PDF regenerated.

### Known issue, still unresolved
- **New/legacy `.kanvaz` files reported as "opening empty," at least
  partially.** Re-verified the full load pipeline end-to-end this
  round: all three entry points (File → Open, Recent Files list,
  startup screen) now consistently run the same validated
  flat-shape-migration logic, and the save/serialise round-trip for a
  freshly migrated board was traced and confirmed correct. Couldn't
  find a further defect through code inspection alone — if this is
  still happening, the most likely explanation is that the actual old
  file's shape doesn't match the flat-`cards`-array format the
  migration assumes (this repo has no source history before the
  public v2.0.1 release, so the true legacy format was inferred, not
  known). Need an actual sample of a file that still fails — even just
  its first ~20 lines of JSON — to fix this correctly instead of
  guessing a third time.

## [3.6.9] — Grid Snap, Dev Mode
- **Add: grid snap on resize.** New Settings toggle ("Snap to grid on
  resize") plus an increment selector — Minor (24px) or Major (120px),
  user's choice, as requested. Snaps width, height, and position
  during a resize drag. Uses world-space units, so it stays correct
  regardless of current zoom level (the grid's on-screen size changes
  with zoom; its logical spacing never does).
- **Add: Developer settings section**, 5 tools:
  - *FPS / render-time overlay* — small always-on-top HUD showing
    current FPS and last-frame time, updated twice a second.
  - *Show card/connection IDs* — overlays each card's and Map View
    node's real ID (small corner label), plus appends the connection
    ID to its type label in Map View. Useful for correlating what's
    on screen with what's in a saved `.kanvaz` file or a bug report.
  - *Run diagnostics now* — manually triggers Map View's runtime
    self-check on demand instead of only running on browser idle.
  - *Generate 50 test cards* — bulk-creates 50 synthetic note cards
    in a grid layout for stress-testing render/scroll/zoom
    performance. Deliberately bypasses the normal single-card creation
    path (which selects and focuses each card) since doing that 50
    times in a row would thrash badly — one history entry, one
    render pass, for the whole batch.
  - *Export debug info* — copies version, platform, theme, card/
    connection counts, window size, and full settings JSON to the
    clipboard in one click, ready to paste into a bug report.
- Added a `button` row type to the Settings panel renderer (previously
  only toggle/number/select existed) to support the three action-based
  Dev Mode tools above.

## [3.6.8] — Grid White-Out, Drop Sizing, Top Mode Polish
- **Fix: grid genuinely went white zooming out — confirmed and fixed
  empirically, not by inspection alone.** Rendered the exact grid
  algorithm headlessly at every zoom level and measured actual pixel
  brightness: it climbed from 21 (correct) to 155 (visibly washed out)
  well before the old cutoff logic engaged. Root cause: lines packed
  closer than ~12px apart have overlapping anti-aliased edges that
  visually merge. Replaced the abrupt spacing cutoff with a smooth
  per-line-type density fade (minor lines fade out 20px→12px, major
  lines 40px→24px) — verified the fix the same way, brightness now
  peaks at 60 and smoothly returns to 0, never climbing toward white.
  Applied identically to both Board View and Map View.
- **Fix: dropped/pasted images still overlapped despite the v3.6.6/6.7
  grid-arrange fix.** That fix technically worked (different
  coordinates per item) but used a fixed 220×180px spacing constant —
  while real cards default to 600px wide (user-configurable up to
  1200px via `defaultCardW`). Any photo wider than 220px still
  overlapped its neighbor. Now sizes grid spacing off the actual
  `defaultCardW` setting instead of a guessed constant.
- **Fix: right-click menu could clip off-screen at small window
  sizes.** The existing flip-if-overflowing logic had no final clamp —
  if the menu didn't fit even after flipping to the other side, it
  just clipped off the *opposite* edge instead. Extracted the
  duplicated positioning logic (canvas menu + card menu) into one
  shared, properly-clamped helper.
- **Fix: Settings panel could overflow off-screen with no way to
  scroll** at small window heights (window now floors at 240px tall
  since v3.6.7). Added `max-height` + scroll.
- **Add: `S` toggles Settings, `I` toggles About** (matching `?`'s
  existing open/close toggle behavior, which About didn't have until
  now — it always created a fresh overlay instead of checking for one
  already open). Both verified gated behind the same text-input guard
  as board shortcuts — typing "s" or "i" in a note or filename field
  still types normally, confirmed programmatically by checking their
  position in the shortcut-handling code relative to the guard, not
  just by inspection.
- **Top Mode's hover-reveal is now genuinely minimal**, not just the
  full toolbar in miniature: only app name, project title, and
  minimize/maximize/close — export and always-on-top are hidden too.
  The separate "Auto-hide toolbar" *setting* still reveals the full
  toolbar as before; only Top Mode itself got the minimal treatment,
  since it's a presentation mode, not a toolbar-access convenience.
- **Add: persistent "Top Mode — Tab to exit" indicator** — a small,
  low-opacity badge shown the entire time Top Mode is active,
  independent of hover-reveal state. Previously there was no way to
  tell Top Mode was on (or how to get out) without already knowing the
  shortcut.
- **Widened the Top Mode hover-zone hitbox** from 10px to 16px — easier
  to trigger reliably.

## [3.6.7] — Grid, Resize, and Top Mode (formerly Mood Lock)
Follow-up round from continued real-world testing of v3.6.6.

- **Board View grid changed from dots to lines too.** The original
  "graphs with lines" request was mainly about Board View, not Map
  View — v3.6.6 only fixed Map View. Both views now use the identical
  major/minor line-grid algorithm (bold line every 5th cell), so the
  whole app is visually consistent.
- **Grid visibility increased in both themes.** The line alpha values
  were quite subtle (5-14%) — bumped to 9-22% (theme-specific) for a
  clearly visible but still subordinate grid, verified by computing the
  actual blended pixel delta against each theme's canvas color rather
  than eyeballing it.
- **Window can now resize much smaller, unconditionally.** Previously
  the small ~220×160 floor only applied while Top Mode or the
  Auto-hide toolbar setting was active — normal (chrome-visible) mode
  was still floored at 640×480. The unconditional floor is now
  320×240, always, regardless of mode. The toolbar now scrolls
  horizontally instead of breaking if there isn't room for every
  button, and the titlebar title truncates with an ellipsis instead of
  potentially pushing the minimize/maximize/close buttons out of reach
  — verified those buttons have a non-negotiable `flex-shrink: 0` so
  that can never happen at any window size.
- **Mood Lock renamed to Top Mode, with an easier shortcut.**
  `Ctrl+Shift+F` (a 3-key chord) still works for muscle memory, but
  `Tab` is now the primary trigger — deliberately chosen to match the
  "hide all panels" convention VFX/3D artists already know from
  Blender and Photoshop. `Tab` is gated behind the same text-input
  guard as board-shortcuts (not an "always fire" binding), since Tab
  has a native meaning inside form fields; `Ctrl+Shift+F` stays in the
  always-fire group as before.

## [3.6.6] — Real-World Testing Fixes
Everything below came from actually testing v3.6.5, not internal review —
thank you to whoever put it through its paces.

- **Fix: clipboard paste (Ctrl+V) still had the old stacking bug.** v3.6.5
  fixed drag-drop's cascade-offset stacking but missed that paste had the
  *exact same* bug independently (`(pasteCount % 8) * 24` — same
  too-small offset, plus it read a racy global card count from inside an
  async callback instead of the paste batch's own index). Extracted a
  single shared `gridArrangePos()` helper used by both drag-drop and
  paste now, so this class of bug can't drift out of sync between the
  two paths again.
- **Map View grid changed from dots to lines.** The original ask
  ("graphs with lines") was misread as a request for a dot-grid
  matching Board View's — it meant actual grid lines. Replaced with a
  major/minor line grid (bold line every 5th cell) — the node-editor
  "blueprint" look from Blender/UE/Houdini, which also visually
  differentiates Map View from Board View's dot grid instead of
  duplicating it.
- **Fix: perceptible lag when switching into Map View / zooming.**
  Root cause: `diagnose()` (the runtime self-check) ran on a flat 30ms
  delay after every render, forcing synchronous layout
  (`getBoundingClientRect` per node) — which landed squarely inside the
  ~480ms eased camera tween and staggered entrance animations added in
  v3.6.3, causing layout thrashing exactly when opening/zooming Map
  View. Now uses `requestIdleCallback` (falls back to a 600ms
  `setTimeout`) so it only runs once the browser is actually idle.
  Also added a redundant-redraw guard on the grid so unchanged
  tx/ty/scale between frames skips a full canvas repaint.
- **Generalized Mood Lock's hover-reveal into its own setting.**
  v3.6.5 added hover-to-reveal chrome, but only inside Mood Lock
  (`Ctrl+Shift+F`) — a tester using the app normally never found it,
  couldn't shrink the window small, and went back to PureRef over it.
  Added a new persistent **"Auto-hide toolbar"** setting
  (Settings → Behavior, default off) that turns on the same
  hover-reveal mechanic and the relaxed window-size floor as a standing
  preference, independent of Mood Lock. The two can be on
  simultaneously without fighting each other — turning either off only
  disables the shared hover machinery once *both* are off. Mood Lock
  itself is unchanged (still also hides the statusbar, still a
  shortcut-gated presentation mode) — this is additive, not a
  replacement.
  Default is **off** — flagging this as a real product call, not an
  obvious one: defaulting a first-time user straight into
  hidden-toolbar mode risks hurting discoverability of New/Open/Save
  for anyone not already coming from PureRef. Easy to flip to
  default-on if that's the wrong call for the target audience.

## [3.6.5] — Bug Fixes from User Reports
Several real bugs reported by users, root-caused and fixed:

- **Recovery dialog firing on nearly every launch.** `handleCloseRequest()`
  never cleared the crash-recovery file on a clean close — only after the
  user answered the recovery-restore dialog. Since autosave writes that
  file every ~30s during any session, a routine tick before a perfectly
  normal close left it behind, so "Recover unsaved board?" appeared on
  the next launch even with nothing actually lost. Now cleared on every
  clean-close path (no-changes, Save, Don't Save).
- **Old files silently loading empty.** `loadFromJSON` has required
  `data.boards` to exist since the very first public commit (v2.0.1),
  with a silent no-op otherwise. Any file predating the `boards[]`
  wrapper appeared to load as a completely empty board with zero
  explanation. Added `migrateLegacyShape()` — auto-detects a flat
  legacy shape (`cards` at the top level) and wraps it into a synthetic
  board, with an explicit "migrated automatically" toast. A file
  matching neither shape now gets a clear "File format not recognised"
  error instead of doing nothing.
- **Mass file drops stacking cards on top of each other.** Drop
  placement used a fixed 24px diagonal cascade per file — fine for 2-3
  files, but cards are ~200-300px, so batch drops of 10+ files visually
  overlapped almost entirely. Replaced with a proper `ceil(sqrt(n))`-
  column grid layout, still placed in drop order.
- **Near-invisible muted text.** `--color-text-3` measured 3.3–3.7:1
  contrast in both themes — failing WCAG AA (4.5:1) for body text.
  Brightened in both dark (`#6A6A8A` → `#8A8AAC`) and light
  (`#7A7A94` → `#5C5C78`) themes; both now clear 5:1+.
- **Map View had no background grid.** It hid Board View's grid canvas
  entirely and showed a blank field. Added an equivalent dot-grid,
  independent implementation tied to Map View's own pan/zoom state.

### Mood lock hover-reveal + smaller window floor
- Mood lock (Ctrl+Shift+F) no longer needs Esc as the *only* way back
  to the toolbar — hovering the top edge (or the toolbar itself while
  it's showing) now briefly reveals title/toolbar/tabs as a floating
  overlay, without exiting mood lock or resizing the canvas underneath.
  Move away and it hides again after a short delay.
- Window minimum size now relaxes from 640×480 to 220×160 while mood
  lock is active (that floor exists so the ~10-button toolbar doesn't
  overlap/clip — mood lock has no toolbar, so it doesn't need the
  space). Restores to 640×480 immediately on exit, growing the window
  back up if it had been shrunk smaller.

### Previously known issue — now resolved
- Map View: connection wires sometimes starting from a different point
  than the output port — confirmed fixed as of v3.6.10, no longer
  reproducible. Removed from README Known Limitations.

## [3.6.4] — Post-Polish Audit
- Fixed: `hide()` didn't cancel an in-flight eased camera tween
  (fit-all/reset) — switching out of Map View mid-animation left a
  `requestAnimationFrame` loop running against a hidden element until
  it finished. No visible symptom (self-healed on next open since
  `fitAll` re-cancels), but wasted work. Now cancelled on `hide()`.

## [3.6.3] — Portfolio Polish Pass
Visual polish pass with no functional changes, aimed at clean
screenshots/GIFs:

- **Eased camera moves** — fit-all (board open) and the `0`-key reset
  now tween with `easeOutCubic` instead of snapping instantly.
  Deliberately kept separate from wheel-zoom/drag-pan, which stay
  instant (already tuned jank-free in an earlier fix) — any real user
  input cancels an in-flight tween immediately.
- **Entrance choreography** — cards fade+lift in staggered, connections
  draw on with a bezier stroke reveal + fade-in halo. Only on first
  board open, never on normal editing re-renders.
- **Wire-drag glow** — active port + preview line now have a soft
  accent-colored glow instead of a flat color.
- **Accent color (dark theme)**: blue `#4A9EFF` → violet `#9D7FFF`.
  Fixed 8 additional hardcoded-hex instances that had drifted from the
  project's own "use CSS vars for theme support" rule (toolbar active
  state, drop overlay, gif badge, resize handle, 2 button hovers,
  minimap viewport box, node-hover glow) — all now route through a new
  `--color-accent-rgb` var so future accent changes propagate
  everywhere automatically.
- Fixed: `portOut`'s mouseleave was restoring to `--color-border-2`
  instead of its actual idle color `--color-port`.
- Added `demo/Kanvaz-Portfolio-Demo.kanvaz` — a curated 9-card demo
  board for portfolio screenshots, no real media required.

## [3.6.2] — Port-Alignment Test Safety Net
The port math itself was already correct (verified 0px error across 5
zoom/pan cases) — the safety net around it had two real holes:

- `diagnose()`'s runtime self-check only ever compared the X-axis for
  both ports — any Y-axis drift was invisible to it. Now checks both
  axes.
- `test/run-port-test.js` hardcoded a Chrome path from one prior
  development machine and loaded a `/tmp` file nothing ever generated
  — it had never actually run correctly outside that one session,
  silently skipping or crashing everywhere else. Rewritten to
  auto-detect a Chrome/Chromium install (env var → per-OS common paths
  → puppeteer's own cache) and regenerate its test fixture into a real
  temp file on every run.

## [3.6.1] — 20-Level Audit Cleanup
Passed a 20-level audit (each check run and verified twice). One fix:

- Removed dead code: verifyPortAlignment() (~55 lines) was superseded by
  diagnose() in v3.5.4 but left defined and exported. Removed the function
  and its export. diagnose() remains the single runtime health check.

Audit confirmed clean across: syntax (16/16), var-rule, CSP, versions,
port alignment (0px, real Chromium), guarded JSON.parse (7/7), theme
coverage, NaN/transform guards, orphan-connection cascade, event-listener
cleanup, media error handling, backward compat, and full validation suite.

## [3.6.0] — UI Polish Pass
Elevating what exists — no new features, just a more premium feel.

### Toolbar
- Buttons: press-scale feedback (0.96) on click, disabled state styling
- Icons: stroke-width standardized to 1.5 across all toolbar/titlebar icons
  (was a mix of 1.3 / 1.5 / 1.6 — looked uneven)

### Map View
- Nodes: smoother 0.18s ease transitions on hover
- Ports: soft accent-colored glow ring on hover (0 0 0 4px accent-bg)
- Port transitions eased for a more tactile feel

### Context Menu
- Consolidated duplicate CSS rules from the v3.5.0 polish pass
- Larger radius (10px), roomier padding, deeper shadow
- Keyboard shortcut hints now render as subtle kbd-style badges
- Danger items (Delete) show red on hover

### Settings Panel
- Grouped into sections: Appearance, Behavior, Files
- Section headers in uppercase micro-labels
- Theme-aware panel shadow

### Dialogs
- Buttons: press-scale feedback
- Theme-aware shadows

### Theme Consistency
- Replaced remaining hardcoded rgba shadows with var(--color-shadow)
  in settings panel and dialogs (better light-theme rendering)

## [3.5.5] — Connection Tubes Anchor to Live DOM Ports
The real root cause, found by end-to-end audit.

### Root Cause
The port MATH was correct (proven 0px in v3.5.3/4). The bug: renderLines
computed tube endpoints from stored card.mapPosition, but that value can
go stale relative to where the node actually renders — from the hover
transform (translateY -1px), Math.round drift on drag, or board/map
position desync in saved files. Result: tubes anchored to where the card
USED to be, floating in empty space while the real port O sat unconnected
(exactly what the screenshots showed).

### Fix
- New domPort(refId, side): reads the ACTUAL rendered port-dot center
  from the DOM via getBoundingClientRect, converted to world coords.
- renderLines and wire-preview now use resolveOut/resolveIn, which return
  DOM truth when available and fall back to math only if the node isn't
  in the DOM yet. This is how real node editors (Blender, Unreal, n8n)
  anchor wires — to the DOM handle, never to stored coordinates.
- Removed .map-node:hover translateY(-1px) — it shifted the port O away
  from the tube anchor on hover.

### Proven
- Test with STALE mapPosition (node renders at 300,300 but stored says
  100,200): old math → tube at 275,226 (floating). New domPort → 475,326
  (exactly on the port O). Verified in real Chromium.

## [3.5.4] — Advanced Error Debugging & Validation Suite
Tooling to catch bugs before they ship — not after.

### New: Validation Suite (test/)
- `npm run validate` — master check: syntax, lint, port alignment, versions.
  Exits non-zero if anything fails. Run before every release.
- `npm run lint` — static analyzer that catches the exact bug classes this
  project has hit: var-rule violations, inline onclick (CSP), version drift,
  unguarded JSON.parse, hardcoded dark colors, stale release language,
  leftover TODO/FIXME. Zero false positives on current code.
- `npm run test:ports` — renders node CSS in real Chromium, proves the
  connection port formula matches actual DOM at 5 zoom/pan levels (0px error).

### New: Runtime Self-Diagnostic
- KanvazMapView.diagnose() runs after every Map View render and on demand.
  Checks: NaN/Infinity transforms (blank canvas), orphan connections
  (pointing at deleted cards), duplicate connections, missing port dots,
  and live port-alignment drift. Logs colored pass/fail to DevTools console.

### Validated
- The linter immediately caught a .forEach violation in new diagnostic
  code during development — exactly the kind of bug it exists to stop.
- Fixed: 2 inspector dialog overlays now use var(--color-overlay).
- All checks green: 16/16 syntax, 0 lint errors, 0px port error, versions aligned.

## [3.5.3] — Port Math PROVEN Against Real Browser Rendering
This time, measured — not reasoned.

### The Fix
- Port formula corrected to PORT_INSET = 1px (was 1.5px). Verified by
  rendering the exact node CSS in real headless Chromium and measuring
  actual port-dot center positions via getBoundingClientRect:
  - outPort.x = mapPosition.x + NODE_W - 1 (175)
  - inPort.x  = mapPosition.x + 1
  - The 1px = half the port dot's own 2px border, not the node's 1.5px.

### Proof
- Added test/ directory with a Puppeteer test that renders nodes in real
  Chromium and compares formula vs actual DOM at 5 zoom/pan levels
  (1.0, 1.5, panned 1.5, zoomed-out 0.5, arbitrary 2.3 + offset).
- Result: error=[0,0] on every port at every transform. ALL CASES PASS.
- Run it yourself: `node test/run-port-test.js`

### Why previous attempts failed
Every prior fix reasoned about the CSS box model on paper and got the
sub-pixel border handling wrong (1.5 vs 1). The only reliable method is
to measure what the browser actually renders — which this version does.

## [3.5.2] — Connection Port Math: Definitive Fix
The port alignment bug, solved from first principles.

### Root Cause (finally identified)
The SVG that draws connection lines and the node divs are BOTH children
of #map-world, sharing one coordinate space. Previous versions used
getBoundingClientRect() to read port positions, then converted screen→
world coordinates — but that conversion mixed up the CONTAINER rect and
the WORLD rect (which differ when the world transform is applied),
producing large, zoom-dependent offsets.

### Fix
- Port positions are now PURE world-space arithmetic — no DOM reads, no
  screen conversion, no cache. Derived directly from CSS box model:
  - Absolutely-positioned port dots are placed relative to the node's
    PADDING BOX (CSS 2.1 §10.1). With box-sizing:border-box and a 1.5px
    border, the padding-box right edge = mapX + NODE_W - BORDER.
  - outPort.x = mapPosition.x + NODE_W - NODE_BORDER (174.5)
  - inPort.x  = mapPosition.x + NODE_BORDER (1.5)
  - Y: mapPosition.y + NODE_H/2 (border cancels top/bottom symmetrically)
- Wire preview: origin from outPort() math, cursor endpoint from a single
  correct mouse→world conversion (container rect − tx/ty, ÷ scale).
- Verified against CSS spec: max error 0px.

### Debug
- verifyPortAlignment() now compares math against DOM using the WORLD
  rect (SVG's true origin), runs after every render, logs any drift.

## [3.5.1] — Docs Polish
- Fixed: "Light and dark themes" was listed under Known Limitations
  instead of Features — moved to Features section.
- Added: Light / dark theme to Features list.
- All docs verified: README, PRIVACY.md, THIRD_PARTY_NOTICES.md,
  TECHNICAL_OVERVIEW.md, CHANGELOG.md, LICENSE — all current and
  consistent with v3.5.1.

## [3.5.0] — UI Polish + Port System Rewrite
Ship date: July 1, 2026

### Port System — Final Rewrite
- Eliminated: port cache, CSS math, box-sizing assumptions — ALL removed.
- New: getPortPos() reads port dot center via getBoundingClientRect every
  call. outPort/inPort delegate to getPortPos with math-only fallback.
- Wire preview: origin captured from clicked port dot's DOM position at
  exact click moment (wireOriginPos). Wire starts from the O, period.
- This approach is correct by construction — reads the rendering engine's
  own layout output. Cannot break from CSS changes.

### UI Polish
- Map nodes: hover lift animation (translateY -1px + shadow increase)
- Map nodes: selection glow uses CSS variable accent, not hardcoded blue
- Map shadows: all 7 hardcoded rgba() → var(--color-shadow)
- Map tube inner shadow: theme-aware (var(--color-text-inv))
- Map dialog overlay: var(--color-overlay)
- Cards: hover lift shadow transition
- Context menu: border-radius 10px, fade-in animation, danger items red
- Light theme: card selected accent border + shadow, toolbar/statusbar
  separators, context menu border + shadow + hover

### Recovery Dialog
- clearRecovery() now in all 4 paths: Save, Save As, Open, startup open
- No more phantom restore dialogs on saved files

## [3.4.2] — Recovery Fix + DOM-Based Port Alignment
Ship date: July 1, 2026

### Critical Fix: Recovery Dialog
- Fixed: restore dialog appeared on EVERY launch even after the file was
  already saved. Root cause: clearRecovery() was only called in saveBoard()
  but NOT in saveBoardAs(), openBoard (Ctrl+O), or startup screen file open.
  Now called in all 4 save/open paths.

### Critical Fix: Port Alignment (attempt 7 — correct by construction)
- Replaced: all CSS-math-based port position computation with DOM-based
  reading via getBoundingClientRect(). Previous attempts failed 6 times
  due to box-sizing assumptions. The new approach queries the ACTUAL
  rendered position of each port dot from the browser's layout engine,
  converts to world coordinates, and caches them. This is correct
  regardless of CSS box model, padding, border, or future style changes.
- Wire preview: origin captured from the clicked port dot's DOM position
  at the exact moment of click — stored as wireOriginPos. Preview bezier
  now starts from the exact center of the O the user clicked.
- Port cache: rebuilt SYNCHRONOUSLY before every renderLines() call
  (was async setTimeout — caused stale positions on first render).
- Port cache also rebuilt: during live node drag, after drag end.
- Mathematical fallback retained for edge cases where DOM isn't ready.

### README
- Added: development status banner (Map View under active development)
- Added: Map View marked as "under active development" in features

## [3.4.1] — Bugfix Patch
Correct port math for border-box + final bug sweep.

### Critical
- Fixed: connection tube endpoints were 31px off — port math assumed
  content-box but global CSS uses border-box. With border-box,
  width:176px IS the total width. Correct formula:
  outPort.x = mapPos + NODE_W - BORDER (174.5), not mapPos + 205.5.

### Fixes
- Fixed: pressing L (theme toggle) didn't redraw grid dots — dots stayed
  wrong color until next zoom. Now calls drawGrid() immediately.
- Fixed: Annotate showed in context menu and A shortcut for audio cards
  (drawing on a scrub bar is useless). Now hidden for note + audio.
- Fixed: NODE_FULL_W/H were wrong (used content-box formula). Now equal
  NODE_W/NODE_H since border-box means width IS the full width.

### UI
- Light theme: accent borders on selected cards, toolbar/statusbar
  separators, context menu border + shadow, hover highlight.
- Shortcuts overlay: 3-column layout with Cards section.
- About screen: updated tagline.

## [3.4.0] — Connection Tube Alignment Fix + Light Theme
Major bug fix + new light/dark theme system.

### New: Light / Dark Theme
- Press L to toggle between light and dark themes instantly.
- Theme persists in settings (also available in Settings → Theme dropdown).
- Light theme: clean white surfaces, darker text, blue accents, subtle shadows.
- Grid dots adapt automatically (dark on light, white on dark).
- Map View port dots, node cards, bezier tubes, and inspector all theme-aware.
- CSS custom properties: --color-port, --color-shadow, --color-overlay added
  for consistent theming across JS-generated elements.

### Critical Fix
- Fixed: connection tube bezier endpoints were 30px left and 2px above
  the actual port dot positions. Root cause: outPort()/inPort() used
  NODE_W (content-box width = 176px) but the node has CSS padding (14px
  each side) and border (1.5px). The port dots are positioned relative to
  the PADDING BOX (204px wide), not the content box. The SVG endpoint was
  at mapPos+176 but the DOM dot was at mapPos+205.5 — a 29.5px offset.
  Fix: added NODE_BORDER and NODE_PAD constants, port math now computes
  from the padding box edges: outPort.x = mapPos + border + pad + W + pad,
  inPort.x = mapPos + border.

### Debug Infrastructure
- Added: verifyPortAlignment() — runs after every map render, compares
  SVG endpoint coordinates against actual DOM port dot positions via
  getBoundingClientRect(). Logs "[Kanvaz] port alignment OK" on success,
  or warns with exact delta values if any coordinate drifts more than
  2px. Can also be called manually from DevTools console via
  KanvazMapView.verifyPortAlignment().
- Added: NODE_FULL_W / NODE_FULL_H constants (207px / 55px) — the actual
  visual dimensions including border and padding.
- Fixed: fitAll() was using NODE_W/NODE_H (content-box) for bounding box,
  now uses NODE_FULL_W/NODE_FULL_H for accurate framing.

## [3.3.0] — Comprehensive Audit Pass
Full cold-read audit of all 16 source files + all metadata.

### Bugs Fixed
- Fixed: video scrub bar stayed visible after video format error (now
  hidden alongside the video element when onerror fires)
- Fixed: video play button showed PAUSE icon before video loaded (now
  shows PLAY, switches to PAUSE on onloadeddata)
- Fixed: duplicate scrub bar + playBtn variables created in video card
  builder (leftover from v3.2.0 refactor — one created before vid.src,
  duplicate re-created after)
- Fixed: MKV/AVI listed as "supported" in error toast but Chromium can't
  play them — removed from supported list, added format warning toast
  when MKV/AVI files are dropped

### Cleanup
- Updated: CHANGELOG v2.0.x entries — removed "Final release" and "No
  further development planned" labels (confusing alongside active v3 dev)
- Updated: package.json description to "Reference Operating System"
- Updated: About screen reflects v3.3.0

## [3.2.0] — Performance + Stability
Ship date: July 1, 2026

### Performance
- Fixed: scroll zoom lag — grid now draws all dots in a single batched
  canvas path (was thousands of individual arc+fill calls per frame).
  Transform updates throttled to one grid redraw per animation frame.
- Added: grid drawing skips entirely when dot spacing < 4px (extreme
  zoom-out was drawing invisible sub-pixel dots).

### Stability
- Fixed: canvas content disappearing on aggressive pan/zoom — tx/ty
  now clamped to ±5M pixels with NaN/Infinity guard. If transform
  values exceed safe CSS limits, they're clamped instead of pushing
  the world div offscreen.
- Fixed: video corruption on import — added error handler that shows
  "Video format not supported" message instead of silent black frame.
  Video now preloads metadata before attempting playback. Autoplay
  deferred until onloadeddata fires.

### Autosave
- Fixed: autosave JSON.stringify now wrapped in try-catch (was crashing
  silently on very large boards).
- Added: "✓ Recovery saved" indicator flashes briefly in status bar
  when autosave succeeds, so users can see it's working.
- Note: autosave writes to a recovery file only (not your .kanvaz file).
  "Unsaved changes" in the status bar means the file hasn't been
  explicitly saved — the recovery file is a separate crash safety net.

### Connection System
- Fixed: tube endpoint now matches port dot center exactly (the PORT_R
  offset was double-counted — tube terminated 7px past the actual dot).
- Added: colored dot at BOTH source and destination ports (previously
  only the destination had a colored dot).

## [3.1.1] — Audit Bugfix Pass
Full cold-read audit of all 16 source files. 10 bugs found and fixed.

### Critical
- Fixed: Board/Map toggle buttons were completely dead — inline onclick
  attributes were blocked by Content Security Policy. Rewired CSP-safe.

### Major
- Fixed: connection port dots flashed to wrong color on wire cancel
- Fixed: cursor stuck as grab icon after dragging a map node
- Fixed: deleting a board left orphaned connections for that board's cards
- Fixed: removeAllFor() deleted object keys during for-in iteration
  (undefined behavior) — now collects keys first, then deletes
- Fixed: startup screen file open didn't bump the file to top of recents

### Minor
- Fixed: Annotate shown in context menu for note cards (hidden now)
- Removed: dead `var menuItems` variable in context menu builder
- Moved: hasRenderedOnce variable to module top for clarity
- Removed: 16 unused SVG arrow marker and glow filter elements from DOM

## [3.1.0] — Polish + Connection System Completion
Kanvaz is actively developed. This release addresses video-reported issues
and completes the v3 connection system polish.

### Connection System
- Fixed: connection tubes now attach flush to port dots with zero gap
  (previous version had a 30–60px gap between tube start and node edge)
- Improved: Unreal/Maya-style bezier tension — cables pull out of ports
  horizontally before curving, high tension floor of 90px
- Improved: tube is now 3px wide with outer glow + inner depth shadow
- Removed: arrowhead replaced by a filled dot terminator at destination port
- Fixed: connection tubes correctly loop when target node is to the left
- Port dots increased to 7px radius, dark fill with colored border on hover

### Map View
- Added: empty state when no references exist ("Add in Board view first")
- Added: fit-all on first map open — all nodes centered in view
- Fixed: map view resets fit on each board visit (not just once)

### UI Polish
- Fixed: NOTE badge was bright green — now muted/subtle (matches dark theme)
- Fixed: resize handles are now small round dots instead of square chips
- Improved: Board/Map view toggle is now a proper segmented control pill
- Fixed: audio card default size reduced (was 320×140, now 280×100)
- Fixed: type-aware context menus — Flip H/V and Reset Size hidden on note cards

### Bugs
- Fixed: autosave now starts after settings load (was starting too early,
  interval setting had no effect on first run)
- Fixed: new board now clears connections (was leaking previous connections)
- Fixed: inspector panel closes when its reference card is deleted
- Removed: "final release" language from About screen and CHANGELOG
  (Kanvaz is actively developed, targeting v5.0 long-term)

## [3.0.0] — Reference Connection System + Map View
Kanvaz evolves from a reference board into a Reference Operating System.

### New: Map View
- Press M (or click the Board/Map toggle in the toolbar) to switch to
  Map View — a visual graph of all references and their connections.
- References appear as compact node cards with thumbnail, name, and
  connection count badge.
- Connections render as colored SVG lines with directional arrows and
  relationship type labels.
- Hover a node to highlight all its connections and dim the rest.
- Drag nodes to arrange the map layout — positions save per board.
- Independent pan (click empty space + drag) and scroll-zoom from the
  board canvas. Press 0 to reset the map view.
- Right-click a node for map-specific options: "Connect to..." starts
  connection creation mode, "Go to on board" switches back and selects
  the reference, "Remove all connections" clears a node's relationships.
- Create connections directly on the map: right-click → Connect to →
  click target node → pick relationship type from the type picker.
- Map view state (pan, zoom) persists per board across saves.

### New: Connection System
- References can now be connected to each other with directional
  relationships (Related To, Inspired By, Derived From, Alternative To,
  Supports, Used In, References).
- Each connection supports an optional note, priority (Low/Medium/High),
  and automatic timestamps.
- Deleting a reference automatically removes all its connections.
- Connections are included in undo/redo — creating, editing, or removing
  a connection can be undone with Ctrl+Z.
- Connections persist in the .kanvaz file format (backward compatible —
  v2.x files load cleanly with zero connections).

### New: Connection Inspector
- Select any reference and press C (or right-click → Connections) to
  open the Connection Inspector panel.
- View all outgoing and incoming connections with type tags, priority
  indicators, and notes.
- Create new connections: pick a target reference, choose a relationship
  type, add an optional note and priority.
- Edit existing connections: change relationship type, note, or priority.
- Delete connections individually.
- Double-click a connection row to jump to the connected reference.

### New: Reference Type System
- Internal type registry for 10 reference types: Image, GIF, Video,
  Audio, Note, URL, PDF, Color, File, Outcome.
- v3.0 ships with the 5 original media types fully functional; the 5
  new types (URL, PDF, Color, File, Outcome) are registered in the
  type system and supported in the data model but do not yet have
  dedicated creation UI — that ships in v3.1.

### New: Reference Metadata
- References now support tags (array of strings) and custom properties
  (key-value pairs) in the data model. UI for editing tags/properties
  ships in v3.1.
- References have a separate mapPosition field for future Map View
  positioning (independent of canvas position).

### File Format
- .kanvaz files now include a top-level `connections` array alongside
  boards. Version field is "3.0.0".
- Full backward compatibility: v2.x files load as v3.0 with empty
  connections, tags, and properties — no data loss.

## [2.0.2]
- Fixed: **Undo** could wipe the entire board when undoing back to the
  initial state after loading a file — the undo baseline was incorrectly
  set to an empty board instead of the loaded board state.
- Fixed: **Delete card** history was recorded before the card was actually
  removed, causing the undo stack to briefly get out of sync with the
  screen. Delete now also pauses any playing video/audio before removing
  the card element.
- Fixed: **Arrow-key nudge** was invisible to undo — nudging a card with
  arrow keys couldn't be undone. Now records a single undo step after
  you stop nudging (debounced, so holding an arrow key doesn't flood
  the undo stack).
- Fixed: **Note text editing** was invisible to undo — typing in a note
  card couldn't be undone. Now records an undo step when you click away
  from the note (on blur).
- Fixed: **Send to back** (right-click menu) was invisible to undo.
- Fixed: **Autosave interval** setting in Settings had no effect — the
  timer was hardcoded to 30 seconds regardless of the setting value.
- Fixed: **Default card width** setting had no effect — the drop-width
  cap was hardcoded to 600px regardless of the setting value.
- Fixed: **Always on top** (T key) didn't persist across restarts. Now
  saves to settings and applies automatically on launch.
- Fixed: **Show recent on startup** setting had no effect due to an
  init-order timing issue — the setting was checked before it had loaded
  from disk.
- Fixed: corrupted settings.json was silently ignored — now logs a
  warning and falls back to defaults.
- Added missing shortcuts to README: A (annotate), Ctrl+A (select all),
  Ctrl+Shift+S (Save As).

## [2.0.1]
- Identity update: now made by Atharva Patil (Northbyte Studios).
- Updated docs and in-app About screen. Identity update: Atharva Patil (Northbyte Studios).

## [2.0.0]
- First stable release with full feature set.
- README and overview PDF updated to mention audio card support.
- Removed leftover debug logging.

## [1.1.3]
- Fixed: pressing **P** to pin/unpin a card could show two conflicting
  toasts ("Card pinned" / "Card unpinned") at once.
- Fixed: **Ctrl+D** could create 3 cards total instead of 2 (duplicate
  fired twice from a single press).
- Added a key-repeat guard so holding down a shortcut key (Ctrl+D, P,
  Ctrl+S, etc.) fires the action once, not repeatedly. Arrow-key nudging
  still repeats while held, as expected.

## [1.1.2]
- Bigger, higher-contrast resize handles on cards.
- Replaced the annotation toolbar's text icons with proper SVG icons.
- Cleaned up the visual style of selected/pinned cards, board tabs, and
  the toolbar.
- Improved note placeholder text contrast.

## [1.1.1]
- Internal audit and bug-fix pass: smoother file loading, fixed an issue
  where resizing an annotated card could erase the annotation, fixed a
  memory leak when switching boards with annotations active, fixed
  several edge cases around closing/saving boards, and reduced undo
  history memory usage.

## [1.1.0]
- Added audio card support (MP3, WAV, OGG, M4A) with play/pause, seek,
  mute, and a visible scrub bar.

## [1.0.1]
- Added a "Save changes before closing?" prompt when closing with
  unsaved work.
- Fixed the crash-recovery "Restore" button.

## [1.0.0]
- Initial release: infinite pan/zoom canvas, image/GIF/video cards,
  drawing/annotation tools, multiple boards, undo/redo, minimap,
  settings, and "mood lock" presentation mode.
