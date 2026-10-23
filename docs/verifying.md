# Verifying a change

There is one check: `tools/e2e.mjs`, run by CI's `e2e` job on a real OpenWrt of each package manager.
This page says what it proves and what it does not, how to run it locally, how to read its CI
artifacts, and the invariants per area that a patch must keep whether or not the run can see them.
The rules themselves, with their reasons, are in [conventions.md](conventions.md); the job graph is
in [ci.md](ci.md).

## What the check proves

`tools/e2e.mjs` lives the package's whole life on one running owlab router that has LuCI and its
apps but not this theme, the way an admin lives it:

1. **Install the last published release.** It registers Footstrap in Language and Style
   (`luci.themes.Footstrap`) and leaves the active theme alone.
2. **The admin picks footstrap and saves a footstrap uci setting.**
3. **Upgrade to this build.** The version changes, and the admin's theme choice and the footstrap
   setting both survive.
4. **Every page of the menu is opened** — every leaf whose action is a view, a template or a CBI
   map, logout excepted — by a full load at 1280 px and at 390 px, and by a click on its link in the
   chrome from wherever the previous click left the reader. The same pages are then opened under
   bootstrap on the same router.
5. **Remove the package.** LuCI falls back to bootstrap and still serves its login form (25.12
   answers the form with a 403, so the body is the evidence, not the status).
6. **Install this build on the clean router.** Footstrap is offered, the active theme is left alone.

A page fails only for what footstrap adds over bootstrap on the same page:

- a JS error (`pageerror` or a console error) that bootstrap does not also show;
- a same-origin request that fails or answers 4xx/5xx where bootstrap's does not;
- a view that never renders (the `#view` spinner never replaced, `#maincontent` empty) where it
  renders under bootstrap;
- footstrap's stylesheet (`link[data-fs-shell]`) or chrome (`[data-fs-chrome]`) missing. LuCI falls
  back to another theme silently on a broken template, so this is how a template that no longer
  compiles on one of the two ucode interpreters shows up.

There is no list of expected problems: the stock theme on the same router is the reference. Errors
are compared as signatures with numbers and query strings removed, so the same fault under both
themes cancels out. Both themes are read only once nothing has been in flight for a second (or after
15 s): an app's own requests keep arriving after its view has rendered (adblock and banip fetch
their reports late), and Playwright's `networkidle` fires once per navigation and misses them.

What it does not judge, so a change there is looked at by hand on both routers (`owlab open`):

- how a page looks. The screenshots are for a human eye, not a pixel diff: the same sheet loaded
  twice moves 0.5–1.3 % of pixels on a live page, and a real regression once weighed 0.19 %;
- a page reached only through a tab strip (the click pass skips a path the chrome has no link to);
- `install.sh`, the feed and the trust chain — e2e installs package files directly;
- ImmortalWrt, 23.05 and hardware.

## Running it locally

```sh
FOOTSTRAP_VERSION=9999.0.0 ./tools/stage.sh && owfeed build   # above any release: step 3 is an upgrade
gh release download --pattern 'luci-theme-footstrap-*.apk' --dir ../tmp/old
owlab up owrt2512
node tools/e2e.mjs --router owrt2512 --old ../tmp/old/luci-theme-footstrap-*.apk \
  --new dist/noarch/luci-theme-footstrap-[0-9]*.apk
```

and the same on `owrt2410` with `luci-theme-footstrap_*_all.ipk` and
`dist/all/luci-theme-footstrap_[0-9]*_all.ipk`.

- The router must not carry the theme yet: `owlab up` alone, no `owlab sync` (the run's first step
  fails on a router that already has `/www/luci-static/footstrap`). owlab's own `theme:` setting may
  point LuCI at a theme that is not installed; the run resets it to bootstrap rather than judging
  it. e2e installs, removes and switches themes on the router; `owlab sync` afterwards puts the
  working tree back.
- A walk over every menu page outlasts a foreground call: start it with `tools/bg.sh <cmd>`
  (detaches, logs into `../tmp/`) and wait with `tools/bg-wait.sh <run-id>`.
- It exits 0 when every step passed, 1 otherwise, and 2 on bad arguments or a router that is not
  running. The output and screenshots land in `--out`, by default `../tmp/e2e-<router>`.
- **Done means both**: 25.12/apk and 24.10/opkg. Say which one a run covered.

## Reading a run

Each matrix leg uploads its `--out` directory as the artifact `e2e-<router>`, also when it failed:

```sh
gh run download <run-id> -n e2e-owrt2410 -D ../tmp/e2e-ci-owrt2410
```

| Path | What it holds |
|---|---|
| `report.json` | `results`: every step as `{ step, ok, detail }`; `crawl.pages`: one entry per path and way of opening it (`desktop`, `phone`, `click`) with its `problems`; `crawl.bootstrap`: what bootstrap showed on each path |
| `footstrap/desktop/*.jpg`, `footstrap/phone/*.jpg` | one screenshot per page at 1280 and 390 px, named after the path (`admin_status_overview.jpg`) |
| `bootstrap/*.jpg` | the same pages under bootstrap at 1280 px |

The log prints `PASS`/`FAIL` per step and, under the crawl step, one line per failing page and way
of opening it. A failure in an install, upgrade or removal step carries the package manager's last
line of output in its detail. `tools/ci-log.sh <run-id>` prints a red job's failed step and its
decisive lines; reproduce it with a local run on the same router before naming a cause (the diff,
infrastructure, the upstream feed).

## Rules for every change

- **A red run is fixed in the code under it**, never by editing `tools/e2e.mjs` to skip a page or
  allow an error — unless changing the check is the task.
- **One fault, one mechanism.** A spare check or fallback added "to be safe" ships only when the
  fault reproduces without it.
- A layout change is looked at under RU text and at a phone width.
- A widget is checked with real input on the spot `ui.js` opens it from (a ComboButton only
  `> span.open`, a plain dropdown anywhere), and what it opens must be what a click at each target's
  centre reaches. `dispatchEvent` plus `getBoundingClientRect` cannot see a clip: 0.14.16 shipped a
  clipped ComboButton menu that such a check passed three times.
- Some comments are code — `@mirror`/`@endmirror`, `/* fs:probe */`, eslint `'require …'`
  pragmas, the Makefile's buildroot marker, the literal `dataset.fsFit` write. Keep them verbatim;
  never reword comments with a mechanical `sed`.
- A `#` line inside a quoted `ssh "$R" "…"` string is part of the string: `sh -n` after editing.
- Screenshots and scratch output go in `../tmp/`, never in the repository.

## Per area: the invariants

### CSS (`styles/**`, `build-css.sh`)

- `htdocs/luci-static/footstrap/cascade.css` is **generated** (gitignored, rewritten by every
  `owlab sync` and `tools/stage.sh`): edit `styles/`.
- One cascade layer per directory (`styles/`, `base/`, `theme/`, `pages/`), filename prefix = source
  order. The wrapper comes from the directory, so a new file must open with the layer its directory
  means.
- Read the private `--fs-*` tier only; the `--*-color-*` export tier is read by nobody in `styles/`.
  A hostile `:root` recoloured 312 of 336 gallery elements before the split, 0 after.
- `!important` is an allowlist; one that beats another footstrap rule means a wrong layer.
  `theme/95-a11y-media.css` is the sanctioned exception.
- Edit the rule that already styles the selector; win on specificity, never on source order.
- Never delete a selector because no stock page renders it: a foreign `luci-app-*` may.
- Browser floor Chrome 108 / Firefox 101 / Safari 15.4. A `:has()` compound sharing a selector list
  with one that has none kills the whole rule below the floor — split it or wrap in `:is()`. A
  `color-mix()` token needs its static twin in `styles/04-nocolormix.css`.
- No colour literals (`--fs-scrim` excepted); no `--*-rgb`/`--*-hsl` bridges.
- A duplicate is merged or pinned in `@mirror`; a one-copy `@mirror` group is a mistake.
- `styles/base/` is editable, but prefer the matching `styles/theme/` file.
- No bold mono: `<strong>` must be *assigned* the sans face.

Method: [css.md](css.md).

### JS (`htdocs/luci-static/**/*.js`)

- One concern per module; `L.require` throws on a cycle, so compose by calling, never `extend`.
- The fit engine is `fs-fit.js`; a module registers with `fit.add()` and runs no observer of its own
  (the `#indicators` observer in fs-chrome is the one exception). `data-narrow`, not a media query,
  says "the sidebar became a bar"; widths are read from CSS tokens with `getComputedStyle`.
- **Never put a regex literal straight after `return` or `=>`**: jsmin eats the rest of the file and
  exits 0. Wrap it: `return (/^https?:\/\//i.test(a));`. No backtick inside `${…}`.
- Require a stock class through `window.L`; the factory's `L` has no `ui` helpers.
- `FS_VERSION` stays in `fs-version.js` at that path — the Makefile, `dev-sync.sh` and
  `tools/stage.sh` sed it by path.
- The theme never checks for its own updates and never reaches a third-party host at run time.
- A comment in a shipped file carries its reason inline: no `issue #N`, no `tools/`/`docs/` pointer
  as the only carrier (they do not exist in openwrt/luci).

A JS error or a view that stops rendering is what e2e sees; behaviour beyond that is looked at by
hand on both routers.

### Chrome and templates (`*.ut`, `fs-*.js`, `menu-footstrap*.js`)

- One theme entry, one template dir, one renderer. Layout is a client axis (`:root[data-layout]`,
  always explicit); never a `:not([data-layout=…])` guard, never a second renderer.
- Three zones: ours (`fs-*`, `--fs-*`, `[data-fs-chrome]`), shared LuCI (`.cbi-*`, `#view` — an app
  may win there), theirs. `.left`/`.right`/`.center` and `ul.nav` are LuCI's.
- The chrome is defended by not matching (the mark in `header.ut`, the fence in `fs-sheets.js`, the
  pin in `theme/10-chrome.css`).
- A view's CSS is never deleted; only a byte-identical duplicate may be dropped.
- Every Appearance axis is implemented twice (pre-paint in `partials/head.ut`, live in `fs-axes.js`
  / `fs-prefs.js`) and **the custom property is set before the attribute**, or a reload paints one
  frame in the previous hue.
- 25.12's and 24.10's ucode accept different sets; a template is proven only by the e2e run on both
  routers.
- After touching any `_()`: `luci-theme-footstrap/update-po.sh`. Appearance labels carry the
  `footstrap` msgctxt; the chrome and the login/notice sentences deliberately do not.

### Package (`Makefile`, `root/**`, `po/**`, `owfeed.yml`, `install.sh`)

- `+luci-base` is the whole dependency list; fall back to `uclient-fetch` rather than adding `curl`.
- The catalogue lives in `po/`; the theme itself carries none (two packages owning one path is an
  install apk refuses). `po/`, `tools/stage.sh` and `owfeed.yml` repeat the language list.
- Anything under `root/etc/config/` must be in `conffiles`.
- `postinst`/`postrm` run no `rpcd reload` and no `restart`.
- A malformed `acl.d/*.json` is skipped by rpcd silently.
- An install registers the theme and leaves the active one alone; an upgrade never changes it.
  `30_luci-theme-footstrap` tells install from upgrade by whether `themes.Footstrap` exists (apk
  exports no `$PKG_UPGRADE`). e2e steps 1, 3 and 6 hold this on both package managers.
- `PKG_LICENSE_FILES:=LICENSE` needs the `$(CP) $(CURDIR)/LICENSE` line in `Build/Prepare`. No
  `PKG_VERSION`. `LUCI_MINIFY_CSS:=0` (csstidy mangles `:has()` and `color-mix()`).
- The Makefile's buildroot signature line stays last.
- The trust chain fails closed: verified TLS (never `-k`), an ed25519 `usign` signature, then
  GitHub's sha256. A missing digest, `.sig` or usign is a refusal, not a downgrade. Users fetch
  `install.sh` from raw `main` the moment it lands, and e2e does not run it.

## CI

- After a push: `tools/bg.sh tools/ci-watch.sh --sha <sha>` plus its waiter → one verdict line.
- Before pushing to `main`: Build's newest completed `push` run on `main` must be `success`
  (`gh run list --branch main --workflow build.yml --event push --status completed -L1`); a
  `cancelled`/`skipped` run says nothing — the one before it decides. CodeQL, pages and Dependabot
  runs are not the reading.
- `release` needs `e2e` on both routers, so a tag never publishes a package that failed it. Job
  graph: [ci.md](ci.md).
- Hardware only on the maintainer's word: [development.md](development.md) "Proving it on hardware".
