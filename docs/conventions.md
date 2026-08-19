# Conventions

The rules a change to this theme has to follow. Every one of them is a bug that was hit, and
most are enforced by a gate — the gate is named next to the rule so you can check yourself
before pushing.

Read this before your first patch. For what the theme *is*, start at
[architecture.md](architecture.md).

## The two commands

```sh
npm run check        # every gate below, in one run; must exit 0 before you push
owlab test --release 25.12.4 --install 'dist/noarch/luci-theme-footstrap-*.apk' \
  --assert 'package luci-theme-footstrap' \
  --assert 'http 200 /cgi-bin/luci/admin/status/overview'
```

…and the same again with `--release 24.10.8 --install 'dist/all/*.ipk'`. One run per format:
`--install` is a host-side glob evaluated per router, so a pattern matching both hands the apk box
an ipk.

Nothing in `package.json` is shipped. `luci.mk` copies `htdocs/` and `ucode/` verbatim and
never invokes node, and the OpenWrt buildbot has no node at all.

## Keep owlab installed, and run the change on a router

**owlab is required, not a convenience.** Install it once and keep it:

```sh
go install owfeed.org/owlab/cmd/owlab@latest
owlab doctor
```

**A change that alters behaviour is not finished until it has run on a real OpenWrt userland**, on
**both** package managers — 25.12/apk and 24.10/opkg. Not "it should work", not "the gates are
green": run it. `owlab up` gives you four disposable routers from `owlab.yaml`, and
`owlab test` is the local form of the same assertions CI's `verify` job makes. How:
[development.md](development.md).

Why the rule is written down rather than assumed: **every gate in this repository is static.** They
read files. Not one of them opens a page. The classes of bug they structurally cannot see:

- a preference that writes to the wrong place (the appearance axes were gated on their *contract*
  while one of them silently rewrote a router-wide default);
- anything that only appears once a session, a poller or a second browser exists;
- a template that compiles and renders the wrong thing;
- an install path — `postinst`, `uci-defaults`, the marker file, a conffile surviving an upgrade;
- any difference between apk and opkg.

A stubbed harness in node is worth running for what it does prove — that a module initialises, that
an axis stores where you think — but it proves nothing about the router. Say which of the two you
did; do not let one stand in for the other.

**If you genuinely cannot run it** (no Docker on the machine), say so plainly in the commit or the
PR rather than reporting the change as verified. An untested change described as tested is worse
than an untested change.

## Writing CSS

**Read only the private tier.** Every rule in `styles/` reads `--fs-*` and nothing else. The
export names (`--primary-color-high`, `--text-color-*`, …) are defined *from* the private tier
and are for third-party apps only.

```css
color: var(--fs-dim);                                    /* yes */
color: var(--text-color-medium);                         /* no — audit.py --strict fails */
```

Why: `:root` is one shared scope, and every `luci-app-*` puts its CSS in the same document
**unlayered**, which outranks any `@layer`. A hostile `:root` recoloured **312 of 336** gallery
elements before the tiers were split, and 0 after — the measurement and the two tiers are in
[design-system.md](design-system.md).

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
declaration reaches back a layer. Everything else on the allowlist fights something outside the
cascade — `theme/90-responsive` and `pages/20-overview` outrank a `style=` written by `29_ports.js`
and `ui.js`, `theme/45-misc` widens the box the realtime graphs size inline and repaints its inline
black border, `theme/65-dropdown` frees `.hide-close` from a RichListValue's inline `min-width:25vw`,
and `styles/base` keeps the six
`.left`/`.right`/… forcing utilities plus two inline-style fighters. `audit.py` keeps that list
(`BANG_OK`), `.stylelintrc.json` states the reason for each file, `npm run bang-ok` holds the two in
step, and `css-metrics` caps the total at **27**.

**Win on specificity, never on source order.** Two rules with the same specificity where the
later one is load-bearing is the same failure as 220 `!important`, only quieter. Cap:
`[1,7,0]`, held by `css-metrics`.

**Edit the rule that already styles the selector.** Do not append a second one. The shadowed-
declaration counter in `audit.py` is at **0** and stays there.

**No colour literals.** A `#hex` follows neither the palette nor dark mode. The single exception
is `--fs-scrim` — black at .7 is the absence of light behind a dialog, not a shade of any token.

**Stay inside your zone.** There are three: the theme's own chrome (`fs-*` names, `data-fs-chrome`
roots — ours alone, and fenced against foreign CSS); the shared LuCI widget surface (`cbi-*`,
`.table`, `.alert-message` — ours to style, nobody's to own); and another package's namespace,
which the theme never reaches into. `fs-overview.js` used to live in `luci-mod-status`'s global
include directory, where LuCI evaluates every `*.js` — so it was downloaded and run on the
overview of routers using a different theme. It is a chrome module now. The fence that keeps
foreign CSS out of zone one is described in [third-party-apps.md](third-party-apps.md).

**Coverage is a contract.** A selector no stock LuCI page renders still gets styled: some
third-party `luci-app-*` emits it. "Looks unused, delete it" un-styles somebody's app. PurgeCSS,
uncss and any coverage-based trimming are forbidden here. The one safe dead-CSS search is
`css-orphans`, and it is safe only because nothing outside the theme can emit an `fs-*` class.

**Pin a duplicate you cannot merge.** `css-dup` finds identical declaration bodies under
mutually exclusive guards — a shape no linter calls an error and the shape that drifts. Worse,
`css-dup` matches *identical* bodies, so it goes quiet exactly when the copies diverge. Every
duplicate body must be either merged or wrapped in `@mirror`, and `tools/mirror.mjs` then holds
the copies byte-identical. A `@mirror` group with one copy is a hard failure.

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
the corruption is silent. Two gates: eslint's `wrap-regex` forbids the shape, and
`tools/jsmin-verify.mjs` builds the same jsmin and fails unless the token stream of the minified
output matches the source. A backtick inside `${…}` in a template string is out too (jsmin loses
the string, but that one fails loudly).

**Comment as much as you like.** Comments are ~60% of the JS source and none of them ship:
release CI pre-minifies with terser, and a node-less build runs jsmin. Aim for *minimally
sufficient*, not maximally dense — say why, not what.

**A required module is a singleton; there is no inheritance between modules.** `'require X'`
hands you a constructed instance, not a class, so `base.extend` from another module throws
`base.extend is not a function`, and returning a plain object throws `factory yields invalid
constructor`. Compose instead: `menu-footstrap-common.js` exports `init(renderMainMenu)` and
`menu-footstrap.js` injects its renderer as a parameter.

**Require a *stock* class through `window.L`.** The `L` a module factory receives and
`window.L` are different objects, and `ui` hangs its helpers (`itemlist`, `showModal`, …) on
`window.L` only. Worse, `require()` caches by class name, so the *first* requirer fixes the
class↔`L` binding — a theme module that beats the router to a stock class makes the page die on
`L.itemlist is not a function`, intermittently. Use `const RT = window.L; RT.require(name)`.

**`E()` cannot build SVG.** It goes through `document.createElement`, which is the HTML
namespace. SVG in the theme is assembled as a string with fixed markup, and user data goes in
separately via `textContent`. This is a namespace fact, not a style choice.

**All "does it fit?" logic goes in `fs-fit.js`.** One engine, one `ResizeObserver`, one
per-frame coalescer for the whole theme. Do not grow a second observer. Its three rules — measure
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

## Templates and translation

**`msgid` is a GLOBAL name shared with every `luci-app` on the router.** `load_catalog` merges
*all* `*.<lang>.lmo` into one dictionary and returns the first archive with a matching hash, so
**readdir order decides whose translation wins**. The layout switch rendered "Максимум" on a
Russian router because somebody's catalogue translates `Top` that way — correct in a bandwidth
dialog, nonsense on a layout switch.

- Strings on the Footstrap tab: **use a context** — `_(str, 'footstrap')`.
- Chrome (Menu, Logout, Skip to content), login and warning strings: **deliberately no context**,
  so they inherit luci-base's translation in the ~40 languages the theme has no catalogue for.

Nothing here fails loudly: `_()` without a catalogue is just English text. `npm run i18n` fails
if the `.pot` is stale or any `msgstr` is empty.

**Set the custom property BEFORE the attribute.** Every appearance axis is implemented twice —
inline in `partials/head.ut` before first paint (no module loader exists yet) and live in
`fs-prefs.js` — and the order is load-bearing. Reversed, a reload paints exactly one frame in the
previous hue: a symptom nobody reports and no other test catches. `tools/axes.mjs` derives the
contract from the JS and checks the template against it.

## Package and registration

**One entry in `luci.themes`** — `Footstrap` → `/luci-static/footstrap`. Layout, mode, palette,
tint, accent and rounding are client axes (`localStorage` + attributes on `:root`), not theme
entries and not a server choice. Do not reintroduce `-dark`/`-light` symlink themes or
layout-specific entries; `uci-defaults` actively deletes those legacy names.

**Fresh install vs upgrade is decided by a MARKER FILE**,
`/usr/share/luci-theme-footstrap/.installed` — written last, removed in `postrm`. A fresh install
may activate the theme; an upgrade must never change the active one. `$PKG_UPGRADE` does not
work: apk never exports it, so the guard was dead in production.

**`rpcd reload`, never `restart`.** rpcd holds sessions in memory; a restart logs out every LuCI
user including the admin who just clicked Update. `reload` re-reads `acl.d/*`, which is all this
package needs.

**One asset per package per format in a release.** Nothing on a router picks an asset any more —
the installer takes the feed — but a reader that does gets one candidate, not a guess: GitHub
returns assets **sorted by name**, and in v0.8.4 a `luci-i18n-…` package sorted ahead of
`luci-theme-…`, so the self-update script shipped at the time installed a 6 KB catalogue instead of
the theme,
reported success, and offered the same update forever (issue #6). Code already on somebody's router
cannot be fixed remotely; only the release can. CI fails unless each package resolves to exactly
one asset under its name-anchored regex.

**The translation catalogue lives in `po/`.** That is the directory `LUCI_LANGUAGES` globs, so
luci.mk bakes a `luci-i18n-footstrap-<lang>` package per language exactly as it does for every
luci-app — and it is the only directory Weblate, which CONTRIBUTING names as the way to translate
LuCI, can see. It was `i18n/` while a fielded self-update script resolved the theme by name and took
`head -1` (issue #6); that script is retired and owfeed builds the release as one artifact per
format regardless, so the rename no longer bought anything.

**No runtime dependency beyond `+luci-base`.** `curl` is not in OpenWrt's default set (the base
image ships `uclient-fetch`); fall back, do not depend. `jsonfilter`, `sha256sum` and `usign` are
in the base image.

## The trust chain

`install.sh` installs from the owfeed-packages feed, so **the package manager is what verifies the
bytes**: apk checks the index against `owfeed-packages.pem`, opkg against usign key
`9040356b214084da`, and both keys are pinned in the script itself — it runs from `wget | sh` before
any package of ours exists. The script's own fetch of those keys uses a verified TLS channel:
never `-k` / `--no-check-certificate`, and never as a retry, because a failed verification *is* the
MITM case.

The installer no longer downloads release assets, so it carries no sha256, no `usign -V` and no
`--allow-untrusted`. **The release still signs everything** — a `manifest.txt` plus a detached
`.sig` per asset, both verified in the `release` job — because that is what a by-hand install and
a mirror have to be checked against.

An ed25519 signature is the link that holds and a sha256 alone cannot: GitHub *computes* the asset
digest from the uploaded bytes, so whoever can swap an asset gets the digest recomputed for them.

## Changelog and release

Every substantive commit writes into `## [Unreleased]` **in the same commit as the code** — a
changelog written afterwards is written from the diff, and the diff is exactly what does not know
why. Format, categories and the release runbook: [releasing.md](releasing.md).

## The gates, and what each one holds

| Gate | Holds |
|---|---|
| `lint` | eslint over `htdocs/` and `ucode/`, stylelint over `styles/` — correctness only, not formatting |
| `audit` | `audit.py --strict`: undefined `var()`, shadowed declarations, export-tier reads, dead base declarations, stray `!important`, colour literals |
| `css-metrics` | ratchet: `!important` ≤ 27, max specificity `[1,7,0]`, 0 empty rules |
| `css-orphans` | dead `fs-*` selectors — it **gates** the forward direction (styled, emitted by nothing) and **reports** the reverse, where an unstyled class is often legitimate (a JS hook, an element riding on inherited styles). A new name in the reverse list wants a look or a line in `JUSTIFIED_UNSTYLED`; it does not fail the build |
| `acl` | every shipped `acl.d/*.json` parses **and** grants something — rpcd skips an unreadable file silently |
| `css-dup` | identical declaration bodies under different guards |
| `tables` | the table contract: where a cell may break (one allowlist, no viewport queries), the floor holds when a data table is squeezed, a carded cell prints its caption, and no `.cbi-dropdown` sits inside a scroll container |
| `mirror` | `@mirror`-pinned copies still byte-identical |
| `bang-ok` | every `!important` sits in an allowlisted file |
| `axes` | the pre-paint in `head.ut` agrees with the live appearance appliers, and `header.ut` reads every saved option back |
| `scroll-anchor` (live) | grows something above the reader and asserts the page does not move under them — twice, once with the engine's own scroll anchoring suppressed (the Safari path, forced on any engine with `localStorage.fsEngineAnchor='off'`) and once without, so a fallback that also runs where the engine already corrects is caught as well. Plus a scripted flick up and down: the theme may not correct WHILE the reader moves |
| `table-tick` (live) | performs a poll tick on purpose — rows out, rows back in, marks stripped, then a forced layout — and fails if the replaced table was laid out before anything answered for it. The intermediate lasts a microtask, so no sampler can see it: with the stylesheet's gate removed this reports 613px on Обзор@390 and 817px on Processes, and nothing with it in place |
| `page-modules` | the `data-page` → module map in `menu-footstrap-common.js` names the same page each mapped module tests for itself, every mapped module exports the `wire()` the loader calls, and no `'require'` pragma is left for one anywhere — one pragma puts the file back on every page and takes the saving with it |
| `chrome-fence` | the `[data-fs-chrome]` marker, fence and pin still match the chrome |
| `export-tier` | the `--*-color-*` contract: each level readable as text on three surfaces, each `--on-*` readable on its fill, and the ramp is not flat — measured with and without `prefers-contrast: more`, which re-states the inks |
| `css-i18n` | translatable strings emitted from CSS |
| `conffiles` | every shipped `/etc/config/*` is declared a conffile — `/etc/config/footstrap` is written at runtime by Save-as-default, and an undeclared one is replaced on upgrade |
| `changelog` | section set, order, dates, compare links, RU mirror parity, bold leads |
| `i18n` | `.pot` current, no empty `msgstr` |
| `shell` | every shell script in the source tree parses (`sh -n`) — including `release-notes.sh`, which otherwise fails inside the release job |
| `marker` | the `call BuildPackage` literal `include/scan.mk` greps for, without which the SDK does not see the package at all |
| `a11y` | axe-core WCAG 2.2 AA over `docs/gallery.html`, {light,dark} × {footstrap,hicontrast,bootstrap} × {untinted,60°,260°} |
| `test` | the unit suite (`node --test`, no browser): the shipped module is evaluated inside the same wrapper luci.js uses, and its pure logic is driven directly. For the cases a stand **cannot** produce — a luci-base with a surface missing, an alias loop in a foreign `menu.d`, a `firstchild` tie — not as a second opinion on what the stands already cover |
| `size` | ratchet on what the router SENDS: `cascade.css` after `build-css.sh` + the token mangle, and the shipped JS after terser — the package build's own asset half, reproduced. uhttpd serves `/www` uncompressed, so these are wire bytes |
| `icons` | the committed app-icon rasters still match `logo.svg` (per channel, with a tolerance) and still hold the maskable invariants — they are generated by `tools/build-icons.mjs` and cannot be rebuilt on the buildbot |

## The live gates, and why a file cannot answer for a page

`npm run live` — three gates that need a **running owlab router**, which is why they are not in
`npm run check`. Every gate above measures a file; every bug users have reported was about a page:
#11 a column shredded to one character per line, #22 a clipped submenu title, #14 an indicator that
did not fit, #10 phantom scroll from a hidden pane, #12 a doubled scrollbar in one engine, #8/#33/#36
a third-party app laid out wrong, and — reported on the upstream PR — two pages that came back empty
after a client navigation while every static gate stayed green.

| Gate | Holds |
|---|---|
| `upstream` | the coupling registry: every assumption fs-*.js makes about luci-base (`L.Poll`'s alias and queue, `uci.state.values`/`loaded`, `uci.load()` answering "what did THIS call fetch", `network.js` loading its three packages exactly once, `require()` publishing onto `L`, the modal contract, where `addNotification` puts a banner, an open dropdown being `position: absolute`) checked against the luci-base the router runs. Each failure names the module here that was written against it |
| `spa-parity` | every menu page opened BOTH ways — by click and by full load — compared on content, on uci's cache, on `network.getWifiDevices()` and on console errors. No baseline: a difference is always a bug |
| `install-check` | `install.sh` run twice on a stand — fresh, then over its own result — asserting the package is installed, `luci.main.mediaurlbase` points here and `cascade.css` is on disk. Three field reports (#16, #28, #30) were this script alone, all on the second-run path. It leaves the PUBLISHED release installed and re-syncs the working tree afterwards, so it runs last |
| `scroll-jank` | scrolls with a real wheel, long enough that a poll tick lands inside it, in BOTH layouts (they scroll different elements) and on every engine asked for: a table may not re-decide its remedy while the page moves, an element's document position may not change under the reader, and Chromium's layout-shift score for the window must stay under 0.02. The pass the theme defers to the stop is reported in a phase of its own, never failed. Chromium by default; `--engines chromium,firefox,webkit` needs the other two installed |
| `live-audit` | every menu page at 320/390/568/768/1024/1440, each resized into AND one (768 by default) ENTERED with a load of its own — a fault that only exists on arrival is invisible to a resize, which is how a table 65px past its column reached a user; the arrival records only what the resize at that width did not, because a fault both passes see is one fault: sideways document scroll, an element past the content column with no scroller, a clipped non-scrolling box, a sub-24px hit target with a neighbour, an operable element with no name, two stacked scrollports, a JS error. Ratcheted against `tools/baselines/live-audit.json` — a NEW signature fails, and `--update` (read the diff first) rewrites it. That file is a **union across platforms**: a handful of findings sit within a pixel of their threshold and text metrics differ between a maintainer's containers and CI's runner, so six signatures first appeared in CI |

`--engine firefox` and `--engine webkit` run the audit in the other two engines, keyed separately in
the baseline: #12 was Firefox-only, and a chromium run must not bless a finding it never saw.

Two more run in CI only. `tools/jsmin-verify.mjs` needs a jsmin built from the commit in
`luci-upstream.pin`. `ucode -T -c` over every template runs inside the `verify` containers, against
the installed theme with the router's own interpreter — which is also how you run it locally
(`owlab exec … ucode -T -c`), so nothing here has to build one.
