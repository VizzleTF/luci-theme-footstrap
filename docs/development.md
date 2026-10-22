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

`owfeed` and `owlab` here follow the refs in `.github/workflows/build.yml`, which are the only pin
(0.5.5 and 0.6.6 at the time of writing; `owfeed version`, `owlab version`). A release binary from
GitHub, checked with `gh attestation verify <file> -R owfeed/<tool>` and its `SHA256SUMS`, replaces
the one in `~/go/bin`; `@latest` can run ahead of CI. The traps below name the owlab version they
were measured on.

## The dev stand

Brought up by [owlab](https://github.com/owfeed/owlab) from `owlab.yaml` in the repo root, which is
the current count and list of routers — read it rather than a number here. The two that matter for
an ordinary change are the package-manager pair:

| id | distro | release | manager | LuCI |
|---|---|---|---|---|
| `owrt2512` | OpenWrt | 25.12.4 | apk | http://localhost:8025 |
| `owrt2410` | OpenWrt | 24.10.8 | opkg | http://localhost:8024 |

`owlab.yaml` also carries `owrtsnap` (tracks luci-base's master), parallel-measurement twins of the
three OpenWrt lines (`-b`, `-d`), and — on demand only, not booted by default — two ImmortalWrt
stands: [ImmortalWrt stands (on demand)](#immortalwrt-stands-on-demand).

```sh
owlab up                 # build and start every router owlab.yaml defines
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

### ImmortalWrt stands (on demand)

`imm2512`/`imm2410` are not a default-boot stand and carry no opt-in flag or profile in owlab's own
config schema (`owlab up --help`) — the only way to
boot them is to give owlab a `routers:` entry to read. They are not a gate target either
(`tools/lib/stands.mjs`'s `CORE`) and answer a question about the ImmortalWrt brand, never a
behaviour claim (`owlab.yaml`, the "second instances" comment). Bring one up only when that question is
the one being asked: paste both blocks back under `routers:` in `owlab.yaml` (they resolve
`*third_party_apps` from the anchor already defined on `owrt2512` there), then

```sh
owlab up imm2512 imm2410
```

and once done, `owlab down imm2512 imm2410` first, then remove the pasted blocks (owlab names a
router only by an id it can read in `owlab.yaml`).

```yaml
  - id: imm2512
    distro: immortalwrt
    release: "25.12.1"
    ports: { http: 8026, ssh: 2226 }
    extra_packages: *third_party_apps

  - id: imm2410
    distro: immortalwrt
    release: "24.10.6"
    ports: { http: 8027, ssh: 2227 }
    extra_packages: *third_party_apps
```

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

What `sync` does not do: stamp `FS_VERSION` (System → Footstrap shows `dev`) and compile
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
npm test                       # node --test, no browser and no stand; 39.8 s for 939 tests on CI (run 39487715282, 2026-10-20), 14 s for 1022 locally (2026-10-21)
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
npm run smoke            # ~2.1 s: the modules come up in a real DOM, the axes stamp in order
sh tools/stage.sh && npm run smoke -- --staged
                         # ~2.5 s: the same on the minified, mangled tree a router gets
npm run computed-diff    # ~8.7 s, six passes: worktree vs HEAD, the shipped sheet,
                         # getComputedStyle over every element and its ::before/::after
npm run computed-diff -- --control    # the same sheet twice; must be 0
```

`smoke` evaluates `fs-fit`, `fs-prefs`, `fs-axes`, `fs-version`, `fs-assets`, `fs-select`, `fs-chrome`, `fs-router` and `fs-appearance` the way
luci.js does — the prologue's `'require x as y'` pragmas become the factory's parameters, one copy
of that derivation shared with `tests/lib/luci-module.mjs` — and then watches each colour axis write
`--fs-<x>-h` before `data-<x>`. What it adds over `npm test` is the box: the unit suite's window and
document RECORD calls rather than answer them, so a module that throws the first time it measures
something passes there and fails on a router. Proven to bite: inverting the two writes in
`fs-axes.js` turns five checks red. Its export-contract check exists because `fs-appearance.js` once
called `axes.currentContentWidth()` while `fs-axes.js` exported no such name: `build()` threw inside
the one try/catch `mount()` wraps it in, the "Footstrap" section vanished from System, and every
gate stayed green.

`smoke --staged` runs the same checks on the tree `tools/stage.sh` leaves in `dist/` (`$DIST`): the
uglify-js-minified, token-mangled `fs-*.js` and `header.ut`, against the shipped sheet from a fresh
`mangle-tokens.sh` run, whose map names the axis properties (`--fs-tint-h` is `--aJ` there) and
renames the gallery's own `var(--fs-bg)` the same way. `smoke` alone loads the source tree, so a
minifier change reached no real DOM before. The export-contract check stays on the source, since it
reads names; `fenceRules` is a `/* fs:probe */` export the stage strips, so there the check asserts
it is absent. A stage whose `cascade.css` differs from that fresh build fails on the byte compare
(re-run `sh tools/stage.sh`, not `--dev`); no stage exits 2. Proven to bite, on a scratch copy of
`dist/`: `fs-axes.js` cut at half fails with `threw at eval — missing ) after argument list`, and
its `"require fs-prefs as prefs"` pragma dropped with `prefs is not defined`; the source-tree run
reads 0 failures on the second.

`computed-diff` builds the stylesheet at `HEAD` with `git archive` (so an uncommitted edit cannot
leak into the BEFORE side) and runs BOTH sides through the steps the package does: `build-css.sh`,
then that tree's own `mangle-tokens.sh` (`buildCss({ shipped: true })` in `tools/lib/css.mjs`, the
one copy of the pipeline). Router bytes are the mangled sheet, 115,927 B against the readable
134,210 B, and a gate that measured the readable one could not see a fault in either step:
`mangle-tokens.sh` dropping the first `}` of its output reads 0 differences there and 22,812 here
(five of the six passes at the 4,000 cap).

**Each side is its own document**, loaded from its own server, not one document with the `<link>`
swapped. The two sheets can map the private tokens differently (the map is sorted by use count), and
the gallery's own unlayered `body { color: var(--fs-text) }` is renamed with its sheet's map, so one
document under two maps would read another token under the second. Its floor is 0, and three
measurements held it there: every finite animation is awaited, because a `span.cbi-tooltip` fade was
caught at `opacity 0.00245647` by one snapshot and finished by the other; every infinite one is
frozen at frame 0, because the 13 `.spinning` buttons turn their `::before` and two loads read it at
two angles (13 phantom `transform` differences a pass); and, while the sheet was swapped on one
document, the reference had to be swapped onto ITSELF first, since a colour from a sheet parsed with
the document serialised `oklab(…)` and from one attached later `color(srgb …)` (28 phantom
differences in light). Wall time is ~8.7 s (`--full` ~26 s).

**It reads `::before` and `::after` too**: a row of every property for each one whose `content` is
not `none` (105 in the gallery, against 1,129 elements), and a pseudo-element only one side
generates is one `content` difference. Glyphs, chevrons, switch knobs and the poll mask live there.
Deleting `.cbi-progressbar::after` reads 66 (11 a pass) and 0 on the element-only gate.
`vertical-align`, `mask-image` and `-webkit-mask-image` joined the list: deleting the switch's
`vertical-align: middle` (inert on a flex item, since removed) read 42 (7 a pass), and editing the
`--help-icon` data URI reads 12; both read 0 with those three properties out of the list. A
value-only edit that renders the same still reads: that deletion and the `--fs-icon-refresh` bracket
unescape (4 a pass) were each confirmed by element rects, not by this gate. A gallery with no
generated content fails like a blank one.

**It cannot see the chrome.** The gallery renders no `header.ut` or `footer.ut` output (no sidebar,
bar, rail, indicator or menu) and no page, so a change there reads 0 without having been looked at;
`live-audit` and `spa-parity` on a stand (`npm run live`, T2) are the gates that read it.

It reports rather than judges unless given `--max N`. A blank gallery would snapshot 0 elements on
both sides and print "0 differences", so a point that measures under `GALLERY_FLOOR` (200; the real
count is 1,129) fails regardless of `--control`/`--max`: a run that measured nothing is no report.

**It runs at two viewports, not one** (task 0145): 1280 (every page's design width) and 390x844 (a
phone point). A property that only diverges once a flex row is narrower than its own content is
invisible at 1280 by construction — the switch-knob overhang bug measured 0 differences there on
`worktree vs HEAD` with the fix reverted, and a `width` difference (26.80px vs 40px declared) only
at 390. `a11y` and `export-tier` still take Playwright's 1280 default alone; the gap this closes is
`computed-diff`'s.

**Two more passes enter states the plain ones never do**: `1280/fc` emulates `forced-colors: active`
(`page.emulateMedia` before `goto`, reset after) and `390/rtl` sets `dir=rtl lang=ar` after `goto`,
each on the first appearance point only. Inset properties (`top/right/bottom/left`) joined the list so
a physical offset shows too. Proven to bite, in a scratch copy: the pre-8430a64
`.cbi-dropdown > ul > li[selected]` gives 104 differences in `1280/fc` and 0 in the four plain
passes; `margin-inline-start` -> `margin-left` in `theme/65-dropdown.css` gives 6 in `390/rtl` (3x
`margin-left`, 3x `margin-right` on `ul`) and 0 elsewhere. The two passes cost 39 s of wall time
under `--control` (WSL2).

`a11y` has a forced-colors half the axe matrix cannot: it walks every `@media (forced-colors)`
selector in the sheet and fails when one reaches no gallery element (23 selectors, 5 `CHROME_ONLY`
in `header.ut` and `head.ut`), then Tabs once and fails when a focusable gallery element, focused, shows no
`Highlight` outline (186 elements). Proven to bite: `ul.dropdown` typed `ul.dropdwn` fails the reach
check; dropping `!important` from the `:focus-visible` repair fails the focus check on 4 of the 186
(`h3`, `button.fs-ap-fold`, `outline: none`). The pre-8430a64 selector over-reached rather than
missed, so the reach check cannot see it; `computed-diff`'s `fc` pass does.

`pseudo-loc` catches what neither of the other two can: a box sized for the ENGLISH string it was
built against. Both `smoke` and `computed-diff` render the gallery exactly once, in English, and a
toggle knob left its pill on every Russian phone at default density (task 0145) is invisible to a
gate that never renders a longer string. `pseudo-loc` replaces every visible text node and
text-carrying attribute in the gallery with a pseudo-localised form — each word 45% longer, Latin
letters swapped for accented look-alikes, no translation catalogue or router needed — and asserts
nothing overflows its box, escapes its parent, or is clipped with no scroller to reach it, at 320
and 390 CSS px across all three densities.

```sh
npm run pseudo-loc            # ~5 s: 6 width x density points plus one 390 rtl point, English vs pseudo-localised
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

The seventh point is 390 at normal density with `dir=rtl lang=ar`; the `parent` check measures the
end edge there (`pr.left - r.left`). Proven to bite, in a scratch copy: `display: flex;
justify-content: right; white-space: nowrap` added to the 390px `.cbi-value > .cbi-value-title` rule
in `theme/90-responsive.css` gives 14 `self-overflow` findings (`div.cbi-value` and
`label.cbi-value-title`, up to 137px), all at `390px/normal/rtl` and none at the six LTR points; the
intact sheet gives 0. The mirror itself is only proven needed: reverted to `r.right - pr.right` the
clean sheet reports 2 false `parent` findings (`input inside label by 4px`) at `390px/normal/rtl`.
No CSS defect was found that turns only the mirrored `parent` check red (`width: max-content` and
`white-space: nowrap` surface as `self`), so the `self` proof is what the rtl point rests on.

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

**What `pseudo()` grows, and what it leaves alone.** Pure function of its input, so a failure
reproduces and a diff is readable. Each WORD grows by a fixed 45% with filler drawn cyclically from
its own letters, so no break opportunity is added (a real translation lengthens words, it does not
sprinkle spaces: task 0145's Russian caption is one 14-letter word, "неиспользуемые", where English
has "unused"); 45% sits inside the 1.3-1.6x measured for Russian once the `[…]` bracket is counted.
Three kinds of word are left alone:

- **20 characters or longer:** no translation turns a 20-character token into a 30-character one;
  such a run is the gallery's torture fixture (`#g-longlabel`, 38 unbroken characters built for
  `styles/base/30-forms.css`'s `min-width: 0` floor), a checksum, a path or a URL. Growing it
  manufactures overflow against a limit the theme already measured and accepted.
- **No letter at all** (`-55.9`, `62%`, `303.373`): digits do not gain 45% on translation, only the
  unit letters beside them do. Growing them overflowed `.cbi-progressbar::after`
  (`styles/theme/25-progressbar.css`: `content: attr(title)`, `position: absolute`, `nowrap`, an
  overlay with no width of its own).
- **3 letters or fewer:** the SI and byte units (`dBm`, `MiB`, `kbps`) are invariant across locales
  (ISO 80000). Left unaccented too: a lone `dBm` otherwise takes one filler character and, with the
  bracket, cleared the progressbar's reserved margin by a handful of px.

**The ALLOW list**, entry by entry (each shape already decided elsewhere; none is invented for this
gate; the `.exclude()` of `a11y-gallery.mjs` is the same form):

- `.table` and its data descendants: a data table's width belongs to `tools/table-contract.mjs`,
  `table-tick` and `live-audit`, held by `fs-select.js`'s card transform at cramped widths. The
  gallery carries no LuCI JS, so a table renders at its raw intrinsic width on purpose.
- `.cbi-dropdown > ul > li`: the closed control's ellipsis, accepted in
  `styles/theme/65-dropdown.css` (a flex item's automatic minimum stops `overflow: hidden` eliding
  a value past the 400px cap). No `title`/`aria-label` is added: a `title` is not announced on
  touch and a shortened `aria-label` breaks WCAG 2.5.3.
- `label[for="g-longlabel"]`: the torture fixture. Even bracket-only growth leaves it 153px past its
  box at 320/Large before any word grows; no CSS fits an unbroken 38-character run in 320px.
- `.cbi-filebrowser > p` (breadcrumb) and `.cbi-filebrowser > ul > li > div:first-child` (filename
  column): `styles/base/95-luci.css` gives them `overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap` on purpose, so a long path ellipsises instead of wrapping.
- `.cbi-tabmenu > li > a`: task 0149's `.cbi-tabmenu > li { max-width: 100% }` holds (the `<li>`
  shrinks to 129.9px in a 264px strip and the label ellipsises); the gate reads `scrollWidth` on the
  truncated `<a>`, which an ellipsis'd element always exceeds.
- `.cbi-progressbar`: the meter's reading floats in a margin the bar reserves (80px on the dBm
  fixture, already in the tolerance as `eps + margin`). "-140.0 dBm" is marginal even in English
  (86px against 82px), and the `[…]` bracket tips it over; widening the reserve for a bracket no
  translation adds would tune the fixture to the gate.
- the `:has()` containers and `.g-wrap`: see the 0161 paragraph above. `SKIP_TEXT` (`.g-bar`,
  `.g-sec > h2`, `.g-note`) is gallery chrome and is not pseudo-localised; its text only tested the
  gallery's own `max-width: 1180px` wrapper.

**The `--eps` floor and the bite numbers.** The intact tree's noise is 2px (border/padding rounding
on the switch pill's own `scrollWidth - clientWidth`), which is the default. With `flex-shrink: 0`
reverted, the pill jumped to 6-23px across the six points at the original measurement (390/compact
6px, 320/normal 18px, 320/large 23px) and the triage re-run above reports the label's self-overflow
as 15-25px; the two were taken at different times, on a gallery and a `pseudo()` that have changed
since, and have not been re-measured together. Either way the growth over English clears `--eps`.
Density=Large is the axis that exposed the English half of that bug on a 360px screen.

**Neither replaces a userland run, and a green one never earns a release the right to skip owlab.**
The gallery has every widget and none of the pages: no menu, no chrome, no session, no third-party
sheet, no rpc, and every dependency in `smoke` is a
stub. They are early detectors. The release matrix is unchanged — `owlab test` on both formats,
the wide live gates (releasing.md, Step 4), `npm run check`, `/security-review`.

### Git hooks

The repository keeps its hooks in `.githooks/`, which is not active until you point git at it:

```sh
git config core.hooksPath .githooks
```

`commit-msg` strips Co-Authored-By, `Claude-Session:` and "Generated with" trailers from whatever
wrote them, and leaves `Signed-off-by` alone — openwrt/luci refuses a sign-off with a
`@users.noreply.github.com` address, so that line is load-bearing. `pre-push` runs `npm run check`
on the pushed commit in a clean worktree; `git push --no-verify` is the deliberate bypass and says
so on the way past.

## The live gates: `npm run live`

The static gates read files. Every bug a user has reported was about a **page** — a shredded column,
a clipped title, a doubled scrollbar, a third-party app laid out wrong, a client navigation that
painted less than a full load. `npm run live` is the half that opens pages, and it needs stands:

```sh
owlab up                       # the containers these gates measure
owlab sync                     # your working tree onto them
npm run live                   # upstream-contract, spa-parity, live-audit, scroll-jank, table-tick,
                               #   floor-contract, fit-quiet, scroll-anchor: the CORE routers, one
                               #   page per SHAPE. npm hands forwarded flags to no gate: the wide
                               #   run before a tag is releasing.md, Step 4
```

Each is also a command of its own, and each takes `--only <router ids>`:

```sh
node tools/upstream-contract.mjs --only owrtsnap --verbose   # every assumption, named, one by one
node tools/spa-parity.mjs --only owrt2410 --pages /admin/network
node tools/live-audit.mjs --only owrt2512 --widths 320,1440 --pages /admin/status
node tools/scroll-jank.mjs --engines chromium,firefox,webkit   # the other two need installing
```

An `--only` id that is not running exits 2, and live-audit exits 1 when a goto failed or a CHECK
threw (and then refuses `--update`/`--prune`): a gate never passes on fewer routers or pages than it
was asked for.

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
  upstream change shows up before it reaches a release. `--all` widens to every running OpenWrt
  router (the twins). ImmortalWrt is not a gate target since 0.14.13 (its two legs gave 1685 `noname`
  findings of their own app set, nothing to read in them): a running `imm*` router is ignored and
  `--only imm2512` is refused. A gate that takes `--only` must honour `--all` too:
  `upstream-contract` read one and ignored the other, and silently measured a subset of what the
  release runbook asked for.

Two harness facts hold behind `lib/stands.mjs`:

- **`sealToRouter()` aborts every request that leaves the router's origin** (data:/blob: pass), so a
  gate stops depending on github.com and its rate limit: ssclash asks GitHub for a release on two
  pages and a CI runner got 403, nine console findings on three routers. The route is a predicate
  and never a catch-all glob: a glob hands every request, hundreds the router serves itself, to a
  JS callback, and pushed CI's live job 17 minutes past its 45-minute limit. It aborts rather than
  faking a 200, which the page would render; the abort logs `net::ERR_FAILED`, which live-audit's
  network-noise filter drops.
- **`menuPaths()` waits for `window.L.require` before asking for `ui`:** `L.ui` exists only once
  something has required ui.js, and the 24.10 leg crashed with "Cannot read properties of undefined
  (reading 'menu')" straight after the login redirect while 25.12 was fine. The tree arrives rooted
  at `admin`, so the walk starts with an empty path (seeding `admin` yields `/admin/admin/...`, a
  sweep of 404s that reads as a clean run).

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
  - **Staging-window cases:** the router's own window is ~210 ms on a stand against 1.2 s on real
    hardware, so the gate holds the incoming view's module fetch open (`STAGING_DELAY_MS`). On CI the
    Overview was often still rendering at the click, 1400 ms after its load (`2959 -> 3540px`,
    `2750 -> 3331px`, once `900 -> 4011px`). A wait on height and mutations read a page on its loading
    spinner as settled (ubus +600 ms, 4 of 4 grew) and a wait on no request in flight never settled
    on CI within 20 s. What separates them is WHAT moved: the defect changes an attribute and adds or
    removes no node in the outgoing page (0 content mutations on every such finding), a loading page
    does. A height change WITH mutations proves nothing, so the case is retried and only
    `STAGING_ATTEMPTS` of those in a row are reported, as a case that measured nothing. The `owned`
    rule check does not depend on content and is a finding on any attempt.
  - **Back case:** a Back that commits while the incoming page is 61-66 nodes deep clamps the UA's
    traversal restore to 0 and ends `2683 -> 2683`, proving only the router's half. The fault that
    reached CI (`owrt2410 2680 -> 2249`) needs the incoming page whole at the swap: a loaded runner
    makes it, a stand about 1 run in 15. Holding the incoming ubus calls open 700 ms across the
    traversal makes it every time (3 of 3 red on owrt2410b before the fs-fit.js fix, 3 of 3 green
    after). The settle is the swap's end plus `SCROLL_IDLE` read out of fs-fit.js: the correction
    that moved the reader landed 419 ms after the commit, past the flat 3 s wait the gate had.
  - **Progress lines:** `live-audit` and `spa-parity` print one newline-terminated line per page with
    seconds since start. A slice cancelled at the 45-minute cap used to leave an empty log, because
    `/admin/system/filemanager` pinned the browser's main thread and `page.evaluate()` has no deadline.
- **`install-check`** (`npm run install-check`, not part of `npm run live`) runs `install.sh` on the
  stands twice over, because the upgrade path is where every installer report has come from. It
  installs the published release and re-syncs your tree afterwards — do not run it in the middle of
  debugging something else. It takes each stand's `../tmp/stands-<id>.lock` (unless `ci-local.sh`
  holds it), and its logs go to `../tmp/install-check-<id>-<run>.log`, removed when the stand passes.
  - **The version assertion is "not older than the feed's", never equality.** `apk add` on a package
    already in `world` keeps the old version and exits 0, so "installed, registered, cascade.css
    present" was all true on a router still running the previous release. Equality fails a correct
    install in CI, where the router carries the build under test (0.12.8) while the feed serves
    0.12.7: it failed the opkg leg, and the apk leg passed only because `apk list` includes the
    installed version. Since the theme joined the official openwrt/luci feed, `apk list` answers
    with two builds of one name, one stamped from git's commit date (`26.246.70755~4fd72fd`) that
    only grows, so a plain `sort -V | tail -1` picks the foreign build and calls a correct install
    "behind" (owrt2512, owrtsnap; owrt2410's feed carries no theme). The greps drop a leading
    number of 26 or more, the rule `install.sh` pins with in `is_foreign_luci_build()`.
- **`live-audit`** is a ratchet: known findings live in `tools/baselines/live-audit.json`, a new
  signature fails, and `--update` rewrites the file. Read the diff before you update — some findings
  belong to a third-party app rather than to the theme, and that distinction is the file's whole
  value. `--engine firefox|webkit` runs the same sweep in another engine, keyed separately in the
  baseline (a headless Firefox refuses to launch on some macOS setups; the flag is there for CI and
  for Linux). A new engine needs its own baseline, created by one `--update` run. `--lang ru` (task
  0162, below) runs the same sweep against a Russian router, keyed `<stand>@ru` — the two suffixes
  compose (`owrt2512@ru@firefox`).
  - **Why `--lang`:** `overflow`, `clipped` and `doc-scroll` read text length, and the default
    answer is English (Playwright's locale is en-US, `luci.main.lang=auto`). An unmodified sweep
    against a router switched to Russian by hand gave 77 findings on one stand and 70 on the other,
    RU being measurably longer (the gallery's pseudo-loc gate uses 1.3-1.6x). The flag sets
    `luci.main.lang` per router (`en` maps to `auto`), restores `auto` after, and appends the
    language to the baseline key like `--engine`. Recording only language-independent findings
    would have hidden the ssclash label/section bug, which was a length fault.
  - **Why `--settle` (default 460 ms):** the resize loop once sampled everything 220 ms after
    `setViewportSize`, inside `fs-fit.js`'s `SCROLL_IDLE` (400 ms), where the theme defers every
    layout-reading pass; that read as `geometry|fs-content` on `/admin/status/vnstat2/config`, its
    offset always the gap between two adjacent `WIDTHS`. The other checks now wait `SETTLE_MS`
    (400 ms plus the margin `SCROLL_IDLE` itself carries). `geometry` is sampled BOTH
    immediately and after the wait: with `1cd2af1` reverted in a scratch copy, 220 ms read the
    stale model (`off=-70` at 320->390 up to `off=-936` at 1440) and a sample past `SCROLL_IDLE`
    read clean, the same bug hidden because the deferred pass had run by then.
- **`scroll-jank`** drives a real wheel (long enough to meet a poll tick: Overview replaces 12 tables
  in a 6.6 s scroll) and reports four columns. `remedy`: a table that already had a decision
  changing while the page moves; the contract is zero, and a table the poll brings in mid-scroll is
  answered from its predecessor's slot, which is the deferral working, so it counts under
  `replaced`. `anchor`: an element's document position (`rect.top + scrollTop`) moving, which
  changes only if something above it resized. `shift`: the engine's layout-shift entries (Chromium;
  the others report -1). `replaced`: tables the poll re-rendered inside the window; a run with none
  has not tested the interesting case. Every engine asked for, since scroll anchoring is Chromium's
  alone, WebKit fires `scroll` through its momentum after the wheel stops and Firefox delivers
  ResizeObserver on a different tick.
- **`scroll-anchor`** (task sweepspeed) runs its requested engines concurrently rather than one after
  another, and — when an `-b` twin of a stand is up (`owlab.yaml`'s matched pairs, `owrt2512`/
  `owrt2512b` and the like) — splits that stand's own cell list across the two containers instead of
  walking it with one. Neither changes which cells run: every combination the axes define still runs
  exactly once, findings from either container print under the base stand's id. `--no-pair` turns the
  splitting off (for measuring the pairing itself, or a run that wants the twin left idle); `--only
  owrt2512,owrt2512b` measures both explicitly instead of pairing them. A twin is paired only when
  the run can lock it (`stands-<id>.lock`, a try-lock that never waits): one another session holds is
  named on stderr (`twin owrt2512b is in use (…); measuring owrt2512 alone`) and the base measures
  alone. `--quick` is the fast local
  loop — one stand, the Overview page alone, the default axes — and prints what it left out on every
  run; it is not a substitute for a full `npm run anchor` or CI's own `--full` sweep, and is never set
  by CI.

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
gone.** `--prune` used to REPLACE a language key with exactly what one sweep saw (it now drops only entries no stand of the run reproduced, and prints each key), and a first attempt at
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
(stand → host port), `login` and `SNAP` (one chrome snapshot: sidebar width, menu items, sheet
counts, poll queue). Every probe takes the stand as its first argument and writes to `../tmp/`:

```sh
node .claude/tooling/<probe>.mjs owrt2512 [arg]
```

The ones worth knowing by name — `resize.mjs`, `adversary.mjs`, `traffic.mjs`, `soak.mjs` — say
what they measure at the top of each file; `tools/spa-parity.mjs` and `tools/live-audit.mjs` are the
gated equivalents of the retired `parity.mjs`/`overflow.mjs` probes. `preview-venv/` beside them is a
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
  --assert "exec for f in $UT/*.ut $UT/partials/*.ut; do ucode -T -c -o /dev/null \"\$f\" || exit 1; done"

owlab test --release 24.10.8 --install 'dist/all/luci-theme-footstrap_*.ipk' \
  --assert 'package luci-theme-footstrap' \
  --assert 'file /www/luci-static/footstrap/cascade.css' \
  --assert 'http 200 /cgi-bin/luci/admin/status/overview' \
  --assert 'http 200 /cgi-bin/luci/admin/system/system' \
  --assert "exec for f in $UT/*.ut $UT/partials/*.ut; do ucode -T -c -o /dev/null \"\$f\" || exit 1; done"
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
4. `curl -s -D - http://<host>/cgi-bin/luci/` — the body is the login form. 25.12 answers it with
   403 and `x-luci-login-required: yes` (upstream `dispatcher.uc`, not the theme), so read the body,
   not the code. The admin pages are clicked by a person.
5. Rollback, if anything above fails or a page is wrong:
   `ssh <host> 'uci set luci.main.mediaurlbase=/luci-static/bootstrap; uci commit luci; rm -f /tmp/luci-indexcache*'`.

### The playground: recording and replaying a real router

`tools/playground/{capture,build,verify}.mjs` turn an owlab stand into a static, offline site —
CI's own `playground` job, [ci.md](ci.md). Each step needs the one before it (`capture` needs a
booted, installed router; `build` and `verify` need `capture`'s output) and the whole chain is a
router-driving Playwright run, so it is T2: detach it with `tools/bg.sh` and pair it with
`tools/bg-wait.sh` in the same turn rather than waiting on it in the foreground.

```sh
owlab up owrt2512 && owlab install owrt2512 'dist/noarch/luci-theme-footstrap-*.apk'
tools/bg.sh sh -c '
  npm run playground:capture &&
  npm run playground:build -- --base /luci-theme-footstrap/playground &&
  npm run playground:verify -- --base /luci-theme-footstrap/playground
'
tools/bg-wait.sh <run-id>
```

Each script also takes its own flags directly (`--recording DIR`, `--out DIR`, `--base /path`,
`--budget-kb N` on `verify`) — `--help` on any of the three prints the exact list. Output lands
under `../tmp/playground/` by default (`recording/`, `out/`, `playground.tar.gz`), never inside the
checkout. Open `../tmp/playground/out/cgi-bin/luci/admin/status/overview/index.html` in a browser
under any static server rooted at `--base` to look at what was built without re-running `verify`.

The site opens on a login page (`BASE/cgi-bin/luci/`, prefilled `root`/empty like a real router)
that accepts any credentials — a static site has no server left to check them against — and
`.fs-logout` returns to it; `build.mjs` refuses an old `--recording` made before `capture.mjs`
saved the login form, naming the fix (re-capture) rather than shipping a playground with no gate.

Capture timing, measured: the dashboard `login()` lands on lazy-loads `view/dashboard/include/10_router.js`
(owlab.yaml) while the loop's first `goto` fires, so that response's body is already discarded; the
`luci-mod-status` includes (10_system.js, 60_wifi.js) arrive ~0.5-0.6 s after `load` locally and
later on a fresh CI container, and a fixed 300 ms settle dropped 8 of 9 overlay keys; one body read
hung ~148 s on owrt2512b, past capture's 5-minute kill, hence the 15 s bound in `drainReads`.

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
`release`/`pages` jobs (they sign with CI secrets this script never reads), the artifact upload/download between
`build` and everything downstream of it (substituted by one shared `dist/` on disk), job-level
`timeout-minutes` (unenforced locally), and the apt-get fallback branches inside `check`'s
gettext block and `ci-playwright.sh` (only exercised when the tool is actually missing, which it
was not on this host). A step this script cannot cover is printed as `SKIP` with a reason, never
folded into a passing count.

### Calling a flaky finding fixed: `tools/rate.sh`

`tools/rate.sh <N> <cmd...>` runs the command N times, prints `K/N failed` and exits non-zero if
any run failed. A flaky CI finding is called fixed only with a measured rate: the old build red
at some K/N, the new one `0/N` with the same N and the same command. One green run proves
nothing, and neither does a rate measured while another run holds the stands (see the lock in
"The stand's own traps").

```sh
tools/rate.sh 10 node tools/scroll-jank.mjs --only owrt2512
```

### Known flakes

A red job on `main` whose log carries one of these signatures is a measured flake, not a finding
of the commit. The agent reruns the failed jobs of that run once (`gh run rerun <id> --failed`,
`/ship` step 4); a second red on the same run, or any signature not listed here, goes to the
maintainer. A row past its "re-measure by" date matches nothing until a new rate is in it. A row
is added only with a `tester` card's classification behind it, never to get a push through.

| Job | Signature in the log | Rate | Class, card | Seen | Re-measure by |
|---|---|---|---|---|---|
| The reader stays put (firefox) | `firefox owrt2512 @390 top large  engine-anchoring on  /admin/network/dhcp: refill 3/3 on the same section left the reader 12px off (engineTrusted true, corrected never)` | 0/20 locally (`tools/rate.sh 20 ../tmp/task-0184-anchors-red-dhcp/run-once.sh`); 1 of 38 CI firefox push sweeps | flake, cause not named (CI strips the `fs:probe` trail); 0184 | ca12d23 | 2026-11-04 |
| The reader stays put (firefox) | `firefox owrt2410 @1440 side normal  engine DECLINES  processes: the offset moved on its own 1 time(s) mid-flick` | 0/25 and 0/20 locally under CPU stress | flake beside a frame stall; QUIET re-measures since b2421b0; 0166, 0167 | c253c28 | 2026-11-04 |
| The pages behave on a real router (parity) | `spa-parity … /admin/status/overview -> /admin/system/package-manager @767px (Back)  back-scroll: parked at <n>px, Back restored 0px` on owrt2512 | 0/30 locally (`tools/rate.sh 30 ../tmp/task-0195-parity-back-scroll/run-once.sh`), 0/41 more under CPU throttle and stress-ng; 1 of 59 CI parity jobs since 2026-09-25 | flake: the gate reads once at a fixed 800 ms after staging; on 25.12 Overview at 767 px the restore lands 436-783 ms later as the page grows, and the router's settle exemption can miss a ceiling that moved (reproduced by injection only); 0195 | 249042a | 2026-11-04 |
| The reader stays put (webkit) | `scroll-jank: … page.goto: Timeout 20000ms exceeded` or `page.goto: WebKit encountered an internal error` at the first `openPage` of `tools/scroll-jank.mjs` (any stand: owrtsnap, owrt2512, owrt2410) (before 0189 the timeout read `30000ms`) | 3 of 42 webkit attempts since 2026-10-20, a fourth on owrt2410 (run 39637956114); 5 of 168 first gotos after a login (3.0%) against 0 of 840 later ones, 0 of 30 chromium or firefox jobs against 10 of 30 webkit | first goto after login from a landing still loading (card 0198); fixed by 0199: `login()` returns only once the landing's `L.require` has answered (as scroll-anchor already waited, 0.09%), and `openPage()` prints `openPage: <engine> <url> attempt n/3: <error>` per failed attempt; a retry on the same page did not clear it in fd77edd, and a red with this signature after 0199 is a finding; 0184, 0189, 0198, 0199 | 4b6ac5e, 3be477c, 17b5fce, fa218ae (build run 39637958432), fd77edd (build run 39655159082) | 2026-11-04 |

## The stand's own traps

- **A pattern upload fails on a synced stand with no error from the theme; the stand has no
  `/etc/footstrap` and no `/etc/config/footstrap`.** `owlab sync` copies `htdocs/` and `ucode/`
  but never writes `/etc/config`, and uci-defaults (which makes the directory) does not run on a
  sync. A packaged install has both. Tell it apart:
  `docker exec owlab-luci-theme-footstrap-owrt2512 ls /etc/footstrap /etc/config/footstrap` — a
  missing path is the stand, not the theme. Restore with `docker cp
  luci-theme-footstrap/root/etc/config/footstrap <ctr>:/etc/config/footstrap` (then
  `chown 0:0`, the uid-1000 trap above) and `mkdir /etc/footstrap` inside it.

- **A 404 on a theme resource from `owrt2512b`/`owrt2410b` while the primary stands are green is
  an unsynced twin, not a missing file.** `owlab sync` without a stand name syncs the primaries
  only; a twin keeps whatever it was booted with. Tell it apart: `md5sum` the resource on the host
  and in both containers (`docker exec owlab-luci-theme-footstrap-owrt2512b md5sum
  /www/luci-static/resources/fs-router.js`) — a twin that differs or lacks the file needs
  `owlab sync owrt2512b`.

- **`moved 1980/0 anchor 4044px` on `chromium owrt2512 @768 side /admin/status/overview` reads as
  the theme jumping under the reader; it was `scroll-jank.mjs` arming before Overview painted.**
  4 of 16 PR runs, 0 of ~80 push runs — PR boots only `owrt2512` (`tools/ci-boot.sh`), so this cell
  starts ~15-17s after container start, ~20s sooner than a push run's later stands.
  `fs-overview.js` keeps every section hidden until `network.flushCache()`'s five RPCs answer; on a
  freshly booted router one answered late enough that the gate's old fixed 2600ms wait expired
  first, arming on `scrollable 0` with no tables rendered — the page then finished painting
  mid-scroll and read as a jump. Tell it apart from a real jank finding by the `scrollable` figure
  in `moved X/Y`: `0` (or anything the "nothing scrolled" guard's `> 120` floor misses) means the
  page had not painted, not that something moved it. Fixed by waiting for the paint
  (`page.waitForFunction`, tools/scroll-jank.mjs) instead of a clock, now `waitForPaint()` in
  `lib/stands.mjs` so a second gate can share it.

- **`back-scroll: /admin/status/overview has no room to scroll at this width (parked at 0px)` on
  `owrt2512` (CI run 36184976382, job `parity`) is the same trap in `spa-parity.mjs`'s Back case,
  not a genuinely short page.** `backRestoreCheck()` did `page.goto(from)` then a fixed
  `page.waitForTimeout(1400)` before parking the scroll; the same late `network.flushCache()` RPC
  above left Overview empty at 1400ms, so `parked` read 0 and the `parked < 80` guard — meant for a
  page that truly has no room to scroll — misdiagnosed it. Fixed the same way: `waitForPaint()`
  before parking, and a timeout there is its own `"page not painted, run proves nothing"` finding
  rather than falling through to the short-page guard.

  A third case is `stagingAttempt()`'s own fixed 1400ms (and the page loop's): on a freshly booted
  24.10 the router queues the click behind Overview's first render (3.1-6.4 s), so no stage exists
  and the gate reports `the fake-slow route never caught a staging window`. Tell it from a real
  regression by `liveSpin:true` / `staged:0` / `docH` 900 before the click. `owrt2512` passed green
  on the same race while measuring an unpainted Overview. Fixed with `waitForPaint()` after each
  `goto`; a timeout is a `page not painted` finding.

- **A `pageerror` `RPC call to uci/get failed with error -32002: Access denied` on the login
  document is upstream LuCI, not the theme.** `luci.js` boot requires `form`, and `form.js:10` on
  the openwrt-24.10 and openwrt-25.12 branches runs `uci.loadPackage('luci').catch();` — a
  `.catch()` with no handler, so the anonymous session's (`sid` 000…) denial goes unhandled. Master
  has `.catch(() => {})`; neither release branch carries it. Measured 2026-10-11, `tools/rate.sh 30`,
  chromium, fresh context, login + paint + 5 s: stock bootstrap 30/30 on `owrt2410` and `owrt2512`,
  footstrap 5/30 and 3/30 (its login document unloads sooner, so the answer often lands after it).
  The theme's login page loads no module that calls `uci/get` (`footer.ut`'s requires sit under
  `!blank_page`). Tell it apart: switch `luci.main.mediaurlbase` to `/luci-static/bootstrap` and
  rerun — the rate goes up, not to zero.

- **`owlab test` (0.6.1) removes the project's RUNNING stands, not only the throwaway router it
  booted.** Measured 2026-09-14: `owrt2512` and `owrt2410` were up, `owlab test --release 25.12.4
  --install …` ran, and its own log carried `Container owlab-luci-theme-footstrap-owrt2512 Removing`
  / `Removed` before the `openwrt-25.12.4` router it built — a compose `down` of the whole project.
  A concurrent `owlab up owrtsnap imm2512 imm2410` exited 1 with its images built and no container
  left. `docs/ci.md` and `tools/ci-local.sh --list` say `verify` is "safe with stands up"; on 0.6.1
  it is not. Tell the two apart with `docker ps --format '{{.Names}}' | grep owlab-luci-theme-footstrap`
  before and after: 0 after is this. Run `owlab test` BEFORE `owlab up`, or `owlab up` again after
  it; an issue against owfeed/owlab is drafted in `../tmp/task-release-0.14.13/owlab-issue.md`.

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

- **Never pipe a long run into `tail`, `sort` or a bare `grep`.** The output buffers until the
  command ends, so a hang looks exactly like progress. `live-audit` over a full sweep did this on
  2026-09-09: the process sat alive and idle for 73 minutes with no output, where CI takes about 90
  seconds a stand. `grep` is the one that catches you by accident — filtering a gate's
  noise through `| grep -v …` buffers in 4KB blocks, so a gate that was printing a line a second
  looked mute for minutes (2026-09-10). Write to a file and read the file as it grows (`grep
  --line-buffered` if it must be a pipe), and give any local `live-audit` both `--pages` and a
  `timeout`.

- **Building a test table through the HTML parser (`innerHTML`/a template literal) inserts a
  `<tbody>` the app never wrote; `E()`/`appendChild` do not.** Task 0058's sweep harness built
  `<table class="table">…</table>` from a string, and with `.table{display:block}` (base) plus an
  un-carded parser `<tbody>` (an anonymous table-row-group box, `display: table-row-group` by
  default, no rule targets it), the harness measured a ~137px shrink-to-fit box and reported text
  overlaps that never happen on a real page — LuCI's own row builders (`ui.js:3818`,
  `form.js:2807`) append rows straight onto the `<table>` element, no `<tbody>`. Tell the two apart:
  strip the parser's tbody and re-measure (`document.querySelectorAll('tbody').forEach(tb =>
  tb.replaceWith(...tb.children))`); if the finding survives, it is real, if it does not, the
  harness built a shape LuCI never emits.

- **A CSS-only probe (cascade.css loaded, no theme JS) reads a header table as key/value, because
  `.fs-dt` is written by `fs-select.js` at runtime, not by the stylesheet.** `fs-select.js`'s
  `tagDataTables()` (the `ROOTS` scan and its header test) tags any `#view` OR `.modal` table carrying
  a header — a plain `<thead>`, a real `<tr>` inside one, or a bare-`<th>` first row — with `.fs-dt`,
  and the key/value rule in `30-tables.css` excludes `.fs-dt`; a harness that never loads that script
  never sees the class, so a table `fs-select.js` would have tagged reads as key/value and can
  report a stacking/styling bug that does not exist live — this bit a table inside `.modal` too,
  since `foreignTables()` reaches both roots. Tell the two apart: check
  `document.querySelectorAll('.fs-dt').length` in the harness, or load `fs-select.js` before
  measuring.

- **OrbStack's VM freezes when the dev Mac's lid closes for sleep, and every stand looks reachable
  while it is dead.** `docker ps` hangs, a stand's ssh/http port accepts the TCP connection and
  returns 0 bytes (`curl` exit 28, timeout), and the OrbStack app itself still reports the VM
  "Running". Cause: `vmgr` pauses the VM on system sleep and only resumes it on a full wake, which a
  closed lid never delivers — clamshell sleep is `DarkWake`, not `FullWake`. Tell the two apart:
  `grep 'msg=\(sleep\|wake\)' ~/.orbstack/log/vmgr.log | tail -1` shows `sleep` while the ports are
  live but empty. Recovery: `caffeinate -u -t 2` (declares user activity, which promotes DarkWake to
  FullWake and gets `vmgr` to log a wake). Prevention on this machine: a LaunchDaemon holding
  `caffeinate -s` (`PreventSystemSleep`, AC power only).

- **`scroll-anchor --full` with all three engines at once over three stands kills the chromium
  process about two minutes in; one engine at a time completes.** It reads as a regression in the
  sweep — chromium's leg dies mid-run while webkit and firefox finish — and it is the browser's
  zygote going down under the load of three engine sets against three routers on one host, not
  anything the theme did. Tell the two apart by re-running the same axis with a single
  `--engines chromium`: a real finding reproduces there, this does not. Measured 2026-09-11 on the
  three twins (`owrt2512b`, `owrt2410b`, `owrtsnapb`), 184 runs per engine green when run one at a
  time. CI does not meet it — `anchors` is one job per engine, on a runner each. **The way to have
  all three at once locally is one PROCESS per engine**, not one process driving three: measured
  2026-09-12, nine shards (engine x stand, own browser and own router each) ran to completion with
  no zygote loss at all.

- **A twin restarting mid-run reads as `install.sh` failing the network, not as the stand.** Testing
  the install-feed card's fixes on `owrt2410b`/`owrt2512b`, a run reported `StartedAt`
  12:39:45…12:43:42 — several restarts inside four minutes, none of them anything this session did —
  and for about 10 s after each one `ip route` inside the container had no default route at all
  (`wget`/`apk`/`opkg` answered "Operation not permitted", not a DNS failure or a 404): the
  container's network namespace was still being reattached to `br-lan`. A network call from
  `install.sh` that lands in that ~10 s window fails exactly like a real feed outage would —
  `feed_refresh`'s own tolerance logic cannot tell the two apart, because from inside the container
  there IS no route, full stop. Tell a restart apart from an installer or feed defect with
  `docker inspect -f '{{.State.StartedAt}}' <container>` against the time the failure was logged (a
  `StartedAt` within seconds of the failure is the restart, not the script) and `ip route` right
  after (no `default via …` line yet, or an `owlab status` showing the router still coming up) — a
  genuine feed problem leaves the route intact and fails on DNS/TLS/timeout instead. Cause not
  identified from inside this session (no `owlab up`/`owlab sync` was run against these two stands
  here); re-running the same scenario a few minutes later, once `StartedAt` had settled, reproduced
  cleanly with no restarts.

- **A `cp`/`cat`/`mv` PATH-shim in a failure-injection harness silently injects nothing when the
  harness runs under this dev box's own busybox, while the identical shim works inside a
  real router container.** Testing the install-feed card's `atomic_write()` failure paths, a harness
  that put a fake, always-failing `cp` first on `$PATH` and called the extracted shell functions
  directly kept reporting success — the write went through, unshimmed, no matter how the temp
  directory or `export PATH=` order was arranged. The cause: this busybox's `ash` resolves `cp`,
  `cat` and `mv` as its own applets via a standalone-shell shortcut that bypasses `$PATH` lookup
  entirely for names it already provides, so a shim script at another path on `$PATH` is never
  reached — confirmed with `busybox --list | grep -wE 'cp|cat|mv'` (all three listed) against the
  same shim placed and `chmod +x`'d correctly, invoked by its literal path (`/tmp/shim/cp`, which
  *did* run) versus by bare name (`cp`, which did not). Inside an owlab router container the same
  shim, same harness, intercepted correctly on the first try — `docker exec <container> sh
  harness.sh`, not `busybox ash harness.sh` on the dev box. Tell the two apart before trusting a
  "shimmed and it still passed" result: run the harness through `docker exec`/`owlab` on a stand, or
  check `busybox --list` in the exact shell the harness runs under for the command being shimmed.

- **The sweep is wait-bound, not CPU-bound, and sharding it further than the tool already does buys
  almost nothing.** Measured 2026-09-12 on a 20-core, 15 GB host: three engine processes over three
  stands each read 22 cells/min; nine shards, one per engine and stand, read 26 — 18% for three
  times the processes, because `tools/scroll-anchor.mjs` (0fa9c2b) ALREADY runs its stands
  concurrently inside one process, so an external split mostly moves that same concurrency outside.
  What the same run says about the machine is the useful part: `load average 1.49` of 20, 5 GB of
  15 in use, every stand container at 0.03-0.14% CPU. A cell costs ~20 s and nearly all of it is
  fixed waiting — SWAP's 900 ms window, three REPEAT refills, QUIET's 24 flick steps, `SCROLL_IDLE`
  on each check — so the lever is more cells in flight (memory is the only ceiling), never a faster
  machine. **Do not shorten those waits to speed the sweep up**: each is a measured number, and half
  of this week's findings need the window as wide as it is. Full `--full` across three engines:
  ~75 min serial, **1860 s (31 min) at nine shards**, 828 runs.

- **Nine shards is the ceiling; running the sweep ALONGSIDE `spa-parity` and `npm run check`
  manufactures late findings that are not there.** Measured 2026-09-12: nine sweep shards plus three
  `spa-parity` runs plus a full `check`, thirteen processes at once, produced two
  `corrected late` findings — `webkit owrt2410d` at 228 ms and `webkit owrt2512d` at 247 ms, both
  `@1440 side normal engine DECLINES overview`, both just over the gate's own 200 ms `LATE_MS`. The
  identical three webkit shards on an otherwise idle machine, same commit and same stands, read 276
  runs and no findings. Tell the two apart by re-running the engine alone before believing a
  `corrected late` within ~50 ms of the threshold; a real one reproduces on a quiet machine. Run the
  sweep on its own, and `spa-parity`/`check` after it.

- **Two `tools/ci-local.sh` runs against the same stands invent findings, and `--force` does not
  make it safe — it only silences the refusal that was protecting you.** Measured 2026-09-12: a
  second `anchors:webkit` started 37 s after the first, both with `--force`, and the pair reported
  **12 findings** — `the reader drifted 46/88/138px across real poll ticks` at every density and
  both layouts, on two stands. Run alone, the same commit and the same command read 276 runs and no
  findings. The script's default refusal names this exact failure. **Stand use is now serialized
  by a lock, not by a promise**: `requireStands()` (`tools/lib/stands.mjs`), `tools/ci-local.sh` and
  `tools/install-check.sh` all take `flock` on `../tmp/stands-<id>.lock`, one per stand taken in sorted order,
  and hold it for the whole run; a second run on the same set waits, and says who holds it.
  `--force` skips the refusal, never the lock. `../tmp` there is the main checkout's from every linked
  worktree too (`tools/lib/tmp-root.sh` and `.mjs`, the git common dir; a copy outside git keeps its own
  parent), so a worktree run takes the same lock and the pre-push worktree's gates write into the shared
  `../tmp`, not into their `mktemp -d`. The holder is a child `flock` kept alive by its
  stdin pipe, so the kernel frees the lock on any exit, SIGKILL included. `flock` is probed
  synchronously first: the wait loop blocks the event loop, so the spawn's async `error` event
  never fired when `flock` was missing and the loop spun forever (`timeout 5` → 124). The wait is
  bounded in all three (30 min, `STANDS_LOCK_TIMEOUT_MS`) and names the holder on expiry. `tools/ci-local.sh`
  hands the stands it holds down in `STANDS_LOCK_HELD` (space-separated ids) with
  `STANDS_LOCK_PID`; a stale pair left in a later shell must not skip the lock, so `heldBy()`
  believes it only when that pid is alive, the lock file names it and the flock is really taken.
  The lock dies with its holder, so a killed run
  frees it; no `pgrep` recipe is needed (the one this entry used to carry matched its own
  `sh -c`, twice). A finding that appears on twelve
  cells at once, evenly across an axis, is this and not the theme. The lock is advisory and only
  this repo's gates take it: `owlab sync`, `owlab up` and `owlab test` (owlab 0.6.1) do not, and
  another session installed builds on owrt2512/owrt2410 in the middle of a held gate. Tell apart:
  `cat ../tmp/stands-<id>.lock` names a live gate while
  `docker exec owlab-luci-theme-footstrap-<id> ls -l --time-style=+%T /www/luci-static/resources/fs-router.js`
  shows a newer mtime. Until owlab takes the lock (an issue draft awaits the maintainer's word), no `owlab sync`
  while a gate runs.

- **"no owlab router is running, so nothing was checked" while all eight are up means the gate
  could not find `owlab`, not that the stands are down.** `owlab` is a Go binary in `~/go/bin`, put
  on `PATH` by the login profile — and a login shell that dies part-way through that profile on
  something unrelated (measured 2026-09-11: a stale `deno/env` path from another project, printed
  as a bare `No such file or directory` with no mention of owlab) leaves `PATH` half-built. Every
  live gate then reports the same sentence on every stand at once. Tell the two apart with
  `owlab status`: if it lists routers as `running`, the stands are fine and the shell is not. Run
  live gates with `export PATH=$HOME/go/bin:$PATH` set explicitly, which skips the profile entirely.
  **Six gates
  saying "nothing was checked" is the hardening working** — before `21a8502` and `916d4d5` those
  same runs would have exited 0 and read as six passes.

- **A page that pins the browser's main thread stops a gate DEAD, and no gate has a deadline for
  it.** `page.evaluate()` is the one Playwright call with no timeout at all: it waits for the page's
  own thread, and a page stuck in a loop never gives it back. Measured 2026-09-10 (task liveslice):
  `/admin/system/filemanager` under `fs-fit.js` at `13e9864` left the renderer at ~105% CPU for as
  long as it was allowed, so `classify()` (`tools/lib/page-shapes.mjs`, which both `spa-parity` and
  `live-audit` walk the whole menu with) never returned, and both CI slices were cancelled at their
  45-minute cap on every run for a day — with an empty log, because neither gate said which page it
  was on. Both gates now print a line per page with the clock on it; a run that stops has the answer
  as its last line.
  **Tell a frozen page apart from a slow one in about a minute:**
  ```sh
  # 1. is it the theme? serve the stock package on that stand and load the same page
  owlab exec owrt2512b -- 'uci set luci.main.mediaurlbase=/luci-static/bootstrap && uci commit luci'
  owlab exec owrt2512b -- 'rm -f /tmp/luci-indexcache*'      # …and back to /luci-static/footstrap after
  # 2. is it THIS commit? swap one file in, no worktree and no sync — the stands may be somebody
  #    else's right now, and `owlab sync` pushes whatever the working tree currently holds
  git show <sha>:luci-theme-footstrap/htdocs/luci-static/resources/fs-fit.js > ../tmp/fs-fit.<sha>.js
  docker cp ../tmp/fs-fit.<sha>.js owlab-luci-theme-footstrap-owrt2512b:/www/luci-static/resources/fs-fit.js
  docker exec owlab-luci-theme-footstrap-owrt2512b chmod 644 /www/luci-static/resources/fs-fit.js
  ```
  `chmod` is not optional: a `docker cp` lands the file 0600-ish and uhttpd answers **403**, which
  reaches the page as `NetworkError: HTTP error 403 while loading class file` — the module then does
  not run at all and the page looks *fixed*. A green result with 403s in it has measured nothing.
  A file copied from a path owned by uid 1000 also arrives so, and the same 403 survives the
  `chmod` until `chown 0:0` runs too (charts PR stand run, 2026-09-13).

- **A twin (`-b`/`-d`) is judged against its core stand's `live-audit` baseline.** The baseline is
  keyed by core id (`owrt2410`, `owrt2410@ru`, …); `coreId()` in `tools/lib/stands.mjs` maps
  `owrt2410b`/`owrt2410d` onto `owrt2410`, so a twin's NEW is genuinely new. Before that mapping a
  full `--all --pages-all` sweep read **412** NEW, every one on a twin, against 0 on the core stands;
  after it, 0 NEW over 675 renders on 9 routers. Output and counts still name the twin itself.

- **A local stand keeps the app versions it was built with; CI boots today's feed.** A `live-audit`
  finding red in CI and silent locally can be an app that moved: CI's first `audit-ru` run
  (2026-10-18) found `/admin/dashboard|768|clipped|div.cbi-section` on owrt2512 with
  `luci-mod-dashboard` 26.288.56989~75a306d, while the local stands still carried 26.251.57781~0f38c02,
  from before upstream reworked the dashboard into KPI cards. Tell it apart: the CI job log prints
  every installed version; compare with `owlab exec owrt2512 -- apk list -I luci-mod-dashboard`, and
  reproduce in a throw-away container from the stand's image after `apk add -u <app>` rather than
  upgrading a shared stand.

- **A freshly started stand has no theme: the first live gate reads "N page(s) rendered but
  data-fs-fit never appeared".** `owlab up` boots the image; the theme arrives only with `owlab
  sync`. Seen on all 9 stands after `owlab test` had taken them down (2026-10-18). Tell it apart:
  `owlab exec <stand> -- ls /www/luci-static/footstrap` fails on an unsynced stand. Run `owlab sync`
  on every stand after `owlab up`, before any live gate.

- **`pkill -f <pattern>` kills the shell you typed it in.** `-f` matches the full command line, and
  the wrapper `bash -lc "pkill -f probe-one …; node probe-one.mjs …"` contains the pattern, so the
  whole chain dies before the command after the `;` runs — and it looks exactly like a run that
  produced no output. Bracket the first character (`pkill -f "[p]robe-one"`), or kill from a separate
  call.

- **A piped gate's status can come back empty.** On 2026-09-09 a piped
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
`--fs-panel2` is 4.59:1 at its worst (footstrap/dark) across all five palettes, both modes.

**`owlab sync` does not ship what a router gets.** It copies `htdocs/` and `ucode/` straight from the
checkout and builds `cascade.css` with `--dev`: no minifier, no pre-paint minifier, no template
strip, no token mangle. Anything touching the build pipeline has to be measured on a
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

**`owlab exec` never attaches stdin, so a pipe into it "succeeds" and writes nothing.** `printf
'hello-stdin\n' | owlab exec owrt2512 -- cat` prints nothing and exits 0 — `docker exec` is run
without `-i` (owfeed/owlab#21). Tell it apart from a real empty file with `printf 'x\n' | docker
exec -i owlab-luci-theme-footstrap-owrt2512 cat`, which prints `x`; the container is named
`owlab-<project>-<router>`. Push with `docker cp <file>
owlab-luci-theme-footstrap-<router>:<path>` instead, and clear `/tmp/luci-indexcache*` and
`/tmp/luci-modulecache` afterward if the file is a LuCI resource. Measured 2026-09-14, owlab 0.6.1.

**`owlab exec <stand> -- sh -c '…'` fails with `owlab: --config: stat …: no such file or directory`**:
owlab still parses its own flags after `--`, so `-c` is read as `--config` (owfeed/owlab#24); a
flag owlab does not define, like `ls -l`, passes through. Pass the command as one string:
`owlab exec <stand> -- "sh -c '…'"`. Measured 2026-09-14, owlab 0.6.1.

**`owlab test` fights the stands that are already up.** It synthesises its own router on host port
2222, and with stands running the bind fails — after it has already removed one of the existing
containers. The port can stay held after `owlab down` with `docker ps` empty (something outside
docker held it once): `ss -ltn | grep ':2222 '` must print nothing before `owlab test`. Either take
the stands down first, or assert the five `verify` things by hand on a running stand. If you do it by hand, log IN: an unauthenticated `curl` answers 403 and proves
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
which the session PATH carries (and `tools/bg.sh` keeps) but a scrubbed environment (`env -i`,
cron, a systemd unit) does not — reports exit 2 and measures nothing,
with the stands up. The two apart: `docker ps` lists the stands while `owlab status -json`
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

Start the waiter in the same turn as the run (CLAUDE.md "Verifying", T2): in the foreground as
`tools/bg-wait.sh <run-id> 5 270` with `timeout: 300000` for a run under 4.5 min, otherwise as a
background command, so finishing wakes you instead of you polling it:

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
A full `tools/ci-local.sh --mode push --force all` outlives the default: 2 h 14 min on
2026-10-12 (anchors `--full` on three engines and three stands is ~35 min an engine), so pass
`tools/bg-wait.sh <run-id> 30 10800`. A `timeout` there is the waiter's cap; read the `.status`.

**`tools/bg.sh` refuses `ssh`, `scp`, `sftp`, `rsync`, `dev-sync.sh` and every git or gh
subcommand off its read list.** The wrapper is allow-listed in `.claude/settings.json` and
the permission engine matches the first word of a command, so it cannot see an `ssh` inside
`tools/bg.sh sh -c '…'` — the form every T2 gate uses — and the wrapper would carry that command
straight past the `ask` rule guarding the hardware router, the one thing a wrong run breaks for a
person. Those commands run in the foreground, where the prompt reaches the human.
`tools/bg.sh --check <cmd>` prints `allowed` or `refused: <why>` and runs nothing; a test or probe
of the fence uses it, never the command itself.

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

**On System → System, `button.cbi-button-apply` selects "Скопир. из браузера" (Copy from browser),
not the Apply-changes control.** The page renders more than one element carrying that class, and the
Apply control itself is a `.cbi-dropdown` widget, not a `<button>`: the selector that actually reaches
it is `.cbi-page-actions .cbi-dropdown.cbi-button-apply li[data-value="0"]`. A repro battery keyed on
the bare class name clicked the wrong element on every run and reported NOT REPRODUCED for a fault
that was real.

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
binary, not the host install's drifted dev build: the identical 404 still prints
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

**`TaskStop` on a background command kills its outer shell, not a `sh script.sh` it started.** A
stopped chain kept waiting as its own process and would have raced its replacement to the same
commit. After stopping one, check `pgrep -af '^sh .*scratchpad/'`; kill the child by its exact command, and give a replacement a guard
that refuses to start while the old one lives.

**A process search inside `sh -c '…'` finds the shell running it.** `pgrep -f "npm run check"`, `ps |
grep build-css` and `pgrep -f "sh tools/ci-local"` all matched their own `sh -c`, whose command line
contains the pattern: two launchers waited forever and a CSS-build check reported a build that did not
exist. Anchor the pattern (`^node tools/`, `^npm run check`) and run the check from a script file, or
wait on a file's final line instead.

**A timing finding from `scroll-anchor` with a `longest frame gap` near its `landed Nms` is the page
not producing frames, not the theme deciding late.** Read the late trail beside it: the theme's
`wrote-…+T` is when the correction happened. A `T` far below `landed` with a gap that ends at `landed`
was the runner (task painted, `docs/anchoring.md`); a `settle` that itself sits at the end of the gap
was the theme waiting for that frame (task stall).

**Without `--no-pair`, `scroll-anchor` folds the `owrt*b` twin into the base stand for free
concurrency — and it is whatever code that twin happens to be running, not necessarily this
session's build.** `pairStands()` (`tools/lib/stands.mjs`) auto-pairs a running `-b` twin
(`owrt2512b`, `owrt2410b`, …) with its base the moment both containers are up and the caller did
not name the twin explicitly (`--only owrt2512,owrt2512b` opts out by naming it; `--no-pair` opts
out entirely) — a concurrent session's build, a stale sync, or a twin nobody ever synced at all
then measures under the base stand's own name. The symptom is two-sided: a real fix reads as a
false FINDING (the twin's half of the sweep never had it), and a page the twin's build does not
carry answers 404 and logs as "never opened", not as a defect. Tell the two apart by the file both
builds actually ship, not by the finding: `owlab exec owrt2512 -- md5sum
/www/luci-static/resources/fs-fit.js` against `owlab exec owrt2512b -- md5sum
/www/luci-static/resources/fs-fit.js` — a mismatch is the twin carrying different code, not a
result to act on; `owlab sync` the twin or re-run with `--no-pair`.

- **A stand has no `/etc/footstrap`, so an Appearance upload (pattern or login background) fails
  "No such file or directory."** `sync` deliberately never runs `root/etc/uci-defaults/…` (above:
  that is router state, not package content) and its own `post_sync:` step only reproduces the
  THEME REGISTRATION half of that script — it never runs the `mkdir -p /etc/footstrap` a real
  install/upgrade gets from the uci-defaults script itself, the directory the two upload symlinks
  and the pattern/login-background files live under. `fs-assets.js`'s upload handler then gets an
  `ENOENT` from the router for a directory the package always ships ready on a real install. Tell
  the two apart with `owlab exec owrt2512 -- ls -d /etc/footstrap`: missing is this, not a defect in
  the upload code. Fix with `owlab exec owrt2512 -- mkdir -p /etc/footstrap`, or run the uci-defaults
  script itself (`owlab exec owrt2512 -- sh /etc/uci-defaults/30_luci-theme-footstrap`), which is
  idempotent and safe to re-run on a stand `post_sync:` already registered.

**Two Playwright runs against two different stands at once can turn one visit into
`net::ERR_CONNECTION_RESET`.** Seen once: a pair run in parallel against `owrt2512`/`owrt2410` reset
a connection on port 8024, `owrt2410`'s own published port; the identical pair run sequentially, one
stand at a time, was clean. One occurrence is not enough to name a cause — tell it apart from a real
navigation fault the same way either way: re-run the same script alone against the same stand before
reading a connection reset as a theme finding.

**`luci-app-bandix` is not in the OpenWrt/ImmortalWrt feeds; install it from timsaya's own GitHub
releases, matched to the stand's arch and libc.** On `owrt2410` the first `opkg install` failed on
`zoneinfo-core` with `Checksum or size mismatch` — a stale package index, not a bad download —
cleared by a plain `opkg update` first. The backend cannot start inside an owlab container at all —
`owlab exec <stand> -- '/etc/init.d/bandix restart; logread | grep -i ebpf'` logs
`Failed to load eBPF program: map error: failed to create map`, eBPF needing kernel capabilities a
container does not have (owlab stands are containers, not VMs — `fidelity: vm` above is the closer
analogy, at a cost) — right next to the LuCI view still rendering and reaching the router over ubus
regardless, which is enough to reproduce a DOM/CSS bug like issue #56's; anything that needs
bandix's own RPC data answering for real needs `fidelity: vm` or hardware instead.

**A full load's `<body>` children are not in a stable order across runs.** `ui.js`'s `UI.__init__()`
sometimes appends `#modal_overlay`/`.cbi-tooltip` before the parser reaches `footer.ut`'s own
`<script>` tag, and sometimes after — which one wins depends on when its own fetch resolves, not on
anything this theme controls. A census of `document.body.children` compared in ORDER between two
runs of the identical page reads the ones where the race went the other way as a regression. Compare
as a MULTISET instead: `Array.from(document.body.children).map(el => el.tagName + '#' + el.id + '.' +
el.className).sort()`, duplicates counted, never a plain sequence diff.

**A snapshot stand can answer 502 because its ucode and luci-base come from different days.** On
2026-10-21 the local `owrtsnap` served 502 on every LuCI page with `Error relocating
/usr/lib/ucode/html.so: ucv_metamethod_lookup: symbol not found` in `logread`: ucode 2026.04.24
against luci-base 26.291, while `owrtsnapb` with ucode 2026.10.18 answered. A live gate then reports
`owrtsnap` as not answering, not the theme. Check `curl -s -o /dev/null -w '%{http_code}'
localhost:8022/cgi-bin/luci/` and `logread | grep relocating` before reading a snapshot finding;
recreate the stand, or measure on `owrtsnapb`.

- **Exec bits lost in a host move are invisible while `core.fileMode=false`.** `git status` stays
  clean, and a gate then dies with `Permission denied` on a `tools/*.sh` or `node_modules/.bin/*`
  that is no longer executable. Compare the index with the disk: `git ls-files -s | grep -c '^100755'`
  against `find . -path ./node_modules -prune -o -type f -perm -u+x -print`, or per file
  `git ls-files -s tools/stage.sh` (`100755`) against `test -x tools/stage.sh`. Restore with
  `chmod +x` and `git update-index --chmod=+x` only where the index says `100644` by mistake.

- **Never run `git worktree prune` while a session worktree is live.** It deletes the metadata of
  any worktree whose directory it cannot see at that moment (an unmounted path, a moved checkout),
  and the session's next `git` call there fails `fatal: not a git repository`. Protect a live one
  with `git worktree lock --reason "session" <path>`; `git worktree unlock` when it is done.

- **A `claude --worktree` session installs its own `node_modules`.** `settings.json` does not symlink the
  main checkout's through `worktree.symlinkDirectories`: `npm ci` in a worktree would delete and rewrite
  the main one. The pre-push hook links it only when the two lockfiles match, and runs `npm ci` otherwise.

- **`ucode` is not on the host; it lives in a stand.** `ucode -T -c -o /dev/null <file>.ut` from the
  host reads `command not found`. Run it where LuCI runs: `docker cp <file>.ut
  owlab-luci-theme-footstrap-owrt2512:/tmp/` then `docker exec owlab-luci-theme-footstrap-owrt2512
  ucode -T -c -o /dev/null /tmp/<file>.ut`. If `ucode` is installed locally, the plain form works.

- **Every page shows `RPCError luci/getFeatures` on a stand whose containers are all up: `ubus` lost
  its `luci` object while `rpcd` kept its PID.** Seen once, on `owrt2512d`; the cause is not known.
  Tell it apart: `owlab exec owrt2512d -- ubus list luci` prints nothing while `owlab exec
  owrt2512d -- pidof rpcd` still answers the PID it had before. Restore with `owlab exec owrt2512d
  -- /etc/init.d/rpcd restart`; that is the stand, not the theme.

- **`zsh:1: ====X not found` from a line that only prints is the host shell, not the command.** The
  Bash tool runs the user's `zsh`, whose `EQUALS` option expands a word that starts with `=` into
  the path of the command named after it: `echo =====X` exits 1 with `====X not found`, and the same
  happens to a `=` separator in an `echo`. Four sessions lost a call each to it. Tell it apart:
  `bash -c 'echo =====X'` prints the word. Quote any word that starts with `=` (`echo '=== X'`).

- **`Exit code 137` on a long gate is SIGKILL, and on this WSL host the sender is the OOM killer.**
  A `timeout`-bounded `npm run check` in a prepush worktree died with 137, not `timeout`'s 124, while
  stands and browsers were up (2026-10-07). Tell the two apart: `dmesg | grep -i 'killed process'`
  names the victim when it was memory; 124 is the clock. Bring fewer stands up for the run
  (`docker ps | grep -c owlab-`) and keep one browser gate at a time.

- **A hardware test build versioned `X.Y.Z_pN` never gives way to the release.** On apk `_p` is a
  patch level and sorts ABOVE `X.Y.Z`, so `apk upgrade` keeps the test build and the router had to be
  downgraded by hand. Measured 2026-10-19 on the stands: `apk version -t 0.14.15_rc1 0.14.15` → `<`
  and `0.14.15_p1` → `>`; opkg sorts both `_rc1` and `_p1` above the release and only
  `0.14.15~rc1` below (`opkg compare-versions 0.14.15~rc1 '<<' 0.14.15`), which apk rejects
  (`apk version -c` → invalid). So stamp an apk test build as the NEXT version's candidate
  (`FOOTSTRAP_VERSION=0.14.16_rc1` over 0.14.15): it upgrades the router and yields to 0.14.16. An
  opkg test build needs `opkg install --force-downgrade` back to the release.

- **Every page on `owrtsnap` fails with `L is not defined` (or `window.L.require` undefined, or a
  20 s `menuPaths` timeout) while `owrt2512`/`owrt2410` are clean: that stand's LuCI answers 502.**
  The rootfs (`openwrt/rootfs:x86_64-master@sha256:2659c3a9`, 2026-10-19T02:46Z) links `ucode` to
  `libucode.so.20230711`; the 2026-10-20 feed installs `ucode-mod-html` built for `libucode20261009`
  (`ucv_metamethod_lookup`). Tell it apart: `curl -s -o /dev/null -w '%{http_code}'
  <stand>/cgi-bin/luci/` prints `502`; `docker exec owlab-<project>-owrtsnap sh -c 'ldd /usr/bin/ucode;
  apk version -l "<"'`. Fixed in owlab 0.6.6 (owfeed/owlab#42: a rolling release runs `apk upgrade`
  before installing), which `build.yml` pins. The gates say `LuCI answered 502 … — the stand, not the theme`.

- **`tools/ci-local.sh --force live:*`/`deep:*`/`anchors:*`/`playground` stays green on a feed
  drift CI goes red on: the leg reuses the cached stand.** It runs `owlab up` without `--rebuild`,
  so the container keeps the packages it was built with. Tell it apart: `docker exec owlab-luci-theme-footstrap-<stand> apk
  version -l '<'` lists what the feed has moved past (`opkg list-upgradable` on 24.10). Reproduce in
  isolation: copy `owlab.yaml` with its own `project.name` and CI's `image@digest`, then
  `OWLAB_CONFIG=<copy> owlab up --rebuild <stand>`; the 9 real stands stay untouched. A leg now stops
  only the stands it started (`notRunning`, `tools/lib/stands.mjs`); a bare `owlab down` stopped all 9.

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

**`./tools/stage.sh` on macOS, and under busybox awk 1.38, used to print `strip-assets: 2 file(s)`
(today `strip-build: assets: N file(s)`) and ship `logo.svg` unstripped — 1338 B with its `<!-- -->`
comment still in it, instead of the real 593 B (550 B today: -30 B for the cyan fill stated once on
the root `<svg>`, -13 B for the squeezed `<style>` block, each measured through `strip-build.sh
assets`).** `strip-assets.sh` (now `strip-build.sh assets`) slurped each file with `awk 'BEGIN { RS
= "\0" } …'`, relying on a gawk- and mawk-only extension that treats a NUL `RS` as "whole file, one
record". Neither macOS's bundled awk (one true awk, 20200816) nor busybox awk 1.38 has that case:
both fall back to `strlen(RS) == 0`, i.e. paragraph mode, and split `logo.svg` on its one blank
line, so the comment-stripping regex only ever saw half the file — CI only ever passed because its
runner's `/usr/bin/awk` is gawk. Tell the two apart with `stat -f %z
dist/root/www/luci-static/footstrap/logo.svg` (550 correct, anything else is the bug) or `grep -c
'<!--'` on the same file (0 correct). Fixed now: the script accumulates lines in the main `awk`
block and processes the buffer in `END`, no `RS` tricks, and refuses to ship if a comment or a
newline survives the strip on any awk.
