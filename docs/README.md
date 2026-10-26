# Documentation

Developer documentation for `luci-theme-footstrap`. Installing and using the theme is in the
[repository README](../README.md).

Every page here stands on its own — start wherever your question is.

## Start here

| Page | Answers |
|---|---|
| [architecture.md](architecture.md) | What LuCI expects from a theme, and where footstrap plugs into it |
| [conventions.md](conventions.md) | The rules a patch must follow, and why |
| [development.md](development.md) | Bring up a dev router, push a change, prove it works |
| [verifying.md](verifying.md) | The router checks (`tools/e2e.mjs`, `tools/anchor-check.mjs`): what they prove, running them, reading their CI artifacts |

## How it is built

| Page | Answers |
|---|---|
| [design-system.md](design-system.md) | Tokens, palettes, typography, scales, the appearance axes |
| [css.md](css.md) | The `styles/` tree, cascade layers, `build-css.sh`, proving a CSS change |
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
| [luci-app-styling-guide_ru.md](luci-app-styling-guide_ru.md) | The same guide in Russian — the one page here that is mirrored |

There is also a self-contained developer portal with the colour-token grid, the component markup
and a style checker: <https://vizzletf.github.io/luci-theme-footstrap/>.

## Not documentation

| File | What it is |
|---|---|
| `gallery.html` | every widget LuCI can emit, with the real class names — part of the developer portal |
| `devkit.src.html` | source of the developer portal |
| `devkit.html` | built from `devkit.src.html`, `gallery.html` and `02-tokens.css` by the `pages` job. Generated, gitignored, never committed |
| the playground | not a page here at all — recorded from a real router by `tools/playground/*` and CI's `playground` job, published as a release asset and fetched into Pages by `pages.yml`. [ci.md](ci.md) |
| `screenshots/` | the README's screenshots, shot from a dev router by `screenshots/capture.py` |

## Conventions of these pages

- One page, one job. If a page needs its own table of contents, it is probably two pages.
- One fact lives in one place. Pages link to each other rather than repeating.
- Every rule says what it protects against. History lives in the changelog, not here.
- Documentation that has stopped being true is deleted, not annotated.
