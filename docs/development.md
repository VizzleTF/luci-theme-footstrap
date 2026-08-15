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

## The live gates: `npm run live`

The static gates read files. Every bug a user has reported was about a **page** — a shredded column,
a clipped title, a doubled scrollbar, a third-party app laid out wrong, a client navigation that
painted less than a full load. `npm run live` is the half that opens pages, and it needs stands:

```sh
owlab up                       # the containers these gates measure
owlab sync                     # your working tree onto them
npm run live                   # upstream-contract, then spa-parity, then live-audit
```

Each is also a command of its own, and each takes `--only <router ids>`:

```sh
node tools/upstream-contract.mjs --only owrtsnap --verbose   # every assumption, named, one by one
node tools/spa-parity.mjs --only owrt2410 --pages /admin/network
node tools/live-audit.mjs --only owrt2512 --widths 320,1440 --pages /admin/status
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
