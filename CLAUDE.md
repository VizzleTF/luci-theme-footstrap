# CLAUDE.md

`luci-theme-footstrap` — a LuCI theme for **OpenWrt 24.10 and newer** (and ImmortalWrt). Standalone:
it ships no framework and depends on nothing but `luci-base`. Page content is rendered client-side
by app view-JS, so the theme is server chrome (`ucode/template/themes/footstrap/*.ut`) + one
generated `cascade.css` + `fs-*.js` in `htdocs/luci-static/resources/`.

**Communicate in Russian.** Code, comments, commit messages and PR text stay in English.

`styles/base/` began as a fork of `luci-theme-bootstrap`'s cascade.css and is footstrap's code now:
**do not call it "the fork" or reintroduce the word bootstrap** into filenames, comments or docs.
That name is legitimate only for the *other, real* package — the `/luci-static/bootstrap` fallback
in `uci-defaults`, the `bench/` baseline, and the Apache-2.0 attribution in `styles/00-header.css`.

## Read the doc first

`docs/` is the reference and every page carries the measurement behind each rule. This file is the
index plus the rules that are easy to break — do not re-derive what a doc already settled.

| Touching | Read |
|---|---|
| what LuCI expects of a theme, where the boundary runs | `docs/architecture.md` |
| the rule list with the gate that holds each one | `docs/conventions.md` |
| dev routers, pushing a change, proving it | `docs/development.md` |
| `styles/`, cascade layers, `build-css.sh`, `@mirror` | `docs/css.md` |
| tokens, palettes, type, the Appearance axes | `docs/design-system.md` |
| sidebar / bar / rail, the menu renderer, the fit | `docs/chrome.md` |
| client navigation | `docs/spa-router.md` |
| foreign `luci-app-*`, the fence | `docs/third-party-apps.md` |
| Makefile, uci-defaults, postinst/postrm, ACL | `docs/package.md` |
| CI job graph, owfeed, packaging, the trust chain | `docs/ci.md` |
| pre-release checklist, changelog contract, runbook | `docs/releasing.md` |
| the navigation benchmark | `docs/benchmark.md` |

`docs/luci-app-styling-guide.md` (+ `_ru`) is outward-facing, for authors of other packages.
`docs/gallery.html` renders every widget LuCI or any app can emit — it is what `a11y` and
`export-tier` measure, and how the theme is checked without a router.

**Repo root is the workspace** (`package.json` gates, `tools/`, `docs/`, `owlab.yaml`,
`install.sh`); the shipped package is `luci-theme-footstrap/` one level down — same name, one level
apart, so a path is ambiguous unless it is absolute or rooted. Nothing in the root ships, and the
OpenWrt buildbot has no node.

**Work from the repo root, not from its parent.** The checkout's parent holds `luci-fork/` (the
openwrt/luci copy, see below) and `tmp/` and is not a git repository — a session started there
loads none of this file, and `owlab` exits with `no owlab.yaml found`.

## Commands

```sh
npm run check                              # every gate, one run; must exit 0 before pushing
owlab up | owlab sync --watch | owlab open owrt2512
./tools/stage.sh && owfeed build           # both formats into dist/
owlab test --release 25.12.4 --install 'dist/noarch/luci-theme-footstrap-*.apk' --assert …
ucode -T -c -o /dev/null <template>.ut     # syntax-check a template the way LuCI does
luci-theme-footstrap/dev-sync.sh <host>    # deploy to a HARDWARE router over ssh
./tools/sync-luci-fork.sh ../luci-fork     # regenerate the openwrt/luci copy
```

There is no unit-test suite and nothing to run "a single test": `npm run check` is the whole
static half, and the other half is a page on a live userland (`owlab`, or a hardware router).

One gate directly: `node tools/<name>.mjs`. Two run in CI only: `tools/jsmin-verify.mjs` (needs a
jsmin built from `luci-upstream.pin`) and `ucode -T -c` over every template, which the `verify`
containers run against the installed theme. Two `owlab test` invocations, one per format —
`--install` is a host-side glob evaluated per router, and the fifth assertion is that same template
compile.

## Rules that are easy to break

### Verifying
- **Every gate is static; not one opens a page.** A behaviour change is not finished until it has
  run on a real userland on **both** package managers (25.12/apk and 24.10/opkg). A stubbed node
  harness proves a module initialises, nothing more — say which of the two you did.
- **Prove a CSS change with a computed-style diff, not screenshots.** Live counters move 0.5–1.3% of
  pixels between two runs of the *same* sheet while a real regression weighs 0.19%.
- Screenshots and any other scratch artefact go in `../tmp/`, never inside the checkout.

### CSS
- **`htdocs/luci-static/footstrap/cascade.css` is generated — never edit it.** Source is `styles/`.
- Layer order `tokens, base, theme, page`, one directory per layer, filename prefix = source order.
  A later layer beats an earlier one regardless of specificity, so a theme rule never needs
  `!important` to outrank base.
- **Read the private `--fs-*` tier only.** The `--*-color-*` export tier is defined from it and read
  by nobody inside `styles/` (`audit --strict` fails). A hostile `:root` recoloured 312 of 336
  gallery elements before the split, 0 after.
- **`!important` is a gated allowlist and inverts layer order.** A flag must fight an inline
  `style=` or an app's unlayered rule; one that beats another footstrap rule means the rule is in
  the wrong layer. `theme/95-a11y-media.css` is the one sanctioned exception.
- **Edit the rule that already styles the selector** — never append a second one. **Win on
  specificity, never on source order.**
- **Coverage is a contract.** Never delete a selector because no stock page renders it — some
  third-party app emits it. `css-orphans` is the only safe dead-CSS search, and only because `fs-*`
  is ours alone.
- **No colour literals** (`--fs-scrim` excepted); a tint of X is mixed **from** X. Never reintroduce
  a component bridge (`--*-rgb`, `--*-hsl`).
- **Merge a duplicate or pin it in `@mirror`.** An unpinned duplicate is a hard failure, and so is a
  `@mirror` group with one copy.
- **`styles/base/` is editable**, but prefer the matching `styles/theme/` file, and justify any base
  edit that changes output with a near-empty computed diff.
- **No bold mono**: `<strong>` is a LABEL and must be *assigned* the sans face — excluding it from
  the mono rule changes nothing, since it still inherits.

### JS
- One concern per module; `L.require` makes a singleton and throws `DependencyError` on a cycle, so
  a module can never `extend` another — compose by calling.
- **All "does it fit" logic lives in `fs-fit.js`.** Measure uncollapsed, re-fit synchronously on a
  mutation, coalesce on resize. `data-narrow` — not a viewport media query — is the single source of
  "the sidebar became a bar", and the widths are read from the CSS tokens with `getComputedStyle`,
  never copied into JS.
- **Never put a regex literal straight after `return` or `=>`** — jsmin eats the rest of the file
  and **exits 0**. Wrap it: `return (/^https?:\/\//i.test(a));`. No backtick inside a `${…}`.
- **Require a stock class through `window.L`** (`const RT = window.L; RT.require(name)`) — the `L` a
  factory receives has no `ui` helpers, and `require()` caches the first requirer's binding.
- **`FS_VERSION` stays in `fs-version.js` at that path** — the Makefile, `dev-sync.sh` and
  `tools/stage.sh` sed it by path; moving it makes every release report "(dev)".
- **The theme never checks for its own updates and never reaches a third-party host at run time.**
  Upgrades are the package manager's job (the installer adds the feed). `fs-router` exports
  `onNavigate(fn)` so an optional module can register itself without the router naming anyone —
  keep that seam inverted, but do not re-add an updater behind it.
- Comments are stripped at package time and git keeps every word — **never trade a "why" away for
  bytes**. A stale comment is worse than none.

### The chrome, and sharing a document with third-party apps
- **One theme entry, one template dir, one renderer.** Layout is a **client** axis
  (`:root[data-layout]`, always an explicit value) — never write a `:not([data-layout=…])` guard and
  never add a second renderer. The bar is the base; the vertical sidebar is one guarded override
  that wins on specificity.
- Three zones: **ours** (`fs-*`, `--fs-*`, `[data-fs-chrome]`), **shared LuCI** (`.cbi-*`, `#view` —
  where an app is *entitled* to win on specificity), **theirs**. Check who owns a name before
  "fixing" a collision: `.left`/`.right`/`.center` and `ul.nav` are LuCI's.
- The chrome is defended by **not matching**: the mark in `header.ut`, the fence in `fs-sheets.js`,
  the pin in `theme/10-chrome.css` (inherited properties, roots alone). `npm run chrome-fence`
  derives the mark from the markup and compares whole canonical strings — a token-wise check once
  passed on a fence that was the exact inverse of one.
- **A view's CSS is never deleted** — a sheet imported at module eval never comes back. An invasive
  sheet makes the next navigation a full load instead; only a byte-identical duplicate may be
  dropped.
- Every Appearance axis is implemented twice (pre-paint in `partials/head.ut`, live in
  `fs-prefs.js`) and **the custom property is set BEFORE the attribute** — reversed, a reload paints
  one frame in the previous hue. `npm run axes` derives the contract from the JS.

### Package and release
- **`+luci-base` is the whole dependency list and keeping it that way is a constraint.** `curl` is
  not in OpenWrt's default set — fall back to `uclient-fetch` instead of adding a dep.
- **The catalogue lives in `po/`** — what `LUCI_LANGUAGES` globs and what Weblate translates.
  luci.mk emits the per-language packages; nothing in `Build/Prepare` compiles a catalogue. It was
  `i18n/` while a fielded self-updater mis-picked a multi-asset release with `head -1` (issue #6);
  owfeed now builds exactly one theme artifact per format regardless, which `tools/check-packages.sh`
  still asserts in CI's build job.
- Anything under `root/etc/config/` MUST be in the `conffiles` define (`npm run conffiles`) — else
  the manager replaces it on upgrade and the theme's own Update wipes the admin's saved defaults,
  reporting success.
- `postinst`/`postrm` use **`rpcd reload`, never `restart`** — restart logs out every LuCI session.
- A malformed `acl.d/*.json` is skipped by rpcd **silently**, so the grant goes to nobody and only
  Save-as-default and the background upload break, on someone else's router (`npm run acl`).
- `root/etc/uci-defaults/30_luci-theme-footstrap` is the single source of registration; fresh
  install vs upgrade is the marker file `/usr/share/luci-theme-footstrap/.installed`, and **an
  upgrade must never change the active theme** (`$PKG_UPGRADE` is dead — apk never exports it).
- Do not set `PKG_VERSION` (git-derived). `LUCI_MINIFY_CSS:=0` — csstidy mangles `:has()` and
  `color-mix()`.
- **The luci fork branch is ONE commit, amended — never a second commit on top.**
  `tools/sync-luci-fork.sh ../luci-fork` regenerates the copy (that tree gets the built
  `cascade.css`, `styles/` does not travel — `docs/package.md`), then `git commit --amend` reading
  the author, the **author date** and the `Signed-off-by` trailer back off `HEAD`, then
  `git push --force-with-lease`. Upstream reviews one patch: a follow-up commit, a rewritten author
  or a lost sign-off turns the proposal into a series that has to be squashed by hand.
- **A release is not finished when the tag pipeline is green** — the theme installs from
  owfeed-packages, so it also has to reach the feed: bump `packages/luci-theme-footstrap/upstream.sh`
  (the bot opens that PR for some releases and not others), check the sha256s in the diff against
  the release assets you downloaded, merge, and then read the **served** index rather than the
  workflow log — `apk adbdump` on `releases/25.12/<arch>/packages.adb` and `Packages.gz` on
  `releases/24.10/<arch>/`.
- **The trust chain fails closed**: a verified TLS channel (never `-k`, never as a retry), an
  ed25519 `usign` signature, then GitHub's sha256. The signature is the link that holds — GitHub
  *computes* the asset digest, so a swapped asset passes the checksum. A missing digest, `.sig` or
  usign is a refusal, not a downgrade.
- A `_()` with no catalogue renders silently in English: run `luci-theme-footstrap/update-po.sh`
  after touching any `_()`. A msgid is a **global** name shared with every app — Appearance labels
  carry the `footstrap` msgctxt; the chrome, the login/notice sentences and the
  System/Memory/Storage titles deliberately do not.

## Commits and the changelog

- **Conventional Commits, message in English. Never commit without an explicit instruction.** No
  co-author / "Generated with" / AI attribution trailers. `origin` is the only remote.
- **NO COMMIT LANDS WITHOUT ITS CHANGELOG ENTRY.** It goes under `## [Unreleased]`, in the **same
  commit as the code**, and in **BOTH `CHANGELOG.md` AND `CHANGELOG_ru.md`** — never one now and
  its mirror later. An entry written afterwards is written from the diff, and the diff is exactly
  what does not know why. This covers documentation, benchmarks, CI and packaging too, not just
  code: if the commit is worth making, it is worth one line saying what changed. The only things
  that skip it are this file and a fix to an `[Unreleased]` entry already written.
  `npm run changelog` fails on a mismatch between the two files, so a missing mirror is a red gate,
  not a note for later.
- Sections are `Added / Changed / Deprecated / Removed / Fixed / Security / Performance`, one of
  each per version, in that fixed order — append into the section that already exists in its
  canonical slot, never add a second `### Changed` on top.
- Each entry is `- **one-line effect.** then the rationale`. The bold lead **is** the release note
  (`release-notes.sh` emits leads only), so it must read on its own — **a bullet with no bold lead
  is silently dropped from the release**. Write the effect, not the diff; keep the measurement.
- Cutting a release: `docs/releasing.md`, and the order is load-bearing — checklist, rename the
  heading and add the compare link in both files, `npm run changelog`, commit, **then** tag that
  commit.
