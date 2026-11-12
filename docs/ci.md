# CI and packaging

How CI turns footstrap into packages and ships them, for maintainers who read a red run or change a
workflow. The main rule: `release` publishes nothing until `build`, `e2e`, `anchor` and `playground`
are green.

The theme is noarch (`LUCI_PKGARCH:=all`). It supports OpenWrt 24.10 (`.ipk`, opkg) and 25.12+
(`.apk`, apk).

Related pages:

- What the Makefile and the install scripts do, `install.sh`'s trust chain included:
  [package.md](package.md).
- The release runbook: [releasing.md](releasing.md).
- What the router checks prove and how to read their artifacts: [verifying.md](verifying.md).

## Short version

1. `.github/workflows/build.yml` builds both formats with owfeed, not the OpenWrt SDK.
2. `e2e` and `anchor` install the package on two real owlab routers: `owrt2512` (25.12/apk) and
   `owrt2410` (24.10/opkg).
3. `release` runs only on a `v*` tag push. It waits for every other job and is the only job that
   holds a key.
4. Every job and every step that can hang has a timeout. Downloads retry on a stall.
5. `rerun-infra` re-runs a failed run once, only when every failure carries a known outage title.
6. Three server rulesets guard `main` and the release tags.

## Contents

- [The job graph: everything gates `release`](#the-job-graph-everything-gates-release)
- [Only `release` can write, and only on a tag](#only-release-can-write-and-only-on-a-tag)
- [Dependencies arrive a week late and run no install script](#dependencies-arrive-a-week-late-and-run-no-install-script)
- [Every job and every hanging step has a timeout](#every-job-and-every-hanging-step-has-a-timeout)
- [Downloads retry on a stall, not on an answer](#downloads-retry-on-a-stall-not-on-an-answer)
- [Playwright browsers: CDN first, apt only for an engine that fails](#playwright-browsers-cdn-first-apt-only-for-an-engine-that-fails)
- [`rerun-infra`: one more attempt after an outage](#rerun-infra-one-more-attempt-after-an-outage)
- [Three server rulesets guard `main` and the tags](#three-server-rulesets-guard-main-and-the-tags)
- [Job steps are scripts you can run by hand](#job-steps-are-scripts-you-can-run-by-hand)
- [`build`: owfeed, not the SDK](#build-owfeed-not-the-sdk)
- [`e2e`: the package's life on a real router](#e2e-the-packages-life-on-a-real-router)
- [`anchor`: scroll anchoring on a real router](#anchor-scroll-anchoring-on-a-real-router)
- [What `e2e` and `anchor` share](#what-e2e-and-anchor-share)
- [`anchor-mutants`: does the anchor check still fail](#anchor-mutants-does-the-anchor-check-still-fail)
- [`playground`: a real router, recorded and replayed](#playground-a-real-router-recorded-and-replayed)
- [`release`: signing and publication](#release-signing-and-publication)
- [`pages`: the portal and the release mirror](#pages-the-portal-and-the-release-mirror)
- ["Malformed package file" is almost always the wrong file](#malformed-package-file-is-almost-always-the-wrong-file)

## The job graph: everything gates `release`

The workflow is `.github/workflows/build.yml`. It triggers on a push to `main`, a `v*` tag, any pull
request, or a manual dispatch.

```
build ───────────────────────────┐
e2e    (owrt2512, owrt2410) ─────┤
anchor (owrt2512, owrt2410) ─────┼─→ release ─→ pages   (tag pushes only)
build ─→ playground ─────────────┘
             └─→ pages-manual                           (workflow_dispatch, publish-pages=true)
```

`e2e` and `anchor` do not wait for `build`. Each stages and packs the same tree itself (below), so
the three run side by side. `release` waits for `build`, `e2e`, `anchor` and `playground`.

| Job | What it is |
|---|---|
| `build` | the ACL check and the newest release notes, then both package formats, via owfeed |
| `e2e` | `tools/e2e.mjs --no-anchor`, one leg per package manager: the package's whole life on a real router (below) |
| `anchor` | `tools/anchor-check.mjs`, one leg per package manager, beside `e2e` on a router of its own (below) |
| `playground` | records a real router's pages into a static, replayable site (main pushes that reach the package, tags and dispatches) |
| `release` | signs, generates the notes, attaches the assets and `playground.tar.gz` while the release is a draft |
| `pages` | refreshes the GitHub Pages portal and the release mirror, from the latest release |
| `pages-manual` | the same refresh, off a manual dispatch, from this run's own playground (see `pages`, below) |

## Only `release` can write, and only on a tag

The workflow sets `permissions: contents: read`. Only `release` declares `contents: write`, and it
runs on the push of a `v*` tag only.

Runs cancel or wait on each other this way:

| Run | What happens to other runs |
|---|---|
| a newer push to a pull request | cancels that pull request's older run |
| a re-run of an older run (`rerun-infra`'s or a person's) | waits for the newer run instead of cancelling it |
| a push to `main`, a tag or a dispatch | never cancels or waits on another run |

Every job runs on `ubuntu-24.04`, pinned rather than `ubuntu-latest`. Why: both legs of a matrix
then measure on one image. The pin moves in a change of its own.

## Dependencies arrive a week late and run no install script

- `.github/dependabot.yml` sets `cooldown: default-days: 7` on both ecosystems. It covers version
  updates only, never security updates.
- The repo's `.npmrc` sets `ignore-scripts=true` for every `npm ci`, in CI and in a developer's
  shell.
- `.npmrc` also turns off npm's audit, funding notice and update check. So `npm ci` asks the
  registry for the tarballs alone.
- There is no `min-release-age` in `.npmrc`. Why: it might hold back a Dependabot security update.
- A new or replaced dependency needs the maintainer's word.

`pages.yml` gives `pages: write` and `id-token: write` to `deploy` alone. Its `build` job runs the
tree's own scripts, so it holds `contents: read` only. That job runs no `npm ci`: the portal build
imports Node's built-ins alone.

## Every job and every hanging step has a timeout

Every job that runs steps of its own in `build.yml`, `pages.yml`, `anchor-mutants.yml` and
`rerun-infra.yml` has a `timeout-minutes`. A job that calls a reusable workflow cannot take one.

The steps that can hang on their own carry their own timeout as well. Why: a hang then names its
step, and the job timeout is only the backstop.

| Step | Timeout |
|---|---|
| the router wait | 25 min |
| `owfeed build` | 15 min |
| the install (`tools/ci-install.sh`) | 5 min |
| the e2e run | 15 min |
| the anchor measurement, a fresh-router retry included | 35 min |
| the mutant measurement, a fresh-router retry included | 35 min |

Inside the steps, the calls carry clocks of their own:

| Call | Clock |
|---|---|
| each docker call in `ci-install.sh` | 60 s; 120 s for apk or opkg |
| every `owlab status` | 60 s; 30 s in `ci-stand-state.sh` |
| every `owlab down` | 120 s |
| every command `e2e.mjs`, `anchor-check.mjs` and `capture.mjs` run on the router | 60 s; 120 s for a package manager |
| each fetch inside a page, in `capture.mjs` | 30 s |
| LuCI's menu tree, which `e2e.mjs` and `capture.mjs` load inside a page | 30 s |
| each page reading in `e2e.mjs` | 10 s |

A docker call in `ci-install.sh` that hangs or fails names itself in an untitled `::error`.

The node scripts kill a late `owlab status` with SIGKILL. Why: owlab catches TERM.

A menu, login or anchor page load that times out is blamed on the stand only when LuCI's root then
stays silent for a minute. The test is `stoodDown()` in `tools/lib/stands.mjs`. On a stand that
answers, the timeout is the theme's or the page's. So theme code that holds a page cannot pass for
an outage.

`e2e.mjs` stops a load the router never answered before the page's next click. Why: one such page
held its pass to the step's timeout.

## Downloads retry on a stall, not on an answer

apt and the Playwright CDN stall rather than fail, and a stalled step is never retried. So every
Playwright install (`e2e`, `anchor`, `playground`, `anchor-mutants`) runs through
`tools/ci-playwright.sh`, which runs the download under `tools/ci-retry.sh`.

How `ci-retry.sh` works:

- Each attempt gets its own deadline: 300 s for the CDN, 150 s for apt. There are three attempts.
  The job timeout is only the backstop.
- Each attempt runs in a session of its own and is killed by process group. Why: `timeout` signals
  only the child it started, and a surviving `apt-get` keeps the lists lock.
- A slow mirror stays slow, and apt falls back to the next one only on an error. So after a failed
  attempt, `ci-retry.sh` drops the first line of `/etc/apt/apt-mirrors.txt`. The retry then asks
  the next mirror.
- `CI_RETRY_ON` limits the retries to the exits that mean an outage.
- apt's locks and mirror list are touched only after an apt command.

`ci-retry.sh` also runs these:

- `owfeed build`, with `CI_RETRY_ON=8`: owfeed's "upstream outage", the SDK fetch;
- `e2e`'s download of the last release;
- every `npm ci`, at 300 s an attempt.

A stall is an attempt the watchdog stopped at its deadline, whatever the command answered its TERM
with. The watchdog leaves a marker file before it signals. The exit code cannot tell a stall: owfeed
catches TERM and exits 7, which `CI_RETRY_ON=8` would take for an answer.

How `ci-retry.sh` gives up:

| Last attempt | What it prints |
|---|---|
| stalled, or ended on an exit `CI_RETRY_ON` names | an `::error` titled `Upstream outage (safe to rerun)` |
| any other exit | an `::error` with no title: it cannot tell an outage from an answer |

## Playwright browsers: CDN first, apt only for an engine that fails

`tools/ci-playwright.sh` fetches the engines it is given from Playwright's CDN. The default is
Chromium. It launches each engine and goes to apt only for the engines whose launch fails.

| Job | Engines |
|---|---|
| `e2e`, `playground` | Chromium's headless shell (`--only-shell`) |
| `anchor` | Chromium's headless shell, Firefox and WebKit |

WebKit does not launch on GitHub's image and needs 117 MB of `.deb` from apt. `anchor` keeps them in
`actions/cache` at `~/.cache/playwright-debs`, keyed by the runner image and Playwright's version.
It passes the directory as `PW_DEB_CACHE`. apt then downloads only packages that changed since the
save.

On an exact hit (the same image version), `ci-playwright.sh` installs the cached set with `dpkg -i`
and runs no apt at all. apt runs only when that set does not make WebKit launch. A new image
version starts from the previous version's set (`restore-keys`) and saves its own.

## `rerun-infra`: one more attempt after an outage

`.github/workflows/rerun-infra.yml` runs when a `build.yml` run completes. When every failed job says
it failed outside the theme, it asks the API to re-run the failed jobs, once.

The API re-runs their dependent jobs with them. So on a tag the second attempt goes on to `release`,
as a manual "Re-run failed jobs" would.

### When it re-runs

It re-runs only when all of this holds:

1. The run failed on its first attempt, and nobody has re-run it since. The attempt number is read
   again from the API before the jobs are, not taken from the event.
2. Every job that neither passed nor was skipped failed. A job past its `timeout-minutes` is listed
   as cancelled, and a cancelled job leaves the run red.
3. Every failed job carries at least one failure annotation, and each one's title is on the
   allow-list below. The runner's own `Process completed with exit code N.` names no cause and is
   skipped.

### Anything else stays red for a person

Nothing of the run is re-run in these cases:

- one theme finding in any job;
- an `e2e` step's title or a `Scroll anchoring` one;
- an untitled `::error`, a hung or failed `ci-install.sh` call among them;
- a step past its own `timeout-minutes`, the runner's untitled "has timed out";
- a failed job with no title at all;
- a second attempt. Why: the same outage twice is no hiccup.

### The allow-list of outage titles

The allow-list lives once, in the file's `INFRA`.

| Title | Printed by |
|---|---|
| `Upstream outage (safe to rerun)` | `tools/ci-retry.sh`, giving up on a stall or on an exit `CI_RETRY_ON` names (above); `tools/e2e.mjs`, on the first attempt only, when every failed step is one where the stand did not answer; `tools/anchor-check.mjs`, on its exit 3; `playground`'s step, when the recording on a fresh router exits 75 too |
| `The router did not come up (infrastructure, not the theme)` | `tools/ci-stand.sh`, after three failed `owlab up` attempts |

When `e2e.mjs` prints the outage title, and when it gives each step its own title instead:
[verifying.md](verifying.md) "One outage annotation, or one title per step".

After a first 2 or 3, `anchor` names an exit of the check on the fresh router other than 0 and 3 as
`Scroll anchoring on <router>` (below). A first 3 and a green second measurement leave the outage
annotation on a green job. Only failed jobs are read, so it changes nothing.

### It runs none of the run's code

- It reads the run through the API alone, with `actions: write`, `checks: read` and
  `contents: read`. It checks out nothing.
- Every `gh api` call has 30 s and three tries. When the API does not answer, the run is left as it
  is and this workflow's own run goes red.
- A re-run request that landed but lost its answer counts once the run shows attempt 2.
- A job id that is not a number leaves the run as it is.
- Each decision is one line in its log. A title off the list is logged behind `- `, so a pull
  request's output cannot pass for a workflow command.
- Every CR and LF in a job name, a title or a message becomes a space first. Why: the runner splits
  a log line at a bare CR, and the text after one would start a line of its own. A title with a line
  break in it then matches no line of the list, and the run stays red.
- `workflow_run` fires only from the file's copy on `main`. So a change to the file acts once it is
  merged.

## Three server rulesets guard `main` and the tags

The rulesets live in Settings → Rules. `gh api repos/{owner}/{repo}/rulesets` lists them.

| Ruleset | Target | Rules | Bypass |
|---|---|---|---|
| 24042288 "main: CI must pass" | `main` | required status checks (5): `Build the packages`, `The package's life on owrt2512`, `The package's life on owrt2410`, `Scroll anchoring on owrt2512`, `Scroll anchoring on owrt2410` | admin, always: a direct push to `main` needs it, so each push reports the bypassed rule and the checks are read after the push (`gh run watch`) |
| 25550110 "main: no force-push or deletion" | the default branch | `non_fast_forward`, `deletion` | none, admin included |
| 25550119 "release tags: no move or deletion" | `refs/tags/v*` | `update`, `deletion` | none; creating a tag stays open for the release runbook |

With no bypass, no token gets past the last two. A force-push or rewrite of `main`, or moving or
deleting a released tag, starts with the maintainer disabling that ruleset in the UI.

## Job steps are scripts you can run by hand

Most of what the jobs run lives in scripts:

- `tools/stage.sh`
- `tools/ci-playwright.sh`
- `tools/ci-stand.sh`
- `tools/ci-install.sh`
- `tools/e2e.mjs`
- `tools/anchor-check.mjs`
- `tools/playground/*.mjs`
- `tools/stage-release.sh`

A step that is a script can be run by hand when it fails.

Nothing in `package.json` ships. The buildbot has no node and does not need it.

## `build`: owfeed, not the SDK

[owfeed](https://github.com/owfeed/owfeed) builds both formats from one staged rootfs. The theme is
noarch: CSS, templates, browser JS, no compiled code. So a cross toolchain buys nothing.

| Format | Line | noarch spelling | What owfeed does |
|---|---|---|---|
| apk | 25.12+ | `noarch` (`all` is rejected as uninstallable) | `apk mkpkg` + `.conffiles` sidecars |
| ipk | 24.10 | `all` | an `ipkg-build` container + `CONTROL/conffiles` |

### owfeed does what the SDK did

owfeed does the three things the SDK provided:

1. It compiles `.po` → `.lmo` with its own compiler, byte-identical to `po2lmo`.
2. It emits the same sidecars as `package-pack.mk`.
3. It wraps the scripts in `default_postinst`/`default_prerm`. Without them `/etc/uci-defaults/*`
   never runs.

Both containers carry the same lifecycle scripts, `postrm` included.

### The host `apk` is checked three ways

owfeed extracts the host `apk` from a release SDK tarball and checks it:

1. An ed25519 signature covers `sha256sums`.
2. The branch key is pinned from a different host (`github.com/openwrt/keyring`).
3. The sha256 is read only from an already-authenticated file.

### owfeed and owlab install from attested releases

owfeed itself is installed by its own action, `owfeed/owfeed/setup`, pinned by its `uses:` tag alone.
The action verifies the binary against GitHub's build attestation before it reaches PATH.

That is why the action is preferred to `go install …@<sha>`, which trusts whatever the module proxy
returns. A `SHA256SUMS` beside a release is no check: the same host serves the binary and the sum.
An attestation is signed by GitHub's identity and sits in a public transparency log. The action pins
the workflow allowed to issue it.

`build.yml` has no `version:` input anywhere. Not on owfeed's or owlab's `setup`, nor on
`package.yml`'s `owfeed-version`. Why: Dependabot moves the `uses:` ref and never an input, and an
unset version installs the release the ref names.

`~/go/bin/owfeed` and `owlab` follow the same refs. They are taken from the GitHub release after
`gh attestation verify -R owfeed/<tool>`. So `tools/stage.sh && owfeed build` writes CI's bytes.

### Zopfli packages

`owfeed.yml` sets `compression: zopfli` on all three packages. The `.apk` is re-deflated inside
`owfeed sign`, after `adbsign`, so the release asset is smaller.

A feed that adds its own signature on top re-compresses the file. So the owfeed-packages copy may
lose the saving.

### The build steps

0. The ACL grants exactly this step's literal, which SECURITY.md lists.
   - `acl.d` must hold `luci-theme-footstrap.json` alone. Why: rpcd loads every file there.
   - One `jq -e` compares that file with the literal in the step. The literal is the source of
     truth; `SECURITY.md` lists the same grants by hand.
   - Any other grant fails the job: an `exec`, a new path, a new ubus method. So do a second file
     and a malformed one. Why: rpcd itself skips a malformed ACL silently.
1. The newest changelog section makes release notes. `tools/release-notes.sh` runs over the
   section a tag would publish: the tag's own on a tag, else the newest `## [x.y.z]`. Why: a tag
   cannot be moved or deleted. So a section that makes no notes fails here, on `main`, before it
   burns a version.
2. `SOURCE_DATE_EPOCH` is the commit timestamp. Both containers write mtimes, and a package's
   identity is a hash over its payload. Without a fixed epoch, the same content rebuilds into a
   package that claims to be new.
   - No step sets a version. `stage.sh` takes `FOOTSTRAP_VERSION`, else the newest tag
     (`git describe --tags --abbrev=0`, `v0.3.6` → `0.3.6`), else refuses to build.
   - `build` sets no `FOOTSTRAP_VERSION`. So on a tag its packages carry that tag, and on a branch
     or a pull request the newest tag before it.
3. `./tools/stage.sh` does the half owfeed does not. owfeed "packages a directory; does not
   build one". `stage.sh` is the Makefile's `Build/Prepare` in one script, with uglify-js where
   luci.mk ran jsmin. It does this:
   - builds `cascade.css`;
   - mangles the private `--fs-*` names;
   - minifies the JS;
   - strips comments and indentation from the templates, and comments from the shell;
   - strips `logo.svg` and `manifest.json`;
   - stamps `FS_VERSION`.

   Three steps go beyond `Build/Prepare`:
   - `minify-prepaint` over the inline pre-paint blocks without ucode interpolation;
   - postinst/postrm extracted from the Makefile's `define`s with awk, so there is one copy;
   - `chmod -R u=rwX,go=rX` over `dist/`. Why: owfeed copies modes from disk, and uhttpd answers
     403 on a file that is not world-readable.

   `fs-version.js` is minified with `evaluate:false`, so the `FS_VERSION` declaration survives for
   the version `sed`.
4. `owfeed build` runs without `--frozen-lock`.
   - That flag re-derives `owfeed.lock` from `downloads.openwrt.org` and fails if it moved. It suits
     a repository that publishes a feed.
   - Here three noarch packages ride as release assets. So the flag would only turn every OpenWrt
     point release into a red release.
   - The committed lock still pins which SDK the host `apk` comes from.
   - A branch or a pull request restores that SDK from `actions/cache`. A tag fetches and verifies
     it afresh.
   - owfeed checks a cached SDK against a record it keeps beside it. That catches a damaged or stale
     cache but not a planted one: whoever can write the cache can rewrite the members' hashes in
     that record.

owfeed writes `dist/noarch` (apk) and `dist/all` (ipk). Why two directories: apk derives the
filename from name and version, so two architectures cannot share a directory.

## `e2e`: the package's life on a real router

A built ipk proves nothing about the ipk; this job does.

- One leg per package manager, `fail-fast` off: `owrt2512` (25.12/apk) and `owrt2410` (24.10/opkg).
- Each is an owlab router with LuCI and its apps but not this theme.
- `owfeed/owlab/setup` puts the CLI on PATH after checking its build attestation.
- The job stages and packs the tree itself with `FOOTSTRAP_VERSION=9999.0.0`. So installing it over
  the last release is an upgrade under both package managers' rules.
- The last release's package comes from `gh release download`.
- Then `tools/e2e.mjs` walks the life an admin gives the package. [verifying.md](verifying.md) "What
  the check proves" lists the steps and what fails a page.

Both legs run because the templates are identical but the ucode interpreters are not.

The job uploads its artifact `e2e-<router>`, also on a red run. What it holds:
[verifying.md](verifying.md) "Reading a run".

## `anchor`: scroll anchoring on a real router

`tools/anchor-check.mjs` runs on a router of its own, beside `e2e`.

The same 9999.0.0 build is installed with `tools/ci-install.sh`. It is copied in and installed by apk
or opkg with no feed refresh, then read back as installed. The package needs only luci-base, which
every stand has.

It is not `owlab install`. Why: under owlab 0.6.7 that refreshes every feed and installs again when a
dependency is missing. A feed outage would then stand between the job and its verdict.

What the check measures and when it passes: [verifying.md](verifying.md) "The anchoring check keeps
a parked reader in place". Its log is uploaded as artifact `anchor-<router>`, described in
[verifying.md](verifying.md) "Reading a run".

### Exit 2 or 3 gets one more measurement on a fresh router

The check judges nothing on two exits:

| Exit | Meaning |
|---|---|
| 3 | the stand stopped answering before its first measurement or in its rerun; it says so in an `::error` titled `Upstream outage (safe to rerun)` |
| 2 | the router was not running or had no lease |

Then the step does this:

1. Saves the router's state.
2. Takes the router down.
3. Builds a fresh one.
4. Measures once more.

Any other exit, and a second 2 or 3, is the verdict.

After a first 2 or 3, an exit on the fresh router other than 0 and 3 also leaves
`::error title=Scroll anchoring on <router>`. A second 2 is included. Why: the first 3's
infrastructure title must not make the job read as an outage (`rerun-infra`, above).

A failed install on the fresh router leaves `ci-install.sh`'s untitled `::error`, which keeps the run
red too.

## What `e2e` and `anchor` share

### The router comes up in the background

Each job builds its router in the background. `tools/ci-stand.sh` starts as soon as owlab is
installed.

- It makes up to three `owlab up` attempts, on a seven-minute clock each. The second and third run
  with `--rebuild`.
- An attempt fails when owlab exits non-zero. owlab 0.6.7 does that when the router misses a package
  from `packages:` or never answered on HTTP.
- An attempt also fails when LuCI does not answer on `/cgi-bin/luci/` within 90 s. Why: owlab's HTTP
  check asks for `/`, which uhttpd answers while LuCI's dispatcher is broken.
- Each failed attempt leaves a `::warning`.
- Three failed attempts leave an `::error` titled "The router did not come up (infrastructure, not
  the theme)". It is one of the two titles `rerun-infra` re-runs a run by.

The `Wait for the router` step before the run prints the log of `ci-stand.sh` and fails with its exit
status.

### A router is built once a week

A router this week's green `e2e` already built is not built again.

1. Once its leg passes, `e2e` saves the router's image with `docker save`. The key is the router,
   `owlab.yaml`, owlab's version and the ISO week.
2. `e2e`, `anchor`, `playground` and `anchor-mutants` restore it.
3. `ci-stand.sh` loads it and starts it with `owlab up --no-build` (owlab 0.7.0), which fetches and
   builds nothing. The LuCI probe above follows.
4. owlab starts the image only when its `org.owlab.inputs` label matches this owlab and this
   `owlab.yaml`.
5. A load, a start or a probe that fails leaves a `::warning` titled "Saved router image". The
   router is then built as above.

The image is 50-55 MB and restores in 1-3 s. The router it starts answers before the job's other
setup is done. `Wait for the router` then takes 0-2 s, where a build keeps `e2e` waiting 45-75 s.

### Only a stand its own `e2e` passed on is saved

- The save comes after the leg's verdict rather than with the other caches. So a kept stand is one
  its own `e2e` passed on.
- `anchor` and `playground` run beside `e2e` and do not gate it. A run they turn red can still save
  the stand.
- Their retries on a fresh router, and `anchor-mutants`' retries, delete the restored image first.
  So the fresh router is built.
- A router built from the rootfs tarball, because the registry did not answer, is not saved. Why:
  `owlab up --no-build` would refuse it all week.
- A saved key is never replaced. So a stand is served until the key changes: `owlab.yaml`, owlab's
  version or the week. It keeps the feed packages it was built with for that long.
- The theme is installed fresh on every run, and each job starts a new container. So the router's
  first boot runs as after a build.
- A pull request's run restores what that pull request or `main` saved. That is GitHub's cache
  scopes.

### Downloads come from `actions/cache`

| Cache | Path | Key |
|---|---|---|
| the browsers | `~/.cache/ms-playwright` | the runner image's OS (`$ImageOS`), Playwright's version and the engines |
| owfeed's SDK | `~/.cache/owfeed` | `owfeed.lock` and owfeed's version |
| owlab's URL-keyed downloads | `.owlab/cache` | the router, `owlab.yaml` and owlab's version |

Why each key holds what it holds:

- The SDK key needs owfeed's version. owfeed 0.5.6 checks a cached SDK against files 0.5.5 did not
  keep. A cache is saved only on a miss. Under a key without the version, 0.5.5's cache is a hit
  0.5.6 rejects. The SDK would be fetched on every run and the cache never replaced.
- owlab's downloads need the router: owlab fetches only the router it builds.
- The browsers need `$ImageOS`. WebKit's build directory has one name on 24.04 and 26.04 and
  different libraries behind it.

Each cache is saved right after the step that fills it. So a run that goes red later still keeps
what it downloaded.

A red leg also saves `tools/ci-stand-state.sh`'s snapshot of the router as `stand.txt` in its
artifact ([verifying.md](verifying.md) "Reading a run" lists what it holds).

### A docs-only change skips the steps, not the job

A change that touches documentation alone skips the steps of both jobs.

- The first step runs `tools/ci-package-changed.sh` against the PR's base or the push's previous
  head. Every later step is gated on its answer.
- `docs/` and any `*.md` outside the package payload do not count.
- Anything but a plain `false` from the script runs the checks. So a gate that breaks never skips
  them green.
- A rename counts as both paths. So moving a payload file into `docs/` still runs the checks.
- A base the fetch cannot reach within 60 s runs the checks too.

The job itself still runs. Why: a matrix job skipped at job level reports its name unexpanded, and
the required check would wait forever.

## `anchor-mutants`: does the anchor check still fail

`.github/workflows/anchor-mutants.yml` runs `tools/anchor-mutants.mjs`, one mutant per job. Each
runs on an owrt2512 router brought up and installed the way `anchor` does it.

Every mutant is one known-bad edit to `fs-fit.js`. The job fails unless `anchor-check.mjs` fails on
it.

| Result | What happens |
|---|---|
| no verdict: exit 1 and no `SURVIVED` line (the stand stopped answering, a hang, a crash) | measured once more on a fresh router, as `anchor` does when its check judged nothing |
| a survivor, a kill, a mutant that no longer applies | the verdict |

It runs weekly (Monday 04:17 UTC), on `workflow_dispatch`, and on a pull request that touches any of
these:

- either script;
- `fs-fit.js`;
- `tools/lib/stands.mjs`, `tools/lib/util.mjs`, `tools/lib/root.mjs`;
- `tools/stage.sh`;
- a script the job runs: `tools/ci-stand.sh`, `tools/ci-install.sh`, `tools/ci-retry.sh`,
  `tools/ci-playwright.sh`;
- the npm manifest or lock;
- `owlab.yaml`;
- the workflow itself.

A newer push to a pull request cancels its older run. A re-run of an older one waits for the newer
one instead. The weekly run and a dispatch never cancel each other.

It is not a required check. Why: a surviving mutant is a hole in the `anchor` gate to read and close,
not a merge block. `rerun-infra.yml` does not watch it.

## `playground`: a real router, recorded and replayed

The job turns `admin/status/overview` and seven other pages of an owlab stand into a static site. Any
browser can open it with no router behind it. The site runs the theme's own JS, so it cannot drift
from it.

It uses three scripts in `tools/playground/`:

1. `capture.mjs` records the router.
   - It boots nothing itself. It talks to the `owrt2512` this job already installed the build on.
   - `tools/ci-stand.sh` brings that router up in the background, as in `e2e`.
     `tools/ci-install.sh --activate` installs the build and makes it the active theme.
   - It logs in and fetches every page in `pages.json`.
   - It records the server's own document, the `/luci-static/**` assets those pages fetched, every
     distinct ubus call and the ACL-filtered menu.
   - A capture whose stand stopped answering exits 75 (list below). The step then records once more
     on a fresh router.
   - A second 75 leaves `::error title=Upstream outage (safe to rerun)`. Any other exit is the
     recording's or the theme's.
2. `build.mjs` builds the site, offline and deterministic.
   - It rewrites the recorded paths under `--base`.
   - It scrubs tokens and the stand's hostname.
   - It splices in `replay.js`, which patches `XMLHttpRequest`/`fetch` to answer from the recording.
   - It tars the result.
3. `verify.mjs` serves the built site in Chromium. The tarball reaches the release only if it
   passes. It fails on any of these:
   - a page error;
   - an unanswered ubus call;
   - a 404;
   - a view that does not render within 15 s, or renders empty;
   - a client navigation that fell back to a full load;
   - an Appearance change that does not survive a reload;
   - a login gate that does not let the reader in and out.

`capture.mjs` exits 75 when the stand stopped answering:

- no answer to the login, a page, a fetch or LuCI's menu tree;
- a page that never went quiet, or a response it could not read, while uhttpd did not answer a
  `HEAD` for `luci.js` in 10 s either;
- an `owlab exec` that did not return in 60 s, that the Docker daemon refused, or that failed while
  the router stopped within 10 s.

A red run uploads the router's state (`tools/ci-stand-state.sh`) as artifact `playground-stand`. So
does a run that recorded again on a fresh router.

### When it runs

- On every push to `main` that reaches the package. There it takes `e2e`'s gate: a change to
  documentation alone skips its steps.
- On a tag, always recording.
- On `workflow_dispatch`, always recording. This is the source `pages-manual` publishes from.

`main` runs it so that a tag is never the first run of `tools/playground/*`. No other job makes its
SPA-navigation check.

It is not a required check. `release` waits for it on a tag.

By hand: [development.md](development.md) "The playground: recording and replaying a real router".

## `release`: signing and publication

`release` runs on the push of a tag only, never on a dispatch. It calls owfeed's own reusable
workflow instead of running steps of ours:

```yaml
release:
  needs: [build, e2e, anchor, playground]
  if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')
  uses: owfeed/owfeed/.github/workflows/package.yml@v0.5.6
  secrets:    { sign-key: …OWFEED_AUTHOR_KEY, usign-key: …FOOTSTRAP_USIGN_KEY }
  with:       { pre-release: sh tools/stage-release.sh,
                sign-also: install.sh, extra-artifact: playground, notes-file: release-notes.md,
                verify-with: release.pub, runs-on: ubuntu-24.04 }
```

This is the only job that holds a key.

### Why `release` needs each job

- `e2e` and `anchor` in its `needs` stop a tag from publishing an untried package. The package must first live
  through install, upgrade, every menu page, the anchoring check, removal and a fresh install on
  both package managers.
- `playground` is there because this job attaches its tarball. `extra-artifact: playground` uploads
  `playground.tar.gz` as it is, unsigned and outside the manifest, while the release is still a
  draft.
- The tarball is a demo site, not router payload. A repository with immutable releases refuses any
  upload once a release is published.

### `tools/stage-release.sh` is our half

`tools/stage-release.sh` is the `pre-release` hook. It writes the release notes where the workflow
reads them. It puts the one non-package asset into `dist/` before the manifest is written, because
everything in `dist/` is signed.

- The notes come from `tools/release-notes.sh`: the tag's changelog section, one bold lead per
  bullet, grouped by category. They fill the release page and are not an asset: nothing on a router
  reads `release-notes.md`.
- The installer is the non-package asset. `raw.githubusercontent.com` is rate-limited for
  unauthenticated callers. So a user behind a shared address (CGNAT, a shared exit) can fail to fetch
  the installer meant to rescue them (issue #17).
- A signed copy of the installer is also the only one that can be checked before it runs as root.
  The README points at `main` and names this copy as the fallback.

`sign-also: install.sh` gives the installer a signature of its own. It is not a package, so owfeed
would not see it otherwise.

`verify-with: release.pub` re-checks every signature against the key in the repository, the one
baked into the installer.

### What the release carries

| Asset | Signature | What it is for |
|---|---|---|
| one asset per package and format | its `.sig` | what a router installs |
| the manifest | its `.sig` | what `install.sh` installs from when the feed cannot be read; where it reads the newest version for its "the feed has not caught up yet" line |
| the installer | its `.sig` | the mirror the README names |
| `playground.tar.gz` | none | the demo site |

### The manifest's field order never changes

- Its first line is `owfeed-manifest 1`; nobody parses it.
- The package architecture is the last field of the `pkg` line.
- `install.sh` reads the first six fields by position. A copy already on somebody's router cannot be
  fixed remotely. A field inserted before them would make it fetch a URL that 404s.
- owfeed writes that order. Nothing in this repository re-checks it.

## `pages`: the portal and the release mirror

`pages` publishes the developer portal to GitHub Pages:

- `docs/devkit.html`, generated by `tools/devkit-build.mjs` and never committed;
- `docs/gallery.html`;
- a freshly built `cascade.css` and `logo.svg` beside them;
- a full mirror of the latest release: the manifest and the installer, each with its signature, and
  the packages.

The mirror sits on a host other than github.com. So an outage or a block of one need not cover the
other.

`build.yml`'s `pages` job calls it once `release` succeeded. It needs `release` alone and is skipped
with it. It is called rather than triggered. Why: an event raised by `GITHUB_TOKEN` does not trigger
another workflow, so `on: release` would never fire.

The devkit assembles itself from files that already exist: the real stylesheet, the export tier
parsed out of `02-tokens.css`, the widget markup from `gallery.html`. Nothing is hand-copied.

### The playground is fetched, not built

The playground is fetched already built and unpacked into `_site/playground/`.

1. Fast path: `releases/latest/download/playground.tar.gz`.
2. On a 404, `gh api` finds the newest non-draft release carrying the asset, and the step uses it.
   The log names its tag.
3. When no release carries it, the step prints `::warning::`. The rest of the portal publishes
   without the playground.

A failing `gh api` or download fails the step, so the previous Pages deploy stays up.

`_site/playground.html` is kept as a redirect to `playground/`, for the links the README and
`devkit.src.html` carry.

### Downloads have limits, and the mirror is checked

- Each download has a 10 s connect limit, 60 s per transfer (120 s for the playground), and retries
  for 150 s.
- A 404 is an answer and is not retried.
- The mirror is left out only when GitHub answers that there is nothing to mirror: no release yet,
  or a release with no manifest. Any other miss fails its step.
- Every mirrored package is checked against the manifest's sha256.

### Publishing Pages by hand

A maintainer can publish Pages from a single run's own recording, without a tag:

```sh
gh workflow run build.yml --ref main -f publish-pages=true
```

A dispatch never signs a package or publishes a release.

**Never pass `--ref` naming v0.14.16 or an older tag.** Why: a tag cut before that rule keeps a
build.yml whose `release` also runs on a dispatch. It re-signs every package and deletes and
re-uploads each asset of the published release.

The command runs `build.yml`'s `pages-manual` job (`needs: playground`, off by default). It calls
`pages.yml` with `playground-source: artifact`. Only the playground fetch changes: it reads the
`playground` artifact this run uploaded, and fails closed on a miss.

Two limits:

- The `github-pages` environment accepts only `main` or a `v*` tag as a deployment branch (Settings
  → Environments → github-pages). Use `main`. A `--ref` naming another branch with
  `publish-pages=true` fails in `playground`'s first step, before its router is built.
- The next push to `main` under the paths `pages.yml` watches overwrites a manual publish. There
  `playground-source` defaults back to `release`.

## "Malformed package file" is almost always the wrong file

From opkg, this message almost always means the wrong file: a GitHub artifact's zip wrapper, or an
`.apk` where an `.ipk` belongs.

An `.ipk` is a gzip-tar of `./debian-binary`, `./control.tar.gz` and `./data.tar.gz`, like a native
OpenWrt ipk.
