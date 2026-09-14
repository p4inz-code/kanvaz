# Third-Party Notices

Kanvaz is built with [Electron](https://www.electronjs.org/), distributed
under the MIT License by the OpenJS Foundation. Electron itself bundles
Chromium, Node.js, and V8, each under their own open-source licenses
(primarily BSD and MIT).

When Kanvaz is built into an installer or portable app (via
electron-builder), Electron's own license files — including
`LICENSE` and `LICENSES.chromium.html` — are automatically included
in the application's installation directory. These files contain the
full text and attribution for every third-party component bundled
inside the Electron runtime.

Kanvaz also bundles the following runtime dependencies, each under its
own MIT License:

- [electron-updater](https://www.npmjs.com/package/electron-updater) — powers the optional, click-to-check auto-updater.
- [JSZip](https://www.npmjs.com/package/jszip) — reads and writes the `.kanvaz` container format (since 4.1.0).
- [wink-nlp](https://www.npmjs.com/package/wink-nlp), [wink-eng-lite-web-model](https://www.npmjs.com/package/wink-eng-lite-web-model), and [wink-distance](https://www.npmjs.com/package/wink-distance) — power Smart Search's on-device lemmatized/fuzzy matching (since 6.3.0, off by default).

And the following, under its own license:

- [pdf.js](https://mozilla.github.io/pdf.js/) (`pdfjs-dist`) — Apache License 2.0, © Mozilla. Powers the scroll/zoom PDF preview on file-reference cards pointing at a `.pdf` (since 7.x). Vendored directly as two runtime files in `src/vendor/pdfjs/` (its own `LICENSE` file is included alongside them) rather than pulled in as a full npm dependency — the published package is ~35MB of locale data, CJK character maps, and a demo viewer this app never uses; only the actual rendering engine and its worker (~1.7MB total) are needed and shipped.
- [Three.js](https://threejs.org/) — MIT License, © three.js authors. Powers the live orbitable 3D model viewport on `model3d` cards (since 7.4.0) — the core renderer plus GLTFLoader/OBJLoader/FBXLoader and OrbitControls. Vendored directly as source files in `src/vendor/three/` (its own `LICENSE` file is included alongside them) rather than pulled in as a full npm dependency, following the same "only the runtime pieces this app actually uses" reasoning as pdf.js above.
- [Feather Icons](https://feathericons.com/) — MIT License, © Cole Bemis. The icon set used across the titlebar, toolbar, media controls, and annotation tools (since 7.7.0) — individual icon paths copied directly into the relevant `.js`/`.html` files rather than vendored as a library, since only a small, fixed subset of the full icon set is used.

Kanvaz's own source code (everything in `src/`, `docs/`, and this
repository) is © Atharva Patil | P4inz | Northbyte Studios, licensed under the
MIT License — see [LICENSE](LICENSE).

Build tooling (`electron-builder` and its dependencies) is used only to
produce the installers and is not included in the shipped application.
