# Conventions

The rules a change to this theme has to follow.

Read this before your first patch. For what the theme *is*, start at
[architecture.md](architecture.md).

## The check

```sh
owlab up owrt2512
node tools/e2e.mjs --router owrt2512 --old <release pkg> --new <built pkg>
```

…and the same again on `owrt2410` with the `.ipk` pair: 25.12/apk and 24.10/opkg. Locally it also
runs `tools/anchor-check.mjs`. CI splits the two into jobs, each on both routers: `e2e` runs
`tools/e2e.mjs --no-anchor`, and `anchor` runs `tools/anchor-check.mjs`. What the check walks
through is in [verifying.md](verifying.md).

No npm package is installed on a router. The release build (`tools/stage.sh`) runs uglify-js and
acorn over the shipped JS and templates; `luci.mk` copies `htdocs/` and `ucode/` verbatim and never
invokes node, and the OpenWrt buildbot has no node at all.

## Keep owlab installed, and run the change on a router

**owlab is required, not a convenience.** Install it once and keep it:

```sh
go install owfeed.org/owlab/cmd/owlab@latest
owlab doctor
```

**A change that alters behaviour is not finished until it has run on a real OpenWrt userland**, on
both package managers: 25.12/apk and 24.10/opkg. Not "it should work": run it. `owlab up`
gives you the disposable routers `owlab.yaml` defines, and `tools/e2e.mjs` against them is the
local form of CI's `e2e` and `anchor` jobs. How: [development.md](development.md).

Reading the source cannot see sessions, pollers, rendered templates, install paths or apk/opkg
differences; only a router can.

Say which router a run covered; do not let one stand in for the other.

**If you cannot run it** (no Docker on the machine), say so in the commit or the PR rather than
reporting the change as verified. An untested change described as tested is worse
than an untested change.

## Writing CSS

**Read only the private tier.** Every rule in `styles/` reads `--fs-*` and nothing else. The
export names (`--primary-color-high`, `--text-color-*`, …) are defined *from* the private tier
and are for third-party apps only.

```css
color: var(--fs-dim);                                    /* yes */
color: var(--text-color-medium);                         /* no */
```

Why: `:root` is one shared scope, and every `luci-app-*` puts its CSS in the same document. A
sheet pinned to the app's own names stays **unlayered**, which outranks any `@layer`. `fs-sheets.js`
moves any other sheet into `@layer theme`, which still outranks `tokens`. Either way an app's `:root`
would recolour the theme. The two tiers are in [design-system.md](design-system.md).

**Put the rule in the right layer instead of reaching for `!important`.** Layer order is
`tokens, base, theme, page`. A later layer beats an earlier one regardless of specificity, so a
`theme` rule never needs a flag to beat `base`.

**`!important` inverts layer order**: the mechanics and the numbers behind that are in
[css.md](css.md). Two consequences for a patch:

- If a rule needs a flag to beat **another footstrap rule**, the rule is in the wrong layer.
  Move it or merge the two.
- A legitimate flag fights only what layers cannot outrank: inline `style=` and unlayered
  rules injected by an app.

The one flag sanctioned against *our own* rules is `theme/95-a11y-media.css`.
`prefers-reduced-motion` has to kill animations declared in `base` too, and only an important
declaration reaches back a layer. The same file carries the forced-colors focus outline, for the
same reason.

Every other file with a flag fights something outside the cascade:

- `theme/90-responsive` outranks the unlayered sheet `package-manager.js` injects and the inline
  `display:none` it writes on the pager rows.
- `pages/20-overview` outranks a `style=` written by `29_ports.js`.
- `theme/45-misc` widens the box the realtime graphs size inline and repaints its inline black
  border.
- `theme/65-dropdown` pins the open list's `inset-inline` over `ui.js`'s inline left/right. It also
  frees `.hide-close` from a RichListValue's inline `min-width:25vw`.
- `theme/30-tables` holds `word-break: normal` against `processes.js`'s inline
  `word-break: break-word` and luci-mod-dashboard's unlayered `word-break: break-all`. It also holds
  two carded-cell `flex` widths against that same unlayered sheet's `flex: 2 2 10%`.
- `styles/base` keeps the six `.left`/`.right`/… forcing utilities, `[hidden]` in `10-reset`, and
  two inline-style fighters in `95-luci`.

A flag outside these files belongs in another layer; it does not get a new entry here. Nothing
checks this list; review does.

**Win on specificity, never on source order.** Two rules with the same specificity where the
later one is load-bearing is the same failure as 220 `!important`, only quieter. Cap:
`[1,7,0]` (a convention; nothing checks it).

**Edit the rule that already styles the selector.** Do not append a second one.

**No colour literals outside the palettes.** A `#hex` follows neither the palette nor dark mode.
The exceptions:

- `--fs-scrim`: black at .7 is the absence of light behind a dialog, not a shade of any token;
- the logo ring in `theme/10-chrome.css`, which flips with mode like the favicon SVG;
- the paper palette in `theme/97-print.css`.

Nothing checks this rule; review does.

**Stay inside your zone.** There are three:

1. The theme's own chrome (`fs-*` names, `data-fs-chrome` roots): ours alone, and fenced against
   foreign CSS. The fence is in [third-party-apps.md](third-party-apps.md).
2. The shared LuCI widget surface (`cbi-*`, `.table`, `.alert-message`): ours to style, nobody's to
   own.
3. Another package's namespace, which the theme never reaches into.

No theme file goes into another package's directory, such as `luci-mod-status`'s include
directory, where LuCI evaluates every `*.js` under any theme.

**Coverage is a contract.** A selector no stock LuCI page renders still gets styled: some
third-party `luci-app-*` emits it. "Looks unused, delete it" un-styles somebody's app. PurgeCSS,
uncss and any coverage-based trimming are forbidden here. The one safe dead-CSS search is for
`fs-*` selectors, and it is safe only because nothing outside the theme can emit an `fs-*` class.

**Merge a duplicate where CSS allows.** Identical declaration bodies under mutually exclusive
guards are the shape that drifts: once the copies diverge they no longer look like duplicates at
all.

**A `display` rule on `.table`/`.thead`/`.tbody`/`.tfoot`/`.tr`/`.th`/`.td` needs a role to match.**
A `display` other than `table`/`table-row`/`table-cell`/… drops the implicit `table`/`row`/`cell`
role HTML-AAM derives from it (WCAG 1.3.1). `fs-select.js`'s role map puts it back. Both directions
hold. The role map does not shrink. A theme selector does not set `display` on one of these classes
without a matching entry in the map. Nothing checks this; review does.

**A flex item's automatic minimum size defaults to its CONTENT size, and `overflow` is what zeroes
it.** Every flex item has the *automatic minimum size*. With no explicit `min-width` (row axis) or
`min-height` (column axis), it resolves to the item's min-content box. If the item's own `overflow`
is anything other than `visible`, the automatic minimum drops to zero (CSS Flexbox §4.5).

Before adding a declaration to a flex item, name which of the two behaviours it needs:

- A button that must shrink wants `overflow: hidden` (or an explicit `min-width: 0`) to reach zero.
- A label or a pill that must clip while holding its own width wants the overflow property paired
  with an explicit `min-width`/`max-width` that is not `auto`. The automatic minimum then never
  gets a vote.

The third shape is invisible on a page: an inert `text-overflow: ellipsis`. It produces no
overflow at all, because the box it sits on was never given room to shrink. Nothing measures a clip
rule that never fires.

## Writing JS

**Never put a regex literal straight after `return` or `=>`.** `luci.mk` runs `jsmin` on the
buildbot. It decides whether `/` opens a regex or divides by looking at one preceding character.
Neither `n` (from `return`) nor `>` (from `=>`) is in its list:

```js
return /^https?:\/\//i.test(a);      /* jsmin reads // as a comment, EATS THE REST OF THE FILE
                                        and exits 0 */
return (/^https?:\/\//i.test(a));    /* `(` is in the list — safe */
```

Upstream bugs: openwrt/luci#8299, #8020, #8021, #8256. **A zero exit code proves nothing**:
the corruption is silent. A backtick inside `${…}` in a template string is out too (jsmin loses
the string, but that one fails loudly).

**Comments are free on the router.** None of them ship: release CI pre-minifies with uglify-js, and a
node-less build runs jsmin. What a comment says is governed by "Comments" below.

**A required module is a singleton; there is no inheritance between modules.** `'require X'`
hands you a constructed instance, not a class. `base.extend` from another module therefore throws
`base.extend is not a function`, and returning a plain object throws `factory yields invalid
constructor`. Compose instead: `menu-footstrap-common.js` exports `init()`, and
`menu-footstrap.js` is a one-line footer entry that calls it. The renderer lives in `fs-chrome.js`.

**Require a *stock* class through `window.L`.** The `L` a module factory receives and
`window.L` are different objects, and `ui` hangs its helpers (`itemlist`, `showModal`, …) on
`window.L` only. Worse, `require()` caches by class name, so the *first* requirer fixes the
class↔`L` binding. A theme module that beats the router to a stock class makes the page die on
`L.itemlist is not a function`, intermittently. Use `const RT = window.L; RT.require(name)`.

**`E()` cannot build SVG.** It goes through `document.createElement`, which is the HTML
namespace. SVG in the theme is assembled as a string with fixed markup, and user data goes in
separately via `textContent`.

**The "does it fit?" engine is `fs-fit.js`.** One engine, one `ResizeObserver`, one
per-frame coalescer for the whole theme; a module's own decision (`fitTables`, `fitChrome`) registers
with `fit.add()` and measures through the engine's helpers. Do not grow a second observer. Its three rules (measure
uncollapsed, re-fit synchronously on a mutation, coalesce on resize) are in the file header.

**Never answer "does it fit?" with a viewport breakpoint.** The sidebar gives way when the
*content column* would be unreadable, which depends on the sidebar's width (expanded or rail).
`data-narrow` on `:root` is the single source of truth, read by both CSS and `flyoutMode()`.

**Observer hygiene.** Watch the narrowest node, use `attributeFilter`, guard against your own
writes, coalesce into one frame, `disconnect()` on teardown. LuCI's poll rewrites content once a
second, so a loose observer on `document.body` runs a full scan every tick.

**Listener lifecycle: `AbortController` + `{ signal }`**, `abort()` on teardown. It is the only
pattern that reliably removes anonymous handlers.

## Comments

The reader has the file open and nothing else. They need, per line they are about to change: what
must stay true, why, and where the proof is.

### What a comment carries

| part | example | required |
|---|---|---|
| the invariant | `min-height` AND `height` are pinned to the same value for the whole pass | always |
| the reason, as a number | the bar walked 230 -> 123 px inside one pass, 107 px of growth | when one was measured |
| one pointer | `docs/chrome.md`, "`data-narrow`"; openwrt/luci#8981 | when the proof is longer than a line |

One of each, in that order, in one sentence where it fits.

**A file under `luci-theme-footstrap/htdocs`, `ucode` or `root` ships to openwrt/luci, where
`tools/` and this repo's `issue #N` do not exist.** It uses neither as a pointer. The reason stays
inline, and `sync-luci-fork.sh` fails on both. A `docs/` pointer is allowed there: at most one per
comment, and never the only carrier of the reason. `sync-luci-fork.sh` counts them without
failing, as upstream carries them. Files in `tools/`, `styles/` and `docs/` use a `docs/` pointer
too. An upstream `openwrt/luci#N` is fine. A comment with no invariant is
deleted, not reworded: restating the line it sits on is what it did.

### What a comment does not carry

| cut | goes to | why |
|---|---|---|
| attempts and their order ("first shape … second shape …") | `docs/<area>.md`, one paragraph per attempt | the code is the survivor; the losers are history |
| a `../tmp/…` path | `docs/<area>.md` restates the finding | the file is not in the repository; the pointer is dead the next day |
| a CI run id | the changelog entry, once | the run expires; the number it produced does not |
| a `../tmp/…` path or a CI run id, in a shipped file | nothing | `tools/sync-luci-fork.sh` fails on a `../tmp/` path in what it exports |
| the same fact the docs already hold | one line and the pointer | two copies drift |
| CAPS for emphasis, a rhetorical question, a warning to a future maintainer | plain prose | emphasis does not say what must stay true |

### Size

| comment | limit |
|---|---|
| inline, on or above a statement | 1 line; 2 when the reason is a number |
| above a function or a rule block | 8 lines |
| module or file header | 15 lines: purpose, invariants, what the file does not own |
| comment share of a shipped JS file | under 40 % of the bytes; `.ut` `{# #}` and shell `#` comments are cut by `strip-build.sh` before they ship, so the limit does not apply to them. Nothing checks this; review does |

Over the limit means the text is an explanation, and an explanation is a `docs/` section pointed at
from one line.

### Rules that hold regardless of size

- **A number or a name is part of the contract.** The comment changes in the edit that changes
  the code.
- **A negative result stays, in one line, present tense.** `display: none` on a zeroed tab pane
  buys nothing: scrollHeight 1039 either way. Not how it was found, not which attempt it was.
- **References survive every compression pass**: issue numbers, spec text quoted verbatim, upstream
  commits, file paths inside the repository.
- **Some comments are code**: LuCI's `'require …'` directives, the
  Makefile's buildroot signature line (`include/scan.mk` greps for it). Reword one and the build
  breaks, silently in the Makefile's case: the SDK no longer sees the package at all.
- **A multi-line `{# … #}` comment in a template has one shape.** `{#` opens alone on its line,
  the text sits one tab deeper, and `#}` closes alone on its line. A comment that fits one line
  stays `{# text #}`. A closing tag may carry its own name (`</div>{# /.fs-shell #}`). The shape
  holds across all five templates. Run `ucode -T -c` after the edit, on a running stand
  (`owlab exec`).
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

### Where the narrative goes

The measurement that justifies a rule is written once, in `docs/<area>.md`, under a heading the
code can cite: what was seen, what it was, the command that tells the two apart. A docs section may
be as long as the finding needs; the comment citing it may not.

## Templates and translation

**`msgid` is a GLOBAL name shared with every `luci-app` on the router.** `load_catalog` merges
*all* `*.<lang>.lmo` into one dictionary. It returns the first archive with a matching hash, so
readdir order decides whose translation wins.

- Strings on System → Footstrap: use a context: `_(str, 'footstrap')`.
- Chrome (Menu, Logout, Skip to content), login and warning strings: deliberately no context,
  so they inherit luci-base's translation in the ~40 languages the theme has no catalogue for.

Nothing here fails loudly: `_()` without a catalogue returns the English text.

**Set the custom property BEFORE the attribute.** Every appearance axis is implemented twice, and
the order is load-bearing. The first copy is inline in `partials/head.ut` before first paint, since
no module loader exists yet. The second is live in `fs-axes.js` (`fs-prefs.js` for dark mode,
layout, auto-collapse and rail). Reversed, a reload paints one frame in the previous hue, and no check catches it.
The two copies change in the same edit.

## Package and registration

**One entry in `luci.themes`, and an install or an upgrade never changes the active theme.** Do not
add `-dark`/`-light` or layout-specific entries: the appearance axes are client-side. How
registration works: [package.md](package.md).

**No `rpcd reload` and no `restart`.** restart logs out every session; reload is a SIGHUP re-exec
that can drop a plugin; the package registers nothing for rpcd to re-read (Makefile, above the
postinst).

**One asset per package per format in a release.** `install_from_release()` picks the asset from
the signed `manifest.txt` by package name and format, so two candidates would make the pick a
guess.

**The translation catalogue lives in `po/`.** That is the directory `LUCI_LANGUAGES` globs. From
it luci.mk bakes a `luci-i18n-footstrap-<lang>` package per language, exactly as it does for every
luci-app. It is also the only directory Weblate can see, and CONTRIBUTING names Weblate as the way
to translate LuCI.

**No runtime dependency beyond `+luci-base`.** `curl` is not in OpenWrt's default set (the base
image ships `uclient-fetch`); fall back, do not depend. `jsonfilter`, `sha256sum` and `usign` are
in the base image.

**Every shipped `/etc/config/*` is a declared conffile.** `/etc/config/footstrap` is written at
runtime by Save-as-default, and an undeclared one is replaced on upgrade. Every shipped
`acl.d/*.json` parses and grants something: rpcd skips an unreadable file silently.

**A language is listed in three places**: `po/<lang>/`, `tools/stage.sh` and `owfeed.yml`, with
the names and labels luci.mk uses. A language missing from one stages into a directory nothing
packages, with a green build.

**The app-icon rasters are committed.** `tools/build-icons.mjs` generates them from `logo.svg`;
the buildbot cannot rebuild them.

## The trust chain

`install.sh` installs from the owfeed-packages feed, so the package manager verifies the bytes.
apk checks the index against `owfeed-packages.pem`; opkg checks it against usign key
`9040356b214084da`. The script pins the opkg key id and fetches both keys from the feed host on
every run, over verified TLS. It never uses `-k` / `--no-check-certificate`, not even as a retry,
because a failed verification *is* the MITM case. It must also be safe to run over its own result.

Only when the feed cannot be read at all does the installer fall back to the release
(`install_from_release()`). The fallback runs `usign -V` over `manifest.txt` against the pinned
release key, then checks the asset's sha256 from that manifest. apk's `--allow-untrusted` there
waives only the package's own signature.

**The release signs everything**: a `manifest.txt` plus a detached `.sig` per asset, both verified
in the `release` job. That fallback, a by-hand install and a mirror are all checked against it.

An ed25519 signature holds where a sha256 alone cannot. GitHub *computes* the asset digest from
the uploaded bytes, so whoever can swap an asset gets the digest recomputed for them.
The same holds for OpenWrt's SDK: `sha256sums` alone proves nothing, because it is served unsigned
beside the tarball. `build-apk.sh` verifies `sha256sums.sig` first, with a key pinned from another
host, and only then the checksum.

## Changelog and release

A change a theme user sees writes an entry into `## [Unreleased]` in the same commit as the code,
in both `CHANGELOG.md` and `CHANGELOG_ru.md`. CI, tests, tooling and docs changes get no entry. A
changelog written afterwards is written from the diff, and the diff is exactly what does not know
why. The contract, format, categories and the release runbook: [releasing.md](releasing.md).
