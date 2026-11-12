# The stand's own traps

Troubleshooting for the owlab dev stand. Each entry is a symptom that makes a measurement lie, and
the check that tells it apart. Read it before you trust a result from a stand.

Bringing the stand up: [development.md](development.md#the-dev-stand-runs-real-openwrt-routers-from-owlabyaml).

## Contents

- [A stand after `owlab up` carries no theme until `owlab sync`](#a-stand-after-owlab-up-carries-no-theme-until-owlab-sync)
- [A synced stand has no `/etc/footstrap`, so an Appearance upload fails](#a-synced-stand-has-no-etcfootstrap-so-an-appearance-upload-fails)
- [`owlab sync` does not ship what a router gets](#owlab-sync-does-not-ship-what-a-router-gets)
- [opkg does not reinstall a package whose version already matches](#opkg-does-not-reinstall-a-package-whose-version-already-matches)
- [A file put in with `docker cp` is served 403](#a-file-put-in-with-docker-cp-is-served-403)
- [A local stand keeps the packages it was built with; CI boots today's feed](#a-local-stand-keeps-the-packages-it-was-built-with-ci-boots-todays-feed)
- [Nothing locks a stand](#nothing-locks-a-stand)
- [`owlab test` run from the checkout removes the project's running stands](#owlab-test-run-from-the-checkout-removes-the-projects-running-stands)
- [`owlab up` reports one failed router as a failed command](#owlab-up-reports-one-failed-router-as-a-failed-command)
- [`defaults.extra_packages` in `owlab.yaml` reaches every router](#defaultsextra_packages-in-owlabyaml-reaches-every-router)
- [A package can be missing on `owrtsnap` on any given day](#a-package-can-be-missing-on-owrtsnap-on-any-given-day)
- [A snapshot stand can answer 502 when its ucode and luci-base come from different days](#a-snapshot-stand-can-answer-502-when-its-ucode-and-luci-base-come-from-different-days)
- [`ucode` is not on the host; it lives in a stand](#ucode-is-not-on-the-host-it-lives-in-a-stand)
- [A stand serves http only, so the login page's https hop cannot be measured as it comes](#a-stand-serves-http-only-so-the-login-pages-https-hop-cannot-be-measured-as-it-comes)
- [A control gated on /proc/mtd or the overlay mount is absent on a stand, under any theme](#a-control-gated-on-procmtd-or-the-overlay-mount-is-absent-on-a-stand-under-any-theme)
- ["Access denied" from uci/get on the login document is upstream LuCI](#access-denied-from-uciget-on-the-login-document-is-upstream-luci)
- ["It is the app's markup" is a claim; switching the stand to bootstrap checks it](#it-is-the-apps-markup-is-a-claim-switching-the-stand-to-bootstrap-checks-it)
- [When `tools/e2e.mjs` goes red, build the parent commit](#when-toolse2emjs-goes-red-build-the-parent-commit)
- [A `<style>` injected into a live page is eaten by the theme's own fence](#a-style-injected-into-a-live-page-is-eaten-by-the-themes-own-fence)
- [A page-scoped rule cannot be read off the gallery](#a-page-scoped-rule-cannot-be-read-off-the-gallery)
- [A leftover `dist/` can carry a version it is not](#a-leftover-dist-can-carry-a-version-it-is-not)
- [A hardware test build versioned `X.Y.Z_pN` never gives way to the release](#a-hardware-test-build-versioned-xyz_pn-never-gives-way-to-the-release)


Each trap below makes a measurement lie. Read the heading, then the check that tells it apart.

## A stand after `owlab up` carries no theme until `owlab sync`

`up` starts the containers and leaves `luci.main.mediaurlbase` at `/luci-static/bootstrap`.
`--rebuild` is a factory reset.

- Symptom: every page logs `NetworkError: HTTP error 404 while loading class file
  "/luci-static/resources/fs-prefs.js"`. Or a measurement silently reads stock bootstrap.
- Tell it apart: `owlab exec <stand> -- uci get luci.main.mediaurlbase`.
- Fix: run `owlab sync` before measuring the working tree.
- Exception: do not sync before `tools/e2e.mjs`, which wants the router without the theme.

## A synced stand has no `/etc/footstrap`, so an Appearance upload fails

- Symptom: an Appearance upload (pattern or login background) fails "No such file or directory".
- Cause: a sync does not create the directory. `owlab sync` never writes `/etc/config` and never
  runs `root/etc/uci-defaults/…`, which makes it. `post_sync:` only registers the theme. A packaged
  install has both.
- Tell it apart: `owlab exec <stand> -- ls -d /etc/footstrap /etc/config/footstrap`.
- Fix: run `owlab exec <stand> -- mkdir -p /etc/footstrap`. Then `docker cp`
  `luci-theme-footstrap/root/etc/config/footstrap` to `/etc/config/footstrap`, then `chown 0:0` it.

## `owlab sync` does not ship what a router gets

`owlab sync` copies `htdocs/` and `ucode/` straight from the checkout. It builds `cascade.css` with
`--dev`: no minifier, no pre-paint minifier, no template strip, no token mangle.

- Rule: anything touching the build pipeline is measured on a package. Run
  `./tools/stage.sh && owfeed build`, then install.
- Sign: on a packaged build
  `getComputedStyle(document.documentElement).getPropertyValue('--fs-accent')` comes back empty,
  because the name is mangled there.

## opkg does not reinstall a package whose version already matches

On 24.10 `owlab install` answers `… is up to date.` and leaves the previous files in place. apk
reinstalls.

1. Prove the bytes arrived. Compare `md5sum dist/root/www/luci-static/resources/fs-fit.js` with
   `owlab exec owrt2410 -- md5sum /www/luci-static/resources/fs-fit.js`.
2. When they differ, force the reinstall:

   ```sh
   docker cp dist/all/*.ipk owlab-luci-theme-footstrap-owrt2410:/tmp/theme.ipk
   docker exec owlab-luci-theme-footstrap-owrt2410 opkg install --force-reinstall /tmp/theme.ipk
   owlab exec owrt2410 -- 'uci set luci.main.mediaurlbase=/luci-static/footstrap && uci commit luci'
   ```

The last line is needed because a forced reinstall runs postrm. postrm hands
`luci.main.mediaurlbase` to bootstrap, exactly as [package.md](package.md) requires.

## A file put in with `docker cp` is served 403

- Cause: it lands without world-read. A file copied from a path owned by uid 1000 also keeps that
  owner. Then uhttpd answers 403.
- Symptom: the page reports `NetworkError: HTTP error 403 while loading class file`. The module never
  runs, and the page can look fixed.
- Fix: `chmod 644` and `chown 0:0` it inside the container.

## A local stand keeps the packages it was built with; CI boots today's feed

`owlab up` without `--rebuild` reuses the container.

- Tell it apart: the CI job log prints every installed version.
  `docker exec owlab-luci-theme-footstrap-<stand> apk version -l '<'` lists what the feed has moved
  past. On 24.10 use `opkg list-upgradable`.
- Reproduce in isolation: copy `owlab.yaml` with its own `project.name`. Then run
  `OWLAB_CONFIG=<copy> owlab up --rebuild <stand>`. The real stands stay untouched.

## Nothing locks a stand

Two runs against one router invent findings. One run's theme switch or install lands in the middle
of the other's measurement.

- Run one `tools/e2e.mjs` or playground capture per router at a time.
- Run no `owlab sync` while a run is reading it.

## `owlab test` run from the checkout removes the project's running stands

Containers are named after the working directory. Run it from a scratch directory
(`mkdir -p ../tmp/owlab-test && cd ../tmp/owlab-test`), or run `owlab up` again afterwards.

## `owlab up` reports one failed router as a failed command

It exits non-zero while other routers came up. Read the per-router lines, not the exit status.

Two causes are common:

| Cause | Message |
|---|---|
| A taken host port | `Bind for 0.0.0.0:<port> failed: port is already allocated` |
| An image build that dies on opkg index drift | `Checksum or size mismatch for package …` |

A failing image build also cancels the other legs of the same build.

`owrtsnap`'s ssh port is 2228, not 2222. 2222 is the port a developer machine's own sshd usually
listens on, and docker refuses the bind (`owlab.yaml`).

Do not take running stands down while `up` is failing this way. There is no volume to recover from.

## `defaults.extra_packages` in `owlab.yaml` reaches every router

A package one router cannot resolve fails `owlab up` for all of them. The list merges additively,
with no way to opt a router out.

The openclash and ssclash apps need `kmod-tun`, which `owrtsnap` often cannot resolve. Its kmods
index is keyed to the box's exact kernel hash.

That is why the apps are declared once on a release router and aliased onto the others.
`owrtsnap` carries none.

## A package can be missing on `owrtsnap` on any given day

The snapshot indexes of `feeds/luci` and `feeds/packages` move independently. A `luci-app-*` and its
binary can briefly disagree.

Before treating a snapshot-only difference in section or DOM count as a theme finding, check what is
missing today: `grep 'unable to select' /var/log/apk.log` on `owrtsnap`.

## A snapshot stand can answer 502 when its ucode and luci-base come from different days

- Symptom: `logread` carries `Error relocating /usr/lib/ucode/html.so: … symbol not found`. Every
  page fails as not answering.
- Check before reading a snapshot finding:
  `curl -s -o /dev/null -w '%{http_code}' localhost:8022/cgi-bin/luci/` and
  `logread | grep relocating`.
- Fix: recreate the stand (`owlab up --rebuild owrtsnap`).

## `ucode` is not on the host; it lives in a stand

Run the template check where LuCI runs, after a sync or a `docker cp`:
`owlab exec <stand> -- ucode -T -c -o /dev/null <file>.ut`.

## A stand serves http only, so the login page's https hop cannot be measured as it comes

`uhttpd` has the certificate. What is missing is the listener: owlab publishes port 80 alone.

Reach the https side on the container's own address:

```sh
docker exec owlab-luci-theme-footstrap-owrt2512 sh -c \
    "uci set uhttpd.main.listen_https='0.0.0.0:443'; uci commit uhttpd; /etc/init.d/uhttpd restart"
docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' \
    owlab-luci-theme-footstrap-owrt2512      # -> curl -k https://<ip>/cgi-bin/luci
```

Put it back with `uci delete uhttpd.main.listen_https`.

## A control gated on /proc/mtd or the overlay mount is absent on a stand, under any theme

Take luci-mod-system's flash page (`view/system/flash.js`). It adds "Reset to defaults" only when
`/proc/mtd` names `rootfs_data` or `/proc/mounts` carries `overlayfs:/overlay / `.

Both reads degrade to an empty string through `fs.trimmed()`. A container has neither, so the button
is missing under footstrap and under bootstrap. Switch to bootstrap first to confirm.

To see the control, feed the data by intercepting the ubus reply:

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

## "Access denied" from uci/get on the login document is upstream LuCI

The message is `RPC call to uci/get failed with error -32002: Access denied`.

- Cause: the `luci.js` boot requires `form`. On the openwrt-24.10 and openwrt-25.12 branches,
  `form.js` runs `uci.loadPackage('luci').catch();`. That `.catch()` has no handler, so the
  anonymous session's denial goes unhandled. master has `.catch(() => {})`.
- It shows under stock bootstrap too, at a different rate.
- Tell it apart: switch `luci.main.mediaurlbase` to `/luci-static/bootstrap` and rerun.

## "It is the app's markup" is a claim; switching the stand to bootstrap checks it

Re-measure the same page at the same width under `/luci-static/bootstrap`.

Why: an overflow that looks like the app's markup can come from this theme's own wider buttons. This
is also why `tools/e2e.mjs` judges every page against bootstrap on the same router.

## When `tools/e2e.mjs` goes red, build the parent commit

1. Package the parent commit.
2. Install it the same way.
3. Run the same check.

A failure that reproduces there did not come from the change under test.

## A `<style>` injected into a live page is eaten by the theme's own fence

The fence is `fs-sheets.js`. It observes a new `<style>` in `<head>`.

If the sheet is invasive, the fence re-hosts it into `@layer theme` and scopes its selectors to the
current view. Invasive means a selector not pinned to a name the theme does not style. A rule aimed
at the chrome then matches nothing.

Inject through a constructed sheet instead. It is not a DOM node:

```js
const s = new CSSStyleSheet(); s.replaceSync('* { box-shadow: none !important }');
document.adoptedStyleSheets = [...document.adoptedStyleSheets, s];
```

## A page-scoped rule cannot be read off the gallery

No element in `docs/gallery.html` carries `data-page`, its `#view` included. So a rule written
`:where(#view)[data-page="admin-status-overview"] …` matches nothing there.

Take the reading off the playground or a stand.

## A leftover `dist/` can carry a version it is not

A size comparison against a stale build moves in the wrong direction. Build the baseline fresh from
the tag:

```sh
git archive <tag> | tar -x -C /clean/checkout && (cd /clean/checkout && ./tools/stage.sh)
```

## A hardware test build versioned `X.Y.Z_pN` never gives way to the release

On apk `_p` is a patch level, and it sorts above `X.Y.Z`:

| Command | Result |
|---|---|
| `apk version -t 0.14.15_rc1 0.14.15` | `<` |
| `apk version -t 0.14.15_p1 0.14.15` | `>` |

opkg sorts both `_rc1` and `_p1` above the release. Only `0.14.15~rc1` sorts below, and apk rejects
it.

- apk test build: stamp it as the next version's candidate, `FOOTSTRAP_VERSION=0.14.16_rc1` over
  0.14.15.
- opkg test build: it needs `opkg install --force-downgrade` back to the release.
