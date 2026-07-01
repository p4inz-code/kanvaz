# Kanvaz Test & Validation Suite

Automated checks that catch the bug classes this project has hit.

## Quick start
```bash
npm run validate     # run everything (syntax, lint, ports, versions)
npm run lint         # static analysis only (fast, no browser)
npm run test:ports   # real-browser port alignment proof
```

## What each check does

### `validate.js` — master suite
Runs all checks in sequence, exits 1 if anything fails. Use before every ship.

### `lint.js` — static analysis
Catches, without running the app:
- `const`/`let`/arrow/`.forEach` (var-only rule violations)
- inline `onclick` in HTML (CSP silently blocks these → dead buttons)
- version drift across package.json / boards.js / ui.js / README
- `JSON.parse` of file/IPC data without try/catch
- hardcoded dark colors that break light theme
- stale "final release" language on an active project
- leftover TODO/FIXME/XXX markers

### `run-port-test.js` — connection port proof
Renders the exact node CSS in real headless Chromium, measures actual
port-dot centers via getBoundingClientRect, compares against the
outPort()/inPort() formulas at 5 zoom/pan levels. Requires:
```bash
npm install puppeteer-core   # uses system/cached Chrome, no download
```
Expected: `ALL CASES PASS` with `error=[0,0]` everywhere.

## Runtime self-diagnostic
Beyond these build-time checks, the app runs `KanvazMapView.diagnose()`
after every Map View render. Open DevTools console to see:
- `✓ Self-diagnostic passed` — all clear
- port drift, orphan connections, NaN transforms, duplicate connections

Call it manually anytime: `KanvazMapView.diagnose()`

## The proven port formula
```
outPort.x = mapPosition.x + NODE_W - PORT_INSET   (176 - 1 = 175)
inPort.x  = mapPosition.x + PORT_INSET             (1)
port.y    = mapPosition.y + NODE_H / 2
```
PORT_INSET (1px) = half the port dot's own 2px border.
Measured against real Chromium — do not change without re-running test:ports.
