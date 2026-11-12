# Documentation

The index of developer documentation for `luci-theme-footstrap`, for anyone changing or packaging the theme.
Every page here stands on its own: start wherever your question is.

Installing and using the theme is in the [repository README](../README.md).

## I want to…

| Task | Go to |
|---|---|
| fix a CSS bug, start to finish | [development.md, "Fixing a CSS bug: the path"](development.md#fixing-a-css-bug-the-path) |
| prove a CSS change did only what I meant | [prove-css-change.md](prove-css-change.md) |
| find why a rule in `styles/` exists | [css-fixes.md](css-fixes.md): a `styles/pages/` file has a row in its first table; for `base/` and `theme/`, search for the file name |
| find which file styles part of the sidebar or bar | [chrome.md, "Where a rule lives"](chrome.md#where-a-rule-lives) |
| add a colour palette | [add-palette.md](add-palette.md) |
| tell whether the theme or an app is at fault | [third-party-apps.md, "Triage: theme or app?"](third-party-apps.md#triage-theme-or-app) |
| find why a page lost its scroll position | [spa-router.md, "Scroll lost? Check in this order"](spa-router.md#scroll-lost-check-in-this-order) |
| add a file to the package | [package.md, "Adding a file"](package.md#adding-a-file) |
| check my patch before review | [conventions.md, "Before review"](conventions.md#before-review) |
| run e2e and anchor-check on the dev routers | [run-checks.md, "Run e2e on both routers"](run-checks.md#run-e2e-on-both-routers) |
| understand a red CI run | [verifying.md, "Reading a run"](verifying.md#reading-a-run), then [ci.md](ci.md) |
| fix a dev stand that shows no theme, a 403, a 502 or a stale package | [stand-traps.md](stand-traps.md) |
| cut a release | [releasing.md](releasing.md) |
| style my own `luci-app-*` for any theme | [luci-app-styling-guide.md](luci-app-styling-guide.md) ([по-русски](luci-app-styling-guide_ru.md)) |

The tables below list every page by area.

## Start here

| Page | Answers |
|---|---|
| [architecture.md](architecture.md) | What LuCI expects from a theme, and where footstrap plugs into it |
| [conventions.md](conventions.md) | The rules a patch must follow, and why |
| [development.md](development.md) | Bring up a dev router, push a change, prove it works |
| [stand-traps.md](stand-traps.md) | Troubleshooting the dev stand: symptoms that make a measurement lie |
| [verifying.md](verifying.md) | The router checks (`tools/e2e.mjs`, `tools/anchor-check.mjs`): what they prove, reading their CI artifacts |
| [run-checks.md](run-checks.md) | Running the router checks locally: commands, exit codes, expected output |

## How it is built

| Page | Answers |
|---|---|
| [design-system.md](design-system.md) | Tokens, palettes, typography, scales, the appearance axes |
| [add-palette.md](add-palette.md) | How to add a colour palette |
| [css.md](css.md) | The `styles/` tree, cascade layers, `build-css.sh` |
| [css-fixes.md](css-fixes.md) | Every page, base and theme correction, with its reason; the card contract for tables |
| [prove-css-change.md](prove-css-change.md) | How to prove a CSS change: computed-style diff over the gallery and on a router |
| [chrome.md](chrome.md) | Sidebar, icon rail, top bar, the menu renderer, the fit measurement |
| [spa-router.md](spa-router.md) | Client-side navigation: how it works and what it refuses to do |
| [third-party-apps.md](third-party-apps.md) | Coexisting with foreign `luci-app-*` |

## Shipping

| Page | Answers |
|---|---|
| [package.md](package.md) | Source tree, Makefile, uci-defaults, postinst/postrm |
| [ci.md](ci.md) | The CI job graph, the `e2e` and `anchor` jobs, packaging and releases |
| [releasing.md](releasing.md) | The pre-release checklist, the changelog contract, the runbook |
| [upstream-pr.md](upstream-pr.md) | The theme's pull request to openwrt/luci: building, preflight, review |
| [benchmark.md](benchmark.md) | The navigation benchmark: method and results |

## For authors of other packages

| Page | Answers |
|---|---|
| [luci-app-styling-guide.md](luci-app-styling-guide.md) | How to style a `luci-app-*` so it works under any theme |
| [luci-app-styling-guide_ru.md](luci-app-styling-guide_ru.md) | The same guide in Russian. It is the one page here that is mirrored. |

The developer portal is self-contained: <https://vizzletf.github.io/luci-theme-footstrap/>.
It holds the colour-token grid, the component markup and a style checker.

## Files here that are not documentation

| File | What it is |
|---|---|
| `gallery.html` | Every widget LuCI can emit, with the real class names. Part of the developer portal. |
| `devkit.src.html` | Source of the developer portal. |
| `devkit.html` | Built from `devkit.src.html`, `gallery.html` and `02-tokens.css` by the `pages` job. Generated, gitignored, never committed. |
| the playground | Not a page here at all. Recorded from a real router by `tools/playground/*` and CI's `playground` job. Published as a release asset and fetched into Pages by `pages.yml`. See [ci.md](ci.md). |
| `screenshots/` | Desktop and phone shots from a dev router by `screenshots/capture.py`. Linked from the README's Screenshots link. The README's own images are `assets/readme/`. |

## Rules for these pages

| Rule | Detail |
|---|---|
| One page, one job. | A page that grows past one job splits in two. A long page opens with a short version and a contents list. |
| One fact lives in one place. | Pages link to each other rather than repeating. |
| Every rule says what it protects against. | History lives in the changelog, not here. |
| Documentation that has stopped being true is deleted. | It is not annotated. |
