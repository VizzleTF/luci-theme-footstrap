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
git status --short | awk '{print $2}' | sed 's#/.*##' | sort -u
git status --short | grep -E 'styles/|menu-footstrap|\.ut$|fs-sheets|fs-select|fs-fit' \
  || echo 'no CSS / renderer / template / fence changes'
```

- The diff does not touch `styles/`, the renderer, the templates or the fence → the visual and
  fence issues (#1–#5, #7–#11) cannot regress from it. Their gates being green is enough; a live run
  is allowed but not required.
- The diff touches the matching area → the live check for those issues is mandatory.

**Always mandatory regardless of the diff:** the whole automatic section, plus issue #6 (packaging
and asset selection) — because #6 breaks at the release level rather than in the code, and
nothing fails until a router in the field pulls the update.

## Step 2 — the automatic gates

One run closes most of the guards. It must exit 0.

```sh
npm run check
```

| Issue | What went wrong | The guard inside `check` |
|---|---|---|
| #3, #8 | theme styles stopped applying on a foreign package's page (filemanager, OpenClash `*{padding:0!important}`) | `chrome-fence` — the fence/pin/dark-guard still match the chrome; `fs-sheets` re-hosts the foreign sheet |
| #5 | the `low`/`medium`/`high` ramp was three aliases of one colour, so "no data" lit up like a live value | `export-tier` (three DIFFERENT colours), `audit --strict` |
| #6 | localisation as separate `luci-i18n-*` packages, so the then-shipped self-updater pulled a catalogue instead of the theme | `i18n` (catalogue current and complete); `tools/check-packages.sh` asserts exactly one theme package per format, but runs in CI's build job rather than inside `check` |
| #9, #11 | config-table row labels and a data-table column vanished or were squeezed | `css-dup` + `mirror` (`@mirror table-card/*`) |
| all | a rule lost its `!important` or started depending on source order | `css-metrics`, `audit --strict`, `css-orphans` |
| — | the template pre-paint drifted from the live appearance appliers | `axes` |
| — | `[Unreleased]` without a bold lead, or the RU mirror out of sync → an empty release note | `changelog` |

`tools/jsmin-verify.mjs` is not in `check` (it needs a jsmin binary built from the pin) — CI runs
it. Locally the cause is covered by eslint's `wrap-regex`, inside `lint`.

## Step 3 — asset selection (issue #6), separately and always

This is the most fragile part of every release and the only one that fails silently: the release
notes and the asset choice are evaluated at tag time, in the field, months later.

- **The CI gate** (`build` job): exactly N assets per format, each package resolving through its own
  **name-anchored** regex `^<name>[-_][^/]*\.EXT$` to exactly one. A `.sig` ends in `.EXT.sig` and
  does not match `\.EXT$`.
- **The reader in the field** is nobody now — `install.sh` installs from the feed and never picks
  an asset — but the release must still resolve to one file per format, for a by-hand install and
  for the Pages mirror. Simulate it against the shape of the coming release:

```sh
# on a dev router, RELJSON = the release JSON of the intended shape
for EXT in apk ipk; do
  n=$(jsonfilter -i "$RELJSON" -e '@.assets[*].browser_download_url' \
      | grep -Ec "/luci-theme-footstrap[-_][^/]*\.$EXT\$")
  echo "$EXT -> n=$n (must be 0 or 1)"
done
```

## Step 4 — live checks for the areas the diff touched

Run on both releases (25.12/apk and 24.10/opkg). Compare against stock bootstrap wherever
you are unsure — it is the reference for LuCI behaviour.

| Issue | Page | What to look at |
|---|---|---|
| #1 | a third-party app with a wide table, firewall zones | the table stacks into cards, does not overflow its section; the content width does not tear |
| #2 | Podkop → Monitoring, any `<select>` | the dropdown opens, host filtering works |
| #7 | `admin/system/package-manager` | the theme's favicon; buttons do not overlap the inputs; no stray unrounded table border |
| #9 | `admin/network/firewall/forwards`, `/snats` (GridSection) | config-table row labels visible (`.fs-stacked` cards / `@container 960`) |
| #10 | `admin/network/dhcp` (a page with hidden tabs) | no empty scroll below the content |
| #11 | `admin/status/overview` (client list) | the "Network" column is not crushed, rows are not over-wide |
| #17 | the release assets, not a page | `manifest.txt` **and** `manifest.txt.sig` are present; `latest/download/manifest.txt` serves that file; `usign -V` passes with `release.pub`; `awk '$1=="pkg"'` yields one line per format; no install or update path touches `api.github.com`. **The manifest is now load-bearing for installs**, not only for readers: a router the feed cannot serve is installed from it (`install.sh` -> `install_from_release`), so a manifest that does not verify is an install that refuses |

**Why #17 is here and not "CI will catch it".** CI does check it (the `release` job compares the
served `latest/download/manifest.txt` against the built one), but a manifest failure is **invisible
on the page**: the theme looks fine while installation breaks for new users and the update badge
breaks for existing ones — on someone else's router, weeks later. That is exactly the failure shape
this file exists for.

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
- **Extension: `Performance`** — a seventh category on top of KaC's six. A documented, legitimate
  extension.
- **Voice: effect-lead** — neither strictly past tense nor strictly imperative:
  `- **one-line effect.** then the reasoning`. A third option, but internally consistent; keep it
  everywhere.
- **Commits follow Conventional Commits** (so the version bump can be derived), but the changelog is
  **written by hand**. Generation from commits yields raw material only.

There are two competing standards and they disagree in three places — the category set, the verb
tense, and whether `[Unreleased]` should exist at all. **This project has already picked Keep a
Changelog on all three.** Do not "correct" entries toward the other standard.

### Categories, in this fixed order

`Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`, `Performance`.

- **One section of each type per release.** Two `### Fixed` under one version is a merge artefact.
- **The order does not follow the order the work was done in.**
- **No empty sections.** No bullets, no heading.
- Not all seven need to be present. A normal release is `Added`/`Changed`/`Fixed`, sometimes
  `Performance`.

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

**Every substantive commit writes into `## [Unreleased]` in the same commit as the code.** A
changelog written afterwards is written from the diff, and the diff is precisely what does not know
why. Commits that change nothing for a user or a maintainer (a typo in a comment, a CI-only
refactor) need no entry; when in doubt, write one.

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

Only after everything above has passed:

1. Rename `[Unreleased]` to `## [x.y.z] — YYYY-MM-DD` in both `CHANGELOG.md` and
   `CHANGELOG_ru.md`, and add the `compare/` link at the bottom of each. Sections in the canonical
   order, every bullet with a `bold lead`.
2. `npm run changelog` — green.
3. Commit that change. Message in English, Conventional Commits, **no AI attribution**.
4. Tag `vx.y.z` on this commit. **Never tag first** — the tag must point at a commit that
   already contains its own entry, or the release describes a version whose changelog does not yet
   exist.
5. Push the commit and the tag to `origin` — the only remote (the `git.vaka.work` mirror was removed
   on 2026-07-25).
6. CI on `v*` builds both formats, signs them, and builds the release body from the changelog. Wait
   for a green pipeline and check the release carries the expected assets (plus a `.sig` for each):
   the theme resolving to exactly one asset per format, the manifest, the installer, the notes.
7. **Publish the feed.** The theme is installed from owfeed-packages, so a release nobody can
   `apk upgrade` into is half a release. Merge the version bump against
   [owfeed-packages](https://github.com/owfeed/owfeed-packages) — its bot opens one for some
   releases, and where it does not, open it by hand.

A fresh empty `## [Unreleased]` comes back on top with the next substantive commit.

## Sources for the changelog rules

- [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) — primary
- [Common Changelog](https://common-changelog.org/) — primary, and the standard we deliberately
  diverge from
- [Conventional Commits v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) — primary
