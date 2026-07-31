# Contributing to Kanvaz

Thanks for your interest in contributing to Kanvaz! This document covers the
rules and workflow for getting your changes merged.

## Ground Rules

Kanvaz has a **locked tech stack**. These are non-negotiable:

| Rule | Details |
|------|---------|
| ES5 only | `var` only — no `const`, `let`, arrow functions, or `.forEach()` |
| Vanilla JS | No frameworks, no transpilers, no bundlers |
| Vanilla CSS | CSS custom properties are fine; no preprocessors |
| Electron 22.3.27 | Do not upgrade Electron or electron-builder |
| No `npm audit fix --force` | The 6 high-severity vulns are build-time only and intentionally tolerated |

The custom linter (`npm run lint`) enforces these rules. If it flags your code,
fix the code — don't loosen the linter.

## Development Setup

```bash
git clone https://github.com/p4inz-code/kanvaz.git
cd kanvaz
npm install
npm start
```

## Before You Submit

Run the full validation suite:

```bash
npm run validate
```

This checks syntax (all 16 source files), lint rules, and version consistency.
Your PR will not be merged if validate fails.

## Version Locations

Kanvaz tracks its version in **6 locked locations**. If your change involves a
version bump (it probably doesn't — maintainer handles releases), all 6 must
match:

1. `package.json` → `version`
2. `src/boards.js` → `VERSION` constant
3. `src/ui.js` → About dialog version string (×2)
4. `README.md` → build output filenames
5. `docs/generate_overview_pdf.py` → footer pill

## Code Style

- IIFE module pattern — each file is a self-contained module
- `var` for all declarations
- No inline `onclick` handlers (CSP violation)
- Use CSS custom properties (`--color-*`) for colors — no hardcoded hex in JS
- Keep functions short and readable
- Comments explain *why*, not *what*

## Filing Issues

- **Bug reports**: include your OS, Kanvaz version (About screen or
  `KanvazBoards.getVersion()` in DevTools), and steps to reproduce. A
  screenshot or screen recording helps enormously.
- **Feature requests**: describe the problem you're trying to solve, not just
  the solution you want.

## Pull Requests

1. Fork the repo and create a branch from `main`
2. Keep PRs focused — one feature or fix per PR
3. Run `npm run validate` before pushing
4. Write a clear PR description: what changed, why, and how to test it
5. If your PR touches UI, include before/after screenshots

## Architecture

The codebase is 16 source files in `src/`, each wrapped in an IIFE. Boot order
matters — see `docs/TECHNICAL_OVERVIEW.md` for the module map and dependency
chain.

## License

By contributing, you agree that your contributions will be licensed under the
MIT License.
