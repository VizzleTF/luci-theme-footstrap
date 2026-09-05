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

### The two cheap browser gates: `smoke` and `computed-diff`

Between the static gates and a stand there is a step that costs seconds and catches the regression
that is in the FILE rather than in the page. Both drive `docs/gallery.html` — every widget LuCI or a
third-party app can emit, with the real class names, and no router.

```sh
npm run smoke            # ~1.4 s: the modules come up in a real DOM, the axes stamp in order
npm run computed-diff    # ~4 s: worktree vs HEAD, getComputedStyle over every element
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

**Neither replaces a userland run, and a green one never earns a release the right to skip owlab.**
The gallery has every widget and none of the pages: no menu, no chrome, no session, no third-party
sheet, no rpc, no container query answered by a real viewport, and every dependency in `smoke` is a
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
  for Linux). A new engine needs its own baseline, created by one `--update` run.

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

## The stand's own traps

Every one of these cost a measurement that read as a regression in the theme. They are written down
because each was hit more than once.

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

**When a live gate goes red, build the PARENT COMMIT.** Package it, install it the same way, run the
same narrowed check. A finding that reproduces there did not come from the change under test. That is
how the anchor regression in 0.14.3 was pinned to one commit out of thirty-seven, and how both
findings above were shown to belong to their apps.

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
