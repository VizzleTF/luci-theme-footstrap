# The stylesheet: source tree, layers, build

For anyone who edits `styles/` or `build-css.sh`. `cascade.css` is generated from `styles/` and is
not in git. The rule that matters most: a later cascade layer beats an earlier one, so put a rule in
the right layer instead of raising its specificity.

Token names and values: [design-system.md](design-system.md). The rules a patch must follow:
[conventions.md](conventions.md). Before you open a PR, prove the change:
[prove-css-change.md](prove-css-change.md).

## Short version

1. `build-css.sh` concatenates `styles/` into `cascade.css`, one `@layer` wrapper per directory.
2. The layers are `tokens, base, theme, page`. A later layer wins regardless of specificity.
3. `!important` inverts layer order. A flag may only fight an inline `style=` or an unlayered app
   sheet; `theme/95-a11y-media.css` is the one exception.
4. The browser floor is Chrome 120, Firefox 121, Safari 17.2. Below it the page is broken, and no
   feature gets a fallback.
5. A data table (a header row, not `.cbi-section-table`) is measured and folds into cards. A
   config table folds by `@container`. A table with no header scrolls.
6. Rules CSS cannot merge are listed in one table. Edit both copies together.
7. Prove a CSS change by diffing computed styles over `docs/gallery.html`, never by screenshots.
   The gallery has no `header.ut` chrome, so check a sidebar, bar, rail or menu change on a router.

## Contents

- [One directory per cascade layer](#one-directory-per-cascade-layer)
- [Layers](#layers)
- [The browser floor](#the-browser-floor)
- [The build](#the-build)
- [Duplicates CSS cannot merge](#duplicates-css-cannot-merge)
- [`:where(#view)`, not bare `#view`](#whereview-not-bare-view)
- [Per-page, base and theme fixes live in css-fixes.md](#per-page-base-and-theme-fixes-live-in-css-fixesmd)
- [Proving a change lives in prove-css-change.md](#proving-a-change-lives-in-prove-css-changemd)
- [The component gallery](#the-component-gallery)

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
      10-chrome  15-wallpaper  16-login-bg  17-glass  20-shell  25-progressbar  30-tables
      35-alerts  40-tabs  45-misc  50-toplayout  55-buttons  60-inputs
      65-dropdown  70-modal  75-search  90-responsive  95-a11y-media  97-print
    pages/             @layer page     per-page corrections
      10-login  20-overview  30-software  40-sshkeys  50-leases  70-syslog
      80-appearance
```

Concatenation order is `styles/`, `base/`, `theme/`, `pages/`. Inside a directory the numeric
prefix is the order.

`03-palettes.css` holds only token definitions. A palette rule that styles an element would lose to
`theme` from inside `tokens`. So a rule such as
`:root[data-wallpaper="pattern"] .fs-main { background-color: … }` lives in
`theme/15-wallpaper.css`.

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
name met earlier becomes the first, weakest layer.

If a foreign sheet carrying `@layer theme` lands ahead of ours, the order becomes
`theme, tokens, base, page`. Then `base`, where `* { padding: 0 }` lives, beats the whole chrome.

Ace inserts its `<style>` as the first child of `<head>`, lazily, some of it on first hover. Ace is
pulled in by `luci-app-ssclash` and any package with an editor.

`fs-sheets.js` answers each `<head>` mutation with a new `<style>` holding
`@layer tokens, base, theme, page;`, inserted as the first child.

- It must be a new sheet. Inserting a sheet recomputes the order; moving one does not.
- A static declaration in the template cannot help. A foreign sheet can still land in front of it.

### `!important` inverts layer order

Important declarations run in reverse: important in `base` beats important in `theme`, which
beats important in `page`.

**A flag is allowed only to fight an inline `style=` or an unlayered `<style>` an app injected.**
`package-manager.js` emits such a `<style>`. A rule that needs a flag to beat another footstrap
rule is in the wrong layer. Each flag carries a comment naming what it fights.

The exception is `theme/95-a11y-media.css`:

- `prefers-reduced-motion` must stop animations declared in `base` as well as `theme`. Only an
  important declaration reaches back a layer.
- The forced-colors focus outline there is flagged for the same reason: themed rules set
  `outline: none` in several layers.

## The browser floor

**Chrome 120, Firefox 121, Safari 17.2.** Below that the page is broken, not plainer.

Relaxed CSS nesting sets the floor. `tools/nest-css.mjs` folds rules that share a selector prefix
into nested rules: 11.3 KB of the shipped sheet (measured 2026-10-31). The same step made
unprefixed masking and `:has()` floor features.

These sit at or under the floor: `color-mix()` (111 / 113 / 16.2), `@layer`, `:is()`/`:where()`,
`:focus-visible`, `svh`/`dvh`, `accent-color`, `@container`, `overflow: clip` and the logical
properties. None of them gets a fallback: a theme whose layers are ignored is not a theme.

Write an asymmetric inline offset as `*-block` plus `*-inline`
(`margin-block: 0; margin-inline: var(--x) 0`). Never write it as a physical shorthand followed by
one `*-inline-start` longhand. A corner shared with an inline-start edge is
`border-start-start-radius`.

These features sit above the floor. Below their version the rule does not apply and the page is
plainer:

| Feature | Chrome / Firefox / Safari | What is lost below it |
|---|---|---|
| relative `oklch(from …)` | 122 / 128 / 18 | the tint and the accent/status hue axes. The rules sit under an `@supports` probe of the exact syntax. The ink on a hex accent does not depend on it: `inkFor()` in `fs-axes.js` and the `head.ut` pre-paint compute it in JS |
| unprefixed `backdrop-filter` | 76 / 103 / 18 | the glass blur: cards and the bar stay translucent, the wallpaper shows through unblurred |
| `text-wrap: pretty`, `scrollbar-width` | n/a | typographic polish |

A CSS feature the sheet has not used before goes on one side of this line. Either it moves the
floor, or it joins the table.

Check values too, not only properties: `overflow` is ancient, `overflow: clip` is Safari 16.

The JS floor is lower. The SPA router uses nothing younger than `ResizeObserver`, and
`requestIdleCallback` is the only feature-detected API.

### Vendor prefixes still in the sheet

A prefix stays only while the unprefixed form is missing at the floor in some engine. Check MDN's
browser-compat-data before adding or removing one.

| Prefix | Status |
|---|---|
| `-webkit-mask*` | went with the Chrome 120 floor, which masks unprefixed |
| `-webkit-backdrop-filter` | cut on purpose. Safari 17.2–17.x is about 2% of iOS in 2026, so its glass goes without blur (the table above) rather than cost every page load the prefix |

lightningcss runs with `VendorPrefixes` excluded, so the source alone decides which prefixes ship.

## The build

`build-css.sh` concatenates the directories. Without `--dev`, one awk pass then strips comments
and whitespace. uhttpd serves `/www/luci-static/*.css` with no gzip, so every byte travels.

The package build (`tools/stage.sh`) then runs lightningcss over the squeezed sheet
(`tools/minify-css.mjs`, targets = the browser floor). It also shortens the private token names;
see [package.md](package.md). lightningcss refuses the build on any rule it cannot read, rather
than ship its rewrite without that rule.

Each file opens with the `@layer` wrapper its directory means. The build strips that wrapper, from
the first line to the `}` where brace depth returns to 0. It then emits one wrapper per directory.
The depth count skips comments and quoted strings, so a `{` in prose or in `content: "{"` does not
move the close.

`--dev` merges the wrappers the same way and skips the squeeze pass. Comments and formatting stay,
for reading on a router.

### The squeeze pass is string-aware

- Comments: it strips `/* … */` and keeps the `/*! … */` banner (Apache-2.0 attribution), trimmed
  line by line.
- Whitespace: it drops the space after `:`, spaces around `{ } ; ,`, the last `;` of a block, and
  the newline after each declaration. The output is one rule per line.
- The last `;` goes inside the pass, not in a later `sed 's/;}/}/g'`. sed does not see strings and
  would break `content: ";}"`.

The whitespace pass never touches:

- a single space between selectors: `.a .b` is a descendant, `.a.b` is not;
- the spaces around `+` and `-` inside `calc()`: `calc(100% - 8px)` without them is a parse error;
- a newline inside a declaration, which counts as a space. Joined, a wrapped `calc()` becomes
  `…))- .004 …` and the declaration drops. The token chain built on it (`--fs-tint-c` → `--fs-bg`)
  then loses the canvas colour;
- anything inside a string. Every data URI here is quoted.

### Six rewrites spell the same thing shorter

None of them applies inside a string or a comment.

| Rewrite | Limits |
|---|---|
| `[attr="ident"]` → `[attr=ident]` | The value must be a whole ident on one line (`-?[A-Za-z_][-A-Za-z0-9_]*`) with no `\` and no `--`: `mangle-tokens.sh` reads an unquoted `--fs-` as a name to rename. A value that starts with a digit, holds `%`, `/`, `:`, `.` or `#`, or is empty stays quoted |
| the space before `!`: `red !important` → `red!important` | none |
| `::before` / `::after` → `:before` / `:after` | Engines serialise both as `::`. `::before-x` is left alone |
| the spaces beside `*` and `/` in a declaration: `calc(1px * 2)` → `calc(1px*2)`, `16 / 9` → `16/9` | Only inside a block that holds declarations (a style rule, `@font-face`, a keyframe step). Selectors and `@media`/`@supports`/`@container` conditions keep theirs. A space stays where the join would spell `/*` or `*/` |
| a `flex` triple with a keyword form: `0 0 auto` → `none`, `1 1 auto` → `auto`, `0 1 auto` → `0 auto`, `1 1 <length or %>` → `<length or %>` | A bare `0`, a `var()` or `calc()` basis, and a custom property named `--flex` are left alone |
| `transparent` → `#0000`, the same computed `rgba(0, 0, 0, 0)` (4-digit hex: Chrome 62, Safari 10) | A whole word in a declaration only: an ident that contains it and an `@supports` condition keep the keyword. A custom property then holds `#0000` as its text, which no script reads |

The first three rewrites cannot tell a selector from a declaration. Do not put `[x="y"]` or ` !`
inside a custom-property value. Script reading it back with `getPropertyValue` would get the
rewritten text.

### The build exits 1 on any of these

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
and writes into the build tree.

It needs only `cat` and `awk`, so the OpenWrt buildbot builds it with no host dependency.

### Why no preprocessor

The buildbot has no `node`, `sass` or `postcss`. `cat` plus `awk` is enough, so the build travels
with the package.

## Duplicates CSS cannot merge

Some rules carry identical declarations under guards CSS cannot OR together: a class against an
`@container`, or two guards where one needs `:has()`.

**Edit both copies together.** Each duplicate is a decision: merge it, or list it here. Each copy's
comment names the other.

| First copy | Second copy |
|---|---|
| `theme/30-tables.css`: `.table.fs-stacked .td[data-title]::before`, `.td.cbi-section-actions`, its `> :not(.cbi-dropdown)` and `> .cbi-dropdown` | `theme/65-dropdown.css`, inside `@container fs-content`: the same four under `.table.cbi-section-table` |
| `theme/30-tables.css`: `.table.fs-stacked .tr` | same file: `.table.fs-stacked tfoot:not(:has(> .tr))` |
| `theme/20-shell.css`: `.fs-sidebar.fs-ind-compact #indicators` poll glyph and badge | same file: the `[data-rail]` poll glyph and badge |
| `theme/25-progressbar.css`: `.cbi-value-field > .cbi-progressbar::after` | same file: `.cbi-section .table:has(.tr.table-titles) .td .cbi-progressbar::after` |
| `theme/60-inputs.css`: `.cbi-value-field select option:checked` | `theme/65-dropdown.css`: `.cbi-dropdown[open] > ul.dropdown > li[selected]` |
| `theme/70-modal.css`: `#modal_overlay .modal label.btn` | `theme/90-responsive.css`: the `@container fs-view (max-width: 360px)` button rule |

## `:where(#view)`, not bare `#view`

A page-scoped selector in `styles/pages/` anchors on `:where(#view)[data-page="…"]`, not
`#view[data-page="…"]`.

Why: an id adds `(1,0,0)` to a chain that is already long. `:where()` matches the same element at
zero specificity.

Do not widen it to `:where(#view, .fs-content)`. `.fs-content` is `#view`'s ancestor, so a `> div`
arm would match `#view` itself instead of `#view`'s children.

## Per-page, base and theme fixes live in css-fixes.md

Every correction the sheet makes to LuCI's markup, page by page and widget by widget, with its
reason: [css-fixes.md](css-fixes.md). That page also holds the card contract for tables.

## Proving a change lives in prove-css-change.md

Diff computed styles over the gallery, then on a router for the chrome and page-scoped rules:
[prove-css-change.md](prove-css-change.md).

## The component gallery

`docs/gallery.html` renders every widget `ui.js`/`cbi.js` can emit, with the real class names. It
is not in the package; it is published to GitHub Pages with the built stylesheet.
