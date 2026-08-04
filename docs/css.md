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
      60-assoclist  70-syslog  80-appearance
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
(`BANG_OK`) and `--strict` fails on any flag outside it; `css-metrics` caps the total at **26**.

## The build

`build-css.sh` concatenates the directories and — **without `--dev`** — runs the result through
two awk passes: **~357 KB → 135 734 B** (measured 2026-07-31; the figure moves with the tree, the
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

**A config table (`.cbi-section-table`) is not measured and must stay on
`@container fs-content (max-width: 960px)`.** Its rows are full of widgets (`fs-select.js` turns
every `<select>` into a `ui.Dropdown`), and a widget bakes in the width of the layout it was laid
out in — so unfolding it to take a reading **changes what you are measuring**. Measured on a live
router: after such a toggle the firewall zone table claimed it needed **1747 px** where it really
needs **1190 px**, and overflowed its section by **557 px** — an overflow the pure-CSS version
never had. **The act of measuring was the bug.** Do not "finish the job".

The price is the last irreducible duplicate: the same declarations under a class and under an
`@container`, which CSS cannot factor apart. It is pinned with `@mirror table-card/{label,actions}`.

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
