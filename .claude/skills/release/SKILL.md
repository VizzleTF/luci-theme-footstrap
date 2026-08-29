---
name: release
description: Cut a footstrap release — the pre-tag matrix, the changelog rename, the tag, and publishing the feed. Use when asked to cut, tag or ship a release, or to check whether a release is ready.
disable-model-invocation: true
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

## 2. The full pre-tag matrix

All four, and every one of them read rather than merely started. The three long ones are T2: start
them detached with `tools/bg.sh` and report the run-ids, then read the logs.

| Must be green | How |
|---|---|
| `npm run check` | one run, exit 0. The static half, 25 gates |
| `owlab test`, **both formats** | two invocations, one per format — never one run with two `--release` flags |
| `npm run live -- --all --pages-all` | every router owlab boots, every page; plus `node tools/upstream-contract.mjs` |
| `/security-review` | on the final branch diff, **before** the tag |

```sh
./tools/stage.sh && owfeed build
owlab test --release 25.12.4 --install 'dist/noarch/luci-theme-footstrap-*.apk' --assert …
owlab test --release 24.10.8 --install 'dist/all/luci-theme-footstrap_*.ipk'   --assert …
```

`--install` is a host-side glob evaluated per router, so `dist/*/…` hands the apk box an ipk as well
and the install fails on both (measured: `0 of 2 routers passed`). The five assertions and the exact
flags: `docs/development.md`. `tools/jsmin-verify.mjs` is not in `check` — CI runs it.

**A release is not cut until every log above has been read.** A detached run nobody opened is not a
green gate, and the tier a check sits in never changes what the release requires.

## 3. Asset selection (issue #6), separately and always

The most fragile part of every release and the only one that fails silently: the notes and the asset
choice are evaluated at tag time, in the field, months later. The `build` job asserts exactly N
assets per format, each resolving through its own name-anchored regex `^<name>[-_][^/]*\.EXT$` to
exactly one. Simulate it against the shape of the coming release — the loop is in
`docs/releasing.md` step 3.

## 4. The runbook

1. Rename `[Unreleased]` to `## [x.y.z] — YYYY-MM-DD` in **both** `CHANGELOG.md` and
   `CHANGELOG_ru.md`, and add the `compare/` link at the bottom of each. Canonical section order,
   every bullet with a bold lead.
2. `npm run changelog` — green.
3. Commit that change. Conventional Commits, English, **no AI attribution**.
4. Tag `vx.y.z` on this commit. **Never tag first.**
5. Push the commit and the tag to `origin` — the only remote.
6. Wait for a green pipeline; check the release carries the expected assets plus a `.sig` for each.
7. **Publish the feed.** The theme installs from owfeed-packages, so a release nobody can
   `apk upgrade` into is half a release. Bump `packages/luci-theme-footstrap/upstream.sh`, check the
   sha256s in the diff against the assets you downloaded, merge, then read the **served** index
   rather than the workflow log: `apk adbdump` on `releases/25.12/<arch>/packages.adb` and
   `Packages.gz` on `releases/24.10/<arch>/`.

Steps 3–5 need an explicit instruction from the maintainer, each time. `git commit` and `git push`
are `ask` in `.claude/settings.json` for exactly this reason.
