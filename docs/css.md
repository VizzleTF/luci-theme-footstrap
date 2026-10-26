# The stylesheet: source tree, layers, build

`cascade.css` is generated from `styles/` and is not in git. This page covers the tree, the
cascade rules, the build, and how to prove a CSS change.

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

Concatenation order is `styles/`, `base/`, `theme/`, `pages/`. Inside a directory the numeric
prefix is the order.

`03-palettes.css` holds only token definitions. A palette rule that styles an element, such as
`:root[data-wallpaper="pattern"] .fs-main { background-color: … }`, would lose to `theme` from
inside `tokens`, so it lives in `theme/15-wallpaper.css`.

The directory cannot be called `src/`: to `luci.mk` that means C sources.

## Layers

```css
@layer tokens, base, theme, page;
```

A later layer beats an earlier one regardless of specificity. A `theme` rule never needs
specificity or `!important` to beat a `base` rule.

The unlayered level outranks every layer and stays empty on purpose. `node.css`, which LuCI
attaches to some pages after the theme, lands there.

### Layer order is fixed by the FIRST mention of a name, and that can be hijacked

The order holds only while `cascade.css` is the first sheet in the document to name a layer. A
name met earlier becomes the first, weakest layer. If a foreign sheet carrying `@layer theme`
lands ahead of ours, the order becomes `theme, tokens, base, page`, and `base` (where
`* { padding: 0 }` lives) beats the whole chrome.

Ace (pulled in by `luci-app-ssclash` and any package with an editor) inserts its `<style>` as the
first child of `<head>`, lazily, some of it on first hover. `fs-sheets.js` answers each `<head>`
mutation by inserting a new `<style>` with `@layer tokens, base, theme, page;` as the first child.
It must be a new sheet: inserting a sheet recomputes the order, moving one does not. A static
declaration in the template cannot help, because a foreign sheet can still land in front of it.

### `!important` inverts layer order

Important declarations run in reverse: important in `base` beats important in `theme`, which
beats important in `page`.

A flag is allowed only to fight an inline `style=` or an unlayered `<style>` an app injected
(`package-manager.js` emits one). A rule that needs a flag to beat another footstrap rule is in
the wrong layer. Each flag carries a comment naming what it fights.

The exception is `theme/95-a11y-media.css`. `prefers-reduced-motion` must stop animations declared
in `base` as well as `theme`, and only an important declaration reaches back a layer. The
forced-colors focus outline there is flagged for the same reason: themed rules set
`outline: none` in several layers.

## The browser floor

Chrome 108, Firefox 101, Safari 15.4. Below that the page is broken, not plainer.

`@layer`, `:is()`/`:where()`, `:focus-visible`, `svh`/`dvh`, `accent-color` and the logical
properties set the floor. None of them gets a fallback: a theme whose layers are ignored is not a
theme.

Write an asymmetric inline offset as `*-block` plus `*-inline` (`margin-block: 0;
margin-inline: var(--x) 0`), never as a physical shorthand followed by one `*-inline-start`
longhand. A corner shared with an inline-start edge is `border-start-start-radius`.

These features sit above the floor. Below their version the rule does not apply and the page is
plainer:

| Feature | Chrome / Firefox / Safari | What is lost below it |
|---|---|---|
| `:has()` | 105 / 121 / 15.4 | refinements: port tiles, password control-group, stacked-table footers |
| `color-mix()` | 111 / 113 / 16.2 | the mixed tokens fall back to `styles/04-nocolormix.css` |
| `@container` | 105 / 110 / 16.0 | width adaptations inside `fs-view` / `fs-content` |
| relative `oklch(from …)` | 122 / 128 / 18 | the tint and the accent/status hue axes. The rules sit under an `@supports` probe of the exact syntax. The ink on a hex accent does not depend on it: `inkFor()` in `fs-axes.js` and the `head.ut` pre-paint compute it in JS |
| `text-wrap: pretty`, `scrollbar-width` | n/a | typographic polish |
| `overflow: clip` | 90 / 94 / 16.0 | `.fs-main` and `.fs-staging` fall back to the browser's cross-axis correction: a sideways scrollbar or page-wide horizontal scroll, as stock LuCI renders. `.fs-staging` stays `visibility: hidden`, so nothing staged is exposed |

Two rules follow.

A `:has()` part never shares a selector list with a part that has none. A selector list is not
forgiving: one unsupported compound drops the whole rule. `.table.fs-stacked .tr,
.table.fs-stacked tfoot:not(:has(> .tr))` as one rule would cost Firefox 115 ESR `display: flex`
on every stacked card. Split the rule, or wrap the list in `:is()`, which is forgiving and drops
only the compound it cannot parse.

A token built with `color-mix()` gets a static twin in `04-nocolormix.css`. Without
`color-mix()`, `background: var(--fs-good-soft)` is invalid at computed-value time and computes to
`unset`; the usual two-declaration fallback does nothing for a token. Tints degrade to
`transparent`, hairlines to the solid colour they are a fraction of, and the focus ring to
`--fs-focus-ring-solo`.

A CSS feature the sheet has not used before goes on one side of this line: it moves the floor, or
it joins the table. Check values too, not only properties: `overflow` is ancient, `overflow: clip`
is Safari 16. The JS floor is lower: the SPA router uses nothing younger than `ResizeObserver`,
and `requestIdleCallback` is the only feature-detected API.

### Vendor prefixes still in the sheet

A prefix stays only while the unprefixed form is missing at the floor in some engine. Check MDN's
browser-compat-data before adding or removing one. `-webkit-mask*` looks safe to cut and is not:
unprefixed masking ships from Chrome 120.

## The build

`build-css.sh` concatenates the directories. Without `--dev`, one awk pass then strips comments
and whitespace: uhttpd serves `/www/luci-static/*.css` with no gzip, so every byte travels. The
package build also shortens the private token names and joins the rules onto one line; see
[package.md](package.md).

Each file opens with the `@layer` wrapper its directory means. The build strips that wrapper (the
first line to the `}` where brace depth returns to 0) and emits one wrapper per directory. The depth
count skips comments and quoted strings, so a `{` in prose or in `content: "{"` does not move the
close.

`--dev` merges the wrappers the same way and skips the squeeze pass. Comments and formatting stay,
for reading on a router.

The squeeze pass is string-aware:

- Comments: it strips `/* … */` and keeps the `/*! … */` banner (Apache-2.0 attribution), trimmed
  line by line.
- Whitespace: it drops the space after `:`, spaces around `{ } ; ,`, the last `;` of a block, and
  the newline after each declaration. The output is one rule per line. The last `;` goes inside the
  pass, not in a later `sed 's/;}/}/g'`: sed does not see strings and would break `content: ";}"`.

The whitespace pass never touches:

- a single space between selectors: `.a .b` is a descendant, `.a.b` is not;
- the spaces around `+` and `-` inside `calc()`: `calc(100% - 8px)` without them is a parse error;
- a newline inside a declaration, which counts as a space. Joined, a wrapped `calc()` becomes
  `…))- .004 …`, the declaration drops, and the token chain built on it (`--fs-tint-c` → `--fs-bg`)
  loses the canvas colour;
- anything inside a string. Every data URI here is quoted.

Five rewrites spell the same selector or declaration shorter, never inside a string or a comment:

- `[attr="ident"]` → `[attr=ident]`. The value must be a whole ident on one line
  (`-?[A-Za-z_][-A-Za-z0-9_]*`) with no `\` and no `--`: `mangle-tokens.sh` reads an unquoted
  `--fs-` as a name to rename. A value that starts with a digit, holds `%`, `/`, `:`, `.` or `#`,
  or is empty stays quoted.
- The space before `!`: `red !important` → `red!important`.
- `::before` / `::after` → `:before` / `:after`. Engines serialise both as `::`. `::before-x` is
  left alone.
- The spaces beside `*` and `/` in a declaration: `calc(1px * 2)` → `calc(1px*2)`, `16 / 9` →
  `16/9`. Only inside a block that holds declarations (a style rule, `@font-face`, a keyframe
  step). Selectors and `@media`/`@supports`/`@container` conditions keep theirs, and a space stays
  where the join would spell `/*` or `*/`.
- A `flex` triple with a keyword form: `0 0 auto` → `none`, `1 1 auto` → `auto`, `0 1 auto` →
  `0 auto`, `1 1 <length or %>` → `<length or %>`. A bare `0`, a `var()` or `calc()` basis, and a
  custom property named `--flex` are left alone.

The first three rewrites cannot tell a selector from a declaration. Do not put `[x="y"]` or ` !`
inside a custom-property value: script reading it back with `getPropertyValue` would get the
rewritten text.

The build exits 1 on any of these:

- a directory's file opens with another layer's wrapper;
- a rule follows a file's wrapper (it would move into the layer; the message names `file:line`);
- a file with no wrapper follows a wrapped one (it would land inside the block);
- unbalanced braces, or fewer than 100 rules, counted on the comment-stripped sheet before the
  squeeze and again on the output;
- a rule count that changed across the squeeze, which also catches a truncated write;
- a rule nested in a declaration block (native nesting is below the floor, and the rewrites would
  read its selector as a declaration);
- an unknown option (`--devv` would otherwise become the output file name).

### How it runs on OpenWrt

`luci.mk` copies only `luasrc ucode htdocs root src` into `PKG_BUILD_DIR`, then calls
`Build/Prepare/$(LUCI_NAME)`. `styles/` is not in that list, so the script reads from `$(CURDIR)`
and writes into the build tree. It needs only `cat` and `awk`, so the OpenWrt buildbot builds it
with no host dependency.

### Why no preprocessor

The buildbot has no `node`, `sass` or `postcss`, and `cat` plus `awk` is enough, so the build
travels with the package.

## Duplicates CSS cannot merge

Some rules carry identical declarations under guards CSS cannot OR together: a class against an
`@container`, or two guards where one needs `:has()`. Each duplicate is a decision: merge it, or
list it here. Edit both copies together. Each copy's comment names the other.

| First copy | Second copy |
|---|---|
| `theme/30-tables.css`: `.table.fs-stacked .td[data-title]::before`, `.td.cbi-section-actions`, its `> :not(.cbi-dropdown)` and `> .cbi-dropdown` | `theme/65-dropdown.css`, inside `@container fs-content`: the same four under `.table.cbi-section-table` |
| `theme/30-tables.css`: `.table.fs-stacked .tr` | same file: `.table.fs-stacked tfoot:not(:has(> .tr))` |
| `theme/20-shell.css`: `.fs-sidebar.fs-ind-compact #indicators` poll glyph and badge | same file: the `[data-rail="true"]` poll glyph and badge |
| `theme/25-progressbar.css`: `.cbi-value-field > .cbi-progressbar::after` | same file: `.cbi-section .table:has(.tr.table-titles) .td .cbi-progressbar::after` |
| `theme/60-inputs.css`: `.cbi-value-field select option:checked` | `theme/65-dropdown.css`: `.cbi-dropdown[open] > ul.dropdown > li[selected]` |
| `theme/70-modal.css`: `#modal_overlay .modal label.btn` | `theme/90-responsive.css`: the `@container fs-view (max-width: 360px)` button rule |

## `:where(#view)`, not bare `#view`

A page-scoped selector in `styles/pages/` anchors on `:where(#view)[data-page="…"]`, not
`#view[data-page="…"]`. An id adds `(1,0,0)` to a chain that is already long; `:where()` matches
the same element at zero specificity.

Do not widen it to `:where(#view, .fs-content)`. `.fs-content` is `#view`'s ancestor, so a `> div`
arm would match `#view` itself instead of `#view`'s children.

## Page-scoped corrections

Per-page rules live in `styles/pages/`. Scoping: "`:where(#view)`, not bare `#view`" above. Tables
folding into cards: "The card contract" below.

### Login: a definite width, not `max-width`

`sysauth.ut` ships its own template, so the login page carries no chrome. A view module cannot
draw it: the view runs before a session exists, and every RPC answers "Access denied".

`.fs-login` is a flex item of `<body>` (a flex column, so the footer can `margin-top: auto`). On
the cross axis an `auto` side margin sizes the item to fit-content, so `max-width: 400px` caps
nothing and the card collapses to its min-content. `width: min(400px, calc(100% - 32px))` caps it.

The hostname title (`.fs-login-host`) keeps its case: a hostname is a name, and case tells two
similar ones apart. It takes `overflow-wrap: anywhere`, since a hostname is one token up to 63
characters. `.cbi-page-actions` is a column, so a second auth-plugin action (Reset) keeps a gap.

### Leases: nowrap counted from the end, matched by column count not release

Every cell in `.leases`/`.leases6` is `white-space: nowrap`, so an IPv4 or a MAC stays on one line.
Only the long opaque columns (hostname, the IPv6 list, DUID) switch back to `white-space: normal`
and `overflow-wrap: anywhere`.

Two upstream facts drive the selectors:

- `.lases` is upstream's own spelling of the IPv4 table on 24.10 (`class="table lases"`),
  corrected to `.leases` on 25.12+. Both spellings are matched everywhere (issue #7).
- The leading `Interface` column is optional on 25.12+: `40_dhcp.js` adds it only where odhcpd
  serves DHCP. The trailing columns are identical either way, so selectors count from the end with
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

  Both tables split on the column count, tested with
  `:has(:where(.tr.table-titles > :nth-child(6)))`, never on release or class name. A one-character
  upstream fix to `.lases` would otherwise hand the 24.10 table the 25.12 column plan. The test
  sits in `:where()` because `:has()` takes its argument's specificity.

Never match a `data-title` value in a selector. LuCI fills it from the column heading, so an
English literal never matches on a localised router (issue #7). Any transform the theme puts on
`.th` rewrites the string too (issue #39).

### Syslog filter bar: two disjoint container queries

`tools/views.js` (LogreadBox: the System Log and every third-party page built on it) and
`view/status/dmesg.js` (Kernel Log) write the filter bar as bare `<div style="margin-bottom:10px">`
rows of label/control pairs. Inline flow breaks wherever the line runs out, often inside a label.

The rows are flex, so a wrap falls only between items. Above 560px the free-text filter
(`input:not([type])`; every other input under `#content_syslog` states a type) grows to fill the
row. At or below 560px every field takes its own line with its label above it (`flex-basis: 100%`).
The two tiers are disjoint `@container` queries, each stating its layout in full, so neither
outranks the other by specificity.

`#syslog`'s `width: 100%` lives in the `page` layer. The generic `textarea { width: 210px }` is in
`theme/60-inputs.css`, and a layer beats specificity, so the same rule in `base` would lose and
render the log as a 210px column.

### Appearance: from popover to page, and what stayed CSS

The controls are an ordinary page. Sections are stock `.cbi-section` cards and rows are stock
`.cbi-value`; caption column, field column and row hairline come from `base/30-forms.css` and
`theme/60-inputs.css`, like every other LuCI form.

- No preset colour chips: the Accent row does the same job with any colour.
- No hue slider in the colour control. Two controls for one value read as two settings, and the
  slider could never reach a grey. The axis still stores a hue and `03-palettes.css` still rotates
  by it, so a saved value keeps painting.
- In `data-layout="top"` CSS hides `.fs-ap-submenus`, because those sections are hover dropdowns
  there. CSS, not a JS branch: the page is built once, and a branch would freeze the control to the
  layout it loaded in.

The disclosure chevron (`.fs-ap-chev`) shares one rule in `theme/45-misc.css` with the Overview
card toggle, so the two cannot drift.

The colour-contrast readout (`.fs-color-contrast` and its three grade colours) shows the live ratio
against the surface the colour is read on (`contrastRatio` in `fs-appearance.js`). It is a readout,
not a validation: the theme never corrects a colour the admin asked for.

### Overview: the disclosure pill, the grid, and the duplicate heading

`index.js`'s `data-indicator="poll-status"` pill is decoration. The card header is the real control
(`wireDisclosure()` in `fs-overview.js`), so the glyph is `aria-hidden` and `font-size: 0` hides
its "Hide"/"Show" text. The selector is `:is(.cbi-title h3, .cbi-section > h3)[role="button"]`
because the wrapper differs by release (25.12 `.cbi-title > h3`, 24.10 a bare `<h3>`). 24.10 renders
no hide/show control, so the 24.10 arm does not fire there.

`hideEmptyCard()` in `fs-overview.js` marks an empty `.cbi-section` a stock include renders with
nothing to show, and this file drops it. The stock `<h2>` that repeats the chrome's page title is
hidden through `.fs-content[data-page=…]`, not `#view`: the heading is a sibling of `#view` and
needs the outgoing page's identity for the whole staging window (`commitStage` in `fs-router.js`).

`.fs-ovl` is the grid for System / Memory / Storage. Its items carry `min-width: 0` so an item
shrinks to its track; otherwise a long System value pushes the single-column track past a phone.

### Overview: the port-tile reskin

`29_ports.js` (stock `luci-mod-status`) draws `.ifacebox` tiles with inline `style=` for zone colour
and size. Every `!important` in this part of the file fights one such inline declaration.

The grid is `repeat(auto-fit, minmax(calc(76px * var(--fs-density-type) + …), 1fr))`. With `1fr` as
the max, `auto-fit` takes the track count from the min, so a row holds as many tiles as fit. A
definite max (`minmax(126px, 200px)`) would fix the count at `floor(width / 200)`. 76px is the widest
traffic figure (`▲ 1024.0 PiB`, nowrap).

The tile is `flex-wrap`, not a grid with a `@container` threshold (issue #7). A threshold is
calibrated on English, and a longer localised status overflows. Flexbox keeps two cells on a row
while they fit. Do not put `container-type` on the tile: a poll-rewritten tile then lays out before
containment resolves and shifts everything below it on every tick.

The port name is one line (`.ifacebox` sets `nowrap`), cut with an ellipsis. `min-width: 0` stops a
long name from setting the minimum width of every tile on the page.

Meter rows (a key/value-shaped `.table` row carrying a `.cbi-progressbar`: Memory, Storage, CPU
load, connections) match
`:not(:has(.th)):not(:has(.td:nth-child(3))):has(.cbi-progressbar)`, not a named section. Any
key/value include on this page gets the layout: label and value on one line, the bar below. Off
this page the same shape gets only the base `.cbi-progressbar` default. Below 560px the value's
reserve (`padding-inline-end: min(230px, 50%)`) no longer fits, so the label takes the whole line
and the bar drops below it.

Row dividers and the key/value weight drop only where the table's shape is a real key/value pair.
See "Tables: the key/value discriminator is the table's shape, not a class" below.

### Software: the disk-space bar and the carded package row

The disk-space bar (label and value on one line, bar below) is scoped by
`:where(#view)[data-page]`, not `:has(#disk-space-label)`: 24.10 ships no such id. `#packages` is a
data table (`fs-select.js` tags it `.fs-dt` off its `.tr.cbi-section-table-titles` header), so it
takes the shared card from `theme/30-tables.css` once measured too narrow.

The package name column is `white-space: nowrap`. With `overflow-wrap: anywhere` a column's
min-content drops to one character, and auto table layout would take the whole shortfall out of
column 1 and break names mid-word. `nowrap` keeps the overflow honest for `fs-select.js`'s
measurement; a row that does not fit cards.

The `:not(...)` on the header rows matters in card mode. The `#packages` id outranks
`theme/30-tables.css`'s `.table.fs-stacked .tr.cbi-section-table-titles { display: none }`, so
without the `:not()` the header row would come back on screen.

A card row is label left, value right. `justify-content: space-between` would push the two parts of
a filter match (wrapped in `<ins>`) to opposite edges, because each element is its own flex item.
The `::before` takes an auto inline-end margin instead, so the value packs flush right in DOM order.
`text-align: end` overrides `theme/30-tables.css`'s `start`.

Column 4 (Description) matches by index, `:nth-child(4)`, since a translated `data-title` never
matches. Columns: 1 name, 2 version, 3 size, 4 description, 5 actions.

The "Disk space:" caption is keyed as `label:has(+ .cbi-progressbar)`, not on `#disk-space-label`
(25.12+ only). Do not write `:has(:where(+ .cbi-progressbar))`: a leading combinator makes a
relative selector, which only `:has()` accepts, and the browser drops the whole rule.

### SSH-keys: the card wrapper and the wide dynlist

SSH-Keys renders as one bare `<div>` in `#view`, with no `.cbi-section`. It gets
`theme/30-tables.css`'s card values directly, scoped to this page. A general "card any bare
`#view > div`" rule would also wrap whole tabbed views (Startup).

An `authorized_keys` entry is a ~400-character base64 blob, so this dynlist must not take
`theme/60-inputs.css`'s 440px cap. The override lives in `page`: in `base` it would lose to
`theme` by layer.

## Base layer: LuCI's own markup, corrected

`styles/base/` restyles class names LuCI itself emits: the Meyer reset, CBI form and table markup,
the modal `ui.js` builds, widgets with no generic equivalent. Put paint in `styles/theme/`; edit
`base` only for markup the theme cannot route around.

### Reset: `[hidden]` must outrank every layer, not patch one mistake

The UA gives `[hidden]` the weakest `display: none`, so any later `display` on a class (`.tr`,
`.td`, `ul.nav > li`, `.cbi-page-actions`, `.ifacebox`) paints through it.
`[hidden]:not([hidden="until-found"])` carries `!important`, so it beats every layer, page-layer id
rules included. `until-found` is excluded: `display: none` would break the find-in-page reveal.

### Typography and widgets: an opaque token needs `overflow-wrap: anywhere`, a tooltip needs `pre-wrap`

Opaque user strings get `overflow-wrap: anywhere`. A WireGuard public key in inline `<code>` (one
44-character run) otherwise runs past the content column on a phone.

A firewall rule-jump tooltip (`.cbi-tooltip`, "Chain POSTROUTING, Rule #1") is `pre-wrap`, not
`pre`. Both keep literal whitespace; only `pre-wrap` still wraps a line that is too long.

### Forms: control typography stays in base, on purpose

`label, input, button` font rules live in `base/30-forms.css`. In `theme`, a bare-element rule would
outrank every classed base refinement regardless of specificity (the firewall's zone badges would
grow from 10.8px to 13px). In `base`, a classed rule still wins on specificity.

`select` is the exception: its face, size and leading live in `theme/60-inputs.css`. So does the
size typed text takes, `--fs-type-field` (design-system.md "Scales"). Base has no classed rule that
sets an input's size, so the theme's generic field box outranks nothing it should not.

### Forms: the label column's `min-width: 0` survives the responsive layer

`.cbi-value-title` is a flex item at `flex: 0 0 180px`. `theme/90-responsive.css` sets
`flex: 1 1 100%` under 767px and leaves `min-width` alone, so the `min-width: 0` set here survives
into the phone layout. Without it a label with few break points (often a translated one) renders at
its min-content and clips the section.

### Tables: overflow-wrap follows the tier, not the file

`base/40-tables.css` sets `anywhere` on values and `break-word` on headers and the first column for
every table this layer reaches (config tables, key/value includes, meter rows). None of them is
measured or cards on demand, so containment is the only outcome. The full table: "The floor, and
why exactly one tier has one" below.

### Tables: roles survive a `display` override

A `display` change on a table part needs something in its selector that restricts it to one rung
of the [ladder](#the-ladder-what-happens-when-a-table-does-not-fit). That is a ladder class
(`.fs-stacked`, `.fs-dt`, `.cbi-section-table`, `.fs-rowstack`, `.fs-xscroll`,
`hide-xs`/`hide-sm`), or the `:not()` chain of the
[key/value shape test](#tables-the-keyvalue-discriminator-is-the-tables-shape-not-a-class) in
`theme/30-tables.css`. Without one it changes every such element at once. The same holds for a
`.cbi-section` descendant whose class names a table part as a whole hyphenated word (`row`, `cell`,
`col`, `head`, `body`, `foot`, `table`, `grid`), such as `.fs-color-row`.

### Tables: the key/value discriminator is the table's shape, not a class

`theme/30-tables.css`'s key/value styling and its ≤560px stacking match a `.cbi-section .table`
only when it has no `.th` and no row with a 3rd `.td`. A real key/value row is exactly two cells,
neither a header. A class test misses cases: `:not(:has(.tr.table-titles))` catches only
`L.ui.Table`'s header, while `initFromMarkup` binds `<thead>`/`.th` markup with no such class. Every
LuCI header puts its cell class on `.th`, so `:not(:has(.th))` covers both.

The shape test also catches a table with no header and a 3rd `.td` (luci-mod-dsl's `stats.js`),
which `tagDataTables()` never tags; it scrolls instead of stacking. And because the test is pure
CSS, a header table does not flash key/value styling before `fs-select.js` adds `.fs-dt`.

`pages/20-overview.css` repeats the test for its dividers, weight and meter rows. Its data-table
row-height rule runs the complement (`:is(:has(.th), :has(.td:nth-child(3)))`).

### Tables: the empty-table placeholder must not pin to the table's bottom

`.tr.placeholder > .td` is `position: absolute`, so its sentence cannot widen column one. It sets no
`bottom`: inside the `position: relative` `.table`, `bottom: 0` resolves to the bottom of the whole
table. `form.TableSection` renders its footer into a `<tfoot>` after `<tbody>`, so the placeholder
would print across the totals (issue #36). Without `bottom` the box keeps its static position, on
its own row.

### Buttons: the flex clearfix, and why `float` is dead on `.cbi-page-actions`

`.cbi-page-actions` is flex (`theme/55-buttons.css`), so nothing in it floats. Its `::after` is
not a clearfix: the empty item counts toward `gap` and closes the trailing 8px after the last real
button. `.secondary-action` carries no `float` there, since float does not apply to a flex item.

### Widgets: `.actions .secondary-action` still floats, and needs a hand RTL mirror

`.actions` (the legacy action plate some `luci-app-*` still emit) is not flex, so its secondary
action keeps `float: right`, mirrored by hand to `left` under `[dir="rtl"]`. A browser that does not
know `float: inline-end` drops the declaration, and the floor does not guarantee it. Unmirrored,
the float fights `.actions`' `text-align: end`, which follows the writing direction.

### Widgets: the tooltip parks past the unreachable edge, and the close cross needs the same mirror

`.cbi-tooltip` hides at `inset-inline-start: -10000px`, not a physical `left`. In RTL a physical
`left: -10000px` lands past the scrollable inline-end edge and adds a 10000px horizontal scrollbar;
the inline-start edge is unreachable in both directions. `.close` carries the same hand-mirrored
`float` as `.actions` above; unmirrored, the cross lands before the title in RTL.

### `base/95-luci.css`: the GridSection name column, read from the markup, not the release

25.12's `form.js` renders a GridSection name as a real `<th>` plus `td.cbi-section-table-titles`.
24.10 renders no such cell and expects `::before` to build the column from `data-title`. Each row
type is told apart by what it carries, never by release. A header row carries `data-title` on 24.10
only. A data row carries it on both, so the test is whether the row has the extra name cell. A
description row follows its header. Do not key on the header's value: it is `_('Name')`, translated.

The `:has()` branch sits in the shared list inside `:is()`, which is forgiving. An engine without
`:has()` (Firefox <121) drops only that branch, not the stacked-table card labels beside it.

### `base/95-luci.css`: the dark-mode zone tint, and why it has no grey fallback

`[data-darkmode="true"] .zonebadge[style]` re-mixes `luci-mod-network`'s inline zone colour at
`.4/.3`, because a raw zone colour is too bright on a dark panel. `--zone-color-rgb` has no
fallback on purpose. LuCI sets it inline only where a zone colour exists. Elsewhere the declaration
is invalid at computed-value time, resolves to `unset`, and the inline background shows through. A
grey fallback would tint boxes that should show the panel.

### `base/95-luci.css`: the overflow-wrap fix generalised once, not restated per page

`.ifacebox-body`, `.network-status-table .ifacebox-head` and the same pair on the port tiles need
`overflow-wrap: anywhere`. Only `anywhere` lowers min-content and lets a flex item shrink; a stat
line or a translated caption otherwise overflows a narrow box. It is set once on
`.ifacebox .ifacebox-body`, not once per page.

### `base/95-luci.css`: the spinner glyph sits in the flow, on purpose

`.spinning::before` reserves its own space with `flex: 0 0 auto` (or `vertical-align: middle` on a
non-flex host). An absolutely positioned glyph would need a `padding-left` on the host. Every
padding rule aimed at the button competes for it, and the loser draws the glyph over the label
(issues #15, #22). Rotation is a CSS `animation`, never an SVG `<animateTransform>`, which runs out of reach
of `prefers-reduced-motion`.

### `base/95-luci.css`: the file browser's floor, and the row that is not text

`.cbi-filebrowser` takes `min-width: min(210px, 100%)`: a bare `210px` would be wider than the
field at a 300px viewport. Its child rule treats every row as one line of text (`nowrap` plus
ellipsis). `.right` is excluded: it holds the upload strip and Create/Cancel, and `nowrap` with
`overflow: hidden` would block their wrap and clip Cancel.

### `base/95-luci.css`: Statistics graphs and Realtime SVGs are art drawn for a white ground

Statistics renders collectd graphs as PNGs drawn for white, so dark mode inverts them.
`invert()` turns every hue to h+180, and `hue-rotate(180deg)` turns it back while keeping the
inverted lightness. The primaries land exactly; amber lands slightly off, since `hue-rotate` is a
linear approximation.

Realtime graphs (Status → Load/Traffic) inject `resources/svg/*.svg` with inline `style=` drawn for
black. The grid `<line>`s carry `stroke:black`, and only an author `!important` beats an inline
declaration. The axis `<text>` labels get the same override plus bold. The selector is
`> text[style]`, a direct child: Channel Analysis colours its SSID labels inside a nested `<g>`, and
a descendant selector would recolour them too.

## Theme layer: components absorbed and fixed

`styles/theme/` is footstrap's own component paint. Each section below is the reason a comment in
that file points at.

### Meter: the value's line is reserved in flow by default, not floated on faith

The `.cbi-progressbar` value is an absolutely positioned `::after` (`content: attr(title)`) above
the bar, so a thin track never grows into a pill. The bar reserves one line in flow by default
(`margin-block-start: calc(var(--fs-type-xs) * var(--fs-leading))`), as stock bootstrap does.
Without the reserve, in a key/value `.table` row (`20_memory.js`, reused by `luci-mod-dashboard`)
the value prints across the divider above.

Contexts that put the value beside the bar (`.cbi-value-field`, a data table's meter column) or on a
neighbour's line (overview meter rows, the package-manager disk bar) set `margin-block-start: 0`.

### Inputs: the toggle switch, drawn on the input, not the label

The switch is drawn on the real `<input>`, not on `label[for]`. Apps built for bootstrap
(luci-app-modemdata) inject an unlayered `label[for] { display: none } !important`. With the switch
on the label nothing would be visible; on the input, the app hides an empty placeholder.

`flex-shrink: 0`: a caption after the pill (`label.cbi-checkbox > input + label[for] + TEXT`, in
package-manager.js and banip) makes the input a shrinkable flex item, and a shrunk pill lets the
knob overhang.

The knob's travel is a `translateX`, which is physical, so `[dir="rtl"]` negates `--sw-travel`.

### Inputs: `.hidden.hidden`, and the Tailwind/UnoCSS exception

`fs-sheets.js` (`rehostIntoThemeLayer`) moves a foreign app's invasive sheet (one with a selector not pinned to the app's own names)
into `@layer theme`, where it
competes on specificity. There `.hidden.hidden` would outrank a responsive utility such as
`.lg\:flex` (0,1,0) and keep `<aside class="hidden lg:flex …">` (luci-app-splify2) hidden at every
width. `:not([class*=":"])` excludes class lists with a Tailwind/UnoCSS variant. LuCI never emits a
class containing `:`. The rule stays above `input[type="submit"]` (issue #12).

### Inputs: the range slider's hit target and its line-box

The `<input>` grows to the 24px WCAG 2.5.8 target, and `margin-block: -9px` pulls the extra area out
of flow. `.cbi-range-slider` takes `vertical-align: middle`: its baseline follows the input's edge,
so without it the row still grows with the target.

### Inputs: the select chevron mirrors by hand, and its two bands swap

`--fs-select-chevron` is two 6px gradient bands placed by `background-position`, which has no
logical keyword. Under `[dir="rtl"]` the positions flip to `left` by hand, and the two bands swap
offsets; mirrored as they were, the chevron draws as an inverted V. The clearance is
`padding-inline-end`, so it follows the writing direction on its own.

### Dropdown: the display state machine, unflagged

The `.cbi-dropdown` show/hide rules carry no `!important`. Every shower out-specifies the hider it
overrides; check specificity when adding one. `[empty]`'s `block` loses to `[open]`'s `flex` on
purpose: an open empty list still lays out as a popup.

### Dropdown: ellipsis needs `min-width: 0` first

`text-overflow: ellipsis` alone does nothing: a flex item's automatic minimum keeps it at its
content width until `min-width: 0`. No `title` or `aria-label` stands in. The full string stays in
the DOM for screen readers; a `title` is not announced on touch, and an `aria-label` with the
shortened text would break WCAG 2.5.3.

### Dropdown: the open list's rail and the selected-row's contrast

The selected row's surface is opaque (`--fs-panel2`) and the accent is an inset rail. Accent text
on `--fs-accent-soft` falls under AA in dark. The focus ring is inset, since the menu clips its
overflow and an outer ring is cut on the first and last rows. The `[selected]` and the
`:focus-visible` selectors carry the same specificity on purpose; otherwise source order would
decide the focus ring.

### Dropdown: 992px, not 960

A config row with several dropdowns stops fitting below about 960px, so the row cards. This is a
`@container fs-content`, not a measurement: these rows hold widgets that bake in the width they
were rendered at, so un-collapsing one to measure changes the reading.

The query reads `.cbi-map`, one level above the `.cbi-section` that holds the table, and that level
spends `--fs-card-pad` on both sides (32px at Normal density). `992 = 960 + 32` asks whether the
section's own content has cleared 960px.

### Misc: the realtime graph bleed

`Status → Realtime` graphs size their drawing from `#view`
(`document.querySelector('#view').offsetWidth - 2`), not from their own box. footstrap's
`.cbi-section` is a card with 16px of padding and a 1px border. So the canvas is 34px narrower than
the drawing. The views draw newest-first from the right, so the freshest samples fall off. The fix
bleeds the graph box out to the card's border edge, with `!important` against the inline
`width: 100%` (issue #32).

### Misc: fade-in animates nothing, on purpose

`luci-mod-status` re-marks every section and their wrapper with upstream's `fade-in` class on every
poll tick. Anything the theme hangs on it replays across the content column on every tick. The class
stays in the markup and animates nothing. The keyframes in `base/95-luci.css` stay for a third-party
app that triggers them outside a poll.

### Toplayout: measured, not media-queried

`theme/50-toplayout.css` is a delta. The top bar itself (sticky row, popup submenus, icon buttons,
right cluster) is the unguarded base in `theme/20-shell.css`. This file adds the bar height, padding
aligned to the content column, and the menu on the brand's row.

There is no `@media`: whether the menu fits on the brand's row depends on the section count, not the
viewport. `fitChrome` in `fs-chrome.js` measures instead. It shrinks the pills, collapses the poll
pill to an icon, then stacks the menu on its own row (`.fs-bar-stack`), at any width.

### Buttons: the page-action bar wraps, not shrinks

`.cbi-page-actions` wraps. Save and Reset have no ellipsis, so in a no-wrap row the whole squeeze
lands on the Save & Apply split control. With `flex-wrap: wrap` the split control moves to its own
line, and only its own box squeezes its caption. The caption keeps an ellipsis for a long
translation at Large density in a 320px column.

### Buttons: `flex-basis: auto`, not the definite basis base gave every row action

Action cells (`.td.cbi-section-actions` from `form.TableSection`) are reached by
`.cbi-section-actions .cbi-button`/`.btn`. A bare `.td .btn` would also catch buttons in other cells
(the rail drag handle, "Reserve IP" in DHCP leases).

`base/95-luci.css` gives each button `flex: 1 1 4em`. With `overflow: hidden`, a definite basis
makes the automatic minimum 0, so `flex-grow` divides by count and ellipsises captions that had
room. `flex-basis: auto` sizes by content; the ellipsis still covers a row narrower than its
captions.

### Modal: no horizontal scroll, ever

`#modal_overlay` scrolls (`overflow: auto`) and centres the dialog with `margin: auto`, so one
over-wide child scrolls the dialog's left edge off screen.

Two stock children do it. `<label class="btn">` (each checkbox row in `flash.js`) inherits `.btn`'s
`white-space: pre` and cannot wrap. A `<li>` carrying a checksum is one 64-character token. The fix
is `white-space: normal` plus `overflow-wrap: anywhere` plus `min-width: 0` on `label.btn` (a real
button keeps `pre`). `min-width: 0` is needed because the label is an `inline-flex` container whose
automatic minimum is its content's min-content. `anywhere`, not `break-word`: only `anywhere`
lowers min-content below the widest token.

### Responsive: a split button's label must wrap under 360px

Buttons are `white-space: pre`, as in stock bootstrap. footstrap's buttons are wider than stock's.
A long translated split-button caption (ssclash's "Сохранить и перезагрузить конфигурацию") in an
app's `inline-flex` wrapper overflows a 288px column. Under `@container fs-view (max-width: 360px)`
buttons take `white-space: normal`, `min-width: 0` and `overflow-wrap: anywhere`. A short label has no
wrap point, so nothing changes where it fits.

### Responsive: no `display: block` on `table.fs-dt`

Never give `table.fs-dt` `display: block`. It discards the table formatting context: the table can
no longer be wider than its parent, `fit.overflows()` never sees an overflow, and the measured
design stops working.

### Tables: one frame for every `.fs-dt`

The frame, corners, placeholder and cell padding in `theme/30-tables.css` select
`:is(table, div).fs-dt`, not `table.fs-dt`, so a div-based table outside `.cbi-section` and without
`[id]` (luci-app-roamd, #67) gets them. Without them it keeps the generic `.table { overflow: hidden }`
and becomes the sticky header's scroll container. `overflow: clip` on the generic rule would clip
popups.

The form is `:is(table, div).fs-dt`, not `.table.fs-dt`, for specificity. `:is(table, div).fs-dt .td`
is (0,2,1), the same as `table.fs-dt .td`. An app's padding is re-hosted into `@layer theme`, so
luci-app-filemanager's `.table td:nth-child(1)` (0,2,1) ties and keeps its own padding by source
order. The other `.fs-dt` rules (break floor, sticky header, fit gate, `.fs-stacked` cards) use
`.table.fs-dt`.

### Responsive: the disk gauge value moves below the bar

The bar's `::after` value normally sits above the bar, where the System page's "Disk space:" label
already is; on a phone they overlap. The bar is a fixed 10px box, so the rule reserves
`margin-bottom` and places the value in it. The disk section is the only `label` directly followed
by a `.cbi-progressbar`.

### A11y: prefers-contrast token shifts, and the numbers behind them

`prefers-contrast: more` leaves the palette to the theme, so `theme/95-a11y-media.css` re-states
tokens:

- Hairlines: `--fs-border` moves toward `--fs-text`, and the role hairlines (`-line`/`-line-hi`) go
  to the full role colour.
- Secondary text: `--fs-dim` and `--fs-faint` move 82% toward `--fs-text`. They stay distinct,
  because they are the export tier's `--text-color-medium` and `-low`.
- `--fs-placeholder`, in both modes: the mix goes back to the AA-clearing 62% and 80%
  (design-system.md "The fourth ink"). Only `--fs-placeholder-mix` changes.
- The focus ring: `--fs-focus-ring` carries the accent at 60%. `--fs-focus-ring-solo` is already
  solid.

### A11y: forced-colors state repairs

Forced colors replace backgrounds with the system canvas, so a state carried only by a background
vanishes. The active tab, the checked toggle, the selected dropdown row, `.ifacebox-head.active`
and Save & Apply (a `.cbi-dropdown` wrapper) get a repair. Alert and `.label` variants do not: the
honest repair for severity is a word or an icon in the markup, which is `ui.js`'s.

The `#topmenu` active item carries its state in a tinted background and a box-shadow rail, both of
which forced colors drop. The rail comes back as a real border.

A glyph drawn as a fill cut by `mask` turns Canvas on Canvas: the poll glyph disappears, and a
checked checkbox looks unchecked. The repair sets the fill to a system colour with
`forced-color-adjust: none`. The poll glyph gets ButtonText while polling and GrayText when paused.
The check, the radio dot and a button's spinner get ButtonText. The help icon and a bare spinner
get CanvasText. The
wallpaper pattern is left to drop out: it is decoration.

## The card contract: what is measured and what is not

A table folds into cards by two mechanisms, on purpose.

A data table is measured. `fs-fit.js` (through `fitTables` in `fs-select.js`) removes the class,
reads the width, decides, and sets `.fs-stacked`. The decision depends on the table, not the
screen, so cards can happen at any viewport width. A data table holds no widgets, so measuring is
safe.

No measurement runs while the reader scrolls. The poll replaces these tables, and each new table
would lay out full width for a frame. Every pass registers with `fit.add()`; a pass that reads
layout first asks `fit.scrolling()`, and while the reader scrolls it calls `fit.deferMeasurement()`
and reruns when scrolling stops.

`:root[data-fs-fit] .table.fs-dt:not(.fs-fitted) { display: none }` keeps an unanswered table out
of the layout. During a scroll `fitTables()` answers without measuring, from the slot: the section
frame survives a poll tick and keeps the replaced table's decision, keyed by column count and room.
With no slot yet, it stacks only if the content column is under `CRAMPED`. The module that clears
the rule writes `data-fs-fit` (`fit.armGate()`), so without that JS every table shows as a plain
table.

A hidden table may not be judged. A `display: none` table reads `scrollWidth: 0`, and caching "fits"
would show it clipped by `.fs-main { overflow-x: clip }`. `fitTables()` treats a zero measurement as
no answer: it lifts the gate, asks for another frame (`fit.schedule()`), and writes nothing to the
slot.

A config table (`.cbi-section-table`) is not measured and stays on `@container fs-content`. Its
rows are full of widgets that bake in the width they were laid out at. Unfolding one to measure
changes the result: the firewall zone table, measured that way, overflowed its section. Do not
convert it. The threshold: "Dropdown: 992px, not 960".

The price is the duplicated card rules listed in "Duplicates CSS cannot merge".

### Which of the three a table gets, and what decides it

Every `<table>` or `<div class="table">` under one of the two content roots (`#view`, and the
`#modal_overlay` that `ui.showModal()` builds) lands in one of three tiers. The discriminator is
whether it has a header row, never who wrote it:

| Tier | Reached by | What it does |
|---|---|---|
| measured card | a header row, not `.cbi-section-table`: `fs-select.js` tags `.table.fs-dt` | folds into labelled cards when it stops fitting, at any width |
| `@container` card | `.cbi-section-table` | folds when `.cbi-map` is under 992px, never measured |
| scroll | no header row | `display: block; overflow-x: auto` on the table itself |

The roots are listed once in `fs-select.js` (`ROOTS`) and every query is built from them. A dialog
is a root only while it is open: `hideModal()` leaves the markup in place, so each pass asks
`liveRoots()`. The open flag flips after `showModal()` writes the content, so `fs-fit.js` watches
`body`'s class as well as both subtrees.

A header row is any of four markups: `.tr.table-titles` (`L.ui.Table`),
`.tr.cbi-section-table-titles` (the apk Software list), a `<thead>` (its `<th>`s may hang off it
with no `<tr>`), and a first row made only of `<th>`. `labelCells()` copies each column's heading
into the cell's `data-title`, which the card prints. It never overwrites an app's own value, and it
counts columns, not cells, so a `colspan` does not shift the captions.

A table with no header scrolls: a card would print values with nothing saying what they are. The
scroll rule is not scoped to a phone. A 400px panel on a desktop hits the same wall, and
`overflow` paints a scrollbar only when there is something to scroll.

### The floor, and why exactly one tier has one

A cell that may break anywhere has a min-content of one character (css-text-3 §5.4). Auto table
layout can then starve a column instead of overflowing, and `fit.overflows()` goes blind.

So the break value follows the tier:

| Tier | Break value | Why |
|---|---|---|
| measured data table, while it is a table | `break-word` (`theme/30-tables.css`) | it can card, drop columns or shred one column, so it must report what it needs |
| carded data table | `anywhere` | every value owns its row |
| config table, key/value include, meter rows, realtime legend | `anywhere` (`base/40-tables.css`) | not measured and cannot card, so containment is the only outcome |
| header row, first column | `break-word` (`base/40-tables.css`) | the labels the table is read by (issues #32, #36) |

These four decide how a cell may break, and none sits under a viewport query. An identity column
(a MAC, a PID) needs no `nowrap` of its own: it has no break opportunity, so the `break-word` floor
keeps it whole.

One `!important` belongs here. `processes.js` writes an inline `style="word-break: break-word"` on
its Command span, the deprecated alias for `overflow-wrap: anywhere`. Left alone it erases the floor
and the table reports that it fits when it does not.

### The ladder: what happens when a table does not fit

`fitTables()` asks whether the table overflows and applies the cheapest remedy that works,
measuring again after each rung:

1. it fits: it stays a table, and nothing is written;
2. drop the columns the view marked expendable (`hide-xs`/`hide-sm`, which `ui.Table` copies onto
   every body cell);
3. let the widest breakable column shred (`.fs-td-break`; never the first column, never a `nowrap`
   one);
4. card it (`.fs-stacked`).

Rungs 2 and 3 need no threshold: the next measurement is the guard. The only number in the file is
`CRAMPED` (568), below which a table has stopped being a table.

A `.table` with no header row scrolls inside itself (`.fs-xscroll`), but only when it overflows
and holds no widget. `overflow-x: auto` makes `overflow-y` auto too, so a scrolling table clips every
popup inside it. The scrolled table pins its first column, takes a tab stop with `role="group"` and
a name, and draws a focus ring.

## Proving a CSS change

Screenshots do not work here: on a live router, uptime, leases and signal strength move more pixels
between two runs of the same sheet than a real regression does.

Diff computed styles instead. Load `docs/gallery.html` with each sheet, snapshot `getComputedStyle`
over the relevant properties for every element and every `::before`/`::after` that generates
content, and diff. Same DOM, same data, so every difference comes from the CSS. Use the sheet a
router gets (`build-css.sh`, then `mangle-tokens.sh`), each side in its own document: swapping the
`<link>` on one document works only while both sheets map the private tokens alike. The gallery
has no `header.ut` chrome, so check a change to the sidebar, bar, rail or menu on a router. There is
no script for this; drive it with Playwright.

Two traps:

- Web fonts. A machine with Manrope or JetBrains Mono installed still resolves them, and a snapshot
  taken before font matching settles measures fallback metrics. Wait for `document.fonts.ready`.
- `admin/status/overview` polls and redraws, so it differs even with identical CSS. Run a control
  pass (A = B) to learn each page's noise.

### The component gallery

`docs/gallery.html` renders every widget `ui.js`/`cbi.js` can emit, with the real class names. It
is not in the package; it is published to GitHub Pages with the built stylesheet.
