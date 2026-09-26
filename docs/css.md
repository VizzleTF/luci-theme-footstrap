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
    04-nocolormix.css  @layer tokens   static twins for the 33 color-mix() tokens
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

`base/` came out of one 2300-line file. The split was purely mechanical: not a single rule moved
within the layer, and the computed-style diff was zero — that was the condition for calling it
done.

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
where `* { padding: 0 }` lives, starts beating the entire chrome. Measured on a router:
`.fs-content` loses its `24px 28px`, and the bar, tabs and buttons collapse with it.

Not hypothetical — it is the flip side of the re-host in `fs-sheets.js`: we wrap a foreign sheet
in `@layer theme`, but *where* the package inserted it is the package's choice. Ace (pulled in by
`luci-app-ssclash` and any package with an editor) puts its `<style>` **first child of `<head>`**
through `dom.importCssString`, and lazily — some of it on first hover. Hence the bug report
shaped "fine after a reload, right up until I hover something".

One declaration fixes it: `fs-sheets.js` re-inserts `@layer tokens, base, theme, page;` as a
**new** `<style>`, first child of `<head>`. New specifically — inserting a sheet recomputes the
order, moving an existing one does not (checked both ways). A static declaration in the
template cannot help: a foreign sheet can still land in front of it, so the answer has to be
reactive to a `<head>` mutation.

### `!important` inverts layer order

For important declarations the order is reversed: important in `base` beats important in
`theme`, which beats important in `page`.

`base/` is down to **8**: six are the `.left/.right/.center/.top/.middle/.bottom` utilities, whose
whole point is coercion, and two fight inline `style=` (zone colours, `stroke:black` on SVG graph
lines).

The rule for a flag anywhere: it must fight **inline `style=`** or an **unlayered `<style>`** an
app injected (`package-manager.js` emits exactly that). Anything else is cargo cult — if a rule
needs a flag to beat *another footstrap rule*, it is in the wrong layer. A revision against that
criterion, checked property-by-property against what the JS actually writes inline, removed 11
flags of 43 and added one that was missing.

The single exception is `theme/95-a11y-media.css`: `prefers-reduced-motion` has to kill
animations declared in `base` as well as `theme`, and only an important declaration reaches back
a layer. The inversion is what makes that file possible. `.stylelintrc.json` holds the allowlist
and `declaration-no-important` fails on any flag outside it; `css-metrics` ratchets the total against `LIMITS.importants` in tools/css-metrics.mjs — the live count, not a number copied here.

## The browser floor

The theme has never declared one, and the sheet quietly moved it twice. `npm run css-floor` now
derives it from the built stylesheet and fails if this section disagrees.

<!-- css-floor -->
**Chrome 108**, **Firefox 101**, **Safari 15.4** — below that the page is wrong, not plainer.
<!-- /css-floor -->

That floor is set by `@layer`, `:is()`/`:where()`, `:focus-visible`, `svh`/`dvh`, `accent-color`
and the logical properties. Nothing on the list has a fallback worth writing: a theme whose layers
are ignored is not a theme.

Five features are used **above** the floor and are progressive — the rule does not apply and the
page is plainer:

| Feature | Chrome / Firefox / Safari | What is lost below it |
|---|---|---|
| `:has()` | 105 / 121 / 15.4 | 59 refinements: port tiles, password control-group, stacked-table footers |
| `color-mix()` | 111 / 113 / 16.2 | the 33 mixed tokens fall back to `styles/04-nocolormix.css` |
| `@container` | 105 / 110 / 16.0 | five width adaptations inside `fs-view` / `fs-content` |
| `text-wrap: pretty`, `scrollbar-width` | — | typographic polish |
| `overflow: clip` value | 90 / 94 / 16.0 | `.fs-main`'s `overflow-x: clip` and `.fs-staging`'s `overflow: clip` drop, and the browser's own cross-axis correction (CSS Overflow 3) takes over: a sideways scrollbar on the desktop sidebar's `.fs-main` (its sibling axis is already `overflow-y: auto`) or, in the top/narrow layouts and on `.fs-staging`, whole-page horizontal scroll — exactly how stock LuCI (no `clip` at all) already renders. `.fs-staging` also stays `visibility: hidden` regardless, since nothing inside a staged view sets `visibility: visible` on itself, so nothing is exposed. Measured with `overflow-x`/`overflow` forced to `initial` in a live Chromium |

Two rules follow, and the gate holds both.

**A `:has()` part never shares a selector list with a part that has none.** A selector list is not
forgiving: one unsupported compound invalidates the whole rule. `.table.fs-stacked .tr,
.table.fs-stacked tfoot:not(:has(> .tr))` was one rule, so Firefox 115 ESR lost `display: flex` on
every stacked card — a broken mobile table, not a missing refinement. Split it, or wrap the list in
`:is()`, which *is* forgiving and drops only the compound it cannot parse.

**A token built with `color-mix()` gets a static twin in `04-nocolormix.css`.** A custom property
keeps any token stream it is handed, so the failure is deferred to the point of use: `background:
var(--fs-good-soft)` becomes invalid at computed-value time and computes to `unset`. That is not a
fall back to the previous declaration — the ordinary two-declaration trick does nothing for a
token, which is why the twins are a file and not a prelude. Tints degrade to `transparent`
(an absent surface never lowers contrast), hairlines to the solid colour they are a fraction of,
and the focus ring to `--fs-focus-ring-solo`, which was already mix-free.

Adding any CSS feature the sheet has not used before fails `css-floor` until it is classified in
`tools/css-floor.mjs` as hard or soft and the baseline is refreshed with
`node tools/css-floor.mjs --update`. The JS floor is lower and is not the constraint: the SPA
router uses nothing younger than `ResizeObserver`, and `requestIdleCallback` and `CSS.supports`
are both feature-detected.

Classification is by PROPERTY, which misses a value with its own support story: `overflow` is
ancient, `overflow: clip` is Safari 16, and the gate said nothing while the value shipped a version
past the floor above. `css-floor`'s `VALUES` table checks the exact property/value pairs worth
tracking — most values share their property's support, so this stays a short, explicit list rather
than a scan of every value in the sheet.

### Vendor prefixes still in the sheet

Every prefix earns its place here or it goes — checked against MDN's browser-compat-data and
caniuse each time, not carried forward on habit. `-webkit-mask-image` is the one that looks safe
to cut and is not: it was nearly dropped from memory alone before the version was actually
checked.

| Prefix | Cost | Status (checked 2026-09-05) |
|---|---|---|
| `-webkit-mask-image` / `-webkit-mask-size` / `-webkit-mask-repeat` / `-webkit-mask` | 450 B | **required** — unprefixed masking ships only from Chrome 120; the floor is 108 |
| `-webkit-backdrop-filter` | 214 B | **removed 2026-09-05** — with it the property itself: the theme carries no `backdrop-filter` any more (see the changelog for the measurement) |
| `-webkit-line-clamp` + `-webkit-box-orient` | 49 B | **required** — no standard line-clamp equivalent at the floor |
| `::-webkit-scrollbar-thumb` | 56 B | **required** — no standard scrollbar-styling equivalent at the floor |
| `-webkit-appearance` | 96 B, 4 occurrences | **removed 2026-09-05** — unprefixed `appearance` ships from Chrome 84 / Firefox 80 / Safari 15.4 (MDN BCD; caniuse gives Chrome 83), all at or above the floor |

## The build

`build-css.sh` concatenates the directories and — **without `--dev`** — runs the result through
one awk pass: **467 615 B → 135 655 B** (measured 2026-08-12; the figure moves with the tree, the
ratio does not). That is not cosmetic: uhttpd serves
`/www/luci-static/*.css` with no gzip, so every byte travels as-is. (The package build shortens
the private token names on top of that, landing around 120 KB — see [package.md](package.md).)

With `--dev` it is a plain `cat`: the output is byte-identical to the concatenated sources. A
file to read on a router, not one to ship.

One string-aware pass does both jobs, gated by a flag rather than run as two chained awk
invocations over the data. **Comments**: strips `/* … */` except the `/*! … */` banner, which is
Apache-2.0 attribution and is reproduced by trimming it line by line rather than deleting it — a
naive search for the nearest `/*` would eat everything up to the next `*/` on the first
`content: "/*"`. **Whitespace** (skipped when the flag is off): the space after `:`, spaces around
`{ } ; ,`, the **last `;` of a block**, and the newline after each declaration, so the output is
one rule per line. The last `;` used to be removed by a bolted-on `| sed 's/;}/}/g'`, and sed does
not see strings: `content: ";}"` became `content: "}"`, and a data URI with the same two bytes
broke the same way. No such pair exists in the tree today — and that is precisely how the bug
waits for whoever adds the first one.

What the whitespace half never touches, each for its own reason:

- **a single space between selectors** — `.a .b` is a descendant, `.a.b` is not;
- **spaces inside `calc()`** — mandatory around `*`, `/` and the minus in `calc(100% - 8px)`;
- **a newline inside a declaration** — also a space. When the scanner once joined lines
  needlessly, a wrapped `calc()` came out as `…))- .004 …`; a minus with no space *before* it is
  a parse error, the declaration fell away, `--fs-tint-c` became undefined, `--fs-bg` invalid at
  computed-value time, and the canvas silently went white (caught by `export-tier` as 1.5:1);
- **anything inside a string** — every data URI here is quoted and full of `:`, `;` and spaces.

Selectors and declarations are never rewritten.

**One guard against a broken file** (there is no upper size budget — it was removed): braces are
counted twice, before and after compression, and the build fails if the **rule count changed**.
The first count only sees the *input*, always with the flag off (comments stripped, nothing
squeezed) so a lone `{` in prose does not fail a valid `--dev` build; compression is the pass that
can corrupt a sheet, so an unchanged counter is the proof that it did not.

An 80 KB size floor (`FS_CSS_FLOOR`) sat beside this guard for the same reason: a correctness
check against a truncated write, a full disk, or a compression that ate the tail. Brace balance
alone does not catch that — a cut right after any of the four `@layer NAME { … }` wrappers closes
leaves every brace up to that point matched, so the truncated file reads as complete. Fed the real
sheet, a cut right after the base layer's own close counts a balanced **283** rules against the
file's true **1057**. What catches that is the *count*: RULES_BEFORE is measured from the
untruncated concatenation before compression runs, so a write that stops early can only come up
short against it — the rule-count check already proves what the floor was guarding.

An unknown option is an error rather than an output path (`--devv` once wrote the stylesheet to a
file called `--devv`).

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

## `@mirror`: duplication you cannot delete but can stop rotting

`css-dup` finds two rules with identical declarations under mutually exclusive guards (a media
query against an attribute selector, two `@container` thresholds). A cascade-aware reader needs
both copies, so no linter will ever call it an error — and this is exactly the shape that drifts.

The trap it was built for: `css-dup` matches *identical* bodies, so the moment the copies diverge
they stop being a duplicate and it goes quiet — **precisely when it should shout**.

So every duplicated body must be a decision: merge it into one rule, or pin it. There is no
numeric budget — a budget is a number nobody defends, and it waves through the next unexplained
copy for free.

The body is pinned, not the rule, so the wrapper goes **inside the braces** (the selectors are
legitimately different; only the declarations must match):

```css
.table.fs-stacked .td[data-title]::before {
	/* @mirror table-card/label */
	content: attr(data-title); display: block; margin-bottom: 3px;
	/* @endmirror */
}
```

`css-dup` then accepts the duplicate and `tools/mirror.mjs` (`npm run mirror`) keeps the copies
byte-identical: edit one and the build fails until you fix the other. **An unpinned duplicate is
a hard failure. A `@mirror` group with one copy is also a failure** — a mirror of one holds
nothing.

`npm run mirror` prints the current groups; read them from there, not from a doc. Today it reports
seven, plus one whole-file mirror:

| Group | Copies |
|---|---|
| `table-card/label`, `table-card/actions`, `table-card/actions-inner` | `theme/30-tables.css` (`.fs-stacked`) ↔ `theme/65-dropdown.css` (`@container`) |
| `ind-badge/paint`, `poll-glyph/mask` | two places in `theme/20-shell.css` (the sidebar and the rail) |
| `selected-row/paint` | `theme/60-inputs.css` ↔ `theme/65-dropdown.css` |
| `@same-file LICENSE` | the whole file |

## `:where(#view)`, not bare `#view`

A page-scoped selector in `styles/pages/` anchors on `:where(#view)[data-page="…"]` rather than a
bare `#view[data-page="…"]`, because an id contributes `(1,0,0)` on top of whatever the rest of the
selector already carries. `20-overview.css`'s deepest chain (the progressbar row's
`.td:first-child` selector) already measured `[1,7,0]` on its own — `css-metrics`'s ratchet ceiling
— and a bare `#view` on top of it pushed that to `[1,9,0]`. `:where()` matches the exact same
single element (an id is a valid `:where()` argument) but contributes zero specificity, so nothing
about *which* element matches changes, and the chain measures `[1,7,0]` again — the ceiling then
held by an unrelated selector elsewhere in the sheet.

A wider `:where(#view, .fs-content)` was tried in `40-sshkeys.css` and rejected: `.fs-content` is
`#view`'s ANCESTOR, so a `> div` arm inside that `:where()` would match `.fs-content`'s children —
`#view` itself, a `<div>` per `fs-router.js`'s `stageView()` — rather than `#view`'s own children.
Widening the `:where()` list changes which element a descendant combinator lands on; it is not a
free specificity discount for every selector shaped like it.

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
stretch and sizes the item to fit-content. `max-width: 400px` capped nothing under that rule — the
card collapsed to its min-content (~131px) and the description wrapped one word per line;
`width: min(400px, calc(100% - 32px))` is what actually caps it.

The router hostname above the form (`.fs-login-host`) does not reuse the eyebrow tokens despite
sharing their position: those carry `text-transform: uppercase`, and a hostname is a name
(`Rb5009-Usb` is not what the admin typed) — case is the only thing telling two similar names
apart on a router farm. `overflow-wrap: anywhere` is there because the card is a definite 400px
and a hostname is one unbreakable token up to 63 characters long.

`.cbi-map > h1`, not `h2`: this page has no title bar to carry the document's one `<h1>`, so
`sysauth.ut` emits the heading at that level, and the ramp's own h1 size (26px,
`theme/45-misc.css`) wraps `Authorization Required` onto two lines inside a 400px card — reset
here to the h2 size, which was always the right size, only the wrong level.

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
  corrected to `.leases` on 25.12+. Dropping it left the whole file dead on 24.10 — measured there
  with the theme active, all five cells computed `white-space: normal` (issue #7's exact symptom).
  Both spellings are matched everywhere.
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
  plan and silently un-fix issue #7 (`base/95-luci.css` states this as the general rule for
  release-conditioned styling). The count test is wrapped in `:where()` so it costs nothing:
  `:has()` otherwise takes its argument's specificity, and the un-wrapped chain measured
  `[1,8,1]`, past the sheet's `[1,7,0]` ceiling.

Never match a `data-title` *value* in a selector here: LuCI fills it from the column heading, so
an English literal never matches on a localised router (issue #7 again), and for rows LuCI builds
from the heading's `innerText`, any transform the theme puts on `.th` rewrites the string the
theme's own CSS would try to match (`.th` carried `text-transform: uppercase` until issue #39).
`.stylelintrc.json`'s `selector-disallowed-list` fails the build on any `[data-title="…"]` value
match.

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
rather than a base rule and an override: a first version generalised one rule that silently
outranked the other two by specificity, and neither could win or lose against it by source order
once that happened.

`#syslog`'s own `width: 100%` is stated here, above `base`'s generic
`input, textarea { width: 210px }`: stock bootstrap pairs that with `#syslog { width: 100% }` and
wins on specificity, but this theme's generic field box lives in the `theme` layer, and a layer
beats specificity — so the same pair in `base` lost and the log rendered as a 210px column
(measured on 25.12).

### Appearance: from popover to page, and what stayed CSS

The controls used to be a popover on `<body>`, capped to the viewport because eighteen axes plus
an upload panel do not fit a floating card on a phone in landscape. As an ordinary page the
sections are stock `.cbi-section` cards and the scroll is the document's, so the popover's
placement, max-height clamp, fade-in and `[hidden]` pair are gone. The rows themselves are stock
`.cbi-value` and draw no layout of their own — caption column, field column and the row hairline
come from `base/30-forms.css` and `theme/60-inputs.css`, the same rules every other LuCI form
uses; a prior responsive card grid with an uppercase eyebrow per control was deleted because it
made the theme's own settings tab the one page in LuCI that did not look like LuCI.

Deleted controls, and why removing them is not an oversight:

- **The preset colour chips** (a row of pills painted in the accent they would set) — the Accent
  row does the same job with any colour rather than eight, and the row started at the card's edge
  instead of the field column.
- **The hue slider in the colour control** — two controls for one value read as two settings, and
  the slider half could never reach a grey. The axis still stores a hue and `03-palettes.css`
  still rotates by it, so a saved value keeps painting; the slider CSS itself was dead in the
  theme's own namespace, which `npm run css-orphans` exists to catch.
- **The `data-layout="top"` accordion toggle** hides `.fs-ap-submenus` because those sections are
  hover dropdowns in that layout, already exclusive — hidden in CSS, not by a JS branch, because
  the page is built once and a branch would freeze the control to whatever layout it loaded in.

The disclosure chevron (`.fs-ap-chev`) is the identical glyph the overview's own card toggle draws
(`pages/20-overview.css`), pinned `@mirror chevron/*` so the two copies cannot drift — two hosts (a
stock attribute-keyed element on Overview, a class-keyed one here) that no single selector list in
one layer can reach together.

The colour-contrast readout (`.fs-color-contrast` and its three grade colours) is a live number
against the surface the colour is read on (`fs-widgets`' `contrastRatio`) — a readout, not a
validation: the theme derives readable ink over a fill but never silently corrects a colour the
admin asked for, so the badge just states the number and grades it. Three grades, three colours,
and the failing one is `--fs-danger` — which the admin may just have recoloured, which is the
honest outcome.

### Overview: the disclosure pill, the grid, and the duplicate heading

`index.js`'s `data-indicator="poll-status"` pill is decoration only — the card *header* is the
real control (`fs-overview.js`'s `wireDisclosure()`), so the glyph is `aria-hidden` and
`font-size: 0` hides its "Hide"/"Show" text node. It shares the disclosure chevron pinned
`@mirror chevron/*` with the Appearance fold (see above); `.cbi-title h3, :scope > h3` is matched
because the wrapper differs by release (25.12 `.cbi-title > h3`, 24.10 a bare `<h3>`) and
`[role="button"]` is the anchor either way — on live 24.10.8 this arm matches 0 of 14 `<h3>`s
(measured, that release renders no hide/show control at all) and is not dead code, only unfired
there.

`fs-overview.js`'s `hideEmptyCard()` marks an empty `.cbi-section` LuCI still renders when a stock
include has nothing to show (title "-", the poll pill its only content, 72px tall on a live
Overview), and this drops it. The stock `<h2>` duplicate of the chrome's own page title is hidden
through `.fs-content[data-page=…]`, not `#view`, because the heading is a *sibling* of `#view` and
needs the outgoing page's identity for the whole staging window (`fs-router.js`'s `commitStage`).

`.fs-ovl` is the grid for System / Memory / Storage (System spans both rows on the left); its
items carry `min-width: 0` so a grid item shrinks to its *track*, not to its content's min-width
— a long System value (model/firmware) used to blow the single-column track past a ~344px phone
and clip.

### Overview: the port-tile reskin

`29_ports.js` (stock `luci-mod-status`) draws its port grid as `.ifacebox` tiles carrying inline
`style=` for zone colour and sizing; every `!important` in this file fights one such inline
declaration, property by property — `page` is the last layer, so a flag that fought only another
footstrap rule would be redundant and is not kept.

Grid sizing: `repeat(auto-fit, minmax(126px, 200px))` reads as "shrink toward 126px when there are
many ports", but a grid does not work that way — `auto-fit` picks the track *count* from the
definite *max* of the track function, so the count is always `floor(width / 200)`, and an 11-port
switch in a 1190px column got 5 tracks of 200px with 150px of air beside every one.
`minmax(76px * density, 1fr)` (`--fs-port-min`) asks it the other way: with an indefinite max the
count comes from the min, so the row takes as many tiles as fit and `1fr` shares the remainder.
The 76px floor is the widest traffic figure (`▲ 1024.0 PiB`, nowrap), stepped 1px at a time per
density until 0 of 24 maximal cards overflowed or wrapped, swept 320–1900px: 94px Normal, 80px
Compact, 109px Large.

The card itself is `flex-wrap`, not a grid with a `@container` threshold (issue #7): the threshold
was a proxy for a *content* question calibrated on English — `нет соединения` (~100px) with
nowrap traffic figures needed ~193px in a 178px box on a Russian router and overflowed under the
next card. Flexbox asks the real question for free: the two cells share a row while they fit.
`container-type` was tried on the card itself and reverted: it made every poll-rewritten card lay
out before containment resolved, shifting everything below it on every tick (bisected to that one
declaration).

The name row is clamped to two lines with `-webkit-box` (the one shape that both wraps and
ellipsises — `text-overflow` alone only truncates a single line), never three: an unclamped
nowrap name sets the minimum width of every tile on the page. `min-height: 2lh` was tried to
reserve the second line and cost 19px of empty air on every name that does not wrap (measured: a
5-port device stood 126px against 107px) — the grid already levels the row.

Meter rows (a key/value-shaped `.table` row carrying a `.cbi-progressbar` — Memory, Storage, CPU
load, connections, …) are matched by `:not(:has(.th)):not(:has(.td:nth-child(3))):has(.cbi-progressbar)`,
not per section, so any OTHER key/value-shaped include under `admin-status-overview`'s same
`:where(#view)[data-page]` scope gets the layout too: label + value on one line, the bar on the
next. A data-shaped row — a header cell anywhere, or a 3rd `.td` — is excluded and keeps its own
row layout regardless of section. This is an overview-page rule, not a global one — a same-shape
`.table` off this page (dashboard's Resources tab, any third-party app) gets none of it, just the
base `.cbi-progressbar` default below. The value's own reserve
(`padding-inline-end: min(230px, 50%)`) cannot survive a narrow card —
`16.66 GiB / 16.66 GiB (100%)` measures 218px against a 190px reserve on a 380px phone card — so
below 560px the label takes the whole line and the bar drops to its own line instead.

Row dividers and the key/value weight are dropped only where the table's SHAPE is a real key/value
pair — no header cell anywhere (`:not(:has(.th))`) and no row with a 3rd column
(`:not(:has(.td:nth-child(3)))`) — because a *data* table (one record among many) keeps its
dividers, but naming the three cards (`.fs-ovl-mem`/`-sto`) instead would have left System ruled at
1px per row and given a third-party include of the same shape nothing. The discriminator used to be
`:not(:has(.tr.table-titles))`, which catches only ONE header shape: `L.ui.Table`'s JS-captioned
constructor writes that class (`ui.js:3808-3820`), while `initFromMarkup` (`ui.js:3956-3984`) binds
a stock `<thead>`/`.th` markup table and writes no class at all. Measured live on `owrt2512`/apk and
`owrt2410`/opkg (1280 and 380px, HEAD vs worktree): `fs-select.js`'s `tagDataTables()`
(`fs-select.js:191`, `:220`, `:225`) already tags any `#view` or `.modal` table with a header — a
plain `<thead>` included, dashboard's `20_lan.js`/`30_wifi.js` and luci-app-acl's modal table all
among them — as `.fs-dt`, and this rule already excludes `.fs-dt`; those read identical at HEAD and
worktree, no pre-fix bug. What the shape test actually closes: a table with NO header row at all
and a 3rd `.td` (luci-mod-dsl's `stats.js`, the gallery's log fixture) — a shape `.fs-dt` never
reaches either, `tagDataTables()` needing a header — now correctly excludes and scrolls instead of
stacking. And because the shape test runs in CSS alone, a header table no longer flashes key/value
styling for the first frame before `fs-select.js` runs and adds `.fs-dt` — the class-based test
could only exclude it once that script had run. Every header shape LuCI writes puts its cell class
on `.th` (`ui.js:3832`, `form.js:2908-2914`), so `:not(:has(.th))` alone already covers
`.tr.table-titles` too — no separate guard needed for it.

### Software: the disk-space bar and the carded package row

The disk-space bar (label + value on one line, bar below) is scoped by `#view[data-page]`, not
`:has(#disk-space-label)` — 24.10 ships no such id. `#packages` is a DATA table
(`<table class="table" id="packages">`, no `.cbi-section-table` class; `fs-select.js` tags it
`.fs-dt` off its `.tr.cbi-section-table-titles` header), so it takes the shared card from
`theme/30-tables.css` once measured too narrow. There is no `@container` guard: overflow is the
trigger and `fs-select.js` measures it.

The package NAME column is `white-space: nowrap` so the column cannot collapse under it:
`overflow-wrap: anywhere` (the default a data cell gets) also lowers a column's min-content to a
single character, and with Version/Size fixed at `nowrap`, auto table layout took the whole
shortfall out of column 1 — measured with the filter on "app", the name column came out 81-101px,
narrower than Size (88px), and 6 of the first 8 names rendered broken mid-word. `nowrap` here does
not mean "never wrap": it makes the overflow honest, which is what `fs-select.js`'s measurement
needs — where a row genuinely does not fit, the table cards. Verified 560-1440px: 0 broken names,
no table overflow, card threshold unchanged.

`:not(...)` on the header rows is load-bearing in card mode: carrying an id makes the selector
`(1,1,0)` in the page layer, which beats `theme/30-tables.css`'s
`.table.fs-stacked .tr.cbi-section-table-titles { display: none }` and puts the header back on
screen, where every cell already prints its own label.

A card row is label-left / value-right, which `justify-content: space-between` would normally
spread over the `::before` and the cell's content — but flex makes every ELEMENT its own item, and
this page's filter wraps a match in `<ins>`, so a matched name is two items and space-between
pushed them to opposite edges (`luc` … 85px … `i-app-acl`). The fix hands all the free space to the
label instead (an auto inline-end margin on the `::before`), so everything else packs flush right
in DOM order however many elements the value is; the inline-end padding keeps a gutter when the
auto margin collapses to nothing. `min-width: 0` / `width: auto` are not restated on `.td`:
`theme/30-tables.css` already sets both on every `.fs-stacked .td`, and switching them off here
moved nothing across 500 matching cells — `text-align: end` is this file's own override of that
rule's `start`.

Column 4 (Description) is matched by index, `:nth-child(4)`, not `[data-title="Description"]`: a
translated string `.stylelintrc.json`'s `selector-disallowed-list` fails the build on, and it used
not to match even in English — LuCI builds `data-title` from the column heading's rendered
`innerText`, and `.th` was uppercased then, so the attribute said "DESCRIPTION" and the literal
matched zero elements on every router (fixed with the uppercase, `theme/30-tables.css`, issue #39).
Columns: 1 Package name, 2 Version, 3 Size, 4 Description, 5 actions. `overflow-wrap`/`word-break`
overrides were dropped from this cell: `base/40-tables.css` breaks every cell now and neither copy
moved anything against 100-500 matching cells (measured at 390px, the cell is 322 x 103px either
way).

The "Disk space:" caption is keyed on what it sits beside, not on `#disk-space-label` — that id is
25.12+ only (24.10's `package-manager.js` emits a bare `E('label',{}, …)`) — so an id rule is dead
on 24.10 and the caption keeps base's 250px-wide label. The disk section is the only `label`
immediately followed by a `.cbi-progressbar`, the same discriminator `theme/90-responsive.css`
already uses. The selector is `label:has(+ .cbi-progressbar)`, not
`:has(:where(+ .cbi-progressbar))`: a leading combinator makes the argument a RELATIVE selector,
which only `:has()` accepts — `:where()` takes a plain complex-selector list, so wrapping it there
makes the whole rule invalid and the browser drops it silently, past both stylelint and
`css-metrics`.

### SSH-keys: the card wrapper and the wide dynlist

SSH-Keys renders as a single bare `<div>` in `#view`, no `.cbi-section` wrapper, so it is given
`theme/30-tables.css`'s card values directly, scoped to this page: a general "card any bare
`#view > div`" rule was tried and reverted, because it also wrapped whole tabbed views (Startup).

An `authorized_keys` entry is a ~400-char base64 blob: the one dynlist that must not take
`theme/60-inputs.css`'s 440px cap. The override must live in `page`: in `base` it was dead, since a
layer beats specificity and `theme`'s plain `.cbi-dynlist` capped it anyway.

## Base layer: LuCI's own markup, corrected

`styles/base/` restyles class names LuCI itself emits with no theme-specific hook — the Meyer
reset, CBI form/table markup, the modal `ui.js` builds, widgets with no generic equivalent. Prefer
`styles/theme/` for anything that is paint; a base edit is for markup this theme cannot route
around (`.claude/rules/css.md`).

### Reset: `[hidden]` must outrank every layer, not patch one mistake

The UA gives `[hidden]` the weakest possible `display: none`, so any later `display` set on a
class — `.tr` (table-row), `.td` (table-cell), `ul.nav > li` (block), `.cbi-page-actions` (flex),
`.ifacebox` (inline-flex) — paints straight through it. `[hidden]:not([hidden="until-found"])`
carries `!important` on purpose, so it beats every layer including a page-layer id rule not yet
written; `until-found` is excluded because `display: none` there would break the find-in-page
reveal the value exists for.

### Typography and widgets: an opaque token needs `overflow-wrap: anywhere`, a tooltip needs `pre-wrap`

Two opaque, user-supplied strings sat inside elements that never learned to wrap: a WireGuard
public key inside inline `<code>` (`admin/status/wireguard`, one unbroken 44-char run) measured
64px past the content column at 320px before `overflow-wrap: anywhere` — the same escape hatch
every other opaque token in the sheet already carries (a MAC in the associated-stations table,
carried by the general table tiers in `theme/30-tables.css` since the page-specific rule was
deleted (issue #5, see "Which of the three a table gets, and what decides it" below), a hostname
in `pages/10-login.css`). A firewall rule-jump tooltip (`.cbi-tooltip`, "Chain
POSTROUTING, Rule #1") measured 65-72px past the column at 320px under `white-space: pre`, which
disables wrapping outright regardless of where a space sits; `pre-wrap` keeps every literal
whitespace run the rule exists for while still letting the browser wrap once the line is too long.

### Forms: control typography stays in base, on purpose

`label, input, button` font rules live in `base/30-forms.css`, not `theme/`: a bare-element rule in
a later layer outranks every classed base refinement regardless of specificity, and moving it once
grew the firewall's zone badges from 10.8px to 13px. In base, a classed rule still wins on
specificity, which is the contract these refinements were written against. `select` is excluded —
its face, size and leading live in `theme/60-inputs.css`.

### Forms: the label column's `min-width: 0` survives the responsive layer

`.cbi-value-title` sits in a flex row (`.cbi-value`) at `flex: 0 0 180px`; `theme/90-responsive.css`
restates `flex: 1 1 100%` under 767px but never touches `min-width`, so a value set here on the
desktop rule survives untouched into the phone layout — the cascade only overrides the properties a
later rule actually sets. Without it, a label whose text has too few break points renders at its
own min-content instead of the row's width: a Russian settings label measured 320px wide inside a
254-276px row on ssclash (Compact/Normal/Large), clipping the section by 33-50px with no scroller;
the English string in the same box needed 0.

### Tables: overflow-wrap follows the tier, not the file

`base/40-tables.css` sets `anywhere` on values and `break-word` on headers/first column for every
table this layer reaches (config tables, key/value includes, meter rows) because none of them is
measured and none can card on demand — containment is the only outcome available. The full per-tier
table and the two bugs (#32, #36) that shaped it: "The floor, and why exactly one tier has one",
below.

### Tables: the key/value discriminator is the table's shape, not a class

`theme/30-tables.css`'s desktop label/value styling and its ≤560px stacking (`:155-185`) match a
`.cbi-section .table` only when it has no `.th` anywhere and no row with a 3rd `.td` — a real
key/value row is exactly 2 cells, neither a header. The discriminator used to be
`:not(:has(.tr.table-titles))`, which caught only `L.ui.Table`'s JS-captioned header
(`ui.js:3808-3820`); `initFromMarkup` (`ui.js:3956-3984`) binds a stock `<thead>`/`.th` markup table
with no such class. Measured live on `owrt2512`/apk and `owrt2410`/opkg (1280 and 380px, HEAD vs
worktree): `fs-select.js`'s `tagDataTables()` already tags any `#view` or `.modal` header table it
reaches — a plain `<thead>` included — with `.fs-dt`, which this rule already excluded; dashboard's
`20_lan.js`/`30_wifi.js` and luci-app-acl's modal table read identical at HEAD and worktree, no
pre-fix bug. `attendedsysupgrade`'s `11_upgrades.js` table renders via `ui.addTimeLimitedNotification`
into `#maincontent`, outside any `.cbi-section`, so no rule on this page ever reached it either way.
What the shape test actually fixes: a table with no header row at all and a 3rd `.td`
(luci-mod-dsl's `stats.js`, the gallery's log fixture) — a shape `.fs-dt` never reaches — now
scrolls instead of stacking; and, running in CSS alone, a header table no longer flashes key/value
styling for the first frame before `fs-select.js` runs and adds `.fs-dt`. Every header LuCI writes
puts its cell class on `.th` (`ui.js:3832`, `form.js:2908-2914`), so `:not(:has(.th))` already
covers `.tr.table-titles` too. The overview page's own divider/weight and meter-row rules
(`pages/20-overview.css`) repeat the same test for one consistent discriminator, not because a live
table on this page was found misclassified; its DATA-table row-height rule runs the complement of
it (`:is(:has(.th), :has(.td:nth-child(3)))`) so a stock header table under this page's
`.cbi-section` scope gets the data-table padding, not the key/value one. "Overview: the port-tile
reskin", above.

### Tables: the empty-table placeholder must not pin to the table's bottom

`.tr.placeholder > .td` is `position: absolute` so a lone cell in a `display: table` row cannot
widen column one to its own sentence's max-content (measured: 275px -> 502px on an empty section).
It carried `bottom: 0` once, which inside `position: relative` `.table` resolves to the bottom of
the whole table, not the placeholder's own row — and `form.TableSection` renders `footer` into a
`<tfoot>` *after* `<tbody>`, so on every empty section with one the plate printed straight across
the totals (measured on luci-app-dockerman: a 1190x35 overlap, issue #36). With no `bottom`
declared the box keeps its static position instead, which is where the row actually is.

### Buttons: `--on-color` survives the absorption into theme, fill and border do not

Every `.cbi-button-*` variant here sets only `--on-color`: fill, border and radius moved to
`theme/55-buttons.css`, whose `.cbi-button, .btn` rule outranks anything restated here by layer
regardless of specificity — proven with a computed-style diff over `docs/gallery.html`, which
renders every variant, not reasoned. `--on-color` stays because it is not paint:
`base/95-luci.css` masks the spinner glyph with it, so the variable has to track the button whether
or not the layer above repaints the box.

### Buttons: the flex clearfix, and why `float` is dead on `.cbi-page-actions`

`.cbi-page-actions::after` is not a clearfix — the container is flex, so nothing floats — but the
generated empty item still counts toward `gap`, closing the trailing 8px every button would
otherwise carry past the last real one (measured, both writing directions). `.secondary-action`
carries no `float` for the same reason: `theme/55-buttons.css` makes `.cbi-page-actions` a flex
container, and float does not apply to a flex item; verified live at 1400px, the button sits at the
same 569px from the reading edge with or without the declaration.

### Widgets: `.actions .secondary-action` still floats, and needs a hand RTL mirror

`.actions` (the legacy, unthemed action plate some `luci-app-*` still emits) is not flex, so its
own secondary action keeps a real `float: right`, mirrored by hand to `left` under `[dir="rtl"]`
because `float` has no logical keyword this sheet can rely on — `inline-end` needs support this
sheet does not yet require, and a browser that does not know the keyword drops the declaration and
leaves the button floating nowhere. Unmirrored it also fights its own container: `.actions` sets
`text-align: end`, which follows writing direction, so the plate's own alignment and the button's
float pointed opposite ways in RTL (measured: 582px from the reading edge in LTR, 10px in RTL — the
button sat on the wrong side of the text it shares a row with).

### Widgets: the tooltip parks past the unreachable edge, and the close cross needs the same mirror

`.cbi-tooltip`'s hidden position is `inset-inline-start: -10000px`, not a physical `left`: in an
RTL document a physical `left: -10000px` parks the tooltip past the scrollable *inline-end* edge,
which grew a 10000px horizontal scrollbar on every ar/fa/he page (measured); the inline-start edge
is unreachable in both directions. `.close` carries the same hand-mirrored `float` as `.actions`
above, for the same reason (no reliable logical keyword) — unmirrored, the dismissal cross measured
549px from the reading edge in LTR and 41px in RTL, i.e. it lands in front of the title rather than
past it, in every modal and every `.alert-message`.

### `base/95-luci.css`: the GridSection name column, read from the markup, not the release

25.12's `form.js` renders a GridSection's name as a real `<th>` plus
`td.cbi-section-table-titles`; 24.10 renders no such cell and expects `::before` to generate the
column from `data-title`. Each row type is discriminated by what it carries, never by release: a
header row carries `data-title` on 24.10 only (25.12 appends the real `th` instead); a data row
carries `data-title` on both, so the discriminator is whether the row has that extra name cell; a
description row has neither and simply follows whichever branch its header already proved. Keying
on the header's *value* would break on a translated build, since `data-title` there is `_('Name')`.
The `:has()` half of the rule is split off on its own so an engine that cannot parse it (Firefox
<121) drops only that selector and not its plain siblings — combined, one `:has()` failure would
have taken stacked-table card labels down with it everywhere.

### `base/95-luci.css`: the dark-mode zone tint, and why it has no grey fallback

`[data-darkmode="true"] .zonebadge[style]` re-mixes `luci-mod-network`'s inline zone colour at
`.4/.3` because a raw zone colour is too bright on a dark panel. `--zone-color-rgb` carries no
fallback on purpose: LuCI sets that variable inline only where a zone colour exists, so elsewhere
the declaration is invalid at computed-value time and, being `!important`, resolves to `unset` and
lets the plain inline background show through — a fallback grey would instead apply the rule
everywhere and tint five interface boxes that should just show the panel behind them (measured with
a computed-style diff).

### `base/95-luci.css`: the overflow-wrap fix generalised once, not restated per page

`.ifacebox-body`, `.network-status-table .ifacebox-head` and the same pair on the port tiles all
need `overflow-wrap: anywhere` (not `break-word` — only `anywhere` lowers the box's own
min-content, letting a flex item actually shrink) because their labels stopped being one short
word: a stat line ("1000 Mbit/s / 1.2 GiB / 8.3 GiB") measured 33px past a 118px box in plain
English, and a Russian caption ("Подключение IPv4 (внешняя сеть)") measured 301px in a 288px column
at 320px/Large — 41.3px past `#view`, clipped with no scroller, 0px in English at the same width.
Fixed once on `.ifacebox .ifacebox-body` rather than as a fourth scoped copy the next real page
would need again.

### `base/95-luci.css`: the spinner glyph sits in the flow, on purpose

`.spinning::before` reserves its own space with `flex: 0 0 auto` (or `vertical-align: middle` on a
non-flex host) instead of being absolutely positioned with a compensating `padding-left` on the
host — that padding cannot be won by any one rule, since every padding declaration aimed at the
button is a candidate and the loser draws the glyph on top of the label. Reported twice, each time
by a more specific host rule: issue #15 (`.td .cbi-button`, specificity 0,2,0) and issue #22
(`.cbi-section .table[id] .td .cbi-button`, 0,5,0), where the ladder had `padding-left: 10px`
against the 32px the glyph needs. In the flow, no host needs a padding and there is nothing to
out-rank. Rotation stays a plain CSS `animation`, never an SVG-internal `<animateTransform>`: that
runs in the SVG's own document, out of reach of the page's `prefers-reduced-motion` query, and
would have been the one spinner a motion-sensitive reader could not turn off.

### `base/95-luci.css`: the file browser's floor, and the row that is not text

`.cbi-filebrowser`'s `min-width: min(210px, 100%)` keeps the file list readable without becoming an
overflow itself: a bare `210px` floor measured 210px inside a 203px field at a 300px viewport, with
the whole upload row standing 7px outside the card (same fix as the dynlist's floor one file over).
Its child rule assumes every row is one line of text (`nowrap` + ellipsis); `.right` breaks that
assumption — its content is the upload strip plus Create/Cancel, none of it text an ellipsis can
stand in for. Inherited `nowrap` blocked the wrap the Browse button already had (`flex-wrap: wrap`),
and `overflow: hidden` clipped Cancel's label 76px past the box with no "…" drawn — the gate's own
"text the reader cannot reach" case, not the accepted dropdown/tab shape.

### `base/95-luci.css`: Statistics graphs and Realtime SVGs are art drawn for a white ground

Statistics renders its collectd graphs as PNGs authored for a white background, so dark mode
inverts them: `hue-rotate(180deg)` is arithmetic, not taste — `invert()` maps every hue to h+180,
so rotating 180 back restores the original hue while keeping the inverted lightness. Read off
collectd's own CPU series, 150deg landed the System series (h=0) at h=301 and User (h=240) at
h=180, both ~60deg out; 180deg lands all three primaries exactly, though a non-primary (amber)
still lands 13deg out — CSS `hue-rotate` is a linear matrix approximation, and moving off 180 would
trade an exact red/green/blue for a marginally better amber.

Realtime graphs (Status -> Load/Traffic) inject `resources/svg/*.svg` with inline `style=`
attributes drawn for a black background the theme does not use: the grid `<line>`s carry
`stroke:black`, invisible on a dark panel, and only an author `!important` beats an inline
declaration. The axis `<text>` labels need the same override plus a bold weight — the file's own
9pt grey-on-black-halo pairing lands the grey on white at 1.16:1, legible only via its halo, and at
14.7:1 on the dark panel, where it is the halo that must go instead; the SVG's 9pt is the smallest
type this theme renders, and at regular weight also the thinnest it draws. The child-combinator
selector (`> text[style]`) matters because Channel Analysis colours its SSID labels the same way it
colours their curves, built inside a nested `<g>` — a descendant selector would recolour the curves
along with the axis; only a direct child reaches the axis alone.

## Theme layer: components absorbed and fixed

`styles/theme/` is footstrap's own component paint: files 60-97 cover form controls, the
`.cbi-dropdown` menu, buttons, the modal, search, the responsive breakpoints, forced-colors/
reduced-motion, and print. Each section below is the finding a comment in that file points at —
the code carries the invariant and the number, this carries the story behind it.

### Meter: the value's line is reserved in flow by default, not floated on faith

`.cbi-progressbar`'s value is an absolutely-positioned `::after` (`content: attr(title)`), floated
above the bar's top edge so a thin track never grows into a fat pill. Through 0.14 the bar carried
`margin: 0` — no space held for that floated line — which works only where a context already
happens to leave room above the bar. Off `admin-status-overview`, a key/value `.table` row (label
33% | bar, no header row — `luci-mod-status`'s `20_memory.js` markup, reused verbatim by
`luci-mod-dashboard`'s Resources tab, forum thread 253559 post 54) gets no such context rule, so the
value spilled 5-6px above its row and printed across the divider belonging to the row above.

The fix follows upstream `luci-theme-bootstrap`'s model: reserve one line in flow
(`margin-block-start: calc(var(--fs-type-xs) * var(--fs-leading))`, the SAME expression
`.fs-stacked` and the overview `<=560px` rule already used) as the bar's DEFAULT, so the floated
label always has a band to sit inside regardless of what wraps it. Only the contexts that
deliberately place the value BESIDE the bar (`.cbi-value-field`, a data table's meter column — both
pinned in `@mirror meter/beside`) or on a neighbour's line (overview's meter rows at desktop, the
package-manager disk bar at both desktop and phone) opt out with `margin-block-start: 0`. Where an
existing rule already styled that bar it carries the declaration (`@mirror meter/beside`); overview
and package-manager had none — no prior rule targeted the bar on either page — so each got a new
page-layer rule for the same selector, opt-out only, no other declaration. Everything else — the
gallery's bare meters, a third-party app's key/value table, the old dashboard's 30_wifi assoclist
(never reached by the `admin-status-overview`-scoped meter-row selector above — wrong page — and,
since that selector now tests SHAPE, its `<thead>`/`.th` header would fail the key/value test on its
own even if it were) — takes the new default and reserves its own line.

### Inputs: the toggle switch, drawn on the input, not the label

Through 0.14 the switch was drawn on `label[for]` with the real `<input>` hidden
(`position: absolute; opacity: 0; width/height: 0`). forum.openwrt.org/t/251930 post #141:
luci-app-modemdata, and any third-party CSS built the way bootstrap expects (styling the native
input), injects an unlayered `label[for] { display: none } !important` scoped to its own markup —
which left nothing visible, since the input it spared was already the invisible one. Drawing on the
input instead means an app that hides `label[for]` hides an already-empty placeholder, not the
switch; `label[for]` stays in the DOM (`ui.js` and third-party apps emit it) but is now the
out-of-flow element.

`flex-shrink: 0` exists because a caption after the pill —
`label.cbi-checkbox > input + label[for] + TEXT`, package-manager.js's and banip's real markup —
makes the input a second, shrinkable flex item. Unshrunk it stays exactly `--sw-w`; measured shrunk
on the live Install dialog on both stands before the fix: RU/Normal/390px gave a used width of
30.17px against 40 declared and a knob 6.83px past the pill's right edge, EN/Large/360px 36.22
against 46 declared and a 6.47px overhang — `flex-shrink: 0` alone took both to −3.00px and −3.31px
(the knob safely inside the pill).

### Inputs: `.hidden.hidden`, and the Tailwind/UnoCSS exception

`fs-sheets.js` (`rehostIntoThemeLayer`) re-hosts a foreign app's own sheet into `@layer theme`,
where it now competes on specificity instead of losing to an unlayered rule by layer order alone.
Measured on owrt2512 with luci-app-splify2 26.9: `<aside class="hidden lg:flex …">` (`Rail.tsx`)
stayed `display: none` at 1440/1920px because `.hidden.hidden` at (0,3,0) outranked `.lg\:flex` at
(0,1,0) once re-hosted. `:not([class*=":"])` excludes any class list carrying a Tailwind/UnoCSS
responsive variant (the colon in `lg:flex`, `md:block`, `sm:inline`) from the invariant — LuCI
itself never emits a class containing `:`, so nothing stock is affected. Specificity moves to
(0,3,0) — `:not()` counts its argument's attribute selector, (0,1,0) — still clear of
`input[type="submit"]` at (0,1,1) (issue #12, unchanged).

### Inputs: the range slider's hit target and its line-box

`.cbi-range-slider` is the one control where growing the native `<input>`'s box for the WCAG 2.5.8
target (24px) also grows the row around it, and not through the slider's own cross size (pinned at
29.5px by the value chip beside it). `.cbi-value-field` lays the slider out as ordinary inline
content, and the line's height follows where `.cbi-range-slider` (inline-flex, no
baseline-participating child) reports its baseline — which tracks the first flex item's own edge,
the input, whose box moved with the target. Measured before either fix: `.cbi-value-field`
+2.75px (Chromium) / +2.5px (Firefox), `.cbi-value` +1.5px / +1.0px, track/thumb ~1.25px lower.

The fix is two parts. First, the checkbox's own trick on the input itself: grow the box to 24px,
then pull the extra area back out of flow with a symmetric negative margin (`margin-block: -9px`,
since 6px was the old box) so it overflows around its old centre rather than pushing anything
taller — this alone left the row's growth above unchanged, since `.cbi-range-slider`'s line-box
placement tracks the input's edge, not the flow space the margin trick frees. Second,
`vertical-align: middle` on `.cbi-range-slider` places it in the line by its own total height
instead, held by the margin trick at 29.5px regardless of the input's growth — decoupling the two.
Measured with both fixes against HEAD, gallery slider fixture, both engines: `.cbi-value-field`
+0.000px, `.cbi-value` −0.187px (Chromium) / −0.183px (Firefox), under a fifth of a CSS px. Box
unchanged at 258x24.

### Dropdown: the display state machine, unflagged

`.cbi-dropdown` came in from a theme with no `@layer`, which needed `!important` flags on every
show/hide rule to beat its own bare `ul` rule. Flag-vs-flag falls back to specificity-then-order
anyway, so the absorbed rules state that resolution openly instead. Every shower out-specifies the
hider it overrides: `li[display]` (0,2,2) over the plain `li` hider (0,1,2); `[open] > ul.dropdown >
li` (0,3,2) likewise; the placeholder rules (0,5,2 and 0,6,2) over the placeholder hider (0,4,2);
the form rule (0,4,3) over its hider (0,1,3). `[empty]`'s block (0,2,2) loses to `[open]`'s flex
(0,3,2) deliberately — an open empty list still lays out as a popup, the resolution the old flags
produced among themselves.

### Dropdown: ellipsis needs `min-width: 0` first

`text-overflow: ellipsis` alone did nothing: a flex item's automatic minimum floors it at its own
content width until `min-width` says otherwise, so `overflow: hidden` never engaged and a value
longer than the box ran past it instead of eliding. Measured at 320px, Russian cut mid-glyph at
132px (Compact) / 225px (Normal) / 280px (Large) on https-dns-proxy, 66px on nlbw/config, 70px
inside the network interface-edit modal. No `title`/`aria-label` stands in: the full string stays in
the DOM and the accessibility tree so a screen reader still gets it whole — a `title` is not
announced on touch, and an `aria-label` carrying the SHORTENED text would violate WCAG 2.5.3 (the
accessible name must contain the visible text).

### Dropdown: the open list's rail and the selected-row's contrast

The selected row's surface is OPAQUE (`--fs-panel2`) and the accent is carried by an inset rail, not
by a tint of itself: accent text on `--fs-accent-soft` measured 4.21:1 in dark, under AA — the tint
drags the background toward the text and eats its own contrast. axe never caught it: no gallery
fixture rendered an OPEN dropdown with a chosen value. The focused row's ring is inset rather than
the token's outer 3px because the menu clips its own overflow and an outer ring is cut on the first
and last rows; both the `[selected]` and the plain `:focus-visible` selector carry `[selected]`-level
specificity on purpose, or a bare `li:focus-visible` would tie with the selected-row paint and leave
the focus ring to source order.

### Dropdown: 992px, not 960

Below ~960px of available width a multi-dropdown row no longer fits, so each config row cards — the
same shape as the data-table stack (`theme/30-tables.css`), and a `@container`, not the measurement
the data tables use: these rows are full of widgets that bake in a width from the layout they were
rendered in, so un-collapsing one to take a reading CHANGES what is read (the firewall zone table
then claimed 1747px where it needs 1190px).

992, not 960: the query reads `.cbi-map` (`theme/45-misc.css`), one level above the `.cbi-section`
that actually holds the table, and never subtracted what that level spends — `--fs-card-pad` on both
sides, 32px at the density every page but Compact ships. Measured live: firewall/zones'
`.cbi-map` sat at 968px, 936px once the section's own padding was out, and its six Russian headers
needed 1017px — 968 cleared the un-adjusted 960px check and the table never carded, clipping the
header row 49-65px with no scroller anywhere near it (English's shorter headers happened to fit the
same 968px, which is why only Russian showed it). `992 = 960 + 32` makes the check ask what it
always meant to: whether the SECTION's own content, not the map's, has cleared 960px.

### Misc: the realtime graph bleed

`Status -> Realtime`'s graphs size their drawing from `#view`, not from the box they draw into:
`width = document.querySelector('#view').offsetWidth - 2`, in every realtime view and in the
`luci-app-*-status` copies of them. That assumption holds only in a theme whose `.cbi-section` has
no gutter; footstrap's is a card, 16px of padding plus a 1px border, so the canvas comes out 34px
narrower than the drawing — and the views draw NEWEST-first from the right, so the freshest samples
are the ones falling off the edge. It reads as a phone bug only because the loss is absolute: 34px
of a 1124px desktop plot is 3%, of a 322px phone plot 10%. The fix bleeds the graph box back out to
the card's border edge with an `!important` fighting the inline `width: 100%` the view writes, since
nothing in a cascade layer can outrank an inline declaration (issue #32).

### Misc: fade-in animates nothing, on purpose

`fade-in` is upstream's class, and `luci-mod-status` re-marks every section AND the wrapper holding
all of them with it on EVERY poll tick, so anything this theme hung on that class replayed across
the entire content column five times a minute. A fade plus a 4px slide moved the page under the
reader; the fade alone still pulsed the whole column, reported from an iPhone as shaking that
happens WITHOUT SCROLLING AT ALL — a poll tick is the only thing that happens on a still page. The
fix is to animate nothing on the class: it stays in the markup, being upstream's, and the `fade-in`
keyframes in `base/95-luci.css` stay for the coverage reason stated there (some third-party app may
still trigger them outside a poll).

### Toplayout: measured, not media-queried

`theme/50-toplayout.css` is a DELTA, not a layout: the top bar itself (sticky, blurred, row, popup
submenus, square icon buttons, the right cluster) is the unguarded base in `theme/20-shell.css` —
that is what the chrome IS unless the vertical sidebar overrides it. This file adds only what the
top-layout bar wants on top of that: a designed bar height, padding aligned to the content column,
and the menu riding the brand's row instead of wrapping beneath it.

There is no `@media` floor because "does the menu fit on the brand's row?" is a property of the
CONTENT (5 sections stock, eleven with a few `luci-app-*`), not of the viewport — a hard-coded
breakpoint gets it wrong in both directions for a router with an unusual section count. `fs-chrome.js`
(`fitChrome`) measures instead: it shrinks the pills, collapses the poll pill to an icon, then stacks
the menu onto its own row (`.fs-bar-stack`), all at any width. The under-item dropdown and its clamp
apply at every width for the same reason and live with the bar in `20-shell.css`, not here.

### Buttons: the page-action bar wraps, not shrinks

`.cbi-page-actions` is the design call to WRAP the bar rather than let its items shrink into it.
Save/Reset are plain text with no ellipsis, so their min-content protects them — a no-wrap row's
shrink factor lands entirely on the Save & Apply split control, whose caption DOES have an ellipsis
to give (`theme/65-dropdown.css`) and so absorbs the whole squeeze. Measured on the gallery's own
fixture (EN "Save & Apply"): a no-wrap row cut it by up to 87px at 320px/Normal and 119px at
320px/Large, worse than the numbers the bug this fixed was filed against (43-68px on a live page,
where the sidebar leaves less room than the gallery's isolated card) — same fault, same direction,
the fixture just had less room to give.

`flex-wrap: wrap` sends the split control (or Save+Reset) to its own line once they no longer fit
one, so the caption is squeezed only by its OWN box, never by a sibling's: the same fixture measures
0px cut at every width/density the bug was filed against, Russian or English, after this one line.
The caption still owns an ellipsis for the genuine edge it cannot solve — a full Russian sentence at
Large density in a 320px column has nowhere left to grow even alone on its line (measured: 33px
still short) — and that is the right place for it to give, not a sibling button's unrelated width.

### Buttons: `flex-basis: auto`, not the definite basis base gave every row action

`.td .cbi-button, .td .btn` was dropped: the action cells this rule was filed against
(`form.TableSection`'s `.td.cbi-section-table-cell.cbi-section-actions`) are already reached by
`.cbi-section-actions .cbi-button`/`.btn` — `.cbi-section-actions` sits on the `.td` itself, so the
descendant selector matches with no `.td` needed. What the bare `.td` reached and those two do not
is every OTHER button in every OTHER cell: measured collateral, 14 buttons including the icon-only
rail drag handle and a plain-cell "Reserve IP" (Wireless's hand-built `.td.middle`, DHCP leases —
neither carries `.cbi-section-actions`), `overflow: hidden` re-baselining an inline-block and
growing the DHCP leases rows 50px -> 50.84px (10 rows at 1280px) for nothing that clipped.

`base/95-luci.css` sizes each button `flex: 1 1 4em` inside `.td.cbi-section-actions`. A DEFINITE
flex-basis is what let the fix above regress the desktop: with `overflow: hidden` alone, the
automatic minimum for a definite basis resolves to 0 in EVERY row regardless of room, so
`flex-grow` divides by count instead of by need even where nothing needed to shrink — measured live
on Firewall Zones at 1440px, three buttons that read 37.66/97.73/89.69px in v0.14.11 converged to
75.02/75.03/75.03px, 11-21px of caption ellipsised for zero gain (same row total, 225.08px, either
way). `flex-basis: auto` is the one-property fix: it hands sizing back to CONTENT, so the automatic
minimum is the caption's own min-content again and `flex-grow` only ever redistributes genuine
slack — reproduced locally (`docs/gallery.html`'s Startup fixture, unconstrained): `auto` restores
the exact v0.14.11 widths (101.58/137.72/112.08/230.25px) at 1440px, 0px moved, with
`overflow: hidden` left in place. `overflow: hidden` plus the ellipsis still answer the original
fault — a row genuinely narrower than its captions' combined content now shrinks BELOW their
min-content, not before, and the caption gives (ellipsis), never the neighbour's box. Sweep-measured
on real captions at every density: 14-19px on Startup, 12-13px on "Клонировать", 16-18px on
"Перезапустить"/"Перезагрузить", 5px on "Принудительно завершить" — 0 with the English caption in
the same row. `.cbi-page-actions`'s `flex-wrap: wrap` does not reach these: that selector is the
Save/Apply footer, not a table row, and this is a different container with no line to wrap onto.

### Modal: no horizontal scroll, ever

`#modal_overlay` is the scroll container (`base/60-modal.css`, `overflow: auto`) and the dialog is
centred in it with `margin: auto`, so one over-wide child scrolls the modal's own left edge off the
screen — the dialog still there, just unreachable-looking. Measured at 360px: the overlay wanted
634px of scroll against 530px of room.

Two children do it, both stock LuCI markup. `<label class="btn">` — `flash.js` writes each checkbox
row as one, and `.btn` is `white-space: pre`, right for a button's own label and wrong for a
sentence, so it cannot wrap at any width (scoped to `label`; a real button keeps `pre`). And a `<li>`
carrying a checksum, one unbreakable 64-character token. `overflow-wrap: anywhere` goes with
`white-space: normal`: normal alone lets the sentence wrap at its spaces, not enough for a label
ending in a ~200px path token, which still runs past the box in any dialog narrower than that
(measured in the gallery at 320px: 277px inside a 264px column, 13px out). `min-width: 0` is the
other half — without it the wrap never fires, since `.btn` is `inline-flex` and the label is a flex
CONTAINER whose automatic minimum is its content's min-content.

`anywhere` rather than `break-word` follows the tier doctrine (`base/40-tables.css` states it for
cells) rather than contradicting it: `break-word` leaves min-content at the widest token, wider than
the dialog at 320px, and the anonymous text flex item cannot be given a `min-width` of its own — a
dialog label has no card to fold into.

### Responsive: a split button's label must wrap under 360px

`white-space: pre` on a button is stock — luci-theme-bootstrap sets it too — and it holds while the
label is short. Footstrap's buttons are wider than stock's at the same job: measured on ssclash's
split button at 320px, "Сохранить и перезагрузить конфигурацию" is 295px against stock's 245px,
because this theme's face is wider than the system stack even at a smaller size (13px vs 14px), and
the 14px side padding adds 12 of the 50. The app's wrapper is `inline-flex`, so it takes the
buttons' max-content — 324px inside a 288px column — and overflows by 36px. Stock fits only because
its buttons are narrower.

Narrowing the buttons would be re-typesetting the theme to suit one app. Letting the label wrap
costs nothing where it already fits — a short label has no wrap point — and turns the one case that
does not into two lines. Scoped to the width where it happens: at 390px the same page is clean.
`min-width: 0` goes with it, or the automatic minimum keeps the button at its longest word and the
flex line cannot shrink it at all. `word-break: normal` is the third half: `base/10-reset.css` gives
every button `break-all`, inert while the label cannot wrap at all — the moment it can, `break-all`
takes precedence over word boundaries and the label breaks mid-word
("Сохранить и перезагрузить ко" / "нфиг"). `overflow-wrap: break-word` keeps the escape hatch for a
single word wider than the button, which is what `break-all` was there for.

### Responsive: no `display: block` on `table.fs-dt`

A rule that once forced `table.fs-dt { display: block; width: 100% }` at phone widths sat here to
stop a data table that still fitted as a table from exceeding its column — and its absence is what
makes the measured design work at phone widths at all. `display: block` on a `<table>` DISCARDS the
table formatting context, so the rows are wrapped in an anonymous table sized to the block and the
table can never be wider than its parent — which means it can never overflow, which means
`fit.overflows()` can never see anything below 767px. Measured on Processes at 720px with such a
rule in place: the Command column sat at 126px against a widest token of 353px, and forcing that
column's `overflow-wrap` three different ways produced the same 126px and the same "the table fits"
every time.

### Responsive: the disk gauge value moves below the bar

The bar's `::after` value ("63% used …") normally floats above the bar, but the System page's "Disk
space:" label already sits there — on a phone the long value text overlapped label and bar. The bar
is a fixed 10px box, so a static `::after` cannot push the next control: reserve space with
`margin-bottom` and place the value absolutely in it. The disk section is the only `label`
immediately followed by a `.cbi-progressbar`.

### A11y: prefers-contrast token shifts, and the numbers behind them

`prefers-contrast: more` asks for MORE contrast but, unlike `forced-colors`, leaves the palette to
the theme. Same mechanism as `prefers-reduced-transparency`: re-state the tokens and every rule that
reads them follows.

- **the hairlines**: `--fs-border` is the most-read line in the theme and sits at ~20% of the
  text's contrast, so it is pulled toward `--fs-text`. The role hairlines (`-line`/`-line-hi`, a
  40/55% tint of their role) go to the FULL role colour — a tint exists to be quiet, the opposite of
  what this user asked for.
- **secondary text**: `--fs-dim` toward `--fs-text`, and `--fs-faint` most of the way there too
  (10-11px eyebrow labels are where AA erodes first). Not all the way onto `--fs-dim`: the two are
  the export tier's `--text-color-medium` and `-low`, so collapsing them republishes one colour
  twice to every app reading the gradation. 82% is a window `tools/export-tier.mjs` measures rather
  than takes on trust: below 80 the fainter ink drops under AA on footstrap dark's `--fs-panel2`
  (4.51:1 at 80), above 82 the high-to-low ramp falls under the 0.10 spread the tier promises (0.098
  at 84); 82 clears both, at 4.68:1 and 0.110.
- **`--fs-placeholder`, in BOTH modes**: the one token the theme ships deliberately under AA
  (3.99-4.48:1 light, 3.43-6.05:1 dark) — a hint has to move far enough not to read as a typed
  value, and a dark palette has only 6.45:1 of ink to spend. A reader who asked for more contrast has
  said which of the two they want, so the mixes go back to the AA-clearing 62% and 80% — 4.98:1 and
  4.61:1, at 37% and 20% of the ink-to-field range instead of 44% and 34%. Only
  `--fs-placeholder-mix` moves: the mix itself is spelt once, in `03-palettes.css`. `placeholder-ink`
  measures this pass as well.
- **the focus ring**: `--fs-focus-ring` is a tint of the accent (`--fs-accent-soft`, 10% light and
  15% dark), so at "more contrast" it carries the accent at 60% instead. Its sibling
  `--fs-focus-ring-solo` is already the solid accent and needs no restatement here.

### A11y: forced-colors state repairs

Windows High Contrast forces `background-color` on most elements to the system canvas, so any state
carried by BACKGROUND alone vanishes: the active tab pill, the checked toggle and the selected
dropdown row all look exactly like their inactive siblings, which is a correctness bug rather than a
cosmetic one. `.ifacebox-head.active` and Apply join the tab/dropdown list rather than getting a
rule of their own, being the same KIND of state — carried by a background, with no word to fall back
on — and the same repair: "this port is up" was indistinguishable from a dead port, and Save & Apply
did not read as a BUTTON at all (it is a `.cbi-dropdown` wrapper, so with its fill forced to Canvas
only the label inside the `<li>` kept a highlight). Not extended to the alert and `.label` variants:
encoding severity in border-style is not a scale anyone can learn, and the honest repair is a word or
an icon in the markup, which is `ui.js`'s.

The `#topmenu` active item carries its state in exactly the two things forced colors drops, a
10%-alpha accent background and the box-shadow rail. Measured with the query emulated, all twelve
`#topmenu` links reported the same weight, shadow, border and colour, so the current page was not
marked at all — `aria-current="page"` is on the link, so this was a sighted-user loss only. The rail
comes back as a real border, which forced colors keeps.

## The card contract: what is measured and what is not

A table folds into cards by two different mechanisms, and that is not an unfinished job.

**A data table is measured.** `fs-fit.js` (through `fitTables` in `fs-select.js`) removes the
class, reads the width, decides, and sets `.fs-stacked`. The decision depends on what the table
needs, not on the screen, so `@media` cannot express it: cards can happen at any viewport
width. Measuring is safe because a data table holds no widgets.

**But a measurement is never taken while the reader is scrolling, and a table that has not been
answered for takes no room.** Both come from the same failure, reported from an iPhone against a
remote router: the poll REPLACES these tables, so every tick handed the fitter an unmarked element
that was laid out full-width for a frame — several screens taller, at 390 px, than the card stack it
was about to become — and the fit pass itself read layout once per table in the middle of a flick,
which is exactly the work iOS holds the main thread back to prevent.

So `fs-fit.js` has two registration channels, and which one a pass belongs in is a contract rather
than a habit: `fit.add()` for a pass that may read layout, which therefore never runs while the
reader scrolls and is re-run when they stop, and `fit.addAlways()` for a pass that only writes.
Marking a freshly arrived table is the second kind — it cannot wait, because
`:root[data-fs-fit] .table.fs-dt:not(.fs-fitted) { display: none }` keeps an unanswered table out of
the layout until it has an answer. Where does that answer come from without measuring? From the
SLOT: the section frame survives a poll tick, so the table that was replaced left its decision
there, keyed by column count and room. The guard on `:root[data-fs-fit]` is what makes the rule
safe: the attribute is written by the module that CLEARS the rule, so a document where that JS never
ran shows every table exactly as it did before the rule existed.

**And a table this rule is still hiding may not be judged.** A `display: none` box has no content
width, so the first pass over a table with no slot to inherit from read `scrollWidth: 0`, found that
0 overflows nothing, concluded "no remedy" — and CACHED that answer. The table then appeared at its
natural width: on Status → Processes at 768px, 777px inside a 712px column, columns cut off by
`.fs-main { overflow-x: clip }` with no scrollbar and nothing to say so. A second pass ~60 ms later
usually corrected it, which is why it reached a user rather than a gate: that pass exists only if
something mutates `#view` again, and a page that renders once and stands still never does. So
`fitTables()` treats a zero measurement as no answer at all — it lifts the gate, asks for one more
frame, and writes nothing to the slot. Measured entering that page at 768: 2 of 8 arrivals on 0.13.1
and 3 of 8 mid-fix left the table past the column; 0 of 12 after, on each of the four stands.

**A config table (`.cbi-section-table`) is not measured and must stay on
`@container fs-content (max-width: 960px)`.** Its rows are full of widgets (`fs-select.js` turns
every `<select>` into a `ui.Dropdown`), and a widget bakes in the width of the layout it was laid
out in — so unfolding it to take a reading **changes what you are measuring**. Measured on a live
router: after such a toggle the firewall zone table claimed it needed **1747 px** where it really
needs **1190 px**, and overflowed its section by **557 px** — an overflow the pure-CSS version
never had. **The act of measuring was the bug.** Do not "finish the job".

The price is the last irreducible duplicate: the same declarations under a class and under an
`@container`, which CSS cannot factor apart. It is pinned with `@mirror table-card/{label,actions}`.

### Which of the three a table gets, and what decides it

Every `<table>` or `<div class="table">` under one of the two content roots — `#view`, and the
`#modal_overlay` that `ui.showModal()` builds its dialog in — lands in exactly one of three tiers, and the
discriminator is **does it have a header row**, never who wrote it:

| Tier | Reached by | What it does |
|---|---|---|
| measured card | a header row **and** not `.cbi-section-table` → `fs-select.js` tags `.table.fs-dt` | folds into labelled cards when it stops fitting, at any width |
| `@container` card | `.cbi-section-table` | folds at 960 px of content, never measured (above) |
| scroll | no header row at all | `display: block; overflow-x: auto` on the table itself |

**Both roots, and that was a bug for as long as it said one.** The dialog is a sibling of `#view` on
`<body>`, so a table in it matched no selector this file describes: it was never tagged, never
captioned, never measured, and — since `fs-fit.js` watched only the one host — never re-measured when
the dialog replaced its rows. Measured at a 390 px viewport with the wireless scan dialog's own
markup: the table rendered **373 px wide inside 317 px** of dialog, the Encryption column got **10 px**
and printed one character per line; carded, it is 317 px with every value on a labelled line. The
roots are listed once in `fs-select.js` (`ROOTS`) and every query is built from them, because three
selectors that each name the same two places are three chances to fix only two.

**A dialog is a root only while it is open.** `hideModal()` drops `modal-overlay-active` off `<body>`
and leaves the markup where it is, and the hidden overlay shrink-fits — measured at **270 px**, i.e.
**236 px** of room for a table that will be shown at the dialog's real width. Measuring that is both
waste (every pass, on a polled page) and a decision about a width nobody will see, so the pass asks
per-pass whether the dialog is open. The flag flips **after** `showModal()` writes the content, so
`fs-fit.js` watches `body`'s class as well as the two subtrees; without it a dialog's table would
wait for its next poll to be fitted.

A header row is any of four markups, and each missing one has cost a page: `.tr.table-titles`
(`L.ui.Table`), `.tr.cbi-section-table-titles` (the apk Software list), a `<thead>` — E()-built, so
its `<th>`s may hang off it directly with no `<tr>` — and a first row made entirely of `<th>`, which
is what a foreign app writing plain HTML emits. `labelCells()` then **copies** the heading of the
column each cell sits in into `data-title`, which is what the card prints above the value; it never
overwrites one the app set, and it counts COLUMNS rather than cells so a `colspan` does not shift
every caption after it by one.

The third tier is the deliberate refusal. A card prints `attr(data-title)` above each value, and a
matrix — a log, a statistics grid, a layout table — has no headings to print, so carding one yields a
column of numbers with nothing saying what they are. Comparison is that shape's whole point, so it
scrolls instead. **The scroll rule is not scoped to a phone.** It spent its life inside
`@media (max-width: 767px)`, which is the same mistake the card stack was built to avoid: whether a
table fits is a property of its content and its column, and a 400 px panel on a 1600 px desktop hits
the wall a phone hits. It costs nothing where the table fits — `overflow` paints a scrollbar only
when there is something to scroll.

### The floor, and why exactly one tier has one

A cell that may break **anywhere** has a min-content of **one character** — that is what the value
means (css-text-3 §5.4: the soft wrap opportunities it introduces *are* counted towards min-content,
which `break-word` does not do). Given that, auto table layout is free to starve a column instead of
the table overflowing, and `fit.overflows()` — the one question the browser answers exactly — goes
blind. That single fact produced four per-page `nowrap` rules and three JS heuristics, each
reconstructing the number the engine had before the theme threw it away.

So the break value follows the tier, and the split is the design:

| Tier | Break value | Why |
|---|---|---|
| measured data table, while it is a table | `break-word` (`theme/30-tables.css`) | it can card, drop columns or shred one column, so it must tell the truth about what it needs |
| carded data table | `anywhere` | every value owns the row; there is no neighbour left to starve |
| config table, key/value include, meter rows, realtime legend | `anywhere` (`base/40-tables.css`) | none of them is measured and none can card on demand — containment is the only outcome available |
| header row, first column | `break-word` (`base/40-tables.css`) | the labels you read the table by (issues #32, #36) |

`tools/table-contract.mjs` (`npm run tables`) holds that table to the sheet, selector by selector: a
fifth place to decide how a cell may break is a hard failure, and so is any of them appearing under a
viewport query.

Two of the four per-page `nowrap` rules the general contract retired were `pages/60-assoclist.css`
and `pages/90-processes.css`, both since deleted — each had shrunk to a comment explaining why its
own rule was gone, styling nothing. The associated-stations table (Overview and Network → Wireless)
dropped its MAC-column `nowrap` once `overflow-wrap: anywhere` stopped splitting
`48:E1:5C:9F:26:20` at whatever character sat on a ~103 px column's edge (issue #5) — a MAC has no
break opportunity, so the honest data-table floor already keeps one whole, for every table that
shows one rather than for this one. Its Signal/Rate columns stayed unwrapped too: nowrapping the
modulation string (`229 Mbit/s, 20 MHz, HE-MCS 9, HE-NSS 2`) makes an unbreakable ~300 px block that
crushes the Network column instead — a wide breakable cell giving way is rung 3 of `fs-select.js`'s
remedy ladder, never the identity column. Processes dropped its PID-column `nowrap` the same way:
with `anywhere` on every cell, `384` rendered as `38/4` and `4810` as `481/0` (23 of 26 rows,
measured at 1228 px against a Russian catalogue — issue #32, and #5 before it); `break-word`
gives a PID, one unbreakable token, the width it needs with no rule of its own.

**One `!important` earns its place here.** `luci-mod-status`'s `processes.js` writes
`style="word-break: break-word"` on its Command span — the deprecated alias for
`overflow-wrap: anywhere`, from an inline declaration no layer can outrank. Measured at a 720 px
viewport: the column sat at **126 px** against a **353 px** token, and forcing that column's
`overflow-wrap` to each of the three values in turn changed nothing, because the floor was being
erased one level down. Neutralised, the same table reports **963 px** of need in **688 px** of room —
the truth the ladder needs.

**And one rule had to go for any of it to work below 767 px.** `theme/90-responsive.css` used to give
`table.fs-dt` `display: block`, which discards the table formatting context: the rows become an
anonymous table sized to the block, so the table can never be wider than its parent and therefore can
never overflow. With it in place no floor was readable at a phone width, at any break value.

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
all — measured, stated, and not derivable from anything.

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

**Screenshots do not work here.** On a live router, uptime, DHCP leases and signal strength give
0.5–1.3% pixel difference between two runs of the same stylesheet, while a real regression
(buttons switched to a monospace font) weighs 0.19%. The noise buries the signal.

The method that does work: load the page once, snapshot `getComputedStyle` over ~50 properties for
every element, swap the `<link>` for the second stylesheet, snapshot again. Same DOM, same data —
so any difference was caused by the CSS.

> `cssdiff.py`, the script the changelog and `audit.py` refer to by name, is the maintainer's own
> tooling and is not in this repository. Without it, drive the four steps above with Playwright
> yourself — the result a review asks for is the property diff, not that particular script.

Two traps in the method itself:

- **Web fonts.** Neither sheet ships one any more, but a machine with Manrope or JetBrains Mono
  installed still resolves them, and any page-supplied `@font-face` restarts font matching when the
  `<link>` is swapped. A snapshot taken before matching settles measures fallback metrics — every
  width on the page shifts by a pixel or two and drowns the real diff (291 false differences on the
  firewall page, back when the faces were bundled). Wait for `document.fonts.ready` before each
  snapshot.
- **`admin/status/overview` polls and redraws itself**, so it shows ~18 differences even with
  identical CSS on both sides. Run a control pass (A = B) to learn each page's noise floor.

Four bugs it caught that a screenshot diff missed: `.cbi-value-field *` painting buttons inside a
field monospace; a `max-width: 100%` filed under a "phone overflow" banner but sitting outside
its media query; table-row buttons described twice so the height came from one block and the
padding from another; and an actions column losing its right alignment.

### The component gallery

`docs/gallery.html` renders every widget `ui.js`/`cbi.js` can emit, with the real class names, so
you do not have to hunt the router for a page that happens to contain the control you changed. It
is not part of the package; it is published to GitHub Pages alongside the built stylesheet, and
the a11y gate runs axe-core against it.

It immediately found two holes that existed on no router page but that any third-party
`luci-app-*` can hit: native `input[type=button|submit|reset]` (which `styles/base` gave only
`width/height: auto`) and the `.label` family.

## There is nothing left to shrink, and that is measured

The idea "132 KB is a lot, let us compress it" comes back periodically. It has been tested with
measurements rather than argument, and the answer is no in every direction. This section exists so
the next attempt starts from these numbers instead of redoing the work.

**There is no dead code: 96% of the bytes actually match.** Rule coverage via CDP
(`CSS.startRuleUsageTracking`) across 15 router pages plus `gallery.html` gave **92%**; a second
pass through the branches the first missed (top layout, dark mode, wallpaper, reduced motion,
Russian locale) took it to **96%**. The remaining ~4.8 KB is four conditional branches that each
have to exist: `@media print`, the latin-ext/cyrillic `@font-face` blocks, an `assoclist` rule
that needs a page with connected clients, and the licence banner.

> Trap in the measurement itself: CDP returns only *used* rules in `ruleUsage`, and an
> `@layer`/`@media` block is reported together with everything nested in it. The first two attempts
> honestly reported "100% coverage" and were lies. Collect the use ranges, merge the overlaps, and
> subtract from a parse of the file. A number obtained any other way needs redoing.

**And it is not a deletion list.** The coverage contract forbids removing a selector because it
was not seen — see [conventions.md](conventions.md). The measurement answers "where is the weight",
not "what can go".

**No structural reserves either.** Selectors are 37% of the file, declarations 58%. Native nesting,
under an honest criterion (adjacent groups only, no reordering that would break the cascade), saves
**4.2 KB / 3.5%** — not worth rewriting the tree for ~3 ms on the wire. Vendor prefixes are 648 B,
data URIs 2.2 KB, all needed. The largest rules (the `:root` token block, the palettes) are
foundation, not fat.

**Compression is unavailable in principle.** gzip would take ~132 KB to ~23 KB, the biggest
possible win — but `uhttpd` has no compression option at all, in neither `-h` nor
`/etc/config/uhttpd`, and it does not serve a pre-compressed `.gz`. A grep of the whole uhttpd
source for `gzip|content-encoding|deflate|zlib|brotli` returns exactly one hit, a MIME type. The
2015 patches were not merged. Not our lever until the web server changes.

**Also tried and rejected, so nobody re-derives them:**

- **`<link rel=preload>` for JS modules is harmful, not merely useless.** LuCI fetches modules by
  plain XHR, whose mode does not match preload's CORS mode, so **every file downloads twice**:
  FCP 336 → 460 ms, 708 → 862 KB on two modules. Retested as `as="fetch" fetchpriority="low"`
  over 22 modules: 49 → **71** requests, +250 KB wasted, wall time unchanged. No form of preload
  deduplicates against the XHR loader.
- **Flattening the `require` graph at the entry point** hits the connection limit, not the depth.
  A flat `L.require` list does collect the four waves into one — and gains almost nothing
  (835 → **804 ms** at 60 ms RTT), because HTTP/1.1 keeps **6 connections per host** and the waves
  simply re-form as batches of six. Worse, `menu-footstrap` finishes at **395 ms instead of 200**,
  queued behind twenty siblings.
- **Warming `uci.load()`** for common configs: 1113 → **1106 ms**, identical XHR count.
- **Service Worker and CacheStorage are unavailable in principle.** A LAN IP over http is not a
  secure context, so `serviceWorker`, `caches` and `navigator.storage` are all `false`. The whole
  precache/offline family is out — not expensive, impossible. (`DecompressionStream` *is*
  available, so "ship `.gz` and inflate in JS" is technically possible: 135 KB → 23 KB. At the
  cost of FOUC on a cold load, a `<noscript>` fallback, and zero gain warm. Not done.)
- **Splitting into a critical and a deferred sheet** trades the wrong way: cold FCP 336 → 276 ms,
  but warm **108 → 180 ms** — and an admin browses with a warm cache.
- **Dropping the font preloads**: −24 ms FCP at the cost of FOUT. Overtaken by 0.12.1, which
  dropped the webfonts themselves — there is no preload and no FOUT left to trade.
- **`content-visibility` for long tables**: empty. Real router tables are short (Startup 46 rows,
  Processes 34) and a full layout pass costs 2–3 ms.

**Where the time actually is.** Re-measured after the webfonts left, on the owlab 25.12.4 stand
with the packaged artefacts (mangled sheet, terser'd JS), overview page, five cold contexts,
medians: **691 KB over 56 requests**, of which ours is **187 KB** (121 774 B stylesheet plus
69 593 B of JS), the LuCI core 485 KB, the document 18 KB and **fonts 0 KB**. The core figure is
this stand's package set, not a floor. FCP is set by the sheet as a whole, but cutting the
sheet by 10% is ~10 ms — to move FCP visibly you would have to halve it, and as shown above there
is nothing to halve. A warm SPA transition costs **9 ms against 96 ms** for a full load: the
theme's main optimisation is already done, and it lives in the router
([spa-router.md](spa-router.md)), not in the stylesheet.
