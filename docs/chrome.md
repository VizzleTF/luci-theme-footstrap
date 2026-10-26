# The chrome: sidebar, rail, bar

The spec for what `header.ut` and `fs-chrome.js` draw. Tokens and palettes:
[design-system.md](design-system.md). The stylesheet build: [css.md](css.md). Client navigation:
[spa-router.md](spa-router.md).

## Layout is a CLIENT axis, not a theme entry

`luci.themes` holds one entry, `Footstrap` → `/luci-static/footstrap`. The sidebar and the top
bar are the same markup and the same renderer; CSS morphs them by `:root[data-layout]`.

- The attribute always carries an explicit value (`sidebar` | `top`), stamped by the server in
  `partials/head.ut`. An inline script overrides it from `localStorage` `fs-layout` before first
  paint. The explicit value matters because every layout rule matches **positively**. A future
  third layout must opt into rules. It must not inherit the sidebar's rules by not being `top`:
  `:not([data-layout="top"])` would do exactly that, so that guard must not be written. The
  explicit value also keeps the chrome correct with JS disabled.
- Switching layout re-renders nothing: the DOM serves both, CSS changes the chrome, and a
  `MutationObserver` on `data-layout` in `fs-chrome.js` folds the accordion into dropdowns
  and back.
- The router may carry a default. `uci set footstrap.settings.layout=sidebar|top` (or Save to
  router) names the layout a browser starts on. `head.ut` whitelists and stamps it, and the
  reader's own choice overrides it. A shell script cannot write `localStorage`, which is why the
  server side of the axis exists. Every axis works this way: [design-system.md](design-system.md).

**The bar is the base; the vertical sidebar is the exception.** The bar serves the top layout at
any width *and* the sidebar layout on a phone. `50-toplayout.css` is a pure desktop-bar delta. How
the bar and its one override are written: [The bar: fit steps, scroll model, a rail that must match
its guard](#the-bar-fit-steps-scroll-model-a-rail-that-must-match-its-guard).

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

There is no separate topbar inside `main`: the page title is a visually hidden `<h1>`
(`.fs-title-main.fs-sr`), and `#indicators` (the "Refreshing" poll pill, unsaved changes)
lives in the sidebar. The `◂` button (`#fs-rail-toggle`) collapses the sidebar to a 68 px icon rail
with flyouts.

**`.fs-sr` clips, it does not hide.** `hidden` is `display:none`, which drops the element out of
the accessibility tree. Clipping (as `.fs-skip` does) keeps it in the tree.
Beside it sits `#fs-nav-status` (`role="status"`, `aria-live="polite"`), where the router writes
the page title after every SPA navigation. Without it, a screen reader never learns that the page
changed without a reload.

## LuCI container mapping

| LuCI container | In bootstrap | In footstrap |
|---|---|---|
| `#topmenu` | horizontal top-level menu | `ul.nav` in `.fs-sidebar`: vertical list / bar / rail flyouts — **one markup** |
| `#modemenu` | admin/status breadcrumb switch | `.fs-modemenu` in the chrome (sidebar, bar, top layout; hidden in the collapsed rail); shown only at two or more modes: `theme/20-shell.css` hides it, and `.fs-modemenu:not(:empty):not(.single)` alone shows it |
| `#tabmenu` | tabs under the header | stays in main, above `#view` (emitted by `header.ut`) |
| `#indicators` | header's right corner | `.fs-sidebar #indicators` under the brand; empty → hidden |
| `#view` | content | content (main column) |

The set of top-level sections comes from the menu tree and depends on the installed packages. Do
not hard-code it.

## `data-narrow`: "the sidebar became a bar", and it is a MEASUREMENT

The sidebar gives way to the bar when the content column left beside it is too narrow to read. A
viewport breakpoint cannot say that, because the sidebar is wider expanded than as a rail.

`fitShell()` (`fs-chrome.js`) subtracts the slice from the root's `clientWidth` and compares the
remainder with `--fs-content-min`. It reads the widths from the CSS tokens (`--fs-sidebar-w`,
`--fs-rail-w`, `--fs-content-min`) through `getComputedStyle` rather than keeping copies. With a
copy, narrowing the rail in the styles would leave the measurement subtracting the old number, and
nothing would notice. The result is `data-narrow` on `:root`, read by both the CSS and
`flyoutMode()` in the JS.

**The subtraction itself is `columnWidth()`, and there is exactly one of it.** Two callers need the
width of the content column. `fitShell()` decides whether the sidebar still fits beside it.
`contentWidth()` answers `fitTables()` mid-scroll, where reading layout per table is forbidden. The
gutter in `shellGeometry()` already covers BOTH sides. The top-BAR layout has no sidebar to
subtract, although it carries no `data-narrow` either (`fitShell()` removes it on the way out).

The gutter is MEASURED off `.fs-content` rather than read from the `--fs-content-pad` token. The
same sheet re-pads that element to 16px a side below 767px while the token stays 28. A media query
has no `data-*` to key on, and its breakpoint may not be copied into the JS.

`contentWidth()` compares `document.documentElement.clientWidth` with the cached `_shellOuter` on
every call and re-runs `measureShell()` when they differ: `fitChrome()` skips its passes while the
page scrolls, so the cache can hold the previous viewport's width.

**The fit engine also keeps the reader in place when a poll tick grows the page above them.** While
a tick refills a container, `holdFloor()` holds it at its last height. A layout taken mid-refill
then cannot clamp the offset into a shorter document. Where the browser anchors scrolling itself
(`CSS.supports('overflow-anchor', 'auto')`: Chrome 56+, Firefox 66+, Safari and iOS 27+), the
browser moves the offset and the observer takes no reference. Elsewhere (Safari and iOS before 27)
the observer takes a reference element at the top of the view before the mutation. It writes the
reference's drift back on the next frame (`anchorFor()`, `scheduleAnchor()`, `applyAnchor()`).

The `scroll` listener reads nothing inside the event, only on the next frame. A layout forced while
WebKit dispatches `scroll` makes its anchoring controller skip that adjustment. The controller then
anchors nothing for the rest of the document's life. At that moment a sticky or fixed box (`.th`,
`#modal_overlay`, the bar) also leaves layout dirty. `tools/anchor-check.mjs` checks both paths in
Chromium, Firefox and WebKit against bootstrap. `tools/e2e.mjs` runs it locally, and CI runs it as
the `anchor` job ([verifying.md](verifying.md)).

The one literal is `@media (min-width: 521px)` around the vertical override in `20-shell.css`. It
is the floor below which no slice leaves a readable 500 px. It is also the safety net with JS
disabled: no JS means no `data-narrow`, and a phone would otherwise draw the desktop sidebar.

The top bar measures too. `fitChrome()` first lets `fitTabStrips()` squeeze the menu pills
(`.fs-dense1`, then `.fs-dense2`). If the menu still wraps, it adds `.fs-ind-compact`, and only then
`.fs-bar-stack`, which moves the menu to a second row. Whether it fits depends on the number of
sections on that router, not on the screen.

`fitChrome()` pins the bar's `min-height` and `height` at the settled height for the whole pass and
clears both after. The page laid out under the bar then does not move while the classes are off.

## The bar: fit steps, scroll model, a rail that must match its guard

**The bar is written once, unguarded: never under a viewport OR an attribute selector.** It lives in
`styles/theme/20-shell.css`. CSS cannot OR a media query with `:root[data-layout="top"]` in one
selector, so writing the bar under both guards means writing it twice. With the bar unguarded,
each of the three chrome states (bar, vertical sidebar, vertical rail) is stated exactly once. The
vertical sidebar wins on specificity (`0,4,0` against the bar's `0,1,0`), never on source order.

**`.fs-shell`'s floor height is `svh`, never `dvh`.** `dvh` follows the browser UI as it slides, so
on iOS the shell would re-lay-out on every frame of a scroll. A height that must not move under the
reader uses `svh`; `dvh` is for something meant to grow as the UI retracts.

**Right cluster: two fit steps, both measured by `fitCluster()` (fs-chrome.js), neither gated on
layout.** The top layout is a bar at every width. The sidebar layout becomes one on a phone, so a
`data-layout="top"` guard would miss it. Step 1 (`.fs-ind-compact`) drops the indicator pills'
prose for icon squares. Step 2 (`.fs-bar-actrow`) moves the whole cluster to its own row when that
is not enough.

**Hostname handling is two rules for two different failures.** `overflow-wrap: anywhere` lets a
long, dot-free hostname shrink, so it cannot push the menu out of the bar. An ellipsis would
truncate the one string that identifies the router. `-webkit-line-clamp: 3` bounds the height,
since a hostname is at most 63 characters.

**A static sidebar, never `position: sticky`.** The desktop sidebar layout pins `.fs-shell` to the
viewport and scrolls `.fs-main`. A sticky sidebar is a composited layer that left a 1px seam of the
rail's flyout on hover; `static` makes no stacking context, so flyouts stack in the root one.

**`contain: paint` on `.fs-main` is the fix for issue #12, a Firefox-only leak.** Firefox propagates
an out-of-flow descendant's overflow past both overflow ancestors and grows `html.scrollHeight`,
dragging the sidebar off-screen. Paint containment clips it at `.fs-main`; LuCI's modals sit on
`<body>`, outside it.

**The rail's guard must be the vertical sidebar's, exactly**: same media floor, same
`:not([data-narrow])`. The rail is a mode of the vertical sidebar and is never visible where the
vertical sidebar is not. A different floor would draw the full sidebar while the JS subtracts the
rail's width.

**A flyout's heading reuses the bar's hover-bridge pseudo-element, and resets every geometry
property doing it.** `li.has-sub > ul::before` is the bar's 10px hover bridge. In the rail it
carries the flyout's title, so `position`, `inset` and `height` are reset there. The rail's own
bridge is `li.has-sub::after`.

**A collapsed-rail indicator badges its count instead of wrapping its prose.** `fs-chrome.js` lifts
the count into `data-fs-badge`, and the CSS shows the badge alone with `font-size: 0`. The prose
stays in the DOM for screen readers and in `title`.

**A bar dropdown anchors to its own `<li>`, not to the bar.** A panel anchored to the bar's edge
leaves a gap to its trigger. Hover then closes before the pointer arrives.

**A footer link pair needs 26px between their centres, not the type scale's own leading.** The
26px follows WCAG 2.2 SC 2.5.8. Where the footer sentence wraps, its two links land on consecutive
lines. `line-height: max(26px, calc(var(--fs-type) * 2))` follows the Density axis and never drops
under 26px, including at Compact.

## Tab strips

**One component, three LuCI selectors deduplicated in `theme/40-tabs.css`.** `#tabmenu ul.tabs`
(page tabs), `.tabs` (view tabs) and `.cbi-tabmenu` (CBI form tabs, including the mode switcher
`ul.cbi-tabmenu.mode`) share every rule except the active marker (`.active` vs `.cbi-tab`). The
mode switcher adds one rule of its own, `max-width: none`.

**`.cbi-tabmenu > li` alone gets `max-width: 100%`, not `none`.** A long translated CBI tab label
otherwise overflows a phone column. The `a`'s ellipsis (`base/50-chrome.css`) engages only because
the `li`'s `max-width` stops its automatic minimum size at the label's content width.

**Keyboard focus on a tab pill uses one ring for both states, `--fs-focus-ring-solo`.**
`base/50-chrome.css`'s ordinary `outline: 2px solid var(--fs-accent)` is invisible on the active
pill, whose background is the same accent. The ring is a `box-shadow`, because the strip clips
overflow and a shadow is not clipped by the scroll container.

**Density steps (`fs-dense1` → `fs-dense2`) come from `fitTabStrips()` (`fs-chrome.js`).** It
measures whether the strip wraps to a second row. The steps are mutually exclusive, so a pill is
never trimmed by both classes at once. For tabs both steps give the same padding, so `fs-dense2`
changes nothing past `fs-dense1`.

## `header.ut`

- Shared parts live in `partials/` (`head`, `notice`); the brand, search, log-out and icon
  markup is inline in `header.ut`. There is no second template directory.
- A chrome icon is a bare `<svg class="fs-ico" aria-hidden="true" viewBox="0 0 24 24">`. Its fill,
  stroke, 1.9 width and round caps come from the one `.fs-ico, .fs-chevron` rule in
  `theme/20-shell.css`, not five attributes per element (100 B each, 300 B of every admin page).
  `header.ut` writes its three inline, and `svgIcon()` (`fs-widgets.js`) emits the same markup for
  the menu and the search palette. A class outside the rule draws a filled black glyph.
- `<body>` → a `.fs-shell` flex wrapper. Before it, the skip link `.fs-skip`
  ("Skip to content" → `#maincontent`), the first tab stop on the page.
- Sidebar: `<nav class="fs-sidebar" aria-label="Menu">`, deliberately `<nav>`. `<aside>` gives
  the `complementary` role, and no landmark jump reaches the menu through it.
  - `.fs-brandrow`: brand (gradient square + wifi SVG on `currentColor` + hostname wordmark) and
    the `#fs-rail-toggle` button;
  - `<div id="indicators">`;
  - `.fs-navlabel` + `<ul class="nav" id="topmenu">` (filled by the menu JS) + `<ul id="modemenu">`;
  - `.fs-spacer` (`flex:1`);
  - the search button (`#fs-search-btn`, the command palette below) and Log out. The appearance
    axes are their own menu entry (`/admin/system/footstrap`): see
    [design-system.md](design-system.md).
- Main: `<main class="fs-main" id="maincontent" tabindex="-1">`, holding the
  `.fs-title-main.fs-sr` `<h1>`, `#fs-nav-status`, and `.fs-content` (warnings, `#tabmenu`, `#view`, footer).
- Must be preserved: `http.prepare_content`, `cbi.js`, the translations script, `node.css`, `css`,
  `blank_page`, `noscript`, and the no-root-password / initramfs warnings.

`footer.ut` emits `<footer class="fs-footer" role="contentinfo">`. The role is explicit because
`<footer>` gets `contentinfo` implicitly only when its nearest ancestor is `<body>`, and this one
sits inside `<main>`. It hard-loads `L.require('menu-footstrap')` and then `L.require('fs-select')`.

## `fs-chrome.js` — the ONLY renderer

**A second layout is not a second renderer.** The sidebar markup is what its CSS turns into a
horizontal bar on a phone. Its flyout mode makes a section behave exactly like a top-menu
dropdown. The top layout is that mode at desktop width.

- `renderMainMenu` fills `#topmenu`: an item is
  `<li><a><icon><span class="fs-label">title</span><chevron></a></li>`, active by
  `L.env.dispatchpath`. Icons are mapped by section name with a regex fallback and a generic SVG,
  inlined as strings in the JS (`E()` cannot build SVG: see [conventions.md](conventions.md)).
- `renderMainMenu` sits in `fs-chrome.js` beside `renderModeMenu` and `renderTabMenu`, together
  with the rail (`wireRail()`) and chrome measurement (`fitShell()`, `fitChrome()`).
  `menu-footstrap-common.js` calls `chrome.wireMenu()` and `chrome.start()`, so the renderer is no
  injected parameter. The SPA router lives in `fs-router.js`.
- The top-level `admin/logout` node is dropped from the tree. The chrome draws its own Log out
  (`header.ut`), which would otherwise appear twice.
- **A section with children is a W3C APG disclosure pattern**, not a link: `role="button"`,
  `aria-expanded`, `aria-controls`, Enter/Space, and Escape closes the flyout and returns focus.
  It is deliberately not `role="menu"`: APG says site navigation should not take menubar
  semantics. `aria-current="page"` goes on the leaf only; a section header is a button, not a link
  to the current page.
- **The active PLATE (fill) follows the page; an open ANCESTOR keeps only the accent INK.**
  `li.active` is set on both the current leaf and the section containing it. A shared rule handing
  both the same fill would draw two identical plates stacked on System → System.
  `theme/10-chrome.css` matches the plate on `a.active` and the ink on
  `li.active > a:not(.active)`, so an ancestor that is not itself the page never gets the fill.
- **`.open` has two meanings.** In the expanded sidebar it is an accordion: several sections open
  at once, the set remembered in `localStorage` `fs-menu-open`. In the rail, in the bar, or on a
  narrow screen it is an exclusive flyout. `flyoutMode()` decides, and it reads exactly what the
  stylesheet reads: `data-rail` / `data-layout=top` / `data-narrow`. Leaving flyout mode restores
  the accordion (`restoreAccordion()`), not a plain `closeFlyouts()`. The markup is not rebuilt on
  a rail toggle, so stripping `.open` from everything would lose the remembered set.
- `clampDropdown` pushes a dropdown back into the viewport at its inline-end edge (right in LTR,
  left in RTL, through `inset-inline-start`). It runs whenever the chrome is a BAR
  (`barDropdown()`: the top layout at any width, or a `data-narrow` sidebar), because then a panel
  hangs off its own `<li>`. The rail is excluded: there a flyout is anchored sideways. It keeps one
  scheduled `rAF` per `<li>`, so it can cancel an unfinished measurement when the pointer has moved
  on. The shared `fit.frame()` coalescer cannot express that; this is a documented exception.
- Hover opening is pure CSS.
- The width probe declares its properties `!important`. An app carrying `div { min-width: 500px
  !important }` would otherwise win every read and fold the sidebar into a bar on a wide desktop.
  `box-sizing` is stated for the same reason, as `getComputedStyle().width` is the content box.
- The indicator observer shares `stamp()`'s callback. `fs-ind-compact` then lands in the
  microtask before paint, instead of a second indicator pushing the page down for a frame.

## Dark mode and outward compatibility

Mode, palette and layout are all client settings; the pre-paint blocks in `partials/head.ut` stamp
`:root` before the first frame, one block per axis.

Dark mode: a stored value beats the OS, otherwise `prefers-color-scheme`. The `change` subscription
is registered always (it re-reads storage), so Auto keeps following the system if the user
switches to it after load.

**`set()` (inline in `partials/head.ut`) and `stampDark()` (`fs-prefs.js`) stamp THREE
attributes.** This theme's CSS reads `data-darkmode`. `data-theme` and `data-bs-theme` are outbound
compatibility for third-party apps that sniff them: `luci-app-justclash` hangs 21 rules on
`data-theme`, and `ssclash` checks `data-bs-theme` first. Nothing inside `styles/` may read the
latter two.

`<meta name="darkreader-lock">` stops the Dark Reader extension repainting the theme into mush.

More on how foreign apps detect dark mode: [third-party-apps.md](third-party-apps.md).

## The command palette

`fs-search.js` finds a page by name instead of by remembering which section owns it. A loaded
router carries ~200 reachable menu nodes across 11 sections. Some pages appear in no menu list
at all until you are already there: "Port Forwards" is a tab of Network → Firewall.

- **It costs no request.** The index is built from the same ACL-filtered `/admin/menu` blob the
  chrome already loaded (`fs-menutree`). The palette therefore knows exactly the pages this session
  may open: nothing to leak, nothing to 403 on. The index is built on the first open, not at init.
  A user who never searches pays nothing, and only a full load can change the tree.
- **It indexes tabs**, to `admin/<section>/<page>/<tab>`: four levels, every path the dispatcher
  renders.
- **It does not call the router.** Every result is a real `<a href>`, so a click bubbles to the
  router's own document-level handler. The click takes the SPA path, or falls back to a full load
  when the node is not SPA-able, with no second copy of that decision. Enter synthesises the same
  click.
- **Recently visited rows are kept in `localStorage` `fs-recent`, one menu path each.** Only the
  path is stored. The title is resolved through the index on every render, so it follows the UI
  language, and a page an ACL change hides is dropped instead of shown dead.
  `menu-footstrap-common` owns the writer (`remember()`), and `warmRecent()` prefetches each path.
  The key, the cap of 8 and the reader (`recentPaths()`) live once in `fs-prefs`.
  `menu-footstrap-common` alone binds the button, Ctrl/Cmd+K and `/`, calling `fs-search`'s
  `open`/`toggle`: see [spa-router.md](spa-router.md).

**Do not index through `ui.menu.getChildren()`.** On an alias node it returns the alias target's
children, so Network → Firewall's tabs would be missing from the index.

## `fs-select.js`

Turns every stock `<select>` into a styled `ui.Dropdown`, because a native `<select>` popup cannot
be styled with CSS. The native `<select>` remains the form field and must stay
`frameEl.firstChild`, because `ui.Select.getValue()` returns `this.node.firstChild.value`.

It also owns `fitTables()`, which folds data tables into cards. Why config tables are handled
differently, and why that difference is not an unfinished job: [css.md](css.md).

Invariants:

- `#modal_overlay` is a root as well as `#view`, so a dialog's table fits its dialog.
- A table with no LuCI class is tagged too, because a third-party app may emit one.
- The fit answer is keyed on the section frame (table id, or position), so the poll's
  table replacement every tick causes no new measuring pass. A zero measurement is never cached.
- The theme claims `stabilizeActionColumnWidth`'s resize hook, which would otherwise add a listener
  per table on every SPA navigation.
