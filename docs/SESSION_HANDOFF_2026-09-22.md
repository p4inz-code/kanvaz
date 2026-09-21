# Session handoff, 2026-09-22 (stopped for the night; release is tomorrow)

**State:** all work is committed locally on `main` (WIP commit, NOT pushed, NOT tagged, NOT released). `node test/validate.js` passes. Latest published release is still **9.0.0**. Version is still 9.0.0 everywhere; the target is **9.1.0**.

## Done since 9.0.0 (all unreleased, described in CHANGELOG `[Unreleased]`)
- 13 3D render modes, camera views, turntable, clip picker, shader-error / WebGL-context-loss recovery.
- Adobe previews (PSD/PSB/AI/XD/INDD/Fresco), worker thread, limits.
- Kanvaz Link (Kanvaz side): listener, controller, consent, drop dir.
- "Open with Kanvaz" for all supported types; platform-aware shortcut labels (`src/platform.js`, Apple notation on macOS).
- Blender locate: registry/Spotlight association + persisted `blender.json` choice (main + preload IPC exist; **Settings UI rows not added yet**).
- Link bug-bounty fixes applied (auth timeout, name normalisation, consent maps, consent cap, `starting` guard). Consent keys are now lower-cased, so the status list shows lower-case names (cosmetic; could keep a display name).
- 3D bug-bounty fixes applied in this last step (**NOT live-verified**, only unit tests + lint): private bookkeeping moved out of `userData` into WeakMaps/WeakSet (glTF extras can't forge it), shared source-material builds, shared UV checker never disposed, helper meshes not disposed by card teardown, `forceContextLoss` on dispose, near/far refit on restore/preset, camera persisted on reset/preset/turntable stop, turntable delta-based, Alpha mode solid for OPAQUE materials, popup menu closes on dispose.

## Tomorrow morning, in order
1. **Live-verify the 3D fixes** (scratch `--user-data-dir`, CDP, real screenshots): all 13 modes on the sample glb, wireframe hidden-line, Reset view, view presets, turntable start/stop + Properties checkbox, undo/redo, delete a 3D card then add another (shared materials must survive), UV grid on two cards then delete one.
2. Link tests: add the regression tests still missing (`__proto__` client name, name variants / dialog spoof, consent flood cap, overlapping `start()`, unauthenticated connection auth timeout via `authTimeoutMs`, `normalizeName`).
3. Open-with bounty fixes: installer default-handler hijack (fileAssociations only `.kanvaz`; mac via `extendInfo.CFBundleDocumentTypes` Viewer/Alternate; Windows custom NSIS include with OpenWithProgids; update `openable-types-test.js`), ADS in argv, `file://` on Linux, second-instance before renderer ready, `.kanvaz` + media same launch, `--x=a.kanvaz`, Blender conversion queue + temp GLB cleanup on quit, macOS drain `pendingMediaOpen` on activate, path dedupe case-fold, UNC image paths in the Blender export script.
4. Preview quality gates (`previewQuality` low/medium/high; 3D pixel-ratio cap, PDF dpr cap, Adobe `maxSide`; friendly warning on High) + Settings UI (quality select, Blender Choose… / Auto-detect / status).
5. Presentation Mode: order steps by reading order (rows then x) instead of creation order.
6. Release descriptions: `tools/release-notes.js` to PATCH every empty release body from CHANGELOG, plus a CI step so future releases get notes.
7. Register `test/platform-test.js` in `test/validate.js`.
8. Docs: CHANGELOG 9.1.0 entry, SECURITY, HANDOFF, ROADMAP, README; bump 9.1.0 in package.json, src/boards.js VERSION, ui.js About, README build names.
9. Full Audit Suite (docs/FULL_AUDIT_SUITE.md), persona pass, then ship: push main, tag v9.1.0, wait for CI, check for duplicate drafts, `gh release edit v9.1.0 --draft=false --latest`, verify `draft:false`. Never say shipped before that.

## Untracked files that must NOT be committed
`upi-qr.jpeg`, `download.jpe`, `docs/handoff-assets/donate-rollout/`.

## Feature ideas for after 9.1.0 (owner asked for these)
WebGL context budget / virtualise many 3D cards, orthographic camera, 3D view screenshot/export, light rig + HDRI presets, texture/material inventory panel.
