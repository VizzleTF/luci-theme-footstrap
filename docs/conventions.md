# Conventions

The rules a change to this theme has to follow. Read this before your first patch. The most
important rule: a change that alters behaviour is not finished until it has run on a real OpenWrt
router, on both 25.12/apk and 24.10/opkg.

For what the theme *is*, start at [architecture.md](architecture.md).

MUST and MUST NOT mark a required rule. Each rule ends with a "Checked by:" line: a tool, a CI
job, or review when nothing automated checks it.

## Short version

1. Run every behaviour change on owlab routers, 25.12/apk and 24.10/opkg, and say which ran.
2. CSS reads only `--fs-*`, wins by layer and specificity, and has no colour literals outside the
   palettes.
3. Never put a regex literal straight after `return` or `=>`: jsmin eats the rest of the file and
   exits 0.
4. Require a stock class through `window.L`.
5. A comment carries the invariant, the reason as a number and one pointer. A shipped file uses no
   `tools/` or `issue #N` pointer.
6. Strings on System → Footstrap take the `'footstrap'` context; chrome strings take none.
7. One `luci.themes` entry, no `rpcd reload`, every shipped `/etc/config/*` a declared conffile.

## Contents

- [The check](#the-check)
- [Before review](#before-review)
- [V. Verify on a router](#v-verify-on-a-router)
- [Writing CSS](#writing-css)
- [Writing JS](#writing-js)
- [Comments](#comments)
- [Templates and translation](#templates-and-translation)
- [Package and registration](#package-and-registration)
- [The trust chain](#the-trust-chain)
- [Changelog and release](#changelog-and-release)

## The check

```sh
owlab up owrt2512
node tools/e2e.mjs --router owrt2512 --old <release pkg> --new <built pkg>
```

Then run the same again on `owrt2410` with the `.ipk` pair. That covers 25.12/apk and 24.10/opkg.

Without `--no-anchor`, `tools/e2e.mjs` also runs `tools/anchor-check.mjs` itself. To run the
anchoring check alone, on a router with footstrap active:

```sh
node tools/anchor-check.mjs --router owrt2512
```

CI splits the two into jobs, each on both routers:

| CI job | Runs |
|---|---|
| `e2e` | `tools/e2e.mjs --no-anchor` |
| `anchor` | `tools/anchor-check.mjs` |

What the check walks through is in [verifying.md](verifying.md).

No npm package is installed on a router. The release build (`tools/stage.sh`) runs uglify-js and
acorn over the shipped JS and templates. `luci.mk` copies `htdocs/` and `ucode/` verbatim and never
invokes node, and the OpenWrt buildbot has no node at all.

## Before review

Run what a tool checks, then go through what only review checks.

| Rules | Checked by | Command |
|---|---|---|
| V-2, P-1, P-6, removal leaves no files | `tools/e2e.mjs`, CI's `e2e` | `node tools/e2e.mjs --router <ROUTER> --old <release pkg> --new <built pkg>` on `owrt2512` and `owrt2410` |
| scroll anchoring | `tools/anchor-check.mjs`, CI's `anchor` | `node tools/anchor-check.mjs --router <ROUTER>` |
| shipped-file comment pointers | `tools/sync-luci-fork.sh` | `tools/sync-luci-fork.sh <path-to-luci>` |
| build refusals (`strip-build.sh`), P-8 labels | `tools/stage.sh` | `./tools/stage.sh` |
| template comment shape | `ucode -T -c` | on a running stand (`owlab exec`) |
| a `#` line in an `ssh "$R" "…"` string | `sh -n` | `sh -n <file>` |
| P-7 | CI's build job | CI only |

Review only:

- [ ] V-3, V-4: the PR says which router each run covered, or that a run could not happen.
- [ ] CSS-1 to CSS-10: tiers, layers, specificity, colours, zones, coverage, duplicates, table
      roles, flex minimums.
- [ ] JS-1 to JS-8.
- [ ] Comments: size limits and the rules that hold regardless of size.
- [ ] T-1, T-2, P-2 to P-5, P-9.
- [ ] A file written at runtime outside `/etc/config` that must survive a sysupgrade is listed in
      `root/lib/upgrade/keep.d/luci-theme-footstrap` ([package.md](package.md#adding-a-file)).
- [ ] R-1: a user-visible change has an entry under `## [Unreleased]` in both `CHANGELOG.md` and
      `CHANGELOG_ru.md`.

## V. Verify on a router

### V-1. owlab MUST stay installed

Why: owlab is required, not a convenience. Install it once and keep it:

```sh
go install owfeed.org/owlab/cmd/owlab@latest
owlab doctor
```

Checked by: review.

### V-2. A change that alters behaviour MUST run on a real OpenWrt userland, on both package managers

The two are 25.12/apk and 24.10/opkg. Not "it should work": run it.

Why: reading the source cannot see sessions, pollers, rendered templates, install paths or apk/opkg
differences. Only a router can.

`owlab up` gives you the disposable routers `owlab.yaml` defines. `tools/e2e.mjs` against them is
the local form of CI's `e2e` and `anchor` jobs. How: [development.md](development.md).

Checked by: `tools/e2e.mjs` locally and CI's `e2e` and `anchor` jobs on both routers. That the
run happened before the change is called finished is review.

### V-3. A report MUST say which router a run covered

Why: one router does not stand in for the other.

Checked by: review.

### V-4. If you cannot run it, the commit or the PR MUST say so

For example, there is no Docker on the machine, or owlab is not installed.

1. Do not report the change as verified.
2. In the commit or the PR, say which router did not run and why.
3. Treat the change as not finished, per V-2, until someone runs it on both routers.

Why: an untested change described as tested is worse than an untested change.

Checked by: review.

## Writing CSS

In short: read only `--fs-*`, win by layer and then specificity, stay inside your zone, and keep
styling selectors some app may emit.

### CSS-1. Every rule in `styles/` MUST read only the private tier, `--fs-*`

The export names (`--primary-color-high`, `--text-color-*`, …) are defined *from* the private tier
and are for third-party apps only.

```css
color: var(--fs-dim);                                    /* yes */
color: var(--text-color-medium);                         /* no */
```

Why: `:root` is one shared scope, and every `luci-app-*` puts its CSS in the same document. Either
way an app's `:root` would recolour the theme:

- a sheet pinned to the app's own names stays **unlayered**, which outranks any `@layer`;
- `fs-sheets.js` moves any other sheet into `@layer theme`, which still outranks `tokens`.

The two tiers are in [design-system.md](design-system.md).

Checked by: review.

### CSS-2. A rule MUST go in the right layer instead of reaching for `!important`

Layer order is `tokens, base, theme, page`. A later layer beats an earlier one regardless of
specificity. So a `theme` rule never needs a flag to beat `base`.

`!important` inverts layer order. The mechanics and the numbers behind that are in
[css.md](css.md). Two consequences for a patch:

- If a rule needs a flag to beat another footstrap rule, the rule is in the wrong layer. Move it or
  merge the two.
- A legitimate flag fights only what layers cannot outrank: inline `style=` and unlayered rules
  injected by an app.

The one flag sanctioned against *our own* rules is `theme/95-a11y-media.css`.
`prefers-reduced-motion` has to kill animations declared in `base` too, and only an important
declaration reaches back a layer. The same file carries the forced-colors focus outline, for the
same reason.

Every other file with a flag fights something outside the cascade:

| File | What its flag fights |
|---|---|
| `theme/90-responsive` | the unlayered sheet `package-manager.js` injects, and the inline `display:none` it writes on the pager rows |
| `pages/20-overview` | a `style=` written by `29_ports.js` |
| `theme/45-misc` | widens the box the realtime graphs size inline, and repaints its inline black border |
| `theme/65-dropdown` | pins the open list's `inset-inline` over `ui.js`'s inline left/right; frees `.hide-close` from a RichListValue's inline `min-width:25vw` |
| `theme/30-tables` | holds `word-break: normal` against `processes.js`'s inline `word-break: break-word` and luci-mod-dashboard's unlayered `word-break: break-all`; holds two carded-cell `flex` widths against that same unlayered sheet's `flex: 2 2 10%` |
| `styles/base` | the six `.left`/`.right`/… forcing utilities, `[hidden]` in `10-reset`, and two inline-style fighters in `95-luci` |

A flag outside these files belongs in another layer; it does not get a new entry here.

Checked by: review; nothing checks this list.

### CSS-3. A rule MUST win on specificity, never on source order

Why: two rules with the same specificity where the later one is load-bearing is the same failure as
220 `!important`, only quieter.

The cap is `[1,7,0]`. It is a convention. Why that value: it is the widest selector the theme needs.
The rail's paused poll glyph sits there, since the vertical sidebar's guard gained
`:not([data-narrow])`.

Checked by: review; nothing checks the cap.

### CSS-4. Edit the rule that already styles the selector

Do not append a second one.

Why: a second rule for the same selector wins only by source order. That is the failure CSS-3
names.

Checked by: review.

### CSS-5. No colour literals outside the palettes

Why: a `#hex` follows neither the palette nor dark mode. The exceptions:

- `--fs-scrim`: black at .7 is the absence of light behind a dialog, not a shade of any token;
- the logo ring in `theme/10-chrome.css`, which flips with mode like the favicon SVG;
- the paper palette in `theme/97-print.css`.

Checked by: review.

### CSS-6. Stay inside your zone

There are three zones:

| Zone | Who owns it |
|---|---|
| 1. The theme's own chrome (`fs-*` names, `data-fs-chrome` roots) | ours alone, and fenced against foreign CSS. The fence is in [third-party-apps.md](third-party-apps.md) |
| 2. The shared LuCI widget surface (`cbi-*`, `.table`, `.alert-message`) | ours to style, nobody's to own |
| 3. Another package's namespace | the theme never reaches into it |

No theme file goes into another package's directory. An example is `luci-mod-status`'s include
directory, where LuCI evaluates every `*.js` under any theme.

Checked by: review.

### CSS-7. Coverage is a contract: a selector no stock page renders still gets styled

Why: some third-party `luci-app-*` emits it. "Looks unused, delete it" un-styles somebody's app.

PurgeCSS, uncss and any coverage-based trimming are forbidden here.

The one safe dead-CSS search is for `fs-*` selectors. It is safe only because nothing outside the
theme can emit an `fs-*` class.

Checked by: review.

### CSS-8. Merge a duplicate where CSS allows

Why: identical declaration bodies under mutually exclusive guards are the shape that drifts. Once
the copies diverge they no longer look like duplicates at all.

Checked by: review.

### CSS-9. A `display` rule on a table class needs a matching role

The classes are `.table`/`.thead`/`.tbody`/`.tfoot`/`.tr`/`.th`/`.td`.

Why: a `display` other than `table`/`table-row`/`table-cell`/… drops the implicit
`table`/`row`/`cell` role HTML-AAM derives from it (WCAG 1.3.1). `fs-select.js`'s role map puts it
back.

Both directions hold:

- the role map does not shrink;
- a theme selector does not set `display` on one of these classes without a matching entry in the
  map.

Checked by: review.

### CSS-10. Before styling a flex item, name which minimum-size behaviour it needs

**A flex item's automatic minimum size defaults to its CONTENT size, and `overflow` is what zeroes
it.**

Every flex item has the *automatic minimum size*. With no explicit `min-width` (row axis) or
`min-height` (column axis), it resolves to the item's min-content box. If the item's own `overflow`
is anything other than `visible`, the automatic minimum drops to zero (CSS Flexbox §4.5).

| Item | Wants |
|---|---|
| a button that must shrink | `overflow: hidden`, or an explicit `min-width: 0`, to reach zero |
| a label or a pill that must clip while holding its own width | the overflow property paired with an explicit `min-width`/`max-width` that is not `auto`; the automatic minimum then never gets a vote |

The third shape is invisible on a page: an inert `text-overflow: ellipsis`. It produces no overflow
at all, because the box it sits on was never given room to shrink. Nothing measures a clip rule
that never fires.

Checked by: review.

## Writing JS

### JS-1. A regex literal MUST NOT come straight after `return` or `=>`

`luci.mk` runs `jsmin` on the buildbot. It decides whether `/` opens a regex or divides by looking
at one preceding character. Neither `n` (from `return`) nor `>` (from `=>`) is in its list:

```js
return /^https?:\/\//i.test(a);      /* jsmin reads // as a comment, EATS THE REST OF THE FILE
                                        and exits 0 */
return (/^https?:\/\//i.test(a));    /* `(` is in the list — safe */
```

Upstream bugs: openwrt/luci#8299, #8020, #8021, #8256.

**A zero exit code proves nothing**: the corruption is silent.

A backtick inside `${…}` in a template string is out too. jsmin loses the string, but that one
fails loudly.

Comments are free on the router. None of them ship: release CI pre-minifies with uglify-js, and a
node-less build runs jsmin. What a comment says is governed by [Comments](#comments).

Checked by: review. jsmin exits 0 on the corrupted file, and the release build runs uglify-js
instead, so no build fails.

### JS-2. Modules MUST compose, not inherit

A required module is a singleton; there is no inheritance between modules. `'require X'` hands you
a constructed instance, not a class.

Why: `base.extend` from another module therefore throws `base.extend is not a function`. Returning
a plain object throws `factory yields invalid constructor`.

Example: `menu-footstrap.js` wires the chrome from its `__init__()` and calls into `fs-chrome.js`,
which renders it.

Checked by: the runtime. A module that inherits throws at load.

### JS-3. A *stock* class MUST be required through `window.L`

The `L` a module factory receives and `window.L` are different objects. `ui` hangs its helpers
(`itemlist`, `showModal`, …) on `window.L` only.

Why: `require()` caches by class name, so the *first* requirer fixes the class↔`L` binding. A theme
module that beats the router to a stock class makes the page die on `L.itemlist is not a function`,
intermittently.

Use `const RT = window.L; RT.require(name)`.

Checked by: review; the failure is intermittent.

### JS-4. SVG MUST be built as a string, not with `E()`

`E()` cannot build SVG. It goes through `document.createElement`, which is the HTML namespace.

SVG in the theme is assembled as a string with fixed markup. User data goes in separately via
`textContent`.

Checked by: review.

### JS-5. "Does it fit?" MUST go through `fs-fit.js`

It is one engine, one `ResizeObserver`, one per-frame coalescer for the whole theme. A module's own
decision (`fitTables`, `fitChrome`) registers with `fit.add()` and measures through the engine's
helpers.

Do not grow a second observer. The engine's three rules are in the file header: measure
uncollapsed, re-fit synchronously on a mutation, coalesce on resize.

Checked by: review.

### JS-6. "Does it fit?" MUST NOT be answered with a viewport breakpoint

Why: the sidebar gives way when the *content column* would be unreadable. That depends on the
sidebar's width, expanded or rail.

`data-narrow` on `:root` is the single source of truth, read by both CSS and `flyoutMode()`. The
CSS reads it through `data-sb`, which `fitShell()` writes from it in the same call.

Checked by: review.

### JS-7. Observers MUST be tight

Watch the narrowest node, use `attributeFilter`, guard against your own writes, coalesce into one
frame, `disconnect()` on teardown.

Why: LuCI's poll rewrites content once a second. So a loose observer on `document.body` runs a full
scan every tick.

Checked by: review.

### JS-8. Listeners MUST use `AbortController` + `{ signal }`, with `abort()` on teardown

Why: it is the only pattern that reliably removes anonymous handlers.

Checked by: review.

## Comments

In short: a comment carries what must stay true, why, and one pointer, within a size limit. A
shipped file never points into `tools/` or this repo's issues.

The reader has the file open and nothing else. Per line they are about to change, they need: what
must stay true, why, and where the proof is.

### What a comment carries

| part | example | required |
|---|---|---|
| the invariant | `min-height` AND `height` are pinned to the same value for the whole pass | always |
| the reason, as a number | the bar walked 230 -> 123 px inside one pass, 107 px of growth | when one was measured |
| one pointer | `docs/chrome.md`, "`data-narrow`"; openwrt/luci#8981 | when the proof is longer than a line |

One of each, in that order, in one sentence where it fits.

A comment with no invariant is deleted, not reworded. Restating the line it sits on is what it did.

### Which pointers a file may use

**A file under `luci-theme-footstrap/htdocs`, `ucode` or `root` ships to openwrt/luci, where
`tools/` and this repo's `issue #N` do not exist.**

A shipped file uses these pointers:

| Pointer | Allowed | Detail |
|---|---|---|
| `tools/…` or this repo's `issue #N` | no | the reason stays inline, and `sync-luci-fork.sh` fails on both |
| a `docs/` pointer | yes | at most one per comment, and never the only carrier of the reason; `sync-luci-fork.sh` counts them without failing, as upstream carries them |
| an upstream `openwrt/luci#N` | yes | |

Files in `tools/`, `styles/` and `docs/` use a `docs/` pointer too.

Checked by: `tools/sync-luci-fork.sh`, which fails on a `tools/`, `issue #N` or `../tmp/` pointer in
a shipped file and counts the `docs/` pointers.

### What a comment does not carry

| cut | goes to | why |
|---|---|---|
| attempts and their order ("first shape … second shape …") | `docs/<area>.md`, one paragraph per attempt | the code is the survivor; the losers are history |
| a `../tmp/…` path | `docs/<area>.md` restates the finding | the file is not in the repository; the pointer is dead the next day |
| a CI run id | the changelog entry, once | the run expires; the number it produced does not |
| a `../tmp/…` path or a CI run id, in a shipped file | nothing | `tools/sync-luci-fork.sh` fails on a `../tmp/` path in what it exports |
| the same fact the docs already hold | one line and the pointer | two copies drift |
| CAPS for emphasis, a rhetorical question, a warning to a future maintainer | plain prose | emphasis does not say what must stay true |

### Size limits

| comment | limit |
|---|---|
| inline, on or above a statement | 1 line; 2 when the reason is a number |
| above a function or a rule block | 8 lines |
| module or file header | 15 lines: purpose, invariants, what the file does not own |
| comment share of a shipped JS file | under 40 % of the bytes. `.ut` `{# #}` and shell `#` comments are cut by `strip-build.sh` before they ship, so the limit does not apply to them. Nothing checks this; review does |

Over the limit means the text is an explanation. An explanation is a `docs/` section pointed at
from one line.

Checked by: review.

### Rules that hold regardless of size

- **A number or a name is part of the contract.** The comment changes in the edit that changes the
  code.
- **A negative result stays, in one line, present tense.** Example: `display: none` on a zeroed tab
  pane buys nothing: scrollHeight 1039 either way. Not how it was found, not which attempt it was.
- **References survive every compression pass**: issue numbers, spec text quoted verbatim, upstream
  commits, file paths inside the repository.
- **Some comments are code**: LuCI's `'require …'` directives, and the Makefile's buildroot
  signature line, which `include/scan.mk` greps for. Reword one and the build breaks. In the
  Makefile's case it breaks silently: the SDK no longer sees the package at all.
- **A multi-line `{# … #}` comment in a template has one shape.** `{#` opens alone on its line, the
  text sits one tab deeper, and `#}` closes alone on its line.
  - A comment that fits one line stays `{# text #}`.
  - A closing tag may carry its own name (`</div>{# /.fs-shell #}`).
  - The shape holds across all five templates.
  - Run `ucode -T -c` after the edit, on a running stand (`owlab exec`).
- **Edit the comment that is there.** Never stack a second one on the first.
- **Formal English.** No exclamation, no addressing the reader.
- **A `#` line inside a quoted `ssh "$R" "…"` string is part of the string.** Run `sh -n` after the
  edit.
- **Build scripts share one frame** (`build-css.sh`, `stage.sh`, `update-po.sh`):
  - `set -eu`;
  - `trap 'exit 130' INT TERM` beside any `EXIT` trap;
  - a refusal starts `<script>: `, repeats it on a continuation line, and exits 1;
  - a usage error (wrong argument count or mode) exits 2;
  - an unknown option is refused rather than ignored, and exits 1 like any other refusal.

Checked by: review, plus `ucode -T -c` and `sh -n` where a rule names them.

### Where the narrative goes

The measurement that justifies a rule is written once, in `docs/<area>.md`, under a heading the
code can cite. It says what was seen, what it was, and the command that tells the two apart.

A docs section may be as long as the finding needs; the comment citing it may not.

## Templates and translation

### T-1. A System → Footstrap string MUST carry the `'footstrap'` context

**`msgid` is a GLOBAL name shared with every `luci-app` on the router.** `load_catalog` merges
*all* `*.<lang>.lmo` into one dictionary. It returns the first archive with a matching hash, so
readdir order decides whose translation wins.

| Strings | Rule |
|---|---|
| on System → Footstrap | use a context: `_(str, 'footstrap')` |
| chrome (Menu, Logout, Skip to content), login and warning strings | deliberately no context, so they inherit luci-base's translation in the ~40 languages the theme has no catalogue for |

Nothing here fails loudly: `_()` without a catalogue returns the English text.

Checked by: review.

### T-2. The custom property MUST be set BEFORE the attribute

Every appearance axis is implemented twice, and the order is load-bearing:

1. Inline in `partials/head.ut`, before first paint, since no module loader exists yet.
2. Live in `fs-axes.js`, or `fs-prefs.js` for dark mode, layout, auto-collapse and rail.

Why: reversed, a reload paints one frame in the previous hue, and no check catches it.

The two copies change in the same edit.

Checked by: review.

## Package and registration

### P-1. One entry in `luci.themes`, and an install or an upgrade never changes the active theme

Do not add `-dark`/`-light` or layout-specific entries. Why: the appearance axes are client-side.

How registration works: [package.md](package.md).

Checked by: CI's `e2e`. A fresh install must offer Footstrap and leave the active theme alone,
and the upgrade must keep the admin's theme.

### P-2. postinst, postrm and `dev-sync.sh` MUST NOT call `rpcd reload` or `restart`

Why:

- restart logs out every session;
- reload is a SIGHUP re-exec that can drop a plugin;
- the package registers nothing for rpcd to re-read (Makefile, above the postinst).

The exception is `install.sh`. Its `finish()` calls `rpcd reload` after the package manager has
finished, while a postinst runs inside the transaction. Details: [package.md](package.md#why-postinstpostrm-never-call-rpcd-reload).

Checked by: review.

### P-3. One asset per package per format in a release

Why: `install_from_release()` picks the asset from the signed `manifest.txt` by package name and
format. Two candidates would make the pick a guess.

Checked by: review.

### P-4. The translation catalogue lives in `po/`

Why: that is the directory `LUCI_LANGUAGES` globs. From it luci.mk bakes a
`luci-i18n-footstrap-<lang>` package per language, exactly as it does for every luci-app.

It is also the only directory Weblate can see, and openwrt/luci's `CONTRIBUTING.md` names Weblate
as the way to translate LuCI.

Checked by: review.

### P-5. No runtime dependency beyond `+luci-base`

`curl` is not in OpenWrt's default set; the base image ships `uclient-fetch`. Fall back, do not
depend.

`jsonfilter`, `sha256sum` and `usign` are in the base image.

Checked by: review.

### P-6. Every shipped `/etc/config/*` is a declared conffile

Why: `/etc/config/footstrap` is written at runtime by Save to router, and an undeclared one is
replaced on upgrade.

Checked by: CI's `e2e`. A marker written to `/etc/config/footstrap` must survive the upgrade.

### P-7. Every shipped `acl.d/*.json` parses and grants something

Why: rpcd skips an unreadable file silently.

Checked by: CI's build job. `acl.d` must hold `luci-theme-footstrap.json` alone, and `jq` must
parse it and find exactly the expected grants.

### P-8. A language is listed in three places

The places are `po/<lang>/`, `tools/stage.sh` and `owfeed.yml`, with the names and labels luci.mk
uses.

Why: a language missing from one stages into a directory nothing packages, with a green build.

Checked by: `tools/stage.sh`, which stops the build on a `po/` language with no label in
`lang_name()`. A language missing from `owfeed.yml` still builds green, so that part is review.

### P-9. The app-icon rasters are committed

`tools/build-icons.mjs` generates them from `logo.svg`. Why: the buildbot cannot rebuild them.

Checked by: review.

## The trust chain

`install.sh` installs from the owfeed-packages feed, so the package manager verifies the bytes:

| Manager | Checks the index against |
|---|---|
| apk | `owfeed-packages.pem` |
| opkg | usign key `9040356b214084da` |

The script pins the opkg key id and fetches both keys from the feed host on every run, over
verified TLS.

**It never uses `-k` / `--no-check-certificate`, not even as a retry.** Why: a failed verification
*is* the MITM case.

It must also be safe to run over its own result.

### The release fallback

Only when the feed cannot be read at all does the installer fall back to the release
(`install_from_release()`):

1. It runs `usign -V` over `manifest.txt` against the pinned release key.
2. It checks the asset's sha256 from that manifest.

apk's `--allow-untrusted` there waives only the package's own signature.

The release signs everything: a `manifest.txt` plus a detached `.sig` per asset, both verified in
the `release` job. That fallback, a by-hand install and a mirror are all checked against it.

### Why a signature and not a sha256 alone

An ed25519 signature holds where a sha256 alone cannot. GitHub *computes* the asset digest from the
uploaded bytes. So whoever can swap an asset gets the digest recomputed for them.

The same holds for OpenWrt's SDK. `sha256sums` alone proves nothing, because it is served unsigned
beside the tarball. `build-apk.sh` verifies `sha256sums.sig` first, with a key pinned from another
host, and only then the checksum.

## Changelog and release

### R-1. A change a theme user sees writes a changelog entry in the same commit as the code

The entry goes into `## [Unreleased]` in both `CHANGELOG.md` and `CHANGELOG_ru.md`. CI, tests,
tooling and docs changes get no entry.

Why: a changelog written afterwards is written from the diff, and the diff is exactly what does not
know why.

The contract, format, categories and the release runbook: [releasing.md](releasing.md).

Checked by: review.

