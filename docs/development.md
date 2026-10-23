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
boot them is to give owlab a `routers:` entry to read. They are not an e2e target and not in
`tools/lib/stands.mjs`'s `CORE`, and answer a question about the ImmortalWrt brand, never a
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

**A template** — with the same `trycompile` LuCI uses:

```sh
owlab exec owrt2512 -- 'ucode -T -c -o /dev/null \
  /usr/share/ucode/luci/template/themes/footstrap/header.ut'
```

**CSS** — not with screenshots. Live counters (uptime, DHCP leases, wifi signal) move 0.5–1.3% of
pixels between two runs of the *same* stylesheet, while a real regression weighs 0.19%. Diff computed
styles instead: load the page once, swap the `<link>` for the second sheet, snapshot
`getComputedStyle` over every element. Method and traps: [css.md](css.md).

**Behaviour** — on a router: `tools/e2e.mjs` for the package's life and every menu page (next
section), and by hand on a synced stand for what it does not judge — a layout, a fold, an axis.

`build-css.sh` additionally checks its own brace balance and refuses to write a suspiciously short
file.

Nothing in `package.json` reaches the package: the OpenWrt buildbot has no node.

### What earlier measurements established

These were found by measuring the gallery (`docs/gallery.html`) and live pages, and each explains a
rule in the code that would otherwise look arbitrary.

- **A module's exports are a contract between files.** `fs-appearance.js` once called
  `axes.currentContentWidth()` while `fs-axes.js` exported no such name: `build()` threw inside the
  one try/catch `mount()` wraps it in, and the "Footstrap" section vanished from System with no
  other symptom. Each colour axis writes `--fs-<x>-h` before `data-<x>` (`fs-axes.js`); inverting
  the two writes is a visible fault.
- **The source tree is not what a router runs.** A package carries the uglify-js-minified,
  token-mangled `fs-*.js` and `header.ut`, and the mangled sheet names the axis properties by the
  map (`--fs-tint-h` is `--aJ` there); `fenceRules` is a `/* fs:probe */` export the stage strips.
  Router bytes are the mangled sheet, 115,927 B against the readable 134,210 B.
- **A fault can need the phone width.** The switch-knob overhang (task 0145) measured nothing at
  1280 and a `width` of 26.80px against 40px declared at 390: the knob (`::after`,
  `position: absolute`) stays anchored to the pill's declared width while the pill shrinks under a
  longer caption. Held by `flex-shrink: 0` on `.cbi-checkbox > label[for]`
  (`styles/theme/60-inputs.css`); Density=Large is the axis that exposed it on a 360px screen.
- **Physical offsets break RTL.** `margin-inline-start`, not `margin-left`, in
  `theme/65-dropdown.css`; the pre-8430a64 `.cbi-dropdown > ul > li[selected]` over-reached under
  `forced-colors: active`. The `:focus-visible` repair needs its `!important` there: without it 4 of
  186 focusables (`h3`, `button.fs-ap-fold`) showed no `Highlight` outline.
- **Russian text runs 1.3-1.6x English**, and the faults it exposed were length faults. The
  Port-status tile's stat line and the upload strip's Create/Cancel row were both `white-space:
  nowrap` inherited from a text-only ellipsis rule (`styles/base/95-luci.css`) with no text to
  ellipsis — a nested flex row, not a sentence; the checkbox caption's one unbreakable word needed
  `overflow-wrap: anywhere`. A WireGuard public key inside an inline `<code>` had no `overflow-wrap`
  and a firewall rule-jump tooltip's `white-space: pre` refused to wrap at all
  (`base/20-typography.css`, `base/90-widgets.css`).
- **Truncation that is on purpose:** the closed `.cbi-dropdown > ul > li` ellipsis
  (`styles/theme/65-dropdown.css`; a flex item's automatic minimum stops `overflow: hidden` eliding a
  value past the 400px cap). No `title`/`aria-label` is added: a `title` is not announced on touch
  and a shortened `aria-label` breaks WCAG 2.5.3. The file browser's breadcrumb and filename column
  (`styles/base/95-luci.css`) ellipsise instead of wrapping, and `.cbi-tabmenu > li { max-width:
  100% }` (task 0149) shrinks a long tab label to an ellipsis. `.zonebadge .cbi-tooltip`'s
  `margin: -1.6em 0 0 -5px` (`styles/base/90-widgets.css`) is an overlap trick, not reserved room.
  The gallery's `#g-longlabel` is a deliberately unbreakable 38-character run built for
  `styles/base/30-forms.css`'s `min-width: 0` floor; no CSS fits it in 320px.
- **The section-table card asks at 992, not 960** (task 0163). `.cbi-section-table` cards at
  `@container fs-content (max-width: 960px)`, the same machinery a config table with inline widgets
  uses, rather than a scroll fallback that would clip an open `.cbi-dropdown`/`.cbi-dynlist` list.
  `fs-content` binds to `.cbi-map`, one level above the `.cbi-section` that spends `--fs-card-pad`
  (16px a side) before the table sees the width: firewall zones' `.cbi-map` sat at 968px while the
  section handed the table 936px for a 1017px Russian header. 992 (960 + 32) corrects that fixed
  offset in the query's own frame, for any column count, language or viewport. A `.cbi-map`-pinned
  specimen with those numbers is in `docs/gallery.html`.
- **Limits that belong to the apps**, each checked against the markup: ssclash's "Additional
  Settings" panel renders an inline `grid-template-columns: repeat(auto-fit, minmax(320px, 1fr))`,
  a 320px floor that cannot fit a 320px column once the section's padding is subtracted, in any
  language; filemanager sets an inline `width: 400px`; the dashboard widget's classes (`radio-info`,
  `wifi-info`, …) appear nowhere in `styles/`; ACE renders its own virtualised layers; an RRD graph
  on `/admin/statistics/graphs` is a bare `img` at its native width, which a phone cannot see whole
  (usability debt, not a regression). `input.cbi-section-create-name` and LuCI's `form.TextValue`
  textareas carry no accessible name because the `.cbi-value-title` label has no `for=` — markup in
  luci-base or the app, outside this package's fence. `.cbi-dropdown[empty] > ul { max-width: 1px }`
  (`theme/65-dropdown.css`) collapses an unselected multiselect's placeholder list on purpose.
- **A client-navigation race needs time a stand does not give.** The router's own staging window is
  ~210 ms on a stand against 1.2 s on real hardware, and a Back that commits while the incoming page
  is still being built clamps the UA's restore to 0; the fs-fit.js correction that moved the reader
  landed 419 ms after the commit. Holding the incoming module fetch or ubus calls open (a Playwright
  route) is what makes such a race reproducible on a stand.

### Git hooks

The repository keeps its hooks in `.githooks/`, which is not active until you point git at it:

```sh
git config core.hooksPath .githooks
```

`commit-msg` strips Co-Authored-By, `Claude-Session:` and "Generated with" trailers from whatever
wrote them, and leaves `Signed-off-by` alone — openwrt/luci refuses a sign-off with a
`@users.noreply.github.com` address, so that line is load-bearing.

## Proving it on a router: `tools/e2e.mjs`

`tools/e2e.mjs` is the one check, and the local form of CI's `e2e` job (one per package manager). It
lives the package's whole life on one running owlab router, the way an admin lives it:

1. install the last published release — Footstrap is offered in Language and Style and the active
   theme is left alone (the README has the admin pick it there);
2. the admin picks footstrap and saves a footstrap uci setting;
3. upgrade to this build — the theme choice and the setting must survive (an opkg upgrade once
   flipped every 24.10 user back to bootstrap);
4. every menu page is opened by a full load at 1280 and 390 px and by a click in the chrome, then
   the same pages under bootstrap;
5. remove the package — LuCI falls back to bootstrap and still serves the login;
6. a fresh install of this build — offered, the active theme left alone.

A page fails only for what footstrap adds — a JS error, a failed same-origin request, a view that
never renders where bootstrap renders — or if footstrap's stylesheet or chrome is missing (LuCI falls
back to another theme silently on a broken template). Stock bootstrap on the same router is the
reference, so there is no list of expected problems.

```sh
FOOTSTRAP_VERSION=9999.0.0 ./tools/stage.sh && owfeed build    # above any release: step 3 is an upgrade
gh release download --pattern 'luci-theme-footstrap-*.apk' --dir ../tmp/old
owlab up owrt2512
node tools/e2e.mjs --router owrt2512 --old ../tmp/old/luci-theme-footstrap-*.apk \
  --new dist/noarch/luci-theme-footstrap-[0-9]*.apk
```

and the same on `owrt2410` with `luci-theme-footstrap_*_all.ipk` and
`dist/all/luci-theme-footstrap_[0-9]*_all.ipk`. Done means both: 25.12/apk and 24.10/opkg. It exits 0
when every step passed and 1 otherwise; `report.json` and one screenshot per page and width land in
`--out` (default `../tmp/e2e-<router>`), which CI uploads as `e2e-<router>`.

The router it gets must carry LuCI and its apps but not this theme — `owlab up` alone, no `owlab
sync` — and e2e installs, removes and switches themes on it; `owlab sync` afterwards puts the working
tree back. A run over every menu page outlasts a foreground call: detach it with `tools/bg.sh` and
pair it with `tools/bg-wait.sh`.

**Pin exact point releases.** `owlab.yaml` pins `25.12.4` / `24.10.8`; `25.12` or a snapshot works
today and fails within days.

For anything e2e does not judge — a layout change, a fold, an axis — drive the running container by
hand:

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

Nothing automated runs against hardware: e2e and the playground drive owlab routers only. A hardware
run happens on the maintainer's explicit word for one change, never by reflex, and `dev-sync.sh` and
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

`tools/playground/{capture,build}.mjs` turn an owlab stand into a static, offline site — CI's own
`playground` job, [ci.md](ci.md). Each step needs the one before it (`capture` needs a booted,
installed router; `build` needs `capture`'s output) and the chain is a router-driving Playwright
run: detach it with `tools/bg.sh` and pair it with `tools/bg-wait.sh` in the same turn rather than
waiting on it in the foreground.

```sh
owlab up owrt2512 && owlab install owrt2512 'dist/noarch/luci-theme-footstrap-*.apk'
tools/bg.sh sh -c '
  npm run playground:capture &&
  npm run playground:build -- --base /luci-theme-footstrap/playground
'
tools/bg-wait.sh <run-id>
```

Each script also takes its own flags directly (`--recording DIR`, `--out DIR`, `--base /path`) —
`--help` on either prints the exact list. Output lands under `../tmp/playground/` by default
(`recording/`, `out/`, `playground.tar.gz`), never inside the checkout. Open
`../tmp/playground/out/cgi-bin/luci/admin/status/overview/index.html` in a browser under any static
server rooted at `--base` to look at what was built.

The site opens on a login page (`BASE/cgi-bin/luci/`, prefilled `root`/empty like a real router)
that accepts any credentials — a static site has no server left to check them against — and
`.fs-logout` returns to it; `build.mjs` refuses an old `--recording` made before `capture.mjs`
saved the login form, naming the fix (re-capture) rather than shipping a playground with no login
page.

Capture timing, measured: the dashboard `login()` lands on lazy-loads `view/dashboard/include/10_router.js`
(owlab.yaml) while the loop's first `goto` fires, so that response's body is already discarded; the
`luci-mod-status` includes (10_system.js, 60_wifi.js) arrive ~0.5-0.6 s after `load` locally and
later on a fresh CI container, and a fixed 300 ms settle dropped 8 of 9 overlay keys; one body read
hung ~148 s on owrt2512b, past capture's 5-minute kill, hence the 15 s bound in `drainReads`.

Two harness facts hold behind `tools/lib/stands.mjs`, which `capture` reads the stand through:

- **`sealToRouter()` aborts every request that leaves the router's origin** (data:/blob: pass), so a
  run stops depending on github.com and its rate limit: ssclash asks GitHub for a release on two
  pages and a CI runner got 403. The route is a predicate and never a catch-all glob: a glob hands
  every request, hundreds the router serves itself, to a JS callback, and pushed a CI job 17 minutes
  past its 45-minute limit. It aborts rather than faking a 200, which the page would render.
- **`menuPaths()` waits for `window.L.require` before asking for `ui`:** `L.ui` exists only once
  something has required ui.js, and the 24.10 leg crashed with "Cannot read properties of undefined
  (reading 'menu')" straight after the login redirect while 25.12 was fine. The tree arrives rooted
  at `admin`, so the walk starts with an empty path (seeding `admin` yields `/admin/admin/...`, a
  sweep of 404s that reads as a clean run).

## The stand's own traps

- **A pattern upload fails on a synced stand with no error from the theme; the stand has no
  `/etc/footstrap` and no `/etc/config/footstrap`.** `owlab sync` copies `htdocs/` and `ucode/`
  but never writes `/etc/config`, and uci-defaults (which makes the directory) does not run on a
  sync. A packaged install has both. Tell it apart:
  `docker exec owlab-luci-theme-footstrap-owrt2512 ls /etc/footstrap /etc/config/footstrap` — a
  missing path is the stand, not the theme. Restore with `docker cp
  luci-theme-footstrap/root/etc/config/footstrap <ctr>:/etc/config/footstrap` (then
  `chown 0:0`, the uid-1000 trap below) and `mkdir /etc/footstrap` inside it.

- **A 404 on a theme resource from `owrt2512b`/`owrt2410b` while the primary stands are green is
  an unsynced twin, not a missing file.** `owlab sync` without a stand name syncs the primaries
  only; a twin keeps whatever it was booted with. Tell it apart: `md5sum` the resource on the host
  and in both containers (`docker exec owlab-luci-theme-footstrap-owrt2512b md5sum
  /www/luci-static/resources/fs-router.js`) — a twin that differs or lacks the file needs
  `owlab sync owrt2512b`.

- **A `pageerror` `RPC call to uci/get failed with error -32002: Access denied` on the login
  document is upstream LuCI, not the theme.** `luci.js` boot requires `form`, and `form.js:10` on
  the openwrt-24.10 and openwrt-25.12 branches runs `uci.loadPackage('luci').catch();` — a
  `.catch()` with no handler, so the anonymous session's (`sid` 000…) denial goes unhandled. Master
  has `.catch(() => {})`; neither release branch carries it. Measured 2026-10-11, 30 runs each,
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
  left. Tell the two apart with `docker ps --format '{{.Names}}' | grep owlab-luci-theme-footstrap`
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

- **A stand rebuilt with `owlab up --rebuild` carries NO theme until `owlab sync`.** Every page then
  logs `NetworkError: HTTP error 404 while loading class file "/luci-static/resources/fs-prefs.js"`,
  and a run that does not read those lines measured nothing while looking clean. Always `owlab sync`
  after a rebuild, and treat a 404 there as "the stand is empty", not as a finding.

- **Never pipe a long run into `tail`, `sort` or a bare `grep`.** The output buffers until the
  command ends, so a hang looks exactly like progress. A full sweep did this on 2026-09-09: the
  process sat alive and idle for 73 minutes with no output, where CI takes about 90 seconds a
  stand. `grep` is the one that catches you by accident — filtering noise through `| grep -v …`
  buffers in 4KB blocks, so a run that was printing a line a second looked mute for minutes
  (2026-09-10). Write to a file and read the file as it grows (`grep --line-buffered` if it must be
  a pipe), and give any local run a `timeout`.

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

- **Two runs against the same stands invent findings.** Measured 2026-09-12: a second sweep started
  37 s after the first reported 12 findings — `the reader drifted 46/88/138px across real poll ticks`
  at every density and both layouts, on two stands — where either alone read none. A finding that
  appears on many cells at once, evenly across an axis, is this and not the theme.
  `requireStands()` (`tools/lib/stands.mjs`, which `tools/playground/capture.mjs` uses) takes `flock`
  on `../tmp/stands-<id>.lock`, one per stand in sorted order, and holds it for the whole run; a
  second run on the same set waits, and says who holds it. `../tmp` there is the main checkout's from
  every linked worktree too (`tools/lib/tmp-root.sh` and `.mjs`, the git common dir). The holder is a
  child `flock` kept alive by its stdin pipe, so the kernel frees the lock on any exit, SIGKILL
  included, and the wait is bounded (30 min, `STANDS_LOCK_TIMEOUT_MS`). The lock is advisory:
  `owlab sync`, `owlab up`, `owlab test` and `tools/e2e.mjs` do not take it, so no `owlab sync` while
  another run measures a stand.

- **`owlab: command not found`, or `spawnSync owlab ENOENT` from `tools/e2e.mjs`, while every stand
  is up means the shell cannot find `owlab`, not that the stands are down.** `owlab` is a Go binary
  in `~/go/bin`, put on `PATH` by the login profile — and a login shell that dies part-way through
  that profile on something unrelated (measured 2026-09-11: a stale `deno/env` path from another
  project, printed as a bare `No such file or directory` with no mention of owlab) leaves `PATH`
  half-built; a scrubbed environment (`env -i`, cron, a systemd unit) never had it. Tell the two
  apart with `docker ps --format '{{.Names}}\t{{.Ports}}'`: containers running means the ports are
  there and only the CLI is gone. Export the path into the command itself:
  `tools/bg.sh sh -c 'export PATH=$HOME/go/bin:$PATH; node tools/e2e.mjs …'`.

- **A page that pins the browser's main thread stops a Playwright run DEAD.** `page.evaluate()` is
  the one Playwright call with no timeout at all: it waits for the page's own thread, and a page
  stuck in a loop never gives it back. Measured 2026-09-10 (task liveslice):
  `/admin/system/filemanager` under `fs-fit.js` at `13e9864` left the renderer at ~105% CPU for as
  long as it was allowed, and two CI jobs were cancelled at their 45-minute cap on every run for a
  day — with an empty log, because nothing said which page it was on. Print a line per page with the
  clock on it; a run that stops then has the answer as its last line.
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

- **A local stand keeps the app versions it was built with; CI boots today's feed.** A finding red
  in CI and silent locally can be an app that moved: a CI run (2026-10-18) found
  `/admin/dashboard|768|clipped|div.cbi-section` on owrt2512 with `luci-mod-dashboard`
  26.288.56989~75a306d, while the local stands still carried 26.251.57781~0f38c02, from before
  upstream reworked the dashboard into KPI cards. Tell it apart: the CI job log prints every
  installed version; compare with `owlab exec owrt2512 -- apk list -I luci-mod-dashboard`, and
  reproduce in a throw-away container from the stand's image after `apk add -u <app>` rather than
  upgrading a shared stand.

- **A freshly started stand has no theme.** `owlab up` boots the image; the theme arrives only with
  `owlab sync`. Seen on all 9 stands after `owlab test` had taken them down (2026-10-18). Tell it
  apart: `owlab exec <stand> -- ls /www/luci-static/footstrap` fails on an unsynced stand. Run
  `owlab sync` on every stand after `owlab up` before measuring the working tree — and not before
  `tools/e2e.mjs`, which wants the router without the theme.

- **`pkill -f <pattern>` kills the shell you typed it in.** `-f` matches the full command line, and
  the wrapper `bash -lc "pkill -f probe-one …; node probe-one.mjs …"` contains the pattern, so the
  whole chain dies before the command after the `;` runs — and it looks exactly like a run that
  produced no output. Bracket the first character (`pkill -f "[p]robe-one"`), or kill from a separate
  call.

- **A piped command's status can come back empty.** On 2026-09-09 a piped run reported an empty
  exit status and read as success while it had actually failed; the failure was only caught by
  reading its printed text. Judge every run by what it printed, never by a status.

Every one of these cost a measurement that read as a regression in the theme. They are written down
because each was hit more than once.

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
fixed, so do not name one here as if it were.** Task 0177: a finding on `owrtsnap @1440 side
compact` traced to the Overview page rendering 12 `.cbi-section` there against
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

**`mangle-tokens.sh` fails on a `C:\...`-shaped path with `mv: cannot stat ...tmp.NNN`, and whatever
calls it (`tools/stage.sh`) reports the failure as its own.** Like `build-css.sh`, it needs a POSIX
path. A failed run also leaves droppings in the checkout ROOT — files named like
`C<...>cascade.css.tmp.248` — that have to be removed by hand: `git clean` is not safe here, because
the same root holds untracked files that are wanted.

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

Put it back with `uci delete uhttpd.main.listen_https` — a stand left listening on 443 answers on
two schemes and one of them has a self-signed certificate. Comparing against stock is
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
next. A probe did exactly that for two days: the next measurement read the content column's floor
while a live tick was rewriting the sections under it, and CI reported `the content column's floor
is not holding the document up`, 120px, on webkit/owrt2410 @390 top compact. The theme was not
involved — the finding followed the PROBE across four runs. Keep a stopped poll stopped until the
measurement that wants ticks starts it. Tell this apart from a theme fault by the shape: a floor
finding that only CI sees, on a cell a local repeat cannot reproduce.

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

**A page-scoped rule cannot be read off the gallery.** `docs/gallery.html` carries no
`body[data-page]`, so a rule written `body[data-page="admin-status-overview"] …` matches nothing
there, and a measurement of the gallery has not looked at the change. Take the reading off the
playground or a stand, and compute any contrast the rule introduces by hand. Measured this way for
the Overview card restyle: `--fs-good` on `--fs-panel2` is 4.59:1 at its worst (footstrap/dark)
across all five palettes, both modes.

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
`luci.main.mediaurlbase` to another theme exactly as [package.md](package.md) requires. The next
measurement then reads bootstrap and reports the theme as broken — 78 findings on one sweep, 156 on
the next, every one of them the wrong theme. Put it back:

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
docker held it once): `ss -ltn | grep ':2222 '` must print nothing before `owlab test`. Take the
stands down first.

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

**A run killed by a timeout reports a browser bug, not a finding.** `page.waitForTimeout: Target
page, context or browser has been closed` with an empty `log: []` is the run being SIGTERMed
mid-way — a sweep over every menu page does not fit in five minutes. The two apart: a real failure
names the page and what failed; a killed run prints a Playwright stack. Never re-run it with a bigger
foreground timeout: `tools/bg.sh`, report the run-id, and pair it with a waiter (below).

**A detached run needs a waiter, or it is a run nobody reads.** `tools/bg.sh` calls `setsid`: the
process outlives the shell that started it and nothing announces its end. The log and a `.status`
file next to it are the whole interface, and `.status` appears only when the run is over — which
makes "is it done?" a question you have to keep asking, and therefore one that gets forgotten. It
was forgotten three times in a single session here, twice while somebody was waiting on the answer,
each time for 15-30 minutes after the chain had already finished.

Start the waiter in the same turn as the run: in the foreground as
`tools/bg-wait.sh <run-id> 5 270` with `timeout: 300000` for a run under 4.5 min, otherwise as a
background command, so finishing wakes you instead of you polling it:

```sh
tools/bg.sh sh -c '…'            # prints run-id and log path
tools/bg-wait.sh <run-id>        # blocks until .status exists, prints `exit: N` and the `name:` lines
```

The waiter costs nothing while the run is going and turns the result into an event. A run whose log
nobody opened is not a green run — that rule is older than this note; the waiter is what makes it
practical to honour.

It stops on three things rather than one: the `.status` file, the run's own pid disappearing
(`<run-id>.pid`, written by the inner shell — a run killed by SIGKILL, by a reboot or by the
machine sleeping never writes a status, and waiting for that file alone waits forever), and a cap,
`tools/bg-wait.sh <run-id> [interval] [max]`, 7200 s by default. The last two print
`exit: process-gone` and `exit: timeout` and exit 2: a waiter still alive when the session ends
wakes it later with a verdict nobody asked for. A `timeout` there is the waiter's cap; read the
`.status`.

**`tools/bg.sh` refuses `ssh`, `scp`, `sftp`, `rsync`, `dev-sync.sh` and every git or gh
subcommand off its read list.** An allow rule for the wrapper is the natural one to add, and
the permission engine matches the first word of a command, so it cannot see an `ssh` inside
`tools/bg.sh sh -c '…'` — the form every detached run uses — and the wrapper would carry that command
straight past the `ask` rule guarding the hardware router, the one thing a wrong run breaks for a
person. Those commands run in the foreground, where the prompt reaches the human.
`tools/bg.sh --check <cmd>` prints `allowed` or `refused: <why>` and runs nothing; a probe of the
fence uses it, never the command itself.

**"It is the app's markup" is a claim, and switching the stand to bootstrap is how you check it.**
A finding on a third-party page reads as the app's, and the reflex is to wave it through. Point the
stand at the stock theme instead, re-measure the same page at the same width, and compare:

```sh
owlab exec owrt2512 -- uci set luci.main.mediaurlbase=/luci-static/bootstrap
owlab exec owrt2512 -- uci commit luci                 # …and put it back afterwards
```

Three `overflow` findings on `ssclash/config` at 320 looked like the app's split button, which is an
`inline-flex` the app styles inline — and the theme sets no width on it at all. Under bootstrap the
same page overflowed by nothing: the wrapper takes its buttons' max-content, and this theme's
buttons are 295px where stock's are 245, its face being wider than the system stack even at a
smaller size. The finding was ours. This is also why `tools/e2e.mjs` judges every page against
bootstrap on the same router rather than against a list.

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

**When `tools/e2e.mjs` goes red, build the PARENT COMMIT.** Package it, install it the same way, run
the same check. A failure that reproduces there did not come from the change under test. That is
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
involved (owfeed/owlab#18, closed within the hour). `owlab`
0.6.1's `internal/pkgmgr.UpdateShell` now continues the refresh once at least one feed has answered
and only aborts when none has — reproduced locally (`owlab up owrtsnap`, `owlab install owrtsnap
dist/noarch/luci-theme-footstrap-*.apk`, task 0173) against a freshly downloaded `owlab 0.6.1`
binary, not the host install's drifted dev build: the identical 404 still prints
(`ERROR: wget: exited with error 8` / `unexpected end of file` on
`kmods/6.18.33-1-70e27cfe28d8cb55760256504e7c02fe/packages.adb`), but the router boots and the
package installs anyway, and the log now names the gap rather than staying silent about it —
`owlab: apk update: partial refresh, 7 feed(s) read, 10206 packages available; the feed above did
not answer and its packages will be missing`. What is worth knowing going forward is the shape of
that line in a log, not how to survive its absence.

**`install.sh` carried the identical trap one layer down, and "packages available > 0" turned out
not to be the signal that separates a partial refresh from a total one.** Task 0175, run 34112646188:
an install on `owrtsnap` died at `apk update`, same dead kmods sub-index as above, but this time
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

**`install.sh`'s "is the installed version current" test is "not older than the feed's", never
equality.** `apk add` on a package already in `world` keeps the old version and exits 0, so
"installed, registered, cascade.css present" was all true on a router still running the previous
release; equality, on the other hand, fails a correct install of a build newer than the feed's.
Since the theme joined the official openwrt/luci feed, `apk list` answers with two builds of one
name, one stamped from git's commit date (`26.246.70755~4fd72fd`) that only grows, so a plain
`sort -V | tail -1` picks the foreign build and calls a correct install "behind". A leading number of
26 or more is that foreign build: the rule `install.sh` pins in `is_foreign_luci_build()`.

**A `geometry|fs-content` reading whose offset equals the gap between the two viewport widths just
measured is a staleness race, not a layout break — re-sample past 620 ms before believing it.**
`fitChrome()` steps aside for the whole `SCROLL_IDLE` window (400 ms, `fs-fit.js`) whenever
`fit.scrolling()` answers yes, and a resize starts that window too, so a `contentWidth()` sample
taken 220 ms after `setViewportSize` read the PREVIOUS width. Task staleouter: `owrt2410
/admin/status/vnstat2/config | 568 | geometry | fs-content (-178)` — `-178` is exactly `568 - 390`,
and the same shape held at every step (`-70` at 320→390, `-256` at 1024→1440). Confirmed with
`probe2.mjs`/`probe3.mjs` (`../tmp/task-vnstat/`): `model=358 real=536 scrolling=true` at 220 ms,
`off=0` once resampled past 620 ms. Fixed in `fs-chrome.js`'s `contentWidth()`, which now re-reads
the window's width on every call rather than trusting the last fitter's cache (`docs/chrome.md`,
"`data-narrow`: ..."); do not "fix" a recurrence of this shape by sampling later instead — that
would hide the same staleness from a real reader.

**`TaskStop` on a background command kills its outer shell, not a `sh script.sh` it started.** A
stopped chain kept waiting as its own process and would have raced its replacement to the same
commit. After stopping one, check `pgrep -af '^sh .*scratchpad/'`; kill the child by its exact command, and give a replacement a guard
that refuses to start while the old one lives.

**A process search inside `sh -c '…'` finds the shell running it.** A `pgrep -f` or `ps | grep` for
a build or a long run matched its own `sh -c`, whose command line contains the pattern: two
launchers waited forever and a CSS-build check reported a build that did not exist. Anchor the
pattern (`^node tools/`) and run the check from a script file, or wait on a file's final line
instead.

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
against luci-base 26.291, while `owrtsnapb` with ucode 2026.10.18 answered. Every page then fails
as not answering, which is the stand, not the theme. Check `curl -s -o /dev/null -w '%{http_code}'
localhost:8022/cgi-bin/luci/` and `logread | grep relocating` before reading a snapshot finding;
recreate the stand, or measure on `owrtsnapb`.

- **Exec bits lost in a host move are invisible while `core.fileMode=false`.** `git status` stays
  clean, and a script then dies with `Permission denied` on a `tools/*.sh` or `node_modules/.bin/*`
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
  the main one.

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

- **`Exit code 137` on a long run is SIGKILL, and on this WSL host the sender is the OOM killer.**
  A `timeout`-bounded run in a worktree died with 137, not `timeout`'s 124, while stands and
  browsers were up (2026-10-07). Tell the two apart: `dmesg | grep -i 'killed process'` names the
  victim when it was memory; 124 is the clock. Bring fewer stands up for the run
  (`docker ps | grep -c owlab-`) and keep one browser run at a time.

- **A hardware test build versioned `X.Y.Z_pN` never gives way to the release.** On apk `_p` is a
  patch level and sorts ABOVE `X.Y.Z`, so `apk upgrade` keeps the test build and the router had to be
  downgraded by hand. Measured 2026-10-19 on the stands: `apk version -t 0.14.15_rc1 0.14.15` → `<`
  and `0.14.15_p1` → `>`; opkg sorts both `_rc1` and `_p1` above the release and only
  `0.14.15~rc1` below (`opkg compare-versions 0.14.15~rc1 '<<' 0.14.15`), which apk rejects
  (`apk version -c` → invalid). So stamp an apk test build as the NEXT version's candidate
  (`FOOTSTRAP_VERSION=0.14.16_rc1` over 0.14.15): it upgrades the router and yields to 0.14.16. An
  opkg test build needs `opkg install --force-downgrade` back to the release.

- **Every page on `owrtsnap` fails with `L is not defined` (or `window.L.require` undefined) while
  `owrt2512`/`owrt2410` are clean: that stand's LuCI answers 502.**
  The rootfs (`openwrt/rootfs:x86_64-master@sha256:2659c3a9`, 2026-10-19T02:46Z) links `ucode` to
  `libucode.so.20230711`; the 2026-10-20 feed installs `ucode-mod-html` built for `libucode20261009`
  (`ucv_metamethod_lookup`). Tell it apart: `curl -s -o /dev/null -w '%{http_code}'
  <stand>/cgi-bin/luci/` prints `502`; `docker exec owlab-<project>-owrtsnap sh -c 'ldd /usr/bin/ucode;
  apk version -l "<"'`. Fixed in owlab 0.6.6 (owfeed/owlab#42: a rolling release runs `apk upgrade`
  before installing), which `build.yml` pins.

- **A cached stand stays green on a feed drift CI goes red on.** `owlab up` without `--rebuild`
  reuses the container, which keeps the packages it was built with. Tell it apart: `docker exec
  owlab-luci-theme-footstrap-<stand> apk version -l '<'` lists what the feed has moved past
  (`opkg list-upgradable` on 24.10). Reproduce in isolation: copy `owlab.yaml` with its own
  `project.name` and CI's `image@digest`, then `OWLAB_CONFIG=<copy> owlab up --rebuild <stand>`; the
  real stands stay untouched. A bare `owlab down` stops all of them.

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
