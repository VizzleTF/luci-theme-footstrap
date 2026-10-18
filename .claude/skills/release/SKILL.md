---
name: release
description: Cut a footstrap release — the pre-tag matrix, the changelog rename, the tag, and publishing the feed. Use when asked to cut, tag or ship a release, or to check whether a release is ready.
---

# Cutting a release

`docs/releasing.md` is the authority and carries the per-issue table; this is the order and the
things that are easy to skip. **The order is load-bearing** — the tag must point at a commit that
already contains its own changelog entry.

Nothing below is optional because a cheap gate went green. `npm run computed-diff` and
`npm run smoke` are early detectors on a static gallery; they do not stand in for a userland.

## 1. Scope the diff

```sh
git status --short | awk '{print $2}' | sed 's#/.*##' | sort -u
git status --short | grep -E 'styles/|menu-footstrap|\.ut$|fs-sheets|fs-select|fs-fit' \
  || echo 'no CSS / renderer / template / fence changes'
```

The diff touching `styles/`, the renderer, the templates or the fence makes the live check for
issues #1–#5 and #7–#11 mandatory. **Always mandatory regardless of the diff:** the whole automatic
section, plus issue #6 (packaging and asset selection), because #6 breaks at the release level and
nothing fails until a router in the field pulls the update.

## 2. The pre-tag matrix: CI on the release sha, read job by job

The gates run in CI; a local re-run of them on the same sha is not part of a release (67 min,
nine stands, no new information — `docs/releasing.md` step 2). Before the tag:

| Must be green | How |
|---|---|
| CI on the release code's `main` push: `check`, `lint`, `build`, `verify` (apk+ipk), `live` (incl. `audit-ru`), `anchors` (3 engines + `scroll-jank`) | `gh run view <id>`, every job read; a red one gets an owner first |
| `npm run changelog`, `node tools/size-budget.mjs --pin` | locally |
| `/security-review` | on the final branch diff, **before** the tag |
| stale `live-audit` baseline | dispatch the workflow on `main` so `deep` runs; if it reports any, prune with every `live-audit-seen-deep-*` artifact, `docs/releasing.md` "The stale `live-audit` baseline" |

`deep` (`--pages-all`, per router) does not run on a push: dispatch the workflow on `main` and read
it before the tag. `release-assets` runs only on the tag: a red one there is a fix and a new patch
tag. **A release is not cut until every job has been read**, on `main` before the tag and on the tag
after it.

## 3. Asset selection (issue #6), separately and always

The most fragile part of every release and the only one that fails silently: the notes and the asset
choice are evaluated at tag time, in the field, months later. The `build` job asserts exactly N
assets per format, each resolving through its own name-anchored regex `^<name>[-_][^/]*\.EXT$` to
exactly one; `release-assets` asks the same of the published release on the tag. Until that job
has been green on a real tag, also simulate it by hand — the loop is in `docs/releasing.md` step 3.

## 4. The runbook

0. `node tools/size-budget.mjs --pin` — re-pins the size ceiling to this build plus 2 %. The numbers
   in `tools/size-budget.mjs` rise only here; between releases a change that crosses them removes
   something instead, and a re-pin down is allowed when a refactor shrinks the build. Goes into the same commit as the rename below.
1. Rename `[Unreleased]` to `## [x.y.z] — YYYY-MM-DD` in **both** `CHANGELOG.md` and
   `CHANGELOG_ru.md`, and add the `compare/` link at the bottom of each. Canonical section order,
   every bullet with a bold lead.
2. `npm run changelog` — green.
3. Commit that change. Conventional Commits, English, **no AI attribution**.
4. Tag `vx.y.z` on this commit. **Never tag first.**
5. **Before pushing, read the recent runs on `main`**: `gh run list --limit 6` (on the maintainer's
   Windows machine `gh` is not on `PATH` in Git Bash or WSL — call it by its full path,
   `"/c/Program Files/GitHub CLI/gh.exe" run list --limit 6`). A run already red before your push is
   still red after it, and `release` does not fire until whatever it currently gates on is green: a
   tag pushed onto a broken pipeline cannot publish. A pre-existing failure needs an owner before you
   tag — either an infrastructure condition to fix first, or a real regression that has nothing to
   do with this release but will still hold it.
6. Push the commit and the tag to `origin` — the only remote.
7. **The release is not cut until the tag's own run is read, job by job** — not "wait for green".
   `gh run view <id>` for the job list, `gh run view --job <id> --log-failed` for the failing
   step's log; say whether a red job is the diff, infrastructure, or an upstream feed. Then check
   the release carries the expected assets plus a `.sig` for each.
8. **Publish the feed.** The theme installs from owfeed-packages, so a release nobody can
   `apk upgrade` into is half a release. Bump `packages/luci-theme-footstrap/upstream.sh`, check the
   sha256s in the diff against the assets you downloaded, merge, then read the **served** index
   rather than the workflow log: `apk adbdump` on `releases/25.12/<arch>/packages.adb` and
   `Packages.gz` on `releases/24.10/<arch>/`.

Steps 3, 4 and 6 need an explicit instruction from the maintainer, each time. `git commit` and
`git push` are `ask` in `.claude/settings.json` for exactly this reason.
