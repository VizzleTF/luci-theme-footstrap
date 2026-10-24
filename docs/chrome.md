# The chrome: sidebar, rail, bar

The spec for what `header.ut` and `fs-chrome.js` draw. Tokens and palettes:
[design-system.md](design-system.md). The stylesheet build: [css.md](css.md). Client navigation:
[spa-router.md](spa-router.md).

## Layout is a CLIENT axis, not a theme entry

`luci.themes` holds one entry, `Footstrap` → `/luci-static/footstrap`. The sidebar and the top
bar are the same markup and the same renderer; CSS morphs them by `:root[data-layout]`.

- The attribute **always carries an explicit value** (`sidebar` | `top`) and is **stamped by the
  server** in `partials/head.ut`; an inline script overrides it from `localStorage` `fs-layout`
  before first paint. The explicit value is not cosmetic: every layout rule matches
  **positively**, so a future third layout must opt into rules rather than inherit the sidebar's
  by merely not being `top` — which is what `:not([data-layout="top"])` would do, and why that
  guard must not be written. It also keeps the chrome correct with JS disabled.
- Switching layout re-renders nothing: the DOM serves both, CSS changes the chrome, and a
  `MutationObserver` on `data-layout` in `fs-chrome.js` folds the accordion into dropdowns
  and back.
- **The router may carry a default**: `uci set footstrap.settings.layout=sidebar|top` (or Save to
  router) names the layout a browser starts on, `head.ut` whitelists and stamps it, and the
  reader's own choice overrides it forever. A
  shell script cannot write `localStorage`, which is why the server side of the axis exists at
  all. Layout is the axis this pattern started with; every axis now records its choice
  explicitly, for the same reason — see the three layers in [design-system.md](design-system.md).

**The bar is the base; the vertical sidebar is the exception.** The bar is written once with no
guards (`styles/theme/20-shell.css`) and serves the top layout at any width *and* the sidebar
layout on a phone. The vertical column is the single guarded override, winning on specificity
(`0,4,0` against `0,1,0`) rather than on order. `50-toplayout.css` is a pure desktop-bar delta.

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

The widths are quoted at normal density: `--fs-sidebar-w` and `--fs-rail-w` are `calc()` over
`--fs-density-box`, which the Density axis sets, so Compact and Large move them — and `fitShell()`
follows for free because it reads the computed token rather than a copy.

There is no separate topbar inside `main`: the page title is a visually hidden `<h1>`
(`.fs-title-main.fs-sr`), and `#indicators` (the "Refreshing" poll pill, unsaved changes)
lives in the sidebar. The `◂` button (`#fs-rail-toggle`) collapses the sidebar to a 68 px icon rail
with flyouts.

**`.fs-sr` clips, it does not hide.** `hidden` is `display:none`, which drops the element out of
the accessibility tree. Clipping (as `.fs-skip` does) keeps it in the tree.
Beside it sits `#fs-nav-status` (`role="status"`, `aria-live="polite"`), where the router writes
the page title after every SPA navigation — without it, a page change without a reload does not
happen at all for a screen reader.

## LuCI container mapping

| LuCI container | In bootstrap | In footstrap |
|---|---|---|
| `#topmenu` | horizontal top-level menu | `ul.nav` in `.fs-sidebar`: vertical list / bar / rail flyouts — **one markup** |
| `#modemenu` | admin/status breadcrumb switch | `.fs-modemenu` in the chrome (sidebar, bar, top layout; hidden in the collapsed rail); shown only at two or more modes: `theme/20-shell.css` hides it, and `.fs-modemenu:not(:empty):not(.single)` alone shows it |
| `#tabmenu` | tabs under the header | stays in main, above `#view` (emitted by `header.ut`) |
| `#indicators` | header's right corner | `.fs-sidebar #indicators` under the brand; empty → hidden |
| `#view` | content | content (main column) |

The set of top-level sections comes from the menu tree and depends on the installed packages —
**do not hard-code it**.

## `data-narrow`: "the sidebar became a bar", and it is a MEASUREMENT

The sidebar gives way to the bar when the remaining content column has nothing left to show. A
viewport breakpoint cannot say that: the slice is not a constant (224 px expanded, 68 px rail), so
one breakpoint gave both states the same answer and the rail collapsed at the same width as the
full sidebar.

`fitShell()` (`fs-chrome.js`) subtracts the slice from the root's `clientWidth` and compares the
remainder with `--fs-content-min`; it **reads the widths from the CSS tokens** (`--fs-sidebar-w`,
`--fs-rail-w`, `--fs-content-min`) through `getComputedStyle` rather than
keeping copies — otherwise narrowing the rail in the styles would leave the measurement subtracting
the old number, and nothing would notice. The result is `data-narrow` on `:root`, read by both the
CSS and `flyoutMode()` in the JS.

**The subtraction itself is `columnWidth()`, and there is exactly one of it.** Two callers need the
width of the content column — `fitShell()`, deciding whether the sidebar still fits beside it, and
`contentWidth()`, which answers `fitTables()` mid-scroll where reading layout per table is forbidden. The
gutter in `shellGeometry()` is already BOTH sides, and the top-BAR layout has no sidebar to subtract
although it carries no `data-narrow` either (`fitShell()` removes it on the way out). The gutter it
subtracts is MEASURED off `.fs-content` rather than read from the `--fs-content-pad` token: the same
sheet re-paddings that element to 16px a side below 767px while the token stays 28, and a media
query has no `data-*` to key on — nor may its breakpoint be copied into the JS.

The model answers below the column's `max-width` and has no cap of its own: both callers ask a lower bound
(500, 568), and the width slider's floor (1280) keeps a capped column at >= 1216px, above both, so a cap
would change no decision.

**`contentWidth()`'s width is compared fresh on every call, not just cached from the last fitter.**
`_shellOuter` (the window width `columnWidth()` subtracts from) is written only by `measureShell()`,
which only `fitShell()` calls, and `fitChrome()` steps aside for the whole `SCROLL_IDLE` window
(400 ms, `fs-fit.js`) whenever `fit.scrolling()` answers yes — a resize starts that window the same
way a flick does. A caller landing inside it — `fitTables()`'s, most of all, since it asks mid-scroll
by design — would get the PREVIOUS viewport's width from a cache. So `contentWidth()` compares
`document.documentElement.clientWidth` against `_shellOuter` on every call and re-runs
`measureShell()` when they differ. That comparison is the one layout read the function's "no layout
read" promise is conditional on. The read forces
layout when it is dirty on classic-scrollbar engines (overlay-scrollbar phones skip the flush), so
`fitTables()` takes it once per mid-scroll pass, lazily, not once per unanswered table.

The measurement, the observer and the coalescing live in `fs-fit.js`, the theme's one "does it
still fit?" engine (also used by `fitTables` in `fs-select.js`). **A new fit decision registers with
`fit.add()`; do not grow a second observer.**

**The same observer keeps the reader in place when a poll tick grows the page above them.** While a
tick refills a container, `holdFloor()` holds it at its last height, so a layout taken mid-refill
cannot clamp the offset into a shorter document. Where the engine anchors itself
(`CSS.supports('overflow-anchor', 'auto')`: Chrome 56+, Firefox 66+, Safari and iOS 27+), the
engine moves the offset and the observer takes no reference. Elsewhere (Safari and iOS before 27) the
observer takes a reference element at the top of the view before the mutation and writes its drift
back on the next frame (`anchorFor()`, `scheduleAnchor()`, `applyAnchor()`). The `scroll` listener
reads nothing inside the event, only on the next frame: a layout forced while WebKit dispatches
`scroll` makes its anchoring controller skip that adjustment and anchor nothing for the rest of the
document's life, and a sticky or fixed box (`.th`, `#modal_overlay`, the bar) leaves layout dirty at
that moment. `tools/anchor-check.mjs`, which e2e runs, checks both paths in Chromium, Firefox and
WebKit against bootstrap ([verifying.md](verifying.md)).

The one literal is `@media (min-width: 521px)` around the vertical override in `20-shell.css`: the
floor below which no slice leaves a readable 500 px, and simultaneously the safety net with JS
disabled — no JS means no `data-narrow`, and a phone would otherwise draw the desktop sidebar.

The top bar measures too: it first squeezes the pills (`.fs-dense1/2`), and only if the menu still
wraps at the tightest step does it move to a second row (`.fs-bar-stack`). Whether it fits
depends on the number of sections on that particular router, not on the screen.

**And it pins its own height while it measures.** Rule 1 says take the class off and ask the engine,
but the bar is the one fitter whose element sits ABOVE the reader on every page: `fs-bar-stack` is
what gives the menu its own row, so for the widths where the menu does not need one the bar answers
a row shorter than it stands. That height is what the engine lays the rest of the page out against
for the length of the pass, and the page creeps upward once per poll tick (seen on iOS). So
`fitChrome()` writes `min-height` at the settled height before it strips the classes and takes it
off after — the measurement is unchanged, and the box the page is laid out against does not move.
The symptom does not reproduce headless (the pass is one synchronous task), so measure
`#maincontent`'s position at the pass's forced layouts, not the scroll offset afterwards.

## The bar: fit steps, scroll model, a rail that must match its guard

**The bar is written once, unguarded — never under a viewport OR an attribute selector.** CSS
cannot OR a media query with `:root[data-layout="top"]` in one selector, so writing the bar under
both guards means writing it twice (55 of ~75 declarations identical, free to drift). Inverted,
each of the three chrome states — bar, vertical sidebar, vertical rail — is stated exactly once,
and the vertical sidebar wins on **specificity** (`0,4,0` against the bar's `0,1,0`), never on
source order.

**`.fs-shell`'s floor height is `svh`, never `dvh`.** `dvh` tracks the viewport as browser UI comes
and goes, and on iOS the URL bar slides continuously while the reader scrolls, so a shell keyed on
it re-lays-out on every frame of that animation — the shaking reported from an iPhone. `svh` is the
small-viewport height, fixed while the UI moves, and correct for a floor: the shell must be at
least one screenful tall with the bar shown, and is free to grow taller once the bar hides. The
rule generalises: a height that must not move under the reader uses `svh`; `dvh` is for something
meant to grow as the UI retracts.

**Right cluster: two fit steps, both measured by `fitCluster()` (fs-chrome.js), neither gated on
layout.** The top layout is a bar at every width and the sidebar layout becomes one on a phone, so
a `data-layout="top"` guard misses the common case — a phone in the default sidebar layout, whose
bar would otherwise show full pills with Log out wrapped alone onto a second row. Step 1
(`.fs-ind-compact`) drops the indicator pills' prose for icon squares, freeing ~200px, often
enough to keep the menu on the brand's row. Step 2 (`.fs-bar-actrow`) moves the whole cluster to
its own row when the pills alone are not enough.

**Hostname handling is two rules for two different failures.** `overflow-wrap: anywhere` lets a
long, dot-free hostname's flex min-content shrink so it cannot push the menu out of the bar
(`nowrap` + ellipsis would truncate the one string that identifies the router). `-webkit-line-clamp:
3` bounds the other axis a width cap alone does not reach: an unbounded name would make the bar
thousands of pixels tall. Three lines outlasts every real hostname (the kernel's nodename limit is
63) and still reads as a bar.

**A static sidebar, never `position: sticky` (issue #7).** The desktop sidebar layout pins
`.fs-shell` to the viewport and scrolls `.fs-main` inside itself, so the sidebar only needs to stay
put — and `sticky` is the wrong tool for that: it is a composited GPU layer, and with the
`overflow: visible` the rail's flyouts need to escape sideways, every hover repaint left a 1px seam
of the flyout at the layer's edge until a full repaint cleared it. `static` makes no stacking
context at all, so the flyouts resolve `--fs-z-flyout` in the root one instead, with nothing to
leave stale.

**`contain: paint` on `.fs-main` is the fix for issue #12, a Firefox-only leak.** `.fs-shell` is
`height: 100svh; overflow: hidden` and `.fs-main` is its own `overflow: auto` scroller, so Chrome
never grows the document past the viewport — but Firefox propagates an out-of-flow descendant's
scrollable overflow past both overflow ancestors up to the initial containing block anyway,
growing `html.scrollHeight` past the viewport and dragging the fixed sidebar off-screen (on the
Overview, whose `.fs-ovl` grid is the tall descendant). Paint containment makes `.fs-main` the
containing block for that descendant and clips it; LuCI's modals are `position: fixed` on
`<body>`, not inside `.fs-main`, so the new containing block does not re-base them, and Chrome
takes no path through this rule at all.

**The rail's guard must be the vertical sidebar's, exactly** — same media floor, same
`:not([data-narrow])`. With a different floor, between the two widths the vertical rules apply
without the rail ones: the sidebar springs back to its full 224px while the JS measurement is
already subtracting the rail's 68px. The rail is a MODE of the vertical sidebar and can never be visible
under conditions the vertical sidebar itself is not.

**A flyout's heading reuses the bar's hover-bridge pseudo-element, and reset every geometry
property doing it (issue #22).** `li.has-sub > ul::before` is the bar's invisible 10px hover
bridge above the popup; in the rail the same selector carries the flyout's title instead, and
left in force, `position`, `inset` and `height` render the heading as a 10px-tall absolute box
above the flyout, clipped by the panel's own overflow. The rail brings its own bridge as
`li.has-sub::after` instead.

**A collapsed-rail indicator badges its count instead of wrapping its prose (issue #14).** "Unsaved
Changes: N" does not fit a 68px rail: unclamped, the pill wraps onto three lines and hangs past
the rail's edge over the content. `fs-chrome.js` lifts the count into `data-fs-badge` (a text
node is unreachable by a selector) and the CSS paints a square showing the badge alone, `font-size:
0` hiding the prose without removing it from the DOM (still read by a screen reader, still in
`title` for the pointer).

**A bar dropdown anchors to its own `<li>`, not to the bar (issue #19).** A panel anchored to the
bar's edge leaves a diagonal gap to its trigger, and the CSS hover closes before a pointer reaches
the panel. `clampDropdown` (`fs-chrome.js`) nudges an item near the edge back inside the viewport
in every bar state.

**A footer link pair needs 26px, not the type scale's own leading, between their centres (WCAG 2.2
SC 2.5.8).** The footer is one sentence carrying two links; where it wraps, they land on
consecutive lines, and with the inherited leading that put 16px between their centres — inside the
24px envelope the criterion sets around a target smaller than 24×24, which an inline link always
is. `line-height: max(26px, calc(var(--fs-type) * 2))` is a floor, not a fixed number, because a
bare `26px` would be the one leading in the file that ignores the Density axis while a bare
multiplier falls back under 24px at Compact (11.7px × 2 = 23.4) — exactly where the wrap is most
likely. Where it wraps depends on text metrics, so it differs between machines.

## Tab strips

**One component, three LuCI selectors deduplicated in `theme/40-tabs.css`.** `#tabmenu ul.tabs`
(page tabs), `.tabs` (view tabs) and `.cbi-tabmenu` (CBI form tabs, and the mode switcher
`ul.cbi-tabmenu.mode` through it) share every rule (the mode switcher keeps only its own
`max-width: none`) except the active marker (`.active` vs `.cbi-tab`).

**`.cbi-tabmenu > li` alone gets `max-width: 100%`, not `none`** (page tabs and the mode switcher
keep `none`, since neither ever carries a sentence-length label). A long translated CBI tab label
(adblock's Overview in Russian) otherwise overflows a phone column. The `a` carries `white-space:
nowrap; overflow: hidden; text-overflow: ellipsis` (`base/50-chrome.css`), which engages only
because the `li`'s `max-width` stops its automatic minimum size sitting at the label's full content
width. `100%` is smaller than that content width only once the column already is
— a no-op everywhere the tab already fits.

**Keyboard focus on a tab pill uses one ring for both states, `--fs-focus-ring-solo`.**
`base/50-chrome.css`'s ordinary `outline: 2px solid var(--fs-accent)` is invisible on the active
pill, whose background is the same accent. A tab flips nothing else on focus, so the ring alone is
the indicator; the tinted `--fs-focus-ring` is too low-contrast against the strip. `box-shadow`, not `outline`, because the strip clips overflow and a
shadow is not clipped by the scroll container.

**Density steps (`fs-dense1` → `fs-dense2`) come from `fitTabStrips()` (`fs-chrome.js`) measuring
whether the strip wraps to a second row**, mutually exclusive so a pill is never trimmed by both
classes at once. Both steps give the pill the same padding (the strip's `gap` and font-size
already equal the base), so for tabs `fs-dense2` changes nothing past `fs-dense1`.

## `header.ut`

- Shared parts live in `partials/` (`head`, `notice`); the brand, search, log-out and icon
  markup is inline in `header.ut`. There is no second template directory.
- **A chrome icon is a bare `<svg class="fs-ico" aria-hidden="true" viewBox="0 0 24 24">`**: its
  fill, stroke, 1.9 width and round caps are the one `.fs-ico, .fs-chevron` rule in
  `theme/20-shell.css`, not five attributes per element (100 B each, 300 B of every admin page).
  `header.ut` writes its three inline and `svgIcon()` (`fs-widgets.js`) emits the same markup for
  the menu and the search palette; a class outside the rule draws a filled black glyph.
- `<body>` → a `.fs-shell` flex wrapper. Before it, the skip link `.fs-skip`
  ("Skip to content" → `#maincontent`), the first tab stop on the page.
- **Sidebar** — `<nav class="fs-sidebar" aria-label="Menu">`, deliberately `<nav>`: `<aside>` gives
  the `complementary` role, and no landmark jump reaches the menu through it.
  - `.fs-brandrow`: brand (gradient square + wifi SVG on `currentColor` + hostname wordmark) and
    the `#fs-rail-toggle` button;
  - `<div id="indicators">`;
  - `.fs-navlabel` + `<ul class="nav" id="topmenu">` (filled by the menu JS) + `<ul id="modemenu">`;
  - `.fs-spacer` (`flex:1`);
  - the search button (`#fs-search-btn`, the command palette below) and Log out. The appearance
    axes are their own menu entry (`/admin/system/footstrap`) — see
    [design-system.md](design-system.md).
- **Main** — `<main class="fs-main" id="maincontent" tabindex="-1">`: the
  `.fs-title-main.fs-sr` `<h1>`, `#fs-nav-status`, and `.fs-content` (warnings, `#tabmenu`, `#view`, footer).
- Must be preserved: `http.prepare_content`, `cbi.js`, the translations script, `node.css`, `css`,
  `blank_page`, `noscript`, and the no-root-password / initramfs warnings.

`footer.ut` emits `<footer class="fs-footer" role="contentinfo">` — the role is explicit
because `<footer>` only gets `contentinfo` implicitly when its nearest ancestor is `<body>`, and
this one sits inside `<main>`. It hard-loads `L.require('menu-footstrap')` and then
`L.require('fs-select')`.

## `fs-chrome.js` — the ONLY renderer

**A second layout is not a second renderer**: the sidebar markup is what its CSS turns into a
horizontal bar on a phone, and its flyout mode makes a section behave exactly like a top-menu
dropdown. The top layout is that mode at desktop width.

- `renderMainMenu` fills `#topmenu`: an item is
  `<li><a><icon><span class="fs-label">title</span><chevron></a></li>`, active by
  `L.env.dispatchpath`. Icons are mapped by section name with a regex fallback and a generic SVG,
  inlined as strings in the JS (`E()` cannot build SVG — see [conventions.md](conventions.md)).
  `renderMainMenu` sits in `fs-chrome.js` beside `renderModeMenu` and
  `renderTabMenu`; `menu-footstrap-common.js` calls `chrome.wireMenu()` and `chrome.start()`, so
  the renderer is no injected parameter. The rest — tabs, modes, the rail, the SPA router, chrome
  measurement — lives in the other `fs-*.js` modules.
- The top-level `admin/logout` node is dropped from the tree — the chrome draws its own Log out
  (`header.ut`), otherwise it appears twice.
- **A section with children is a W3C APG disclosure pattern**, not a link: `role="button"`,
  `aria-expanded`, `aria-controls`, Enter/Space, and Escape closes the flyout and returns focus.
  Deliberately not `role="menu"` — APG explicitly says site navigation should not take menubar
  semantics. `aria-current="page"` goes on the leaf only; a section header is a button, not a link
  to the current page.
- **The active PLATE (fill) follows the page; an open ANCESTOR keeps only the accent INK.**
  `li.active` is set on both the current leaf and the section containing it, so a shared rule
  handing both the same fill drew two identical plates stacked on System → System (issue #37).
  `theme/10-chrome.css` matches the plate on `a.active` and the ink on
  `li.active > a:not(.active)`, so an ancestor that is not itself the page never gets the fill.
- **`.open` has two meanings**: in the expanded sidebar it is an accordion (several sections at
  once, the set remembered in `localStorage` `fs-menu-open`); in the rail, in the bar, or on a
  narrow screen it is an exclusive flyout. `flyoutMode()` decides, and it reads **exactly what the
  stylesheet reads**: `data-rail` / `data-layout=top` / `data-narrow`. Leaving flyout mode restores
  the accordion (`restoreAccordion()`), not a plain `closeFlyouts()`: the markup is not rebuilt on a
  rail toggle, so stripping `.open` from everything would lose the remembered set.
- `clampDropdown` pushes a dropdown back into the viewport at its inline-end edge (right in LTR, left in RTL, through `inset-inline-start`). Whenever the chrome is
  a BAR (`barDropdown()` — the top layout at any width, or a `data-narrow` sidebar), because that is
  when a panel hangs off its own `<li>`; the rail is excluded, where a flyout is anchored sideways
  instead. It keeps one scheduled `rAF` **per `<li>`** so it can cancel an
  unfinished measurement when the pointer has moved on; the shared `fit.frame()` coalescer cannot
  express that, and this is a documented exception.
- Hover opening is pure CSS.

- **The width probe's `!important` declarations.** An app carrying `div { min-width: 500px
  !important }` would otherwise win every read and fold the sidebar into a bar on a wide desktop.
  `box-sizing` is stated for the same reason, as `getComputedStyle().width` is the content box.
- **The indicator observer shares `stamp()`'s callback**, so `fs-ind-compact` lands in the
  microtask before paint instead of a second indicator pushing the page down for a frame.

## Dark mode and outward compatibility

Mode, palette and layout are all client settings; the pre-paint blocks in `partials/head.ut` stamp
`:root` before the first frame, one block per axis.

Dark mode: a stored value beats the OS, otherwise `prefers-color-scheme`. The `change` subscription
is registered always (it re-reads storage), so Auto keeps following the system if the user
switches to it after load.

**`set()` stamps THREE attributes:** `data-darkmode` (which this theme's CSS reads), plus
`data-theme` and `data-bs-theme` as outbound compatibility for third-party apps that sniff
them — `luci-app-justclash` hangs 21 rules on `data-theme`, `ssclash` checks `data-bs-theme`
first. Nothing inside `styles/` may read the latter two.

`<meta name="darkreader-lock">` stops the Dark Reader extension repainting the theme into mush.

More on how foreign apps detect dark mode: [third-party-apps.md](third-party-apps.md).

## The command palette

`fs-search.js` finds a page by name instead of by remembering which section owns it. A loaded
router carries ~200 reachable menu nodes across 11 sections, and some pages appear in no menu list
at all until you are already there — "Port Forwards" is a tab of Network → Firewall.

- **It costs no request.** The index is built from the same ACL-filtered `/admin/menu` blob the
  chrome already loaded (`fs-menutree`), so the palette knows exactly the pages this session may
  open: nothing to leak, nothing to 403 on. It is built on the first open, not at init — a user
  who never searches pays nothing, and only a full load can change the tree.
- **It indexes tabs**, to `admin/<section>/<page>/<tab>` — four levels, every path the dispatcher
  renders.
- **It does not call the router.** Every result is a real `<a href>`, so a click bubbles to the
  router's own document-level handler and takes the SPA path (or falls back to a full load when the
  node is not SPA-able) with no second copy of that decision. Enter synthesises the same click.
- **Recently visited rows are kept in `localStorage` `fs-recent`, one menu path each.** Only the
  path is stored: the title is resolved through the index on every render, so it follows the UI
  language and a page an ACL change hides is dropped instead of shown dead. `menu-footstrap-common`
  owns the writer (`remember()`) and `warmRecent()` prefetches each path; the key, the cap of 8 and
  the reader (`recentPaths()`) live once in `fs-prefs`, and common alone binds the button,
  Ctrl/Cmd+K and `/`, calling `fs-search`'s `open`/`toggle` — see
  [spa-router.md](spa-router.md).

**Trap it was built around: do not index through `ui.menu.getChildren()`.** On an alias node it
returns a copy whose `children` are the alias *target's*. That is right for drawing a menu and
wrong for indexing: Network → Firewall is an alias onto the `firewall/zones` view, a leaf, so its
five tabs came back as an empty list and "port" found nothing on a router that plainly has a Port
Forwards page.

## `fs-select.js`

Turns every stock `<select>` into a styled `ui.Dropdown`, because a native `<select>` popup cannot
be styled with CSS. The native `<select>` remains the form field and must stay
`frameEl.firstChild` — `ui.Select.getValue()` returns `this.node.firstChild.value`.

It also owns `fitTables()`, which folds data tables into cards. Why config tables are handled
differently, and why that difference is not an unfinished job: [css.md](css.md).

### Why `fs-select.js` does what it does

- **Roots.** `ui.showModal` parks its dialog on `#modal_overlay`, a sibling of `#view`, so the
  overlay is a root too; otherwise a dialog's table overflows the dialog.
- **Bare tables.** A `<div class="table">` or a table with no LuCI class is tagged too, because a
  third-party app may emit one. No stock page does.
- **An honest floor.** `overflow-wrap: break-word` keeps a column's min-content real. Rebuilding the
  floor in JS is UAX #14 by hand and wrong both ways, so tables would card that had room.
- **`CRAMPED` is trusted, not measured.** Giving cells a min-width so "cramped" produces an
  overflow cards wide tables that fit, and the card still overflows.
- **The answer lives on the slot.** The measurement strips a table's marks and lays out a full-width
  table for the pass. The poll replaces the table every tick, so measuring each new table would
  throw the reader out and back twice per tick. Keying the answer on the section frame (table id, or
  position) removes the pass.
- **A zero measurement is not an answer.** The first pass reads `scrollWidth: 0` behind the
  `.fs-fitted` gate; caching "fits" would leave a wide table clipped inside the column.
- **Controls stack.** Network → Diagnostics is three controls in one header-less row; on a phone
  the Ping button would sit past `.fs-main`'s clip.
- **Dropping upstream's width pin.** A pin measured while the config table is carded is the card's
  width, and the table scrolls sideways once it unfolds.
- **Claiming the resize hook.** `stabilizeActionColumnWidth` adds a `resize` listener per table
  element and never removes it; under the SPA router the listeners would grow with every
  navigation.

## Translation

Every label on System → Footstrap carries the `footstrap` `msgctxt`; the chrome (Menu, Logout,
Skip to content) and the login/warning strings deliberately do not. The reasoning — `msgid` is a
global name shared with every app on the router — is in [conventions.md](conventions.md).
