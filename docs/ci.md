# CI and packaging

How footstrap is turned into packages and shipped. The theme is noarch
(`LUCI_PKGARCH:=all`) and supports **OpenWrt 24.10** (`.ipk`/opkg) and **25.12+** (`.apk`/apk).

What the Makefile and the install scripts do: [package.md](package.md). The release runbook:
[releasing.md](releasing.md).

## The job graph

`.github/workflows/build.yml`. Triggers: push to `main`, a `v*` tag, any pull request, or a manual
dispatch.

```
build ─┬─→ e2e (owrt2512, owrt2410) ─┬─→ release ─→ playground-asset ─→ pages   (tags only)
       └─→ playground ───────────────┘
                └─→ pages-manual                                               (workflow_dispatch, publish-pages=true)
```

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

**Every job has a `timeout-minutes`, and every network install runs under `tools/ci-retry.sh`.**
The default job timeout is six hours, and the two things these jobs fetch from somebody else's
server — apt and the Playwright CDN — stall rather than fail: on the 0.13.2 tag one apt step and two
playwright steps sat for 68, 68 and 17 minutes with GitHub reporting every system operational, and
nothing retried them because nothing had failed. Each attempt now gets its own deadline (300 s
in `tools/ci-playwright.sh`, three attempts), so a stall is a retry rather than a blocked release,
and the job timeout is the backstop behind that rather than the only clock in the job. Each attempt runs in a session of its own and is killed by process GROUP, because `timeout` signals only the child it started: the first version of the helper killed `playwright install --with-deps` and left the `apt-get` beneath it holding the lists lock, after which both retries died in seconds on that lock.

And apt is asked for as little as possible, because retrying a stalled apt is still waiting for a
stalled apt: a run spent its whole 20-minute budget doing exactly that. `tools/ci-playwright.sh`
fetches Chromium from Playwright's CDN and then LAUNCHES it — the claim `e2e` and `playground`
actually need — going to apt for the system libraries only if that launch fails. `--with-deps` went through apt every time,
and apt is the half that stalls.

## Reading a run

- `gh run list --commit <sha>` lists a commit's runs; `gh run watch <run-id> --exit-status` waits
  for one and exits non-zero on red.
- `gh run view <run-id> --log-failed` prints the failed steps' logs. It prints nothing while a run
  is still marked in progress.

## Rules the server holds

Three rulesets on the repository (Settings → Rules); `gh api repos/{owner}/{repo}/rulesets` lists them.

| Ruleset | Target | Rules | Bypass |
|---|---|---|---|
| 24042288 "main: CI must pass" | `main` | required status checks (11) | admin, always: a direct push to `main` needs it, so each push prints "Bypassed rule violations … 11 of 11" and the checks are read after the push (`gh run watch`) |
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

0. **The ACL grants only what SECURITY.md lists** — one `jq -e` that compares the rpcd ACL with the
   grant list in `SECURITY.md`. Any other grant (an `exec`, a new path, a new ubus method) or a
   malformed file fails the job; rpcd itself skips a malformed ACL silently.
1. **Resolve the version** — from the tag (`v0.3.6` → `0.3.6`) or a fallback `0.<date>.<run>`. Plus
   `SOURCE_DATE_EPOCH` = the commit timestamp: both containers write mtimes, and a package's
   identity is a hash over its payload, so without a fixed epoch byte-identical content rebuilds
   into a package that *claims* to be new.
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
binary is checked against its build attestation). The job stages the build under test again with
`FOOTSTRAP_VERSION=9999.0.0`, so installing it over the last release is an upgrade by both package
managers' rules; its payload is the same tree `build` packs. The last release's package comes from
`gh release download`. Then `tools/e2e.mjs` walks the life an admin gives the package:

1. install the last published release — Footstrap is offered, the active theme is left alone;
2. the admin picks footstrap and saves a footstrap uci setting;
3. upgrade to this build — the theme choice and the setting must survive;
4. every page of the menu is opened by a full load at 1280 and 390 px and by a click in the
   chrome; then the same pages under bootstrap;
5. remove the package — LuCI falls back to bootstrap and still serves the login;
6. a fresh install of this build — offered, the active theme left alone.

**Bootstrap on the same router is the reference, not a list of expected problems.** A page fails
only for what footstrap adds — a JS error, a failed same-origin request, a view that never renders
where bootstrap's does — or when footstrap's own stylesheet or chrome is missing. The last one is
what a broken template looks like from outside: luci.mk copies `ucode/` verbatim and nothing parses
it on the way, so a stray brace in `header.ut` would silently move every user's LuCI to another
theme. Both legs run it because the templates are identical but the interpreters are not, and a
construct 25.12's ucode accepts is no proof that 24.10's does.

Screenshots (one per page and width) and `report.json` are uploaded as artifact
`e2e-<router>`, also on a red run. Locally: `owlab up <router>`, then
`node tools/e2e.mjs --router <id> --old <release pkg> --new <built pkg>` (report under
`../tmp/e2e-<router>` unless `--out` says otherwise); [verifying.md](verifying.md) has the rest.

## `playground` — a real router, recorded and replayed

Turns `admin/status/overview` and seven other pages of an owlab stand into a static site any browser
can open with no router behind it. Two scripts, `tools/playground/`:

1. `capture.mjs` — boots nothing itself, talks to the `owrt2512` this job already installed the
   build on: logs in, fetches every page in `pages.json`, and records the server's own document, the
   `/luci-static/**` assets those pages fetched, every distinct ubus call and the ACL-filtered menu.
2. `build.mjs` — offline, deterministic: rewrites the recorded paths under `--base`, scrubs tokens
   and the stand's hostname, splices in `replay.js` (patches `XMLHttpRequest`/`fetch` to answer from
   the recording instead of a router), and tars the result.

Runs on a tag and on `workflow_dispatch` (the source `pages-manual` publishes from). It replaces the
475 KB hand-written snapshot that used to live here, which imitated `fs-*.js` inline and had already
gone 13 releases stale (`CHANGELOG.md`): this build runs the theme's own JS, so it cannot drift from
it the same way.

By hand (`npm run playground:capture` / `playground:build`): `docs/development.md`.

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
`release` (by way of `playground-asset`) rather than triggered by `on: release`, because an event
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

## Installation and the trust chain

`install.sh` does one thing: it adds the owfeed-packages feed (key, repository entry, and a
`keep.d` entry so a sysupgrade does not lose the key) and installs the theme from there.
`apk upgrade` / `opkg upgrade` carries it forward afterwards, which is the whole reason to install
from a feed rather than from a file.

It then installs the catalogue for `luci.main.lang`, and **the feed not carrying that package is not
a refusal**: a release reaches owfeed-packages through a pull request, so a NEW package — which
`luci-i18n-footstrap-<lang>` was in 0.14.4 — is missing from the feed until that merges, while the
signed asset for it is already in the release. The fallback takes it from the release through the
chain below, pinned to the tag the installed theme came from, and `apk upgrade` picks the package up
from the feed once it lands there.

```sh
wget -qO- https://github.com/VizzleTF/luci-theme-footstrap/releases/latest/download/install.sh | sh
```

**The repository line goes into the manager's own customfeeds file**, `customfeeds.list` for apk and
`customfeeds.conf` for opkg — not into a file of the theme's own. apk reads every `*.list` under
`repositories.d/`, so a private file installs and upgrades just as well; what it cannot do is be
seen. LuCI's package manager reads exactly three apk paths — `repositories`,
`repositories.d/distfeeds.list`, `repositories.d/customfeeds.list` — in its rpcd ACL *and* hardcoded
in `package-manager.js`, so a feed anywhere else is absent from "Configure APK" and cannot be edited
or removed there. An installer from before this wrote `repositories.d/owfeed-packages.list`, which
is why the apk branch deletes that file after writing its own line — the same repository configured
twice, once where the admin can see it and once where they cannot, is worse than either. Neither
customfeeds file needs a `keep.d` entry: both are conffiles of their manager (`apk-mbedtls`, `opkg`),
sysupgrade backs up every conffile whose checksum has moved, and `build_list_of_backup_overlay_files`
was already dropping the duplicate entry the script used to add.

**The line is MOVED to be the first non-comment line, never merely appended or left wherever it
already was** — measured on real apk: its customfeeds reader stops at the first line it cannot
parse, so an admin's own unrelated line (or a stale one from an older run) sitting above where the
correct line used to land could cut the feed off with no error at all, and a router this project's
own OLDER installer had already configured has exactly that shape (the line appended, after
whatever else was there) — so "is the line present" has to become "is it first", checked and
repaired on every run, not only when the line is missing outright; the closing message distinguishes
the three outcomes ("Adding"/"Feed added" when the line was missing, "Moving … to the top" when it
only had to be repositioned, "already configured" when nothing changed). Every other ACTIVE line
naming the feed's host (case-insensitive) or, on opkg, its src name, is commented out and reported
rather than left to shadow the correct one; a line for any other host is untouched.

Both this and the stale-line cleanup write the result atomically and never `mv` a fresh file over the
customfeeds path directly: they resolve it with `readlink -f`, `cp -p` its mode and owner onto a temp
file in the SAME directory (so the rename stays on one filesystem), write the new content into that
copy, and only then `mv -f` it over the resolved target. A customfeeds file that is itself a symlink
keeps being one — the rename replaces what it points at, never the link — and a write that fails
partway (a full overlay, OOM, a `cp`/`cat`/`mv` a hostile PATH entry shadows) leaves the original
byte-identical, because nothing is truncated until the copy is complete and the rename is what
actually takes effect. **The failure itself is checked, not inferred**: `disable_other_lines`'s
"disabled:" lines wait until the write actually lands before printing, and `ensure_first` reports
its outcome through a real exit status the caller tests with `if`, never through `$(…)`, whose own
exit code `set -e` cannot see — a failure to write the feeds file now exits 1 with one error naming
the file, leaving it unchanged and no temporary files behind, instead of printing "Adding the
feed…"/"disabled: …" over a write that silently never happened (measured on both package managers
with `cp`, `mv`, and — on opkg — `cat` shimmed to fail; on apk a failing `cat` is intercepted
earlier, at reading `/etc/apk/arch`, and reported there instead).

**A snapshot router is served the newest release branch.** The feed publishes one branch per
OpenWrt minor and has no snapshot channel — owfeed-packages lists exactly two release lines and they
*are* the package-format split (apk from 25.12, ipk on 24.10), not a build of the theme per release.
So `SNAPSHOT`, which parses to no branch, gets the newest branch its own package manager can read:
`FALLBACK_BRANCHES_APK` / `_OPKG` in the script, probed newest-first against
`releases/<branch>/<arch>/<index>` rather than assumed, so a branch listed before it is published —
or one that does not carry this router's architecture — falls through instead of writing a
repository entry that 404s on every update. What makes it sound here and not in general: the theme
is noarch and `+luci-base` is its whole dependency list, so nothing in it was compiled against the
branch it comes from. The probe's bytes are discarded; the index it found is still verified below.
When no candidate answers, the script installs the signed release instead (below) rather than
refusing — measured in an `openwrt/rootfs` snapshot container (`apk add` from the 25.12 branch, no
`--allow-untrusted`, theme registered) and with the feed host pointed at a name that does not
resolve.

**Every downloader on the box is tried, not the first one that exists.** `uclient-fetch` needs
libustream-mbedtls to speak https at all, and an image that ships wget-ssl or curl instead carries
the binary without the library — so choosing by existence reported "the feed carries no branch for
this router" when the truth was "this one tool cannot do TLS here". Reproduced with a
`uclient-fetch` stub that always fails: the old script printed exactly the field report, the current
one falls through to `wget` and installs from the feed. None of the three is ever asked to skip
certificate verification; falling through to the next TOOL is not a downgrade.

**What verifies the bytes on the feed path is the package manager**, against the feed key pinned in
the script: apk checks the index against `owfeed-packages.pem`, opkg against usign key
`9040356b214084da`.

**The theme is now also carried by the official openwrt/luci feed, and a bare `apk add` picks that
build instead of owfeed's.** apk resolves a name it is given with no version constraint to the
HIGHEST version across every configured repository, not the one the repository line just added
serves — and luci.mk stamps a LuCI-carried package from git's commit date rather than this
project's own numbering. Measured on owrt2512 (OpenWrt 25.12.4, apk-tools 3.0.5):

```
# apk list luci-theme-footstrap
luci-theme-footstrap-0.14.10-r1            noarch {luci-theme-footstrap}   ← owfeed
luci-theme-footstrap-26.246.70755~4fd72fd  noarch {feeds/luci/…}           ← official feed
```

`install.sh`'s `apk add --upgrade "$PKG"` moved a router onto the second line — reported as
"Upgraded luci-theme-footstrap 0.14.9-r1 -> 26.246.70755~4fd72fd", which is not an upgrade: that
build predates this release (no rpcd-reload fix, no checkbox-tooltip fix) and comes from a
different publisher. The fix is a version constraint the script now applies to both the theme and
its `luci-i18n-footstrap-*` catalogues, `apk add --upgrade "$PKG<26"`, which both picks owfeed's
build over the official one and REPAIRS a router that already has the official one (`--upgrade`
still applies, so it downgrades, measured: "Downgrading luci-theme-footstrap
(26.246.70755~4fd72fd -> 0.14.10-r1)"). `26` is a ceiling, not a version pin: `apk version -t`
confirms `26.246.70755~4fd72fd` and `27.1.1~abc` both compare `>` against `26` — the LuCI stamp
only grows with the calendar — while `0.14.10-r1`, `1.0.0-r1` and `25.99.99-r1` all compare `<`,
so the constraint excludes every LuCI-stamped build for good and leaves this project's own
numbering majors 1 through 25 to grow into. opkg has no `world` file and no version-constraint
syntax on `install`/`upgrade`, so this has no opkg equivalent; left alone because the official
24.10 feed does not carry the theme today (checked on owrt2410, `opkg info luci-theme-footstrap`
names only this project's own `0.14.9-r1`) — if that changes, the fallback is the signed-release
install path this script already has (`install_from_release`), which bypasses feed resolution
entirely.

**There is no pinned-tag install, and the release-asset fallback is automatic but never the first
choice.** A router that cannot read the feed index at all — an architecture owfeed does not publish,
a resolver that does not answer, a network that intercepts the host — is installed from the release
instead of being sent away with a URL, and told plainly that `apk upgrade` will not carry the theme
forward until the feed works.

That path picks the artifact **from the signed manifest**, never by guessing an asset's name: GitHub
sorts assets by name, and `luci-i18n-…` sorts ahead of `luci-theme-…`, so a release carrying
per-language packages needs the manifest to say which asset is the theme, not a guessed name
(issue #6). `manifest.txt` names exactly one file per
format with its size and digest, and the chain fails closed in this order — verified TLS, then
`usign -V` against the release key pinned in the script (the same key as `release.pub`), then the
manifest's own sha256 over the downloaded artifact. A missing `usign`, a signature that does not
verify, or a digest that does not match is a refusal, and the script then prints the by-hand URL as
before. `apk`'s `--allow-untrusted` on this path says only that the `.apk` carries no APK signature
of its own; what is trusted is the usign signature over the manifest, checked before the file is
handed to the manager. Measured on 25.12/apk and 24.10/opkg containers, including the refusal: a
one-character change to the pinned key leaves nothing installed.

A router that wants an OLDER version still does it by hand — the feed carries one version per
branch — with the **raw file from a release**, never the zip artifact from Actions:

```sh
apk add --allow-untrusted luci-theme-footstrap-*.apk   # 25.12+
opkg install luci-theme-footstrap_*.ipk                # 24.10
```

`--allow-untrusted` means the package manager holds no key of ours. The release publishes a signed
`manifest.txt` and a detached `.sig` per asset, so a by-hand install can be checked with
`usign -V -m <pkg> -x <pkg>.sig -p release.pub` — which is what the installer's own fallback does
for you.

## Package formats, and the usual mistake

- **apk** (25.12+) — the Alpine apk-tools format, which OpenWrt adopted in 25.12.
- **ipk** (24.10) — gzip-tar: `./debian-binary` (2.0) + `./control.tar.gz` + `./data.tar.gz` with
  ustar headers. Identical to native OpenWrt ipks.

**"Malformed package file" from opkg** is almost always the wrong file: a GitHub artifact's zip
wrapper, or an `.apk` where an `.ipk` belongs.

An `.ipk` can be checked with a real opkg by hand — there is no such run in CI, and there was no
real proof before either, since "an SDK 24.10 produced it" was the same non-proof:

```sh
docker run --rm -v /path/pkg.ipk:/tmp/p.ipk openwrt/rootfs:x86-64-24.10.4 \
  sh -c 'mkdir -p /var/lock; opkg install --nodeps /tmp/p.ipk'
```

**All four lifecycle scripts are present in both containers.** The first version of owfeed emitted
only `postinst` and `prerm` into the ipk — the pair `package-pack.mk` generates, and easy to mistake
for the whole set — so `postrm` (unregistering the theme, putting `mediaurlbase` back) reached apk
and not opkg. Fixed before the first release built with it, and checked against the 0.11.6 SDK build:
all four agree in meaning, with only cosmetic differences.
