# Releasing

The mandatory pre-release checklist, the changelog contract, and the runbook. No release goes out
until CI's `e2e` and `anchor` are green on both routers and the live checks are done for every
issue the release diff touches.

How CI builds and signs the packages: [ci.md](ci.md).

## Why there is a checklist at all

Every closed bug left a live check behind: what to look at, and where, to catch its return. This
page is the register: one row per issue.

A bug with no check comes back silently. **If you fix something that has no row here, add a row.**

## Step 1 — scope: what can regress in this release

A regression can only come from what the diff touches.

```sh
git diff --name-only "$(git describe --tags --abbrev=0)" HEAD | sed 's#/.*##' | sort -u
git diff --name-only "$(git describe --tags --abbrev=0)" HEAD | grep -E 'styles/|menu-footstrap|\.ut$|fs-sheets|fs-select|fs-fit' \
  || echo 'no CSS / renderer / template / fence changes'
```

- The diff does not touch `styles/`, the renderer, the templates or the fence → the visual and
  fence issues (#1–#5, #7–#11) cannot regress from it. A live look is allowed but not required.
- The diff touches the matching area → the live check for those issues is mandatory.

**Always mandatory, whatever the diff:** CI's `e2e` and `anchor` on both routers, plus issue #6
(packaging and asset selection). #6 breaks at the release level, outside the code, and nothing
fails until a router in the field pulls the update.

## Step 2 — read CI on the release sha

The code of the release is on `main` before the release commit is cut. Read its push run job by
job (`gh run view <id>`):

| CI job | What it holds |
|---|---|
| `build` | both formats, built by `owfeed build` |
| `e2e` | `tools/e2e.mjs` on owrt2512 (25.12/apk) and owrt2410 (24.10/opkg): install the last release, upgrade to this build, open every menu page against bootstrap, remove, fresh install ([verifying.md](verifying.md)) |
| `anchor` | `tools/anchor-check.mjs` on owrt2512 and owrt2410, beside `e2e`: a poll tick above a parked reader in Chromium, Firefox and WebKit ([verifying.md](verifying.md)) |

`playground` runs on every push to `main` that reaches the package, on the tag and on a dispatch
(`gh workflow run build.yml --ref main`); the runbook's step 0 reads it with the rest of the main
run. A dispatch never signs a package or publishes a release. A tag cut before that rule (v0.14.16
and older) keeps a build.yml whose `release` also runs on a dispatch, re-signs every package and
deletes and re-uploads each asset of the published release: never pass `--ref` naming one of those
tags.

What stays local, beside reading CI:

```sh
npm run changelog
```

`~/go/bin/owfeed lock` must exit 0 at the repo root and in a fresh clone of owfeed-packages. Without
`--update` it only compares and writes nothing (exit 9 and the drift, e.g. `25.12 point release
25.12.5 -> 25.12.6`, when stale). A stale lock in owfeed-packages reds its `check / build` after
the tag.

The security review of the diff this release carries also stays local. The maintainer reads
`git diff <prev> HEAD` after the last code commit and before the tag. Nothing automates it. It
focuses on the five things a theme can get wrong:

- the installer's signature chain;
- new shell running over a build tree;
- the unauthenticated login template;
- sinks in the browser JS;
- the packaging pipeline.

## Step 3 — asset selection (issue #6), separately and always

This is the most fragile part of every release and the only one that fails silently. The release
notes and the asset choice are evaluated at tag time, in the field, months later. Localisation
ships as separate `luci-i18n-*` packages, and assets sorted by name can be picked instead of the
theme.

- **The reader in the field** is `install.sh`, and it never guesses. On a router the feed cannot
  serve, it reads the signed `manifest.txt` and matches `$2` against the package name exactly. That
  makes a release carrying `luci-theme-footstrap` and two `luci-i18n-footstrap-<lang>` packages
  safe where #6 was not.
- **Any other reader** resolves each package through its own name-anchored regex
  `^<name>[-_][^/]*\.EXT$` to exactly one asset per format (a `.sig` ends in `.EXT.sig` and does not
  match `\.EXT$`). Simulate it by hand on the release's shape:

```sh
# on a dev router, RELJSON = the release JSON of the intended shape
for EXT in apk ipk; do
  n=$(jsonfilter -i "$RELJSON" -e '@.assets[*].browser_download_url' \
      | grep -Ec "/luci-theme-footstrap[-_][^/]*\.$EXT\$")
  echo "$EXT -> n=$n (must be 0 or 1)"
done
```

## Step 4 — live checks for the areas the diff touched

CI's `e2e` opens every menu page on both routers and fails only on what footstrap adds (step 2).
What remains here is the human look at the issues below, on both releases (25.12/apk and
24.10/opkg), for the areas the diff touched. Compare against stock bootstrap wherever you are
unsure: it is the reference for LuCI behaviour.

| Issue | Page | What to look at |
|---|---|---|
| #1 | a third-party app with a wide table, firewall zones | the table stacks into cards, does not overflow its section; the content width does not tear |
| #2 | Podkop → Monitoring (not on the stands: install it from [itdoginfo/podkop](https://github.com/itdoginfo/podkop)), any `<select>` | the dropdown opens, host filtering works |
| #7 | `admin/system/package-manager` | the theme's favicon; buttons do not overlap the inputs; no stray unrounded table border |
| #9 | `admin/network/firewall/forwards`, `/snats` (GridSection) | config-table row labels visible (`.fs-stacked` cards / `@container 960`) |
| #10 | `admin/network/dhcp` (a page with hidden tabs) | no empty scroll below the content |
| #41, #75 | `admin/network/network`, `admin/system/startup` (a page with a tab strip) | switch tabs: the pane the reader LEFT keeps no `min-height`, and the tab they opened starts where the page starts. The fault is invisible on a page that is only loaded and, on a page that does not poll, never goes away by itself |
| scroll creep | `admin/status/overview` on a narrow window, scrolled off the top, in Safari | the page does not creep upward once per poll tick |
| #11 | `admin/status/overview` (client list) | the "Network" column is not crushed, rows are not over-wide |
| #17 | the release assets, not a page | `manifest.txt` and `manifest.txt.sig` are present; `latest/download/manifest.txt` serves that file; `usign -V` passes with `release.pub`; `awk '$1=="pkg"'` yields one line per format; no install or update path touches `api.github.com`. The manifest carries installs as well as readers: a router the feed cannot serve is installed from it (`install.sh` -> `install_from_release`), so a manifest that does not verify is an install that refuses |

## The changelog contract

The single source of truth for `CHANGELOG.md` and its Russian mirror `CHANGELOG_ru.md`.

`npm run changelog` checks the mechanical half. It covers the set, order and uniqueness of
sections, empty sections, dates, `compare` links and mirror parity (versions, dates, sections,
bullet count). It also requires the bold lead on `[Unreleased]` and a freshly cut version. Run it
yourself: CI does not.

The script cannot check the prose rules below. That part is on you.

### What we chose

- **Base: Keep a Changelog 1.1.0.** Fixed category names and order, `[Unreleased]` on top, newest
  version first, ISO 8601 dates, the file at the repository root.
- **Extension: `Performance`**, a seventh category on top of KaC's six.
- **Only what a theme user sees.** CI, tests, tooling and docs changes get no entry.
- **Voice: effect-lead**, neither strictly past tense nor strictly imperative:
  `- **one-line effect.** then the reasoning`. Keep it everywhere.
- **Commits follow Conventional Commits** (so the version bump can be derived), but the changelog is
  written by hand. Generation from commits yields raw material only.

Where Keep a Changelog and Common Changelog disagree (categories, tense, `[Unreleased]`), this
project follows Keep a Changelog.

### Categories, in this fixed order

`Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`, `Performance`
(`Добавлено`, `Изменено`, `Устарело`, `Удалено`, `Исправлено`, `Безопасность`, `Производительность`).

- **One section of each type per release.** Two `### Fixed` under one version is a merge artefact.
- **The order does not follow the order the work was done in.**
- **No empty sections.** No bullets, no heading.
- Not all seven need to be present. A normal release is `Added`/`Changed`/`Fixed`, sometimes
  `Performance`.
- **An entry is a change a theme user sees**: what a router running the package shows or does
  (`luci-theme-footstrap/**`, `install.sh`, the feed, the published package). CI, tests, tooling
  and docs changes get no entry. A fix to the trust chain a user installs through (`install.sh`,
  the signing keys, `tools/stage-release.sh`, the `release` job, the feed) is `Security` even when
  only CI files change.
- **`Development` is unused.** `tools/changelog.mjs` still accepts it (index 7) and
  `tools/release-notes.sh` leaves it out of the release page; write nothing there.

### The shape of an entry

```
- **A one-line effect that reads on its own.** Then the reasoning: why, the measurement,
  what the rule protects against.
```

- **The bold lead IS the release note.** `tools/release-notes.sh` extracts only the bold lead of
  each bullet and groups it by section. So: the lead is mandatory (a bullet without `**…**` silently
  drops out of the release), and it must be a self-contained sentence, because it appears without
  the reasoning behind it.
- **Write the effect, not the diff.** "Buttons had no focus indicator at all" beats "changed
  `:hover` to `:focus` in `styles/base/70-buttons.css`".
- **Keep the number the change was made for.** The measurement separates a changelog from a
  marketing blurb. Examples: "20 KB of font for 227 labels", "312 of 336 elements recoloured by a
  hostile `:root`", "1.69:1 where AA wants 4.5".

- **Name what the rule protects against** if it is not obvious. Half this theme's invariants exist
  because the obvious alternative was tried and was worse; an entry without the reason invites the
  next person to undo it.
- **Do not cite commits** or retell a file's history. A changelog is not a git log.
- **Edit the existing entry; do not append a second one.**
- **Merge related commits into one entry.**

### `[Unreleased]`

**A commit that changes what a theme user sees writes into `## [Unreleased]` in the same commit as
the code**, in both files. A changelog written afterwards is written from the diff, and the diff does
not know why. Commits that touch only CI, tests, tooling or docs write nothing. Write both files with
one call so neither half can be forgotten:
`node tools/changelog.mjs add <0-6> --en '- **…**' --ru '- **…**' && git commit …` (0 = Added …
6 = Performance; it writes the worktree and the index and recreates the heading when a release left
none). List existing entries with `grep -n '^- \*\*' CHANGELOG.md` rather than reading the block.

### The bilingual mirror

`CHANGELOG.md` (English) and `CHANGELOG_ru.md` are edited in one commit. A mirror that lags is
worse than no mirror: the reader cannot tell which copy is stale. Same section set and order, same
numbers, versions and `compare` links. Only the prose may differ, never the facts. The English file
is the primary source for the release-note generator.

### Anti-patterns

- a dump of the commit log or the diff;
- a commit or PR copied verbatim;
- a partial changelog that omits `Removed`/`Security`/breaking changes;
- duplicate sections under one version;
- an entry written from the diff after the fact;
- a self-reference to a commit hash.

## The runbook

Run these steps in order, and only after everything above has passed. The order keeps two things
true: the tag points at a commit that already carries its own changelog section, and every CI job
reads the sha the tag will name. `<v>` is the new version, `<prev>` the last tag; scratch output
goes to `../tmp/release-<v>/`.

0. **Readiness.** Any red stops here, with its owner named:
   - scope the diff (Step 1 above says which live checks it makes mandatory) and run those rows
     plus asset selection (Steps 3 and 4) on both stands ([verifying.md](verifying.md));
   - Build's newest completed push run on `main` is `success` and is read job by job (`build`,
     both `e2e` legs, both `anchor` legs and `playground`);
   - `~/go/bin/owfeed lock` exits 0 at the repo root and in a fresh
     `gh repo clone owfeed/owfeed-packages ../tmp/release-<v>/feed -- --depth 1` (a stale lock
     there reds the feed's `check / build` after the tag);
   - the security review of the whole release (Step 2), done before the tag.
1. Rename `[Unreleased]` to `## [x.y.z] — YYYY-MM-DD` in both `CHANGELOG.md` and
   `CHANGELOG_ru.md`, and add the `compare/` link at the bottom of each. Sections in the canonical
   order, every bullet with a `bold lead`.
2. `npm run changelog` — green.
3. Commit that change as `release: x.y.z` and push it to `origin main`.
4. **Before the tag, read the release sha's run and the one before it on `main`**:
   `gh run list --branch main --workflow build.yml --event push -L2`. It lists Build's push runs
   only: a CodeQL or pages run is not the pipeline the tag waits on. It has no
   `--status completed`, so the release sha's own run shows while it is still going. `build`
   already generates the newest section's notes on every run, so a broken section fails the
   release commit's main run, not the tag. A run already red before your push stays red after it.
   `release` waits for every job (step 7), so a tag pushed onto a broken pipeline cannot publish.
   Do not push past a pre-existing failure. It is either an infrastructure condition to fix first,
   or a real regression that has nothing to do with this release but will still hold it.
5. **Tag the release commit**: `git tag -a vx.y.z -m vx.y.z`, then `git push origin vx.y.z` once the
   create exited 0. The tag goes on the release commit, never first. It must point at a commit that
   already contains its own entry, or the release describes a version whose changelog does not yet
   exist.
6. `origin` is the only remote.
7. CI on `v*` builds both formats, signs them, and builds the release body from the changelog.
   `release` does not run until `build`, `e2e`, `anchor` and `playground` are green. This is by
   design: a tag cannot publish a package no router has installed. The consequence: any one red leg
   holds the whole release, including a leg red for a reason outside the diff, such as
   infrastructure or an upstream feed. **The release is not cut until the tag's own run is read,
   job by job, not only waited on**:
   - `gh run list --commit <sha>` for the tag's runs;
   - `gh run watch <id> --exit-status` for the verdict;
   - `gh run view <id>` for the job list;
   - `gh run view <id> --log-failed` for a failing step's log.

   A first attempt whose every failed job failed on infrastructure alone is re-run once, on its
   own, by `rerun-infra.yml` ([ci.md](ci.md)). On the tag that second attempt goes on to `release`,
   as a manual re-run would. `gh run watch` ends with the first attempt; `gh run view <id>` shows
   the newest one, `--attempt 1` the first.

   Say plainly whether the cause is this diff, an infrastructure condition, or an upstream feed.
   Only then check that the release carries the expected assets, plus a `.sig` for each: the theme
   resolving to exactly one asset per format, the manifest, the installer, the notes. Beside them
   sits `playground.tar.gz`, which `release` attaches unsigned while the release is a draft.
8. **Publish the feed, and do not wait on the schedule.** The theme is installed from
   owfeed-packages, so a release nobody can `apk upgrade` into is half a release. There `update.yml`
   runs `land` → `check` → `publish` on a cron GitHub thins to one run every 2-5 h. `check` pushes
   `update/luci-theme-footstrap-<VERSION>` and runs the checks on it. A *later* run's `land`
   fast-forwards `main` onto it once they are green, and the same run's `publish` dispatches
   `publish.yml`. No pull request is opened, so nothing needs approving.

   The next scheduled run can be hours away. Once `gh run list --repo owfeed/owfeed-packages
   --branch update/luci-theme-footstrap-<VERSION>` shows the branch's `Check` green, dispatch it
   yourself: `gh workflow run update.yml --repo owfeed/owfeed-packages`. Then run
   `gh run watch <id> --repo owfeed/owfeed-packages` on that run and on the `publish.yml` run it
   starts (~1 min to land, ~3 min to publish).

   Then read the served index, not the workflow log, and confirm the new version is there:
   - 24.10: `Packages.gz` on `https://repo.owfeed.org/releases/24.10/<arch>/` (`Version:` after
     `Package: luci-theme-footstrap`);
   - 25.12: `apk adbdump` on `releases/25.12/<arch>/packages.adb` from a router or stand. The file
     is compressed, so `strings` finds nothing.


`node tools/changelog.mjs add` recreates `## [Unreleased]` on top with the next entry.

## Sources for the changelog rules

- [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) — primary
- [Common Changelog](https://common-changelog.org/) — primary, and the standard we deliberately
  diverge from
- [Conventional Commits v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) — primary
