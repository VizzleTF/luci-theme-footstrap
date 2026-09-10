# Development

How to bring up a dev router, push a change to it, and prove the change did what you meant.

Rules a patch has to follow: [conventions.md](conventions.md). Building a release: [ci.md](ci.md).

## Two modes of working

1. **The fast loop (no package build)** — edit files, push them straight to a router. The theme is
   templates plus static assets; the only build step is `build-css.sh`, which concatenates `styles/`
   into `cascade.css` with nothing but `cat` and `awk`. This is the normal mode.
2. **A real package** — for distribution, and for verifying a clean install.

## Install owlab first — it is not optional

**owlab is a required part of this checkout, not a convenience.** A change is not finished until it
has run on a real OpenWrt userland; see the rule in [conventions.md](conventions.md).

```sh
go install owfeed.org/owlab/cmd/owlab@latest
owlab doctor                  # what this machine can do (Docker, arch, emulation)
```

Docker is the only other requirement. Everything else comes out of `owlab.yaml`.

## The dev stand: four containers

Brought up by [owlab](https://github.com/owfeed/owlab) from `owlab.yaml` in the repo root. There are
**four** routers because the differences that bite are runtime ones and one box will not show them:
three axes — package manager, LuCI feed (upstream vs fork), release — covered pairwise by four
boxes.

| id | distro | release | manager | LuCI |
|---|---|---|---|---|
| `owrt2512` | OpenWrt | 25.12.4 | apk | http://localhost:8025 |
| `owrt2410` | OpenWrt | 24.10.8 | opkg | http://localhost:8024 |
| `imm2512` | ImmortalWrt | 25.12.1 | apk | http://localhost:8026 |
| `imm2410` | ImmortalWrt | 24.10.6 | opkg | http://localhost:8027 |

```sh
owlab up                 # build and start all four
owlab sync --watch       # rebuild the CSS and push on every edit
owlab open owrt2512      # open LuCI in a browser
```

Log in as `root` with an empty password. Inside is the release's real userland (procd as PID 1,
netifd, ubus, rpcd, uhttpd) from its own rootfs tarball, not a home-made imitation.

- **Reach them only through `localhost:<port>`.** The docker bridge address routes from the host on
  native Linux and inside WSL2, but not on Docker Desktop for macOS or Windows — so no command here
  uses it and the stand behaves identically on any OS.
- **Rebuilding an image is a factory reset**: there are no volumes, so `owlab up --rebuild` wipes the
  pushed theme and you re-run `owlab sync`. That is wanted — it exercises the install path for real,
  on both package managers.
- **There is no `curl` on them**, exactly as on a stock router. Run a curl snippet from the host
  against `localhost:<port>`, not through `owlab exec`.
- **owlab disables mwan3 and watchcat itself.** mwan3 decides the dummy WAN is dead and installs
  `ip rule … blackhole`: LuCI answers while all outbound traffic hangs with no error.
- A hardware router is still reachable as `ssh router`, and `luci-theme-footstrap/dev-sync.sh`
  pushes to it — for when the question is genuinely about hardware.

## Pushing a change

```sh
owlab sync                    # to every router
owlab sync owrt2512           # to one
owlab sync --watch            # and thereafter on every edit
```

`sync` puts files exactly where `luci.mk` would and drops the same caches its postinst does. The
steps are spelled out in `owlab.yaml`:

- `build:` rebuilds `cascade.css` from `styles/` (`build-css.sh --dev`, comments intact) before every
  push. Without it everything is copied except the file LuCI actually requests, and the router
  404s on its own stylesheet;
- `install:` maps the package directories onto router paths;
- `post_sync:` registers the theme and removes legacy directories — here rather than through
  `root/etc/uci-defaults/…`, because `sync` deliberately does not overwrite `/etc/config` or
  `/etc/uci-defaults`: that is router state, not package content;
- `theme: footstrap` — owlab sets `luci.main.mediaurlbase` after the push. Installing the package
  only registers the theme, which on a dev stand is the opposite of what you want.

Resource JS is copied by glob (all of `htdocs/`), never by a list of names. The list was a bug: a
new file made it into the package (luci.mk copies `htdocs/` wholesale) but silently never reached the
dev router, so it was first exercised after the release.

What `sync` does not do: stamp `FS_VERSION` (the Footstrap tab shows `dev`) and compile
`po/*.po` into `.lmo` (strings stay English). Both belong to a real package build, which is where
they should be verified.

## If you break it

- **A broken template does not brick the UI.** If `header.ut` does not compile, LuCI falls back to
  the first working theme in `luci.themes` and shows a "Theme fallback" indicator carrying the error.
- Manual rollback at any time:
  ```sh
  owlab exec owrt2512 -- 'uci set luci.main.mediaurlbase=/luci-static/bootstrap && uci commit luci'
  ```
- If everything is broken: `uci` is reachable over ssh, and LuCI is not needed to recover.

## Caches while iterating

- The menu and dispatcher are cached in `/tmp/luci-indexcache.<hash>.json`. The hash comes from
  menu-file mtimes, so it updates itself — but if things look strange:
  `owlab exec owrt2512 -- 'rm -f /tmp/luci-indexcache*'`.
- `.ut` templates are not cached between requests (ucode compiles on the fly) — an edit to
  `header.ut` is visible on F5.
- CSS/JS are cached by the browser. `cascade.css` is served with `?v={{ pkgs_update_time }}`, so
  touching the package database changes the key and an ordinary F5 picks the file up. **Which file
  that is depends on the release**, so touch both:
  ```sh
  owlab exec owrt2512 -- 'for db in /lib/apk/db/installed /usr/lib/opkg/status; do [ -f "$db" ] && touch "$db"; done'
  ```
  Naming only the apk path means the key never changes on 24.10: the file arrives, the browser serves
  the old one, and it looks exactly like an edit that did nothing.

## Verifying a change

**A template** — with the same `trycompile` LuCI uses, which is also what CI runs:

```sh
owlab exec owrt2512 -- 'ucode -T -c -o /dev/null \
  /usr/share/ucode/luci/template/themes/footstrap/header.ut'
```

**CSS** — not with screenshots. Live counters (uptime, DHCP leases, wifi signal) move 0.5–1.3% of
pixels between two runs of the *same* stylesheet, while a real regression weighs 0.19%. Diff computed
styles instead: load the page once, swap the `<link>` for the second sheet, snapshot
`getComputedStyle` over every element. Method and traps: [css.md](css.md).

**Behaviour** — on a router, with `owlab test` (next section). The gates cannot see behaviour, and a
stubbed harness only proves a module loads.

**Pure logic — and only the part a router cannot show you** — with the unit suite:

```sh
npm test                       # node --test, ~100 ms, no browser and no stand
node --test tests/menutree.test.mjs        # one file
node --test --test-name-pattern 'alias' tests/    # one case
```

`tests/lib/luci-module.mjs` evaluates a shipped `fs-*.js` inside the same wrapper luci.js uses —
`function (window, document, L, <one param per require pragma>)` — so the file under test is the file
that ships, not a rewritten copy. `window` and `document` are recorders: they answer the few reads a
module makes while it evaluates and remember the listeners and timers it registered.

**What belongs here is what a stand cannot produce.** The suite is not a second opinion on layout or
on behaviour — there is no box, no paint and no event dispatch, and a measurement faked here would be
worth less than nothing. It is for the branches the two stands can never enter: a luci-base with a
surface missing (`tests/router-contract.test.mjs`), an alias loop planted by a foreign `menu.d`, a
`firstchild` tie broken by key order, a leaf whose own ACL re-opens a read-only path
(`tests/menutree.test.mjs`). If a case can be seen on `owlab`, it belongs on `owlab`.

Three more kinds have since earned a place here, and each one is a fault the suite FOUND:

| File | The branch a stand cannot hold still |
|---|---|
| `chrome-geometry.test.mjs` | the column's width per combination of layout, rail and window — pure arithmetic over four measured numbers, and the only place every combination can be asked at once. Whether the numbers still describe the page is `live-audit`'s question, not this one |
| `interval-pause.test.mjs` | a `visibilitychange` landing inside a specific window: a hide across an in-flight navigation, a view clearing its own timer after a hide/show. Both need a race won on purpose; the harness dispatches the event exactly |
| `session-expiry.test.mjs` | the verdict the two interceptors reach on a reply, in both directions. A stand would have to expire a real session mid-run — a fixture, not a test |

The rule is unchanged: the harness may not fake a measurement. What these drive is a decision made
from numbers somebody else measured, which is a different thing.

**Everything else** — the static gates:

```sh
npm run check
```

One run covers lint, `audit.py --strict`, the CSS ratchets, orphans, duplicates, `@mirror`, the
appearance axes, the chrome fence, the export tier, the rpcd ACL, i18n and axe-core. What each gate
holds: [conventions.md](conventions.md).

`build-css.sh` additionally checks its own brace balance and refuses to write a suspiciously short
file. Two gates run in CI only: `tools/jsmin-verify.mjs`, which needs a jsmin built from
`luci-upstream.pin`, and `ucode -T -c` over every template, which the `verify` containers run against
the installed theme — the same command as above, so locally it is one `owlab exec`.

Nothing in `package.json` reaches the package: the OpenWrt buildbot has no node.

### The three cheap browser gates: `smoke`, `computed-diff` and `pseudo-loc`

Between the static gates and a stand there is a step that costs seconds and catches the regression
that is in the FILE rather than in the page. Both drive `docs/gallery.html` — every widget LuCI or a
third-party app can emit, with the real class names, and no router.

```sh
npm run smoke            # ~1.4 s: the modules come up in a real DOM, the axes stamp in order
npm run computed-diff    # ~4 s per viewport: worktree vs HEAD, getComputedStyle over every element
npm run computed-diff -- --control    # the same sheet twice; must be 0
```

`smoke` evaluates `fs-fit`, `fs-prefs`, `fs-axes`, `fs-select`, `fs-chrome` and `fs-router` the way
luci.js does — the prologue's `'require x as y'` pragmas become the factory's parameters, one copy
of that derivation shared with `tests/lib/luci-module.mjs` — and then watches each colour axis write
`--fs-<x>-h` before `data-<x>`. What it adds over `npm test` is the box: the unit suite's window and
document RECORD calls rather than answer them, so a module that throws the first time it measures
something passes there and fails on a router. Proven to bite: inverting the two writes in
`fs-axes.js` turns five checks red.

`computed-diff` builds the stylesheet at `HEAD` with `git archive` (so an uncommitted edit cannot
leak into the BEFORE side), loads the gallery once, and swaps the `<link>`. Its floor is 0, and two
measurements were needed to get there — the reference sheet is swapped onto ITSELF before the first
snapshot, because a colour from a sheet parsed with the document serialises `oklab(…)` and the same
colour from one attached later serialises `color(srgb …)` (28 phantom differences in light, 0 in
dark); and every running animation is awaited, because a `span.cbi-tooltip` fade was caught at
`opacity 0.00245647` by one snapshot and finished by the other. It reports rather than judges unless
given `--max N`.

**It runs at two viewports, not one** (task 0145): 1280 (every page's design width) and 390x844 (a
phone point). A property that only diverges once a flex row is narrower than its own content is
invisible at 1280 by construction — the switch-knob overhang bug measured 0 differences there on
`worktree vs HEAD` with the fix reverted, and a `width` difference (26.80px vs 40px declared) only at
390. `a11y` and `export-tier` still take Playwright's 1280 default alone; the gap this closes is
`computed-diff`'s.

`pseudo-loc` catches what neither of the other two can: a box sized for the ENGLISH string it was
built against. Both `smoke` and `computed-diff` render the gallery exactly once, in English, and a
toggle knob left its pill on every Russian phone at default density (task 0145) is invisible to a
gate that never renders a longer string. `pseudo-loc` replaces every visible text node and
text-carrying attribute in the gallery with a pseudo-localised form — each word 45% longer, Latin
letters swapped for accented look-alikes, no translation catalogue or router needed — and asserts
nothing overflows its box, escapes its parent, or is clipped with no scroller to reach it, at 320
and 390 CSS px across all three densities.

```sh
npm run pseudo-loc            # ~4 s: 6 width x density points, English vs pseudo-localised
npm run pseudo-loc -- --verbose      # every finding, not just the first 8 per kind
npm run pseudo-loc -- --eps 4        # raise the tolerance; re-check the intact tree still passes first
```

Every shape is measured TWICE per point — once on the page as loaded (English), once after
pseudo-localisation — and a finding is only reported if it both exceeds the tolerance AND *grew* by
more than `--eps` between the two. Without that, `docs/gallery.html` reports overflow that is
already there in plain English (13 such findings at 320px measured on this tree: a synthetic
unbroken RU compound built to exercise `min-width: 0`, a breadcrumb path, an iface stat line) —
real, but not caused by translation length and not this gate's fault to raise. Three more
false-positive shapes are guarded structurally rather than by a threshold: an empty `.modal` LuCI
keeps in the DOM at all times would read as a host with a clean sheet if it were ever measured, so
every check requires `getClientRects().length > 0`, which also excludes a collapsed submenu's links
— they carry an ordinary computed `display` while their `<ul>` ancestor is `display: none`, and a
hidden ancestor gives every descendant zero client rects; and a deliberately fixed foreign width
(the filemanager's 600px case, already decided in `tools/baselines/live-audit.json`) is excused by a
plain selector ALLOW list, the same shape as `a11y-gallery.mjs`'s `.exclude()` — this gate keeps no
baseline file of its own, so an allowlist is the only place left to record the decision.

**Proven to bite**: `flex-shrink: 0` on `.cbi-checkbox > label[for]` (`styles/theme/60-inputs.css`,
task 0145) reverted in a scratch copy outside this checkout. Intact: 117 findings, none naming the
switch. Reverted: 123 findings, +6 — one per width/density point — every one `<label for="cb1">`
itself, self-overflow 15-25px: the knob (`::after`, `position: absolute`) stays anchored to the
pill's declared width while the pill shrinks under the caption pseudo-localisation just grew.

**What to do when it fires**: read the element, width, density and measured `by` in the output.
If it names something already accepted (a torture fixture, gallery chrome, a contract another gate
owns) it is an ALLOW-list candidate with the same one-line justification the existing two entries
carry — not a reason to raise `--eps` globally, which would blind the check everywhere at once
instead of at the one place that earned the exception. Otherwise it is a real finding: report it (do
not fix it in the same change unless that change's own purpose was already this element) with the
element, width, density and `by` from the output, the way any other gate's finding gets triaged.

**Tier: folded into `check:slow`** (task 0155), same cost class as `smoke`/`a11y`/`export-tier` —
one headless Chromium, a few seconds. `check:mid` was never a candidate (it is the browser-free
static half — CSS metrics, floor, duplicates, size, i18n).

The 117 findings task 0152 left untriaged (9 distinct root elements, everything else the same
element at another width/density) were the reason it stayed standalone until now: folding an
unreviewed set into `check:slow` would have turned every future `npm run check` red for pages
nobody had looked at yet. Each of the 9 was one of two things, never a third — `--eps` was not
touched:
  - a REAL fault, fixed in CSS: the Port-status tile's stat line and the upload strip's Create/
    Cancel row were both `white-space: nowrap` inherited from a text-only ellipsis rule
    (`styles/base/95-luci.css`) with no text to ellipsis — a nested flex row, not a sentence — so a
    grown label escaped or clipped with no "…" to show for it; the checkbox caption's one
    unbreakable word (a plausible real RU compound, not a torture string) needed `overflow-wrap:
    anywhere` it did not have. One gallery fixture was the fault instead of the CSS: three
    `<input>` demo captions read as raw markup (`value="input[type=button]"`), a string no real
    button ever carries, and grew past their row on that alone;
  - an accepted shape, ALLOW-listed in `tools/pseudo-loc.mjs` with the reasoning inline: three were
    the SAME dropdown-ellipsis precedent (task 0149) by other selectors — the breadcrumb path, the
    tab strip's long RU label, the filename column all shrink-then-ellipsis correctly and merely
    *measure* as self-overflow the way any truncated element does; one is the meter's reserve,
    already measured and margin-tolerant, marginal even in English, where pseudo-loc's own bracket
    wrapper (not a translation) tips it over; one is `#g-longlabel` itself, the gallery's own
    deliberately-unbreakable torture compound, which no CSS fixes by construction.

117 -> 0 findings; `npm run pseudo-loc` is green on the intact tree and now runs on every
`npm run check`.

**Task 0161 (verification of the triage above) found the ALLOW walk itself over-scoped**: it climbed
from every matched element to `<body>`, excusing every ancestor along the way, not just the element a
selector named — `scrollWidth` is cumulative, so one `.table` or one accepted dropdown silenced its
`.cbi-section`, then its `.g-sec`, then everything else sharing that ancestor. Measured: 311 of 822
elements and 14 of 22 gallery sections read as unmeasurable, including all four buttons of the "Row
actions, plain table (Startup-style)" fixture the same triage had just added — a reverted
`flex-basis: auto` (`styles/theme/55-buttons.css`) would have gone undetected. Fixed to match only the
elements each selector names (no ancestor climb); re-running then surfaced 66 findings, every one a
duplicate of the same three already-accepted leaves (`#g-longlabel`, `.cbi-progressbar`, `.table`)
pushing their own CONTAINER's `scrollWidth` over — not a new fault, the cumulative-`scrollWidth`
mechanism working exactly as documented, just no longer hidden. Each container is now named explicitly
with `:has()` against the leaf that causes it, and `.g-wrap` — the gallery's own outermost wrapper, not
a widget any router page renders — is excused outright, since it reads as "widest content on the page"
for as long as any of the three exists anywhere on it. Separately, `.table *`'s wildcard also swallowed
every row-action BUTTON inside a `.td.cbi-section-actions` cell, unrelated to the no-JS-carding
contract that entry exists for; narrowed with `:not(.cbi-section-actions, .cbi-section-actions *)`, and
reverting `flex-basis: auto` to check reproduces exactly the expected finding (6 points, self-overflow
on "Принудительно завершить"), confirming the fixture is now actually measured, not merely present.
The SELF check's `eps + margin` tolerance had a second latent flaw, unrelated to scoping: a NEGATIVE
margin (`.zonebadge .cbi-tooltip`, `styles/base/90-widgets.css`: `margin: -1.6em 0 0 -5px`, an overlap
trick, not reserved room) drove `eps + margin` below zero, which widens the pass condition instead of
narrowing it and can report `by` as low as 0px — clamped with `Math.max(0, …)` so a negative margin now
costs nothing, the same as carrying none.

**Neither replaces a userland run, and a green one never earns a release the right to skip owlab.**
The gallery has every widget and none of the pages: no menu, no chrome, no session, no third-party
sheet, no rpc, and every dependency in `smoke` is a
stub. They are early detectors. The release matrix is unchanged — `owlab test` on both formats,
`npm run live -- --all`, `npm run check`, `/security-review` (releasing.md).

### Git hooks

The repository keeps its hooks in `.githooks/`, which is not active until you point git at it:

```sh
git config core.hooksPath .githooks
```

`commit-msg` strips Co-Authored-By, `Claude-Session:` and "Generated with" trailers from whatever
wrote them, and leaves `Signed-off-by` alone — openwrt/luci refuses a sign-off with a
`@users.noreply.github.com` address, so that line is load-bearing. `pre-push` runs `npm run check`;
`git push --no-verify` is the deliberate bypass and says so on the way past.

## The live gates: `npm run live`

The static gates read files. Every bug a user has reported was about a **page** — a shredded column,
a clipped title, a doubled scrollbar, a third-party app laid out wrong, a client navigation that
painted less than a full load. `npm run live` is the half that opens pages, and it needs stands:

```sh
owlab up                       # the containers these gates measure
owlab sync                     # your working tree onto them
npm run live                   # upstream-contract, spa-parity, live-audit, scroll-jank, table-tick, scroll-anchor
                               #   two routers (the OpenWrt pair), one page per SHAPE
npm run live -- --all --pages-all   # the four routers and every page: before a tag
```

Each is also a command of its own, and each takes `--only <router ids>`:

```sh
node tools/upstream-contract.mjs --only owrtsnap --verbose   # every assumption, named, one by one
node tools/spa-parity.mjs --only owrt2410 --pages /admin/network
node tools/live-audit.mjs --only owrt2512 --widths 320,1440 --pages /admin/status
node tools/scroll-jank.mjs --engines chromium,firefox,webkit   # the other two need installing
```

**What a live run measures, and what it deliberately does not.** The gates used to open every leaf
of the menu on all four routers, which on a box with a couple of `luci-app-*` installed is 169 paths
per router and over an hour of wall clock — long enough that the honest description of the suite
became "the thing nobody runs before pushing". Three cuts, none of which changes what a finding
means:

- **`call` and `function` nodes are not pages.** 105 of those 169 leaves are RPC endpoints an app
  registers for its own JS; opening one answers JSON. `menuPaths()` returns the leaves that render
  (`view`, `template`, `cbi`) and are titled.
- **One page per SHAPE.** A page is classified by what it is MADE OF — data table, config table,
  form, tabs, editor, svg, file input… (`tools/lib/page-shapes.mjs`) — and one representative of
  each shape is measured. Every path the baseline names and every page a field report came from
  (`PINNED`) keeps its seat regardless, every dropped page is printed with the page standing in for
  it, and a narrowed run may not rewrite the baseline. `--pages-all` measures them all.
- **Three routers by default** (`lib/stands.mjs`, `CORE`): 25.12/apk, 24.10/opkg and the snapshot
  box. The first two are the package managers; the third tracks luci-base master, which is where an
  upstream change shows up before it reaches a release. `--all` adds the two ImmortalWrt stands
  (`OPTIONAL`) — worth reading, not worth blocking on. A gate that takes `--only` must honour
  `--all` too: `upstream-contract` read one and ignored the other, and silently measured a subset of
  what the release runbook asked for.

The structural gates run their routers CONCURRENTLY — nothing they measure is a timing — while
`scroll-jank` stays sequential, because frame pacing is its subject.

```sh
```

- **`upstream-contract`** is the registry of what this theme assumes about luci-base — private
  fields, a deprecated alias, a module that loads uci once and answers out of that cache forever.
  Run it against **`owrtsnap`** as well: SNAPSHOT tracks luci-base's master, so that is where an
  assumption breaks first, and a failure names the module here that has to be looked at.
- **`spa-parity`** has no baseline, because a page reached by a click that differs from the same page
  reached by a load is always a bug.
- **`install-check`** (`npm run install-check`, not part of `npm run live`) runs `install.sh` on the
  stands twice over, because the upgrade path is where every installer report has come from. It
  installs the published release and re-syncs your tree afterwards — do not run it in the middle of
  debugging something else.
- **`live-audit`** is a ratchet: known findings live in `tools/baselines/live-audit.json`, a new
  signature fails, and `--update` rewrites the file. Read the diff before you update — some findings
  belong to a third-party app rather than to the theme, and that distinction is the file's whole
  value. `--engine firefox|webkit` runs the same sweep in another engine, keyed separately in the
  baseline (a headless Firefox refuses to launch on some macOS setups; the flag is there for CI and
  for Linux). A new engine needs its own baseline, created by one `--update` run. `--lang ru` (task
  0162, below) runs the same sweep against a Russian router, keyed `<stand>@ru` — the two suffixes
  compose (`owrt2512@ru@firefox`).

### `live-audit`'s baseline is not a clean sheet, and neither entry nor language may be assumed

A baseline that is just a list of strings has no room to say WHY a signature stays — and a signature
with no reason is, on inspection, indistinguishable from a bug nobody looked at twice. That is
exactly how `/admin/services/ssclash/settings|320|clipped|div.cbi-section` sat in this file: ordinary
in shape, present since ssclash was first added to the dev routers, never singled out. Task 0162
opened every surviving signature rather than trust the shape.

**Two unrelated causes can share one signature — the exact trap that hid this one.** The RU-only
label fix already in this changelog (`min-width: 0`, `base/30-forms.css`, "a form label escaping its
section") closes a `.cbi-value-title` clip in a NORMAL settings row. It does nothing for the entry
above, which is a SEPARATE widget on the SAME page: ssclash's own "Additional Settings" panel renders
`style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); …"` inline, on
markup the app owns outright — a 320px column FLOOR that cannot fit inside a 320px content column
once the section's own padding is subtracted, in ANY language. Measured live on both stands, English
and Russian alike: `div.cbi-section` clipped 50px, `label` overflowing 49px, with no scroller to
reach either — a live, real, currently-reproducing finding, not a leftover from before the label fix,
and not fixable from this theme's stylesheet without overriding one app's own inline `style`
attribute, which `docs/third-party-apps.md`'s fence exists to protect the CHROME from, not to hand
back the other way onto an app's content. Filed as an accepted, app-owned limitation — but named,
this time, instead of sitting anonymous.

**What the rest of the surviving 200 (owrt2512) / 200 (owrt2410) signatures turned out to be** (194 /
200 at the time of the audit below; task 0167 restored six live `owrt2512` signatures a later baseline
rewrite had dropped — see "Task 0167" further down), grouped
by the shape a probe against the live page actually showed (`el.outerHTML`, not just the selector):

- **`noname` (144 signatures) is core LuCI CBI or bundled third-party markup with no accessible
  name** — `input.cbi-section-create-name` (mwan3, acme: the "add a new section" field every
  `TypedSection` renders), a bare `textarea`/`textarea#logfile`/`textarea#syslog` (adblock, banip,
  acme, dmesg: LuCI's own `form.TextValue`, whose `.cbi-value-title` label carries no `for=`),
  `textarea.ace_text-input` (ssclash: the ACE editor's own hidden input proxy), filemanager's bulk
  `input.select-checkbox`. None of it is markup this theme ships or a stylesheet can fix — a `title`
  or `aria-label` here would need a JS template edit inside luci-base or inside the app, both outside
  this package's fence.
- **`overflow`/`clipped` on `div.radio-info`, `span.ssid`/`.bssid`/`.chan`/`.rate`/`span.associations`
  etc. (`/admin/dashboard`) is a third-party dashboard app's own custom widget** — verified none of
  `radio-info`, `wifi-info`, `settings-info`, `router-status-wifi`, `dashboard-bg`, `box-s1` exist
  anywhere in `styles/` (`grep -rl` came back empty); the theme supplies no rule for any of it.
- **`div.ace_layer`/`.ace_line`/`.ace_line_group` overflow (ssclash config/log, every width) is the
  bundled ACE code editor's own internal virtualised rendering** — third-party library code, not this
  theme's DOM.
- **The vnstat2 `overflow` group (`li`, `span.hide-open`, `img`, `input.create-item-input`) is a
  measurement blind spot, not a live one.** `.cbi-dropdown[empty] > ul { max-width: 1px }`
  (`theme/65-dropdown.css`) is deliberate — an unselected multiselect's placeholder list collapses to
  a functional zero width, and the visible control shows a plain "unspecified" instead (confirmed
  with a screenshot of the actual closed control). `live-audit`'s `overflow` check only excludes an
  ancestor that `scrolls()` (`auto`/`scroll`); it has no notion of `overflow: hidden`, so a box that
  is correctly and totally invisible still measures as one whose content escaped it. Same shape as
  the already-documented empty-`.modal` trap above — accepted, not a defect, and not worth teaching
  the check a new blind spot's opposite blind spot for three low-traffic signatures.
- **`div#file-list-container`/`table#file-table` overflow, `button.btn`/`a.symlink-name` sizing, and
  the `Failed to load config` console line are filemanager's own inline pixel width** (`style="width:
  400px; …"`, JS-set) and its own row/icon sizing — the same app and the same shape already named in
  `tools/pseudo-loc.mjs`'s ALLOW list ("the filemanager's 600px case, already decided").
  `ssclash/config|320|target|a` and the filemanager target entries match the precedent `af0b05d`
  already set: an app's own link, under 24px, is the app's sizing choice.
- **`/admin/status/mwan3/overview` and `/admin/status/overview`'s `clipped|div.cbi-section` (2px) is
  sub-pixel rounding** — the file's own header already names this class of finding ("a few findings
  sit within a pixel of their threshold"); 2px against a 1px trigger is noise, not a box that lost
  content.
- **`/admin/statistics/graphs`'s `img` overflow (every width up to 1024; it fits at 1440) is a
  server-rendered RRD graph at its own native pixel width**, with no scroller and no theme rule for a
  bare `img` — a real piece of usability debt (a phone cannot see the whole graph) but not a
  regression this session caused or a fix that fits its file list; noted here rather than silently
  accepted forever. **Which of those widths a single sweep actually catches is itself unreliable**:
  the first `--lang ru --update` run recorded only 320/390 for `owrt2512@ru` (`owrt2410@ru` got all
  five in the same run), and a plain reverify straight afterwards found 568/768 firing on
  `owrt2512@ru` that the update had missed — the graph is drawn from a `blob:` URL the page builds
  itself, and whether that draw has landed by the time `CHECK` reads the `<img>`'s box at a given
  resize step is a race this gate does not control. A second `--update --lang ru` closed the gap;
  a future sweep that reports fewer of these five than before on either `@ru` key is this same race
  losing, not a fix, and needs a re-run before it is trusted as "no longer reproduces."

**58 signatures no longer reproduced anywhere on either stand and are gone** (33 on owrt2512, 25 on
owrt2410, 1 of the 58 replaced rather than dropped outright — filemanager's `a.directory-link` target
finding became `a.symlink-name`, the same under-24px row height on a different row). Three shapes
account for all of it: the two fixes below closed the nftables tooltip's whole overflowing subtree
(`li`, `small.cbi-tooltip`, `span.jump`, `ul`, `table.table`, `td`/`th`/`tr`) and wireguard's `code` +
`span`; a `768a` arrival-only signature stopped differing from its own `768` resize signature once ACE
and dmesg's timing settled (a dedupe artefact, not a fix); and ssclash's own `320|target|a` and one ACL
console line stopped reproducing on their own, the app's dev-router version having moved since
`af0b05d` baselined them. Verified with `node tools/live-audit.mjs --pages-all --update --prune`,
diffed against the git `HEAD` copy rather than trusted from the run's own "no longer reproduce" count.

**Two real, live CSS faults, found and closed in this session** (`base/20-typography.css`,
`base/90-widgets.css` — see the changelog for the measured numbers): a WireGuard public key inside an
inline `<code>` had no `overflow-wrap`, and a firewall rule-jump tooltip's `white-space: pre` refused
to wrap at all, both regardless of language. Reverting either live and re-running
`node tools/live-audit.mjs --pages /admin/status/wireguard` /
`--pages /admin/status/nftables/iptables` reproduces the exact pre-fix signature (`small.cbi-tooltip`
72px, `span.jump` 27px on owrt2512) — the ratchet fires on its own regression, not merely on faith
that the fix once worked.

### English alone was never enough, and RU is now its own ratchet, not a merge

Switching a stand to Russian by hand and running the unmodified gate produced 77 (owrt2512) / 70
(owrt2410) findings before this task, every one of which would have failed a run that only ever knew
an English baseline — not because anything regressed, but because RU text is measurably longer
(`docs/gallery.html`'s own `pseudo-loc` gate assumes 1.3-1.6x for the same reason) and the checks that
read box geometry (`overflow`, `clipped`, `doc-scroll`) are exactly the ones text length moves.

Three structural options, and why the one shipped is `--lang`'s per-language SUFFIXED key
(`owrt2512@ru`, composing with `--engine` the same way `@firefox` already does):

1. **Merge RU findings into the existing per-stand key.** Rejected: a signature's presence would no
   longer say which language it needs to reproduce in, so re-verifying it later (as this task had to,
   for the ssclash entry) would require re-discovering the language by hand every time.
2. **A language-agnostic baseline — record a finding only if it reproduces in BOTH languages.**
   Rejected outright: this is the shape of the bug the whole task started from. It would have kept
   hiding a REAL, length-only fault (the wireguard/nftables pair this session fixed) behind the
   English half of the pair passing clean.
3. **Stay English-only, forever.** The status quo before this task, and the reason it exists.

`--lang`'s suffix keeps every existing invariant the file already had for `--engine` — a per-language
UNION, `--update`/`--prune` still refuse anything short of a full sweep, and a narrowed run still
cannot rewrite what it did not visit — while making a Russian-only finding exactly as loud as an
English one, never louder (it fails ITS OWN key, not the plain one) and never silent.

`owrt2512@ru` (255) and `owrt2410@ru` (254) are now baselined by `node tools/live-audit.mjs
--pages-all --update --lang ru`, restoring `luci.main.lang` to `auto` on both routers when it exits
(a `finally` block, so a crash mid-sweep cannot leave a router parked in Russian for the next
unflagged run to silently inherit — see "Two `live-audit` sweeps against the same stand fight over
its language" below, which is exactly that failure mode from a second cause). Most of it
(192 / 199) is the SAME signature English already carries — a `noname`, `target` or app-owned finding
that has nothing to do with string length reproduces in either language identically. 62 (owrt2512) /
55 (owrt2410) are RU-only, and two shapes account for nearly all of them: the dashboard widget's extra
spans (`span.associations`, `span.encryption`, `span.label` — the same app-owned widget as the EN
group above, just more of its rows long enough to clip in translation) and filemanager's fixed-width
table clipping harder with longer RU column headers (`table#file-table`) — both already-accepted
groups, reproducing worse rather than differently.

**One RU-only group was neither of those, and was a real defect, filed rather than fixed in this
task**: `/admin/network/firewall/zones`, `firewall/custom`, `services/ddns` and `services/samba4` —
four unrelated apps sharing one `TypedSection` table shape — clipped their WHOLE `table.table` (every
`th`/`tr`/`td` in it) inside `div#cbi-firewall-zone` / `#cbi-ddns-service` / `#cbi-samba4-sambashare`
at 1024px, RU only. Measured live on owrt2512: the firewall zones table's six `<th>` cells (`Зона ⇒
Перенаправления`, `Входящий трафик`, `Исходящий трафик`, `Внутризональная пересылка`, `Маскарадинг
IPv4`, plus the actions column) total 1017px inside a 968px `#view` column — 49-65px short, with no
scroller anywhere near it. Left open rather than fixed here for the same reason task 0161's
closed-dropdown case was filed instead of forced: the theme's own history with pinned/resized table
columns is exactly where past fixes went wrong twice over (`f702d15`, `c71c920`), and a `TypedSection`
reflow needed its own measured card, not a same-night patch bolted onto a baseline-triage task's file
list.

**Closed by task 0163, not as a width or a language special case.** `.cbi-section-table` already had
a card at `@container fs-content (max-width: 960px)` (theme/65-dropdown.css) — the SAME machinery a
config table with inline widgets already uses below that width, so a `TypedSection` reflow reused it
rather than inventing a scroll fallback (this table can hold `.cbi-dropdown`/`.cbi-dynlist` widgets
whose open list a scroll container would clip, the exact trap `.fs-xscroll` is deliberately kept away
from). The query itself was reading the wrong box: `fs-content` binds to `.cbi-map`, one level above
the `.cbi-section` that actually holds the table and spends `--fs-card-pad` (16px a side, 32px total
at every density but Compact) before the table ever sees the width. Firewall zones' `.cbi-map` sat at
968px — clearing the un-adjusted 960px check — while the SECTION handed the table only 936px for a
1017px header. 992 (960 + 32) is the same check asking what it always meant to; it holds for any
column count, any language, and any viewport, because it corrects a fixed offset in the query's own
reference frame rather than a pixel this one page happened to need. A `.cbi-map`-pinned specimen
reproducing the exact 968px/1017px numbers is now in `docs/gallery.html`, so `npm run computed-diff`
reads the header row's `.th`/`.td` switching `display: table-cell` -> `block` without a router.

Neither existing browser gate would have caught this on its own: `pseudo-loc` only measures 320/390px
(the phone range) and this table has a full page of room there, while `computed-diff` renders the
gallery at 1280 and 390, neither of which lands in the 936-992px band that mattered — the fixture's
own `.cbi-map` pin is what makes the boundary visible without one. `live-audit --lang ru` is the gate
that actually saw it live and is the one to re-run (`--pages /admin/network/firewall/zones
/admin/network/firewall/custom /admin/services/ddns /admin/services/samba4 --lang ru`, T2) before
pruning the `owrt2512@ru`/`owrt2410@ru` baseline entries this finding left behind
(`1024|clipped|div#cbi-*`/`1024|overflow|table.table` and its children) — not done in this task, which
had no router to verify against.

**Task 0167 is that re-run, and it is where the RU/EN stale-count asymmetry (95 vs 3) traces to.**
`live-audit --lang ru --pages-all` on both stands reported the fixed pages' whole sub-tree gone —
46 signatures on `owrt2512@ru`, 45 on `owrt2410@ru`, every one `firewall/zones`/`firewall/custom`/
`ddns`/`samba4|1024|…` — confirming the 992px fix above live rather than by inspection. Those 91 are
pruned; nothing else the sweep called stale was, and the reason is the same shape as the RRD-graph
race already on this page: **a run that fails to reproduce a signature once is not proof it is
gone.** `--prune` REPLACES a language key with exactly what one sweep saw, and a first attempt at
this task did exactly that — dropped six live `/admin/services/acme/logread|*|noname|textarea#syslog`
signatures from `owrt2512@ru` along with the 91 real ones, because that particular sweep's `noname`
check read the `<textarea id="syslog">` as named. The check treats `el.textContent.trim()` as a name
(`CHECK`'s rule 5, `tools/live-audit.mjs`), and this textarea's content IS the log line LuCI's own
view writes into it, so whether the signature fires depends on whether the page's own `logread()`
RPC has resolved by the time the 1800ms check runs — the same asynchronous-content race the RRD
`img` already gets a pass for, not a fix. A probe against the live page (`el.outerHTML`, `acme`'s own
`admin/services/acme/logread` menu entry, static, not per-certificate) confirmed the textarea and its
`.cbi-section-descr` label carry no accessible name either way; only the transient log line changes.
The six are restored to `owrt2512` (English) and `owrt2512@ru` — `noname` does not depend on
language — with the same reason the rest of the `noname` group above already carries: LuCI's own
`form.TextValue`, no `for=`, an app the theme does not own the markup of. Not restored on `owrt2410`:
`/admin/services/acme/logread` does not render there at all (see "Reset the syslog" below). Three
more signatures survived the same reasoning for the same underlying cause: `owrt2410@ru`'s
`banip/processing_log|320|doc-scroll|document` and two `geometry|fs-content` entries need enough
accumulated log content to overflow the page at all, and a freshly booted container's log is short —
exactly the state dependence "Reset the syslog BEFORE a live run" already names for this page. A
sweep against a fresh container proves nothing about the finding's shape on a long-running one, so
these stay rather than being pruned on one clean run's word.

**`--lang ru` is not part of `npm run live`'s default sweep** — doubling every router's wall clock on
every run for a class of fault that moves only when copy or CSS changes is not proportionate at T0/T1.
Run it explicitly (`node tools/live-audit.mjs --pages-all --lang ru`, T2, detached) before a release
and after any change to a string-heavy page or to `overflow`/`white-space`/flex-basis CSS — the same
occasions `pseudo-loc` already earns its keep on.

### The probe rig: `.claude/tooling/`

Ad-hoc Playwright probes against a running stand, kept for reuse and not gates: nothing there is in
`package.json`, nothing ships, nothing runs in `check`. `lib.mjs` is the shared half — `PORTS`
(stand → host port), `login`, `PAGES` (the ACL-filtered menu tree as a page list), `SNAP` (one chrome
snapshot: sidebar width, menu items, sheet counts, poll queue) and `navAndCheck` (SPA-vs-full-load
through a sentinel). Every probe takes the stand as its first argument and writes to `../tmp/`:

```sh
node .claude/tooling/<probe>.mjs owrt2512 [arg]
```

The ones worth knowing by name — `parity.mjs`, `overflow.mjs`, `resize.mjs`, `adversary.mjs`,
`traffic.mjs` — say what they measure at the top of each file. `preview-venv/` beside them is a
gitignored Python venv holding a second Playwright for `docs/screenshots/capture.py`.

## Proving it on a router: `owlab test`

`owlab test` is the local form of CI's `verify` job: build the packages, install them on a real
userland of each release, assert. Run it before pushing anything that changes behaviour.

```sh
./tools/stage.sh && owfeed build       # writes dist/noarch/*.apk and dist/all/*.ipk

UT=/usr/share/ucode/luci/template/themes/footstrap

owlab test --release 25.12.4 --install 'dist/noarch/luci-theme-footstrap-*.apk' \
  --assert 'package luci-theme-footstrap' \
  --assert 'file /www/luci-static/footstrap/cascade.css' \
  --assert 'http 200 /cgi-bin/luci/admin/status/overview' \
  --assert 'http 200 /cgi-bin/luci/admin/system/system' \
  --assert "exec for f in $UT/*.ut; do ucode -T -c -o /dev/null \"\$f\" || exit 1; done"

owlab test --release 24.10.8 --install 'dist/all/luci-theme-footstrap_*.ipk' \
  --assert 'package luci-theme-footstrap' \
  --assert 'file /www/luci-static/footstrap/cascade.css' \
  --assert 'http 200 /cgi-bin/luci/admin/status/overview' \
  --assert 'http 200 /cgi-bin/luci/admin/system/system' \
  --assert "exec for f in $UT/*.ut; do ucode -T -c -o /dev/null \"\$f\" || exit 1; done"
```

**Two invocations, one per format — not one run with two `--release` flags.** `--install` is a glob
over the host, evaluated once per router, so `dist/*/luci-theme-footstrap*` hands the apk box an ipk
as well and the install fails on both (measured: `0 of 2 routers passed`). Name the format that
matches the release.

Those are the same five assertions the `verify` job makes (`.github/workflows/build.yml`), which
installs per format for the same reason — keep the two in step, and add an assertion here whenever
you add one there. The vocabulary is `package <name>`, `file <path>`, `http <code> <path>`,
`service <name>`, `exec <shell>`. Why the fifth one compiles the templates here rather than in
`check`: [ci.md](ci.md).

**Pin exact point releases.** `--release 25.12` or a snapshot works today and fails within days;
`owlab.yaml` pins `25.12.4` / `24.10.8` for the same reason.

For anything that is not a pass/fail assertion — a layout change, a fold, an axis — drive the running
container by hand:

```sh
owlab up && owlab sync
owlab open owrt2512            # then click the thing
owlab open owrt2410            # and again on the other package manager
```

### The routers are pre-populated, and that is what makes them useful

`owlab.yaml` sets `fixtures: [all]`, so each box comes up with seeded networks, clients, wireguard
peers, port forwards, system data and wireless config — the wireless pages render from UCI with
no radios present, and this theme has to style them.

It also adds a long `packages:` list on top of owlab's stock set, every entry prefixed with `+` so it
adds rather than replaces. That list **is the theme's test surface**: a stock router renders a
handful of menus, while the sections, tabs, tables and widgets that need styling live in the apps.
`curl` is deliberately absent — it is not in OpenWrt's default set, and installing it here would hide
the bug class `install.sh`'s `uclient-fetch` fallback exists for.

If a change needs a real kernel — not this theme's usual case — a router can be raised to
`fidelity: vm`, which runs it under QEMU instead of in a container.

### Proving it on hardware

No gate runs against hardware: `tools/lib/stands.mjs` enumerates owlab routers only. A hardware run
happens on the maintainer's explicit word for one change, never by reflex, and `dev-sync.sh` and
`ssh` are `ask` in `.claude/settings.json` so that word is given at the prompt.

1. Pre-check that the fallback exists, and record where the router is now:
   `ssh <host> 'ls -d /www/luci-static/bootstrap /usr/share/ucode/luci/template/themes/bootstrap/header.ut && uci get luci.main.mediaurlbase'`.
   Either path missing: stop. A broken template falls back to the first working theme in
   `luci.themes`, and with no bootstrap on the box there is nothing to fall back to.
2. `luci-theme-footstrap/dev-sync.sh <host>` — registers the theme, activates nothing, reloads rpcd
   (never restarts it) and busts the asset cache. It keeps no backup: the rollback is uci.
3. Sweep the templates the way LuCI will:
   `ssh <host> 'for f in /usr/share/ucode/luci/template/themes/footstrap/*.ut /usr/share/ucode/luci/template/themes/footstrap/partials/*.ut; do ucode -T -c -o /dev/null "$f" || echo FAIL $f; done'`.
4. `curl -s -o /dev/null -w '%{http_code}' http://<host>/cgi-bin/luci/` — 200 on the login page.
   Admin paths answer 403 unauthenticated and prove nothing; the pages are clicked by a person.
5. Rollback, if anything above fails or a page is wrong:
   `ssh <host> 'uci set luci.main.mediaurlbase=/luci-static/bootstrap; uci commit luci; rm -f /tmp/luci-indexcache*'`.

## Running everything CI runs, locally: `tools/ci-local.sh`

`.github/workflows/build.yml` is six jobs; nothing local ran the four beyond `check`/`lint`
(`build`, `verify`, `live`, `anchors`) until this script, so a red job there used to be the first
time anything here measured that half at all. `tools/ci-local.sh` runs the same commands, in the
same order, selectable per job or per slice:

```sh
tools/ci-local.sh --list                      # the job/slice map and what this cannot reproduce
tools/ci-local.sh check lint build            # the three jobs that never touch a router
tools/ci-local.sh verify                      # owlab test, both formats — safe with stands up
tools/ci-local.sh --mode push --force live    # all three live slices, THIS project's own stands
tools/ci-local.sh all --dry-run               # print every command either mode would run
```

`--mode pr|push` reproduces the exact split `build.yml` makes for `live`/`anchors`
(`ROUTERS=owrt2512`, `FULL=""` on a pull request; all three routers and `--full` on a push) —
`check`/`lint`/`build`/`verify` do not vary by mode. `verify` runs `owlab test`, which
synthesizes its own ephemeral router in a scratch directory and never touches the named stands,
so it is safe to run even while another session has `owrt2512`/`owrt2410`/`owrtsnap` to itself.
`live` and `anchors` are the opposite — they boot and install onto those SAME named stands — so
the script refuses to run them for real without `--force`, a deliberate echo of "Two live-audit
sweeps against the same stand fight over its language" below: this default exists because that
failure mode is measured, not hypothetical. `--dry-run` prints every command any job/slice would
run without touching a tool or a router, and works with no prerequisite on `PATH` at all.

**Every run — `--list` included — ends by naming what it did NOT reproduce and why**: the signed
`release`/`pages` jobs (no local copy of either secret key), the artifact upload/download between
`build` and everything downstream of it (substituted by one shared `dist/` on disk), job-level
`timeout-minutes` (unenforced locally), and the apt-get fallback branches inside `check`'s
gettext block and `ci-playwright.sh` (only exercised when the tool is actually missing, which it
was not on this host). A step this script cannot cover is printed as `SKIP` with a reason, never
folded into a passing count.

**This has to run from WSL, never from Git Bash on Windows** — the same host split
`docs/development.md` documents below for every other npm-run gate — invoked the way that
section's own recipe does, PATH set by hand inside the call. Node does not need installing under
WSL's own nvm the way that recipe assumes, either: this session found `npm`/`node` already staged
under the Windows install (`node_modules/.bin/*` carries an extensionless sh wrapper beside the
`.cmd`/`.ps1` ones), and that copy runs from WSL exactly as well as a native one once its `PATH`
is set — no `EFTYPE`/loader-hook workaround needed, because a REAL Linux `node` executing
`build-css.sh` through `execFileSync` is not the Windows-side failure that trap is about. `owlab`
and `owfeed` (`~/go/bin`, both already on this host at the CI-pinned versions, 0.6.1 and 0.5.1)
are ordinary Linux ELF binaries and need no such bridging at all. What genuinely needs installing
fresh is `node` itself if WSL has none of its own — this session used NodeSource's `setup_22.x`
to match `build.yml`'s pinned `node-version: '22'` exactly, a one-time `apt-get` cost, not a
per-run one.

**A variable ASSIGNED inside an inline `wsl.exe -- bash -c '…'` string reads back empty or
truncated, independent of and in addition to the `$?` trap already on this page.** Measured this
session, the same inline call every time: `x=$(echo hello); echo "$x"` printed nothing; so did
the far simpler `x=hello; echo "$x"`, with no command substitution involved at all; a function
DEFINED inline (`f(){ …; }; f`) failed to resolve. The exact same lines, saved to a file and run
as `wsl.exe -- bash /path/to/script.sh`, read back correctly every time — command substitution,
`$?`, and everything else this script depends on, all confirmed with a dedicated probe before
writing a line of `tools/ci-local.sh` around it. Treat this as one mechanism with the `$?` trap
below rather than two: neither survives an inline `bash -c` string, both survive a file, and
"write the script to a file and call `wsl.exe -- bash <path>.sh` instead of inlining it" (already
this page's advice for the `$R`/`$T` collapse) is the same fix for both.

## The stand's own traps

- **`owlab up` on a taken port fails ONE container and returns non-zero for the whole command.**
  Adding three stands on 2026-09-09, `owrt2512b` could not bind ssh 2235 — something else on this
  machine already listened there — so `up` printed `Bind for 0.0.0.0:2235 failed: port is already
  allocated` and exited 1, while the other two had started fine. The following `owlab sync` then
  synced those two and reported a failure for the third. Read the per-router lines, not the exit
  status: a partial success looks like a total failure and the reverse is equally possible. Check
  what is actually listening with `ss -ltn | grep :22` before choosing a port, and note that
  2222 and, on this host, 2235/2240/2241 are taken by things owlab does not own.

- **A stand rebuilt with `owlab up --rebuild` carries NO theme until `owlab sync`.** The gates do
  not say so: every cell prints `page.evaluate: NetworkError: HTTP error 404 while loading class
  file "/luci-static/resources/fs-prefs.js"` and the run **exits 0**. A sweep that measured nothing
  is indistinguishable from a clean one unless you read the lines. Always `owlab sync` after a
  rebuild, and treat a 404 in a cell as "the stand is empty", not as a finding.

- **Never pipe a long run into `tail`.** The output buffers until the command ends, so a hang looks
  exactly like progress. `live-audit` over a full sweep did this on 2026-09-09: the process sat
  alive and idle for 73 minutes with no output, where CI takes about 90 seconds a stand. Write to a
  file and read the file as it grows, and give any local `live-audit` both `--pages` and a
  `timeout`.

- **A variable assigned INSIDE an inline `wsl.exe -- bash -c '...'` string reads back empty.** This
  is separate from the `$?` trap below and bites the same way: the script looks like it ran and
  produced nothing. Write the script to a file and call `wsl.exe -- bash <path>.sh`.

- **`${PIPESTATUS[0]}` is as unreliable as `$?` in that shell.** On 2026-09-09 a piped
  `npm run check` reported `CHECK_EXIT=` and read as success while it had actually failed on the
  size budget; the failure was only caught by reading the gate's printed text. Judge every gate by
  what it printed, never by a status.

Every one of these cost a measurement that read as a regression in the theme. They are written down
because each was hit more than once.

**Two `live-audit` sweeps against the same stand fight over its language, and the result reads as a
theme regression that is really two processes racing.** `--lang` sets `luci.main.lang` for the whole
sweep and restores it on exit — safe against ONE sweep crashing, not against a SECOND sweep (or a
manual `uci set luci.main.lang=ru` for a side probe) touching the same router while the first is still
mid-flight: whichever write lands last wins for every page load after it, so a page fetched between
the two writes is measured in whichever language happened to be live at that instant, filed under
whichever key the confused sweep was running as. Measured directly (task 0162): a stray backgrounded
`live-audit` process from an earlier, abandoned launch attempt survived unnoticed alongside the real
one, both hammering `owrt2512`/`owrt2410` at once, and the English pass reported 19 "NEW" findings —
every one Russian dashboard text (`span.associations`, `span.encryption`) under the PLAIN `owrt2512`
key — because the stray process's own `--lang ru` write landed mid-sweep. `ps aux | grep live-audit`
before trusting a "NEW finding" that names text in the wrong language; a live-audit run is exclusive
use of whatever stand it names, the same as `--prune`'s own exclusive claim on the baseline file.

**On a Windows checkout, most npm-run gates fail before they measure anything, and the failure is
the host, not the theme.** Tell one apart from the other by re-running the SAME gate the SAME way
on a clean `HEAD` — a host fault fails there too, identically.

- `npm run lint:js`, `npm run lint:css` and other npm-script entry points fail outright: the
  packages under `node_modules/.bin` have no `.cmd` shim on this host. Call the binary directly
  instead of through npm: `node node_modules/eslint/bin/eslint.js <path>`,
  `node node_modules/stylelint/bin/stylelint.mjs "<glob>"`.
- Any gate that builds the sheet (`css-metrics`, `css-floor`, `table-contract`, `smoke`,
  `computed-diff`, `a11y`, `export-tier`) fails with `EFTYPE`: `tools/lib/css.mjs` runs
  `build-css.sh` through `execFileSync`, and Windows cannot execute a shell script directly.
  The workaround this session used is a `NODE_OPTIONS=--import` loader hook that intercepts the
  build call and re-issues it through `sh`, run from a copy of the tree in `../tmp/` so the checkout
  is never written to.
- `tools/computed-diff.mjs` additionally hands `tar -C` a `C:\…` path, which `tar` refuses — it
  needs a POSIX path.
- `python3` resolves to the Microsoft Store stub and fails with "Python was not found"; the working
  interpreter on this host is named `python` — matters for `python3 tools/audit.py --strict`.

**None of the above means the live half is out of reach — it runs fine, just not from the Windows
side of this checkout.** `owlab` is already installed in WSL (`~/go/bin/owlab`), its containers are
already up, and the full `npm run live` gate passes there against the very same tree, mounted at
`/mnt/c/...`. The recipe this session used for every WSL call:

```sh
MSYS_NO_PATHCONV=1 wsl.exe -- bash -c 'PATH=$HOME/go/bin:$HOME/.nvm/versions/node/v24.12.0/bin:/usr/local/bin:/usr/bin:/bin; export PATH; cd /mnt/c/Users/IVAN/Documents/home/openwrt/luci-theme-footstrap; <command>'
```

- `MSYS_NO_PATHCONV=1` is load-bearing: without it Git Bash rewrites the POSIX `/mnt/c/...` argument
  into a Windows-shaped path before `wsl.exe` ever sees it, and the `cd` fails with "No such file or
  directory" on a line that reads correctly.
- The `PATH=` has to be assigned by hand and kept short: the inherited Windows PATH carries spaces
  and parentheses (`Program Files`, `NVIDIA Corporation (x86)`), and `export PATH=<that>` inside
  `bash -c '...'` fails with `syntax error near unexpected token '('`.
- Node in WSL lives under nvm (`~/.nvm/versions/node/v24.12.0/bin`), which is not on PATH by
  default: leave it out and a live `node` on Windows still reads as `node: command not found`
  inside the WSL shell.
- The same recipe also clears the static gates that need a built sheet: `node tools/size-budget.mjs`
  run this way needs no loader-hook workaround at all, because `build-css.sh` executes normally
  under WSL's own `sh`.

Two traps sit in the calling convention itself, each cost a retry:

- shell variables inside `wsl.exe -- bash -c '...'` collapse to empty before `bash` ever starts —
  `$R`, `$T`, `$?` in the single-quoted string belong to Git Bash, not to WSL — so `> $T/gate-$n.log`
  turns into `> /gate--.log` and `cd $R/luci-theme-footstrap` into `cd /luci-theme-footstrap`. Write
  the script to a file and call `wsl.exe -- bash <path>.sh` instead of inlining it.
- **detaching through `tools/bg.sh` inside a one-shot `wsl.exe` call does not survive**: WSL tears
  the session down together with the process it was running, and the log is left with only its
  header — no `.status`, no `.pid`. It works only when the WSL session behind the run stays alive
  for the whole duration, not merely for the `wsl.exe` invocation that started it — which a session
  driven from Git Bash on Windows never gives it: every `wsl.exe` call from there is its own
  subprocess that returns and tears down, so the `setsid`-detached child dies with it the moment the
  call completes, before a T2 gate (`owlab`, docker, anything living in WSL) has had time to finish.
  Four T2 runs were lost to exactly this before the tester stopped routing them through `tools/bg.sh`
  from Git Bash and used the harness's own background runner instead — the Bash tool's
  `run_in_background: true`, which keeps the process (and the WSL session under it) alive for as
  long as the harness itself runs, paired with the Monitor/notification mechanism rather than
  `tools/bg-wait.sh`. Tell the two apart by the log: a `tools/bg.sh` run started this way stops dead
  at its header line with no `.status` file ever appearing, no matter how long `bg-wait.sh` is left
  polling it.

**`owlab.yaml`'s `extra_packages` under `defaults:` reaches every router, including the snapshot
box, and a package that box cannot resolve fails `owlab up` for the whole lab — not just the
missing package.** `defaults.extra_packages` merges additively onto whatever a router adds
(`internal/config/config.go` in owlab, no subtraction syntax), so there is no way to opt a router
OUT of a list declared in `defaults:`; the only lever is to not put it there. Reproduced 2026-09-07,
`owlab up --rebuild owrtsnap`: openclash and ssclash need `kmod-tun`, which resolves through a kmods
index keyed to the box's exact kernel git hash, and `downloads.openwrt.org/snapshots` was not
currently publishing kmods for the box's baked `6.18.33` hash — `apk add` 404s that index and both
apps fail to resolve, permanently, until the box's kernel and the live kmods feed happen to agree
again. justclash carries no kernel module and installed cleanly on the same box, which is why it was
never in the failure list — same feed, different dependency shape, not a fluke. `owlab up`'s
non-zero exit here is correct by design (`reportMissingExtras`, owfeed/owlab#18's sibling): it is
the config asking every router for packages one of them cannot ever have. Fix is in `owlab.yaml`
itself — declare the three apps once on a release router and alias the list onto the others, leaving
`owrtsnap` with none, rather than routing them through `defaults:`.

**An ordinary `packages:` entry can go missing on `owrtsnap` too, and it is not the kmod-tun
mechanism above even though the symptom looks the same — and the entry that goes missing is not
fixed, so do not name one here as if it were.** Task 0177: a `scroll-anchor` finding on
`owrtsnap @1440 side compact` traced to the Overview page rendering 12 `.cbi-section` there against
`owrt2512`'s 13 — `luci-app-https-dns-proxy` absent that day. `apk info -R` shows neither it nor its
`https-dns-proxy` binary needs a kernel module (`ca-bundle libc libcares libcurl4 libev jsonfilter
resolveip` only), which rules out the kmods-index gap; `/var/log/apk.log` from that boot instead
named the KMOD-needing packages failing (`luci-app-mwan3`, `-sqm`, `-nlbwmon`, `-openvpn`,
`luci-proto-wireguard`/`-openconnect` — the same `ERROR: unable to select packages` the kmods gap
produces) while `luci-app-https-dns-proxy` installed clean in that same run. By task 0178,
`https-dns-proxy` installed clean on every stand and `luci-app-mwan3` was the one missing instead
(no `90_mwan3.js`; the same `unable to select packages` line in `apk.log`, this time for `mwan3`,
`nlbwmon`, `openvpn` and `sqm` together). Two different names in two sessions IS the finding:
`feeds/luci` and `feeds/packages` build the snapshot index independently, and a `luci-app-*`/binary
pair that agrees on version when both are fresh can briefly disagree while one side has moved and
the other has not mirrored yet — the same class of drift as the kmods index, on an ordinary package
rather than a kernel module, and not reproducible on demand for that reason. Not fixed by a version
pin: `owlab.yaml`'s `packages:` list carries no version syntax, and pinning one would go stale as
the snapshot feed prunes old builds (a release branch keeps them for the branch's life; snapshot
does not). Check what is missing TODAY rather than trust a name in this paragraph: `apk info -e
<pkg>` for a `+luci-app-*` in `owlab.yaml`, or `grep 'unable to select' /var/log/apk.log`, on
`owrtsnap` — before treating a snapshot-only section-count or DOM-count difference as a theme
finding.

**`mangle-tokens.sh` fails on a `C:\...`-shaped path with `mv: cannot stat ...tmp.NNN`, and the gate
that surfaces it never mentions the script by name.** Like `build-css.sh`, it needs a POSIX path;
`tools/size-budget.mjs` calls it and inherits the failure as its own. A failed run also leaves
droppings in the checkout ROOT — files named like `C<...>cascade.css.tmp.248` — that have to be
removed by hand: `git clean` is not safe here, because the same root holds untracked files that are
wanted.

**A stand serves http only, so nothing about the login page's https hop can be measured on it as it
comes.** `uhttpd` has the certificate already; what is missing is the listener, and owlab publishes
port 80 alone — the https side is reached on the container's own address rather than through
localhost:

```sh
docker exec owlab-luci-theme-footstrap-owrt2512 sh -c \
	"uci set uhttpd.main.listen_https='0.0.0.0:443'; uci commit uhttpd; /etc/init.d/uhttpd restart"
docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' \
	owlab-luci-theme-footstrap-owrt2512      # -> curl -k https://<ip>/cgi-bin/luci
```

Put it back with `uci delete uhttpd.main.listen_https` — a stand left listening on 443 answers the
live gates on two schemes and one of them has a self-signed certificate. Comparing against stock is
`uci set luci.main.mediaurlbase='/luci-static/bootstrap'`, which needs no reinstall: the fallback
theme is already on the router (`uci-defaults`).

**A question gated on `/proc/mtd` or on the overlay mount line has no answer on a stand, and the
stand fails it silently — as a missing control, which reads as the theme having hidden one.**
luci-mod-system's flash page adds "Reset to defaults" only when `/proc/mtd` names `rootfs_data` or
`/proc/mounts` carries `overlayfs:/overlay / ` (`view/system/flash.js`), and both reads go through
`fs.trimmed()`, which is `L.resolveDefault(read(path), '')`: a missing file or a denied read
degrades to an empty string and the page renders complete, one control short, with no error. In a
container `/proc/mtd` does not exist and the root line reads `overlay / overlay …` from Docker's own
overlay2 driver, so the button is absent under footstrap AND under `/luci-static/bootstrap` — which
is the measurement that tells the two apart, and the one to run first. Feed the data rather than
trust the stand: intercept the ubus reply and re-read the DOM.

```js
// playwright, on the context: the endpoint is /ubus/, the body a batched JSON-RPC array
await ctx.route('**/ubus/**', async route => {
	const body = JSON.parse(route.request().postData() || '[]');
	const ids = new Set(body.filter(i => i.params?.[1] === 'file' && i.params?.[2] === 'read'
		&& i.params?.[3]?.path === '/proc/mounts').map(i => i.id));
	if (!ids.size) return route.continue();
	const response = await route.fetch(), json = await response.json();
	for (const i of json) if (ids.has(i.id) && typeof i.result?.[1]?.data === 'string')
		i.result[1].data += '\noverlayfs:/overlay / overlay rw,noatime,lowerdir=/,'
			+ 'upperdir=/overlay/upper,workdir=/overlay/work 0 0\n';
	await route.fulfill({ response, json });
});
```

**More than about ten unthrottled ubus calls in flight at once exhaust the stand's uhttpd, and
every request on the router then reports HTTP status 0 — which reads exactly like the outage the
probe was built to catch.** `uhttpd` on a stand runs with a small worker/connection pool (`-n 50`,
and far fewer in practice); a probe that fires a call every 8 ms without waiting for the previous
one to settle self-DoSes it, and 98% of its own samples fail regardless of what it was measuring.
`/etc/init.d/uhttpd restart` clears it. Tell the two apart by the base rate: a real rpcd window is
rare (~10% of reloads) and narrow (≤55 ms), a self-inflicted one is nearly every sample and does not
stop when the event under test does. Poll serially — re-fire the moment the previous call settles,
which is a natural 42–85 ms on this stand — rather than on a timer.

**A "does this style reach the page?" probe lies in three ways, and all three say the same thing:
the rule is fine and the measurement is not.** Verifying today's CSS on a live stand produced three
false negatives in a row. The theme's controls transition (`transition: box-shadow var(--fs-dur)`,
150 ms), so a computed style read immediately after `.focus()` samples the START of the animation —
`oklab(0 0 0 / 0) 0px 0px 0px 0px`, a transparent ring — and reads as "no ring applied"; wait past
the duration and it is `color(srgb 0.035 0.41 0.85 / 0.1) 0 0 0 3px`, exactly `--fs-focus-ring`. A
page's only native `<select>` is `display: none`, because LuCI replaces every CBI select with a
`.cbi-dropdown` widget, so focusing it measures nothing — mount a raw one, which is also what a
third-party app outside the CBI form does. And a modern Chromium aliases `-webkit-mask-image` onto
the standard property in the CSSOM, so `cssText` never shows the prefix: that check is textual,
against the built sheet, and cannot be done in a browser at all.

**Both stands run `data-layout="top"`, so a crawl that does not switch layouts measures none of the
sidebar.** The whole `[data-layout="sidebar"]` family — the open-submenu rules, the rail, the
narrow fold — renders on no page of a default sweep, and a coverage run reports every one of those
selectors as unmatched. It took a deliberate `localStorage['fs-layout'] = 'sidebar'` pass, and a
reload, to exercise them. Tell the two apart before believing any "unused" verdict: if the report
has no `[data-rail="true"]` hit either, the crawl never wore the layout rather than the rules being
dead.

**Playwright's session-wide JS coverage keeps only the documents that are still alive.**
`startJSCoverage({ resetOnNavigation: false })` across a crawl of eight pages returns the scripts of
the LAST one — eleven entries where sixteen modules had been loaded, with `fs-appearance`,
`fs-overview` and `fs-search` missing outright. It made `fs-router.navigate` (16,332 B, the largest
single block in the module) look dead when the crawl had simply never clicked anything: driving one
SPA click took that module from 55.4% to 89.2% executed. Start and stop the coverage around EACH
page and merge the byte maps yourself. The tell is a module count lower than the number of modules
the page actually loads.

**Some string literals are read out of the source by a gate, so hoisting one into a `const` breaks
the gate rather than the code.** `tools/axes.mjs` extracts the attribute names from the SOURCE of
`stampDark()` in `fs-prefs.js`, and `tools/page-modules.mjs` reads the `data-page` value out of
`fs-overview.js` the same way. Both were hoisted during a byte-saving pass; both gates then reported
a fault that did not exist — "the Appearance axes have drifted" and "nothing in it tests a data-page
value". The known members of this family are the `require …` loader pragmas, `@mirror`/`@endmirror`,
`/* fs:probe */`, the Makefile's buildroot marker, and now these two. `npm run check` catches them,
but it names the symptom, not the edit that caused it — so when a gate suddenly claims a drift
nobody introduced, look for a literal that moved.

**A layout fault can be invisible on one release line because that luci-base happens to mutate the
page, not because the theme is right.** The poll floor left on an outgoing tab pane (issue #75,
`docs/anchoring.md`) reproduces on 25.12 — 2432px of blank above System → Startup's textarea, for
the life of a page that never polls — and the same v0.14.6 build on the 24.10 stand cleared it
within 200 ms of the switch, some other mutation there having woken the sweep. A stand that is green
is evidence about that stand. What tells the two apart is measuring the mechanism rather than the
symptom: click a tab and read the floor off the pane the reader left, on each stand.

```sh
# after switching tabs, on any page with a tab strip
[...document.querySelectorAll('#view [data-tab-title]')]
  .filter(p => p.getAttribute('data-tab-active') !== 'true' && p.style.minHeight)
  .map(p => p.getAttribute('data-tab-title') + '=' + p.style.minHeight)      # must be []
```

**`Poll.start()` fires a tick synchronously, so a probe that hands the poll back poisons the probe
after it.** luci-base's `start()` sets the interval and then calls `step()` on the spot, which means
restoring the poll on the way out of one measurement drops a real tick into the beginning of the
next. `scroll-anchor`'s HOLD case did exactly that for two days: SWAP then measured the content
column's floor while a live tick was rewriting the sections under it, and CI reported `the content
column's floor is not holding the document up`, 120px, on webkit/owrt2410 @390 top compact. The
theme was not involved — the same cell is green at v0.14.2 and on every build without that change,
and the finding follows the PROBE across four runs. The stopped poll now stays stopped until QUIET,
the one case that wants ticks landing mid-flick, starts it. Tell this apart from a theme fault by
the shape: a floor finding that only CI sees, on a cell a local repeat cannot reproduce.

**LuCI keeps an EMPTY `.modal` in the DOM at all times, and a probe that trusts the class name alone
measures inside it.** `base/60-modal.css`'s host is rendered once per document and left behind,
zero-content, whenever no dialog is open; `document.querySelector('.modal')` finds THAT element on
every page that has never opened one, not the live dialog a page that HAS opened one is currently
showing. A probe built on the assumption "`.modal` exists only while a dialog is open" reports a
CLEAN SHEET everywhere — no overflow, no clipped text, no failing contrast — because it is reading a
hidden, childless box, not the modal's actual content. The second RU sweep (task 0147) hit this on
four pages in a row before the shape was named: every one of them "passed" a modal-content check that
had nothing to check. Tell the two apart before trusting a modal probe: check that the element is
actually visible (`getComputedStyle(el).display !== 'none'` and a non-zero `getBoundingClientRect()`)
AND that it has at least one child — an empty, hidden `.modal` clears neither.

**A hand-written replay of a probe is not the probe, and on the anchor sweep it was green six times
over a fault that was real.** Chasing `scroll-anchor`'s webkit finding, six standalone scripts
replayed what the gate does — the same park, the same HOLD, the same swap, the gate's own way of
picking its mark, the poll left running — and every one of them measured 0px while the gate went on
reporting -12px on that cell. What differed was never found, and looking for it cost more than the
fault did. Measure INSIDE the gate: copy `tools/scroll-anchor.mjs` into `../tmp/`, add an rAF
sampler that records `scrollY`, `fit.restAt()` and the theme's own reference, and print it from the
branch that raises the finding. That is what showed `_restAt` and `_rest.top` describing different
pages, which no replay reproduced.

**`owlab` can be absent from `PATH` while every stand is up.** The containers are started by
whatever ran `owlab up` last; the CLI lives with that runner, not with the checkout. Gates that
enumerate routers do it through `owlab status -json` (`tools/lib/stands.mjs`), so with the binary
missing they find no routers and SKIP — `install-check` says so out loud, the sweeps just measure
nothing. `docker ps --format '{{.Names}}\t{{.Ports}}'` tells them apart in one line: containers
running means the ports are there and only the CLI is gone. A shim that answers `status -json` with
those ports is enough to run any of them locally, and it belongs in `../tmp/`, never in the tree.

**Anchor findings that move between runs are the sweep measuring three routers at once.** Since the
stands were parallelised the same push has reported 8 findings, then 1, then a WebKit internal
error, with cells that skip in one run and measure in the next — the routers grow their own tables
under the probe. A finding is only a finding when the same cell repeats it: `--only <one stand>`
plus three passes, which is now a minute with `--width`/`--layout`. The ones that survived that test
were real; the ones that did not never reproduced alone.

**`docs/playground.html` draws Port status as STOCK, and that is the build's doing, not the theme's.**
The whole port reskin in `styles/pages/20-overview.css` is scoped to
`.ifacebox:has(img[src*="/port_"])`, and `tools/devkit-build.mjs` inlines every asset as a `data:`
URI on its way into the page — so the icon's `src` no longer contains `/port_`, not one of those
rules matches, and the tiles render as luci-mod-status shipped them: icon visible, name centred, zone
bar unplaced. Reading that as "the reskin regressed" is the trap; the tiles are correct on a router
and under `owlab`. Tell the two apart without leaving the browser — 0 on the playground, one per
port on a real page:

```js
document.querySelectorAll('#view .ifacebox:has(img[src*="/port_"])').length
```

Everything else on that page — System, Memory, Storage, Network, DHCP, Wireless — is faithful, so the
playground stays the cheap way to judge a card's typography. Only the port tiles are off.

**`RPC call to uci/get failed: Access denied` on arrival is LuCI's, not the theme's.** It is thrown
once, BEFORE the login form is submitted: `luci.js` asks for `uci get luci` with the all-zero session
id and rpcd refuses, which is what it is supposed to do. It reads as a regression because a
`pageerror` listener attached before the first navigation catches it and reports it against whatever
was being measured. Prove whose it is by splitting the capture at the login — the same error appears
on a stand carrying no local change:

```
before login: RPC call to uci/get failed with error -32002: Access denied
after  login: none
```

**A page-scoped rule is invisible to `computed-diff` and `a11y`.** Both gates load
`docs/gallery.html`, which carries no `body[data-page]`, so a rule written
`body[data-page="admin-status-overview"] …` matches nothing there: the diff reports 0 differences and
axe reports no violations, and neither has looked at the change. Green on such an edit means "not
measured", not "no effect" — take the reading off the playground or a stand, and compute any contrast
the rule introduces by hand. Measured this way for the Overview card restyle: `--fs-good` on
`--fs-panel2` is 4.59:1 at its worst (footstrap/dark) across all four palettes, both modes.

**`owlab sync` does not ship what a router gets.** It copies `htdocs/` and `ucode/` straight from the
checkout and builds `cascade.css` with `--dev`: no minifier, no pre-paint minifier, no template
strip, no token mangle, no PNG repack. Anything touching the build pipeline has to be measured on a
package — `./tools/stage.sh && owfeed build`, then install. The seam mangle is visible from the
browser: on a packaged build `getComputedStyle(document.documentElement).getPropertyValue('--fs-accent')`
comes back empty, because the name is `--aX` there.

**opkg does not reinstall a package whose version already matches.** `PKG_VERSION` is git-derived and
does not move between rebuilds of one commit, so on 24.10 `owlab install` answers
`… is up to date.` and leaves the previous files in place while apk reinstalls happily. Three rounds
of an anchor fix were measured on the OLD build this way. Prove the bytes arrived:

```sh
md5sum dist/root/www/luci-static/resources/fs-fit.js
owlab exec owrt2410 -- md5sum /www/luci-static/resources/fs-fit.js
```

When they differ, force it through docker — `owlab install` has no flag for it:

```sh
docker cp dist/all/*.ipk owlab-luci-theme-footstrap-owrt2410:/tmp/theme.ipk
docker exec owlab-luci-theme-footstrap-owrt2410 opkg install --force-reinstall /tmp/theme.ipk
```

**…and a forced install leaves the stand on stock bootstrap.** It runs postrm, which hands
`luci.main.mediaurlbase` to another theme exactly as [package.md](package.md) requires. The next gate
then measures bootstrap and reports the theme as broken — 78 findings on one anchor sweep, 156 on the
next, every one of them the wrong theme. Put it back:

```sh
owlab exec owrt2410 -- uci set luci.main.mediaurlbase=/luci-static/footstrap
owlab exec owrt2410 -- uci commit luci
```

**`owlab exec` eats short flags.** Everything after `--` still goes through owlab's own flag parser,
so `sh -c '…'` fails with `--config: stat n=0; for t in …` and `ucode -T -c -o /dev/null` fails with
`--config: stat -o`. stdin is not forwarded either. Put the script in the staged tree, sync it, and
run it by path: `owlab exec <stand> -- sh /www/_probe.sh`.

**`owlab test` fights the stands that are already up.** It synthesises its own router on host port
2222, and with stands running the bind fails — after it has already removed one of the existing
containers. Either take the stands down first, or assert the five `verify` things by hand on a
running stand. If you do it by hand, log IN: an unauthenticated `curl` answers 403 and proves
nothing.

**`owlab up` can fail to rebuild the full five-router set, and the failure looks like the theme's
containers are gone.** The 24.10 leg dies in the image build on opkg index drift:

```
opkg_install_pkg: Checksum or size mismatch for package bash
target owrt2410: failed to solve: … exit code: 255
```

Docker's build cancels the ImmortalWrt and snapshot legs the moment that one fails, so one stale
index entry takes down a run that was asked to rebuild all five. **Do not take the running stands
down while `up` is broken this way** — a `--rebuild` or a plain `up` that fails partway may not
hand them back, and there is no volume to recover from. The way round it, used for the 0.14.10
pre-tag matrix: `owlab test --release <version> --install <artifact> --assert …` synthesises its
own router and reads no `owlab.yaml`, so it needs no image rebuild at all. Run it from a scratch
directory rather than the checkout — the containers are named after the cwd, so this also keeps it
from colliding with (or replacing) the project's own stands:

```sh
mkdir -p ../tmp/owlab-test-pretag && cd ../tmp/owlab-test-pretag
owlab test --release 25.12.4 --install '/path/to/dist/noarch/luci-theme-footstrap-*.apk' --assert …
```

**Reset the syslog BEFORE a live run, not after it reports.**
`/admin/services/banip/processing_log` prints the system log as page content, so the page grows with
every install, sync and `rpcd reload` done while working — a long session manufactures its own
findings (309 lines gave 3, one line gave none). Treating that as something to diagnose afterwards
costs a full re-run each time; it cost three in one session here. Put it in the run instead:

```sh
for c in owrt2512 owrt2410 owrtsnap; do
    docker exec owlab-luci-theme-footstrap-$c /etc/init.d/log restart
done
```

`/admin/services/acme/logread` has a `textarea` with no accessible name in 25.12's app; 24.10 does
not render it at all.

**A live gate that says "no owlab router is running" may be looking at the wrong PATH.** Every one
of them shells out to `owlab status -json` (`tools/lib/stands.mjs`) and treats a failed spawn as
an empty router list, so a shell that cannot see `owlab` — `go install` puts it in `~/go/bin`,
which a login shell exports and `tools/bg.sh` does not — reports exit 2 and measures nothing,
with four containers up. The two apart: `docker ps` lists the stands while `owlab status -json`
fails. Export the path into the detached command itself:
`tools/bg.sh sh -c 'export PATH=$HOME/go/bin:$PATH; node tools/live-audit.mjs'`.

**A live gate killed by a timeout reports a browser bug, not a finding.** `page.waitForTimeout:
Target page, context or browser has been closed` with an empty `log: []` is the gate being
SIGTERMed mid-run — `live-audit` over two routers is 113 page renders and does not fit in five
minutes. The two apart: a real finding prints `path|width|kind|element` lines and a count; a
killed run prints a Playwright stack. Never re-run it with a bigger timeout — that is what T2
means: `tools/bg.sh`, report the run-id, and pair it with a waiter (below).

**A detached run needs a waiter, or it is a run nobody reads.** `tools/bg.sh` calls `setsid`: the
process outlives the shell that started it and nothing announces its end. The log and a `.status`
file next to it are the whole interface, and `.status` appears only when the run is over — which
makes "is it done?" a question you have to keep asking, and therefore one that gets forgotten. It
was forgotten three times in a single session here, twice while somebody was waiting on the answer,
each time for 15-30 minutes after the chain had already finished.

Start the waiter in the same turn as the run, as a background command, so finishing wakes you
instead of you polling it:

```sh
tools/bg.sh sh -c '…'            # prints run-id and log path
tools/bg-wait.sh <run-id>        # blocks until .status exists, prints `exit: N` and the `name:` lines
```

The waiter costs nothing while the run is going and turns the result into an event. A run whose log
nobody opened is not a green gate — that rule is older than this note; the waiter is what makes it
practical to honour.

It stops on three things rather than one: the `.status` file, the run's own pid disappearing
(`<run-id>.pid`, written by the inner shell — a run killed by SIGKILL, by a reboot or by the
machine sleeping never writes a status, and waiting for that file alone waits forever), and a cap,
`tools/bg-wait.sh <run-id> [interval] [max]`, 7200 s by default. The last two print
`exit: process-gone` and `exit: timeout` and exit 2: a waiter still alive when the session ends
wakes it later with a verdict nobody asked for.

**`tools/bg.sh` refuses `ssh`, `scp`, `sftp`, `rsync`, `dev-sync.sh`, `git push`, `git commit`,
`git tag` and `gh pr|release|issue`.** The wrapper is allow-listed in `.claude/settings.json` and
the permission engine matches the first word of a command, so it cannot see an `ssh` inside
`tools/bg.sh sh -c '…'` — the form every T2 gate uses — and the wrapper would carry that command
straight past the `ask` rule guarding the hardware router, the one thing a wrong run breaks for a
person. Those commands run in the foreground, where the prompt reaches the human.

**"It is the app's markup" is a claim, and switching the stand to bootstrap is how you check it.**
A finding on a third-party page reads as the app's, and the reflex is to write it into the baseline.
Point the stand at the stock theme instead, re-measure the same page at the same width, and compare:

```sh
owlab exec owrt2512 -- uci set luci.main.mediaurlbase=/luci-static/bootstrap
owlab exec owrt2512 -- uci commit luci                 # …and put it back afterwards
```

Three `overflow` findings on `ssclash/config` at 320 looked like the app's split button, which is an
`inline-flex` the app styles inline — and the theme sets no width on it at all. Under bootstrap the
same page overflowed by nothing: the wrapper takes its buttons' max-content, and this theme's
buttons are 295px where stock's are 245, its face being wider than the system stack even at a
smaller size. The finding was ours. A baseline entry would have hidden it for good, which is what
makes the ratchet worth only as much as the judgement behind each line.

**A `<style>` injected into a live page is eaten by the theme's own fence.** Playwright's
`addStyleTag` appends a `<style>` to `<head>`; `fs-sheets.js` observes that, re-hosts it into
`@layer theme` and scopes its selectors to the current view. A rule aimed at the chrome then matches
nothing and its `!important` has nothing left to win, so the screenshot is byte-identical to the one
without the rule — a silent zero that reads as "the effect is invisible". Three PNGs shot this way
shared one sha256. Inject through a constructed sheet instead, which is not a DOM node and is not
observed:

```js
const s = new CSSStyleSheet(); s.replaceSync('* { box-shadow: none !important }');
document.adoptedStyleSheets = [...document.adoptedStyleSheets, s];
```

Whichever way it goes in, read the property back with `getComputedStyle` in the same evaluate and
print it beside the measurement: `blur(12px)` turning into `none` is what proves the variant is a
variant. A control that changes something obvious — a transparent bar — separates a broken injection
from an effect that genuinely does not show.

**Playwright's JS coverage does not accumulate across page loads, whatever `resetOnNavigation`
says.** `startJSCoverage({ resetOnNavigation: false })` around a fifteen-page run and one
`stopJSCoverage()` at the end returns the LAST document only — measured, 30 entries with `fs-fit.js`
appearing once after fifteen full loads, and `fs-axes`, `fs-assets`, `fs-appearance`, `fs-overview`
absent entirely because the last page does not load them. Every "never ran" number taken that way is
an artefact. Start and stop the coverage around EACH scenario and merge outside the browser, keyed
on `file|functionName|startOffset`, counting a function as live when any scenario ran it: the same
run then reports `fs-sheets` at 3 dead functions rather than 27.

Three things make a coverage sweep of this theme lie even when the merge is right, and each cost a
pass:

- **The stands run `data-layout="top"`.** `fitShell()` returns before `shellGeometry()` in that
  layout, so the whole sidebar branch reads as dead. Set `fs-layout` to `sidebar` in a scenario of
  its own.
- **The Appearance panel is its own page now** (`/admin/system/footstrap`) — before it had a route
  it was a tab INSIDE the System page, whose own selects came first in document order, and
  `page.$$('select')` picked Log level and Language while the axes went untouched. The page still
  has selects of its own (Layout, Theme, Palette, …), so find the row by its label rather than
  position — and the labels are translated, so match the rendered text, not the English source
  string.
- **A branch can be unreachable by engine, not by code.** `fs-fit.js` takes the non-anchoring path
  only where the engine does not anchor; `localStorage.fsEngineAnchor = 'off'` is the switch that
  reaches it from Chromium.

**When a live gate goes red, build the PARENT COMMIT.** Package it, install it the same way, run the
same narrowed check. A finding that reproduces there did not come from the change under test. That is
how the anchor regression in 0.14.3 was pinned to one commit out of thirty-seven, and how both
findings above were shown to belong to their apps.

**`owlab up` alone leaves `luci.main.mediaurlbase` at `/luci-static/bootstrap` on both stands, so a
probe run right after boot silently measures the STOCK theme instead of this one.** `up` only starts
the containers; it is `owlab sync <stand>` that installs the package and points the router at it. A
task-0145 probe run straight after `owlab up` reproduced nothing because the pill it was reading was
`/luci-static/bootstrap`'s own, unmodified by anything in this tree. `owlab exec <stand> -- uci get
luci.main.mediaurlbase` tells the two apart: `/luci-static/bootstrap` means sync never ran (or the
value was reset for a stock-vs-theme comparison and never put back), `/luci-static/footstrap` means
the stand is actually measuring this theme.

**A mouse click parks focus and re-seats sequential navigation, so a probe that clicks before
pressing Tab reports the skip link unreachable.** Whatever the click landed on becomes
`document.activeElement`, and every Tab after it walks the sequence relative to THAT element, not
from the top of the document — a click anywhere past the skip link in tab order puts it behind
everything the click already skipped. Start the walk from the document, not from a click:

```js
document.activeElement.tagName   // 'BODY' right after a fresh load — Tab from here reaches
                                  // the skip link first; anything else means a click already moved it
```

**Collapsed submenus carry an ordinary computed `display` on their links while the parent `ul` is
`display: none`, so a probe reading `getComputedStyle(link).display` sees them as laid out.** The
`display: none` sits on the ancestor `ul`, not on each `<a>`, and `getComputedStyle` answers only for
the element it is asked about — a collapsed link can read `display: flex` and still have a zero
rect. Filter on the box, not the property: `link.getClientRects().length` is `0` for every element
inside a `display: none` ancestor regardless of what its own `display` says.

**`$?` is unreliable in this WSL bash** — `false; echo $?` prints `0`. What sits between the two
commands was not isolated this session; the workaround is not diagnosing it. Read each tool's own
printed verdict instead — PASS/FAIL text, a finding count, `bg-wait.sh`'s own `exit: N` line — never
the shell's exit code after the fact. This is the worst trap on this page because it fails
*silently*: a chain that trusts `$?` reports a red gate as green with nothing in the log to say so.

**On System → System, `button.cbi-button-apply` selects "Скопир. из браузера" (Copy from browser),
not the Apply-changes control.** The page renders more than one element carrying that class, and the
Apply control itself is a `.cbi-dropdown` widget, not a `<button>`: the selector that actually reaches
it is `.cbi-page-actions .cbi-dropdown.cbi-button-apply li[data-value="0"]`. A repro battery keyed on
the bare class name clicked the wrong element on every run and reported NOT REPRODUCED for a fault
that was real.

**`npm`, `python3` and any `*.sh` gate cannot run from the Windows side of this checkout at all** —
not merely degraded the way the `.cmd`-shim and `EFTYPE` notes above describe. `npm run smoke` dies
with `EFTYPE: spawnSync … build-css.sh`, and `sh tools/check-acl.sh` resolves `python3` mid-script to
the Microsoft Store alias. Run these under WSL, with node put on `PATH` by hand — a non-login
`bash -c` never sources nvm's shim on its own:

```sh
export PATH="$HOME/.nvm/versions/node/v24.12.0/bin:$PATH"
```

**A leftover `dist/` in the checkout can be labelled with a version it is not, and a size comparison
against it moves in the wrong direction.** A leftovers audit found one stamped `0.14.11-r1` that
built to 69,945 B / 73,649 B (CSS/JS) against the tag's true 69,475 B / 73,186 B — a stale artefact
from a run that never got a clean rebuild after later commits landed, still carrying the old
package's name. Comparing a new change against that directory would have read as the package
shrinking when it was in fact growing. The reliable baseline is a fresh build from the tag itself,
not whatever is sitting in `dist/`:

```sh
git archive <tag> | tar -x -C /clean/checkout && (cd /clean/checkout && ./tools/stage.sh)
```

**A dead feed no longer reds `owrtsnap`'s boot — owlab 0.6.1 made the refresh partial instead of
fatal, closing the trap this note used to teach around.** Through owlab 0.5.3, stage-3 opened
`apk update`/`opkg update` under a bare `set -eu`, so one unreachable feed took the whole install
down before owlab's own per-package loop — already tolerant of a package missing from a feed — got a
turn; the snapshot rootfs pins its kmods index to a kernel hash the feed's retention window keeps only
a handful of, so an image a few weeks old 404s on that one sub-index on every run with no code change
involved (owfeed/owlab#18, closed within the hour; `live`/`anchors` had carried a containment for it,
`live-snapshot`, `continue-on-error` and absent from `release`'s `needs`, task 0172/0173). `owlab`
0.6.1's `internal/pkgmgr.UpdateShell` now continues the refresh once at least one feed has answered
and only aborts when none has — reproduced locally (`owlab up owrtsnap`, `owlab install owrtsnap
dist/noarch/luci-theme-footstrap-*.apk`, task 0173) against a freshly downloaded `owlab 0.6.1`
binary, not the WSL install's drifted dev build: the identical 404 still prints
(`ERROR: wget: exited with error 8` / `unexpected end of file` on
`kmods/6.18.33-1-70e27cfe28d8cb55760256504e7c02fe/packages.adb`), but the router boots and the
package installs anyway, and the log now names the gap rather than staying silent about it —
`owlab: apk update: partial refresh, 7 feed(s) read, 10206 packages available; the feed above did
not answer and its packages will be missing`. `owrtsnap` is back in `live`/`anchors` and
`live-snapshot` is gone; what is worth knowing going forward is the shape of that line in a log, not
how to survive its absence.

**`install.sh` carried the identical trap one layer down, and "packages available > 0" turned out
not to be the signal that separates a partial refresh from a total one.** Task 0175, run 34112646188:
`install-check` red on `owrtsnap` at `apk update`, same dead kmods sub-index as above, but this time
inside the installer's own `set -e`, which had no per-package loop after it to absorb the exit —
every install on that stand died before the theme was ever fetched. The obvious fix (treat apk's
own "N unavailable, M stale; K distinct packages available" line as fine whenever K > 0) is wrong:
with every feed unreachable, apk still printed `8 unavailable, 0 stale; 136 distinct packages
available` and exited non-zero — those 136 are rows already in the **installed** database, not
anything the refresh just read, so K is nonzero on a total failure too. What actually separates the
two is the `N unavailable` count against how many feeds were **configured** to begin with (counted
from `/etc/apk/repositories` + `/etc/apk/repositories.d/*.list`): `N < configured` means at least one
feed answered, `N == configured` means none did. opkg prints no such summary line and is affected
identically (exit 1 with one bad feed of eight on 24.10.8, exit 7 with the network cut), so the same
comparison is drawn there by counting `Failed to download` lines against the configured
`distfeeds.conf`/`customfeeds.conf` entries instead. Neither manager's own exit code decides this in
either implementation — `install.sh`'s `feed_refresh()`.

**That tolerance turned out to be too even-handed: a security review (task 0176) found it let this
project's OWN feed, `repo.owfeed.org`, be the one silently skipped.** `repo.owfeed.org` is a distinct
host from every stock OpenWrt feed, so an on-path/DNS attacker can blackhole it alone while the rest
answer — `_bad < _total`, the old code returned 0, and the script went on to install whatever
owfeed-packages index apk/opkg already had cached from a prior run while printing "[+] Installed …".
Reproduced live rather than argued: on `owrt2512` (9 configured feeds) with a `127.0.0.1
repo.owfeed.org` `/etc/hosts` entry and the 8 stock feeds left open, `apk update` itself reported the
router's cached copy as merely `stale` (`0 unavailable, 1 stale; 11286 distinct packages available`,
exit 1) — a shape the OLD counter never even tolerated (`_bad` reads 0, not 1, so the pre-fix code
already fell through to the generic failure here) but a fresh-index router would read as `unavailable`
and the old code WOULD tolerate. `feed_refresh()` now checks, before the tolerance, whether `$FEED_HOST`
— the literal string this same script writes into the repository line a few lines below, not
`$FEED_NAME` or any label an admin could rename — appears in a failure line (apk: `ERROR:`/`WARNING:`;
opkg: `Failed to download`, both of which print the full failing URL in real router output, confirmed
on both managers below). If it does, the refresh fails closed with a message naming this project's own
feed specifically, regardless of how many other feeds answered. Verified on live stands, all four
shapes: `owrtsnap`'s real dead kmods sub-index (unrelated host) still tolerates and installs, unchanged
from the paragraph above; `owrt2512` (apk) and `owrt2410` (opkg) with `repo.owfeed.org` blocked and
every stock feed open now fail closed with `` `apk/opkg update` could not reach https://repo.owfeed.org
— this project's own feed`` and install nothing, where the old code's tolerance would have gone on to
`apk add`/`opkg install` against a stale cache; both routers with every feed healthy install clean, no
warning; `owrt2512` fully disconnected from its docker network still fails the way it always did,
naming the unreachable host and refusing rather than claiming success.

**A verification trap worth naming for the next session: opkg's OWN counting is looser than apk's, in
the other direction.** Blocking `downloads.openwrt.org` (the host behind all 7 of `owrt2410`'s stock
feeds, `/etc/opkg/distfeeds.conf`) while `repo.owfeed.org` stayed open made `feed_refresh()`'s pre-fix
`_bad` counter read 14 against 8 configured — opkg logs each unreachable feed on TWO lines that both
match the substring `Failed to download` (`*** Failed to download the package list from <url>` and
` * opkg_download: Failed to download <url>, wget returned N.`), so `grep -c 'Failed to download'`
double-counts every failure. `_bad >= _total` therefore reads as "none answered" even when most did,
and the refresh fails closed rather than tolerating — safe (it never installs from a worse index than
it would otherwise refuse), but it makes opkg's tolerance narrower than the comment above claims and
narrower than apk's, which reads its own reported `N unavailable` count rather than grepping its log.
Not this task's fix (`install.sh`'s boundary here is the own-feed decision alone, not the general
counting shape) — flagged for whoever next touches `feed_refresh()`'s opkg branch.

**Installing npm packages from WSL instead of from Windows leaves every gate looking broken, when
only the install is.** An install run from WSL writes `node_modules/.bin/` as POSIX symlinks
(`eslint@ -> ../eslint/bin/eslint.js`), which Windows cannot execute — every `npm run <gate>` from
Git Bash then dies with `'eslint' is not recognized as an internal or external command`, and the git
`pre-push` hook fails the same way, reading exactly like a red gate rather than a bad install.
Installed from Windows instead, npm writes three wrappers per package (`eslint`, `eslint.cmd`,
`eslint.ps1`), and the extensionless one is a sh script WSL can run too — one install serves both
sides. The install itself has to be invoked as `node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js"
ci --ignore-scripts` from Git Bash: `cmd.exe /c npm ci` from Git Bash silently does nothing (MSYS
rewrites `/c` into a path before `cmd.exe` ever sees it), and PowerShell refuses `npm` outright (next
trap). `--ignore-scripts` is deliberate — the browsers the gates need live in WSL, and a second
Windows-side copy is a few hundred MB nobody runs. Verified this session: `npm run lint` passes from
both Git Bash and WSL off one Windows-side install.

**A fresh Windows-side `npm ci` needs `chmod +x node_modules/.bin/*` from WSL before WSL can run any
of it, and the fix does not survive the next install.** `/mnt/c` on this machine mounts
`metadata,umask=0077,fmask=0177` (`/etc/wsl.conf`), so every file npm just wrote from Windows arrives
world-unexecutable — the sh wrappers the trap above depends on are present and correct, but
`npm run lint` inside WSL still dies, this time with `sh: 1: eslint: Permission denied`. Because
`metadata` is on, one `chmod` sticks across reboots — but not across a fresh `npm ci`, which writes
new files under the mount's default mode again. Diagnose with `ls -l node_modules/.bin/eslint` (mode
`0600` is the trap) and `mount | grep " /mnt/c "` (confirms the `fmask`).

**PowerShell is not a fallback for the symlink trap above — `npm` does not run there at all on this
machine.** `npm.ps1 cannot be loaded because running scripts is disabled on this system` is
PowerShell's own execution policy refusing the wrapper script outright, unrelated to the WSL symlink
issue and not fixed by installing from the "right" side. Git Bash and `cmd` (called directly, not
through `cmd.exe /c` from Git Bash) are unaffected.

**`${PIPESTATUS[0]}` reads back empty in this WSL bash, the same way `$?` is already unreliable here
— and it fails silently, not loudly.** A piped `npm run check | tee log.txt; echo
"CHECK_EXIT=${PIPESTATUS[0]}"` printed `CHECK_EXIT=` — empty, not a number — and the empty string
read as "not the literal failure text" to whatever was watching it, while the run had actually
failed on the size budget. The gate's own printed output was the only place the failure showed.
Judge a WSL gate by what it printed, never by a captured status of any kind — `$?`, `PIPESTATUS`, or
otherwise.

**A `geometry|fs-content` finding whose offset equals the gap between two adjacent entries in the
gate's own `WIDTHS` is a staleness race, not a layout break — re-sample at 620 ms before believing
it.** `live-audit` samples `contentWidth()` at 220 ms after each `setViewportSize`; `fitChrome()`
steps aside for the whole `SCROLL_IDLE` window (400 ms, `fs-fit.js`) whenever `fit.scrolling()`
answers yes, and a resize starts that window too, so a sample taken inside it reads the PREVIOUS
width, not the one the gate just set. Task staleouter: `owrt2410 /admin/status/vnstat2/config | 568
| geometry | fs-content (-178)` — `-178` is exactly `568 - 390`, the gap between those two widths in
`live-audit`'s own list, and the same shape held at every step (`-70` at 320→390, `-256` at
1024→1440). Confirmed with `probe2.mjs`/`probe3.mjs` (`../tmp/task-vnstat/`): `model=358 real=536
scrolling=true` at 220 ms, `off=0` once resampled past 620 ms. Fixed in `fs-chrome.js`'s
`contentWidth()`, which now re-reads the window's width on every call rather than trusting the last
fitter's cache (`docs/chrome.md`, "`data-narrow`: ..."); do not "fix" a live recurrence of this shape
by making the gate sample later instead — that would hide the same staleness from a real reader.

## The test matrix

- **Pages**: Status/Overview (tables, ifacebox), Network/Interfaces (zonebadge, modals),
  Network/Firewall (section table, dropdown), System/Software (progress), Realtime graphs (SVG),
  login/logout, Reboot. Plus the apply/rollback confirmation sheet, which `ui.js` draws over the
  theme and which custom z-indexes often break.
- **Modes**: light/dark/auto, both layouts, all three palettes, a narrow window, long hostnames and SSIDs.
- **There are no breakpoints for "does it fit" — it is a MEASUREMENT.** Drag the window with the
  mouse; do not test specific widths. Why: [chrome.md](chrome.md).

## Building a package locally

```sh
./tools/stage.sh && owfeed build     # both formats, seconds, no toolchain
```

That is exactly what CI does. `luci-theme-footstrap/build-apk.sh` is a different path — a build
through the OpenWrt SDK, which exists to prove the theme is still buildable by its Makefile,
`luci.mk` and jsmin for someone who has never heard of owfeed. Releases do not come out of it. Both
are described in [ci.md](ci.md).

Through owlab:

```sh
owlab build                       # target taken from the first router in owlab.yaml
owlab build --arch x86_64 --release 25.12.4
owlab install owrt2512 dist/luci-theme-footstrap-*.apk
owlab exec owrt2512 -- 'apk del luci-theme-footstrap'
```

An SDK build is not the same as `sync`, and the difference is measurable: a real build runs the
sources through the minifiers, so code that works unminified and breaks minified is invisible until
you build a package. Without that step, the first person to see it is a user.

On Apple Silicon this runs under emulation — every `openwrt/sdk` tag is `linux/amd64`. owlab warns
before it starts.
