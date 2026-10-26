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
2. **The admin picks footstrap**, and a marker section is written to `/etc/config/footstrap`, the
   conffile Appearance saves to.
3. **Upgrade to this build.** The version changes, and the admin's theme choice and the marker
   both survive. The marker proves the `conffiles` declaration on the 24.10/opkg leg only: apk keeps
   a modified file under `/etc` without one, so on 25.12 the step passes either way.
4. **Every page of the menu is opened** — every leaf whose action is a view, a template or a CBI
   map, logout excepted. First under bootstrap, the reference, at 1280 px; then under footstrap by
   a full load at 1280 px and at 390 px, and every entry of footstrap's menu (each top-level entry
   and each entry under one, from the router's own menu tree) by a click on its link. The full-load
   passes read eight pages at a time, each in a logged-in context of its own, the same count under
   both themes; the click pass is two pages, each taking half the entries one after another. Then
   `tools/anchor-check.mjs` (below) runs against the installed build; `--no-anchor` leaves it out,
   which is what CI does, running it as a job of its own (`anchor`) on a router of its own.
5. **Remove the package.** LuCI falls back to bootstrap and still serves its login form (LuCI
   answers the form with a 403, so the body is the evidence, not the status).
6. **Install this build again.** Footstrap is offered, the active theme is left alone.

A page fails for what footstrap adds over bootstrap on the same page:

- a JS error (`pageerror` or a console error) with a theme file on its stack, or logged by one:
  always footstrap's. Any other JS error that bootstrap did not show while it was watched;
- a failed request (4xx/5xx or a network error, any host) to a theme file (`/luci-static/footstrap/`,
  `resources/fs-*.js`, `resources/menu-footstrap*.js`, `resources/view/footstrap/`, the pattern CGI):
  always footstrap's. A failed request to anything else that bootstrap never made. An app's request
  that bootstrap also made is the app's whatever its answer, because the answer is the router's
  state at that moment: adblock asks `cgi-download` for `/var/run/adb_runtime.json`, which does not
  exist until adblock's first run ends, so the same page answers 404 a minute after boot and 200
  later (CI run 40075129817). Footstrap cannot change that answer: it never writes the session or
  its cookie, and a lost session turns the next page into the login form, which the checks below
  fail. A request footstrap makes in an app's name (its router's view prefetch, a client
  navigation) is one bootstrap never made, so it counts;
- a view that never renders (the `#view` spinner never replaced, `#maincontent` empty) where it
  renders under bootstrap, or whose visible text is less than half of bootstrap's: the characters
  of every text node in `#view` (else `#maincontent`) whose element is rendered, outside a
  `<select>`, whose options a native select under bootstrap lists and footstrap's styled one does
  not. On a clean run footstrap's share is 0.62 at its lowest (390 px, `status/wireguard`). A view
  short of that is read once more on its own after the pass, with nothing else loading, and judged
  on that reading: LuCI's `process_list` (Status → Processes) answers an empty list when another
  rpcd child exits while it reads `top`'s output, as a neighbour page's `file.exec` does, on 24.10
  and 25.12 alike (48–74 empty answers in ~190 beside a `file exec` loop, none alone);
- footstrap's stylesheet (`link[data-fs-shell]`) holding fewer than 500 rules (the shipped sheet
  holds about 1000), `--primary-color-high` not resolving on `:root`, the menu column
  (`nav[data-fs-chrome]`) not visible with a box of its own, or the menu's first entry failing
  Playwright's actionability check (visible, stable, not covered) at 1280 and at 390 px. LuCI falls
  back to another theme silently on a broken template, so this is how a template that no longer
  compiles on one of the two ucode interpreters shows up;
- on the click pass: a menu entry footstrap's menu has no link to, a link that cannot be clicked
  (its section is opened first when the link is not showing; the click goes through Playwright's
  actionability path), or a view that is not replaced by a rendered one. A separate step fails when
  the click pass reached fewer entries than the menu offers.

There is no list of expected problems: the stock theme on the same router is the reference, read
first, closest to the router's boot, so a state an app is still settling into lands under
bootstrap. Errors and requests are compared as signatures with session ids, numbers and query
strings removed; an error's signature carries the file it was thrown from.

`tools/anchor-check.mjs` checks that a poll tick changing the page above a parked reader leaves
them in place, in Chromium, Firefox and WebKit at 1280 and 390 px. It appends 4 DHCP leases to the
router's `/tmp/dhcp.leases`, so LuCI's own poll grows the lease table on Status > Overview, then
puts the file back, so the next poll takes the rows away. The reader is parked by mouse wheel on
the heading of the section below the leases, at the top of the viewport, and holds still through
each change. A third change does the shrink again while the reader keeps the wheel going, 20 px a
step around their place, until the tick has landed, and is read from the moment they let go: the
containers `fs-fit.js` floors keep their height while the reader scrolls and give it up after,
above them. Bootstrap floors nothing, so it is no reference for that one. Each change is read from
a fresh park and judged on its own. Every frame for 15 s (4 s after a let-go) it records the
median viewport shift of the elements that were in view and whose text is unique on the page, and
counts the frames painted with the reader off place (more than 2 px): a `ResizeObserver` on
`#view` reads the shift after every animation frame callback of the frame, the theme's correction
included, and before the paint. Per engine, width and change it runs four cells:

| Cell | Passes when |
|---|---|
| bootstrap | it measured something; it is the reference |
| footstrap | its end shift is at most 2 px larger than bootstrap's, and it shows the reader off place in no more frames, sampled or painted, than bootstrap |
| footstrap without native anchoring: `CSS.supports()` answers no for `overflow-anchor`, `overflow-anchor: none` on every element | the change above the reader matches the footstrap cell's within 8 px (else the emulation changed the page), its end shift is at most 2 px, and no painted frame shows the reader off place |
| the same with `fsAnchor=off` in localStorage | it moves the reader by at least half the change and at least one painted frame shows it off place, else the cell above proves nothing |

A cell that measured nothing fails: less than 50 px changed above the reader (the move of their
content in the document, the offset's share plus the viewport's, so what changes below them does
not count), no tick landed while they scrolled, fewer than 5 elements were tracked, or there was no
section to park on. The step fails with every `FAIL` line in its detail. The router needs at least one lease in `/tmp/dhcp.leases` (owlab's fixtures seed them).

How long a page is watched after its view rendered:

| Pass | Span |
|---|---|
| bootstrap, 1280 px | 6 s, then until nothing has been in flight for a second, 10 s at most |
| footstrap full load, 1280 px | 6 s: one LuCI poll interval (5 s, `pollinterval`'s default) and 1 s for the tick's handlers; theme code that runs late runs on a tick or on a timer of its own, the longest of which is `fs-router.js`'s 5 s warm wait |
| footstrap full load, 390 px, and the click pass | 1 s |

The reference vouches for nothing past the span it was watched, so past it only what is provably
the theme's counts: an error with a theme file on its stack, a failed request to a theme file.
Playwright's `networkidle` fires once per navigation and misses an app's late requests, so it is
not used.

What it does not judge, so a change there is looked at by hand on both routers (`owlab open`):

- how a page looks beyond the checks above. The screenshots are for a human eye, not a pixel diff:
  the same sheet loaded twice moves 0.5–1.3 % of pixels on a live page, and a real regression once
  weighed 0.19 %;
- Firefox and WebKit beyond the anchoring check, and with them the browser floor (Chrome 108 /
  Firefox 101 / Safari 15.4): the crawl runs Chromium only. The anchoring check runs Playwright's
  current builds, and its no-native cells stand in for an old Safari by switching the feature off;
  no real Safari runs;
- the sidebar and rail layouts, the palettes, RU text and RTL: the run uses the defaults (the top
  bar, the default palette, English);
- the reader's scroll position anywhere but the anchoring check's one page and its three changes
  (a growth and a shrink under a reader holding still, a shrink under one scrolling), a change
  below the reader, and Back after a client navigation;
- a page reached only through a tab strip, by a click (it is still opened by a full load);
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
- It exits 0 when every step passed, 1 otherwise, and 2 on bad arguments or a router that is not
  running. The output and screenshots land in `--out`, by default `../tmp/e2e-<router>`.
- **Done means both**: 25.12/apk and 24.10/opkg. Say which one a run covered.
- CI runs the crawl (`e2e`) and the anchoring check (`anchor`) as two jobs per router, side by side.
  The crawl takes about 4.5 minutes (bootstrap 130 s, desktop 80 s, click about 30 s, phone 18 s;
  the log prints each pass's time), the anchoring check about 5, so the anchoring job ends the run; a job's setup adds about 2, the router
  building in the background while the browsers and the package are fetched and packed. A change
  that touches documentation alone skips both (`tools/ci-package-changed.sh`).
- The anchoring check runs on its own against any running router with footstrap active, an
  `owlab sync`ed one included: `node tools/anchor-check.mjs --router owrt2512 [--engines webkit]
  [--widths 390]`. It switches the theme to bootstrap for its reference cells and back to footstrap.
  Footstrap's cells run one engine at a time; bootstrap's run as one phase across the engines, the
  same six pages' load. When every failure is a cell that measured nothing, the whole check runs once
  more (the log says `MEASURED NOTHING` first); a failure that measured something is never rerun.
  Exit 0 on a pass, 1 on a failure, 2 when the router is not running or has no lease.
- Whether the anchoring check can fail at all: `node tools/anchor-mutants.mjs --router owrt2512`
  puts known-bad dev builds of `fs-fit.js` on the router one at a time (the offset read inside the
  scroll event, the correction a frame late, no correction, no floor, no deferred floor), runs the
  check against each and reports which it killed, then puts the normal build back. Exit 1 when one
  survived, 2 when a mutant's text is no longer in `fs-fit.js`. Run it after changing `fs-fit.js`
  or the check; it takes about as long as the check per mutant, so pass `--widths 390` for a quick
  pass. A surviving mutant is a hole in the check, or code the check never reaches.

## Reading a run

Each `e2e` leg uploads its `--out` directory as the artifact `e2e-<router>`, and each `anchor` leg
its log as `anchor-<router>`, also when it failed:

```sh
gh run download <run-id> -n e2e-owrt2410 -D ../tmp/e2e-ci-owrt2410
```

| Path | What it holds |
|---|---|
| `report.json` | `results`: every step as `{ step, ok, detail }`; `crawl.pages`: one entry per path and way of opening it (`desktop`, `phone`, `click`) with its `problems`; `crawl.bootstrap` and `crawl.footstrap`: what each pass read on each path (errors and failed requests with the ms after render they showed up, the visible text, the stylesheet's rule count, the token, the menu) |
| `footstrap/desktop/*.jpg`, `footstrap/phone/*.jpg` | one screenshot per page at 1280 and 390 px, named after the path (`admin_status_overview.jpg`) |
| `bootstrap/*.jpg` | the same pages under bootstrap at 1280 px |
| `anchor-check.txt` (in `anchor-<router>` from CI) | `tools/anchor-check.mjs`'s log: per engine, width and change (grow, shrink), per cell the end shift, the largest shift, the frames off place sampled and painted, and the change in px, then the `FAIL` lines |

The log prints `PASS`/`FAIL` per step and, under the crawl step, one line per failing page and way
of opening it. A failure in an install, upgrade or removal step carries the package manager's last
line of output in its detail. `gh run view <run-id> --log-failed` prints a red job's failed
steps; reproduce it with a local run on the same router before naming a cause (the diff,
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
- Some comments are code — LuCI's `'require …'` directives, the Makefile's buildroot marker. Keep
  them verbatim; never reword comments with a mechanical `sed`.
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
- A duplicate is merged, or listed in [css.md](css.md) "Duplicates CSS cannot merge" and edited
  in both copies.
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

A JS error, a failed request, a view that stops rendering or is hidden, a missing stylesheet or
menu is what e2e sees; behaviour beyond that is looked at by hand on both routers.

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

- After a push: `gh run list --commit <sha>`, then `gh run watch <run-id> --exit-status`.
- Before pushing to `main`: Build's newest completed `push` run on `main` must be `success`
  (`gh run list --branch main --workflow build.yml --event push --status completed -L1`); a
  `cancelled`/`skipped` run says nothing — the one before it decides. CodeQL, pages and Dependabot
  runs are not the reading.
- `release` needs `e2e` on both routers, so a tag never publishes a package that failed it. Job
  graph: [ci.md](ci.md).
- Hardware only on the maintainer's word: [development.md](development.md) "Proving it on hardware".
