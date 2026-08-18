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
    base/              @layer base     widget defaults the views count on
      10-reset  20-typography  30-forms  40-tables  50-chrome
      60-modal  70-buttons  90-widgets  95-luci
    theme/             @layer theme    footstrap's own components and layouts
      10-chrome  15-wallpaper  16-login-bg  20-shell  25-progressbar  30-tables
      35-alerts  40-tabs  45-misc  50-toplayout  55-buttons  60-inputs
      65-dropdown  70-modal  75-search  90-responsive  95-a11y-media  97-print
    pages/             @layer page     per-page corrections
      10-login  20-overview  30-software  40-sshkeys  50-leases
      60-assoclist  70-syslog  80-appearance  90-processes
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
a layer. The inversion is what makes that file possible. `audit.py` holds the allowlist
(`BANG_OK`) and `--strict` fails on any flag outside it; `css-metrics` caps the total at **27**.

## The build

`build-css.sh` concatenates the directories and — **without `--dev`** — runs the result through
two awk passes: **467 615 B → 135 655 B** (measured 2026-08-12; the figure moves with the tree, the
ratio does not). That is not cosmetic: uhttpd serves
`/www/luci-static/*.css` with no gzip, so every byte travels as-is. (The package build shortens
the private token names on top of that, landing around 120 KB — see [package.md](package.md).)

With `--dev` it is a plain `cat`: the output is byte-identical to the concatenated sources. A
file to read on a router, not one to ship.

**Pass 1 — comments.** Strips `/* … */` except the `/*! … */` banner, which is Apache-2.0
attribution and is copied verbatim. The stripper is string-aware: a naive search for the
nearest `/*` would eat everything up to the next `*/` on the first `content: "/*"`.

**Pass 2 — whitespace CSS ignores anyway**: the space after `:`, spaces around `{ } ; ,`, the
**last `;` of a block**, and the newline after each declaration, so the output is one rule per
line. All of it inside the same string-aware pass. The last `;` used to be removed by a bolted-on
`| sed 's/;}/}/g'`, and sed does not see strings: `content: ";}"` became `content: "}"`, and a
data URI with the same two bytes broke the same way. No such pair exists in the tree today — and
that is precisely how the bug waits for whoever adds the first one.

What is not touched, each for its own reason:

- **a single space between selectors** — `.a .b` is a descendant, `.a.b` is not;
- **spaces inside `calc()`** — mandatory around `*`, `/` and the minus in `calc(100% - 8px)`;
- **a newline inside a declaration** — also a space. When the scanner once joined lines
  needlessly, a wrapped `calc()` came out as `…))- .004 …`; a minus with no space *before* it is
  a parse error, the declaration fell away, `--fs-tint-c` became undefined, `--fs-bg` invalid at
  computed-value time, and the canvas silently went white (caught by `export-tier` as 1.5:1);
- **anything inside a string** — every data URI here is quoted and full of `:`, `;` and spaces.

Selectors and declarations are never rewritten.

**Two guards against a broken file** (there is no upper size budget — it was removed):

1. **Braces are counted twice** — before and after compression — and the build fails if the
   **rule count changed**. The first count only sees the *input*; compression is the pass that
   can corrupt a sheet, so an unchanged counter is the proof that it did not. Always counted on a
   comment-stripped copy, otherwise a lone `{` in prose would fail a valid `--dev` build.
2. **A floor**, `FS_CSS_FLOOR` = 81 920 bytes. A correctness gate, not a size budget: the script
   refuses to write a suspiciously short file — a truncated write, a full disk, a compression
   that ate the tail — which would ship a sheet missing its second half.

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
| `theme/legacy-names` | `root/etc/uci-defaults/30_luci-theme-footstrap` ↔ `Makefile` |
| `@same-file LICENSE` | the whole file |

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
