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
(`owfeed version`, `owlab version` print what you have). A release binary from
GitHub, checked with `gh attestation verify <file> -R owfeed/<tool>` and its `SHA256SUMS`, replaces
the one in `~/go/bin`; `@latest` can run ahead of CI.

## The dev stand

Brought up by [owlab](https://github.com/owfeed/owlab) from `owlab.yaml` in the repo root, which is
the current count and list of routers — read it rather than a number here. The two that matter for
an ordinary change are the package-manager pair:

| id | distro | release | manager | LuCI |
|---|---|---|---|---|
| `owrt2512` | OpenWrt | 25.12.4 | apk | http://localhost:8025 |
| `owrt2410` | OpenWrt | 24.10.8 | opkg | http://localhost:8024 |

`owlab.yaml` also carries `owrtsnap` (tracks luci-base's master), and — on demand only, not booted by
default — two ImmortalWrt stands: [ImmortalWrt stands (on demand)](#immortalwrt-stands-on-demand).

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
boot them is to give owlab a `routers:` entry to read. They are not an e2e target, `tools/lib/stands.mjs`'s
`stands()` skips any router that is not openwrt, and they answer a question about the ImmortalWrt brand, never a
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
- `post_sync:` registers the theme and touches the package database so the asset cache key moves
  (see Caches below) — here rather than through `root/etc/uci-defaults/…`, because `sync` deliberately does not overwrite `/etc/config` or
  `/etc/uci-defaults`: that is router state, not package content;
- `theme: footstrap` — owlab sets `luci.main.mediaurlbase` after the push. Installing the package
  only registers the theme, which on a dev stand is the opposite of what you want.

Resource JS is copied by glob (all of `htdocs/`), never by a list of names: luci.mk copies
`htdocs/` wholesale, so a list would let a new file reach the package but never the dev router.

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
  touching the package database changes the key and an ordinary F5 picks the file up. `post_sync:`
  does this on every sync; by hand, **which file that is depends on the release**, so touch both:
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

**CSS** — not with screenshots. Live counters (uptime, DHCP leases, wifi signal) move more pixels
between two runs of the *same* stylesheet than a real regression does. Diff computed styles instead: load the page once, swap the `<link>` for the second sheet, snapshot
`getComputedStyle` over every element. Method and traps: [css.md](css.md).

**Behaviour** — on a router: `tools/e2e.mjs` for the package's life and every menu page (next
section), and by hand on a synced stand for what it does not judge — a layout, a fold, an axis.

`build-css.sh` additionally fails on unbalanced braces or a changed rule count.

No npm package is installed on a router, but the release build (`tools/stage.sh`) runs uglify-js and
acorn from `package.json` over the shipped JS and templates. The OpenWrt buildbot has no node, so
the Makefile path uses none of it.

## Proving it on a router: `tools/e2e.mjs`

`tools/e2e.mjs` is the one check, and the local form of CI's `e2e` job (one per package manager). It
lives the package's whole life on one running owlab router, the way an admin lives it:

1. install the last published release — Footstrap is offered in Language and Style and the active
   theme is left alone (the README has the admin pick it there);
2. the admin picks footstrap, and a marker section is written into `/etc/config/footstrap`;
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
tree back.

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
run happens on the maintainer's explicit word for one change, never by reflex.

1. Pre-check that the fallback exists, and record where the router is now:
   `ssh <host> 'ls -d /www/luci-static/bootstrap /usr/share/ucode/luci/template/themes/bootstrap/header.ut && uci get luci.main.mediaurlbase'`.
   Either path missing: stop. A broken template falls back to the first working theme in
   `luci.themes`, and with no bootstrap on the box there is nothing to fall back to.
2. `luci-theme-footstrap/dev-sync.sh <host>` — registers the theme, activates nothing and busts the
   asset cache. It keeps no backup: the rollback is uci.
3. Sweep the templates the way LuCI will:
   `ssh <host> 'for f in /usr/share/ucode/luci/template/themes/footstrap/*.ut /usr/share/ucode/luci/template/themes/footstrap/partials/*.ut; do ucode -T -c -o /dev/null "$f" || echo FAIL $f; done'`.
4. `curl -s -D - http://<host>/cgi-bin/luci/` — the body is the login form. 25.12 answers it with
   403 and `x-luci-login-required: yes` (upstream `dispatcher.uc`, not the theme), so read the body,
   not the code. The admin pages are clicked by a person.
5. Rollback, if anything above fails or a page is wrong:
   `ssh <host> 'uci set luci.main.mediaurlbase=/luci-static/bootstrap; uci commit luci; rm -f /tmp/luci-indexcache*'`.

### The playground: recording and replaying a real router

`tools/playground/{capture,build,verify}.mjs` turn an owlab stand into a static, offline site — CI's own
`playground` job, [ci.md](ci.md). Each step needs the one before it (`capture` needs a booted,
installed router; `build` needs `capture`'s output; `verify` needs `build`'s).

```sh
owlab up owrt2512 && owlab install owrt2512 'dist/noarch/luci-theme-footstrap-*.apk'
npm run playground:capture &&
  npm run playground:build -- --base /luci-theme-footstrap/playground &&
  npm run playground:verify -- --base /luci-theme-footstrap/playground
```

Each script also takes its own flags directly (`--recording DIR`, `--out DIR`, `--base /path`) —
`--help` on each prints the exact list. Output lands under `../tmp/playground/` by default
(`recording/`, `out/`, `playground.tar.gz`), never inside the checkout. Open
`../tmp/playground/out/cgi-bin/luci/admin/status/overview/index.html` in a browser under any static
server rooted at `--base` to look at what was built.

The site opens on a login page (`BASE/cgi-bin/luci/`, prefilled `root`/empty like a real router)
that accepts any credentials — a static site has no server left to check them against — and
`.fs-logout` returns to it; `build.mjs` refuses a `--recording` that has no saved login form and
asks for a re-capture.

Two harness facts hold behind `tools/lib/stands.mjs`, which `capture` reads the stand through:

- **`sealToRouter()` aborts every request that leaves the router's origin** (data:/blob: pass), so a
  run stops depending on github.com and its rate limit (ssclash asks GitHub for a release on two
  pages). The route is a predicate and never a catch-all glob: a glob hands every request, hundreds
  the router serves itself, to a JS callback, and slows a run past CI's time limit. It aborts rather than faking a 200, which the page would render.
- **`menuPaths()` waits for `window.L.require` before asking for `ui`:** `L.ui` exists only once
  something has required ui.js, which on 24.10 is not yet the case straight after the login
  redirect. The tree arrives rooted
  at `admin`, so the walk starts with an empty path (seeding `admin` yields `/admin/admin/...`, a
  sweep of 404s that reads as a clean run).

## The stand's own traps

Each of these once read as a regression in the theme.

- **A stand after `owlab up` carries no theme until `owlab sync`.** `up` starts the containers
  and leaves `luci.main.mediaurlbase` at `/luci-static/bootstrap`; `--rebuild` is a factory reset.
  Every page then logs `NetworkError: HTTP error 404 while loading class file
  "/luci-static/resources/fs-prefs.js"`, or a measurement silently reads stock bootstrap. Tell it
  apart: `owlab exec <stand> -- uci get luci.main.mediaurlbase`. Run `owlab sync` before measuring
  the working tree — and not before `tools/e2e.mjs`, which wants the router without the theme.

- **A synced stand has no `/etc/footstrap`, so an Appearance upload (pattern or login background)
  fails "No such file or directory".** `owlab sync` never writes `/etc/config` and never runs
  `root/etc/uci-defaults/…`, which makes the directory; `post_sync:` only registers the theme. A
  packaged install has both. Tell it apart: `owlab exec <stand> -- ls -d /etc/footstrap
  /etc/config/footstrap`. Fix with `owlab exec <stand> -- mkdir -p /etc/footstrap` and a `docker cp` of
  `luci-theme-footstrap/root/etc/config/footstrap` to `/etc/config/footstrap` (then `chown 0:0`).

- **`owlab sync` does not ship what a router gets.** It copies `htdocs/` and `ucode/` straight from
  the checkout and builds `cascade.css` with `--dev`: no minifier, no pre-paint minifier, no template
  strip, no token mangle. Anything touching the build pipeline has to be measured on a package —
  `./tools/stage.sh && owfeed build`, then install. On a packaged build
  `getComputedStyle(document.documentElement).getPropertyValue('--fs-accent')` comes back empty,
  because the name is mangled there.

- **opkg does not reinstall a package whose version already matches.** On 24.10 `owlab install`
  answers `… is up to date.` and leaves the previous files in place, while apk reinstalls. Prove the
  bytes arrived (`md5sum dist/root/www/luci-static/resources/fs-fit.js` against `owlab exec owrt2410
  -- md5sum /www/luci-static/resources/fs-fit.js`); when they differ, force it:

  ```sh
  docker cp dist/all/*.ipk owlab-luci-theme-footstrap-owrt2410:/tmp/theme.ipk
  docker exec owlab-luci-theme-footstrap-owrt2410 opkg install --force-reinstall /tmp/theme.ipk
  owlab exec owrt2410 -- 'uci set luci.main.mediaurlbase=/luci-static/footstrap && uci commit luci'
  ```

  The last line is needed because a forced reinstall runs postrm, which hands
  `luci.main.mediaurlbase` to bootstrap exactly as [package.md](package.md) requires.

- **A file put in with `docker cp` is served 403.** It lands without world-read, and a file copied
  from a path owned by uid 1000 keeps that owner; uhttpd answers 403 and the page reports
  `NetworkError: HTTP error 403 while loading class file` — the module never runs and the page can
  look fixed. `chmod 644` and `chown 0:0` it inside the container.

- **A local stand keeps the packages it was built with; CI boots today's feed.** `owlab up` without
  `--rebuild` reuses the container. Tell it apart: the CI job log prints every installed version;
  `docker exec owlab-luci-theme-footstrap-<stand> apk version -l '<'` (`opkg list-upgradable` on
  24.10) lists what the feed has moved past. Reproduce in isolation: copy `owlab.yaml` with its own
  `project.name`, then `OWLAB_CONFIG=<copy> owlab up --rebuild <stand>`; the real stands stay
  untouched.

- **Nothing locks a stand.** Two runs against one router invent findings: one run's theme switch
  or install lands in the middle of the other's measurement. Run one `tools/e2e.mjs` or playground
  capture per router at a time, and no `owlab sync` while a run is reading it.

- **`owlab test` run from the checkout removes the project's running stands.** Measured on owlab
  0.6.1 and not re-checked since: its log carried `Container owlab-luci-theme-footstrap-owrt2512
  Removing` before the router it built. Containers are named after the working directory, so run it
  from a scratch directory (`mkdir -p ../tmp/owlab-test && cd ../tmp/owlab-test`), or `owlab up`
  again afterwards.

- **`owlab up` reports one failed router as a failed command.** A taken host port (`Bind for
  0.0.0.0:<port> failed: port is already allocated`) or an image build that dies on opkg index
  drift (`Checksum or size mismatch for package …`) exits non-zero while other routers came up, and a
  failing image build cancels the other legs of the same build. Read the per-router lines, not the
  exit status, and do not take running stands down while `up` is failing this way: there is no
  volume to recover from.

- **`defaults.extra_packages` in `owlab.yaml` reaches every router, and a package one of them
  cannot resolve fails `owlab up` for all of them.** The list merges additively, with no way to opt a
  router out. openclash and ssclash need `kmod-tun`, which `owrtsnap` often cannot resolve (its kmods
  index is keyed to the box's exact kernel hash). That is why the apps are declared once on a release
  router and aliased onto the others, with `owrtsnap` carrying none.

- **A package can be missing on `owrtsnap` on any given day.** The snapshot index of `feeds/luci`
  and `feeds/packages` move independently, so a `luci-app-*` and its binary can briefly disagree.
  Before treating a snapshot-only difference in section or DOM count as a theme finding, check what
  is missing today: `grep 'unable to select' /var/log/apk.log` on `owrtsnap`.

- **A snapshot stand can answer 502 because its ucode and luci-base come from different days.**
  `logread` carries `Error relocating /usr/lib/ucode/html.so: … symbol not found`, and every page
  fails as not answering. Check `curl -s -o /dev/null -w '%{http_code}' localhost:8022/cgi-bin/luci/`
  and `logread | grep relocating` before reading a snapshot finding; recreate the stand
  (`owlab up --rebuild owrtsnap`).

- **`ucode` is not on the host; it lives in a stand.** Run the template check where LuCI runs
  (`owlab exec <stand> -- ucode -T -c -o /dev/null <file>.ut`, after a sync or a `docker cp`).

- **A stand serves http only, so the login page's https hop cannot be measured on it as it comes.**
  `uhttpd` has the certificate; what is missing is the listener, and owlab publishes port 80 alone.
  Reach the https side on the container's own address:

  ```sh
  docker exec owlab-luci-theme-footstrap-owrt2512 sh -c \
      "uci set uhttpd.main.listen_https='0.0.0.0:443'; uci commit uhttpd; /etc/init.d/uhttpd restart"
  docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' \
      owlab-luci-theme-footstrap-owrt2512      # -> curl -k https://<ip>/cgi-bin/luci
  ```

  Put it back with `uci delete uhttpd.main.listen_https`.

- **A control gated on `/proc/mtd` or the overlay mount line is absent on a stand, under any
  theme.** luci-mod-system's flash page adds "Reset to defaults" only when `/proc/mtd` names
  `rootfs_data` or `/proc/mounts` carries `overlayfs:/overlay / ` (`view/system/flash.js`), and both
  reads degrade to an empty string through `fs.trimmed()`. A container has neither, so the button is
  missing under footstrap AND under bootstrap — switch to bootstrap first. To see the control, feed
  the data by intercepting the ubus reply:

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

- **`RPC call to uci/get failed with error -32002: Access denied` on the login document is upstream
  LuCI.** `luci.js` boot requires `form`, and `form.js` on the openwrt-24.10 and openwrt-25.12
  branches runs `uci.loadPackage('luci').catch();` — a `.catch()` with no handler, so the anonymous
  session's denial goes unhandled (master has `.catch(() => {})`). It shows under stock bootstrap
  too, at a different rate; switch `luci.main.mediaurlbase` to `/luci-static/bootstrap` and rerun to
  tell it apart.

- **"It is the app's markup" is a claim; switching the stand to bootstrap checks it.** Re-measure
  the same page at the same width under `/luci-static/bootstrap`: an overflow that looks like the
  app's markup can come from this theme's own wider buttons. This is also why `tools/e2e.mjs` judges every
  page against bootstrap on the same router.

- **When `tools/e2e.mjs` goes red, build the parent commit.** Package it, install it the same way,
  run the same check. A failure that reproduces there did not come from the change under test.

- **A `<style>` injected into a live page is eaten by the theme's own fence.** `fs-sheets.js`
  observes a new `<style>` in `<head>`, re-hosts it into `@layer theme` and scopes its selectors to
  the current view, so a rule aimed at the chrome matches nothing. Inject through a constructed
  sheet, which is not a DOM node:

  ```js
  const s = new CSSStyleSheet(); s.replaceSync('* { box-shadow: none !important }');
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, s];
  ```

- **A page-scoped rule cannot be read off the gallery.** `docs/gallery.html` carries no
  `body[data-page]`, so a rule written `body[data-page="admin-status-overview"] …` matches nothing
  there. Take the reading off the playground or a stand.

- **A leftover `dist/` can carry a version it is not.** A size comparison against a stale build
  moves in the wrong direction. Build the baseline fresh from the tag:
  `git archive <tag> | tar -x -C /clean/checkout && (cd /clean/checkout && ./tools/stage.sh)`.

- **A hardware test build versioned `X.Y.Z_pN` never gives way to the release.** On apk `_p` is a
  patch level and sorts ABOVE `X.Y.Z`: `apk version -t 0.14.15_rc1 0.14.15` → `<`, `0.14.15_p1` →
  `>`. opkg sorts both `_rc1` and `_p1` above the release and only `0.14.15~rc1` below, which apk
  rejects. So stamp an apk test build as the next version's candidate
  (`FOOTSTRAP_VERSION=0.14.16_rc1` over 0.14.15); an opkg test build needs
  `opkg install --force-downgrade` back to the release.

- **`luci-app-bandix` is not in the OpenWrt feeds; install it from its author's GitHub releases,
  matched to the stand's arch and libc.** Its eBPF backend cannot start in a container (`Failed to
  load eBPF program: map error`), but the LuCI view still renders, which is enough for a DOM or CSS
  bug; anything needing its live data needs `fidelity: vm` or hardware.

## The test matrix

- **Pages**: Status/Overview (tables, ifacebox), Network/Interfaces (zonebadge, modals),
  Network/Firewall (section table, dropdown), System/Software (progress), Realtime graphs (SVG),
  login/logout, Reboot. Plus the apply/rollback confirmation sheet, which `ui.js` draws over the
  theme and which custom z-indexes often break.
- **Modes**: light/dark/auto, both layouts, all five palettes, a narrow window, long hostnames and SSIDs.
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
