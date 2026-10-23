# Verifying a change

What to run after an edit, how long it may take, and the traps each gate has already cost. The
gates themselves are described in [development.md](development.md) "Verifying a change"; the rules
they hold are in [conventions.md](conventions.md). This page is the checklist that ties them to
the files you touched.

## Tiers

| Tier | When | Bound | What |
|---|---|---|---|
| T0 | after every edit, foreground | 60 s | `npm test`, the area's gate below, a template compile for any `.ut` |
| T1 | once on a finished branch | 5 min | `npm run check`; after JS or CSS also `npm run smoke` and `npm run computed-diff` |
| T2 | detached, never blocking | hours | owlab stands, the live gates, the benchmark, `jsmin-verify`, `owlab test`, `tools/ci-local.sh` |

- A shell call stays under 5 minutes. Anything longer is T2: start it with `tools/bg.sh <cmd>`
  (detaches, logs into `../tmp/`), then wait with `tools/bg-wait.sh <run-id> 5 270` (a run under
  4.5 min) or `tools/bg-wait.sh <run-id> 30 <cap>` in the background. A timed-out run is never
  retried with a larger timeout; a Playwright stack with `log: []` is a run killed by that limit,
  reported as not run.
- `npm run check:fast` is the quick subset for docs and config edits. `.githooks/pre-push` runs
  `npm run check` on the pushed commit in a clean worktree (`git config core.hooksPath .githooks`).
- **Done means it ran on a real userland on both package managers**: 25.12/apk and 24.10/opkg
  (CI's `verify` job). Say which one a run covered. Before/after baselines use the last package
  published in the feed.

## Rules that hold for every gate

- **A red gate is fixed in the code under it**, never by editing the gate, its baseline
  (`tools/baselines/**`), a `LIMITS` number, an `ALLOW` entry or a `test(` call — unless changing
  that file is the task.
- **A gate seen only green is unproven.** For a new or changed gate or fixture, show it go red
  without the fix: `git worktree add ../tmp/red-<id> HEAD`, copy in only the gate and fixture
  files, run it there, `git worktree remove ../tmp/red-<id>`. A cheap file gate (no browser, no
  stand) gets its red case in `tests/gates-red.test.mjs`, which plants one defect in a copy of the
  tree.
- **"Flaky" and "fixed" are a rate**, measured with `tools/rate.sh`, not a single green run. Known
  flakes are listed in `development.md` "Known flakes"; one rerun is allowed for a matching row,
  a second red is real.
- **One fault, one mechanism.** A spare check or fallback added "to be safe" ships only if the
  probe fails without it.
- **CSS is proven with a computed-style diff, never with screenshots.** The same sheet twice moves
  0.5–1.3 % of pixels on a live page; a real regression weighed 0.19 %.
- A layout change runs under RU or pseudo-loc text and at a phone width.
- **A widget probe is real input plus a hit test**: `locator.click()` on the spot `ui.js` opens it
  from (a ComboButton only `> span.open`, a plain dropdown anywhere), then
  `document.elementFromPoint` at each target's centre must return that target. `dispatchEvent`
  plus `getBoundingClientRect` cannot see a clip: 0.14.16 shipped a clipped ComboButton menu past
  three such passes.
- Some comments are code — `@mirror`/`@endmirror`, `/* fs:probe */`, eslint `'require …'`
  pragmas, the Makefile's buildroot marker, the literal `dataset.fsFit` write. Keep them verbatim;
  never reword comments with a mechanical `sed`.
- A `#` line inside a quoted `ssh "$R" "…"` string is part of the string: `sh -n` after editing.
- Screenshots and scratch output go in `../tmp/`, never in the repository.

## Per area: the invariant and the T0 gate

### CSS (`styles/**`, `build-css.sh`)

- `htdocs/luci-static/footstrap/cascade.css` is **generated** (gitignored, rewritten by every
  `owlab sync` and `tools/stage.sh`): edit `styles/`.
- Layers `tokens, base, theme, page`, one directory each, filename prefix = source order. A new file
  in a layer directory needs its own `@layer` wrapper; `build-css.sh` refuses one without.
- Read the private `--fs-*` tier only; the `--*-color-*` export tier is read by nobody in `styles/`
  (`audit --strict`). A hostile `:root` recoloured 312 of 336 gallery elements before the split, 0
  after.
- `!important` is a gated allowlist; one that beats another footstrap rule means a wrong layer.
  `theme/95-a11y-media.css` is the sanctioned exception.
- Edit the rule that already styles the selector; win on specificity, never on source order.
- Never delete a selector because no stock page renders it; `css-orphans` is the only safe dead-CSS
  search.
- Browser floor Chrome 108 / Firefox 101 / Safari 15.4 (`npm run css-floor`). A `:has()` compound
  sharing a selector list with one that has none kills the whole rule below the floor — split it or
  wrap in `:is()`. A feature new to the sheet must be classified in `tools/css-floor.mjs`. A
  `color-mix()` token needs its static twin in `styles/04-nocolormix.css`.
- No colour literals (`--fs-scrim` excepted); no `--*-rgb`/`--*-hsl` bridges.
- A duplicate is merged or pinned in `@mirror`; an unpinned duplicate and a one-copy `@mirror`
  group both fail.
- `styles/base/` is editable, but prefer the matching `styles/theme/` file and justify a base edit
  with a near-empty computed diff.
- No bold mono: `<strong>` must be *assigned* the sans face.

T0: `npm run lint:css`, plus `npm run audit` (tiers, `!important`), `npm run mirror` (duplicates),
`npm run css-floor` (a new feature). T1: `npm run computed-diff` (~9 s); `--control` runs the same
sheet on both sides and must report 0 before any other number means anything. The gallery has every
widget and none of the pages: the live half is `npm run live` and `owlab test` (T2).
Method: [css.md](css.md) "Proving a CSS change".

### JS (`htdocs/luci-static/**/*.js`, `tests/**`)

- One concern per module; `L.require` throws on a cycle, so compose by calling, never `extend`.
- The fit engine is `fs-fit.js`; a module registers with `fit.add()` and runs no observer of its own
  (the `#indicators` observer in fs-chrome is the one exception). `data-narrow`, not a media query,
  says "the sidebar became a bar"; widths are read from CSS tokens with `getComputedStyle`.
- **Never put a regex literal straight after `return` or `=>`**: jsmin eats the rest of the file and
  exits 0. Wrap it: `return (/^https?:\/\//i.test(a));`. No backtick inside `${…}`. eslint
  `wrap-regex` holds the cause, `tools/jsmin-verify.mjs` (CI only) the consequence.
- Require a stock class through `window.L`; the factory's `L` has no `ui` helpers.
- `FS_VERSION` stays in `fs-version.js` at that path — the Makefile, `dev-sync.sh` and
  `tools/stage.sh` sed it by path.
- The theme never checks for its own updates and never reaches a third-party host at run time.
- A comment in a shipped file carries its reason inline: no `issue #N`, no `tools/`/`tests/`/`docs/`
  pointer as the only carrier (they do not exist in openwrt/luci).

T0: `npm test`, `npm run lint:js`, plus `axes` (fs-prefs, fs-axes), `chrome-fence`
(fs-sheets, fs-prefs), `page-modules` (page→module map), `css-orphans` (an `fs-*` class moved),
`comment-share` (a comment edit; under 40 % comment bytes). T1: `npm run smoke` (~2 s, modules on
the gallery with dependencies stubbed). Behaviour is `owlab test` and the live gates (T2); anything
in `holdFloor()` or `naturalHeight()` also takes `npm run floor` (T2).

### Chrome and templates (`*.ut`, `fs-*.js`, `menu-footstrap*.js`)

- One theme entry, one template dir, one renderer. Layout is a client axis (`:root[data-layout]`,
  always explicit); never a `:not([data-layout=…])` guard, never a second renderer.
- Three zones: ours (`fs-*`, `--fs-*`, `[data-fs-chrome]`), shared LuCI (`.cbi-*`, `#view` — an app
  may win there), theirs. `.left`/`.right`/`.center` and `ul.nav` are LuCI's.
- The chrome is defended by not matching (the mark in `header.ut`, the fence in `fs-sheets.js`, the
  pin in `theme/10-chrome.css`). `npm run chrome-fence` compares whole canonical strings.
- A view's CSS is never deleted; only a byte-identical duplicate may be dropped.
- Every Appearance axis is implemented twice (pre-paint in `partials/head.ut`, live in `fs-axes.js`
  / `fs-prefs.js`) and **the custom property is set before the attribute**, or a reload paints one
  frame in the previous hue (`npm run axes`, `npm run smoke`).
- After touching any `_()`: `luci-theme-footstrap/update-po.sh`. Appearance labels carry the
  `footstrap` msgctxt; the chrome and the login/notice sentences deliberately do not.

Template compile (T0 when the stand is up; booting a down stand is T2 first —
`tools/bg.sh owlab up owrt2512`, then the waiter):

```sh
owlab sync owrt2512
docker exec owlab-luci-theme-footstrap-owrt2512 sh -c 'for f in /usr/share/ucode/luci/template/themes/footstrap/*.ut /usr/share/ucode/luci/template/themes/footstrap/partials/*.ut; do ucode -T -c -o /dev/null "$f" || exit 1; done'
```

This proves 25.12's ucode only; 24.10's interpreter accepts a different set and CI's `verify` job
compiles on both — report the 24.10 half as CI's.

### Package (`Makefile`, `root/**`, `po/**`, `owfeed.yml`, `install.sh`)

- `+luci-base` is the whole dependency list; fall back to `uclient-fetch` rather than adding `curl`.
- The catalogue lives in `po/`; the theme itself carries none (two packages owning one path is an
  install apk refuses). `po/`, `tools/stage.sh` and `owfeed.yml` repeat the language list
  (`npm run i18n-packages`).
- Anything under `root/etc/config/` must be in `conffiles` (`npm run conffiles`).
- `postinst`/`postrm` run no `rpcd reload` and no `restart` (`npm run makefile-contract`).
- A malformed `acl.d/*.json` is skipped by rpcd silently (`npm run acl`).
- An upgrade must never change the active theme; `30_luci-theme-footstrap` tells install from
  upgrade by whether `themes.Footstrap` exists (apk exports no `$PKG_UPGRADE`).
- `PKG_LICENSE_FILES:=LICENSE` needs the `$(CP) $(CURDIR)/LICENSE` line in `Build/Prepare`. No
  `PKG_VERSION`. `LUCI_MINIFY_CSS:=0` (csstidy mangles `:has()` and `color-mix()`).
- The Makefile's buildroot signature line stays last (`npm run marker`).
- The trust chain fails closed: verified TLS (never `-k`), an ed25519 `usign` signature, then
  GitHub's sha256. A missing digest, `.sig` or usign is a refusal, not a downgrade.

T0: `npm run makefile-contract` **and** `npm run marker` for the Makefile (they read different
lines), `npm run conffiles`, `npm run acl`, `npm run i18n` for `po/**`, `npm run shell` for any
`*.sh`. Before pushing a change to `install.sh` (users fetch it from raw `main` the moment it lands):
`tools/bg.sh sh tools/install-check.sh owrt2512 owrt2410` → PASS on both.

## The full cycle on the stands

For a change that needs more than T0/T1 (behaviour, packaging, a release):

1. Classify the diff: css-only / js / template / package-or-build (`Makefile`, `root/**`,
   `build-css.sh`, `tools/stage.sh`, `strip-*`).
2. T0 and T1 as above.
3. Stands: `docker ps --format '{{.Names}}\t{{.Ports}}'`. Bare `owlab up` boots every stand in
   `owlab.yaml`; start only those that are down: `tools/bg.sh sh -c 'owlab up owrt2512 owrt2410'`.
4. `owlab sync owrt2512 && owlab sync owrt2410`, then **prove the bytes arrived**: `md5sum` of a
   touched resource on the host against
   `owlab exec owrt2410 -- md5sum /www/luci-static/resources/<file>`. opkg answers `up to date` to a
   matching version and installs nothing.
5. Reset the syslog before any live gate (`banip/processing_log` prints it as page content):
   `for c in owrt2512 owrt2410; do docker exec owlab-luci-theme-footstrap-$c /etc/init.d/log restart; done`.
6. Live gates on both stands as one detached chain joined by `;` so a red gate does not hide the
   next: `tools/bg.sh sh -c 'node tools/<gate>.mjs --only owrt2512 <flags>; node tools/<gate>.mjs --only owrt2410 <flags>'`.
   **Never `npm run live -- --all`**: npm takes the forwarded flags as its own config and no gate
   receives them (`releasing.md` Step 4).
7. A change to `fs-fit.js` or a scroll-anchor/floor gate:
   `tools/ci-local.sh --mode push --force build anchors` → every `anchors` step PASS, none SKIP
   (both stands, hours).
8. Release-grade or package-or-build: `./tools/stage.sh && owfeed build`; `owlab down` first
   (`owlab test` binds host port 2222 and removes an existing stand), then
   `ss -ltn | grep ':2222 '` must print nothing (2222 once stayed held with `docker ps` empty); then
   one run per format with the five assertions from [development.md](development.md) "Proving it
   on a router".
9. Hardware only on the maintainer's word. Pre-check:
   `ssh <host> 'ls -d /www/luci-static/bootstrap /usr/share/ucode/luci/template/themes/bootstrap/header.ut && uci get luci.main.mediaurlbase'`,
   then `luci-theme-footstrap/dev-sync.sh <host>`, compile every template over ssh, and
   `curl -s -D - -o /tmp/login.html http://<host>/cgi-bin/luci/` expecting the login form in the
   body (25.12 answers 403 with `x-luci-login-required: yes`; the status code proves nothing). On
   failure the rollback is
   `uci set luci.main.mediaurlbase=/luci-static/bootstrap; uci commit luci` — print it, do not run
   it unasked.

## CI

- After a push: `tools/bg.sh tools/ci-watch.sh --sha <sha>` plus its waiter → one verdict line.
- Before pushing to `main`: Build's newest completed `push` run on `main` must be `success`
  (`gh run list --branch main --workflow build.yml --event push --status completed -L1`); a
  `cancelled`/`skipped` run says nothing — the one before it decides. CodeQL, pages and Dependabot
  runs are not the reading.
- A red job: `tools/ci-log.sh <run-id>` (failed step and its decisive lines), then reproduce it with
  `tools/ci-local.sh --force <job>` before naming a cause (diff, infrastructure, upstream feed).
- Job graph and how to read a run: [ci.md](ci.md).

## The probe rig: `tools/probes/`

Ad-hoc Playwright probes against a running stand, not gates (nothing in `package.json`, nothing in
`check`): `node tools/probes/<probe>.mjs owrt2512 [arg]`. See [development.md](development.md)
"The probe rig".
