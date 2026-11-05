# Contributing to Kanvaz

Thanks for wanting to help. Kanvaz is a one-person project, so a small, focused change that comes with a clear description is the easiest kind to merge. Bug reports, guide fixes and plugins are as welcome as code.

## Ways to help

- **Report a bug.** Include your Kanvaz version and operating system, the steps to reproduce it, and the text from Command Palette (`Ctrl+K`) then "Export debug info". A screenshot or short recording helps a lot.
- **Ask for a feature.** Describe the problem you are trying to solve, not only the solution you have in mind.
- **Fix or improve the guide.** Pages in `docs/guide/` are plain Markdown. Many pages are stamped with the version they were last checked against, and re-checking one against the app is a good first contribution. Every page has an "Improve this page" link.
- **Build a plugin.** The [guide page](https://p4inz-code.github.io/kanvaz/guide/build-a-plugin.html) gets you from nothing to a working plugin, and there is an example in `docs/plugin-examples/`. You can sell a plugin, and Kanvaz takes no cut.
- **Pick up an issue.** Look for [good first issue](https://github.com/p4inz-code/kanvaz/labels/good%20first%20issue) and [help wanted](https://github.com/p4inz-code/kanvaz/labels/help%20wanted).
- **Try the Discord.** Questions and ideas are welcome there: https://discord.gg/8UKt8s5FbW

## Ground rules for code

Kanvaz keeps a deliberately small, plain stack so one person can maintain it.

| Rule | Details |
|---|---|
| ES5, `var` only | No `const`, `let`, arrow functions or `.forEach()` in `src/`. The linter enforces this |
| Vanilla JS and CSS | No frameworks, transpilers or bundlers |
| Colors | Use the `--color-*` CSS variables, never hardcoded hex, so light and dark themes both work |
| No inline `onclick` | The page's content security policy blocks it |
| Comments | Explain why, not what. Keep functions short |

`src/main.js`, `src/preload.js` and the other main-process files run in Node and are checked by the same linter, with their own rules.

Electron and electron-builder upgrades are done by the maintainer, because they need a live test of the app. Please do not open a pull request that only bumps them.

## Set up

```bash
git clone https://github.com/p4inz-code/kanvaz.git
cd kanvaz
npm install
npm start
```

## Before you open a pull request

```bash
npm run lint
npm run validate
```

`npm run validate` runs the whole suite: syntax checks for every file in `src/`, the linter, version consistency, the unit tests, and checks that every image and link in the README, landing page and guide exists. A pull request will not be merged while it fails.

## Pull requests

1. Fork the repository and branch from `main`.
2. Keep it focused: one change per pull request.
3. Add a line under `[Unreleased]` in `CHANGELOG.md` saying what changed and why.
4. If it changes something you can see, include before and after screenshots.
5. Say how you tested it. For anything that changes how the app behaves, run it and try it.

Version numbers are the maintainer's job. If you are curious how a release is cut, see [docs/RELEASING.md](docs/RELEASING.md).

## Where things are

The code is in `src/`, one module per file, loaded in a fixed order. [docs/TECHNICAL_OVERVIEW.md](docs/TECHNICAL_OVERVIEW.md) has the module map and the dependency order. Official plugins live in `official-plugins/`.

## Security

Please do not report security problems in a public issue. Read [SECURITY.md](SECURITY.md) and email instead.

## License

By contributing, you agree that your work is licensed under the MIT license, like the rest of the project.
