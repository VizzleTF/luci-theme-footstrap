# Releasing

The pre-release checklist, the changelog contract and the release runbook, for the maintainer who
cuts a release. No release goes out until CI's `e2e` and `anchor` are green on both routers and the
live checks are done for every issue the release diff touches.

How CI builds and signs the packages: [ci.md](ci.md).

## Short version

The page uses two numberings. The pre-release checks are lettered, Check A to Check D. The runbook
steps are numbered, 0 to 7.

During development:

- Write every change a theme user sees into `[Unreleased]`, in the same commit as the code, in both
  changelog files ([The changelog contract](#the-changelog-contract)).

When cutting a release:

- Check A: scope the diff. It decides which live checks are mandatory.
- Check B: read CI's push run on `main` job by job, run `npm run changelog` and `owfeed lock`, and
  review the diff for security.
- Check C: check asset selection, issue #6, on every release.
- Check D: look at the touched areas live on both routers.
- Runbook steps 1 to 6: rename `[Unreleased]`, commit, push, then tag that commit. Read the tag's
  run job by job.
- Runbook step 7: dispatch the feed update yourself and read the served index.

## Contents

- [Every fixed bug leaves a live check behind](#every-fixed-bug-leaves-a-live-check-behind)
- [Placeholders and tools](#placeholders-and-tools)
- [Check A. Scope: only what the diff touches can regress](#check-a-scope-only-what-the-diff-touches-can-regress)
- [Check B. Read CI on the release sha, then run the local checks](#check-b-read-ci-on-the-release-sha-then-run-the-local-checks)
- [Check C. Asset selection (issue #6), separately and always](#check-c-asset-selection-issue-6-separately-and-always)
- [Check D. Live checks for the areas the diff touched](#check-d-live-checks-for-the-areas-the-diff-touched)
- [The changelog contract](#the-changelog-contract)
- [The runbook](#the-runbook)
- [Sources for the changelog rules](#sources-for-the-changelog-rules)

## Every fixed bug leaves a live check behind

Every closed bug left a live check behind: what to look at, and where, to catch its return. This
page is the register: one row per issue.

**If you fix something that has no row here, add a row.**
Why: a bug with no check comes back silently.

## Placeholders and tools

| Placeholder | Meaning | Example |
|---|---|---|
| `<VERSION>` | the new version, without `v` | `0.14.21` |
| `v<VERSION>` | the new tag | `v0.14.21` |
| `<PREV>` | the last tag, `git describe --tags --abbrev=0` | `v0.14.20` |
| `<DATE>` | the day you make the release commit, `YYYY-MM-DD` | `date +%F` |
| `<ID>` | a run id, from the `ID` column of `gh run list` | |
| `<SHA>` | a commit sha | |

Scratch output goes to `../tmp/release-<VERSION>/`.

The commands need `owfeed` at `~/go/bin/owfeed`, `gh` signed in, and Node.js with `npm ci` run.
Install them as in [development.md](development.md#install-owlab-and-the-tools-first).

The two routers are the owlab stands `owrt2512` (25.12/apk) and `owrt2410` (24.10/opkg). How to
bring them up and open them:
[development.md](development.md#the-dev-stand-runs-real-openwrt-routers-from-owlabyaml).

| Stand | LuCI | Login |
|---|---|---|
| `owrt2512` | http://localhost:8025 | `root`, empty password |
| `owrt2410` | http://localhost:8024 | `root`, empty password |

## Check A. Scope: only what the diff touches can regress

A regression can only come from what the diff touches. The diff compares the last tag with `HEAD`,
so uncommitted changes are not in it: run it on a clean tree with everything for the release
committed. List it:

```sh
git diff --name-only "$(git describe --tags --abbrev=0)" HEAD | sed 's#/.*##' | sort -u
git diff --name-only "$(git describe --tags --abbrev=0)" HEAD | grep -E 'styles/|menu-footstrap|\.ut$|fs-sheets|fs-select|fs-fit' \
  || echo 'no CSS / renderer / template / fence changes'
```

Expected: the first command prints the top-level paths the diff touches, one per line. The second
prints the matching files, or `no CSS / renderer / template / fence changes`.

| The diff | Live checks |
|---|---|
| does not touch `styles/`, the renderer, the templates or the fence | the visual and fence issues (#1–#5, #7–#11) cannot regress from it; a live look is allowed but not required |
| touches the matching area | the live check for those issues is mandatory |

Always mandatory, whatever the diff:

- CI's `e2e` and `anchor` on both routers;
- issue #6, packaging and asset selection. Why: #6 breaks at the release level, outside the code.
  Nothing fails until a router in the field pulls the update.

## Check B. Read CI on the release sha, then run the local checks

The code of the release is on `main` before the release commit is cut. Read its push run job by job:

1. Find the newest completed push run on `main`:

   ```sh
   gh run list --branch main --workflow build.yml --event push --status completed -L1
   ```

   Expected: one row. Its `<ID>` is in the `ID` column.

2. Read it job by job:

   ```sh
   gh run view <ID>
   ```

   Expected: every job below is `success`.

| CI job | What it holds |
|---|---|
| `build` | both formats, built by `owfeed build` |
| `e2e` | `tools/e2e.mjs` on owrt2512 (25.12/apk) and owrt2410 (24.10/opkg): install the last release, upgrade to this build, open every menu page against bootstrap, remove, fresh install ([verifying.md](verifying.md)) |
| `anchor` | `tools/anchor-check.mjs` on owrt2512 and owrt2410, beside `e2e`: a poll tick above a parked reader in Chromium, Firefox and WebKit ([verifying.md](verifying.md)) |

### When `playground` runs

`playground` runs on every push to `main` that reaches the package, on the tag and on a dispatch:

```sh
gh workflow run build.yml --ref main
```

The runbook does not dispatch it. Runbook step 0 reads `playground` with the rest of the main run,
and the tag's run always records it.

A dispatch never signs a package or publishes a release.

Never pass `--ref` naming v0.14.16 or an older tag. Why: a tag cut before that rule keeps a build.yml
whose `release` also runs on a dispatch. It re-signs every package and deletes and re-uploads each
asset of the published release.

### What stays local

1. Run the changelog check. CI does not run `npm run changelog`. CI's `build` only runs
   `tools/release-notes.sh` over the newest section (runbook step 4).

   ```sh
   npm run changelog
   ```

   Expected: exit 0.

2. Run `owfeed lock` at the repo root and in a fresh clone of owfeed-packages:

   ```sh
   ~/go/bin/owfeed lock
   gh repo clone owfeed/owfeed-packages ../tmp/release-<VERSION>/feed -- --depth 1
   (cd ../tmp/release-<VERSION>/feed && ~/go/bin/owfeed lock)
   ```

   Expected: exit 0 in both directories.
   - Without `--update` it only compares and writes nothing.
   - When the lock is stale it exits 9 and prints the drift, e.g. `25.12 point release 25.12.5 ->
     25.12.6`.
   - A stale lock in owfeed-packages reds its `check / build` after the tag.

### The security review stays local

The maintainer reviews the diff this release carries: `git diff <PREV> HEAD`, after the last code
commit and before the tag. Nothing automates it.

It focuses on the five things a theme can get wrong:

- the installer's signature chain;
- new shell running over a build tree;
- the unauthenticated login template;
- sinks in the browser JS;
- the packaging pipeline.

## Check C. Asset selection (issue #6), separately and always

This is the most fragile part of every release and the only one that fails silently.

- The release notes and the asset choice are evaluated at tag time, in the field, months later.
- Localisation ships as separate `luci-i18n-*` packages.
- Assets sorted by name can be picked instead of the theme.

### `install.sh` never guesses

The reader in the field is `install.sh`. On a router the feed cannot serve, it reads the signed
`manifest.txt` and matches `$2` against the package name exactly.

So a release carrying `luci-theme-footstrap` and two `luci-i18n-footstrap-<lang>` packages is
safe where #6 was not.

### Any other reader must resolve exactly one asset per format

Any other reader resolves each package through its own name-anchored regex `^<name>[-_][^/]*\.EXT$`.
It must find exactly one asset per format. A `.sig` ends in `.EXT.sig` and does not match `\.EXT$`.

Simulate it by hand on the release's shape:

1. Create the scratch directory:

   ```sh
   mkdir -p ../tmp/release-<VERSION>
   ```

2. Take the asset list of the last published release:

   ```sh
   gh api repos/VizzleTF/luci-theme-footstrap/releases/latest \
     --jq '.assets[].browser_download_url' > ../tmp/release-<VERSION>/urls.txt
   ```

3. If this release adds or renames an asset, edit `../tmp/release-<VERSION>/urls.txt` to match: one URL per line.
4. Count the matches per format:

   ```sh
   for EXT in apk ipk; do
     n=$(grep -Ec "/luci-theme-footstrap[-_][^/]*\.$EXT\$" ../tmp/release-<VERSION>/urls.txt)
     echo "$EXT -> n=$n (must be 1)"
   done
   ```

   Expected: `apk -> n=1` and `ipk -> n=1`. Every release ships the theme in both formats
   ([ci.md](ci.md) "What the release carries"). `n=0` means a format is missing, and a reader of
   that format finds nothing. A higher `n` means a field reader would pick the wrong package:
   rename the asset before you tag.

## Check D. Live checks for the areas the diff touched

CI's `e2e` opens every menu page on both routers. It fails only on what footstrap adds (Check B).

What remains here is the human look at the issues below:

- on both releases, 25.12/apk and 24.10/opkg;
- for the areas the diff touched.

Compare against stock bootstrap wherever you are unsure: it is the reference for LuCI behaviour.

Expected: every row you check shows what its "What to look at" cell describes.

Which rows a path in the diff makes mandatory. The repo maps only these paths to rows: the issue
numbers come from comments in the code. Any other path in the Check A list: check every row.

| Path in the diff | Rows |
|---|---|
| `styles/` | the visual rows: #1, #5, #7, #9, #10, #11 (`styles/` comments cite #5, #7, #9, #10) |
| `fs-select.js` | #2, any `<select>` |
| `fs-fit.js` | #1 (the stacked table), #41/#75 (the `min-height` floors), scroll creep |
| `menu-footstrap.js`, `*.ut`, `fs-sheets.js` | every row |

The rows for #3, #4, #5 and #8 come from the issue reports.

| Issue | Page | What to look at |
|---|---|---|
| #1 | a third-party app with a wide table, firewall zones | the table stacks into cards, does not overflow its section; the content width does not tear |
| #2 | Podkop → Monitoring, any `<select>`. Podkop is not on the stands: install it on a stand from [itdoginfo/podkop](https://github.com/itdoginfo/podkop) first | the dropdown opens, host filtering works |
| #7 | `admin/system/package-manager` | the theme's favicon; buttons do not overlap the inputs; no stray unrounded table border |
| #9 | `admin/network/firewall/forwards`, `/snats` (GridSection) | config-table row labels visible (`.fs-stacked` cards / `@container 960`) |
| #10 | `admin/network/dhcp` (a page with hidden tabs) | no empty scroll below the content |
| #41, #75 | `admin/network/network`, `admin/system/startup` (a page with a tab strip) | switch tabs: the pane the reader LEFT keeps no `min-height`, and the tab they opened starts where the page starts. The fault is invisible on a page that is only loaded. On a page that does not poll, it never goes away by itself |
| scroll creep | `admin/status/overview` on a narrow window, scrolled off the top, in Safari | pass: the page stays where you scrolled it across several poll ticks; fail: it creeps upward once per poll tick |
| #11 | `admin/status/overview` (client list) | the "Network" column is not crushed, rows are not over-wide |
| #3 | `luci-app-filemanager` (on the stands) | the file manager opens and works; after you leave it, a config page still shows Save, Apply and Reset |
| #4 | System → Appearance, the login and page background | choosing and uploading a background works and shows after a reload |
| #5 | `admin/system/attendedsysupgrade/configuration`; `admin/status/overview` (port and network cards, client list) | the "Address" field is wide enough for a URL; the cards match the README screenshots; a MAC address stays on one line |
| #8 | OpenClash (`luci-app-openclash`, in `owlab.yaml`'s third-party apps) | the theme's styles apply on the OpenClash page |
| #17 | the release assets, not a page | `manifest.txt` and `manifest.txt.sig` are present; `latest/download/manifest.txt` serves that file; `usign -V` passes with `release.pub`; `awk '$1=="pkg"'` yields one line per format; no install or update path touches `api.github.com` |

The #17 row guards installs as well as readers. A router the feed cannot serve is installed from the
manifest (`install.sh` -> `install_from_release`). So a manifest that does not verify is an install
that refuses.

## The changelog contract

This section is the single source of truth for `CHANGELOG.md` and its Russian mirror
`CHANGELOG_ru.md`.

`npm run changelog` checks the mechanical half. Run it yourself: CI does not. It checks:

- the set, order and uniqueness of sections;
- empty sections;
- dates;
- `compare` links;
- mirror parity: versions, dates, sections, bullet count;
- the bold lead on `[Unreleased]` and on a freshly cut version.

The script cannot check the prose rules below. That part is on you.

### Keep a Changelog, plus `Performance`

| Choice | What it means |
|---|---|
| Base: Keep a Changelog 1.1.0 | fixed category names and order, `[Unreleased]` on top, newest version first, ISO 8601 dates, the file at the repository root |
| Extension: `Performance` | a seventh category on top of KaC's six |
| Scope: only what a theme user sees | CI, tests, tooling and docs changes get no entry |
| Voice: effect-lead | `- **one-line effect.** then the reasoning`, neither strictly past tense nor strictly imperative; keep it everywhere |
| Commits: Conventional Commits | so the version bump can be derived; the changelog is still written by hand, and generation from commits yields raw material only |

Where Keep a Changelog and Common Changelog disagree (categories, tense, `[Unreleased]`), this
project follows Keep a Changelog.

### Categories come in a fixed order

| Index | English | Russian |
|---|---|---|
| 0 | `Added` | `Добавлено` |
| 1 | `Changed` | `Изменено` |
| 2 | `Deprecated` | `Устарело` |
| 3 | `Removed` | `Удалено` |
| 4 | `Fixed` | `Исправлено` |
| 5 | `Security` | `Безопасность` |
| 6 | `Performance` | `Производительность` |

The rules for categories:

- One section of each type per release.
  Why: two `### Fixed` under one version is a merge artefact.
- The order does not follow the order the work was done in.
- No empty sections: no bullets, no heading.
- Not all seven need to be present. A normal release is `Added`/`Changed`/`Fixed`, sometimes
  `Performance`.
- `Development` is unused. `tools/changelog.mjs` still accepts it (index 7), and
  `tools/release-notes.sh` leaves it out of the release page. Write nothing there.

### An entry is a change a theme user sees

An entry is what a router running the package shows or does. That covers `luci-theme-footstrap/**`,
`install.sh`, the feed and the published package. CI, tests, tooling and docs changes get no entry.

A fix to the trust chain a user installs through is `Security`, even when only CI files change. The
trust chain is `install.sh`, the signing keys, `tools/stage-release.sh`, the `release` job and the
feed.

### The shape of an entry

```
- **A one-line effect that reads on its own.** Then the reasoning: why, the measurement,
  what the rule protects against.
```

The bold lead is the release note.
Why: `tools/release-notes.sh` extracts only the bold lead of each bullet and groups it by section.
So the lead is mandatory: a bullet without `**…**` silently drops out of the release. And it must be
a self-contained sentence, because it appears without the reasoning behind it.

Write the effect, not the diff.
Bad: "changed `:hover` to `:focus` in `styles/base/70-buttons.css`".
Good: "Buttons had no focus indicator at all".

Keep the number the change was made for.
Why: the measurement separates a changelog from a marketing blurb.
Examples: "20 KB of font for 227 labels", "312 of 336 elements recoloured by a hostile `:root`",
"1.69:1 where AA wants 4.5".

Name what the rule protects against, if it is not obvious.
Why: half this theme's invariants exist because the obvious alternative was tried and was worse. An
entry without the reason invites the next person to undo it.

Do not cite commits or retell a file's history.
Why: a changelog is not a git log.

Edit the existing entry; do not append a second one.

Merge related commits into one entry.

### `[Unreleased]` is written in the same commit as the code

A commit that changes what a theme user sees writes into `## [Unreleased]` in the same commit as the
code, in both files.
Why: a changelog written afterwards is written from the diff, and the diff does not know why.

Commits that touch only CI, tests, tooling or docs write nothing.

Write both files with one call, so neither half can be forgotten:

```sh
node tools/changelog.mjs add <0-6> --en '- **…**' --ru '- **…**' && git commit …
```

- The number is the category index: 0 = Added … 6 = Performance.
- The command writes the worktree and the index.
- It recreates the heading when a release left none.

List existing entries with `grep -n '^- \*\*' CHANGELOG.md` rather than reading the block.

### The bilingual mirror

`CHANGELOG.md` (English) and `CHANGELOG_ru.md` are edited in one commit.
Why: a mirror that lags is worse than no mirror. The reader cannot tell which copy is stale.

- Same section set and order.
- Same numbers, versions and `compare` links.
- Only the prose may differ, never the facts.

The English file is the primary source for the release-note generator.

### Anti-patterns

- a dump of the commit log or the diff;
- a commit or PR copied verbatim;
- a partial changelog that omits `Removed`/`Security`/breaking changes;
- duplicate sections under one version;
- an entry written from the diff after the fact;
- a self-reference to a commit hash.

## The runbook

Run these steps in order, and only after Checks A to D have passed. The order keeps two things true:

- the tag points at a commit that already carries its own changelog section;
- every CI job reads the sha the tag will name.

Placeholders are listed in [Placeholders and tools](#placeholders-and-tools).

### 0. Readiness

Any red stops here, with its owner named.

- Scope the diff (Check A). Run the live checks it makes mandatory plus asset selection (Checks C
  and D) on both stands ([verifying.md](verifying.md)).
- Build's newest completed push run on `main` is `success` (Check B, with the commands to find and
  read it). Read it job by job: `build`,
  both `e2e` legs, both `anchor` legs and `playground`.
- `~/go/bin/owfeed lock` exits 0 at the repo root and in `../tmp/release-<VERSION>/feed` (Check B).
  A stale lock there reds the feed's `check / build` after the tag.
- The security review of the whole release (Check B) is done before the tag.
- `origin` is the only remote. Every push below goes to `origin`.

  ```sh
  git remote
  ```

  Expected: `origin` and nothing else.

### 1. Rename `[Unreleased]`

Rename `[Unreleased]` to `## [<VERSION>] — <DATE>` in both `CHANGELOG.md` and `CHANGELOG_ru.md`.
Add the `compare/` link at the bottom of each, above the previous version's link. There is no
`[Unreleased]` compare link to update: the changelog dropped it in commit 161a053.

The format, from the 0.14.20 release:

```
## [0.14.20] — 2026-11-02
```

```
[0.14.20]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.14.19...v0.14.20
```

Expected: `git diff --stat` shows `CHANGELOG.md` and `CHANGELOG_ru.md` only.

Sections stay in the canonical order, and every bullet has a `bold lead`.

### 2. Check the changelog

```sh
npm run changelog
```

Expected: exit 0.

### 3. Commit and push

Commit that change as `release: <VERSION>` and push it to `origin main`. The order from here is
fixed: push the release commit, read its run (step 4), then tag (step 5).

```sh
git add CHANGELOG.md CHANGELOG_ru.md && git commit -m "release: <VERSION>"
git push origin main
```

Expected: the push is accepted. GitHub reports the bypassed rule "main: CI must pass": a direct push
to `main` needs the admin bypass ([ci.md](ci.md)). That message is normal: it appears on every
direct push to `main`, and the checks are read after the push, in step 4.

### 4. After the push, before the tag: read the release sha's run and the one before it

```sh
gh run list --branch main --workflow build.yml --event push -L2
```

Expected: two rows. The top one is the release commit's run, the second the run before it. Take each
`<ID>` from the `ID` column for `gh run view <ID>`.

1. Check that the top row is the release commit. Its title is `release: <VERSION>`; for the sha,
   compare with:

   ```sh
   git rev-parse HEAD
   gh run view <ID> --json headSha --jq .headSha
   ```

   Expected: the same sha twice.

2. Wait for the release commit's run to finish:

   ```sh
   gh run watch <ID> --exit-status
   ```

   Pass: the run's conclusion is `success`, and `gh run watch` exits 0. Read it job by job with
   `gh run view <ID>`.

- It lists Build's push runs only. A CodeQL or pages run is not the pipeline the tag waits on.
- It has no `--status completed`, so the release sha's own run shows while it is still going.
- `build` already generates the newest section's notes on every run. So a broken section fails the
  release commit's main run, not the tag.
- A run already red before your push stays red after it.
- `release` waits for every job (step 6). So a tag pushed onto a broken pipeline cannot publish.

Do not tag over a red run, the pre-existing one included. A pre-existing failure is either an
infrastructure condition to fix first, or a real regression. A regression that has nothing to do with
this release will still hold it.

### 5. Tag the release commit

The tag push cannot be undone. Ruleset 25550119 forbids moving or deleting a `v*` tag, for every
token ([ci.md](ci.md)).

1. Check that the tree is ready:

   ```sh
   git status --porcelain
   git rev-parse --abbrev-ref HEAD
   git fetch origin && git rev-parse HEAD origin/main
   git log -1 --format=%s
   sed -n 's/^## \[\([0-9][^]]*\)\].*/\1/p' CHANGELOG.md | head -1
   ```

   Expected, line by line: nothing; `main`; the same sha twice; `release: <VERSION>`; `<VERSION>`.

2. Create the tag:

   ```sh
   git tag -a v<VERSION> -m v<VERSION>
   ```

   Expected: exit 0.

3. Stop and confirm before the push. Compare the output of 5.1 with its Expected line once more,
   and check that step 4 found no red run. If anything differs, do not push: delete the local tag
   with `git tag -d v<VERSION>` and go back.

4. Push the tag:

   ```sh
   git push origin v<VERSION>
   ```

   Expected: `* [new tag] v<VERSION> -> v<VERSION>`.

The tag goes on the release commit, never first. Why: it must point at a commit that already
contains its own entry. Otherwise the release describes a version whose changelog does not yet
exist.

### 6. Read the tag's run job by job

CI on `v*` builds both formats, signs them, and builds the release body from the changelog.

`release` does not run until `build`, `e2e`, `anchor` and `playground` are green. This is by design:
a tag cannot publish a package no router has installed. The consequence: any one red leg holds the
whole release. That includes a leg red for a reason outside the diff, such as infrastructure or an
upstream feed.

**The release is not cut until the tag's own run is read, job by job, not only waited on.**

| Command | What it gives |
|---|---|
| `gh run list --commit <SHA>` | the tag's runs |
| `gh run watch <ID> --exit-status` | the verdict |
| `gh run view <ID>` | the job list; good means `build`, both `e2e` legs, both `anchor` legs, `playground` and `release` are all `success` |
| `gh run view <ID> --log-failed` | a failing step's log |

A first attempt whose every failed job failed on infrastructure alone is re-run once, on its own, by
`rerun-infra.yml` ([ci.md](ci.md)). On the tag that second attempt goes on to `release`, as a manual
re-run would.

`gh run watch` ends with the first attempt. `gh run view <ID>` shows the newest one, and
`--attempt 1` the first.

If a job is red, name its cause before you act. The cause decides the fix:

| Cause | Fix |
|---|---|
| infrastructure | `rerun-infra.yml` re-runs it once on its own. If it is still red, fix the condition and re-run the failed jobs. |
| an upstream feed | wait for the feed or fix it upstream, then re-run the failed jobs |
| this diff | the tag cannot be moved or deleted, and `release` never ran, so nothing was published. Fix it on `main` and cut the next version from Check A. |

Only then check that the release carries the expected assets, each with its `.sig`:

```sh
gh release view v<VERSION>
```

- the theme, resolving to exactly one asset per format;
- the manifest;
- the installer.

The notes fill the release page; they are not an asset and carry no `.sig` ([ci.md](ci.md)). Beside
the assets sits `playground.tar.gz`, which `release` attaches unsigned while the release is a draft.

Nobody publishes the release by hand. The `release` job runs owfeed's `package.yml`: it creates the
release as a draft, attaches the assets, and publishes it before the job ends. `pages` then mirrors
it as the latest release. Step 7 starts once `release` is green and `gh release view v<VERSION>`
shows the release without the draft mark.

### 7. Publish the feed; do not wait on the schedule

The theme is installed from owfeed-packages. A release nobody can `apk upgrade` into is half a
release.

How the feed updates on its own:

- There `update.yml` runs `land` → `check` → `publish` on a cron. GitHub thins it to one run every
  2-5 h.
- `check` pushes `update/luci-theme-footstrap-<VERSION>` and runs the checks on it.
- A later run's `land` fast-forwards `main` onto that branch once the checks are green. The same
  run's `publish` dispatches `publish.yml`.
- No pull request is opened, so nothing needs approving.

The next scheduled run can be hours away. So dispatch it yourself:

1. Wait until the branch's `Check` is green. The branch appears after the next `update.yml` run
   notices the tag. If it is not there, dispatch `update.yml` (the command in step 2) to start that
   run now. That is safe early: `land` fast-forwards only a branch whose checks are green, so a run
   with no green branch lands nothing. Then come back here.

   ```sh
   gh run list --repo owfeed/owfeed-packages --branch update/luci-theme-footstrap-<VERSION>
   ```

   Expected: a `Check` run with status `completed` and conclusion `success`.

2. Dispatch the update once the branch is green. It lands the branch on the feed's `main` and
   publishes it.

   The irreversible part is landing a green branch: every router that upgrades after it installs
   this version. A bad version can only be replaced by a newer one.

   ```sh
   gh workflow run update.yml --repo owfeed/owfeed-packages
   ```

   Expected: exit 0, and a new `update.yml` run in `gh run list --repo owfeed/owfeed-packages`.

3. Watch that run, then the `publish.yml` run it starts. Landing takes ~1 min, publishing ~3 min.

   ```sh
   gh run watch <ID> --repo owfeed/owfeed-packages
   ```

   Expected: each run ends in `success`.

4. Read the served index of every architecture, not the workflow log. The list of architectures
   is owfeed-packages' `owfeed.lock`, so take it from there:

   ```sh
   gh api repos/owfeed/owfeed-packages/contents/owfeed.lock --jq .content | base64 -d \
     > ../tmp/release-<VERSION>/owfeed.lock
   arches() { awk -v want="$1" '/- line:/{l=$3; gsub(/"/,"",l)} /^ *- [a-z0-9_-]+$/ && l==want{print $2}' \
     ../tmp/release-<VERSION>/owfeed.lock; }
   ```

   24.10 serves `Packages.gz`:

   ```sh
   for a in $(arches 24.10); do
     v=$(curl -fsS "https://repo.owfeed.org/releases/24.10/$a/Packages.gz" | gunzip \
       | awk '/^Package: luci-theme-footstrap$/{f=1} f&&/^Version:/{print $2; exit}')
     [ "$v" = "<VERSION>-r1" ] || echo "MISS 24.10 $a: '$v'"
   done
   ```

   25.12 serves a compressed `packages.adb`, which only `apk adbdump` reads. Pipe each one into a
   running 25.12 stand:

   ```sh
   for a in $(arches 25.12); do
     v=$(curl -fsS "https://repo.owfeed.org/releases/25.12/$a/packages.adb" \
       | owlab exec owrt2512 -- sh -c 'cat >/tmp/p.adb && apk adbdump /tmp/p.adb' 2>/dev/null \
       | awk '/name: luci-theme-footstrap$/{f=1;next} f&&/version:/{print $2; exit}')
     [ "$v" = "<VERSION>-r1" ] || echo "MISS 25.12 $a: '$v'"
   done
   ```

   Expected: no `MISS` line from either loop. The `-r1` is what `PKG_RELEASE:=1` puts on every
   package. A `MISS` with an empty version means that index does not carry the theme yet: wait for
   `publish.yml` and run the loop again.

Remove the scratch directory:

```sh
rm -rf ../tmp/release-<VERSION>
```

After the release, `node tools/changelog.mjs add` recreates `## [Unreleased]` on top with the next
entry.

## Sources for the changelog rules

- [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/): primary.
- [Common Changelog](https://common-changelog.org/): primary, and the standard we deliberately
  diverge from.
- [Conventional Commits v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/): primary.
