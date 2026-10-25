# The stylesheet: source tree, layers, build

`cascade.css` is generated from `styles/` and is not in git. This page covers how the tree is
organised, how the cascade is kept disciplined, how the build works, and how to prove a CSS
change did what you meant.

Token names and values: [design-system.md](design-system.md). The rules a patch must follow:
[conventions.md](conventions.md).

## One directory per cascade layer

```
luci-theme-footstrap/
  build-css.sh
  styles/
    00-header.css      banner + the single @layer declaration
    02-tokens.css      @layer tokens   private --fs-* tier + the --*-color-* export tier
    03-palettes.css    @layer tokens   palettes (tokens only)
    04-nocolormix.css  @layer tokens   static twins for the color-mix() tokens
    base/              @layer base     widget defaults the views count on
      10-reset  20-typography  30-forms  40-tables  50-chrome
      60-modal  70-buttons  90-widgets  95-luci
    theme/             @layer theme    footstrap's own components and layouts
      10-chrome  15-wallpaper  16-login-bg  20-shell  25-progressbar  30-tables
      35-alerts  40-tabs  45-misc  50-toplayout  55-buttons  60-inputs
      65-dropdown  70-modal  75-search  90-responsive  95-a11y-media  97-print
    pages/             @layer page     per-page corrections
      10-login  20-overview  30-software  40-sshkeys  50-leases  70-syslog
      80-appearance
```

Concatenation order is `styles/` → `base/` → `theme/` → `pages/`, and inside each directory the
numeric prefix is the order.

Palettes are split across two files on purpose: `03-palettes.css` holds only token definitions
and lives in the `tokens` layer, while rules like
`:root[data-wallpaper="pattern"] .fs-main { background-color: … }` are ordinary styles and would
lose to `theme` from inside `tokens`. They live in `theme/15-wallpaper.css`.

The directory cannot be called `src/` — to `luci.mk` that means C sources.

## Layers

```css
@layer tokens, base, theme, page;
```

A later layer beats an earlier one **regardless of selector specificity**. So a `theme` rule
never has to outrank a `base` rule by specificity or by `!important`.

The unlayered level outranks every layer and is deliberately left empty — it is the escape
hatch. `node.css`, which LuCI attaches for individual pages after the theme, also lands there.

### Layer order is fixed by the FIRST mention of a name, and that can be hijacked

`@layer tokens, base, theme, page;` holds the order only while `cascade.css` is the **first sheet
in the document to name a layer**. A name met earlier becomes the *first* — that is, the weakest
— layer, and everything declared afterwards stacks above it. If a foreign sheet carrying
`@layer theme` lands ahead of ours, the order becomes `theme, tokens, base, page`, and `base`,
where `* { padding: 0 }` lives, starts beating the entire chrome.

This is the flip side of the re-host in `fs-sheets.js`: we wrap a foreign sheet in `@layer theme`,
but *where* the package inserted it is the package's choice. Ace (pulled in by `luci-app-ssclash`
and any package with an editor) puts its `<style>` **first child of `<head>`** through
`dom.importCssString`, and lazily — some of it on first hover.

One declaration fixes it: `fs-sheets.js` re-inserts `@layer tokens, base, theme, page;` as a
**new** `<style>`, first child of `<head>`. New specifically — inserting a sheet recomputes the
order, moving an existing one does not. A static declaration in the template cannot help: a
foreign sheet can still land in front of it, so the answer has to be reactive to a `<head>`
mutation.

### `!important` inverts layer order

For important declarations the order is reversed: important in `base` beats important in
`theme`, which beats important in `page`.

`base/` carries **11**: `[hidden]` (it must outrank every layer, "Reset" below), the six
`.left/.right/.center/.top/.middle/.bottom` utilities, whose whole point is coercion, and four that
fight inline `style=` (the zone colour, and the Realtime SVG's `stroke`, `fill` and `text-shadow`).

The rule for a flag anywhere: it must fight **inline `style=`** or an **unlayered `<style>`** an
app injected (`package-manager.js` emits exactly that). Anything else is cargo cult — if a rule
needs a flag to beat *another footstrap rule*, it is in the wrong layer.

The single exception is `theme/95-a11y-media.css`: `prefers-reduced-motion` has to kill animations
declared in `base` as well as `theme`, and only an important declaration reaches back a layer. The
inversion is what makes that file possible.

Flags beyond those that fight an inline `style=` (the PoE line and the traffic figures are those):
the forced-colors focus outline in `theme/95-a11y-media.css` (themed rules set `outline: none` at
up to (0,4,1) or in the page layer, and only a flag reaches them all); the card's two cell widths in
`theme/30-tables.css`, which beat an unlayered sheet (`luci-mod-dashboard` ships one; two flags
because a meter cell needs the whole line and a pair needs half).

## The browser floor

**Chrome 108**, **Firefox 101**, **Safari 15.4** — below that the page is wrong, not plainer.

That floor is set by `@layer`, `:is()`/`:where()`, `:focus-visible`, `svh`/`dvh`, `accent-color`
and the logical properties. Nothing on the list has a fallback worth writing: a theme whose layers
are ignored is not a theme.

An asymmetric inline offset is written as `*-block` plus `*-inline` (`margin-block: 0;
margin-inline: var(--x) 0`), never as a physical shorthand followed by one `*-inline-start` longhand; a corner
shared with an inline-start edge is `border-start-start-radius`.

Six features are used **above** the floor and are progressive — the rule does not apply and the
page is plainer:

| Feature | Chrome / Firefox / Safari | What is lost below it |
|---|---|---|
| `:has()` | 105 / 121 / 15.4 | refinements: port tiles, password control-group, stacked-table footers |
| `color-mix()` | 111 / 113 / 16.2 | the mixed tokens fall back to `styles/04-nocolormix.css` |
| `@container` | 105 / 110 / 16.0 | width adaptations inside `fs-view` / `fs-content` |
| relative `oklch(from …)` | 122 / 128 / 18 | the tint and the accent/status hue axes (the palette's own colours stay). The rules sit under an `@supports` probe of the exact syntax they use. The ink on a hex accent does not depend on it: `inkFor()` in `fs-axes.js` and the `head.ut` pre-paint compute it in JS (two copies that must stay equal), so #ffcc00 gets dark ink in every engine |
| `text-wrap: pretty`, `scrollbar-width` | — | typographic polish |
| `overflow: clip` value | 90 / 94 / 16.0 | `.fs-main`'s `overflow-x: clip` and `.fs-staging`'s `overflow: clip` drop, and the browser's own cross-axis correction (CSS Overflow 3) takes over: a sideways scrollbar on the desktop sidebar's `.fs-main` (its sibling axis is already `overflow-y: auto`) or, in the top/narrow layouts and on `.fs-staging`, whole-page horizontal scroll — exactly how stock LuCI (no `clip` at all) already renders. `.fs-staging` also stays `visibility: hidden` regardless, since nothing inside a staged view sets `visibility: visible` on itself, so nothing is exposed |

Two rules follow.

**A `:has()` part never shares a selector list with a part that has none.** A selector list is not
forgiving: one unsupported compound invalidates the whole rule. `.table.fs-stacked .tr,
.table.fs-stacked tfoot:not(:has(> .tr))` as one rule would cost Firefox 115 ESR `display: flex` on
every stacked card — a broken mobile table, not a missing refinement. Split it, or wrap the list in
`:is()`, which *is* forgiving and drops only the compound it cannot parse.

**A token built with `color-mix()` gets a static twin in `04-nocolormix.css`.** A custom property
keeps any token stream it is handed, so the failure is deferred to the point of use: `background:
var(--fs-good-soft)` becomes invalid at computed-value time and computes to `unset`. That is not a
fall back to the previous declaration — the ordinary two-declaration trick does nothing for a
token, which is why the twins are a file and not a prelude. Tints degrade to `transparent`
(an absent surface never lowers contrast), hairlines to the solid colour they are a fraction of,
and the focus ring to `--fs-focus-ring-solo`, which is mix-free.

Any CSS feature the sheet has not used before has to be placed on one side of this line: hard
(it moves the floor above) or progressive (it joins the table). The JS floor is lower and is not
the constraint: the SPA router uses nothing younger than `ResizeObserver`, and
`requestIdleCallback` is the only feature-detected API (Safari has none); `CSS.supports` is only
wrapped in a try/catch.

Classifying by PROPERTY misses a value with its own support story: `overflow` is ancient,
`overflow: clip` is Safari 16. Most values share their property's support, so the values worth
tracking are a short, explicit list, not every value in the sheet.

### Vendor prefixes still in the sheet

Every prefix earns its place here or it goes — checked against MDN's browser-compat-data and
caniuse, not carried forward on habit. `-webkit-mask-image` is the one that looks safe to cut and
is not.

| Prefix | Why it stays |
|---|---|
| `-webkit-mask-image` / `-webkit-mask-size` / `-webkit-mask-repeat` / `-webkit-mask` | unprefixed masking ships only from Chrome 120; the floor is 108 |
| `-webkit-user-select` (`pages/20-overview.css`, disclosure header) | MDN BCD: unprefixed `user-select` is "preview" only in Safari and iOS Safari; drops once Safari ships it unprefixed above the floor |
| `-webkit-line-clamp` + `-webkit-box-orient` | no standard line-clamp equivalent at the floor |
| `::-webkit-scrollbar-thumb` | no standard scrollbar-styling equivalent at the floor |

The sheet carries no `backdrop-filter` and no `-webkit-appearance` (unprefixed `appearance` is at
or below the floor in every engine).

## The build

`build-css.sh` concatenates the directories and — **without `--dev`** — runs the result through
one awk pass that strips comments and whitespace. That is not cosmetic: uhttpd serves
`/www/luci-static/*.css` with no gzip, so every byte travels as-is. (The package build shortens
the private token names and joins the rules onto one line on top of that — see
[package.md](package.md). The one-rule-per-line form stays the output of this script.)

A file's own `@layer` wrapper is stripped (first line to the `}` where brace depth returns to 0) and
the directory's wrapper emitted once. A rule written after that `}` stays unlayered in the source but
would land inside the layer, so the build exits 1 naming `file:line`; blank lines and comments pass.
The depth count skips multi-line comments and quoted strings, so a `{` in prose or in `content: "{"`
does not move the close.

With `--dev` it is a plain `cat`: the output is byte-identical to the concatenated sources. A
file to read on a router, not one to ship.

One string-aware pass does both jobs, gated by a flag rather than run as two chained awk
invocations over the data. **Comments**: strips `/* … */` except the `/*! … */` banner, which is
Apache-2.0 attribution and is reproduced by trimming it line by line rather than deleting it — a
naive search for the nearest `/*` would eat everything up to the next `*/` on the first
`content: "/*"`. **Whitespace** (skipped when the flag is off): the space after `:`, spaces around
`{ } ; ,`, the **last `;` of a block**, and the newline after each declaration, so the output is
one rule per line. The last `;` is dropped inside the string-aware pass, not by a `sed 's/;}/}/g'`
afterwards: sed does not see strings, so `content: ";}"` or a data URI with the same two bytes would
break.

What the whitespace half never touches, each for its own reason:

- **a single space between selectors** — `.a .b` is a descendant, `.a.b` is not;
- **the spaces around `+` and `-` inside `calc()`** — mandatory: `calc(100% - 8px)` without them is a
  parse error. `*` and `/` take none, below;
- **a newline inside a declaration** — also a space. Joined, a wrapped `calc()` comes out as
  `…))- .004 …`; a minus with no space *before* it is a parse error, the declaration falls away, and
  a token chain built on it (`--fs-tint-c` → `--fs-bg`) silently drops the canvas colour;
- **anything inside a string** — every data URI here is quoted and full of `:`, `;` and spaces.

Selectors and declarations are rewritten in five ways only, each the same selector or declaration
spelled shorter, and never inside a string or a comment:

- **`[attr="ident"]` → `[attr=ident]`**. The quote must open right after `[name=`
  (and its `~ | ^ $ *`), close on the same line right before `]`, and hold a whole ident
  (`-?[A-Za-z_][-A-Za-z0-9_]*`) with no `\` and no `--`: `mangle-tokens.sh` reads an unquoted
  `--fs-` as a name to rename. Values that start with a digit (`"2020"`, `"0"`), hold a
  `%`, `/`, `:`, `.` or `#`, or are empty stay quoted; a `[lang|="en" i]` flag would stay quoted too.
- **The space before `!`**: `red !important` → `red!important`.
- **`::before` / `::after` → `:before` / `:after`**: the CSS2 spelling every engine parses
  and serialises back as `::`, so the CSSOM is unchanged. `::before-x` is left alone.
- **The spaces beside `*` and `/` in a declaration**: `calc(1px * 2)` → `calc(1px*2)`, `16 / 9` →
  `16/9`, `grid-area: 1 / 2` → `1/2`. Only inside a block that holds
  declarations (a style rule, `@font-face`, a keyframe step): a selector (`.a * + *`) and the
  condition of an `@media`, `@supports` or `@container` keep theirs. A space is also kept where the
  join would spell `/*` or `*/`. Custom properties are squeezed too, so `getPropertyValue` reads
  them back squeezed; nothing in the tree reads one.
- **A `flex` triple with a keyword form**: `0 0 auto` → `none`, `1 1 auto` → `auto`, `0 1 auto` →
  `0 auto`, `1 1 <length or %>` → `<length or %>`. Those are the shorthand's own
  defaults, so the declaration computes the same. Left alone: a bare `0` (`flex: 0` is grow 0, not a
  basis), any `var()` or `calc()` basis, and a custom property named `--flex`. `!important` stays.

Two caveats are latent, because nothing in the tree
has either shape: the first three rewrites cannot tell a selector from a declaration, so a
custom-property **value** holding `[x="y"]` or ` !` would change its token stream (script reads it
back with `getPropertyValue`), and the `conditionText` of an `@supports selector([x="y"])` keeps the
squeezed source text, so it reads differently from the plain sheet though it evaluates the same. The
last two do track the open block, and a rule **nested** in a declaration block (native nesting, which
the Chrome 108 floor lacks) fails the build rather than have its selector read as a declaration.
`build-css.sh` is shared with the openwrt/luci copy; upstream follow-up: the last two go there with
the three before them.

**One guard against a broken file** (there is no size budget): braces are counted twice, before
and after compression, and the build fails if the **rule count changed**. The first count only sees
the *input*, always with the flag off (comments stripped, nothing squeezed) so a lone `{` in prose
does not fail a valid `--dev` build; compression is the pass that can corrupt a sheet, so an
unchanged counter is the proof that it did not. The count also catches a truncated write: a cut
right after one of the `@layer NAME { … }` wrappers leaves the braces balanced, but
`RULES_BEFORE` comes from the untruncated concatenation, so a write that stops early comes up short
against it.

An unknown option is an error rather than an output path (otherwise `--devv` would write the
stylesheet to a file called `--devv`).

### How it runs on OpenWrt

`luci.mk` copies only `luasrc ucode htdocs root src` into `PKG_BUILD_DIR`, then calls
`Build/Prepare/$(LUCI_NAME)`. `styles/` is not in that list, so the script reads from `$(CURDIR)`
and writes straight into the build tree — the sources stay clean. It needs only `cat` and `awk`,
so the OpenWrt buildbot builds it with no host dependency.

### Why no preprocessor

No LuCI theme runs one on the buildbot: `luci.mk` can only minify, and there is no `node`/`sass`/
`postcss` there. argon (LESS), aurora (Tailwind + Vite) and fluent (SCSS + Vite) therefore compile
on a developer machine and **commit the built CSS**. `cat` is enough here, so the build honestly
travels with the package.

Multiple `<link>`s are normal practice (stock bootstrap ships `cascade.css` + `mobile.css`) but
buy nothing here: the same total bytes, and `?v=` (`pkgs_update_time`) is one value for the whole
page, so the files cannot be invalidated separately anyway. A runtime `@import` (material's
approach) is worse than a second `<link>` — it is discovered only after the first file is fetched
and parsed, serialising the requests.

## Duplicates CSS cannot merge

Some rules carry identical declarations under mutually exclusive guards (a media query against an
attribute selector, two `@container` thresholds). A cascade-aware reader needs both copies, and
this is exactly the shape that drifts: the moment the copies diverge they stop looking like a
duplicate at all. So every duplicated body is a decision: merge it into one rule, or list it here
and edit both copies together.

| Declarations | Copies |
|---|---|
| `table-card/label`, `table-card/actions`, `table-card/actions-inner`, `table-card/actions-dropdown` | `theme/30-tables.css` (`.fs-stacked`) ↔ `theme/65-dropdown.css` (`@container`) |
| `ind-badge/paint`, `poll-glyph/mask` | two places in `theme/20-shell.css` (the sidebar and the rail) |
| `meter/beside`, `meter/beside-value` | two copies in `theme/25-progressbar.css` |
| `selected-row/paint` | `theme/60-inputs.css` ↔ `theme/65-dropdown.css` |
| `btn-wrap/anywhere` | `theme/70-modal.css` (`label.btn`) ↔ `theme/90-responsive.css` (`@container fs-view`) |

## `:where(#view)`, not bare `#view`

A page-scoped selector in `styles/pages/` anchors on `:where(#view)[data-page="…"]` rather than a
bare `#view[data-page="…"]`, because an id contributes `(1,0,0)` on top of whatever the rest of the
selector already carries, and `20-overview.css`'s deepest chain already sits at the sheet's
`[1,7,0]` ceiling. `:where()` matches the exact same single element (an id is a valid `:where()`
argument) but contributes zero specificity.

Do not widen it to `:where(#view, .fs-content)`: `.fs-content` is `#view`'s ANCESTOR, so a `> div`
arm inside that `:where()` would match `.fs-content`'s children — `#view` itself, a `<div>` per
`fs-router.js`'s `stageView()` — rather than `#view`'s own children.

## Page-scoped corrections

Per-page rules live in `styles/pages/`. Scoping convention: see "`:where(#view)`, not bare
`#view`" above; table folding into cards: see "The card contract" below.

### Login: a definite width, not `max-width`

`sysauth.ut` ships its own template so the login page carries no chrome — the generic fallback
would draw the whole sidebar around a page whose only control is a password field. A modal shape
(`<section hidden>` revealed by a view module) cannot work either: the view runs before a session
exists, every RPC answers "Access denied", and `render()` never runs.

`.fs-login` is a direct flex item of `<body>` (`base/20-typography.css` makes body a flex column
so the footer can `margin-top: auto`), and on the cross axis an `auto` side margin overrides
stretch and sizes the item to fit-content. `max-width: 400px` caps nothing under that rule — the
card collapses to its min-content and the text wraps one word per line;
`width: min(400px, calc(100% - 32px))` is what actually caps it.

The router hostname above the form (`.fs-login-host`) does not reuse the eyebrow tokens despite
sharing their position: those carry `text-transform: uppercase`, and a hostname is a name — case is
the only thing telling two similar names apart on a router farm. `overflow-wrap: anywhere` is there
because the card is a definite 400px and a hostname is one unbreakable token up to 63 characters
long.

The `<h1>Authorization Required</h1>` is `.fs-sr` (clipped, still in the a11y tree) and there is no
description line: the hostname is the card's title at `--fs-type-xl`, and the removed texts repeat
what the Username/Password labels already say. The login page carries no h1 sizing rule.

`.cbi-page-actions` is a column, not the stock block: some auth plugins add a second action
(Reset), and the full-width buttons carry `margin: 0`, so a block layout glues them together with
no gap.

### Leases: nowrap counted from the end, matched by column count not release

Every cell in `.leases`/`.leases6` is `white-space: nowrap` by default (the theme's general rule
lets a data cell break, which splits an IPv4 or a MAC over two lines), and only the long opaque
columns — hostname, the IPv6 list, DUID — are switched back with `white-space: normal` and
`overflow-wrap: anywhere`.

Two upstream facts drive the selectors:

- **`.lases` is upstream's own spelling** for the IPv4 table on 24.10 (`class="table lases"`),
  corrected to `.leases` on 25.12+. Both spellings are matched everywhere; without `.lases` the
  whole file is dead on 24.10 (issue #7).
- **The leading `Interface` column is optional on 25.12+**: `40_dhcp.js` only adds it where the
  router serves DHCP through odhcpd, so every `:nth-child()` would shift by one on exactly those
  routers. The trailing columns are identical either way, so selectors count from the end with
  `:nth-last-child()`:

  ```
  25.12+  .leases   [Interface] Hostname IPv4 MAC DUID IAID Remaining Static
                                    -7     -6  -5   -4   -3      -2      -1
          .leases6  [Interface] Hostname IPv6 DUID IAID Remaining Static
                                    -6     -5   -4   -3     -2      -1
  24.10   .lases     Hostname IPv4 MAC Remaining Static     (no DUID/IAID column at all)
                        -5      -4  -3     -2      -1
          .leases6   Host IPv6 DUID Remaining Static
                       -5   -4   -3     -2      -1
  ```

  Both tables split on the column **count**, tested with
  `:has(:where(.tr.table-titles > :nth-child(6)))`, never on release or class name — a
  one-character upstream fix to `.lases` would otherwise hand the 24.10 table the 25.12 column
  plan (`base/95-luci.css` states this as the general rule for release-conditioned styling). The
  count test is wrapped in `:where()` so it costs nothing: `:has()` otherwise takes its argument's
  specificity, past the sheet's `[1,7,0]` ceiling.

Never match a `data-title` *value* in a selector here: LuCI fills it from the column heading, so
an English literal never matches on a localised router (issue #7), and for rows LuCI builds
from the heading's `innerText`, any transform the theme puts on `.th` rewrites the string the
theme's own CSS would try to match (issue #39).

### Syslog filter bar: two disjoint container queries

`tools/views.js` (LogreadBox: the System Log and every third-party page built on it) and
`view/status/dmesg.js` (Kernel Log) write their filter bar as bare
`<div style="margin-bottom:10px">` rows of label/control pairs, nothing wrapping a pair — inline
flow then breaks wherever the line runs out, which on a phone lands as often inside a label as
between a label and its control.

The fix is one layout, two width tiers, no per-field exceptions: rows are flex, so a wrap can only
fall *between* items, and a label is one unbreakable item. Above 560px the free-text filter
(`input:not([type])` — every other input under `#content_syslog` states a type) grows to fill the
rest of the row; at or below it, every field takes its own line with its labels riding above it
(`flex-basis: 100%`), because wrapping alone fills lines greedily and a leading label would
otherwise ride the end of the previous line instead of sitting above its own field.

The two tiers are **disjoint** `@container` queries — one rule stating each layout in full —
rather than a base rule and an override, so neither can outrank the other by specificity.

`#syslog`'s own `width: 100%` is stated here, above `base`'s generic
`input, textarea { width: 210px }`: stock bootstrap pairs that with `#syslog { width: 100% }` and
wins on specificity, but this theme's generic field box lives in the `theme` layer, and a layer
beats specificity — so the same pair in `base` would lose and render the log as a 210px column.

### Appearance: from popover to page, and what stayed CSS

The controls are an ordinary page: the sections are stock `.cbi-section` cards and the scroll is
the document's. The rows are stock `.cbi-value` and draw no layout of their own — caption column,
field column and the row hairline come from `base/30-forms.css` and `theme/60-inputs.css`, the same
rules every other LuCI form uses, so the theme's own settings page looks like LuCI.

- **No preset colour chips** — the Accent row does the same job with any colour.
- **No hue slider in the colour control** — two controls for one value read as two settings, and
  the slider could never reach a grey. The axis still stores a hue and `03-palettes.css`
  still rotates by it, so a saved value keeps painting.
- **The `data-layout="top"` accordion toggle** hides `.fs-ap-submenus` because those sections are
  hover dropdowns in that layout, already exclusive — hidden in CSS, not by a JS branch, because
  the page is built once and a branch would freeze the control to whatever layout it loaded in.

The disclosure chevron (`.fs-ap-chev`) is the identical glyph the overview's own card toggle draws
(`theme/45-misc.css`, shared, not a page file), one rule serving both hosts (a stock attribute-keyed
element on Overview, a class-keyed one here) through a selector list, so the two cannot drift.

The colour-contrast readout (`.fs-color-contrast` and its three grade colours) is a live number
against the surface the colour is read on (`fs-appearance.js`' `contrastRatio`) — a readout, not a
validation: the theme derives readable ink over a fill but never silently corrects a colour the
admin asked for, so the badge just states the number and grades it. The failing grade is
`--fs-danger`, which the admin may just have recoloured.

### Overview: the disclosure pill, the grid, and the duplicate heading

`index.js`'s `data-indicator="poll-status"` pill is decoration only — the card *header* is the
real control (`fs-overview.js`'s `wireDisclosure()`), so the glyph is `aria-hidden` and
`font-size: 0` hides its "Hide"/"Show" text node. It shares the disclosure chevron rule
with the Appearance fold (see above); `.cbi-title h3, :scope > h3` is matched
because the wrapper differs by release (25.12 `.cbi-title > h3`, 24.10 a bare `<h3>`) and
`[role="button"]` is the anchor either way. 24.10 renders no hide/show control, so the 24.10 arm
is unfired there, not dead.

`fs-overview.js`'s `hideEmptyCard()` marks an empty `.cbi-section` LuCI still renders when a stock
include has nothing to show (title "-", the poll pill its only content), and this drops it. The
stock `<h2>` duplicate of the chrome's own page title is hidden through `.fs-content[data-page=…]`,
not `#view`, because the heading is a *sibling* of `#view` and needs the outgoing page's identity
for the whole staging window (`fs-router.js`'s `commitStage`).

`.fs-ovl` is the grid for System / Memory / Storage (System spans both rows on the left); its
items carry `min-width: 0` so a grid item shrinks to its *track*, not to its content's min-width
— otherwise a long System value (model/firmware) blows the single-column track past a phone.

### Overview: the port-tile reskin

`29_ports.js` (stock `luci-mod-status`) draws its port grid as `.ifacebox` tiles carrying inline
`style=` for zone colour and sizing; every `!important` in this file fights one such inline
declaration, property by property — `page` is the last layer, so a flag that fought only another
footstrap rule would be redundant and is not kept.

Grid sizing: `repeat(auto-fit, minmax(126px, 200px))` would read as "shrink toward 126px when there
are many ports", but `auto-fit` picks the track *count* from the definite *max* of the track
function, so the count is always `floor(width / 200)` and wide columns leave air beside every tile.
`minmax(calc(76px * var(--fs-density-type) + …), 1fr)` asks it the other way: with an indefinite max
the count comes from the min, so the row takes as many tiles as fit and `1fr` shares the remainder.
The 76px floor is the widest traffic figure (`▲ 1024.0 PiB`, nowrap).

The card itself is `flex-wrap`, not a grid with a `@container` threshold (issue #7): a threshold
is a proxy for a *content* question and is calibrated on English — a longer localised status with
nowrap traffic figures overflows under the next card. Flexbox asks the real question for free: the
two cells share a row while they fit. Do not put `container-type` on the card: every
poll-rewritten card then lays out before containment resolves, shifting everything below it on
every tick.

The name row is clamped to two lines with `-webkit-box` (the one shape that both wraps and
ellipsises — `text-overflow` alone only truncates a single line), never three: an unclamped
nowrap name sets the minimum width of every tile on the page. No `min-height: 2lh`: it reserves an
empty line on every name that does not wrap, and the grid already levels the row.

Meter rows (a key/value-shaped `.table` row carrying a `.cbi-progressbar` — Memory, Storage, CPU
load, connections, …) are matched by `:not(:has(.th)):not(:has(.td:nth-child(3))):has(.cbi-progressbar)`,
not per section, so any OTHER key/value-shaped include under `admin-status-overview`'s same
`:where(#view)[data-page]` scope gets the layout too: label + value on one line, the bar on the
next. A data-shaped row — a header cell anywhere, or a 3rd `.td` — is excluded and keeps its own
row layout regardless of section. This is an overview-page rule, not a global one — a same-shape
`.table` off this page (dashboard's Resources tab, any third-party app) gets none of it, just the
base `.cbi-progressbar` default below. The value's own reserve
(`padding-inline-end: min(230px, 50%)`) cannot survive a narrow card, so below 560px the label
takes the whole line and the bar drops to its own line instead.

Row dividers and the key/value weight are dropped only where the table's SHAPE is a real key/value
pair — no header cell anywhere (`:not(:has(.th))`) and no row with a 3rd column
(`:not(:has(.td:nth-child(3)))`) — because a *data* table (one record among many) keeps its
dividers, and naming the cards instead would leave a third-party include of the same shape out.
See "Tables: the key/value discriminator is the table's shape, not a class" below.

### Software: the disk-space bar and the carded package row

The disk-space bar (label + value on one line, bar below) is scoped by `#view[data-page]`, not
`:has(#disk-space-label)` — 24.10 ships no such id. `#packages` is a DATA table
(`<table class="table" id="packages">`, no `.cbi-section-table` class; `fs-select.js` tags it
`.fs-dt` off its `.tr.cbi-section-table-titles` header), so it takes the shared card from
`theme/30-tables.css` once measured too narrow. There is no `@container` guard: overflow is the
trigger and `fs-select.js` measures it.

The package NAME column is `white-space: nowrap` so the column cannot collapse under it:
`overflow-wrap: anywhere` (the default a data cell gets) also lowers a column's min-content to a
single character, and with Version/Size fixed at `nowrap`, auto table layout takes the whole
shortfall out of column 1 and breaks names mid-word. `nowrap` here does not mean "never wrap": it
makes the overflow honest, which is what `fs-select.js`'s measurement needs — where a row genuinely
does not fit, the table cards.

`:not(...)` on the header rows is load-bearing in card mode: carrying an id makes the selector
`(1,1,0)` in the page layer, which beats `theme/30-tables.css`'s
`.table.fs-stacked .tr.cbi-section-table-titles { display: none }` and puts the header back on
screen, where every cell already prints its own label.

A card row is label-left / value-right, which `justify-content: space-between` would normally
spread over the `::before` and the cell's content — but flex makes every ELEMENT its own item, and
this page's filter wraps a match in `<ins>`, so space-between would push a matched name's two parts
to opposite edges. The fix hands all the free space to the label instead (an auto inline-end margin
on the `::before`), so everything else packs flush right in DOM order however many elements the
value is; the inline-end padding keeps a gutter when the auto margin collapses to nothing.
`min-width: 0` / `width: auto` are not restated on `.td`: `theme/30-tables.css` already sets both
on every `.fs-stacked .td`. `text-align: end` is this file's own override of that rule's `start`.

Column 4 (Description) is matched by index, `:nth-child(4)`, not `[data-title="Description"]`: a
translated string never matches on a localised router. Columns: 1 Package name, 2 Version, 3 Size,
4 Description, 5 actions. The cell needs no `overflow-wrap`/`word-break` of its own:
`base/40-tables.css` breaks every cell.

The "Disk space:" caption is keyed on what it sits beside, not on `#disk-space-label` — that id is
25.12+ only (24.10's `package-manager.js` emits a bare `E('label',{}, …)`) — so an id rule is dead
on 24.10 and the caption keeps base's 250px-wide label. The disk section is the only `label`
immediately followed by a `.cbi-progressbar`, the same discriminator `theme/90-responsive.css`
already uses. The selector is `label:has(+ .cbi-progressbar)`, not
`:has(:where(+ .cbi-progressbar))`: a leading combinator makes the argument a RELATIVE selector,
which only `:has()` accepts — `:where()` takes a plain complex-selector list, so wrapping it there
makes the whole rule invalid and the browser drops it silently.

### SSH-keys: the card wrapper and the wide dynlist

SSH-Keys renders as a single bare `<div>` in `#view`, no `.cbi-section` wrapper, so it is given
`theme/30-tables.css`'s card values directly, scoped to this page: a general "card any bare
`#view > div`" rule would also wrap whole tabbed views (Startup).

An `authorized_keys` entry is a ~400-char base64 blob: the one dynlist that must not take
`theme/60-inputs.css`'s 440px cap. The override must live in `page`: in `base` it would be dead,
since a layer beats specificity and `theme`'s plain `.cbi-dynlist` caps it anyway.

## Base layer: LuCI's own markup, corrected

`styles/base/` restyles class names LuCI itself emits with no theme-specific hook — the Meyer
reset, CBI form/table markup, the modal `ui.js` builds, widgets with no generic equivalent. Prefer
`styles/theme/` for anything that is paint; a base edit is for markup this theme cannot route
around.

### Reset: `[hidden]` must outrank every layer, not patch one mistake

The UA gives `[hidden]` the weakest possible `display: none`, so any later `display` set on a
class — `.tr` (table-row), `.td` (table-cell), `ul.nav > li` (block), `.cbi-page-actions` (flex),
`.ifacebox` (inline-flex) — paints straight through it. `[hidden]:not([hidden="until-found"])`
carries `!important` on purpose, so it beats every layer including a page-layer id rule not yet
written; `until-found` is excluded because `display: none` there would break the find-in-page
reveal the value exists for.

### Typography and widgets: an opaque token needs `overflow-wrap: anywhere`, a tooltip needs `pre-wrap`

Opaque, user-supplied strings get `overflow-wrap: anywhere`: a WireGuard public key inside inline
`<code>` (`admin/status/wireguard`, one unbroken 44-char run) otherwise runs past the content column
on a phone — the same escape hatch every other opaque token in the sheet carries (a MAC in a data
table through the general tiers in `theme/30-tables.css`, a hostname in `pages/10-login.css`). A
firewall rule-jump tooltip (`.cbi-tooltip`, "Chain POSTROUTING, Rule #1") is `pre-wrap`, not `pre`:
`pre` disables wrapping outright regardless of where a space sits; `pre-wrap` keeps every literal
whitespace run the rule exists for while still letting the browser wrap once the line is too long.

### Forms: control typography stays in base, on purpose

`label, input, button` font rules live in `base/30-forms.css`, not `theme/`: a bare-element rule in
a later layer outranks every classed base refinement regardless of specificity (the firewall's zone
badges would grow from 10.8px to 13px). In base, a classed rule still wins on specificity, which is
the contract these refinements were written against. `select` is excluded — its face, size and
leading live in `theme/60-inputs.css`. So does the *size* an `input` or a `textarea` types in, as
`--fs-type-field` (the body size on desktop, the 16px iOS floor under 767px, `design-system.md`
"Scales"); base has no classed rule that sets an input's size, so stating it in the theme's generic
field box outranks nothing it should not.

### Forms: the label column's `min-width: 0` survives the responsive layer

`.cbi-value-title` sits in a flex row (`.cbi-value`) at `flex: 0 0 180px`; `theme/90-responsive.css`
restates `flex: 1 1 100%` under 767px but never touches `min-width`, so a value set here on the
desktop rule survives untouched into the phone layout — the cascade only overrides the properties a
later rule actually sets. Without it, a label whose text has too few break points (typically a
translated one) renders at its own min-content instead of the row's width and clips the section
with no scroller.

### Tables: overflow-wrap follows the tier, not the file

`base/40-tables.css` sets `anywhere` on values and `break-word` on headers/first column for every
table this layer reaches (config tables, key/value includes, meter rows) because none of them is
measured and none can card on demand — containment is the only outcome available. The full per-tier
table: "The floor, and why exactly one tier has one", below.

### Tables: roles survive a `display` override

A `display` change on a table part with nothing in its selector restricting it to one rung of the
ladder (a state class, `:not()`/`:has()`, an attribute, an id) touches every such element at once;
each shipped rule carries a ladder class (`.fs-stacked`, `.fs-dt`, `.cbi-section-table`,
`.fs-rowstack`, `.fs-xscroll`, `hide-xs`/`hide-sm`) or the four-way `:not()` fence around the
key/value tables in `theme/30-tables.css`. The same holds for a `.cbi-section` descendant named like
a table part (`row`/`cell`/`col`/`head`/`body`/`foot`/`table`/`grid` as a whole hyphenated word:
`.fs-kv-row` is one, `.fs-ovl-empty` and `.ifacebox-head` are not).

### Tables: the key/value discriminator is the table's shape, not a class

`theme/30-tables.css`'s desktop label/value styling and its ≤560px stacking match a
`.cbi-section .table` only when it has no `.th` anywhere and no row with a 3rd `.td` — a real
key/value row is exactly 2 cells, neither a header. A class test is not enough:
`:not(:has(.tr.table-titles))` catches only `L.ui.Table`'s JS-captioned header, while
`initFromMarkup` binds a stock `<thead>`/`.th` markup table with no such class. Every header LuCI
writes puts its cell class on `.th`, so `:not(:has(.th))` covers `.tr.table-titles` too.

What the shape test catches that `.fs-dt` cannot: a table with no header row at all and a 3rd
`.td` (luci-mod-dsl's `stats.js`, the gallery's log fixture) — `tagDataTables()` needs a header, so
it never tags one — scrolls instead of stacking. And because the test runs in CSS alone, a header
table does not flash key/value styling for the first frame before `fs-select.js` runs and adds
`.fs-dt`.

The overview page's own divider/weight and meter-row rules (`pages/20-overview.css`) repeat the
same test for one consistent discriminator; its DATA-table row-height rule runs the complement of
it (`:is(:has(.th), :has(.td:nth-child(3)))`) so a stock header table under this page's
`.cbi-section` scope gets the data-table padding, not the key/value one. "Overview: the port-tile
reskin", above.

### Tables: the empty-table placeholder must not pin to the table's bottom

`.tr.placeholder > .td` is `position: absolute` so a lone cell in a `display: table` row cannot
widen column one to its own sentence's max-content. It carries no `bottom`: inside
`position: relative` `.table`, `bottom: 0` resolves to the bottom of the whole table, not the
placeholder's own row — and `form.TableSection` renders `footer` into a `<tfoot>` *after*
`<tbody>`, so on an empty section with a footer the plate would print across the totals
(issue #36). With no `bottom` declared the box keeps its static position, which is where the row is.

### Buttons: the flex clearfix, and why `float` is dead on `.cbi-page-actions`

`.cbi-page-actions::after` is not a clearfix — the container is flex, so nothing floats — but the
generated empty item still counts toward `gap`, closing the trailing 8px every button would
otherwise carry past the last real one. `.secondary-action` carries no `float` for the same reason:
`theme/55-buttons.css` makes `.cbi-page-actions` a flex container, and float does not apply to a
flex item.

### Widgets: `.actions .secondary-action` still floats, and needs a hand RTL mirror

`.actions` (the legacy, unthemed action plate some `luci-app-*` still emits) is not flex, so its
own secondary action keeps a real `float: right`, mirrored by hand to `left` under `[dir="rtl"]`
because `float` has no logical keyword this sheet can rely on — `inline-end` needs support this
sheet does not yet require, and a browser that does not know the keyword drops the declaration and
leaves the button floating nowhere. Unmirrored it also fights its own container: `.actions` sets
`text-align: end`, which follows writing direction, so in RTL the plate's alignment and the button's
float would point opposite ways.

### Widgets: the tooltip parks past the unreachable edge, and the close cross needs the same mirror

`.cbi-tooltip`'s hidden position is `inset-inline-start: -10000px`, not a physical `left`: in an
RTL document a physical `left: -10000px` parks the tooltip past the scrollable *inline-end* edge,
which grows a 10000px horizontal scrollbar on every ar/fa/he page; the inline-start edge is
unreachable in both directions. `.close` carries the same hand-mirrored `float` as `.actions`
above, for the same reason (no reliable logical keyword) — unmirrored, the dismissal cross lands in
front of the title rather than past it in RTL, in every modal and every `.alert-message`.

### `base/95-luci.css`: the GridSection name column, read from the markup, not the release

25.12's `form.js` renders a GridSection's name as a real `<th>` plus
`td.cbi-section-table-titles`; 24.10 renders no such cell and expects `::before` to generate the
column from `data-title`. Each row type is discriminated by what it carries, never by release: a
header row carries `data-title` on 24.10 only (25.12 appends the real `th` instead); a data row
carries `data-title` on both, so the discriminator is whether the row has that extra name cell; a
description row has neither and simply follows whichever branch its header already proved. Keying
on the header's *value* would break on a translated build, since `data-title` there is `_('Name')`.
The `:has()` branch sits in the shared list wrapped in `:is()` (`:is` outside `:not`), which is
forgiving: an engine that cannot parse it (Firefox <121) drops only that branch and not its plain
siblings — bare in the list, one `:has()` failure would take stacked-table card labels down
with it everywhere.

### `base/95-luci.css`: the dark-mode zone tint, and why it has no grey fallback

`[data-darkmode="true"] .zonebadge[style]` re-mixes `luci-mod-network`'s inline zone colour at
`.4/.3` because a raw zone colour is too bright on a dark panel. `--zone-color-rgb` carries no
fallback on purpose: LuCI sets that variable inline only where a zone colour exists, so elsewhere
the declaration is invalid at computed-value time and, being `!important`, resolves to `unset` and
lets the plain inline background show through — a fallback grey would instead apply the rule
everywhere and tint interface boxes that should just show the panel behind them.

### `base/95-luci.css`: the overflow-wrap fix generalised once, not restated per page

`.ifacebox-body`, `.network-status-table .ifacebox-head` and the same pair on the port tiles all
need `overflow-wrap: anywhere` (not `break-word` — only `anywhere` lowers the box's own
min-content, letting a flex item actually shrink) because their labels are not one short word: a
stat line ("1000 Mbit/s / 1.2 GiB / 8.3 GiB") or a translated caption overflows a narrow box with
no scroller. It is set once on `.ifacebox .ifacebox-body` rather than as one scoped copy per page.

### `base/95-luci.css`: the spinner glyph sits in the flow, on purpose

`.spinning::before` reserves its own space with `flex: 0 0 auto` (or `vertical-align: middle` on a
non-flex host) instead of being absolutely positioned with a compensating `padding-left` on the
host — that padding cannot be won by any one rule, since every padding declaration aimed at the
button is a candidate and the loser draws the glyph on top of the label (issues #15 and #22). In
the flow, no host needs a padding and there is nothing to out-rank. Rotation stays a plain CSS
`animation`, never an SVG-internal `<animateTransform>`: that runs in the SVG's own document, out
of reach of the page's `prefers-reduced-motion` query.

### `base/95-luci.css`: the file browser's floor, and the row that is not text

`.cbi-filebrowser`'s `min-width: min(210px, 100%)` keeps the file list readable without becoming an
overflow itself: a bare `210px` floor would stand wider than the field at a 300px viewport (same fix
as the dynlist's floor one file over). Its child rule assumes every row is one line of text
(`nowrap` + ellipsis); `.right` breaks that assumption — its content is the upload strip plus
Create/Cancel, none of it text an ellipsis can stand in for — so it is excluded: inherited `nowrap`
would block the wrap the Browse button already has (`flex-wrap: wrap`), and `overflow: hidden`
would clip Cancel's label with no "…" drawn.

### `base/95-luci.css`: Statistics graphs and Realtime SVGs are art drawn for a white ground

Statistics renders its collectd graphs as PNGs authored for a white background, so dark mode
inverts them: `hue-rotate(180deg)` is arithmetic, not taste — `invert()` maps every hue to h+180,
so rotating 180 back restores the original hue while keeping the inverted lightness. 180deg lands
all three primaries exactly; a non-primary (amber) still lands slightly off, because CSS
`hue-rotate` is a linear matrix approximation.

Realtime graphs (Status -> Load/Traffic) inject `resources/svg/*.svg` with inline `style=`
attributes drawn for a black background the theme does not use: the grid `<line>`s carry
`stroke:black`, invisible on a dark panel, and only an author `!important` beats an inline
declaration. The axis `<text>` labels need the same override plus a bold weight — the file's own
9pt grey-on-black-halo pairing is legible on white only via its halo, and on the dark panel it is
the halo that must go instead; the SVG's 9pt is the smallest type this theme renders. The
child-combinator selector (`> text[style]`) matters because Channel Analysis colours its SSID labels
the same way it colours their curves, built inside a nested `<g>` — a descendant selector would
recolour the curves along with the axis; only a direct child reaches the axis alone.

## Theme layer: components absorbed and fixed

`styles/theme/` is footstrap's own component paint: files 60-97 cover form controls, the
`.cbi-dropdown` menu, buttons, the modal, search, the responsive breakpoints, forced-colors/
reduced-motion, and print. Each section below is the reason a comment in that file points at.

### Meter: the value's line is reserved in flow by default, not floated on faith

`.cbi-progressbar`'s value is an absolutely-positioned `::after` (`content: attr(title)`), floated
above the bar's top edge so a thin track never grows into a fat pill. The bar therefore reserves
one line in flow by DEFAULT (`margin-block-start: calc(var(--fs-type-xs) * var(--fs-leading))`, the
same expression `.fs-stacked` and the overview `<=560px` rule use), following upstream
`luci-theme-bootstrap`'s model — otherwise, in a key/value `.table` row with no context rule
(`luci-mod-status`'s `20_memory.js` markup, reused by `luci-mod-dashboard`'s Resources tab), the
value prints across the divider of the row above.

Only the contexts that deliberately place the value BESIDE the bar (`.cbi-value-field`, a data
table's meter column — the two `meter/beside` copies) or on a neighbour's line (overview's meter
rows at desktop, the package-manager disk bar at both desktop and phone) opt out with
`margin-block-start: 0`. Everything else — the gallery's bare meters, a third-party app's key/value
table — takes the default and reserves its own line.

### Inputs: the toggle switch, drawn on the input, not the label

The switch is drawn on the real `<input>`, not on `label[for]`: apps with CSS built the way
bootstrap expects (luci-app-modemdata) inject an unlayered `label[for] { display: none } !important`
scoped to their own markup, and with the switch on the label nothing would be left visible. Drawn on
the input, an app that hides `label[for]` hides an already-empty placeholder; `label[for]` stays in
the DOM (`ui.js` and third-party apps emit it) as the out-of-flow element.

`flex-shrink: 0` exists because a caption after the pill —
`label.cbi-checkbox > input + label[for] + TEXT`, package-manager.js's and banip's real markup —
makes the input a second, shrinkable flex item. Shrunk, the pill narrows below `--sw-w` and the knob
overhangs its edge; unshrunk it stays exactly `--sw-w`.

The knob sits at `inset-inline-start`, but its travel is a `translateX`, which is physical: under
`[dir="rtl"]` the travel (`--sw-travel`) is negated, or the checked knob would leave the pill on the
right.

### Inputs: `.hidden.hidden`, and the Tailwind/UnoCSS exception

`fs-sheets.js` (`rehostIntoThemeLayer`) re-hosts a foreign app's own sheet into `@layer theme`,
where it competes on specificity instead of losing to an unlayered rule by layer order alone. There
`.hidden.hidden` would outrank a responsive utility such as `.lg\:flex` at (0,1,0) and keep
`<aside class="hidden lg:flex …">` (luci-app-splify2) hidden at every width.
`:not([class*=":"])` excludes any class list carrying a Tailwind/UnoCSS responsive variant (the
colon in `lg:flex`, `md:block`, `sm:inline`) from the invariant — LuCI itself never emits a class
containing `:`, so nothing stock is affected. The rule is (0,3,0) — `:not()` counts its argument's
attribute selector, (0,1,0) — still clear of `input[type="submit"]` at (0,1,1) (issue #12).

### Inputs: the range slider's hit target and its line-box

`.cbi-range-slider` is the one control where growing the native `<input>`'s box for the WCAG 2.5.8
target (24px) also grows the row around it, and not through the slider's own cross size (pinned at
29.5px by the value chip beside it). `.cbi-value-field` lays the slider out as ordinary inline
content, and the line's height follows where `.cbi-range-slider` (inline-flex, no
baseline-participating child) reports its baseline — which tracks the first flex item's own edge,
the input, whose box moves with the target.

The fix is two parts. First, the checkbox's own trick on the input itself: grow the box to 24px,
then pull the extra area back out of flow with a symmetric negative margin (`margin-block: -9px`,
the 6px track box plus 9px each side) so it overflows around its centre rather than pushing
anything taller. That alone does not stop the row growing, since `.cbi-range-slider`'s line-box
placement tracks the input's edge, not the flow space the margin frees. Second,
`vertical-align: middle` on `.cbi-range-slider` places it in the line by its own total height
instead, held by the margin trick at 29.5px regardless of the input's growth — decoupling the two.

### Inputs: the select chevron mirrors by hand, and its two bands swap

`--fs-select-chevron` is two 6px gradient bands, painted by `background-position`, which has no
logical keyword — so under `[dir="rtl"]` (`theme/60-inputs.css`) the positions flip to `left` by
hand. The offsets must also swap between the two layers: mirrored as they were, the band that leans
left would sit on the right and the chevron would draw as an inverted V. The padding that clears
the chevron is `padding-inline-end`, so the text clearance follows the writing direction on its
own.

### Dropdown: the display state machine, unflagged

`.cbi-dropdown` show/hide rules carry no `!important`; the resolution is stated by specificity.
Every shower out-specifies the hider it overrides: `li[display]` (0,2,2) over the plain `li` hider
(0,1,2); `[open] > ul.dropdown > li` (0,3,2) likewise; the placeholder rules (0,5,2 and 0,6,2) over
the placeholder hider (0,4,2); the form rule (0,4,3) over its hider (0,1,3). `[empty]`'s block
(0,2,2) loses to `[open]`'s flex (0,3,2) deliberately — an open empty list still lays out as a
popup.

### Dropdown: ellipsis needs `min-width: 0` first

`text-overflow: ellipsis` alone does nothing: a flex item's automatic minimum floors it at its own
content width until `min-width` says otherwise, so `overflow: hidden` never engages and a long value
runs past the box instead of eliding. No `title`/`aria-label` stands in: the full string stays in
the DOM and the accessibility tree so a screen reader still gets it whole — a `title` is not
announced on touch, and an `aria-label` carrying the SHORTENED text would violate WCAG 2.5.3 (the
accessible name must contain the visible text).

### Dropdown: the open list's rail and the selected-row's contrast

The selected row's surface is OPAQUE (`--fs-panel2`) and the accent is carried by an inset rail, not
by a tint of itself: accent text on `--fs-accent-soft` falls under AA in dark — the tint drags the
background toward the text and eats its own contrast. The focused row's ring is inset rather than
the token's outer 3px because the menu clips its own overflow and an outer ring is cut on the first
and last rows; both the `[selected]` and the plain `:focus-visible` selector carry `[selected]`-level
specificity on purpose, or a bare `li:focus-visible` would tie with the selected-row paint and leave
the focus ring to source order.

### Dropdown: 992px, not 960

Below ~960px of available width a multi-dropdown row no longer fits, so each config row cards — the
same shape as the data-table stack (`theme/30-tables.css`), and a `@container`, not the measurement
the data tables use: these rows are full of widgets that bake in a width from the layout they were
rendered in, so un-collapsing one to take a reading CHANGES what is read.

992, not 960: the query reads `.cbi-map` (`theme/45-misc.css`), one level above the `.cbi-section`
that actually holds the table, and that level spends `--fs-card-pad` on both sides, 32px at the
density every page but Compact ships. `992 = 960 + 32` makes the check ask whether the SECTION's
own content, not the map's, has cleared 960px; at 960 a table whose section was just under it never
carded and clipped its header row with no scroller.

### Misc: the realtime graph bleed

`Status -> Realtime`'s graphs size their drawing from `#view`, not from the box they draw into:
`width = document.querySelector('#view').offsetWidth - 2`, in every realtime view and in the
`luci-app-*-status` copies of them. That assumption holds only in a theme whose `.cbi-section` has
no gutter; footstrap's is a card, 16px of padding plus a 1px border, so the canvas comes out 34px
narrower than the drawing — and the views draw NEWEST-first from the right, so the freshest samples
are the ones falling off the edge. The fix bleeds the graph box back out to the card's border edge
with an `!important` fighting the inline `width: 100%` the view writes, since nothing in a cascade
layer can outrank an inline declaration (issue #32).

### Misc: fade-in animates nothing, on purpose

`fade-in` is upstream's class, and `luci-mod-status` re-marks every section AND the wrapper holding
all of them with it on EVERY poll tick, so anything this theme hangs on that class replays across
the entire content column on every tick and moves or pulses a still page under the reader. The
class therefore animates nothing: it stays in the markup, being upstream's, and the `fade-in`
keyframes in `base/95-luci.css` stay for the coverage reason stated there (some third-party app may
still trigger them outside a poll).

### Toplayout: measured, not media-queried

`theme/50-toplayout.css` is a DELTA, not a layout: the top bar itself (sticky, row, popup
submenus, square icon buttons, the right cluster) is the unguarded base in `theme/20-shell.css` —
that is what the chrome IS unless the vertical sidebar overrides it. This file adds only what the
top-layout bar wants on top of that: a designed bar height, padding aligned to the content column,
and the menu riding the brand's row instead of wrapping beneath it.

There is no `@media` floor because "does the menu fit on the brand's row?" is a property of the
CONTENT (5 sections stock, more with a few `luci-app-*`), not of the viewport — a hard-coded
breakpoint gets it wrong in both directions for a router with an unusual section count. `fs-chrome.js`
(`fitChrome`) measures instead: it shrinks the pills, collapses the poll pill to an icon, then stacks
the menu onto its own row (`.fs-bar-stack`), all at any width. The under-item dropdown and its clamp
apply at every width for the same reason and live with the bar in `20-shell.css`, not here.

### Buttons: the page-action bar wraps, not shrinks

`.cbi-page-actions` WRAPS rather than letting its items shrink into it. Save/Reset are plain text
with no ellipsis, so their min-content protects them — a no-wrap row's shrink factor lands entirely
on the Save & Apply split control, whose caption DOES have an ellipsis to give
(`theme/65-dropdown.css`) and so absorbs the whole squeeze.

`flex-wrap: wrap` sends the split control (or Save+Reset) to its own line once they no longer fit
one, so the caption is squeezed only by its OWN box, never by a sibling's. The caption still owns an
ellipsis for the genuine edge it cannot solve — a long translated caption at Large density in a
320px column has nowhere left to grow even alone on its line.

### Buttons: `flex-basis: auto`, not the definite basis base gave every row action

There is no `.td .cbi-button, .td .btn` rule: the action cells (`form.TableSection`'s
`.td.cbi-section-table-cell.cbi-section-actions`) are reached by
`.cbi-section-actions .cbi-button`/`.btn` — `.cbi-section-actions` sits on the `.td` itself — and a
bare `.td` would also catch every OTHER button in every OTHER cell (the rail drag handle, a
plain-cell "Reserve IP" in DHCP leases).

`base/95-luci.css` sizes each button `flex: 1 1 4em` inside `.td.cbi-section-actions`. With
`overflow: hidden`, a DEFINITE flex-basis makes the automatic minimum resolve to 0 in every row
regardless of room, so `flex-grow` divides by count instead of by need and ellipsises captions
where nothing needed to shrink. `flex-basis: auto` hands sizing back to CONTENT: the automatic
minimum is the caption's own min-content again and `flex-grow` only redistributes genuine slack.
`overflow: hidden` plus the ellipsis still cover a row genuinely narrower than its captions'
combined content: the caption gives (ellipsis), never the neighbour's box.
`.cbi-page-actions`'s `flex-wrap: wrap` does not reach these: that selector is the Save/Apply
footer, not a table row, and this is a different container with no line to wrap onto.

### Modal: no horizontal scroll, ever

`#modal_overlay` is the scroll container (`base/60-modal.css`, `overflow: auto`) and the dialog is
centred in it with `margin: auto`, so one over-wide child scrolls the modal's own left edge off the
screen — the dialog still there, just unreachable-looking.

Two children do it, both stock LuCI markup. `<label class="btn">` — `flash.js` writes each checkbox
row as one, and `.btn` is `white-space: pre`, right for a button's own label and wrong for a
sentence, so it cannot wrap at any width (scoped to `label`; a real button keeps `pre`). And a `<li>`
carrying a checksum, one unbreakable 64-character token. `overflow-wrap: anywhere` goes with
`white-space: normal`: normal alone lets the sentence wrap at its spaces, not enough for a label
ending in a long path token. `min-width: 0` is the other half — without it the wrap never fires,
since `.btn` is `inline-flex` and the label is a flex CONTAINER whose automatic minimum is its
content's min-content.

`anywhere` rather than `break-word` follows the tier doctrine (`base/40-tables.css` states it for
cells): `break-word` leaves min-content at the widest token, wider than the dialog at 320px, and the
anonymous text flex item cannot be given a `min-width` of its own — a dialog label has no card to
fold into.

### Responsive: a split button's label must wrap under 360px

`white-space: pre` on a button is stock — luci-theme-bootstrap sets it too — and it holds while the
label is short. Footstrap's buttons are wider than stock's at the same job (a wider face and 14px
side padding), so a long translated split-button caption (ssclash's "Сохранить и перезагрузить
конфигурацию") inside an app's `inline-flex` wrapper overflows a 288px column.

Narrowing the buttons would be re-typesetting the theme to suit one app. Letting the label wrap
costs nothing where it already fits — a short label has no wrap point — and turns the one case that
does not into two lines. Scoped to `@container fs-view (max-width: 360px)`. `min-width: 0` goes with
it, or the automatic minimum keeps the button at its longest word and the flex line cannot shrink it
at all. Buttons carry no `word-break: break-all` (`base/10-reset.css`): it would break the label
mid-word once it can wrap. `overflow-wrap: anywhere` keeps the escape hatch for a single word wider
than the button; unlike `break-word` it also lowers the min-content, so an inline-flex button can
shrink to the column.

### Responsive: no `display: block` on `table.fs-dt`

Never give `table.fs-dt` `display: block` at phone widths. `display: block` on a `<table>` DISCARDS
the table formatting context, so the rows are wrapped in an anonymous table sized to the block and
the table can never be wider than its parent — which means it can never overflow, which means
`fit.overflows()` can never see anything below 767px, and the measured design stops working there.

### Tables: one frame for every `.fs-dt`

The frame, corner, placeholder and cell-padding rules in `theme/30-tables.css` select
`:is(table, div).fs-dt`, not `table.fs-dt`, so a div-based table outside `.cbi-section` and without
`[id]` (luci-app-roamd, GitHub #67) gets them too. Without them it keeps the generic
`.table { overflow: hidden }`, becomes the sticky header's scroll container, and its `.th` sits one
bar-height over the first body row. `overflow: clip` on the generic rule is not the fix: it clips
popups.

The key is `:is(table, div).fs-dt` and not `.table.fs-dt` because of specificity: `:is()` scores its
most specific argument, so `:is(table, div).fs-dt .td` is (0,2,1), exactly `table.fs-dt .td`, while
`.table.fs-dt .td` is (0,3,0). An app's column padding is fenced into `@layer theme` (`fs-sheets.js`),
so it meets this rule in the same layer; luci-app-filemanager `#file-table`'s `.table td:nth-child(1)`
(0,2,1) ties with this rule and keeps its own padding by source order; against (0,3,0) it would
lose. Eight keys carry the
`:is(table, div).fs-dt` form: padding `.td`/`.th`, the frame, four corners, the placeholder. The break
floor, the `!important` word-break, the sticky header, `overflow-anchor`, the fit gate
(`:root[data-fs-fit] … .table.fs-dt:not(.fs-fitted)`) and the `.fs-stacked` card rules use
`.table.fs-dt`. `fs-select.js` tags `.table, table` with `fs-dt`; the form is `table` or `div` in
practice, a `.table` on another tag would match neither. The `table.fs-dt` selectors in
`pages/50-leases.css` are leases-only real tables.

### Responsive: the disk gauge value moves below the bar

The bar's `::after` value ("63% used …") normally floats above the bar, but the System page's "Disk
space:" label already sits there — on a phone the long value text overlaps label and bar. The bar
is a fixed 10px box, so a static `::after` cannot push the next control: reserve space with
`margin-bottom` and place the value absolutely in it. The disk section is the only `label`
immediately followed by a `.cbi-progressbar`.

### A11y: prefers-contrast token shifts, and the numbers behind them

`prefers-contrast: more` asks for MORE contrast but, unlike `forced-colors`, leaves the palette to
the theme. Same mechanism as any token shift: re-state the tokens and every rule that
reads them follows.

- **the hairlines**: `--fs-border` is the most-read line in the theme and sits at ~20% of the
  text's contrast, so it is pulled toward `--fs-text`. The role hairlines (`-line`/`-line-hi`, a
  40/55% tint of their role) go to the FULL role colour — a tint exists to be quiet, the opposite of
  what this user asked for.
- **secondary text**: `--fs-dim` toward `--fs-text`, and `--fs-faint` most of the way there too
  (10-11px eyebrow labels are where AA erodes first). Not all the way onto `--fs-dim`: the two are
  the export tier's `--text-color-medium` and `-low`, so collapsing them republishes one colour
  twice to every app reading the gradation. 82% is a measured window: below 80 the fainter ink drops
  under AA on footstrap dark's `--fs-panel2`, above 82 the high-to-low ramp falls under the 0.10
  spread the tier promises.
- **`--fs-placeholder`, in BOTH modes**: the one token the theme ships deliberately under AA
  ([design-system.md](design-system.md), "The fourth ink"). A reader who asked for
  more contrast has said which of the two they want, so the mixes go back to the AA-clearing 62% and
  80%. Only `--fs-placeholder-mix` moves: the mix itself is spelt once, in `03-palettes.css`.
- **the focus ring**: `--fs-focus-ring` is a tint of the accent (`--fs-accent-soft`, 10% light and
  15% dark), so at "more contrast" it carries the accent at 60% instead. Its sibling
  `--fs-focus-ring-solo` is already the solid accent and needs no restatement here.

### A11y: forced-colors state repairs

Windows High Contrast forces `background-color` on most elements to the system canvas, so any state
carried by BACKGROUND alone vanishes: the active tab pill, the checked toggle and the selected
dropdown row all look exactly like their inactive siblings, which is a correctness bug rather than a
cosmetic one. `.ifacebox-head.active` and Apply join the tab/dropdown list rather than getting a
rule of their own, being the same KIND of state — carried by a background, with no word to fall back
on — and the same repair: otherwise "this port is up" is indistinguishable from a dead port, and
Save & Apply does not read as a BUTTON at all (it is a `.cbi-dropdown` wrapper, so with its fill
forced to Canvas only the label inside the `<li>` keeps a highlight). Not extended to the alert and
`.label` variants: encoding severity in border-style is not a scale anyone can learn, and the honest
repair is a word or an icon in the markup, which is `ui.js`'s.

The `#topmenu` active item carries its state in exactly the two things forced colors drops, a
10%-alpha accent background and the box-shadow rail, so the current page would not be marked at all
for a sighted user (`aria-current="page"` is on the link). The rail comes back as a real border,
which forced colors keeps.

A glyph drawn as a background fill cut out by `mask` goes the same way: the fill is Canvas, the glyph
is Canvas on Canvas, and the box holds no ink — the poll glyph disappears, and a checked native
checkbox or radio looks like an unchecked one. The repair gives the fill back in a system keyword
with `forced-color-adjust: none` on exactly those boxes, since here the fill IS the glyph:
ButtonText while polling and GrayText when paused for the poll glyph (the state its green and grey
carried), ButtonText for the check and the radio dot and for a button's spinner, CanvasText for the
help icon and a bare spinner, which sit on the page like text. The wallpaper pattern
(`15-wallpaper.css`) is the one masked fill left alone: decoration that is meant to drop out.

## The card contract: what is measured and what is not

A table folds into cards by two different mechanisms, and that is not an unfinished job.

**A data table is measured.** `fs-fit.js` (through `fitTables` in `fs-select.js`) removes the
class, reads the width, decides, and sets `.fs-stacked`. The decision depends on what the table
needs, not on the screen, so `@media` cannot express it: cards can happen at any viewport
width. Measuring is safe because a data table holds no widgets.

**But a measurement is never taken while the reader is scrolling, and a table that has not been
answered for takes no room.** The poll REPLACES these tables, so every tick hands the fitter an
unmarked element that would lay out full-width for a frame — several screens taller on a phone than
the card stack it is about to become — and a fit pass reading layout once per table in the middle of
a flick is exactly the work iOS holds the main thread back to prevent.

So every pass registers with `fit.add()`, and a pass that reads layout first asks `fit.scrolling()`:
while the reader scrolls it calls `fit.deferMeasurement()` and is re-run when they stop. Marking a
freshly arrived table cannot wait, because
`:root[data-fs-fit] .table.fs-dt:not(.fs-fitted) { display: none }` keeps an unanswered table out of
the layout until it has an answer. During a scroll `fitTables()` takes that answer without
measuring, from the SLOT: the section frame survives a poll tick, so the table that was replaced
left its decision there, keyed by column count and room (with no slot yet, it stacks only if the
content column is under `CRAMPED`). The guard on `:root[data-fs-fit]` is what makes the rule
safe: the attribute is written by the module that CLEARS the rule (`fit.armGate()`), so a document
where that JS never ran shows every table as a plain table.

**And a table this rule is still hiding may not be judged.** A `display: none` box has no content
width, so a pass over a table with no slot to inherit from reads `scrollWidth: 0`, and 0 overflows
nothing — caching "no remedy" would show the table at its natural width, clipped by
`.fs-main { overflow-x: clip }` with no scrollbar. A second pass would only come if something
mutated `#view` again, and a page that renders once and stands still never does. So `fitTables()`
treats a zero measurement as no answer at all — it lifts the gate, asks for one more frame
(`fit.schedule()`), and writes nothing to the slot.

**A config table (`.cbi-section-table`) is not measured and must stay on
`@container fs-content`.** Its rows are full of widgets (`fs-select.js` turns every `<select>` into
a `ui.Dropdown`), and a widget bakes in the width of the layout it was laid out in — so unfolding it
to take a reading **changes what you are measuring**: the firewall zone table, measured that way,
claimed far more width than it needs and overflowed its section, an overflow the pure-CSS version
never has. **The act of measuring was the bug.** Do not "finish the job". The threshold is 992px,
not 960: "Dropdown: 992px, not 960".

The price is the last irreducible duplicate: the same declarations under a class and under an
`@container`, which CSS cannot factor apart (`table-card/*` in "Duplicates CSS cannot merge").

### Which of the three a table gets, and what decides it

Every `<table>` or `<div class="table">` under one of the two content roots — `#view`, and the
`#modal_overlay` that `ui.showModal()` builds its dialog in — lands in exactly one of three tiers, and the
discriminator is **does it have a header row**, never who wrote it:

| Tier | Reached by | What it does |
|---|---|---|
| measured card | a header row **and** not `.cbi-section-table` → `fs-select.js` tags `.table.fs-dt` | folds into labelled cards when it stops fitting, at any width |
| `@container` card | `.cbi-section-table` | folds at 960 px of content, never measured (above) |
| scroll | no header row at all | `display: block; overflow-x: auto` on the table itself |

**Both roots.** The dialog is a sibling of `#view` on `<body>`, so a table in it would otherwise
never be tagged, captioned, measured or re-measured when the dialog replaces its rows (the wireless
scan dialog's table overflows a phone dialog and prints one character per line). The roots are
listed once in `fs-select.js` (`ROOTS`) and every query is built from them, because three selectors
that each name the same two places are three chances to fix only two.

**A dialog is a root only while it is open.** `hideModal()` drops `modal-overlay-active` off `<body>`
and leaves the markup where it is, and the hidden overlay shrink-fits to a width nobody will see.
Measuring that is both waste (every pass, on a polled page) and a wrong decision, so the pass asks
per-pass whether the dialog is open (`liveRoots()`). The flag flips **after** `showModal()` writes
the content, so `fs-fit.js` watches `body`'s class as well as the two subtrees; without it a
dialog's table would wait for its next poll to be fitted.

A header row is any of four markups: `.tr.table-titles` (`L.ui.Table`),
`.tr.cbi-section-table-titles` (the apk Software list), a `<thead>` — E()-built, so its `<th>`s may
hang off it directly with no `<tr>` — and a first row made entirely of `<th>`, which is what a
foreign app writing plain HTML emits. `labelCells()` then **copies** the heading of the column each
cell sits in into `data-title`, which is what the card prints above the value; it never overwrites
one the app set, and it counts COLUMNS rather than cells so a `colspan` does not shift every caption
after it by one.

The third tier is the deliberate refusal. A card prints `attr(data-title)` above each value, and a
matrix — a log, a statistics grid, a layout table — has no headings to print, so carding one yields a
column of numbers with nothing saying what they are. Comparison is that shape's whole point, so it
scrolls instead. **The scroll rule is not scoped to a phone**: whether a table fits is a property
of its content and its column, and a 400 px panel on a 1600 px desktop hits the wall a phone hits.
It costs nothing where the table fits — `overflow` paints a scrollbar only when there is something
to scroll.

### The floor, and why exactly one tier has one

A cell that may break **anywhere** has a min-content of **one character** — that is what the value
means (css-text-3 §5.4: the soft wrap opportunities it introduces *are* counted towards min-content,
which `break-word` does not do). Given that, auto table layout is free to starve a column instead of
the table overflowing, and `fit.overflows()` — the one question the browser answers exactly — goes
blind.

So the break value follows the tier, and the split is the design:

| Tier | Break value | Why |
|---|---|---|
| measured data table, while it is a table | `break-word` (`theme/30-tables.css`) | it can card, drop columns or shred one column, so it must tell the truth about what it needs |
| carded data table | `anywhere` | every value owns the row; there is no neighbour left to starve |
| config table, key/value include, meter rows, realtime legend | `anywhere` (`base/40-tables.css`) | none of them is measured and none can card on demand — containment is the only outcome available |
| header row, first column | `break-word` (`base/40-tables.css`) | the labels you read the table by (issues #32, #36) |

These four are the only places that decide how a cell may break, and none of them sits under a
viewport query. No page needs a `nowrap` rule of its own for an identity column: a MAC or a PID has
no break opportunity, so the `break-word` floor already keeps it whole (issues #5, #32). A wide
breakable cell giving way is rung 3 of the ladder below, never the identity column.

**One `!important` earns its place here.** `luci-mod-status`'s `processes.js` writes
`style="word-break: break-word"` on its Command span — the deprecated alias for
`overflow-wrap: anywhere`, from an inline declaration no layer can outrank. Left alone it erases the
floor one level down and the table reports that it fits while the column is narrower than its
widest token; neutralised, the table reports its real need — the truth the ladder needs.

### The ladder: what happens when a table does not fit

`fitTables()` asks one question — does it overflow? — and answers it with the cheapest remedy that
works, re-measuring at every rung:

1. **it fits** → it stays a table, and nothing was written;
2. **drop the columns the view marked expendable** (`hide-xs`/`hide-sm`, which `ui.Table` copies from
   the header cell onto every body cell) and ask again — upstream's own priority hint, honoured by
   measurement instead of at 767 px;
3. **let the widest breakable column shred** (`.fs-td-break`; never the first column, never a `nowrap`
   one) and ask again;
4. **card it** (`.fs-stacked`).

Rungs 2 and 3 need no threshold, and that is the point: **the guard is the second measurement.** Where
one long token is the whole problem, breaking that column keeps the table a table; where every column
is over its share, breaking one changes nothing and the card is right. The only number left in the
file is `CRAMPED` (568), the judgement that a table below that much room has stopped being a table at
all — stated, and not derivable from anything.

A table with **no** header row cannot card (a card prints `data-title`, and it has none), so it
scrolls inside itself instead — `.fs-xscroll`, written only when it is measured to overflow **and**
holds no widget. That refusal is not caution: `overflow-x: auto` computes `overflow-y` to `auto` as
well (css-overflow-3 §3.1), so a scrolling table clips every popup inside it, and luci-base sizes an
open dropdown against the nearest scroll parent. WCAG 2.2 SC 1.4.10 names data tables as the
exception where two-dimensional scrolling is acceptable, which is what makes this an outcome rather
than a failure — and the scrolled table keeps its first column pinned, takes a tab stop with
`role="group"` and a name, and draws a focus ring, because a scroll box the keyboard cannot reach is
content the keyboard cannot read.

## Proving a CSS change

**Screenshots do not work here.** On a live router, uptime, DHCP leases and signal strength change
more pixels between two runs of the same stylesheet than a real regression (buttons switched to a
monospace font) does. The noise buries the signal.

The method that does work: load the gallery with each stylesheet, snapshot `getComputedStyle` over
the relevant properties for every element and every `::before`/`::after` that generates content,
diff the two. Same DOM, same data — so any difference was caused by the CSS. The sheet is the one a
router gets (`build-css.sh`, then `mangle-tokens.sh`), each side in its own document: swapping the
`<link>` on one document only works while both sheets map the private tokens alike. The gallery has
no `header.ut` chrome, so a change to the sidebar, bar, rail or menu reads 0 here and has to be
measured on a router. There is no script for this in the repository; drive it with Playwright (a
dev dependency).

Two traps in the method itself:

- **Web fonts.** Neither sheet ships one, but a machine with Manrope or JetBrains Mono installed
  still resolves them, and any page-supplied `@font-face` restarts font matching when a stylesheet
  loads. A snapshot taken before matching settles measures fallback metrics — every width on the
  page shifts by a pixel or two and drowns the real diff. Wait for `document.fonts.ready` before
  each snapshot.
- **`admin/status/overview` polls and redraws itself**, so it shows differences even with
  identical CSS on both sides. Run a control pass (A = B) to learn each page's noise floor.

### The component gallery

`docs/gallery.html` renders every widget `ui.js`/`cbi.js` can emit, with the real class names, so
you do not have to hunt the router for a page that happens to contain the control you changed. It
is not part of the package; it is published to GitHub Pages alongside the built stylesheet.

## There is nothing left to shrink, and that is measured

The idea "the stylesheet is large, let us compress it" comes back periodically. The answer is no in
every direction already tried:

- **Coverage is not a deletion list.** Nearly all of the sheet matches across the router pages and
  the gallery; what does not is conditional branches that have to exist (`@media print`, the licence
  banner, rules for pages with data the test router lacks). The coverage contract forbids removing a
  selector because it was not seen — see [conventions.md](conventions.md). A coverage number taken
  over CDP (`CSS.startRuleUsageTracking`) needs care: an `@layer`/`@media` block is reported together
  with everything nested in it, so merge the use ranges and subtract from a parse of the file.
- **No structural reserves.** Native nesting saves a few percent, not worth rewriting the tree, and
  the Chrome 108 floor lacks it anyway. Vendor prefixes and data URIs are all needed. The largest
  rules (the `:root` token block, the palettes) are foundation, not fat.
- **Compression is unavailable.** `uhttpd` has no compression option, and it does not serve a
  pre-compressed `.gz`. Not our lever until the web server changes.
- **`<link rel=preload>` for JS modules is harmful.** LuCI fetches modules by plain XHR, whose mode
  does not match preload's CORS mode, so every preloaded file downloads twice. No form of preload
  deduplicates against the XHR loader.
- **Flattening the `require` graph at the entry point** hits HTTP/1.1's 6 connections per host, not
  the depth: the waves re-form as batches of six and `menu-footstrap` queues behind its siblings.
- **Service Worker and CacheStorage are unavailable.** A LAN IP over http is not a secure context, so
  `serviceWorker`, `caches` and `navigator.storage` are absent.
- **Splitting into a critical and a deferred sheet** helps a cold load and slows a warm one — and an
  admin browses with a warm cache.

The theme's main load-time optimisation is the client router ([spa-router.md](spa-router.md)): a
warm SPA transition costs a fraction of a full load.
