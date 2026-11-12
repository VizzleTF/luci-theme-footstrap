# Development

How to bring up a dev router, push a change to it, and prove the change did what you meant. For
anyone changing the theme.

The main rule: a change is not finished until it has run on a real OpenWrt userland.

Rules a patch has to follow: [conventions.md](conventions.md). Building a release: [ci.md](ci.md).

Run every command on this page from the repo root, where `owlab.yaml` is. `../tmp/` is a sibling
of the checkout, outside it.

## Short version

1. Install owlab and owfeed at the CI pin, plus Docker, Go, Node.js and `gh`. Run `npm ci` in the
   repo root: [Install owlab and the tools first](#install-owlab-and-the-tools-first).
2. Start the pair: `owlab up owrt2512 owrt2410`. Plain `owlab up` starts every router in
   `owlab.yaml`, `owrtsnap` included.
3. Iterate with the theme pushed: `owlab sync --watch`. Log in as `root` with an empty password.
4. Prove a CSS change with a computed-style diff. `tools/e2e.mjs` and `tools/anchor-check.mjs` do
   not judge how a page looks: [What proves what](#what-proves-what).
5. Run `tools/e2e.mjs` last, on a router reset with `owlab up --rebuild <router>`. Why: e2e wants a
   router without the theme, and a sync puts the theme on it: [run-checks.md](run-checks.md).
6. Before you trust a measurement, read [stand-traps.md](stand-traps.md).
7. Anything that touches the build pipeline is measured on a package: `./tools/stage.sh && owfeed build`.

## Fixing a CSS bug: the path

1. Install the tools: [Install owlab and the tools first](#install-owlab-and-the-tools-first).
2. Start both routers and push the theme: `owlab up owrt2512 owrt2410`, then `owlab sync --watch`
   in a terminal of its own. Expected: [the checks in The dev stand](#the-dev-stand-runs-real-openwrt-routers-from-owlabyaml).
3. Edit `styles/` and press F5. If nothing changes, see
   [Caches while iterating](#caches-while-iterating).
4. Prove the change off the router with a computed-style diff over `docs/gallery.html`:
   [prove-css-change.md](prove-css-change.md). The gallery cannot see two kinds
   of rule: the chrome (it has no `header.ut`) and a page-scoped rule (no element there carries
   `data-page`). For those, do step 5.
5. Prove it on the router page itself: run the same `computed-diff.mjs` against a router URL, old
   CSS against new. Steps and the pass criterion:
   [prove-css-change.md, "On a router: the chrome and page-scoped rules"](prove-css-change.md#on-a-router-the-chrome-and-page-scoped-rules).
6. Look at the change by hand on both routers:
   [The test matrix](#the-test-matrix-pages-and-modes-to-check-by-hand).
7. Stop `owlab sync --watch`. Then run e2e on each router, which also runs `tools/anchor-check.mjs`
   at the end of its step 4, while footstrap is active. Details and exit codes:
   [run-checks.md, "Run e2e on both routers"](run-checks.md#run-e2e-on-both-routers).
   1. Build: `FOOTSTRAP_VERSION=9999.0.0 ./tools/stage.sh && owfeed build`.
   2. Download the last release, one directory per package format. Expected: each `ls` prints one
      file.

      ```sh
      rm -rf ../tmp/old-apk && gh release download --repo VizzleTF/luci-theme-footstrap \
        --pattern 'luci-theme-footstrap-*.apk' --dir ../tmp/old-apk
      ls ../tmp/old-apk
      rm -rf ../tmp/old-ipk && gh release download --repo VizzleTF/luci-theme-footstrap \
        --pattern 'luci-theme-footstrap_*_all.ipk' --dir ../tmp/old-ipk
      ls ../tmp/old-ipk
      ```

   3. Reset `owrt2512` and run e2e on it. e2e needs a router without the theme. Expected: `PASS`
      on every step, exit code 0.

      ```sh
      owlab up --rebuild owrt2512
      node tools/e2e.mjs --router owrt2512 --old ../tmp/old-apk/luci-theme-footstrap-*.apk \
        --new dist/noarch/luci-theme-footstrap-[0-9]*.apk
      ```

   4. Do the same on `owrt2410`:

      ```sh
      owlab up --rebuild owrt2410
      node tools/e2e.mjs --router owrt2410 --old ../tmp/old-ipk/luci-theme-footstrap_*_all.ipk \
        --new dist/all/luci-theme-footstrap_[0-9]*_all.ipk
      ```
8. Put the working tree back on the routers: `owlab sync`. e2e leaves the package installed but
   bootstrap active.
9. In the pull request, say which routers the checks ran on, for example
   `Tested: e2e and anchor green on owrt2512 (25.12/apk) and owrt2410 (24.10/opkg).`
   See [CONTRIBUTING.md](../CONTRIBUTING.md).

## Contents

- [Fixing a CSS bug: the path](#fixing-a-css-bug-the-path)
- [Two ways to work: the fast loop and a real package](#two-ways-to-work-the-fast-loop-and-a-real-package)
- [Install owlab and the tools first](#install-owlab-and-the-tools-first)
- [The dev stand runs real OpenWrt routers from owlab.yaml](#the-dev-stand-runs-real-openwrt-routers-from-owlabyaml)
- [ImmortalWrt stands (on demand)](#immortalwrt-stands-on-demand)
- [Pushing a change with owlab sync](#pushing-a-change-with-owlab-sync)
- [If you break it, LuCI falls back and uci recovers](#if-you-break-it-luci-falls-back-and-uci-recovers)
- [Caches while iterating](#caches-while-iterating)
- [Verifying a change: templates, CSS, behaviour](#verifying-a-change-templates-css-behaviour)
- [Proving it on a router](#proving-it-on-a-router)
- [Proving it on hardware](#proving-it-on-hardware)
- [The playground: recording and replaying a real router](#the-playground-recording-and-replaying-a-real-router)
- [The stand's traps live in stand-traps.md](#the-stands-traps-live-in-stand-trapsmd)
- [The test matrix: pages and modes to check by hand](#the-test-matrix-pages-and-modes-to-check-by-hand)
- [Building a package locally](#building-a-package-locally)

## Two ways to work: the fast loop and a real package

| Mode | What it is | When |
|---|---|---|
| The fast loop (no package build) | Edit files and push them straight to a router. | The normal mode. |
| A real package | Build and install the package. | For distribution, and for verifying a clean install. |

The fast loop works because the theme is templates plus static assets. The only build step is
`build-css.sh`. It concatenates `styles/` into `cascade.css` with nothing but `cat` and `awk`.

## Install owlab and the tools first

owlab is a required part of this checkout, not an option.

Why: a change is not finished until it has run on a real OpenWrt userland. The rule:
[conventions.md](conventions.md).

Install the version CI uses. Find the pins first:

```sh
grep -n 'owfeed/owlab/setup@\|owfeed/owfeed/setup@' .github/workflows/build.yml
```

Expected: lines like `uses: owfeed/owlab/setup@v0.7.0` and `uses: owfeed/owfeed/setup@v0.5.6`. The
tag after `@` is the version. Install it, and check the machine:

```sh
go install owfeed.org/owlab/cmd/owlab@<OWLAB_VERSION>
owlab doctor                  # what this machine can do (Docker, arch, emulation)
```

Besides owlab, the checkout needs these tools:

| Tool | What it is for |
|---|---|
| Docker | The stand. |
| Go | Runs the `go install` above. |
| `owfeed` | Installed the same way: `go install owfeed.org/owfeed/cmd/owfeed@<OWFEED_VERSION>`. |
| Node.js, then `npm ci` in the repo root | `tools/`, `npm run changelog` and Playwright. |
| `npx playwright install chromium` | Fetches the browser `tools/e2e.mjs` drives. |
| `gh`, signed in | `gh release download` in [run-checks.md](run-checks.md). |

Everything else comes out of `owlab.yaml`.

### Versions follow the CI pin

`owfeed` and `owlab` here follow the refs in `.github/workflows/build.yml`. Those refs are the only
pin. `owfeed version` and `owlab version` print what you have.

`@latest` can run ahead of CI, so install the pinned tag instead: the Go module tags match the
action tags. A release binary from GitHub replaces the one in `~/go/bin`. Check it
with `gh attestation verify <file> -R owfeed/<tool>` and its `SHA256SUMS`.

## The dev stand runs real OpenWrt routers from owlab.yaml

[owlab](https://github.com/owfeed/owlab) brings the stand up from `owlab.yaml` in the repo root.
That file holds the current count and list of routers: read it rather than a number here.

The two that matter for an ordinary change are the package-manager pair:

| id | distro | release | manager | LuCI |
|---|---|---|---|---|
| `owrt2512` | OpenWrt | 25.12.5 | apk | http://localhost:8025 |
| `owrt2410` | OpenWrt | 24.10.8 | opkg | http://localhost:8024 |

`owlab.yaml` also carries `owrtsnap`, which tracks luci-base's master. Two ImmortalWrt stands boot
only on demand, never by default: [ImmortalWrt stands (on demand)](#immortalwrt-stands-on-demand).

```sh
owlab up                 # build and start every router owlab.yaml defines
owlab sync --watch       # rebuild the CSS and push on every edit
owlab open owrt2512      # open LuCI in a browser
```

`owlab up owrt2512 owrt2410` starts only the pair. `owlab up` waits for LuCI before it returns,
unless you pass `--no-wait`.

`owlab sync --watch` keeps running and re-syncs whenever a source file changes. Give it a terminal
of its own.

Log in as `root` with an empty password.

Check that the stand is up and the theme is active:

| Check | Expected |
|---|---|
| `owlab status` | Each router you started shows STATE `running` and its LUCI URL. |
| `owlab exec owrt2512 -- uci get luci.main.mediaurlbase` after a sync | `/luci-static/footstrap`. Before a sync it is `/luci-static/bootstrap`. |
| System → Footstrap in LuCI after a sync | The page exists and shows the version `dev`. |

Inside is the release's real userland, not a home-made imitation. It runs from the release's own
rootfs image: procd as PID 1, netifd, ubus, rpcd, uhttpd. `owlab.yaml` names the
`ghcr.io/openwrt/rootfs` image for the two above. owlab finds `owrtsnap`'s itself.

### Rules for working with the stand

**Reach the routers only through `localhost:<port>`.**
Why: the docker bridge address routes from the host on native Linux and inside WSL2. It does not on
Docker Desktop for macOS or Windows. So no command here uses it, and the stand behaves identically
on any OS.

Rebuilding an image is a factory reset.
Why: there are no volumes. `owlab up --rebuild` wipes the pushed theme, and you re-run `owlab sync`.
That is wanted: it exercises the install path for real, on both package managers.

Run a curl snippet from the host against `localhost:<port>`, not through `owlab exec`.
Why: there is no `curl` on the routers, exactly as on a stock router.

owlab disables mwan3 and watchcat itself.
Why: mwan3 decides the dummy WAN is dead and installs `ip rule … blackhole`. LuCI then answers while
all outbound traffic hangs with no error.

For a hardware router, use `luci-theme-footstrap/dev-sync.sh [host]`. It pushes over ssh, default
host `router2512`. It is for when the question is about hardware:
[Proving it on hardware](#proving-it-on-hardware).

### ImmortalWrt stands (on demand)

`imm2512`/`imm2410` are not a default-boot stand. They answer a question about the ImmortalWrt
brand, never a behaviour claim. The source is the ImmortalWrt comment under `routers:` in
`owlab.yaml`.

They are not an e2e target either. `tools/lib/stands.mjs`'s `stands()` skips any router that is not
openwrt.

The owlab config schema (`owlab up --help`) has no opt-in flag or profile for them. The only way to
boot them is to give owlab a `routers:` entry to read.

Bring one up only when the brand question is the one being asked:

1. Paste both blocks below back under `routers:` in `owlab.yaml`. They resolve `*third_party_apps`
   from the anchor already defined on `owrt2512` there.
2. Run `owlab up imm2512 imm2410`.
3. When done, run `owlab down imm2512 imm2410` first.
4. Then remove the pasted blocks. Why this order: owlab names a router only by an id it can read in
   `owlab.yaml`.

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

## Pushing a change with owlab sync

```sh
owlab sync                    # to every router
owlab sync owrt2512           # to one
owlab sync --watch            # and thereafter on every edit
```

`sync` puts files exactly where `luci.mk` would. It drops the same caches its postinst does. The
steps are spelled out in `owlab.yaml`:

| Key | What it does | Why |
|---|---|---|
| `build:` | Rebuilds `cascade.css` from `styles/` (`build-css.sh --dev`, comments intact) before every push. | Without it, everything is copied except the file LuCI requests, and the router 404s on its own stylesheet. |
| `install:` | Maps the package directories onto router paths. | |
| `post_sync:` | Registers the theme and touches the package database, so the asset cache key moves ([Caches while iterating](#caches-while-iterating)). | It does this itself, not through `root/etc/uci-defaults/…`. `sync` deliberately does not overwrite `/etc/config` or `/etc/uci-defaults`: that is router state, not package content. |
| `theme: footstrap` | Makes owlab set `luci.main.mediaurlbase` after the push. | Installing the package only registers the theme. On a dev stand that is the opposite of what you want. |

Resource JS is copied by glob (all of `htdocs/`), never by a list of names.
Why: LuCI's `luci.mk` copies `htdocs/` wholesale. A list would let a new file reach the package but
never the dev router.

### What sync does not do

`sync` skips two steps of a real package build:

- It does not stamp `FS_VERSION`, so System → Footstrap shows `dev`.
- It does not compile `po/*.po` into `.lmo`, so strings stay English.

Both belong to a real package build, which is where they should be verified.

## If you break it, LuCI falls back and uci recovers

A broken template does not brick the UI. If `header.ut` does not compile, LuCI falls back to the
first working theme in `luci.themes`. It shows a "Theme fallback" indicator carrying the error.

Roll back by hand at any time:

```sh
owlab exec owrt2512 -- 'uci set luci.main.mediaurlbase=/luci-static/bootstrap && uci commit luci'
```

To switch back to footstrap, run `owlab sync owrt2512`. Its `theme: footstrap` sets
`luci.main.mediaurlbase` again. By hand:

```sh
owlab exec owrt2512 -- 'uci set luci.main.mediaurlbase=/luci-static/footstrap && uci commit luci'
```

If everything is broken, `uci` is reachable over ssh. LuCI is not needed to recover.

## Caches while iterating

| What | Cached where | How an edit shows up |
|---|---|---|
| Menu and dispatcher | `/tmp/luci-indexcache.<hash>.json` | The hash comes from menu-file mtimes, so it updates itself. |
| `.ut` templates | Not cached between requests: ucode compiles on the fly. | An edit to `header.ut` is visible on F5. |
| CSS/JS | The browser | `cascade.css` is served with `?v={{ pkgs_update_time }}`. Touching the package database changes the key, and an ordinary F5 picks the file up. `post_sync:` does this on every sync. |

If things look strange, clear the menu cache:
`owlab exec owrt2512 -- 'rm -f /tmp/luci-indexcache*'`.

To move the CSS/JS key by hand, touch both package databases. Which file exists depends on the
release:

```sh
owlab exec owrt2512 -- 'for db in /lib/apk/db/installed /usr/lib/opkg/status; do [ -f "$db" ] && touch "$db"; done'
```

**Name only the apk path, and the key never changes on 24.10.** The file arrives, but the browser
serves the old one. It looks exactly like an edit that did nothing.

## Verifying a change: templates, CSS, behaviour

### What proves what

Each kind of change has its proof on its own page:

| What changed | Proof | Where |
|---|---|---|
| A template | Compile it with the same `trycompile` LuCI uses. | The command below. |
| CSS | A computed-style diff, then a look by hand on both routers. | [prove-css-change.md](prove-css-change.md), [The test matrix](#the-test-matrix-pages-and-modes-to-check-by-hand) |
| The package's life and every menu page | `tools/e2e.mjs` on both routers. | [verifying.md, "What the check proves"](verifying.md#what-the-check-proves) |
| Scroll anchoring | `tools/anchor-check.mjs` on both routers. | [verifying.md](verifying.md#the-anchoring-check-keeps-a-parked-reader-in-place) |
| What the checks do not judge: a layout, a fold, an axis | By hand on a synced stand. | [verifying.md](verifying.md#what-the-checks-do-not-judge) |

Every change, a CSS one included, also needs a green e2e and anchor run on both routers.

```sh
owlab exec owrt2512 -- 'ucode -T -c -o /dev/null \
  /usr/share/ucode/luci/template/themes/footstrap/header.ut'
```

Screenshots do not prove a CSS change.
Why: live counters (uptime, DHCP leases, wifi signal) move more pixels between two runs of the
*same* stylesheet than a real regression does.

`build-css.sh` also fails on unbalanced braces or a changed rule count.

No npm package is installed on a router. The release build (`tools/stage.sh`) runs uglify-js and
acorn from `package.json` over the shipped JS and templates. The OpenWrt buildbot has no node, so
the Makefile path uses none of it.

## Proving it on a router

Two checks run on a real router. They are the local form of CI's `e2e` and `anchor` jobs:

| Check | What it covers |
|---|---|
| `tools/e2e.mjs` | The package's life and every menu page. |
| `tools/anchor-check.mjs` | Scroll anchoring. |

What they prove: [verifying.md](verifying.md). How to run them and their exit codes:
[run-checks.md](run-checks.md).

For anything the checks do not judge (a layout change, a fold, an axis), drive the running
container by hand:

```sh
owlab up && owlab sync
owlab open owrt2512            # then click the thing
owlab open owrt2410            # and again on the other package manager
```

### The routers are pre-populated, and that is what makes them useful

`owlab.yaml` sets `fixtures: [all]`. Each box comes up with seeded networks, clients, wireguard
peers, port forwards, system data and wireless config. The wireless pages render from UCI with no
radios present, and this theme has to style them.

`owlab.yaml` also adds a long `packages:` list on top of owlab's stock set. Every entry is prefixed
with `+`, so it adds rather than replaces.

That list is the theme's test surface. A stock router renders a handful of menus. The sections,
tabs, tables and widgets that need styling live in the apps.

`curl` is deliberately absent from the list.
Why: it is not in OpenWrt's default set. Installing it here would hide the bug class that
`install.sh`'s `uclient-fetch` fallback exists for.

If a change needs a real kernel (not this theme's usual case), raise a router to `fidelity: vm`. It
then runs under QEMU instead of in a container.

### Proving it on hardware

Nothing automated runs against hardware: e2e and the playground drive owlab routers only. A hardware
run happens on the maintainer's explicit word for one change, never by reflex.

1. Pre-check that the fallback exists, and record where the router is now:
   `ssh <host> 'ls -d /www/luci-static/bootstrap /usr/share/ucode/luci/template/themes/bootstrap/header.ut && uci get luci.main.mediaurlbase'`.
   If either path is missing, stop. A broken template falls back to the first working theme in
   `luci.themes`. With no bootstrap on the box there is nothing to fall back to.
2. Run `luci-theme-footstrap/dev-sync.sh <host>`. It registers the theme, activates nothing and
   busts the asset cache. It keeps no backup: the rollback is uci.
3. Sweep the templates the way LuCI will:
   `ssh <host> 'for f in /usr/share/ucode/luci/template/themes/footstrap/*.ut /usr/share/ucode/luci/template/themes/footstrap/partials/*.ut; do ucode -T -c -o /dev/null "$f" || echo FAIL $f; done'`.
   Expected: no `FAIL` line.
4. Run `curl -s -D - http://<host>/cgi-bin/luci/`. Expected: the body is the login form.
   25.12 answers it with 403 and `x-luci-login-required: yes`. That comes from upstream
   `dispatcher.uc`, not the theme, so read the body, not the code.
5. A person clicks through the admin pages.
6. If anything above fails or a page is wrong, roll back:
   `ssh <host> 'uci set luci.main.mediaurlbase=/luci-static/bootstrap; uci commit luci; rm -f /tmp/luci-indexcache*'`.

### The playground: recording and replaying a real router

`tools/playground/{capture,build,verify}.mjs` turn an owlab stand into a static, offline site. CI's
`playground` job runs them ([ci.md](ci.md)).

Each step needs the one before it:

| Step | Needs |
|---|---|
| `capture` | A booted, installed router. |
| `build` | `capture`'s output. |
| `verify` | `build`'s output. |

```sh
owlab up owrt2512 && owlab install owrt2512 'dist/noarch/luci-theme-footstrap-*.apk'
npm run playground:capture &&
  npm run playground:build -- --base /luci-theme-footstrap/playground &&
  npm run playground:verify -- --base /luci-theme-footstrap/playground
```

Each script also takes its own flags directly: `--recording DIR`, `--out DIR`, `--base /path`.
`--help` on each prints the exact list.

Output lands under `../tmp/playground/` by default, never inside the checkout. It holds
`recording/`, `out/` and `playground.tar.gz`.

To look at what was built, open
`../tmp/playground/out/cgi-bin/luci/admin/status/overview/index.html` in a browser. Serve it with
any static server rooted at `--base`.

#### The playground login accepts any credentials

The site opens on a login page: `BASE/cgi-bin/luci/`, prefilled `root`/empty like a real router. It
accepts any credentials, because a static site has no server left to check them against.
`.fs-logout` returns to it.

`build.mjs` refuses a `--recording` that has no saved login form and asks for a re-capture.

#### Two harness facts behind `tools/lib/stands.mjs`

`capture` reads the stand through `tools/lib/stands.mjs`. Two facts hold there.

**`sealToRouter()` aborts every request that leaves the router's origin.** data:/blob: requests
pass.

- A run then stops depending on github.com and its rate limit. ssclash asks GitHub for a release on
  two pages.
- Playwright turns the predicate into a catch-all glob. Every request then passes through a JS
  callback, and the browser's HTTP cache is off. That costs little at capture's one page at a time.
- `tools/e2e.mjs` loads hundreds of pages, so it seals its browser with a launch proxy instead:
  `proxy: { server: 'http://127.0.0.1:9', bypass: 'localhost' }`. Every other host is refused at
  once, and the cache stays on.
- The route aborts rather than faking a 200, which the page would render.

`menuPaths()` waits for `window.L.require` before asking for `ui`.

- Why: `L.ui` exists only once something has required ui.js. On 24.10 that is not yet the case
  straight after the login redirect.
- The tree arrives rooted at `admin`, so the walk starts with an empty path. Seeding `admin` yields
  `/admin/admin/...`: a sweep of 404s that reads as a clean run.
- The tree has 30 s to load. `L.Request` has no clock. A stand that stopped answering while the menu
  loaded used to hold the caller to its step's timeout.
- A timeout is a `StandDown` only when LuCI's root then stays silent for a minute (`stoodDown()`).
  Otherwise it is an error the caller judges.

## The stand's traps live in stand-traps.md

A stand can make a measurement lie: no theme after `owlab up`, a stale package, a 403 on a copied
file, a snapshot that answers 502. The full list, each with its check: [stand-traps.md](stand-traps.md).

## The test matrix: pages and modes to check by hand

| Axis | Cover |
|---|---|
| Pages | Status/Overview (tables, ifacebox), Network/Interfaces (zonebadge, modals), Network/Firewall (section table, dropdown), System/Software (progress), Realtime graphs (SVG), login/logout, Reboot. |
| Apply/rollback sheet | The confirmation sheet `ui.js` draws over the theme. Custom z-indexes often break it. |
| Modes | light/dark/auto, both layouts, all five palettes, a narrow window, long hostnames and SSIDs. |

**"Does it fit" has no breakpoints: it is a measurement.** Drag the window with the mouse; do not
test specific widths. Why: [chrome.md](chrome.md).

## Building a package locally

```sh
./tools/stage.sh && owfeed build     # both formats, seconds, no toolchain
```

Expected output:

| Step | Writes |
|---|---|
| `./tools/stage.sh` | `dist/root`, `dist/VERSION` and `dist/scripts` |
| `owfeed build` | the apk packages in `dist/noarch/` (`luci-theme-footstrap-<VERSION>-r1.apk`) and the ipk packages in `dist/all/` (`luci-theme-footstrap_<VERSION>-r1_all.ipk`), each with the `luci-i18n-footstrap-*` packages beside it |

That is what CI does. The owfeed build is described in [ci.md](ci.md).

`luci-theme-footstrap/build-apk.sh` is a different path: a build through the OpenWrt SDK.

- It exists to prove the theme is still buildable by its Makefile, `luci.mk` and jsmin, for someone
  who has never heard of owfeed.
- Releases do not come out of it.
- It is described in [package.md](package.md).

Through owlab, an SDK build writes `dist/<arch>/`, not owfeed's `dist/noarch` and `dist/all`:

```sh
owlab build                       # target taken from the first router in owlab.yaml; writes dist/<arch>/
owlab build --arch x86_64 --release 25.12.5
owlab install owrt2512 'dist/<arch>/luci-theme-footstrap-*.apk'
owlab exec owrt2512 -- 'apk del luci-theme-footstrap'
```

An SDK build differs from `sync` in a measurable way. A real build runs the sources through the
minifiers. Code that works unminified and breaks minified stays invisible until you build a package.
Without that step, the first person to see it is a user.

On Apple Silicon this runs under emulation: every `openwrt/sdk` tag is `linux/amd64`. owlab warns
before it starts.
