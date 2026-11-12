# The chrome: sidebar, rail, bar

The spec for what `header.ut` and `fs-chrome.js` draw, for anyone who changes the chrome. The rule
that matters most: the sidebar, the rail and the bar are one markup and one renderer, morphed by
CSS. Never add a second renderer or a second copy of the bar.

Tokens and palettes: [design-system.md](design-system.md). The stylesheet build: [css.md](css.md).
Client navigation: [spa-router.md](spa-router.md).

## Short version

1. Layout is a client axis, `:root[data-layout]` = `sidebar` | `top`, not a theme entry.
2. Every layout rule matches positively. Never write `:not([data-layout="top"])`.
3. The bar is the base, written once and unguarded. The vertical sidebar is the exception, and it
   wins on specificity, never on source order: its `:root[data-sb]` prefix adds `0,2,0` to each bar
   selector (`.fs-sidebar` `0,1,0` -> `0,3,0`; `.fs-sidebar ul.nav > li > a` `0,2,3` -> `0,4,3`).
   A bar rule loses to a vertical-sidebar rule on the same property, wherever it sits in the file.
4. Whether the sidebar becomes a bar is a measurement (`data-narrow`), not a viewport breakpoint.
5. `fs-chrome.js` is the only renderer. The top layout is its flyout mode at desktop width.
6. Dark mode stamps three attributes. The theme's CSS reads only `data-darkmode`.
7. The command palette costs no request and does not call the router.

## Contents

- [Where a rule lives](#where-a-rule-lives)
- [Layout is a CLIENT axis, not a theme entry](#layout-is-a-client-axis-not-a-theme-entry)
- [Target layout](#target-layout)
- [LuCI container mapping](#luci-container-mapping)
- [`data-narrow`: "the sidebar became a bar", and it is a MEASUREMENT](#data-narrow-the-sidebar-became-a-bar-and-it-is-a-measurement)
- [Scroll anchoring: a poll tick must not move the reader](#scroll-anchoring-a-poll-tick-must-not-move-the-reader)
- [The bar: fit steps, scroll model, a rail that must match its guard](#the-bar-fit-steps-scroll-model-a-rail-that-must-match-its-guard)
- [Tab strips](#tab-strips)
- [`header.ut`](#headerut)
- [`fs-chrome.js` — the ONLY renderer](#fs-chromejs--the-only-renderer)
- [Dark mode and outward compatibility](#dark-mode-and-outward-compatibility)
- [The command palette](#the-command-palette)
- [`fs-select.js`](#fs-selectjs)

## Where a rule lives

All paths are under `luci-theme-footstrap/`. The chrome CSS is in `styles/theme/`; a change there
cannot be proven on `docs/gallery.html`, which has no `header.ut` chrome, so check it on a router.

| Chrome area | File and selector |
|---|---|
| the bar: shell, brand row, right cluster, hostname, footer, `.fs-ico` | `styles/theme/20-shell.css`, unguarded |
| menu item box in the bar (padding, font) | `20-shell.css`: `.fs-sidebar ul.nav > li > a` |
| menu item box in the vertical sidebar | `20-shell.css`, inside `@media (min-width: 521px)`: `:root[data-sb] .fs-sidebar ul.nav > li > a` |
| the rail | `20-shell.css`, same media floor: `:root[data-sb][data-rail] …` |
| menu pill padding at the density steps | `styles/theme/10-chrome.css`: `.fs-sidebar ul.nav.fs-dense1 > li > a`, `.fs-dense2` |
| hover and active plate, active ancestor ink | `10-chrome.css` |
| right-cluster classes `.fs-ind-compact`, `.fs-bar-actrow`; menu row `.fs-bar-stack` | `20-shell.css` and `styles/theme/50-toplayout.css` |
| top-layout delta (bar height, padding, menu on the brand's row) | `50-toplayout.css`, under `:root[data-layout="top"]` |
| glass over a wallpaper | `styles/theme/17-glass.css` |
| tab strips | `styles/theme/40-tabs.css`; the label ellipsis in `styles/base/50-chrome.css` |
| command palette | `styles/theme/75-search.css` |
| forced colors, reduced motion | `styles/theme/95-a11y-media.css` |
| measurement (`fitShell`, `fitChrome`, `fitCluster`, `fitTabStrips`) | `htdocs/luci-static/resources/fs-chrome.js` |

### Menu item padding is set in four places

| Chrome state | Rule that sets the padding | File |
|---|---|---|
| bar | `.fs-sidebar ul.nav > li > a` | `theme/20-shell.css` |
| bar, density steps | `.fs-sidebar ul.nav.fs-dense1 > li > a`, `.fs-sidebar ul.nav.fs-dense2 > li > a` | `theme/10-chrome.css` |
| vertical sidebar | `:root[data-sb] .fs-sidebar ul.nav > li > a` | `theme/20-shell.css`, inside `@media (min-width: 521px)` |
| rail | `:root[data-sb][data-rail] .fs-sidebar ul.nav > li > a` | `theme/20-shell.css`, same media floor |

**A "sidebar padding" change edits the vertical-sidebar rule.** The density steps never apply
there: `fitTabStrips()` removes `.fs-dense1`/`.fs-dense2` from a vertical list. A bar padding change
edits the bar rule and must be checked against both density rules too, because `fitTabStrips()`
adds them when the menu row would wrap.

## Layout is a CLIENT axis, not a theme entry

`luci.themes` holds one entry, `Footstrap` → `/luci-static/footstrap`. The sidebar and the top
bar are the same markup and the same renderer. CSS morphs them by `:root[data-layout]`.

### The attribute always carries an explicit value

The server stamps `sidebar` or `top` in `partials/head.ut`. An inline script overrides it from
`localStorage` `fs-layout` before first paint.

**Every layout rule matches positively.** That is why the value is explicit.

- A future third layout must opt into rules. It must not inherit the sidebar's rules by not being
  `top`.
- `:not([data-layout="top"])` would do exactly that, so that guard must not be written.
- The explicit value also keeps the chrome correct with JS disabled.

### Switching layout re-renders nothing

The DOM serves both layouts, and CSS changes the chrome. A `MutationObserver` on `data-layout` in
`fs-chrome.js` folds the accordion into dropdowns and back.

### The router may carry a default

`uci set footstrap.settings.layout=sidebar|top` (or Save to router) names the layout a browser
starts on. `head.ut` whitelists and stamps it, and the reader's own choice overrides it.

A shell script cannot write `localStorage`, which is why the server side of the axis exists. Every
axis works this way: [design-system.md](design-system.md).

### The bar is the base; the vertical sidebar is the exception

The bar serves the top layout at any width *and* the sidebar layout on a phone.
`50-toplayout.css` is a pure delta for the top layout, under `:root[data-layout="top"]` with no
`@media`. It sits on the unguarded bar in `20-shell.css`, which every bar uses.

How the bar and its one override are written: [The bar: fit steps, scroll model, a rail that must
match its guard](#the-bar-fit-steps-scroll-model-a-rail-that-must-match-its-guard).

## Target layout

```
┌──────────────────────────────────────────────────┐
│ .fs-sidebar 224px │ .fs-main (flex:1)            │
│ (rail: 68px)      │ ┌──────────────────────────┐ │
│  [logo] hostname ◂│ │ .fs-content:             │ │
│  #indicators      │ │  warnings                │ │
│  MENU             │ │  #tabmenu                │ │
│  ▸ Status ●       │ │  #view                   │ │
│  ▸ System         │ ├──────────────────────────┤ │
│  ▸ Network        │ │ footer.fs-footer         │ │
│  [spacer]         │ └──────────────────────────┘ │
│  [search]         │                              │
│  ▸ Log out        │                              │
└──────────────────────────────────────────────────┘
```

The widths are quoted at normal density. `--fs-sidebar-w` and `--fs-rail-w` are `calc()` over
`--fs-density-box`, which the Density axis sets, so Compact and Large move them. `fitShell()`
follows with no change of its own, because it reads the computed token rather than a copy.

There is no separate topbar inside `main`.

- The page title is a visually hidden `<h1>` (`.fs-title-main.fs-sr`).
- `#indicators` (the "Refreshing" poll pill, unsaved changes) lives in the sidebar.
- The `◂` button (`#fs-rail-toggle`) collapses the sidebar to a 68 px icon rail with flyouts.

### `.fs-sr` clips, it does not hide

`hidden` is `display:none`, which drops the element out of the accessibility tree. Clipping, as
`.fs-skip` does, keeps it in the tree.

Beside it sits `#fs-nav-status` (`role="status"`, `aria-live="polite"`). The router writes the page
title there after every SPA navigation. Without it, a screen reader never learns that the page
changed without a reload.

## LuCI container mapping

| LuCI container | In bootstrap | In footstrap |
|---|---|---|
| `#topmenu` | horizontal top-level menu | `ul.nav` in `.fs-sidebar`: vertical list / bar / rail flyouts. One markup |
| `#modemenu` | admin/status breadcrumb switch | `.fs-modemenu` in the chrome (sidebar, bar, top layout; hidden in the collapsed rail). Shown only at two or more modes: `theme/20-shell.css` hides it, and `.fs-modemenu:not(:empty):not(.single)` alone shows it |
| `#tabmenu` | tabs under the header | stays in main, above `#view` (emitted by `header.ut`) |
| `#indicators` | header's right corner | `.fs-sidebar #indicators` under the brand; empty → hidden |
| `#view` | content | content (main column) |

The set of top-level sections comes from the menu tree and depends on the installed packages. Do
not hard-code it.

## `data-narrow`: "the sidebar became a bar", and it is a MEASUREMENT

The sidebar gives way to the bar when the content column left beside it is too narrow to read. A
viewport breakpoint cannot say that, because the sidebar is wider expanded than as a rail.

### `fitShell()` reads the widths from the CSS tokens

`fitShell()` (`fs-chrome.js`) subtracts the slice from the root's `clientWidth`. It compares the
remainder with `--fs-content-min`.

It reads the widths from the CSS tokens (`--fs-sidebar-w`, `--fs-rail-w`, `--fs-content-min`)
through `getComputedStyle` rather than keeping copies. With a copy, narrowing the rail in the styles
would leave the measurement subtracting the old number, and nothing would notice.

The result is `data-narrow` on `:root`, read by both the CSS and `flyoutMode()` in the JS.

### `data-sb` is the inverse of `data-narrow`

The same call keeps `data-sb` as the inverse of `data-narrow` while the layout is `sidebar`. The
vertical sidebar's rules guard on `:root[data-sb]`. They do not spell out
`[data-layout="sidebar"]:not([data-narrow])` in every selector.

The server stamps `data-sb` with `data-layout`. The pre-paint and `applyLayout()` set it with the
layout. So the chrome is right before the first fit and with JS off.

### The subtraction itself is `columnWidth()`, and there is exactly one of it

Two callers need the width of the content column:

| Caller | Question |
|---|---|
| `fitShell()` | does the sidebar still fit beside the column? |
| `contentWidth()` | answers `fitTables()` mid-scroll, where reading layout per table is forbidden |

The gutter in `shellGeometry()` already covers BOTH sides. The top-BAR layout has no sidebar to
subtract. It carries no `data-narrow` either: `fitShell()` removes it on the way out.

The gutter is MEASURED off `.fs-content` rather than read from the `--fs-content-pad` token. The
same sheet re-pads that element to 16px a side below 767px while the token stays 28. A media query
has no `data-*` to key on, and its breakpoint may not be copied into the JS.

`contentWidth()` compares `document.documentElement.clientWidth` with the cached `_shellOuter` on
every call. It re-runs `measureShell()` when they differ: `fitChrome()` skips its passes while the
page scrolls, so the cache can hold the previous viewport's width.

### The one literal is the 521px floor

The one literal is `@media (min-width: 521px)` around the vertical override in `20-shell.css`. It
is the floor below which no slice leaves a readable 500 px.

It is also the safety net with JS disabled. No JS means no `data-narrow` and a `data-sb` that stays
as stamped, and a phone would otherwise draw the desktop sidebar.

### The top bar measures too

`fitChrome()` is one fit pass (`fit.add(fitChrome)`), deferred while the reader scrolls. It calls
`fitShell()` and then `fitCluster()`; this is the whole sequence:

1. `fitShell()` sets `data-narrow` and `data-sb`.
2. It pins the bar's `min-height` and `height` at its current height for the whole pass.
3. It removes `.fs-bar-stack`, `.fs-ind-compact` and `.fs-bar-actrow`, then runs `fitTabStrips()`.
   That squeezes the menu pills (`.fs-dense1`, then `.fs-dense2`).
4. Top layout only: if the menu still wraps, it adds `.fs-ind-compact` and runs `fitTabStrips()`
   again.
5. Top layout only: if the menu still wraps, it adds `.fs-bar-stack`, which moves the menu to a
   second row, and runs `fitTabStrips()` again.
6. Whenever the chrome is a bar (top layout, or a `data-narrow` sidebar), `fitCluster()` runs. If
   `clusterFitsBrandRow()` says the right cluster does not fit the brand's row, it adds
   `.fs-ind-compact`. If it still does not fit, it adds `.fs-bar-actrow`, which moves the cluster to
   its own row.
7. It clears the pin and publishes the bar's real height as `--fs-bar-live`.

All four functions are in `htdocs/luci-static/resources/fs-chrome.js`.

`.fs-ind-compact` has two triggers in one pass. Step 3 clears it. Step 4 sets it when the menu wraps
(top layout only). Step 6 sets it when the cluster does not fit. If step 4 already set it, adding
it again changes nothing, so a cluster that does not fit gets `.fs-bar-actrow`.

What each step measures:

| Step | Measured | Against |
|---|---|---|
| menu wraps (`stripFitsOneRow()`) | the `offsetTop` of the first and last visible menu item | each other: one row when they are equal |
| cluster fits (`clusterFitsBrandRow()`) | the sum of `offsetWidth` plus `column-gap` of every visible child of `.fs-sidebar` except `#topmenu`. The brand row with the hostname counts, at its laid-out width, so a hostname that has shrunk counts shrunk. A `display: none` child is skipped | the bar's `clientWidth` minus its left and right padding |

Whether the menu fits depends on the number of sections on that router, not on the screen.

The pin keeps the page laid out under the bar from moving while the classes are off.

## Scroll anchoring: a poll tick must not move the reader

### The fit engine keeps the reader in place when a poll tick grows the page above them

While a tick refills a container, `holdFloor()` holds it at its last height. A layout taken
mid-refill then cannot clamp the offset into a shorter document.

| Browser | Who moves the offset |
|---|---|
| anchors scrolling itself (`CSS.supports('overflow-anchor', 'auto')`: Chrome 56+, Firefox 66+, Safari and iOS 27+) | the browser. The observer takes no reference |
| Safari and iOS before 27 | the observer. It takes a reference element at the top of the view before the mutation, and writes the reference's drift back on the next frame (`anchorFor()`, `scheduleAnchor()`, `applyAnchor()`) |

The `scroll` listener reads nothing inside the event, only on the next frame.

- A layout forced while WebKit dispatches `scroll` makes its anchoring controller skip that
  adjustment.
- The controller then anchors nothing for the rest of the document's life.
- At that moment a sticky or fixed box (`.th`, `#modal_overlay`, the bar) also leaves layout dirty.

`tools/anchor-check.mjs` checks both paths in Chromium, Firefox and WebKit against bootstrap.
`tools/e2e.mjs` runs it locally, and CI runs it as the `anchor` job ([verifying.md](verifying.md)).

## The bar: fit steps, scroll model, a rail that must match its guard

### The bar is written once, unguarded: never under a viewport OR an attribute selector

The bar lives in `styles/theme/20-shell.css`. CSS cannot OR a media query with
`:root[data-layout="top"]` in one selector, so writing the bar under both guards means writing it
twice.

With the bar unguarded, each of the three chrome states (bar, vertical sidebar, vertical rail) is
stated exactly once. The vertical sidebar wins on specificity, never on source order. Its
`:root[data-sb]` prefix adds `0,2,0` to each bar selector:

| Element | Bar | Vertical sidebar |
|---|---|---|
| the chrome box | `.fs-sidebar`: `0,1,0` | `:root[data-sb] .fs-sidebar`: `0,3,0` |
| a menu item | `.fs-sidebar ul.nav > li > a`: `0,2,3` | `:root[data-sb] .fs-sidebar ul.nav > li > a`: `0,4,3` |

### `.fs-shell`'s floor height is `svh`, never `dvh`

`dvh` follows the browser UI as it slides, so on iOS the shell would re-lay-out on every frame of a
scroll.

A height that must not move under the reader uses `svh`. `dvh` is for something meant to grow as the
UI retracts.

### Right cluster: two fit steps, both measured by `fitCluster()` (fs-chrome.js), neither gated on layout

The top layout is a bar at every width. The sidebar layout becomes one on a phone, so a
`data-layout="top"` guard would miss it.

1. Step 1 (`.fs-ind-compact`) drops the indicator pills' prose for icon squares.
2. Step 2 (`.fs-bar-actrow`) moves the whole cluster to its own row when that is not enough.

`fitCluster()` runs at the end of each `fitChrome()` pass whenever the chrome is a bar. The full
sequence and what is measured against what: [The top bar measures too](#the-top-bar-measures-too).

### Hostname handling is two rules for two different failures

| Rule | Failure it prevents |
|---|---|
| `overflow-wrap: anywhere` | a long, dot-free hostname pushing the menu out of the bar. It lets the hostname shrink. An ellipsis would truncate the one string that identifies the router |
| `-webkit-line-clamp: 3` | unbounded height. A hostname is at most 63 characters |

### A static sidebar, never `position: sticky`

The desktop sidebar layout pins `.fs-shell` to the viewport and scrolls `.fs-main`.

A sticky sidebar is a composited layer that left a 1px seam of the rail's flyout on hover. `static`
makes no stacking context, so flyouts stack in the root one.

### `contain: paint` on `.fs-main` is the fix for issue #12, a Firefox-only leak

Firefox propagates an out-of-flow descendant's overflow past both overflow ancestors. It grows
`html.scrollHeight` and drags the sidebar off-screen.

Paint containment clips it at `.fs-main`. LuCI's modals sit on `<body>`, outside it.

### The rail's guard must be the vertical sidebar's, exactly

The rail uses the same media floor and the same `[data-sb]`.

Why: the rail is a mode of the vertical sidebar and is never visible where the vertical sidebar is
not. A different floor would draw the full sidebar while the JS subtracts the rail's width.

### A flyout's heading reuses the bar's hover-bridge pseudo-element, and resets every geometry property doing it

`li.has-sub > ul::before` is the bar's 10px hover bridge. In the rail it carries the flyout's title,
so `position`, `inset` and `height` are reset there.

The rail's own bridge is `li.has-sub::after`.

### A collapsed-rail indicator badges its count instead of wrapping its prose

`fs-chrome.js` lifts the count into `data-fs-badge`, and the CSS shows the badge alone with
`font-size: 0`. The prose stays in the DOM for screen readers and in `title`.

### A bar dropdown anchors to its own `<li>`, not to the bar

A panel anchored to the bar's edge leaves a gap to its trigger. Hover then closes before the pointer
arrives.

### A footer link pair needs 26px between their centres, not the type scale's own leading

The 26px follows WCAG 2.2 SC 2.5.8. Where the footer sentence wraps, its two links land on
consecutive lines.

`line-height: max(26px, calc(var(--fs-type) * 2))` follows the Density axis and never drops under
26px, including at Compact.

## Tab strips

### One component, three LuCI selectors deduplicated in `theme/40-tabs.css`

| Selector | Tabs | Active marker |
|---|---|---|
| `#tabmenu ul.tabs` | page tabs | `.active` |
| `.tabs` | view tabs | `.active` |
| `.cbi-tabmenu` | CBI form tabs, including the mode switcher `ul.cbi-tabmenu.mode` | `.cbi-tab` |

They share every rule except the active marker. The mode switcher adds one rule of its own,
`max-width: none`.

### `.cbi-tabmenu > li` alone gets `max-width: 100%`, not `none`

A long translated CBI tab label otherwise overflows a phone column.

The `a`'s ellipsis (`base/50-chrome.css`) engages only because the `li`'s `max-width` stops its
automatic minimum size at the label's content width.

### Keyboard focus on a tab pill uses one ring for both states, `--fs-focus-ring-solo`

`base/50-chrome.css`'s ordinary `outline: 2px solid var(--fs-accent)` is invisible on the active
pill, whose background is the same accent.

The ring is a `box-shadow`, because the strip clips overflow and a shadow is not clipped by the
scroll container.

### Density steps (`fs-dense1` → `fs-dense2`) come from `fitTabStrips()` (`fs-chrome.js`)

It measures whether the strip wraps to a second row. The steps are mutually exclusive, so a pill is
never trimmed by both classes at once.

For tabs both steps give the same padding, so `fs-dense2` changes nothing past `fs-dense1`.

## `header.ut`

### Markup

- Shared parts live in `partials/` (`head`, `notice`). The brand, search, log-out and icon markup is
  inline in `header.ut`. There is no second template directory.
- `<body>` → a `.fs-shell` flex wrapper. Before it sits the skip link `.fs-skip`
  ("Skip to content" → `#maincontent`), the first tab stop on the page.
- Sidebar: `<nav class="fs-sidebar" aria-label="Menu">`, deliberately `<nav>`. `<aside>` gives the
  `complementary` role, and no landmark jump reaches the menu through it. It holds, in order:
  1. `.fs-brandrow`: brand (gradient square + wifi SVG on `currentColor` + hostname wordmark) and
     the `#fs-rail-toggle` button;
  2. `<div id="indicators">`;
  3. `.fs-navlabel` + `<ul class="nav" id="topmenu">` (filled by the menu JS) + `<ul id="modemenu">`;
  4. `.fs-spacer` (`flex:1`);
  5. the search button (`#fs-search-btn`, the command palette below) and Log out.
- The appearance axes are their own menu entry (`/admin/system/footstrap`): see
  [design-system.md](design-system.md).
- Main: `<main class="fs-main" id="maincontent" tabindex="-1">`. It holds the
  `.fs-title-main.fs-sr` `<h1>`, `#fs-nav-status`, and `.fs-content` (warnings, `#tabmenu`, `#view`,
  footer).

### Icons: a bare `<svg>` styled by one rule

A chrome icon is a bare `<svg class="fs-ico" aria-hidden="true" viewBox="0 0 24 24">`. Its fill,
stroke, 1.9 width and round caps come from the one `.fs-ico, .fs-chevron` rule in
`theme/20-shell.css`.

Why: five attributes per element cost 100 B each, 300 B of every admin page.

`header.ut` writes its three inline, and `svgIcon()` (`fs-chrome.js`) emits the same markup for the
menu and the search palette. A class outside the rule draws a filled black glyph.

### What must be preserved

`http.prepare_content`, `cbi.js`, the translations script, `node.css`, `css`, `blank_page`,
`noscript`, and the no-root-password / initramfs warnings.

### `footer.ut`

`footer.ut` emits `<footer class="fs-footer" role="contentinfo">`.

The role is explicit because `<footer>` gets `contentinfo` implicitly only when its nearest ancestor
is `<body>`, and this one sits inside `<main>`.

It hard-loads `L.require('menu-footstrap')` and then `L.require('fs-select')`.

## `fs-chrome.js` — the ONLY renderer

**A second layout is not a second renderer.** The sidebar markup is what its CSS turns into a
horizontal bar on a phone. Its flyout mode makes a section behave exactly like a top-menu dropdown.
The top layout is that mode at desktop width.

### `renderMainMenu` fills `#topmenu`

An item is `<li><a><icon><span class="fs-label">title</span><chevron></a></li>`, active by
`L.env.dispatchpath`.

Icons are mapped by section name with a regex fallback and a generic SVG. They are inlined as
strings in the JS, because `E()` cannot build SVG: see [conventions.md](conventions.md).

### Where the renderer lives

- `renderMainMenu` sits in `fs-chrome.js` beside `renderModeMenu` and `renderTabMenu`.
- The same file holds the rail (`wireRail()`) and chrome measurement (`fitShell()`, `fitChrome()`).
- `menu-footstrap.js` calls `chrome.wireMenu()` and `chrome.start()`, so the renderer is no
  injected parameter.
- The SPA router lives in `fs-router.js`.

### The top-level `admin/logout` node is dropped from the tree

The chrome draws its own Log out (`header.ut`), which would otherwise appear twice.

### A section with children is a W3C APG disclosure pattern, not a link

It takes `role="button"`, `aria-expanded`, `aria-controls`, and Enter/Space. Escape closes the
flyout and returns focus.

It is deliberately not `role="menu"`: APG says site navigation should not take menubar semantics.

`aria-current="page"` goes on the leaf only. A section header is a button, not a link to the current
page.

### The active PLATE (fill) follows the page; an open ANCESTOR keeps only the accent INK

`li.active` is set on both the current leaf and the section containing it. A shared rule handing
both the same fill would draw two identical plates stacked on System → System.

`theme/10-chrome.css` matches the plate on `a.active` and the ink on `li.active > a:not(.active)`.
So an ancestor that is not itself the page never gets the fill.

### `.open` has two meanings

| Where | Meaning |
|---|---|
| the expanded sidebar | an accordion: several sections open at once, the set remembered in `localStorage` `fs-menu-open` |
| the rail, the bar, or a narrow screen | an exclusive flyout |

`flyoutMode()` decides, and it reads exactly what the stylesheet reads: `data-rail` /
`data-layout=top` / `data-narrow`.

Leaving flyout mode restores the accordion (`restoreAccordion()`), not a plain `closeFlyouts()`. The
markup is not rebuilt on a rail toggle, so stripping `.open` from everything would lose the
remembered set.

### `clampDropdown` keeps a bar dropdown in the viewport

`clampDropdown` pushes a dropdown back into the viewport at its inline-end edge: right in LTR, left
in RTL, through `inset-inline-start`.

It runs whenever the chrome is a BAR (`barDropdown()`: the top layout at any width, or a
`data-narrow` sidebar), because then a panel hangs off its own `<li>`. The rail is excluded: there a
flyout is anchored sideways.

It keeps one scheduled `rAF` per `<li>`, so it can cancel an unfinished measurement when the pointer
has moved on. The shared `fit.frame()` coalescer cannot express that; this is a documented
exception.

### Smaller rules

- Hover opening is pure CSS.
- The width probe declares its properties `!important`. An app carrying
  `div { min-width: 500px !important }` would otherwise win every read and fold the sidebar into a
  bar on a wide desktop.
- The width probe states `box-sizing` for the same reason, as `getComputedStyle().width` is the
  content box.
- The indicator observer shares `stamp()`'s callback. `fs-ind-compact` then lands in the microtask
  before paint, instead of a second indicator pushing the page down for a frame.

## Dark mode and outward compatibility

Mode, palette and layout are all client settings. The pre-paint blocks in `partials/head.ut` stamp
`:root` before the first frame, one block per axis.

Dark mode: a stored value beats the OS, otherwise `prefers-color-scheme`. The `change` subscription
is registered always and re-reads storage. So Auto keeps following the system if the user switches
to it after load.

### `set()` (inline in `partials/head.ut`) and `stampDark()` (`fs-prefs.js`) stamp THREE attributes

| Attribute | Who reads it |
|---|---|
| `data-darkmode` | this theme's CSS |
| `data-theme` | outbound compatibility for third-party apps that sniff it: `luci-app-justclash` hangs 21 rules on it |
| `data-bs-theme` | outbound compatibility: `ssclash` checks it first |

**Nothing inside `styles/` may read the latter two.**

`<meta name="darkreader-lock">` stops the Dark Reader extension repainting the theme into mush.

More on how foreign apps detect dark mode: [third-party-apps.md](third-party-apps.md).

## The command palette

`fs-search.js` finds a page by name instead of by remembering which section owns it.

A loaded router carries ~200 reachable menu nodes across 11 sections. Some pages appear in no menu
list at all until you are already there: "Port Forwards" is a tab of Network → Firewall.

### It costs no request

The index is built from the same ACL-filtered `/admin/menu` blob the chrome already loaded
(`fs-menutree`). The palette therefore knows exactly the pages this session may open: nothing to
leak, nothing to 403 on.

The index is built on the first open, not at init. A user who never searches pays nothing, and only
a full load can change the tree.

### It indexes tabs

It indexes to `admin/<section>/<page>/<tab>`: four levels, every path the dispatcher renders.

### It does not call the router

Every result is a real `<a href>`, so a click bubbles to the router's own document-level handler.
The click takes the SPA path, or falls back to a full load when the node is not SPA-able. There is
no second copy of that decision. Enter synthesises the same click.

### Recently visited rows are kept in `localStorage` `fs-recent`, one menu path each

Only the path is stored. The title is resolved through the index on every render, so it follows the
UI language. A page an ACL change hides is dropped instead of shown dead.

| Part | Owner |
|---|---|
| the writer (`remember()`) | `menu-footstrap` |
| prefetching each path (`warmRecent()`) | `menu-footstrap` |
| the key, the cap of 8 and the reader (`recentPaths()`) | `fs-prefs`, once |
| binding the button, Ctrl/Cmd+K and `/`, calling `fs-search`'s `open`/`toggle` | `menu-footstrap` alone: see [spa-router.md](spa-router.md) |

### Do not index through `ui.menu.getChildren()`

On an alias node it returns the alias target's children. Network → Firewall's tabs would then be
missing from the index.

## `fs-select.js`

`fs-select.js` turns every stock `<select>` into a styled `ui.Dropdown`, because a native `<select>`
popup cannot be styled with CSS.

The native `<select>` remains the form field and must stay `frameEl.firstChild`, because
`ui.Select.getValue()` returns `this.node.firstChild.value`.

It also owns `fitTables()`, which folds data tables into cards. Why config tables are handled
differently, and why that difference is not an unfinished job: [css.md](css.md).

Invariants:

- `#modal_overlay` is a root as well as `#view`, so a dialog's table fits its dialog.
- A table with no LuCI class is tagged too, because a third-party app may emit one.
- The fit answer is keyed on the section frame (table id, or position), so the poll's table
  replacement every tick causes no new measuring pass.
- A zero measurement is never cached.
- The theme claims `stabilizeActionColumnWidth`'s resize hook, which would otherwise add a listener
  per table on every SPA navigation.
