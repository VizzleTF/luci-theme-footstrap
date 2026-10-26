# CI and packaging

How footstrap is turned into packages and shipped. The theme is noarch (`LUCI_PKGARCH:=all`) and
supports OpenWrt 24.10 (`.ipk`, opkg) and 25.12+ (`.apk`, apk).

What the Makefile and the install scripts do, `install.sh`'s trust chain included:
[package.md](package.md). The release runbook: [releasing.md](releasing.md). What the router
checks prove and how to read their artifacts: [verifying.md](verifying.md).

## The job graph

`.github/workflows/build.yml`. Triggers: push to `main`, a `v*` tag, any pull request, or a manual
dispatch.

```
build ───────────────────────────┐
e2e    (owrt2512, owrt2410) ─────┤
anchor (owrt2512, owrt2410) ─────┼─→ release ─→ playground-asset ─→ pages   (tags only)
build ─→ playground ─────────────┘
             └─→ pages-manual                                             (workflow_dispatch, publish-pages=true)
```

`e2e` and `anchor` do not wait for `build`: each stages and packs the same tree itself (below), so
the three run side by side. `release` waits for `build`, `e2e`, `anchor` and `playground`.

| Job | What it is |
|---|---|
| `build` | the ACL check, then both package formats, via owfeed |
| `e2e` | `tools/e2e.mjs --no-anchor`, one leg per package manager: the package's whole life on a real router (below) |
| `anchor` | `tools/anchor-check.mjs`, one leg per package manager, beside `e2e` on a router of its own (below) |
| `playground` | records a real router's pages into a static, replayable site (tags and dispatches) |
| `release` | signs, generates the notes, attaches the assets |
| `playground-asset` | uploads `playground.tar.gz` to the tag's release, once one exists |
| `pages` | refreshes the GitHub Pages portal and the release mirror, from the latest release |
| `pages-manual` | the same refresh, off a manual dispatch, from this run's own playground (see `pages`, below) |

`permissions: contents: read` at workflow level. Only `release` and `playground-asset` declare
`contents: write`, and both run on a `v*` tag only.

Dependencies arrive a week late and run no install script. `.github/dependabot.yml` sets
`cooldown: default-days: 7` on both ecosystems (version updates only, never security updates). The
repo's `.npmrc` sets `ignore-scripts=true` for every `npm ci`, in CI and in a developer's shell.
`pages.yml` gives `pages: write` and `id-token: write` to `deploy` alone, so the job that runs
`npm ci` holds `contents: read` only. A new or replaced dependency needs the maintainer's word.
There is no `min-release-age` in `.npmrc`: it might hold back a Dependabot security update.

Every job in `build.yml` and `pages.yml` has a `timeout-minutes`. Every Playwright install (`e2e`,
`anchor`, `playground`) runs through `tools/ci-playwright.sh`, which runs the download under
`tools/ci-retry.sh`. apt and the Playwright CDN stall rather than fail, and a stalled step is never
retried. So each attempt gets its own deadline (300 s, three attempts), and the job timeout is only
the backstop. Each attempt runs in a session of its own and is killed by process group, because
`timeout` signals only the child it started and a surviving `apt-get` keeps the lists lock. A
slow mirror stays slow, and apt falls back to the next one only on an error. So after a failed
attempt `ci-retry.sh` drops the first line of `/etc/apt/apt-mirrors.txt`, and the retry asks the
next mirror.

`tools/ci-playwright.sh` fetches the engines it is given (Chromium by default) from Playwright's
CDN, launches each, and goes to apt only for the engines whose launch fails. `e2e` and `playground`
install Chromium; `anchor` installs Chromium, Firefox and WebKit. WebKit does not launch on
GitHub's image and needs 117 MB of `.deb` from apt. `anchor` keeps them in `actions/cache`
(`~/.cache/playwright-debs`, keyed by the runner image and Playwright's version) and passes the
directory as `PW_DEB_CACHE`. apt then downloads only packages that changed since the save.

## Rules the server holds

Three rulesets on the repository (Settings → Rules); `gh api repos/{owner}/{repo}/rulesets` lists them.

| Ruleset | Target | Rules | Bypass |
|---|---|---|---|
| 24042288 "main: CI must pass" | `main` | required status checks (5): `Build the packages`, `The package's life on owrt2512`, `The package's life on owrt2410`, `Scroll anchoring on owrt2512`, `Scroll anchoring on owrt2410` | admin, always: a direct push to `main` needs it, so each push reports the bypassed rule and the checks are read after the push (`gh run watch`) |
| 25550110 "main: no force-push or deletion" | the default branch | `non_fast_forward`, `deletion` | none, admin included |
| 25550119 "release tags: no move or deletion" | `refs/tags/v*` | `update`, `deletion` | none; creating a tag stays open for the release runbook |

With no bypass, no token gets past the last two. A force-push or rewrite of `main`, or moving or
deleting a released tag, starts with the maintainer disabling that ruleset in the UI.

Most of what the jobs run lives in scripts: `tools/stage.sh`, `tools/ci-playwright.sh`,
`tools/e2e.mjs`, `tools/anchor-check.mjs`, `tools/playground/*.mjs`, `tools/stage-release.sh`. A
step that is a script can be run by hand when it fails. Nothing in `package.json` ships: the
buildbot has no node and does not need it.

## `build`: owfeed, not the SDK

Both formats are built by [owfeed](https://github.com/owfeed/owfeed) from one staged rootfs. The
theme is noarch (CSS, templates, browser JS, no compiled code), so a cross toolchain buys nothing.

| Format | Line | noarch spelling | What owfeed does |
|---|---|---|---|
| apk | 25.12+ | `noarch` (`all` is rejected as uninstallable) | `apk mkpkg` + `.conffiles` sidecars |
| ipk | 24.10 | `all` | an `ipkg-build` container + `CONTROL/conffiles` |

owfeed does the three things the SDK provided. It compiles `.po` → `.lmo` with its own compiler,
byte-identical to `po2lmo`. It emits the same sidecars as `package-pack.mk`. It wraps the scripts
in `default_postinst`/`default_prerm`, without which `/etc/uci-defaults/*` never runs. Both
containers carry the same lifecycle scripts, `postrm` included.

owfeed extracts the host `apk` from a release SDK tarball and checks it three ways. An ed25519
signature covers `sha256sums`. The branch key is pinned from a different host
(`github.com/openwrt/keyring`). The sha256 is read only from an already-authenticated file.

owfeed itself is installed by its own action, `owfeed/owfeed/setup`, pinned by its `uses:` tag
alone. The action verifies the binary against GitHub's build attestation before it reaches PATH.
That is why it is preferred to `go install …@<sha>`, which trusts whatever the module proxy
returns. A `SHA256SUMS` beside a release is no check: the same host serves the binary and the sum.
An attestation is signed by GitHub's identity, sits in a public transparency log, and the action
pins the workflow allowed to issue it.

No `version:` input anywhere in `build.yml`: not on owfeed `setup`, owlab `setup` and `action`, nor
`package.yml`'s `owfeed-version`. Dependabot moves the `uses:` ref and never an input, and an unset
version installs the release the ref names. `~/go/bin/owfeed` and `owlab` follow the same refs,
taken from the GitHub release after `gh attestation verify -R owfeed/<tool>`, so
`tools/stage.sh && owfeed build` writes CI's bytes.

**Zopfli packages.** `owfeed.yml` sets `compression: zopfli` on all three packages. The `.apk` is
re-deflated inside `owfeed sign`, after `adbsign`, so the release asset is smaller. A feed that adds
its own signature on top re-compresses the file, so the owfeed-packages copy may lose the saving.

The steps:

0. **The ACL grants exactly this step's literal, which SECURITY.md lists.** `acl.d` must hold
   `luci-theme-footstrap.json` alone (rpcd loads every file there), and one `jq -e` compares that
   file with the literal in the step. The literal is the source of truth; `SECURITY.md` lists the
   same grants by hand. Any other grant (an `exec`, a new path, a new ubus method), a second file or
   a malformed one fails the job; rpcd itself skips a malformed ACL silently.
1. **`SOURCE_DATE_EPOCH`** = the commit timestamp. Both containers write mtimes, and a package's
   identity is a hash over its payload. Without a fixed epoch, the same content rebuilds into a
   package that claims to be new. No step sets a version: `stage.sh` takes `FOOTSTRAP_VERSION`,
   else the newest tag (`git describe --tags --abbrev=0`, `v0.3.6` → `0.3.6`), else refuses to
   build. `build` sets no `FOOTSTRAP_VERSION`, so on a tag its packages carry that tag, and on a
   branch or a pull request the newest tag before it.
2. **`./tools/stage.sh`**, the half owfeed does not do ("packages a directory; does not build
   one"). It is the Makefile's `Build/Prepare` in one script, with uglify-js where luci.mk ran
   jsmin. It builds `cascade.css`, mangles the private `--fs-*` names and minifies the JS. It
   strips comments and indentation from the templates, comments from the shell, and `logo.svg` and
   `manifest.json`, then stamps `FS_VERSION`. Three steps go beyond `Build/Prepare`:
   - `minify-prepaint` over the inline pre-paint blocks without ucode interpolation;
   - postinst/postrm extracted from the Makefile's `define`s with awk, so there is one copy;
   - `chmod -R u=rwX,go=rX` over `dist/`: owfeed copies modes from disk, and uhttpd answers 403 on
     a file that is not world-readable.

   `fs-version.js` is minified with `evaluate:false`, so the `FS_VERSION` declaration survives for
   the version `sed`.
3. **`owfeed build`**, without `--frozen-lock`. That flag re-derives `owfeed.lock` from
   `downloads.openwrt.org` and fails if it moved. It suits a repository that publishes a feed.
   Here three noarch packages ride as release assets, so the flag would only turn every OpenWrt
   point release into a red release. The committed lock still pins which SDK the host `apk` comes
   from.

owfeed writes `dist/noarch` (apk) and `dist/all` (ipk): apk derives the filename from name and
version, so two architectures cannot share a directory.

## `e2e`: the package's life on a real router

A built ipk proves nothing about the ipk; this job does. One leg per package manager, `fail-fast`
off: `owrt2512` (25.12/apk) and `owrt2410` (24.10/opkg), each an owlab router with LuCI and its apps
but not this theme. `owfeed/owlab/setup` puts the CLI on PATH after checking its build attestation.
The job stages and packs the tree itself with `FOOTSTRAP_VERSION=9999.0.0`, so installing it over
the last release is an upgrade under both package managers' rules. The last release's package
comes from `gh release download`. Then `tools/e2e.mjs` walks the life an admin gives the package;
[verifying.md](verifying.md) "What the check proves" lists the steps and what fails a page. Both
legs run because the templates are identical but the ucode interpreters are not.

Screenshots (one per page and width) and `report.json` are uploaded as artifact `e2e-<router>`,
also on a red run.

## `anchor`: scroll anchoring on a real router

`tools/anchor-check.mjs` on a router of its own, beside `e2e`. The same 9999.0.0 build is installed
with `owlab install`. One poll tick grows Status > Overview above a parked reader, and one shrinks it
back. Each must leave the reader where bootstrap does, in Chromium, Firefox and WebKit
([verifying.md](verifying.md) "What the check proves"). Its log is uploaded as artifact
`anchor-<router>`.

## What `e2e` and `anchor` share

Each builds its router in the background. `owlab up` starts right after checkout, and the
`Wait for the router` step before the run prints its log and fails with its exit status. The
browsers (`~/.cache/ms-playwright`, keyed by Playwright's version and the engines) and owfeed's SDK
(`~/.cache/owfeed`, keyed by `owfeed.lock`) come from `actions/cache`.

A change that touches documentation alone skips the steps of both jobs. The first step runs
`tools/ci-package-changed.sh` against the PR's base or the push's previous head. Every later step is
gated on its answer: `docs/` and any `*.md` outside the package payload do not count. The job itself
still runs, because a matrix job skipped at job level reports its name unexpanded, and the required
check would wait forever.

## `playground`: a real router, recorded and replayed

Turns `admin/status/overview` and seven other pages of an owlab stand into a static site any browser
can open with no router behind it. Three scripts, `tools/playground/`:

1. `capture.mjs` boots nothing itself and talks to the `owrt2512` this job already installed the
   build on. It logs in, fetches every page in `pages.json`, and records the server's own document,
   the `/luci-static/**` assets those pages fetched, every distinct ubus call and the ACL-filtered
   menu.
2. `build.mjs` is offline and deterministic. It rewrites the recorded paths under `--base`, scrubs
   tokens and the stand's hostname, splices in `replay.js` (patches `XMLHttpRequest`/`fetch` to
   answer from the recording), and tars the result.
3. `verify.mjs` serves the built site in Chromium. It fails on a page error, an unanswered ubus
   call, a 404 or an empty view, or a client navigation that fell back to a full load. It also fails
   when an Appearance change does not survive a reload or the login gate does not let the reader in
   and out.
   The tarball reaches the release only if it passes.

Runs on a tag and on `workflow_dispatch` (the source `pages-manual` publishes from). The site runs
the theme's own JS, so it cannot drift from it. By hand: [development.md](development.md) "The
playground: recording and replaying a real router".

## `release`: signing and publication

Tags only. It calls owfeed's own reusable workflow instead of running steps of ours:

```yaml
release:
  needs: [build, e2e, anchor, playground]
  if: startsWith(github.ref, 'refs/tags/v')
  uses: owfeed/owfeed/.github/workflows/package.yml@v0.5.5
  secrets:    { sign-key: …OWFEED_AUTHOR_KEY, usign-key: …FOOTSTRAP_USIGN_KEY }
  with:       { pre-release: sh tools/stage-release.sh,
                sign-also: install.sh, notes-file: release-notes.md, verify-with: release.pub }
```

This is the only job that holds a key. `e2e` and `anchor` in its `needs` stop a tag from publishing
an untried package. The package must first live through install, upgrade, every menu page, the
anchoring check, removal and a fresh install on both package managers. `playground` is there because
`playground-asset` attaches its tarball to the release this job publishes.

`tools/stage-release.sh` is our half, the `pre-release` hook. It writes the release notes where the
workflow reads them and puts the one non-package asset into `dist/` before the manifest is written,
because everything in `dist/` is signed:

- the notes, from `tools/release-notes.sh`: the tag's changelog section, one bold lead per bullet,
  grouped by category. They fill the release page and are not an asset: nothing on a router reads
  `release-notes.md`;
- the installer. `raw.githubusercontent.com` is rate-limited for unauthenticated callers, so a user
  behind a shared address (CGNAT, a shared exit) can fail to fetch the installer meant to rescue
  them (issue #17). A signed copy is also the only one that can be checked before it runs as root.
  The README points at `main` and names this copy as the fallback.

`sign-also: install.sh` gives the installer a signature of its own (it is not a package, so owfeed
would not see it otherwise). `verify-with: release.pub` re-checks every signature against the key
in the repository, the one baked into the installer.

Result: one asset per package and format plus its `.sig`, the manifest plus its `.sig`, and the
installer plus its `.sig`. The packages are what a router installs. The manifest is what
`install.sh` installs from when the feed cannot be read, and where it reads the newest version for
its "the feed has not caught up yet" line. The installer is the mirror the README names.

The manifest's field order is fixed. Its first line is `owfeed-manifest 1` (nobody parses it), and
the package architecture is the last field of the `pkg` line. `install.sh` reads the first six
fields by position. A copy already on somebody's router cannot be fixed remotely, and a field
inserted before them would make it fetch a URL that 404s. The workflow checks that order on every
release.

## `playground-asset`: attaching the built playground to the release

Tags only, `needs: [release, playground]`. `playground.tar.gz` is a demo site, not router payload.
owfeed's `package.yml` has no input for a foreign artifact, and adding one there would sign it as a
package. So this job runs `gh release upload` against the tag `release` published, with
`permissions: contents: write` and nothing else. `pages` waits on this job, so its fetch of
`playground.tar.gz` never races the upload.

## `pages`

Publishes the developer portal to GitHub Pages: `docs/devkit.html` (generated by
`tools/devkit-build.mjs`, never committed) and `docs/gallery.html`, with a freshly built
`cascade.css` and `logo.svg` beside them. It also carries a full mirror of the latest release: the
manifest, its signature, the installer and the packages. The mirror sits on a host other than
github.com, so an outage or a block of one need not cover the other.
 `build.yml`'s `pages` job calls it after
`playground-asset`, because an event raised by `GITHUB_TOKEN` does not trigger another workflow,
so `on: release` would never fire.

The devkit assembles itself from files that already exist: the real stylesheet, the export tier
parsed out of `02-tokens.css`, the widget markup from `gallery.html`. Nothing is hand-copied.

The playground is not built here. It is fetched, already built, and unpacked into
`_site/playground/`. Fast path: `releases/latest/download/playground.tar.gz`. On a miss, the newest
non-draft release carrying the asset is found with `gh api` and used, and the log names its tag.
When no release carries it, the step prints `::warning::` and the rest of the portal publishes
without the playground. A failing `gh api` or download fails the step, so the previous Pages deploy
stays up. `_site/playground.html` is kept as a redirect to `playground/` for the links the README
and `devkit.src.html` carry.

A maintainer can publish Pages from a single run's own recording, without a tag:

```sh
gh workflow run build.yml --ref <ref> -f publish-pages=true
```

This runs `build.yml`'s `pages-manual` job (`needs: playground`, off by default), which calls
`pages.yml` with `playground-source: artifact`. Only the playground fetch changes: it reads the
`playground` artifact this run uploaded, and fails closed on a miss. Two limits:

- The `github-pages` environment accepts only `main` or a `v*` tag as a deployment branch (Settings
  → Environments → github-pages). A `--ref` naming anything else is refused at `deploy`, after
  `build` and the artifact fetch have run.
- The next push to `main` under the paths `pages.yml` watches overwrites a manual publish:
  `playground-source` defaults back to `release` there.

## "Malformed package file"

From opkg, this is almost always the wrong file: a GitHub artifact's zip wrapper, or an `.apk` where
an `.ipk` belongs. An `.ipk` is a gzip-tar of `./debian-binary`, `./control.tar.gz` and
`./data.tar.gz`, like a native OpenWrt ipk.
