# Releasing

The mandatory pre-release checklist, the changelog contract, and the runbook. **No release goes out
until the automatic gates are green and the live checks are done for every issue the release diff
touches.**

How CI builds and signs the packages: [ci.md](ci.md).

## Why there is a checklist at all

Every closed bug left a guard behind — a gate or a live check that catches its return. This page
is the register: one row per issue, the mechanism, the command, and whether it is automated.

A bug with no guard comes back silently. **If you fix something that has no row here, add a row.**

## Step 1 — scope: what can regress in this release

A regression can only come from what the diff touches.

```sh
git diff --name-only "$(git describe --tags --abbrev=0)" HEAD | sed 's#/.*##' | sort -u
git diff --name-only "$(git describe --tags --abbrev=0)" HEAD | grep -E 'styles/|menu-footstrap|\.ut$|fs-sheets|fs-select|fs-fit' \
  || echo 'no CSS / renderer / template / fence changes'
```

- The diff does not touch `styles/`, the renderer, the templates or the fence → the visual and
  fence issues (#1–#5, #7–#11) cannot regress from it. Their gates being green is enough; a live run
  is allowed but not required.
- The diff touches the matching area → the live check for those issues is mandatory.

**Always mandatory regardless of the diff:** the whole automatic section, plus issue #6 (packaging
and asset selection) — because #6 breaks at the release level rather than in the code, and
nothing fails until a router in the field pulls the update.

## Step 2 — the automatic gates: read CI on the release sha

The gates run in CI, not again on this machine. The code of the release is on `main` before the
release commit is cut, and its push run is read **job by job** (`gh run view <id>`): a local re-run
of the same gates on the same sha measured 67 min over nine stands and added no information —
six of them are twins of the same three images, and every local live gate was a subset of CI's
(`scroll-anchor` locally: one engine, no `--full`; CI: three engines, `--full`).

| CI job | What it holds |
|---|---|
| `check`, `lint` | every static gate below, `jsmin-verify`, `computed-diff` (a report on PRs, never a failure) |
| `build` | both formats; `tools/check-packages.sh` — one theme package per format, catalogues outside it |
| `verify` | `owlab test` on 25.12/apk and 24.10/opkg, the five assertions of [development.md](development.md#proving-it-on-a-router-owlab-test) |
| `live` | `spa-parity`, `live-audit` (EN), `live-audit --lang ru` on 25.12 and 24.10 (`audit-ru`), `motion` (`upstream-contract`, `table-tick`, `floor-contract`, `fit-quiet`, `install-check`) |
| `anchors` | `scroll-anchor --full` and `scroll-jank` on chromium, firefox and webkit |
| `deep` (tag, `workflow_dispatch`) | `live-audit` and `spa-parity` with `--pages-all`, one shard per router |
| `release-assets` (tag only) | the published release resolves to one asset per format per package name (step 3) |

What stays local, beside reading CI:

```sh
npm run changelog
node tools/size-budget.mjs --pin
```

`node tools/size-budget.mjs --pin` runs after the last code fix: a fix landed mid-release once left
the pins stale. The ceilings may also rise between releases, each time with the reason and
the numbers in the commit's changelog entry (the policy: the header of `tools/size-budget.mjs`); the pin here
re-fits them to the build that ships.

`~/go/bin/owfeed lock` must exit 0 at the repo root and in a fresh clone of owfeed-packages. Without
`--update` it only compares and writes nothing (exit 9 and the drift, e.g. `25.12 point release
25.12.5 -> 25.12.6`, when stale). A stale lock in owfeed-packages reds its `check / build` after
the tag, which is where 0.14.15 found it.

And `/security-review` on the diff this release carries, after the last code commit and before the
tag. It is not a gate and cannot be — it reads a diff rather than a tree — which is why it is named
here: the pass is worth the minute on the five things a theme can actually get wrong (the
installer's signature chain, new shell running over a build tree, the unauthenticated login
template, sinks in the browser JS, the packaging pipeline), and a maintainer has asked outright
whether one was done. The command reviews `git diff origin/HEAD...`, which is empty on `main` once
the release commit is pushed (0.14.15 and 0.14.16 shipped seven commits nobody reviewed), so it
runs in a worktree on a commit whose only parent is the previous tag:

```sh
c=$(git commit-tree 'HEAD^{tree}' -p '<prev>^{commit}' -m 'security review <v>') \
  && git worktree add --detach ../tmp/sec-<v> "$c"
# /security-review with ../tmp/sec-<v> as the working directory; verdict -> ../tmp/release-<v>/security.md
git worktree remove ../tmp/sec-<v>
```

Its diff then equals `git diff <prev> HEAD`, deletions included (measured on v0.14.15..v0.14.16:
28 files, +940/-188 both ways).

The guards inside `check`, by the issue that left them:

| Issue | What went wrong | The guard inside `check` |
|---|---|---|
| #3, #8 | theme styles stopped applying on a foreign package's page (filemanager, OpenClash `*{padding:0!important}`) | `chrome-fence` — the fence/pin/dark-guard still match the chrome; `fs-sheets` re-hosts the foreign sheet |
| #5 | the `low`/`medium`/`high` ramp was three aliases of one colour, so "no data" lit up like a live value | `export-tier` (three DIFFERENT colours), `audit --strict` |
| forum 82-83 | the `placeholder` attribute and the unset dropdown row were drawn in the body inks, so an option's DEFAULT read as a value the reader had typed | `placeholder-ink` (a hint is ≥40% light / ≥30% dark of the ink-to-field range away from the value, and still 3:1, with every combination re-run under `prefers-contrast: more`) |
| #6 | localisation ships as separate `luci-i18n-*` packages, and assets sorted by name can be picked instead of the theme | `i18n` (catalogue current and complete); `tools/check-packages.sh` in CI's `build` |
| #9, #11 | config-table row labels and a data-table column vanished or were squeezed | `css-dup` + `mirror` (`@mirror table-card/*`) |
| the ComboButton report | a split button wrapped its arrow under the label in a stacked action cell; the gallery had no such widget, so no gate saw it | `gallery-coverage` — every (widget, container) pair the styles distinguish has a fixture in `docs/gallery.html` |
| 0.14.16 | a ComboButton's open menu was clipped by `overflow: hidden`; three testers "opened" it with `dispatchEvent` and a rect, which cannot see a clip | `table-contract` check 2d — a real click opens every visible `.cbi-dropdown` (a ComboButton on its `> span.open` arrow, which must be visible), `elementFromPoint` at each `li`'s centre returns that `li`, and no ancestor from the dropdown up clips or scrolls |
| all | a rule lost its `!important` or started depending on source order | `css-metrics`, stylelint `selector-max-specificity`, `audit --strict`, `css-orphans` |
| — | the template pre-paint drifted from the live appearance appliers | `axes` |
| — | `[Unreleased]` without a bold lead, or the RU mirror out of sync → an empty release note | `changelog` |

A push does not run `deep`, so before the tag dispatch the workflow on `main` (`gh workflow run
build.yml --ref main`) and read that run too: it is the early stop for the wide gates and the
evidence for the baseline prune below. **`release-assets` runs only on the tag**, so a red one there
costs a fixed commit and a new patch tag.

## Step 3 — asset selection (issue #6), separately and always

This is the most fragile part of every release and the only one that fails silently: the release
notes and the asset choice are evaluated at tag time, in the field, months later.

- **The CI gates**: `build` asserts exactly N assets per format, each package resolving through its
  own **name-anchored** regex `^<name>[-_][^/]*\.EXT$` to exactly one (a `.sig` ends in `.EXT.sig`
  and does not match `\.EXT$`); `release-assets` asks the same of the **published** release.
- **The reader in the field** is `install.sh`, and it never guesses: on a router the feed cannot
  serve it reads the signed `manifest.txt` and matches `$2` against the package name exactly, which
  is what makes a release carrying `luci-theme-footstrap` and two `luci-i18n-footstrap-<lang>`
  packages safe where #6 was not.

Until `release-assets` has been green on a real tag, the by-hand simulation below stays mandatory
(a gate replaces a manual check only once it has run):

```sh
# on a dev router, RELJSON = the release JSON of the intended shape
for EXT in apk ipk; do
  n=$(jsonfilter -i "$RELJSON" -e '@.assets[*].browser_download_url' \
      | grep -Ec "/luci-theme-footstrap[-_][^/]*\.$EXT\$")
  echo "$EXT -> n=$n (must be 0 or 1)"
done
```

## Step 4 — live checks for the areas the diff touched

The wide live gates are CI's `deep` job (step 2). What remains here is the human look at the issues
below, on both releases (25.12/apk and 24.10/opkg), for the areas the diff touched. Compare against
stock bootstrap wherever you are unsure — it is the reference for LuCI behaviour.

**`npm run live -- …` cannot carry flags**: `live` chains eight `npm run` calls with `&&`, and npm
takes the forwarded flags as its own config, so no gate receives them. Call a gate by hand when one
needs re-running locally, on the core stands only (`--only owrt2512,owrt2410,owrtsnap`): the twins
are the same images, kept for parallel measurement (`owlab.yaml`).

**23.05 used to have a line of its own here, and no longer does.** It was the oldest release the
theme claimed and the only one whose `luci-base` was missing a widget the theme uses:
`ui.RangeSlider` arrived in 24.10.3 (backport e4c67020de; 24.10.0-24.10.2 lack it, `install.sh` refuses them), and its absence took the ENTIRE System → Footstrap page down — the panel
is built inside one try/catch, so the miss cost a console line and an empty tab, reported from the
field by a user on 23.05.5 rather than by a gate. Support for that release ended at 0.14.2: it is
EOL, and openwrt/luci declined to carry the compatibility code in the tree the theme now lives in
(#8978). `install.sh` pins that version for a 23.05 router and says it is the last one; the stand
and the contract entry that guarded it are gone with the fallback they guarded.

| Issue | Page | What to look at |
|---|---|---|
| #1 | a third-party app with a wide table, firewall zones | the table stacks into cards, does not overflow its section; the content width does not tear |
| #2 | Podkop → Monitoring, any `<select>` | the dropdown opens, host filtering works |
| #7 | `admin/system/package-manager` | the theme's favicon; buttons do not overlap the inputs; no stray unrounded table border |
| #9 | `admin/network/firewall/forwards`, `/snats` (GridSection) | config-table row labels visible (`.fs-stacked` cards / `@container 960`) |
| #10 | `admin/network/dhcp` (a page with hidden tabs) | no empty scroll below the content |
| #41, #75 | `admin/network/network`, `admin/system/startup` (a page with a tab strip) | switch tabs: the pane the reader LEFT keeps no `min-height`, and the tab they opened starts where the page starts. `floor-contract` asks it automatically — it clicks the strip and reads the inactive panes — because the fault is invisible on a page that is only loaded and, on a page that does not poll, never goes away by itself |
| the iPhone report | `admin/status/overview` on a narrow window, scrolled off the top | the page does not creep upward once per poll tick. `fit-quiet` asks the cause automatically — `#maincontent` may not move in either direction while the chrome measures itself — because the symptom needs an engine with no scroll anchoring and does not reproduce headless |
| #11 | `admin/status/overview` (client list) | the "Network" column is not crushed, rows are not over-wide |
| #17 | the release assets, not a page | `manifest.txt` **and** `manifest.txt.sig` are present; `latest/download/manifest.txt` serves that file; `usign -V` passes with `release.pub`; `awk '$1=="pkg"'` yields one line per format; no install or update path touches `api.github.com`. **The manifest is now load-bearing for installs**, not only for readers: a router the feed cannot serve is installed from it (`install.sh` -> `install_from_release`), so a manifest that does not verify is an install that refuses |

**Why #17 is here and not "CI will catch it".** CI does check it (the `release` job compares the
served `latest/download/manifest.txt` against the built one), but a manifest failure is **invisible
on the page**: the theme looks fine while installation breaks for new users and the update badge
breaks for existing ones — on someone else's router, weeks later. That is exactly the failure shape
this file exists for.

### The stale `live-audit` baseline

A baseline entry no run reproduces is a hole in the ratchet: a regression with that signature
passes silently. Only a full sweep (`--pages-all`) can call an entry stale, so the evidence is
CI's `deep` job, which a push does not run. Before the tag, dispatch the workflow on `main`
(`gh workflow run build.yml --ref main`) and download every `live-audit-seen-deep-*` artifact of
that run, all three routers: a shard that stopped on an unreached or frozen page writes none (one
red only on NEW findings still writes it).

`deep`'s own "N not reproduced on their own stand" is evidence, not the decision: a shard has one
router, so its "M would be dropped" equals N (owrtsnap 48/48, owrt2512 8/8) and says nothing.
Mostly it is an app that stand lacks. The decision is M from a dry run on the core stands with
every deep file (nothing is written; it exits by findings as usual):

```sh
node tools/live-audit.mjs --only owrt2512,owrt2410,owrtsnap --pages-all \
  --seen-in <every live-audit-seen-deep-*.json, comma-separated>
```

It prints "N baseline entr(ies) not reproduced on their own stand; M would be dropped by --update --prune". Prune only
when M is above zero, never from one machine alone — the baseline is a union across platforms
(measured 2026-10-18: N=55-56 across two runs, M=0 with the three deep files, so nothing to prune). Then the same command with
`--update --prune` added; the dropped entries are printed, and the baseline goes into the release
commit.

## The changelog contract

The single source of truth for `CHANGELOG.md` and its Russian mirror `CHANGELOG_ru.md`.

**`npm run changelog` holds the mechanical half**: the set, order and uniqueness of sections, empty
sections, dates, `compare` links, mirror parity (versions, dates, sections, bullet count) and the
mandatory bold lead on `[Unreleased]` and a freshly cut version. It exists because `[Unreleased]`
once accumulated a **duplicate `### Changed`** over several commits: each commit looked fine on its
own, and `release-notes.sh` would have printed two "Changed" groups on the release page with nothing
failing, because the notes are generated at tag time, when the tag is already pushed.

**Everything about the prose below, the gate cannot check.** That part is on you.

### What we chose

- **Base: Keep a Changelog 1.1.0.** Fixed category names and order, `[Unreleased]` on top, newest
  version first, ISO 8601 dates, the file at the repository root.
- **Extensions: `Performance` and `Development`** — a seventh and an eighth category on top of KaC's
  six. Documented, legitimate extensions; `Development` is the one the release page leaves out.
- **Voice: effect-lead** — neither strictly past tense nor strictly imperative:
  `- **one-line effect.** then the reasoning`. A third option, but internally consistent; keep it
  everywhere.
- **Commits follow Conventional Commits** (so the version bump can be derived), but the changelog is
  **written by hand**. Generation from commits yields raw material only.

There are two competing standards and they disagree in three places — the category set, the verb
tense, and whether `[Unreleased]` should exist at all. **This project has already picked Keep a
Changelog on all three.** Do not "correct" entries toward the other standard.

### Categories, in this fixed order

`Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`, `Performance`, `Development`
(`Добавлено`, `Изменено`, `Устарело`, `Удалено`, `Исправлено`, `Безопасность`, `Производительность`,
`Разработка`).

- **One section of each type per release.** Two `### Fixed` under one version is a merge artefact.
- **The order does not follow the order the work was done in.**
- **No empty sections.** No bullets, no heading.
- Not all eight need to be present. A normal release is `Added`/`Changed`/`Fixed`, sometimes
  `Performance`.
- **`Development` is for changes a theme user never sees:** the crew, hooks, gates, CI, tooling, tests
  and agent docs. An entry is user-facing when it changes what a router running the package shows or
  does (`luci-theme-footstrap/**`, `install.sh`, the feed, the published package) and goes under
  `Added`/`Changed`/`Fixed`/…; everything else goes here. A fix to the trust chain a user installs
  through (`install.sh`, the signing keys, `tools/stage-release.sh`, the `release` job, the feed) is
  `Security` even when only CI files change. `tools/release-notes.sh` prints no
  `Development` header and no lead from it, so the release page lists only what the reader can notice,
  while the every-commit rule (below) still gets its entry. A version holding nothing else prints an
  empty body. A change with both halves gets one entry in each section.

### The shape of an entry

```
- **A one-line effect that reads on its own.** Then the reasoning: why, the measurement,
  what the rule protects against.
```

- **The bold lead IS the release note.** `tools/release-notes.sh` extracts only the bold lead of
  each bullet and groups it by section (`Development` excepted). So: the lead is mandatory (a bullet without `**…**` silently
  drops out of the release), and it must be a self-contained sentence, because it appears without
  the reasoning behind it.
- **Write the effect, not the diff.** "Buttons had no focus indicator at all" beats "changed
  `:hover` to `:focus` in `styles/base/70-buttons.css`".
- **Keep the number the change was made for.** "20 KB of font for 227 labels", "312 of 336 elements
  recoloured by a hostile `:root`", "1.69:1 where AA wants 4.5" — the measurement is the difference
  between a changelog and a marketing blurb.
- **Name what the rule protects against** if it is not obvious. Half this theme's invariants exist
  because the obvious alternative was tried and was worse; an entry without the reason invites the
  next person to undo it.
- **Do not cite commits** or retell a file's history. A changelog is not a git log.
- **Edit the existing entry; do not append a second one.**
- **Merge related commits into one entry.**

### `[Unreleased]`

**Every commit writes into `## [Unreleased]` in the same commit as the code**, in both files.
A changelog written afterwards is written from the diff, and the diff is precisely what does not know
why. Documentation, benchmarks, CI and packaging commits count too; only `CLAUDE.md` and a fix to an
entry already written skip it (`.claude/rules/changelog.md`, enforced by `precommit-gate.sh`).

### The bilingual mirror

`CHANGELOG.md` (English) and `CHANGELOG_ru.md` are **edited in one commit**. A mirror that lags is
worse than no mirror: the reader cannot tell which copy is stale. Same section set and order, same
numbers, versions and `compare` links — only the prose may differ, never the facts. The English file
is the primary source for the release-note generator.

### Anti-patterns

A dump of the commit log or the diff; copying a commit or PR verbatim; a partial changelog that
omits `Removed`/`Security`/breaking changes; duplicate sections under one version; an entry written
from the diff after the fact; a self-reference to a commit hash.

## The runbook

Only after everything above has passed. `/release` walks these steps in order. It is model-invoked
on purpose, so "делай тег" lands in this procedure rather than in a bare `git tag` (0.14.15 was
tagged that way, with no security review and before CI on the release sha); the tag itself stays
gated by step 5 below, the `git-guard` hook and the `ask` rule.

1. Rename `[Unreleased]` to `## [x.y.z] — YYYY-MM-DD` in both `CHANGELOG.md` and
   `CHANGELOG_ru.md`, and add the `compare/` link at the bottom of each. Sections in the canonical
   order, every bullet with a `bold lead`.
2. `npm run changelog` — green.
3. Commit that change as `release: x.y.z` and push it to `origin main`; this is part of a release
   the maintainer asked for, so it needs no further word. Message in English, **no AI attribution**.
4. **Before the tag, read the release sha's run and the one before it on `main`**:
   `gh run list --branch main --workflow build.yml --event push -L2` (Build's push runs only: a
   CodeQL or pages run is not the pipeline the tag waits on; no `--status completed`, so the release
   sha's own run shows while it is still going). A run already red before your push
   stays red after it, and `release` does not fire until whatever it currently gates on is green —
   so a tag pushed onto a broken pipeline cannot publish. A pre-existing failure is not something to
   push past: it is either an infrastructure condition to be fixed first, or a real regression that
   has nothing to do with this release but will still hold it. `v0.14.12` was tagged onto exactly
   this: the previous commit on `main` had already failed the same way the day before, on the same
   upstream condition, and nobody looked before the tag went out.
5. **The tag is the maintainer's word, each time**: either their message named it ("tag",
   "делай тег", "release x.y.z") or the session asks, quoting both commands:
   `git tag -a vx.y.z -m vx.y.z`, then `git push origin vx.y.z`, each in its own Bash call, the
   push only after the create exited 0. The tag goes on the release commit, never first — it must
   point at a commit that already contains its own entry, or the release describes a version whose
   changelog does not yet exist.
6. `origin` is the only remote (the `git.vaka.work` mirror was removed on 2026-07-25).
7. CI on `v*` builds both formats, signs them, and builds the release body from the changelog, but
   `release` does not run until whatever it gates on is green, by design — deliberately, so that a
   tag cannot publish a package no router has installed. The consequence is exactly what bit
   `v0.14.12`: any one red leg holds the whole release, including a leg red for a reason that has
   nothing to do with the diff — infrastructure or an upstream feed, not this release's code. **The
   release is not cut until the tag's own run is read, job by job, not merely waited on**:
   `tools/ci-watch.sh --sha <sha>` (detached through `tools/bg.sh`) for the verdict, `gh run view
   <id>` for the job list, `tools/ci-log.sh <id>` for a failing step's decisive lines; say plainly whether the cause is this diff, an infrastructure condition, or an upstream feed. `deep`
   and `release-assets` run here and nowhere before, so this is their first reading. Only then check
   the release carries the expected assets (plus a `.sig` for each): the theme resolving to exactly
   one asset per format, the manifest, the installer, the notes.
8. **Publish the feed, and do not wait on the schedule.** The theme is installed from
   owfeed-packages, so a release nobody can `apk upgrade` into is half a release. There `update.yml`
   runs `land` → `check` → `publish` on a cron GitHub thins to one run every 2-5 h. `check` pushes
   `update/luci-theme-footstrap-<VERSION>` and runs the checks on it; a *later* run's `land`
   fast-forwards `main` onto it once they are green, and the same run's `publish` dispatches
   `publish.yml`. No pull request is opened, so nothing needs approving. On 0.14.14 the branch was
   green 21 minutes after the release and no further scheduled run came for 5.5 h, the feed still
   serving 0.14.13. So once `gh run list --repo owfeed/owfeed-packages --branch
   update/luci-theme-footstrap-<VERSION>` shows the branch's `Check` green, dispatch it yourself:
   `gh workflow run update.yml --repo owfeed/owfeed-packages`, then `gh run watch <id> --repo
   owfeed/owfeed-packages` on that run and on the `publish.yml` run it starts (~1 min to land,
   ~3 min to publish).

   Then read the **served** index rather than the workflow log: `Packages.gz` on
   `https://repo.owfeed.org/releases/24.10/<arch>/` (`Version:` after `Package: luci-theme-footstrap`),
   `apk adbdump` on `releases/25.12/<arch>/packages.adb` from a router or stand (the file is
   compressed, `strings` finds nothing). Confirm the new version is there.

`node tools/changelog.mjs add` recreates `## [Unreleased]` on top with the next substantive commit.

## Sources for the changelog rules

- [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) — primary
- [Common Changelog](https://common-changelog.org/) — primary, and the standard we deliberately
  diverge from
- [Conventional Commits v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) — primary
