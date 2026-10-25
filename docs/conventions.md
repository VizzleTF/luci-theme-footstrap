# Conventions

The rules a change to this theme has to follow. Every one of them is a bug that was hit.

Read this before your first patch. For what the theme *is*, start at
[architecture.md](architecture.md).

## The check

```sh
owlab up owrt2512
node tools/e2e.mjs --router owrt2512 --old <release pkg> --new <built pkg>
```

…and the same again on `owrt2410` with the `.ipk` pair: 25.12/apk and 24.10/opkg. It is the one
check, and CI's `e2e` job runs it on both routers; what it walks through is in
[verifying.md](verifying.md).

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
**both** package managers — 25.12/apk and 24.10/opkg. Not "it should work": run it. `owlab up`
gives you the disposable routers `owlab.yaml` defines, and `tools/e2e.mjs` against them is the
local form of CI's `e2e` job. How: [development.md](development.md).

Why the rule is written down rather than assumed: a file cannot answer for a page. The classes of
bug that reading the source structurally cannot see:

- a preference that writes to the wrong place (the appearance axes were checked on their
  *contract* while one of them silently rewrote a router-wide default);
- anything that only appears once a session, a poller or a second browser exists;
- a template that compiles and renders the wrong thing;
- an install path — `postinst`, `uci-defaults`, the marker file, a conffile surviving an upgrade;
- any difference between apk and opkg.

Say which router a run covered; do not let one stand in for the other.

**If you genuinely cannot run it** (no Docker on the machine), say so plainly in the commit or the
PR rather than reporting the change as verified. An untested change described as tested is worse
than an untested change.

## Writing CSS

**Read only the private tier.** Every rule in `styles/` reads `--fs-*` and nothing else. The
export names (`--primary-color-high`, `--text-color-*`, …) are defined *from* the private tier
and are for third-party apps only.

```css
color: var(--fs-dim);                                    /* yes */
color: var(--text-color-medium);                         /* no */
```

Why: `:root` is one shared scope, and every `luci-app-*` puts its CSS in the same document
**unlayered**, which outranks any `@layer`, so an app's `:root` would recolour the theme. The two
tiers are in [design-system.md](design-system.md).

**Put the rule in the right layer instead of reaching for `!important`.** Layer order is
`tokens, base, theme, page`, and a later layer beats an earlier one regardless of specificity —
so a `theme` rule never needs a flag to beat `base`.

**`!important` inverts layer order** — the mechanics and the numbers behind that are in
[css.md](css.md). Two consequences for a patch:

- If a rule needs a flag to beat **another footstrap rule**, the rule is in the wrong layer.
  Move it or merge the two.
- A legitimate flag fights only what layers cannot outrank: inline `style=` and unlayered
  rules injected by an app.

The one flag sanctioned against *our own* rules is `theme/95-a11y-media.css`:
`prefers-reduced-motion` has to kill animations declared in `base` too, and only an important
declaration reaches back a layer; the same file carries the forced-colors focus outline, for the
same reason. Every other file with a flag fights something outside the cascade —
`theme/90-responsive` outranks a `style=` written by `package-manager.js`, `pages/20-overview`
one written by `29_ports.js`, `theme/45-misc` widens the box the realtime graphs size inline and repaints its inline
black border, `theme/65-dropdown` pins the open list's `inset-inline` over `ui.js`'s inline left/right and frees `.hide-close` from a RichListValue's inline `min-width:25vw`,
`theme/30-tables` holds `word-break: normal` against `processes.js`'s inline `word-break: break-word`
and luci-mod-dashboard's unlayered `word-break: break-all`, and two carded-cell `flex` widths against
that same unlayered sheet's `flex: 2 2 10%`, and `styles/base` keeps the six `.left`/`.right`/…
forcing utilities, `[hidden]` in `10-reset`, and two inline-style fighters in `95-luci`. A flag
outside these files is the wrong layer, not a new entry. Nothing checks this list; review does.

**Win on specificity, never on source order.** Two rules with the same specificity where the
later one is load-bearing is the same failure as 220 `!important`, only quieter. Cap:
`[1,7,0]` (a convention; nothing checks it).

**Edit the rule that already styles the selector.** Do not append a second one.

**No colour literals outside the palettes.** A `#hex` follows neither the palette nor dark mode.
The exceptions: `--fs-scrim` — black at .7 is the absence of light behind a dialog, not a shade of
any token; the logo ring in `theme/10-chrome.css`, which flips with mode like the favicon SVG; and
the paper palette in `theme/97-print.css`. Nothing checks this rule; review does.

**Stay inside your zone.** There are three: the theme's own chrome (`fs-*` names, `data-fs-chrome`
roots — ours alone, and fenced against foreign CSS); the shared LuCI widget surface (`cbi-*`,
`.table`, `.alert-message` — ours to style, nobody's to own); and another package's namespace,
which the theme never reaches into: no theme file goes into another package's directory, such as
`luci-mod-status`'s include directory, where LuCI evaluates every `*.js` under any theme. The fence that keeps
foreign CSS out of zone one is described in [third-party-apps.md](third-party-apps.md).

**Coverage is a contract.** A selector no stock LuCI page renders still gets styled: some
third-party `luci-app-*` emits it. "Looks unused, delete it" un-styles somebody's app. PurgeCSS,
uncss and any coverage-based trimming are forbidden here. The one safe dead-CSS search is for
`fs-*` selectors, and it is safe only because nothing outside the theme can emit an `fs-*` class.

**Merge a duplicate where CSS allows.** Identical declaration bodies under mutually exclusive
guards are the shape that drifts: once the copies diverge they no longer look like duplicates at
all.

**A `display` rule on `.table`/`.thead`/`.tbody`/`.tfoot`/`.tr`/`.th`/`.td` needs a role to match.**
A `display` other than `table`/`table-row`/`table-cell`/… drops the implicit `table`/`row`/`cell`
role HTML-AAM derives from it (WCAG 1.3.1), and `fs-select.js`'s role map is what puts it back.
Both directions hold: the role map does not shrink, and a theme selector does not set `display` on
one of these classes without an entry in the map to pair with it.

**A flex item's automatic minimum size defaults to its CONTENT size, and `overflow` is what zeroes
it.** Any flex item with no explicit `min-width` (row axis) or `min-height` (column axis) still has
one: the *automatic minimum size*, which resolves to the item's min-content box unless the item's
own `overflow` is something other than `visible`, in which case the automatic minimum drops to zero
(CSS Flexbox §4.5). One cause, symptoms in both directions:

- `.cbi-checkbox` is `inline-flex` and its pill had no `flex-shrink: 0` — the automatic minimum let
  the pill compress below its declared `--sw-w` while the knob kept its literal size and a travel
  distance derived from the width the pill no longer had.
- Under 767px a form label is `flex: 1 1 100%` with no `min-width` on ssclash — its automatic
  minimum fell back to content width and it escaped its own section.
- A closed dropdown's `overflow: hidden; text-overflow: ellipsis` were already correct and inert:
  the automatic minimum held the `li` at content width, so there was nothing left to clip.
- The opposite fault, same rule: `overflow: hidden` on a row-action button zeroed *its* automatic
  minimum, so `flex-grow` divided the row by count instead of by need and every button converged on
  one width at every viewport — a desktop regression shipped as the fix for a phone one.

Before adding a declaration to a flex item, name which of the two behaviours it needs: a button that
must actually shrink wants `overflow: hidden` (or an explicit `min-width: 0`) to reach zero; a label
or a pill that must clip while holding its own width wants the overflow property paired with an
explicit `min-width`/`max-width` that is not `auto`, so the automatic minimum never gets a vote.
The third shape is invisible on a page: an inert `text-overflow: ellipsis` produces no overflow at
all, because the box it sits on was never given the room to shrink in the first place, and nothing
measures a clip rule that never fires.

## Writing JS

**Never put a regex literal straight after `return` or `=>`.** `jsmin` (which `luci.mk` runs on
the buildbot) decides whether `/` opens a regex or divides by looking at one preceding
character, and neither `n` (from `return`) nor `>` (from `=>`) is in its list:

```js
return /^https?:\/\//i.test(a);      /* jsmin reads // as a comment, EATS THE REST OF THE FILE
                                        and exits 0 */
return (/^https?:\/\//i.test(a));    /* `(` is in the list — safe */
```

Upstream bugs: openwrt/luci#8299, #8020, #8021, #8256. **A zero exit code proves nothing** —
the corruption is silent. A backtick inside `${…}` in a template string is out too (jsmin loses
the string, but that one fails loudly).

**Comments are free on the router.** None of them ship: release CI pre-minifies with uglify-js, and a
node-less build runs jsmin. What a comment says is governed by "Comments" below.

**A required module is a singleton; there is no inheritance between modules.** `'require X'`
hands you a constructed instance, not a class, so `base.extend` from another module throws
`base.extend is not a function`, and returning a plain object throws `factory yields invalid
constructor`. Compose instead: `menu-footstrap-common.js` exports `init()` and `menu-footstrap.js` is a one-line
footer entry that calls it; the renderer lives in `fs-chrome.js`.

**Require a *stock* class through `window.L`.** The `L` a module factory receives and
`window.L` are different objects, and `ui` hangs its helpers (`itemlist`, `showModal`, …) on
`window.L` only. Worse, `require()` caches by class name, so the *first* requirer fixes the
class↔`L` binding — a theme module that beats the router to a stock class makes the page die on
`L.itemlist is not a function`, intermittently. Use `const RT = window.L; RT.require(name)`.

**`E()` cannot build SVG.** It goes through `document.createElement`, which is the HTML
namespace. SVG in the theme is assembled as a string with fixed markup, and user data goes in
separately via `textContent`. This is a namespace fact, not a style choice.

**The "does it fit?" engine is `fs-fit.js`.** One engine, one `ResizeObserver`, one
per-frame coalescer for the whole theme; a module's own decision (`fitTables`, `fitChrome`) registers
with `fit.add()` and measures through the engine's helpers. Do not grow a second observer. Its three rules — measure
uncollapsed, re-fit synchronously on a mutation, coalesce on resize — are each a bug that was hit;
they are documented in the file header.

**Never answer "does it fit?" with a viewport breakpoint.** `matchMedia('(max-width: 767px)')`
used to decide this, and between 768 and 779 px the chrome drew as a bar while the menu still
behaved as an accordion. The sidebar gives way when the *content column* would be unreadable,
which depends on the slice (224 px expanded, 68 px rail) — one breakpoint gives both states the
same answer. `data-narrow` on `:root` is the single source of truth, read by both CSS and
`flyoutMode()`.

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

One of each, in that order, in one sentence where it fits. **A file under
`luci-theme-footstrap/htdocs`, `ucode` or `root` ships to openwrt/luci, where `tools/` and this
repo's `issue #N` do not exist: it carries none of them as a pointer and the reason stays
inline** (`sync-luci-fork.sh` fails on them). A `docs/` pointer is allowed there, at most one per
comment and never the only carrier of the reason: `sync-luci-fork.sh` counts them without failing,
as upstream carries them. A pointer to `docs/` is also for `tools/`, `styles/` and the
docs themselves. An upstream `openwrt/luci#N` is fine. A comment with no invariant is
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
| comment share of a shipped JS file | under 40 % of the bytes; `.ut` `{# #}` and shell `#` comments are cut by `strip-build.sh` before they ship, so the limit does not apply to them |

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
- **A `{# … #}` comment in a template opens with `{#` alone on its line, the text one tab deeper,
  and closes with `#}` alone on its line.** A comment that fits one line stays `{# text #}`, and a
  closing tag may carry its own name (`</div>{# /.fs-shell #}`). One shape across all five
  templates; `ucode -T -c` after the edit, on a running stand (`owlab exec`).
- **Edit the comment that is there.** Never stack a second one on the first.
- **Formal English.** No exclamation, no addressing the reader.
- **A `#` line inside a quoted `ssh "$R" "…"` string is part of the string.** `sh -n` after the
  edit.
- **Build scripts share one frame**: `set -eu`, `trap 'exit 130' INT TERM` beside any `EXIT` trap, a
  refusal that starts `<script>: ` (and repeats it on a continuation line) and exits 1, a usage
  error (wrong argument count or mode) that exits 2, an unknown option refused rather than ignored
  and exiting 1 like any other refusal (`build-css.sh`, `stage.sh`, `update-po.sh`).

### Where the narrative goes

The measurement that justifies a rule is written once, in `docs/<area>.md`, under a heading the
code can cite: what was seen, what it was, the command that tells the two apart. A docs section may
be as long as the finding needs; the comment citing it may not.

## Templates and translation

**`msgid` is a GLOBAL name shared with every `luci-app` on the router.** `load_catalog` merges
*all* `*.<lang>.lmo` into one dictionary and returns the first archive with a matching hash, so
**readdir order decides whose translation wins**. The layout switch rendered "Максимум" on a
Russian router because somebody's catalogue translates `Top` that way — correct in a bandwidth
dialog, nonsense on a layout switch.

- Strings on System → Footstrap: **use a context** — `_(str, 'footstrap')`.
- Chrome (Menu, Logout, Skip to content), login and warning strings: **deliberately no context**,
  so they inherit luci-base's translation in the ~40 languages the theme has no catalogue for.

Nothing here fails loudly: `_()` without a catalogue is just English text.

**Set the custom property BEFORE the attribute.** Every appearance axis is implemented twice —
inline in `partials/head.ut` before first paint (no module loader exists yet) and live in
`fs-axes.js` (`fs-prefs.js` for dark mode, layout, auto-collapse and rail) — and the order is
load-bearing. Reversed, a reload paints exactly one frame in the previous hue: a symptom nobody
reports and no page-level check catches. The two copies change in the same edit.

## Package and registration

**One entry in `luci.themes`** — `Footstrap` → `/luci-static/footstrap`. Layout, mode, palette,
tint, accent and rounding are client axes (`localStorage` + attributes on `:root`), not theme
entries and not a server choice. Do not reintroduce `-dark`/`-light` symlink themes or
layout-specific entries.

**An install or an upgrade never changes the active theme.** `uci-defaults` registers
`luci.themes.Footstrap`; its `mediaurlbase` line runs only in the run that first added the
registration and never overwrites a value, and luci-base ships `main.mediaurlbase`, so on a stock
router it sets nothing: the admin picks Footstrap in Language and Style. `$PKG_UPGRADE` is checked
as well and carries nothing on its own — apk never exports it.

**No `rpcd reload` and no `restart`.** restart logs out every session; reload is a SIGHUP re-exec
that can drop a plugin; the package registers nothing for rpcd to re-read (Makefile, above the
postinst).

**One asset per package per format in a release.** Nothing on a router picks an asset any more —
the installer takes the feed — but a reader that does gets one candidate, not a guess: GitHub
returns assets **sorted by name**, and a `luci-i18n-…` package sorting ahead of `luci-theme-…` once
picked the wrong asset silently (issue #6). Code already on somebody's router cannot be fixed
remotely; only the release can.

**The translation catalogue lives in `po/`.** That is the directory `LUCI_LANGUAGES` globs, so
luci.mk bakes a `luci-i18n-footstrap-<lang>` package per language exactly as it does for every
luci-app — and it is the only directory Weblate, which CONTRIBUTING names as the way to translate
LuCI, can see.

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

`install.sh` installs from the owfeed-packages feed, so **the package manager is what verifies the
bytes**: apk checks the index against `owfeed-packages.pem`, opkg against usign key
`9040356b214084da`, and both keys are pinned in the script itself — it runs from `wget | sh` before
any package of ours exists. The script's own fetch of those keys uses a verified TLS channel:
never `-k` / `--no-check-certificate`, and never as a retry, because a failed verification *is* the
MITM case. It must also be safe to run over its own result: three field reports (#16, #28, #30)
were this script alone, all on the second-run path.

Only when the feed cannot be read at all does the installer fall back to the release
(`install_from_release()`): `usign -V` over `manifest.txt` against the pinned release key, then the
asset's sha256 from that manifest; apk's `--allow-untrusted` there waives only the package's own
signature. **The release signs everything** — a `manifest.txt` plus a detached `.sig` per asset,
both verified in the `release` job — because that fallback, a by-hand install and a mirror are
checked against it.

An ed25519 signature is the link that holds and a sha256 alone cannot: GitHub *computes* the asset
digest from the uploaded bytes, so whoever can swap an asset gets the digest recomputed for them.

## Changelog and release

Every commit writes into `## [Unreleased]` **in the same commit as the code**, in both `CHANGELOG.md`
and `CHANGELOG_ru.md` (only a fix to an entry already written skips it) — a
changelog written afterwards is written from the diff, and the diff is exactly what does not know
why. Format, categories and the release runbook: [releasing.md](releasing.md).
