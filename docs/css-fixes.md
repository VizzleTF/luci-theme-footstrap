# CSS fixes: page, base and theme corrections

A lookup catalogue of every correction the stylesheet makes to LuCI and its pages, and why. For
someone who meets a rule in `styles/` and wants its reason, or who is about to change one. Search
this page for the file name or the page you are on.

The tree, layers and build: [css.md](css.md). Proving a change: [prove-css-change.md](prove-css-change.md).

## Contents

- [Page-scoped corrections](#page-scoped-corrections)
- [Base layer: LuCI's own markup, corrected](#base-layer-lucis-own-markup-corrected)
- [Theme layer: components absorbed and fixed](#theme-layer-components-absorbed-and-fixed)
- [The card contract: what is measured and what is not](#the-card-contract-what-is-measured-and-what-is-not)

## Page-scoped corrections

Per-page rules live in `styles/pages/`. Scoping: [css.md, "`:where(#view)`, not bare `#view`"](css.md#whereview-not-bare-view). Tables
folding into cards: "The card contract" below.

| File in `styles/pages/` | Sections |
|---|---|
| `10-login.css` | [a definite width, not `max-width`](#login-a-definite-width-not-max-width) |
| `20-overview.css` | [the disclosure pill, the grid, and the duplicate heading](#overview-the-disclosure-pill-the-grid-and-the-duplicate-heading), [the port-tile reskin](#overview-the-port-tile-reskin) |
| `30-software.css` | [the disk-space bar and the carded package row](#software-the-disk-space-bar-and-the-carded-package-row) |
| `40-sshkeys.css` | [the card wrapper and the wide dynlist](#ssh-keys-the-card-wrapper-and-the-wide-dynlist) |
| `50-leases.css` | [nowrap counted from the end, matched by column count not release](#leases-nowrap-counted-from-the-end-matched-by-column-count-not-release) |
| `70-syslog.css` | [two disjoint container queries](#syslog-filter-bar-two-disjoint-container-queries) |
| `80-appearance.css` | [from popover to page, and what stayed CSS](#appearance-from-popover-to-page-and-what-stayed-css) |

### Login: a definite width, not `max-width`

`sysauth.ut` ships its own template, so the login page carries no chrome. A view module cannot
draw it: the view runs before a session exists, and every RPC answers "Access denied".

`.fs-login` is a flex item of `<body>`. The body is a flex column, so the footer can
`margin-top: auto`.

On the cross axis an `auto` side margin sizes the item to fit-content. So `max-width: 400px` caps
nothing, and the card collapses to its min-content. **`width: min(400px, calc(100% - 32px))`** caps
it.

The hostname title (`.fs-login-host`) keeps its case: a hostname is a name, and case tells two
similar ones apart. It takes `overflow-wrap: anywhere`, since a hostname is one token up to 63
characters.

`.cbi-page-actions` is a column, so a second auth-plugin action (Reset) keeps a gap.

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

**Both tables split on the column count, never on release or class name.** The test is
`:has(:where(.tr.table-titles > :nth-child(6)))`. A one-character upstream fix to `.lases` would
otherwise hand the 24.10 table the 25.12 column plan. The test sits in `:where()` because `:has()`
takes its argument's specificity.

Never match a `data-title` value in a selector.

- LuCI fills it from the column heading, so an English literal never matches on a localised router
  (issue #7).
- Any transform the theme puts on `.th` rewrites the string too (issue #39).

### Syslog filter bar: two disjoint container queries

Two views write the filter bar as bare `<div style="margin-bottom:10px">` rows of label/control
pairs:

- `tools/views.js` (LogreadBox: the System Log and every third-party page built on it);
- `view/status/dmesg.js` (Kernel Log).

Inline flow breaks wherever the line runs out, often inside a label.

The rows are flex, so a wrap falls only between items. The layout has two tiers:

| Width | Layout |
|---|---|
| above 560px | the free-text filter (`input:not([type])`) grows to fill the row. Every other input under `#content_syslog` states a type |
| at or below 560px | every field takes its own line with its label above it (`flex-basis: 100%`) |

The two tiers are disjoint `@container` queries, each stating its layout in full. Neither outranks
the other by specificity.

`#syslog`'s `width: 100%` lives in the `page` layer. The generic `textarea { width: 210px }` is in
`theme/60-inputs.css`, and a layer beats specificity. The same rule in `base` would lose and render
the log as a 210px column.

### Appearance: from popover to page, and what stayed CSS

The controls are an ordinary page. Sections are stock `.cbi-section` cards and rows are stock
`.cbi-value`. Caption column, field column and row hairline come from `base/30-forms.css` and
`theme/60-inputs.css`, like every other LuCI form.

Four of the cards are the panes of one tab group (`ui.tabs.initTabGroup`). So the strip, its
styling and the tab kept for the session are LuCI's.

An inactive pane leaves the layout (`display: none`). The stock rule only zeroes its height, and a
card's padding, border and gap would stand as an empty bar.

A choice of two or three values is a row of pills (`.fs-seg`). It is a radio group drawn as one
inset, with the checked value raised on it as a card. The radios stay in the box, so the arrow keys
still move the choice.

What the page leaves out or hides:

- No preset colour chips: the Accent row does the same job with any colour.
- No hue slider in the colour control. Two controls for one value read as two settings, and the
  slider could never reach a grey. The axis still stores a hue and `03-palettes.css` still rotates
  by it, so a saved value keeps painting.
- In `data-layout="top"` CSS hides `.fs-ap-submenus`, because those sections are hover dropdowns
  there. It is CSS, not a JS branch: the page is built once, and a branch would freeze the control
  to the layout it loaded in.
- The Transparency rows (`.fs-ap-glass`) hide the same way without a wallpaper. Material
  (`.fs-ap-material`) hides while both opacities are at 100%.

The colour-contrast readout (`.fs-color-contrast` and its three grade colours) shows the live ratio
against the surface the colour is read on (`contrastRatio` in `view/footstrap/appearance.js`).

- It appears only below AA: a passing colour needs no line under it.
- It is a readout, not a validation: the theme never corrects a colour the admin asked for.

### Overview: the disclosure pill, the grid, and the duplicate heading

`index.js`'s `data-indicator="poll-status"` pill is decoration. The card header is the real control
(`wireDisclosure()` in `fs-overview.js`). So the glyph is `aria-hidden`, and `font-size: 0` hides
its "Hide"/"Show" text.

The selector is `:is(.cbi-title h3, .cbi-section > h3)[role="button"]`, because the wrapper differs
by release: 25.12 has `.cbi-title > h3`, 24.10 a bare `<h3>`. 24.10 renders no hide/show control,
so the 24.10 arm does not fire there.

`hideEmptyCard()` in `fs-overview.js` marks an empty `.cbi-section` that a stock include renders
with nothing to show, and this file drops it.

The stock `<h2>` that repeats the chrome's page title is hidden through `.fs-content[data-page=…]`,
not `#view`. The heading is a sibling of `#view`. It needs the outgoing page's identity for the
whole staging window (`commitStage` in `fs-router.js`).

`.fs-ovl` is the grid for System / Memory / Storage. Its items carry `min-width: 0` so an item
shrinks to its track. Otherwise a long System value pushes the single-column track past a phone.

### Overview: the port-tile reskin

`29_ports.js` (stock `luci-mod-status`) draws `.ifacebox` tiles with inline `style=` for zone colour
and size. Every `!important` in this part of the file fights one such inline declaration.

The grid is `repeat(auto-fit, minmax(calc(76px * var(--fs-density-type) + …), 1fr))`.

- With `1fr` as the max, `auto-fit` takes the track count from the min, so a row holds as many tiles
  as fit.
- A definite max (`minmax(126px, 200px)`) would fix the count at `floor(width / 200)`.
- 76px is the widest traffic figure (`▲ 1024.0 PiB`, nowrap).

The tile is `flex-wrap`, not a grid with a `@container` threshold (issue #7). A threshold is
calibrated on English, and a longer localised status overflows. Flexbox keeps two cells on a row
while they fit.

Do not put `container-type` on the tile. A poll-rewritten tile then lays out before containment
resolves and shifts everything below it on every tick.

The port name is one line (`.ifacebox` sets `nowrap`), cut with an ellipsis. `min-width: 0` stops a
long name from setting the minimum width of every tile on the page.

**Meter rows match by shape, not by a named section.** A meter row is a key/value-shaped `.table`
row carrying a `.cbi-progressbar`: Memory, Storage, CPU load, connections. It matches
`:not(:has(.th)):not(:has(.td:nth-child(3))):has(.cbi-progressbar)`.

Any key/value include on this page gets the layout: label and value on one line, the bar below. Off
this page the same shape gets only the base `.cbi-progressbar` default.

The label reserves the widest value's width and breaks a long mount path anywhere. The reserve is
`padding-inline-end`: 32 glyphs of .6em mono at `--fs-type`, plus a gap, 258px at the default size.
The old `min(230px, 50%)` let a 30-glyph value (235px) run under the label in a two-column layout.

Below 35rem (560px) the reserve no longer fits. The label then takes the whole line and the bar
drops below it.

Row dividers and the key/value weight drop only where the table's shape is a real key/value pair.
See "Tables: the key/value discriminator is the table's shape, not a class" below.

### Software: the disk-space bar and the carded package row

The disk-space bar (label and value on one line, bar below) is scoped by
`:where(#view)[data-page]`, not `:has(#disk-space-label)`: 24.10 ships no such id.

`#packages` is a data table. `fs-select.js` tags it `.fs-dt` off its `.tr.cbi-section-table-titles`
header, so it takes the shared card from `theme/30-tables.css` once measured too narrow.

The package name column is `white-space: nowrap`.

- With `overflow-wrap: anywhere` a column's min-content drops to one character. Auto table layout
  would then take the whole shortfall out of column 1 and break names mid-word.
- `nowrap` keeps the overflow honest for `fs-select.js`'s measurement; a row that does not fit
  cards.

The `:not(...)` on the header rows matters in card mode. The `#packages` id outranks
`theme/30-tables.css`'s `.table.fs-stacked .tr.cbi-section-table-titles { display: none }`. Without
the `:not()` the header row would come back on screen.

A card row is label left, value right.

- `justify-content: space-between` would push the two parts of a filter match (wrapped in `<ins>`)
  to opposite edges, because each element is its own flex item.
- The `::before` takes an auto inline-end margin instead, so the value packs flush right in DOM
  order.
- `text-align: end` overrides `theme/30-tables.css`'s `start`.

Column 4 (Description) matches by index, `:nth-child(4)`, since a translated `data-title` never
matches. Columns: 1 name, 2 version, 3 size, 4 description, 5 actions.

The "Disk space:" caption is keyed as `label:has(+ .cbi-progressbar)`, not on `#disk-space-label`
(25.12+ only). Do not write `:has(:where(+ .cbi-progressbar))`. A leading combinator makes a
relative selector, which only `:has()` accepts, and the browser drops the whole rule.

### SSH-keys: the card wrapper and the wide dynlist

SSH-Keys renders as one bare `<div>` in `#view`, with no `.cbi-section`. It gets
`theme/30-tables.css`'s card values directly, scoped to this page. A general "card any bare
`#view > div`" rule would also wrap whole tabbed views (Startup).

An `authorized_keys` entry is a ~400-character base64 blob. So this dynlist must not take
`theme/60-inputs.css`'s 440px cap. The override lives in `page`: in `base` it would lose to `theme`
by layer.

## Base layer: LuCI's own markup, corrected

`styles/base/` restyles class names LuCI itself emits: the Meyer reset, CBI form and table markup,
the modal `ui.js` builds, widgets with no generic equivalent.

**Put paint in `styles/theme/`.** Edit `base` only for markup the theme cannot route around.

### Reset: `[hidden]` must outrank every layer, not patch one mistake

The UA gives `[hidden]` the weakest `display: none`. So any later `display` on a class (`.tr`,
`.td`, `ul.nav > li`, `.cbi-page-actions`, `.ifacebox`) paints through it.

`[hidden]:not([hidden="until-found"])` carries `!important`, so it beats every layer, page-layer id
rules included. `until-found` is excluded: `display: none` would break the find-in-page reveal.

### Typography and widgets: an opaque token needs `overflow-wrap: anywhere`, a tooltip needs `pre-wrap`

Opaque user strings get `overflow-wrap: anywhere`. A WireGuard public key in inline `<code>` (one
44-character run) otherwise runs past the content column on a phone.

A firewall rule-jump tooltip (`.cbi-tooltip`, "Chain POSTROUTING, Rule #1") is `pre-wrap`, not
`pre`. Both keep literal whitespace; only `pre-wrap` still wraps a line that is too long.

### Forms: control typography stays in base, on purpose

`label, input, button` font rules live in `base/30-forms.css`.

- In `theme`, a bare-element rule would outrank every classed base refinement regardless of
  specificity. The firewall's zone badges would grow from 10.8px to 13px.
- In `base`, a classed rule still wins on specificity.

`select` is the exception: its face, size and leading live in `theme/60-inputs.css`. So does the
size typed text takes, `--fs-type-field` (design-system.md "Scales"). Base has no classed rule that
sets an input's size, so the theme's generic field box outranks nothing it should not.

### Forms: the label column's `min-width: 0` survives the responsive layer

`.cbi-value-title` is a flex item at `flex: 0 0 11.25rem` (180px at the default font size).
`theme/90-responsive.css` sets `flex: 1 1 100%` under 767px and leaves `min-width` alone. So the
`min-width: 0` set here survives into the phone layout.

Without it a label with few break points (often a translated one) renders at its min-content and
clips the section.

### Tables: overflow-wrap follows the tier, not the file

`base/40-tables.css` sets `anywhere` on values and `break-word` on headers and the first column.
That holds for every table this layer reaches: config tables, key/value includes, meter rows.

None of them is measured or cards on demand, so containment is the only outcome. The full table:
"The floor, and why exactly one tier has one" below.

### Tables: roles survive a `display` override

A `display` change on a table part needs something in its selector that restricts it to one rung
of the [ladder](#the-ladder-what-happens-when-a-table-does-not-fit). Without one it changes every
such element at once. Either of these restricts it:

- a ladder class: `.fs-stacked`, `.fs-dt`, `.cbi-section-table`, `.fs-rowstack`, `.fs-xscroll`,
  `hide-xs`/`hide-sm`;
- the `:not()` chain of the
  [key/value shape test](#tables-the-keyvalue-discriminator-is-the-tables-shape-not-a-class) in
  `theme/30-tables.css`.

The same holds for a `.cbi-section` descendant whose class names a table part as a whole hyphenated
word (`row`, `cell`, `col`, `head`, `body`, `foot`, `table`, `grid`), such as `.fs-color-row`.

### Tables: the key/value discriminator is the table's shape, not a class

`theme/30-tables.css`'s key/value styling and its ≤560px stacking match a `.cbi-section .table`
only when it has no `.th` and no row with a 3rd `.td`. A real key/value row is exactly two cells,
neither a header.

A class test misses cases. `:not(:has(.tr.table-titles))` catches only `L.ui.Table`'s header, while
`initFromMarkup` binds `<thead>`/`.th` markup with no such class. Every LuCI header puts its cell
class on `.th`, so `:not(:has(.th))` covers both.

The shape test also catches a table with no header and a 3rd `.td` (luci-mod-dsl's `stats.js`).
`tagDataTables()` never tags it, so it scrolls instead of stacking.

Because the test is pure CSS, a header table does not flash key/value styling before
`fs-select.js` adds `.fs-dt`.

`pages/20-overview.css` repeats the test for its dividers, weight and meter rows. Its data-table
row-height rule runs the complement (`:is(:has(.th), :has(.td:nth-child(3)))`).

### Tables: the empty-table placeholder must not pin to the table's bottom

`.tr.placeholder > .td` is `position: absolute`, so its sentence cannot widen column one.

It sets no `bottom`. Inside the `position: relative` `.table`, `bottom: 0` resolves to the bottom of
the whole table. `form.TableSection` renders its footer into a `<tfoot>` after `<tbody>`, so the
placeholder would print across the totals (issue #36). Without `bottom` the box keeps its static
position, on its own row.

### Buttons: the flex clearfix, and why `float` is dead on `.cbi-page-actions`

`.cbi-page-actions` is flex (`theme/55-buttons.css`), so nothing in it floats.

- Its `::after` is not a clearfix. The empty item counts toward `gap` and closes the trailing 8px
  after the last real button.
- `.secondary-action` carries no `float` there, since float does not apply to a flex item.

### Widgets: `.actions .secondary-action` still floats, and needs a hand RTL mirror

`.actions` is the legacy action plate some `luci-app-*` still emit. It is not flex, so its secondary
action keeps `float: right`, mirrored by hand to `left` under `[dir="rtl"]`.

A browser that does not know `float: inline-end` drops the declaration, and the floor does not
guarantee it. Unmirrored, the float fights `.actions`' `text-align: end`, which follows the writing
direction.

### Widgets: the tooltip parks past the unreachable edge, and the close cross needs the same mirror

`.cbi-tooltip` hides at `inset-inline-start: -10000px`, not a physical `left`.

- In RTL a physical `left: -10000px` lands past the scrollable inline-end edge and adds a 10000px
  horizontal scrollbar.
- The inline-start edge is unreachable in both directions.

`.close` carries the same hand-mirrored `float` as `.actions` above. Unmirrored, the cross lands
before the title in RTL.

### `base/95-luci.css`: the GridSection name column, read from the markup, not the release

25.12's `form.js` renders a GridSection name as a real `<th>` plus `td.cbi-section-table-titles`.
24.10 renders no such cell and expects `::before` to build the column from `data-title`.

Each row type is told apart by what it carries, never by release:

| Row type | How it is told apart |
|---|---|
| header row | carries `data-title` on 24.10 only |
| data row | carries `data-title` on both, so the test is whether the row has the extra name cell |
| description row | follows its header |

Do not key on the header's value: it is `_('Name')`, translated.

The `:has()` branch sits in the shared list inside `:is()`, which is forgiving. An engine without
`:has()` (Firefox <121) drops only that branch, not the stacked-table card labels beside it.

### `base/95-luci.css`: the dark-mode zone tint, and why it has no grey fallback

`[data-darkmode="true"] .zonebadge[style]` re-mixes `luci-mod-network`'s inline zone colour at
`.4/.3`, because a raw zone colour is too bright on a dark panel.

`--zone-color-rgb` has no fallback on purpose. LuCI sets it inline only where a zone colour exists.
Elsewhere the declaration is invalid at computed-value time and resolves to `unset`, and the inline
background shows through. A grey fallback would tint boxes that should show the panel.

### `base/95-luci.css`: the overflow-wrap fix generalised once, not restated per page

`.ifacebox-body`, `.network-status-table .ifacebox-head` and the same pair on the port tiles need
`overflow-wrap: anywhere`. Only `anywhere` lowers min-content and lets a flex item shrink. A stat
line or a translated caption otherwise overflows a narrow box.

It is set once on `.ifacebox .ifacebox-body`, not once per page.

### `base/95-luci.css`: the spinner glyph sits in the flow, on purpose

`.spinning::before` reserves its own space with `flex: 0 0 auto`, or `vertical-align: middle` on a
non-flex host.

An absolutely positioned glyph would need a `padding-left` on the host. Every padding rule aimed at
the button competes for it, and the loser draws the glyph over the label (issues #15, #22).

Rotation is a CSS `animation`, never an SVG `<animateTransform>`, which runs out of reach of
`prefers-reduced-motion`.

### `base/95-luci.css`: the file browser's floor, and the row that is not text

`.cbi-filebrowser` takes `min-width: min(210px, 100%)`. A bare `210px` would be wider than the
field at a 300px viewport.

Its child rule treats every row as one line of text (`nowrap` plus ellipsis). `.right` is excluded:
it holds the upload strip and Create/Cancel. `nowrap` with `overflow: hidden` would block their wrap
and clip Cancel.

### `base/95-luci.css`: Statistics graphs and Realtime SVGs are art drawn for a white ground

Statistics renders collectd graphs as PNGs drawn for white, so dark mode inverts them.

- `invert()` turns every hue to h+180.
- `hue-rotate(180deg)` turns it back while keeping the inverted lightness.
- The primaries land exactly. Amber lands slightly off, since `hue-rotate` is a linear
  approximation.

Realtime graphs (Status → Load/Traffic) inject `resources/svg/*.svg` with inline `style=` drawn for
black.

- The grid `<line>`s carry `stroke:black`, and only an author `!important` beats an inline
  declaration.
- The axis `<text>` labels get the same override plus bold.
- The selector is `> text[style]`, a direct child. Channel Analysis colours its SSID labels inside a
  nested `<g>`, and a descendant selector would recolour them too.

## Theme layer: components absorbed and fixed

`styles/theme/` is footstrap's own component paint. Each section below is the reason a comment in
that file points at.

### Meter: the value's line is reserved in flow by default, not floated on faith

The `.cbi-progressbar` value is an absolutely positioned `::after` (`content: attr(title)`) above
the bar, so a thin track never grows into a pill.

The bar reserves one line in flow by default
(`margin-block-start: calc(var(--fs-type-xs) * var(--fs-leading))`), as stock bootstrap does.
Without the reserve the value prints across the divider above in a key/value `.table` row
(`20_memory.js`, reused by `luci-mod-dashboard`).

Some contexts set `margin-block-start: 0`:

- those that put the value beside the bar: `.cbi-value-field`, a data table's meter column;
- those that put it on a neighbour's line: overview meter rows, the package-manager disk bar.

### Inputs: the toggle switch, drawn on the input, not the label

The switch is drawn on the real `<input>`, not on `label[for]`.

Why: apps built for bootstrap (luci-app-modemdata) inject an unlayered
`label[for] { display: none } !important`. With the switch on the label nothing would be visible.
On the input, the app hides an empty placeholder.

`flex-shrink: 0`: a caption after the pill makes the input a shrinkable flex item, and a shrunk pill
lets the knob overhang. The caption shape is `label.cbi-checkbox > input + label[for] + TEXT`, in
package-manager.js and banip.

The knob's travel is a `translateX`, which is physical, so `[dir="rtl"]` negates `--fs-sw-travel`.

### Inputs: `.hidden.hidden`, and the Tailwind/UnoCSS exception

`fs-sheets.js` (`rehostIntoThemeLayer`) moves a foreign app's invasive sheet into `@layer theme`,
where it competes on specificity. An invasive sheet is one with a selector not pinned to the app's
own names.

There `.hidden.hidden` would outrank a responsive utility such as `.lg\:flex` (0,1,0). It would
keep `<aside class="hidden lg:flex …">` (luci-app-splify2) hidden at every width.

`:not([class*=":"])` excludes class lists with a Tailwind/UnoCSS variant. LuCI never emits a class
containing `:`. The rule stays above `input[type="submit"]` (issue #12).

### Inputs: the range slider's hit target and its line-box

The `<input>` grows to the 24px WCAG 2.5.8 target, and `margin-block: -9px` pulls the extra area out
of flow.

`.cbi-range-slider` takes `vertical-align: middle`. Its baseline follows the input's edge, so
without it the row still grows with the target.

### Inputs: the select chevron mirrors by hand, and its two bands swap

`--fs-select-chevron` is two 6px gradient bands placed by `background-position`, which has no
logical keyword.

Under `[dir="rtl"]` the positions flip to `left` by hand, and the two bands swap offsets. Mirrored
as they were, the chevron draws as an inverted V.

The clearance is `padding-inline-end`, so it follows the writing direction on its own.

### Dropdown: the display state machine, unflagged

The `.cbi-dropdown` show/hide rules carry no `!important`. Every shower out-specifies the hider it
overrides; check specificity when adding one.

`[empty]`'s `block` loses to `[open]`'s `flex` on purpose: an open empty list still lays out as a
popup.

### Dropdown: ellipsis needs `min-width: 0` first

`text-overflow: ellipsis` alone does nothing. A flex item's automatic minimum keeps it at its
content width until `min-width: 0`.

No `title` or `aria-label` stands in. The full string stays in the DOM for screen readers.

- A `title` is not announced on touch.
- An `aria-label` with the shortened text would break WCAG 2.5.3.

### Dropdown: the open list's rail and the selected-row's contrast

The selected row's surface is opaque (`--fs-panel2`) and the accent is an inset rail. Accent text on
`--fs-accent-soft` falls under AA in dark.

The focus ring is inset, since the menu clips its overflow and an outer ring is cut on the first and
last rows.

The `[selected]` and the `:focus-visible` selectors carry the same specificity on purpose. Otherwise
source order would decide the focus ring.

### Dropdown: 992px, not 960

A config row with several dropdowns stops fitting below about 960px, so the row cards.

This is a `@container fs-content`, not a measurement. These rows hold widgets that bake in the width
they were rendered at, so un-collapsing one to measure changes the reading.

The query reads `.cbi-map`, one level above the `.cbi-section` that holds the table. That level
spends `--fs-card-pad` on both sides (32px at Normal density). `992 = 960 + 32` asks whether the
section's own content has cleared 960px.

### Misc: the realtime graph bleed

`Status → Realtime` graphs size their drawing from `#view`
(`document.querySelector('#view').offsetWidth - 2`), not from their own box.

footstrap's `.cbi-section` is a card with 16px of padding and a 1px border. So the canvas is 34px
narrower than the drawing. The views draw newest-first from the right, so the freshest samples fall
off.

The fix bleeds the graph box out to the card's border edge, with `!important` against the inline
`width: 100%` (issue #32).

### Misc: fade-in animates nothing, on purpose

`luci-mod-status` re-marks every section and their wrapper with upstream's `fade-in` class on every
poll tick. Anything the theme hangs on it replays across the content column on every tick.

The class stays in the markup and animates nothing. The keyframes in `base/95-luci.css` stay for a
third-party app that triggers them outside a poll.

### Toplayout: measured, not media-queried

`theme/50-toplayout.css` is a delta. The top bar itself (sticky row, popup submenus, icon buttons,
right cluster) is the unguarded base in `theme/20-shell.css`. This file adds the bar height, padding
aligned to the content column, and the menu on the brand's row.

Both files serve the bar. `20-shell.css` holds what every bar shares, the top layout and the
`data-narrow` sidebar alike. `50-toplayout.css` adds only what the top layout needs, under
`:root[data-layout="top"]`, at every width.

There is no `@media`. Whether the menu fits on the brand's row depends on the section count, not the
viewport.

`fitChrome` in `fs-chrome.js` measures instead, at any width. It shrinks the pills, collapses the
poll pill to an icon, then stacks the menu on its own row (`.fs-bar-stack`). Then `fitCluster` moves
the right cluster to its own row (`.fs-bar-actrow`) if it still does not fit. Every step and what it
measures: [chrome.md, "The top bar measures too"](chrome.md#the-top-bar-measures-too).

### Buttons: the page-action bar wraps, not shrinks

`.cbi-page-actions` wraps. Save and Reset have no ellipsis, so in a no-wrap row the whole squeeze
lands on the Save & Apply split control.

With `flex-wrap: wrap` the split control moves to its own line, and only its own box squeezes its
caption. The caption keeps an ellipsis for a long translation at Large density in a 320px column.

### Buttons: `flex-basis: auto`, not the definite basis base gave every row action

Action cells (`.td.cbi-section-actions` from `form.TableSection`) are reached by
`.cbi-section-actions .cbi-button`/`.btn`. A bare `.td .btn` would also catch buttons in other cells
(the rail drag handle, "Reserve IP" in DHCP leases).

`base/95-luci.css` gives each button `flex: 1 1 4em`. With `overflow: hidden`, a definite basis
makes the automatic minimum 0. `flex-grow` then divides by count and ellipsises captions that had
room.

`flex-basis: auto` sizes by content. The ellipsis still covers a row narrower than its captions.

### Modal: no horizontal scroll, ever

`#modal_overlay` scrolls (`overflow: auto`) and centres the dialog with `margin: auto`. So one
over-wide child scrolls the dialog's left edge off screen.

Two stock children do it:

- `<label class="btn">` (each checkbox row in `flash.js`) inherits `.btn`'s `white-space: pre` and
  cannot wrap;
- a `<li>` carrying a checksum is one 64-character token.

The fix is `white-space: normal` plus `overflow-wrap: anywhere` plus `min-width: 0` on `label.btn`.
A real button keeps `pre`.

- `min-width: 0` is needed because the label is an `inline-flex` container whose automatic minimum
  is its content's min-content.
- `anywhere`, not `break-word`: only `anywhere` lowers min-content below the widest token.

### Responsive: a split button's label must wrap under 360px

Buttons are `white-space: pre`, as in stock bootstrap. footstrap's buttons are wider than stock's.

A long translated split-button caption overflows a 288px column in an app's `inline-flex` wrapper.
An example is ssclash's "Сохранить и перезагрузить конфигурацию".

Under `@container fs-view (max-width: 360px)` buttons take `white-space: normal`, `min-width: 0` and
`overflow-wrap: anywhere`. A short label has no wrap point, so nothing changes where it fits.

### Responsive: no `display: block` on `table.fs-dt`

Never give `table.fs-dt` `display: block`.

Why: it discards the table formatting context. The table can no longer be wider than its parent,
`fit.overflows()` never sees an overflow, and the measured design stops working.

### Tables: one frame for every `.fs-dt`

The frame, corners, placeholder and cell padding in `theme/30-tables.css` select
`:is(table, div).fs-dt`, not `table.fs-dt`. So a div-based table outside `.cbi-section` and without
`[id]` (luci-app-roamd, #67) gets them.

Without them it keeps the generic `.table { overflow: hidden }` and becomes the sticky header's
scroll container. `overflow: clip` on the generic rule would clip popups.

The form is `:is(table, div).fs-dt`, not `.table.fs-dt`, for specificity.

- `:is(table, div).fs-dt .td` is (0,2,1), the same as `table.fs-dt .td`.
- An app's padding is re-hosted into `@layer theme`. So luci-app-filemanager's
  `.table td:nth-child(1)` (0,2,1) ties and keeps its own padding by source order.

The other `.fs-dt` rules (break floor, sticky header, fit gate, `.fs-stacked` cards) use
`.table.fs-dt`.

### Responsive: the disk gauge value moves below the bar

The bar's `::after` value normally sits above the bar. On the System page the "Disk space:" label
already sits there, so on a phone they overlap.

The bar is a fixed 10px box, so the rule reserves `margin-bottom` and places the value in it. The
disk section is the only `label` directly followed by a `.cbi-progressbar`.

### A11y: prefers-contrast token shifts, and the numbers behind them

`prefers-contrast: more` leaves the palette to the theme, so `theme/95-a11y-media.css` re-states
tokens:

| Tokens | Shift |
|---|---|
| hairlines | `--fs-border` moves toward `--fs-text`. The role hairlines (`-line`/`-line-hi`) go to the full role colour |
| secondary text | `--fs-dim` and `--fs-faint` move 82% toward `--fs-text`. They stay distinct, because they are the export tier's `--text-color-medium` and `-low` |
| `--fs-placeholder`, in both modes | the mix goes back to the AA-clearing 62% and 80% (design-system.md "The fourth ink"). Only `--fs-placeholder-mix` changes |
| the focus ring | `--fs-focus-ring` carries the accent at 60%. `--fs-focus-ring-solo` is already solid |

### A11y: forced-colors state repairs

Forced colors replace backgrounds with the system canvas, so a state carried only by a background
vanishes.

These get a repair: the active tab, the checked toggle, the selected dropdown row,
`.ifacebox-head.active`, and Save & Apply (a `.cbi-dropdown` wrapper).

Alert and `.label` variants do not. The honest repair for severity is a word or an icon in the
markup, which is `ui.js`'s.

The `#topmenu` active item carries its state in a tinted background and a box-shadow rail. Forced
colors drop both. The rail comes back as a real border.

A glyph drawn as a fill cut by `mask` turns Canvas on Canvas. The poll glyph disappears, and a
checked checkbox looks unchecked. The repair sets the fill to a system colour with
`forced-color-adjust: none`:

| Glyph | System colour |
|---|---|
| the poll glyph | ButtonText while polling, GrayText when paused |
| the check, the radio dot, a button's spinner | ButtonText |
| the help icon, a bare spinner | CanvasText |

The wallpaper pattern is left to drop out: it is decoration.

## The card contract: what is measured and what is not

A table folds into cards by two mechanisms, on purpose.

**A data table is measured.** `fs-fit.js` (through `fitTables` in `fs-select.js`) removes the class,
reads the width, decides, and sets `.fs-stacked`. The decision depends on the table, not the screen,
so cards can happen at any viewport width. A data table holds no widgets, so measuring is safe.

No measurement runs while the reader scrolls. The poll replaces these tables, and each new table
would lay out full width for a frame.

- Every pass registers with `fit.add()`.
- A pass that reads layout first asks `fit.scrolling()`.
- While the reader scrolls, it calls `fit.deferMeasurement()` and reruns when scrolling stops.

`:root[data-fs-fit] .table.fs-dt:not(.fs-fitted) { display: none }` keeps an unanswered table out of
the layout.

During a scroll `fitTables()` answers without measuring, from the slot. The section frame survives a
poll tick and keeps the replaced table's decision, keyed by column count and room. With no slot yet,
it stacks only if the content column is under `CRAMPED`.

The module that clears the rule writes `data-fs-fit` (`fit.armGate()`). So without that JS every
table shows as a plain table.

A hidden table may not be judged. A `display: none` table reads `scrollWidth: 0`, and caching "fits"
would show it clipped by `.fs-main { overflow-x: clip }`. `fitTables()` treats a zero measurement as
no answer: it lifts the gate, asks for another frame (`fit.schedule()`), and writes nothing to the
slot.

A config table (`.cbi-section-table`) is not measured and stays on `@container fs-content`. Its rows
are full of widgets that bake in the width they were laid out at.

Unfolding one to measure changes the result: the firewall zone table, measured that way, overflowed
its section. Do not convert it. The threshold: "Dropdown: 992px, not 960".

The price is the duplicated card rules listed in "Duplicates CSS cannot merge".

### Which of the three a table gets, and what decides it

Every `<table>` or `<div class="table">` under one of the two content roots lands in one of three
tiers. The roots are `#view` and the `#modal_overlay` that `ui.showModal()` builds. The
discriminator is whether the table has a header row, never who wrote it:

| Tier | Reached by | What it does |
|---|---|---|
| measured card | a header row, not `.cbi-section-table`: `fs-select.js` tags `.table.fs-dt` | folds into labelled cards when it stops fitting, at any width |
| `@container` card | `.cbi-section-table` | folds when `.cbi-map` is under 992px, never measured |
| scroll | no header row | `display: block; overflow-x: auto` on the table itself |

The roots are listed once in `fs-select.js` (`ROOTS`), and every query is built from them.

A dialog is a root only while it is open. `hideModal()` leaves the markup in place, so each pass asks
`liveRoots()`. The open flag flips after `showModal()` writes the content, so `fs-fit.js` watches
`body`'s class as well as both subtrees.

A header row is any of four markups:

- `.tr.table-titles` (`L.ui.Table`);
- `.tr.cbi-section-table-titles` (the apk Software list);
- a `<thead>` (its `<th>`s may hang off it with no `<tr>`);
- a first row made only of `<th>`.

`labelCells()` copies each column's heading into the cell's `data-title`, which the card prints. It
never overwrites an app's own value. It counts columns, not cells, so a `colspan` does not shift the
captions.

A table with no header scrolls: a card would print values with nothing saying what they are.

The scroll rule is not scoped to a phone. A 400px panel on a desktop hits the same wall, and
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

These four decide how a cell may break, and none sits under a viewport query.

An identity column (a MAC, a PID) needs no `nowrap` of its own. It has no break opportunity, so the
`break-word` floor keeps it whole.

One `!important` belongs here. `processes.js` writes an inline `style="word-break: break-word"` on
its Command span, the deprecated alias for `overflow-wrap: anywhere`. Left alone it erases the floor,
and the table reports that it fits when it does not.

### The ladder: what happens when a table does not fit

`fitTables()` asks whether the table overflows and applies the cheapest remedy that works. It
measures again after each rung:

1. it fits: it stays a table, and nothing is written;
2. drop the columns the view marked expendable (`hide-xs`/`hide-sm`, which `ui.Table` copies onto
   every body cell);
3. let the widest breakable column shred (`.fs-td-break`; never the first column, never a `nowrap`
   one);
4. card it (`.fs-stacked`).

Rungs 2 and 3 need no threshold: the next measurement is the guard. The only number in the file is
`CRAMPED` (568), below which a table has stopped being a table.

A `.table` with no header row scrolls inside itself (`.fs-xscroll`), but only when it overflows
and holds no widget. `overflow-x: auto` makes `overflow-y` auto too, so a scrolling table clips
every popup inside it.

The scrolled table pins its first column, takes a tab stop with `role="group"` and a name, and
draws a focus ring.
