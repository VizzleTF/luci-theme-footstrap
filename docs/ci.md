# CI and packaging

How footstrap is turned into packages and shipped. The theme is noarch
(`LUCI_PKGARCH:=all`) and supports **OpenWrt 24.10** (`.ipk`/opkg) and **25.12+** (`.apk`/apk).

What the Makefile and the install scripts do, `install.sh`'s trust chain included:
[package.md](package.md). The release runbook:
[releasing.md](releasing.md).

## The job graph

`.github/workflows/build.yml`. Triggers: push to `main`, a `v*` tag, any pull request, or a manual
dispatch.

```
build ───────────────────────────┐
e2e (owrt2512, owrt2410) ────────┼─→ release ─→ playground-asset ─→ pages   (tags only)
build ─→ playground ─────────────┘
             └─→ pages-manual                                             (workflow_dispatch, publish-pages=true)
```

`e2e` does not wait for `build`: it stages and packs the same tree itself (below), so the two run
side by side and `release` waits for both.

| Job | What it is |
|---|---|
| `build` | the ACL check, then both package formats, via owfeed |
| `e2e` | `tools/e2e.mjs`, one leg per package manager: the package's whole life on a real router (below) |
| `playground` | records a real router's pages into a static, replayable site (tags and dispatches) |
| `release` | signs, generates the notes, attaches the assets |
| `playground-asset` | uploads `playground.tar.gz` to the tag's release, once one exists |
| `pages` | refreshes the GitHub Pages portal and the release mirror, from the latest release |
| `pages-manual` | same refresh, off a manual dispatch, from THIS run's own playground instead of a release — see `pages`, below |

`permissions: contents: read` at workflow level; only `release` and `playground-asset` declare
write, both gated to a `v*` tag. It used to be workflow-wide, which handed it to every
`pull_request` run — including every `npm ci`, and therefore to the lifecycle scripts of every
dev dependency.

**Dependencies arrive a week late and run no install script.** `.github/dependabot.yml` sets
`cooldown: default-days: 7` on both ecosystems (version updates only, never security updates), the
repo's `.npmrc` sets `ignore-scripts=true` for every `npm ci` (CI and a developer's shell), and `pages.yml` gives `pages: write` and `id-token: write` to `deploy` alone, so the job
that runs `npm ci` holds `contents: read` only. A new or replaced dependency needs the maintainer's word.
No `min-release-age` in `.npmrc`: it might hold back a Dependabot security update; the
cooldown and the maintainer's word on a new dependency carry the age.

**Every job in `build.yml` and `pages.yml` has a `timeout-minutes`, and the two Playwright installs
run under `tools/ci-retry.sh`.** The default job timeout is six hours, and the two things these
jobs fetch from somebody else's server that have stalled — apt and the Playwright CDN — stall rather
than fail: on the 0.13.2 tag one apt step and two
playwright steps sat for 68, 68 and 17 minutes with GitHub reporting every system operational, and
nothing retried them because nothing had failed. Each attempt now gets its own deadline (300 s
in `tools/ci-playwright.sh`, three attempts), so a stall is a retry rather than a blocked release,
and the job timeout is the backstop behind that rather than the only clock in the job. Each attempt runs in a session of its own and is killed by process GROUP, because `timeout` signals only the child it started: the first version of the helper killed `playwright install --with-deps` and left the `apt-get` beneath it holding the lists lock, after which both retries died in seconds on that lock.

And apt is asked for as little as possible, because retrying a stalled apt is still waiting for a
stalled apt: a run spent its whole 20-minute budget doing exactly that. `tools/ci-playwright.sh`
fetches the engines it is given (Chromium by default) from Playwright's CDN and then LAUNCHES each
— the claim `e2e` and `playground` actually need — going to apt for the system libraries only of
the engines whose launch fails. `--with-deps` went through apt every time, and apt is the half that
stalls. `playground` installs Chromium alone; `e2e` installs Chromium, Firefox and WebKit, for
the anchoring check.

## Reading a run

- `gh run list --commit <sha>` lists a commit's runs; `gh run watch <run-id> --exit-status` waits
  for one and exits non-zero on red.
- `gh run view <run-id> --log-failed` prints the failed steps' logs. It prints nothing while a run
  is still marked in progress.

## Rules the server holds

Three rulesets on the repository (Settings → Rules); `gh api repos/{owner}/{repo}/rulesets` lists them.

| Ruleset | Target | Rules | Bypass |
|---|---|---|---|
| 24042288 "main: CI must pass" | `main` | required status checks (3): `Build the packages`, `The package's life on owrt2512`, `The package's life on owrt2410` | admin, always: a direct push to `main` needs it, so each push reports the bypassed rule and the checks are read after the push (`gh run watch`) |
| 25550110 "main: no force-push or deletion" | the default branch | `non_fast_forward`, `deletion` | none, admin included |
| 25550119 "release tags: no move or deletion" | `refs/tags/v*` | `update`, `deletion` | none; creating a tag stays open for the release runbook |

The last two were created on 2026-10-21 on the maintainer's word (audit P1-5). With no bypass, no
token gets past them: a force-push or rewrite of `main`, or moving or deleting a released tag, starts
with the maintainer disabling that ruleset in the UI, then their word as before.

Most of what the jobs run lives in scripts rather than inline in the YAML — `tools/stage.sh`,
`tools/ci-playwright.sh`, `tools/e2e.mjs`, `tools/playground/*.mjs`, `tools/stage-release.sh`. A
step that is a script can be run by hand when it fails, and its reasoning lives beside the code
instead of inside a workflow nobody reads. Nothing in `package.json` ships: the buildbot has no node
and does not need it.

## `build` — owfeed, not the SDK

Both formats are built by [owfeed](https://github.com/owfeed/owfeed) from one staged rootfs.
The SDK legs are gone: the theme is noarch (CSS, templates, browser JS, fonts — not one byte of
compiled code), and each leg downloaded, verified and unpacked a cross toolchain in order to run
`cp`. Twice, because 24.10 is opkg and 25.12 is apk.

| Format | Line | noarch spelling | What owfeed does |
|---|---|---|---|
| apk | 25.12+ | `noarch` (`all` is rejected as uninstallable) | `apk mkpkg` + `.conffiles` sidecars |
| ipk | 24.10 | `all` | an `ipkg-build` container + `CONTROL/conffiles` |

Three things the SDK really provided, owfeed does itself: it compiles `.po` → `.lmo` with its own
compiler (**byte-identical to `po2lmo`** — checked on release 0.11.6), emits the same sidecars as
`package-pack.mk`, and wraps the scripts in `default_postinst`/`default_prerm`, without which
`/etc/uci-defaults/*` never runs at all.

**The SDK check did not leave with the SDK.** owfeed extracts the host `apk` from a release SDK
tarball and keeps it on the same chain this workflow used to spell out: an ed25519 signature over
`sha256sums`, the branch key pinned from a *different* host (`github.com/openwrt/keyring`), and the
sha256 read only out of an already-authenticated file.

**owfeed itself is installed by its own action** — `owfeed/owfeed/setup`, pinned by its `uses:` tag
alone — which downloads the binary and **verifies it against GitHub's build attestation before it
reaches PATH**. That is why it is preferred to `go install …@<sha>`, which compiles the tool in
every job and trusts whatever the module proxy returns. A `SHA256SUMS` next to a release is not a check either — the same
host serves both the binary and the sum (the same argument this project makes about GitHub's asset
digest). An attestation is signed by GitHub's identity, sits in a public transparency log, and the
action pins the workflow that was allowed to issue it. Verified locally on a release binary:
genuine → exit 0; one byte appended → exit 1; against a foreign repository → exit 1.

**No `version:` input anywhere in `build.yml`** (owfeed `setup`, owlab `setup` and `action`, and
`package.yml`'s `owfeed-version`). Dependabot moves the `uses:` ref and never an input, so a
`version: v0.5.1` beside `setup@v0.5.4` ran 0.5.1 under a ref that read 0.5.4; since owfeed 0.5.3 and
owlab 0.6.4 an unset version installs the release the ref names. `~/go/bin/owfeed` and `owlab` follow
the same refs (0.5.5, 0.6.6), taken from the GitHub release after `gh attestation verify -R
owfeed/<tool>` and the release's `SHA256SUMS`, so `tools/stage.sh && owfeed build` writes CI's bytes.

**Zopfli packages.** `owfeed.yml` sets `compression: zopfli` on all three packages (owfeed 0.5.5).
Measured on this tree with `SOURCE_DATE_EPOCH` fixed, as [package.md](package.md) "Measuring a size
change" describes: 24.10 `.ipk` 69065 → 65298 B from owfeed 0.5.5's best-level default alone, then
→ 62091 B with zopfli (`luci-i18n-footstrap-ru` 4375 → 3993, `-es` 3923 → 3608); the build
goes from 0.05 s to ~2.7 s, and two builds are byte-identical. The `.apk` leaves `owfeed build` at
its old size (65707 B) and shrinks inside `owfeed sign`, after `adbsign`: signed 65812-65818 →
62968-63053 B over ten signings each, since the ECDSA signature is random. `release` runs `owfeed
sign` through `package.yml` with `sign-key` set and `owfeed.yml` has no `signing.sign-packages:
false`, so the released `.apk` gets the re-deflate. By owfeed's docs a feed that adds its own
signature on top re-compresses the file and the saving is gone (not measured here), so the `.apk`
saving is certain for the release asset and not for the owfeed-packages copy. Without
`SOURCE_DATE_EPOCH` the `.apk` bytes follow the clock (two builds 2.7 s apart differed), which is
why CI sets it from the commit.

The steps:

0. **The ACL grants exactly this step's literal, which SECURITY.md lists** — `acl.d` must hold
   `luci-theme-footstrap.json` alone (rpcd loads every file there), and one `jq -e` compares that
   file with the literal in the step. The literal is the source of truth; `SECURITY.md` lists the
   same grants by hand, and nothing reads it. Any other grant (an `exec`, a new path, a new ubus
   method), a second file or a malformed one fails the job; rpcd itself skips a malformed ACL
   silently.
1. **`SOURCE_DATE_EPOCH`** = the commit timestamp: both containers write mtimes, and a package's
   identity is a hash over its payload, so without a fixed epoch byte-identical content rebuilds
   into a package that *claims* to be new. No step sets a version: `stage.sh` takes
   `FOOTSTRAP_VERSION`, else the newest tag (`git describe --tags --abbrev=0`, `v0.3.6` → `0.3.6`),
   else refuses to build. `build` sets no `FOOTSTRAP_VERSION`, so on a tag its packages carry that
   tag, and on a branch or a pull request the newest tag before it.
2. **`./tools/stage.sh`** — the half owfeed deliberately does not do ("packages a directory; does
   not build one"). It is `Build/Prepare` from the Makefile in one script, with uglify-js where
   luci.mk ran jsmin: build `cascade.css`, mangle the private `--fs-*` names, minify the JS with
   uglify-js, strip the comments and indentation out of
   the templates and the comments out of the shell, strip `logo.svg` and `manifest.json`, stamp
   `FS_VERSION`. Three things on top of `Build/Prepare`, which the SDK path does not need or does
   itself: `minify-prepaint` over the inline pre-paint script in `head.ut`; the postinst/postrm
   extraction, by awk over the Makefile's `define`s, not as a second copy (a script that runs on
   somebody else's router months later is the worst possible place for two copies to diverge); and
   the `chmod` below.
   It ends with `chmod -R u=rwX,go=rX` over `dist/`: owfeed copies modes from disk, so the 5 files
   (0600) and 4 directories (0700) a local worktree can hold shipped as `-rw-------` and
   `drwx------ ./www/`, and uhttpd answers 403 on a file that is not world-readable. A CI
   checkout has none of them, which is why only a local build showed it.
   Measured on this tree: uglify-js 3.19.3 (pinned exact, the one minifier for the modules,
   `fs-version.js` and the pre-paint blocks) leaves the staged JS at 86,295 B where terser 5.51.2
   left 88,982 B: -2,687 B raw, -260 B gz9, 1,968 B of it on every cold admin page (identifiers are
   wire bytes and uhttpd serves `/www` uncompressed); the .ipk is 71 B and the .apk 136 B smaller
   (zopfli, `SOURCE_DATE_EPOCH` fixed). `fs-version.js` runs with `evaluate:false`:
   at uglify's defaults `FS_VERSION` is folded into its readers (229 B, no declaration left for
   the version sed) and `minify-js` refuses the file; set, it is 258 B with the declaration
   intact. `varify:false` beside it changed nothing (the same 258 B, byte for byte, with and
   without), so it is not set. `minify-prepaint`, run after `strip-build.sh templates` as in `stage.sh`, takes the
   five inline blocks without ucode interpolation from 6424 to 4511 B (terser left 4632 B), 1913 B
   off every page load and off the login page, which fetches no module: 105 B less HTML per admin
   page and 119 B less on the login page than terser gave. Blocks with `{{`, `{%` or `{#`
   (`head.ut`'s `window.__fsSD` data object, 23 substitutions) are left as they are, and it runs
   over the build tree only.
3. **`owfeed build`** — deliberately without `--frozen-lock`. That flag re-derives `owfeed.lock`
   from `downloads.openwrt.org` and fails if it moved, which is right for a repository that
   **publishes a feed**, where the covered architecture set is part of the contract with
   subscribers. Here two noarch packages ride as release assets and expand into no architectures, so
   the flag buys nothing and costs a red release on every OpenWrt point release. The committed lock
   still pins which SDK the host `apk` comes from, so the toolchain does not float.

owfeed writes `dist/noarch` (apk) and `dist/all` (ipk): apk derives the filename from name and
version, so two architectures cannot share a directory.

## `e2e` — the package's life on a real router

That the build "produced an ipk" proves nothing about the ipk; this job is what does. One leg per
package manager, `fail-fast` off: `owrt2512` (25.12/apk) and `owrt2410` (24.10/opkg), each an owlab
router with LuCI and its apps but not this theme (`owfeed/owlab/setup` puts the CLI on PATH; the
binary is checked against its build attestation). The job does not wait for `build`: it stages and
packs the same tree itself with `FOOTSTRAP_VERSION=9999.0.0`, so installing it over the last release
is an upgrade by both package managers' rules; its payload differs from `build`'s only in the
version `fs-version.js` carries. The last release's package comes from `gh release download`. Then
`tools/e2e.mjs` walks the life an admin gives the package; [verifying.md](verifying.md) "What the
check proves" lists the steps and what fails a page.

**Bootstrap on the same router is the reference, not a list of expected problems.** A page fails
only for what footstrap adds over bootstrap on the same page, or when footstrap's own stylesheet,
token or menu is missing. The last one is what a broken template looks like from outside: luci.mk copies `ucode/` verbatim and nothing parses
it on the way, so a stray brace in `header.ut` would silently move every user's LuCI to another
theme. Both legs run it because the templates are identical but the interpreters are not, and a
construct 25.12's ucode accepts is no proof that 24.10's does.

After the crawl, with the build still installed and active, `tools/e2e.mjs` runs
`tools/anchor-check.mjs`: a poll tick growing Status > Overview above a parked reader, and one
shrinking it back, must leave them where bootstrap does in Chromium, Firefox and WebKit, and where nothing anchors the theme's own
correction must hold them ([verifying.md](verifying.md) "What the check proves").

Screenshots (one per page and width), `report.json` and `anchor-check.txt` are uploaded as artifact
`e2e-<router>`, also on a red run. Locally: `owlab up <router>`, then
`node tools/e2e.mjs --router <id> --old <release pkg> --new <built pkg>` (report under
`../tmp/e2e-<router>` unless `--out` says otherwise); [verifying.md](verifying.md) has the rest.

## `playground` — a real router, recorded and replayed

Turns `admin/status/overview` and seven other pages of an owlab stand into a static site any browser
can open with no router behind it. Three scripts, `tools/playground/`:

1. `capture.mjs` — boots nothing itself, talks to the `owrt2512` this job already installed the
   build on: logs in, fetches every page in `pages.json`, and records the server's own document, the
   `/luci-static/**` assets those pages fetched, every distinct ubus call and the ACL-filtered menu.
2. `build.mjs` — offline, deterministic: rewrites the recorded paths under `--base`, scrubs tokens
   and the stand's hostname, splices in `replay.js` (patches `XMLHttpRequest`/`fetch` to answer from
   the recording instead of a router), and tars the result.
3. `verify.mjs` — serves the built site in Chromium and fails on a page error, an unanswered ubus
   call, a 404 or an empty view, a client navigation that fell back to a full load, an Appearance
   change that does not survive a reload, or a login gate that does not let the reader in and out.
   The tarball reaches the release only if it passes.

Runs on a tag and on `workflow_dispatch` (the source `pages-manual` publishes from). It replaces the
475 KB hand-written snapshot that used to live here, which imitated `fs-*.js` inline and had already
gone 13 releases stale (`CHANGELOG.md`): this build runs the theme's own JS, so it cannot drift from
it the same way.

By hand (`npm run playground:capture` / `playground:build` / `playground:verify`): `docs/development.md`.

## `release` — signing and publication

Tags only, and **it is a call into owfeed's own reusable workflow** rather than steps of ours:

```yaml
release:
  needs: [build, e2e, playground]
  if: startsWith(github.ref, 'refs/tags/v')
  uses: owfeed/owfeed/.github/workflows/package.yml@v0.5.5
  secrets:    { sign-key: …OWFEED_AUTHOR_KEY, usign-key: …FOOTSTRAP_USIGN_KEY }
  with:       { pre-release: sh tools/stage-release.sh,
                sign-also: install.sh, notes-file: release-notes.md, verify-with: release.pub }
```

**This is the only job that holds a key**, and `e2e` in this `needs` list is what stops a tag
publishing a package that has not lived through install, upgrade, every page of the menu, removal
and a fresh install on both package managers. `playground` is in it because `playground-asset`
attaches its tarball to the release this job publishes.

`tools/stage-release.sh` is our half — the `pre-release` hook. It writes the release notes where the
workflow reads them and puts the one non-package asset into `dist/`, before the manifest is written,
because whatever is in `dist/` is signed with everything else:

- **the notes**, from `tools/release-notes.sh` — the tag's changelog section, one bold lead per
  bullet, grouped by category. They fill the release page and are **not** an asset: nothing on a
  router reads `notes.md`;
- **the installer**, because `raw.githubusercontent.com` is rate-limited for unauthenticated callers
  — so the user whose address has run out of budget (CGNAT, a shared exit) fails to download the
  installer meant to rescue them (issue #17) — and because a signed copy is the only one that can be
  checked before it runs as root. The README points at `main` and names this one as the fallback.

`sign-also: install.sh` gets it a signature of its own (it is not a package, so owfeed would not see
it otherwise), and `verify-with: release.pub` re-checks every signature against the key that is in
the repository and baked into the installer.

Result: one theme asset per format plus its `.sig`, the manifest plus its `.sig`, and the installer
plus its `.sig`. Each has a reader: the packages are what a router installs, the manifest is what
`install.sh` installs *from* when the feed cannot be read and where it reads the newest version for
its "the feed has not caught up yet" line, and the installer is the mirror the README names.

**About the manifest and readers in the field.** owfeed's format was copied from this project's own
manifest, with two differences, both safe by construction: the first line became
`owfeed-manifest 1` (nobody parses it), and the package architecture was appended to the end of
the `pkg` line. The order of the first six fields is untouchable: `install.sh` reads them positionally,
and a copy already on somebody's router cannot be fixed remotely — a field inserted before them
would make it fetch a URL that 404s. The workflow checks that order on every release rather than
relying on it.

## `playground-asset` — attaching the built playground to the release

Tags only, `needs: [release, playground]`. `dist/*` rides the manifest `release` signs, and
`playground.tar.gz` is a demo site rather than router payload — owfeed's `package.yml` has no input
for a foreign artifact, and putting one there would sign it as if it were one — so this is a plain
`gh release upload` against the tag `release` just published, in a job of its own with
`permissions: contents: write` and nothing else. `pages` waits on this job, not on `release` directly,
so its own fetch of `playground.tar.gz` (below) never races the upload that puts it there.

## `pages`

Publishes the developer portal to GitHub Pages: `docs/devkit.html` (generated by
`tools/devkit-build.mjs`, never committed) and `docs/gallery.html`, with a freshly built
`cascade.css` and `logo.svg` beside them. It also carries a **full mirror of the
latest release** — the manifest, its signature, the installer **and the packages** — on a different
host from github.com, so an outage or a block covering one need not cover the other. It is called by
`build.yml`'s `pages` job after `playground-asset` rather than triggered by `on: release`, because an event
raised by `GITHUB_TOKEN` does not trigger another workflow.

The devkit assembles itself from files that already exist — the real stylesheet, the export tier
parsed out of `02-tokens.css`, the widget markup from `gallery.html` — so nothing is hand-copied and
nothing can drift.

**The playground is not built here at all.** It is not source that lives in this repository; it is
fetched, already built, and unpacked into `_site/playground/`. Fast path: `releases/latest/download/playground.tar.gz`
(the `playground-asset` upload above). On a miss — the latest tag was cut before the recording moved
to CI, or between `release` and `playground-asset` — the newest non-draft release carrying the asset
is found with `gh api` and used, and the log names its tag. Fails OPEN only when no release carries
it (or a `workflow_dispatch` run on a branch, `docs/development.md`): `::warning::` and the rest of
the portal publishes without the playground. A failing `gh api` or download fails the step, on
purpose: the previous Pages deploy stays up rather than being replaced by one without the playground.
`_site/playground.html` is kept as a redirect to `playground/` for the links
the README and `devkit.src.html` already carry.

**A maintainer can publish Pages from a single run's own recording, without a tag:**

```sh
gh workflow run build.yml --ref <ref> -f publish-pages=true
```

This runs `build.yml`'s `pages-manual` job (`needs: playground`, off by default), which calls
`pages.yml` with `playground-source: artifact` — everything above is unchanged except the playground
fetch, which reads the `playground` artifact this same run uploaded instead of
`releases/latest/download/playground.tar.gz`, and FAILS CLOSED on a miss rather than publishing the
rest of the portal. Two things to know before using it:

- **The `github-pages` environment accepts only `main` or a `v*` tag as a deployment branch**
  (repo Settings -> Environments -> github-pages; checked 2026-09-14 with
  `gh api repos/…/environments/github-pages/deployment-branch-policies`:
  `custom_branch_policies` = `[main, v*]`). `--ref` naming anything else reaches `deploy` — `build`
  and the artifact fetch already ran — and is refused there.
- **The next push to `main` under the paths `pages.yml` watches overwrites a manual publish.** That
  run fires from `pages.yml`'s own push trigger, `playground-source` defaults back to `release`
  there, and Pages goes back to mirroring the latest tag.

## Package formats, and the usual mistake

- **apk** (25.12+) — the Alpine apk-tools format, which OpenWrt adopted in 25.12.
- **ipk** (24.10) — gzip-tar: `./debian-binary` (2.0) + `./control.tar.gz` + `./data.tar.gz` with
  ustar headers. Identical to native OpenWrt ipks.

**"Malformed package file" from opkg** is almost always the wrong file: a GitHub artifact's zip
wrapper, or an `.apk` where an `.ipk` belongs.

The `e2e` leg on `owrt2410` installs, upgrades and removes the `.ipk` with the router's own opkg.

**All four lifecycle scripts are present in both containers.** The first version of owfeed emitted
only `postinst` and `prerm` into the ipk — the pair `package-pack.mk` generates, and easy to mistake
for the whole set — so `postrm` (unregistering the theme, putting `mediaurlbase` back) reached apk
and not opkg. Fixed before the first release built with it, and checked against the 0.11.6 SDK build:
all four agree in meaning, with only cosmetic differences.
