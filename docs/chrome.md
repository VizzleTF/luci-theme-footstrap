# The chrome: sidebar, rail, bar

The spec for what `header.ut` and `menu-footstrap.js` draw. Tokens and palettes:
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
  `MutationObserver` on `data-layout` in `menu-footstrap.js` folds the accordion into dropdowns
  and back.
- **Migration**: a router that ran the old top-nav theme must keep its bar. A shell script cannot
  write `localStorage`, so `uci-defaults` puts the router default in
  `luci.main.footstrap_layout=top`, `head.ut` stamps it, and the user's own choice overrides it
  forever. `postrm` deletes the key. Layout is the axis this pattern started with; every axis
  now records its choice explicitly, for the same reason — see the three layers in
  [design-system.md](design-system.md).

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

There is no separate topbar inside `main`: the page title is a visually hidden `<h1>` inside
`<div class="fs-title fs-sr">`, and `#indicators` (the "Refreshing" poll pill, unsaved changes)
lives in the sidebar. The `◂` button (`#fs-rail-toggle`) collapses the sidebar to a 68 px icon rail
with flyouts.

**`.fs-sr` clips, it does not hide.** This was `hidden` once — that is `display:none`, which drops
the element out of the accessibility tree: the `<h1>` effectively did not exist while the SPA
router dutifully updated the title inside it. Clipping (as `.fs-skip` does) keeps it in the tree.
Beside it sits `#fs-nav-status` (`role="status"`, `aria-live="polite"`), where the router writes
the page title after every SPA navigation — without it, a page change without a reload does not
happen at all for a screen reader.

## LuCI container mapping

| LuCI container | In bootstrap | In footstrap |
|---|---|---|
| `#topmenu` | horizontal top-level menu | `ul.nav` in `.fs-sidebar`: vertical list / bar / rail flyouts — **one markup** |
| `#modemenu` | admin/status breadcrumb switch | `.fs-modemenu` in the sidebar; empty or single mode → `display:none` |
| `#tabmenu` | tabs under the header | stays in main, above `#view` (emitted by `partials/notices.ut`) |
| `#indicators` | header's right corner | `.fs-indicators` in the sidebar under the brand; empty → hidden |
| `#view` | content | content (main column) |

The set of top-level sections comes from the menu tree and depends on the installed packages —
**do not hard-code it**.

## `data-narrow`: "the sidebar became a bar", and it is a MEASUREMENT

The sidebar gives way to the bar when the remaining content column has nothing left to show. A
viewport breakpoint cannot say that: the slice is not a constant (224 px expanded, 68 px rail), so
one breakpoint gave both states the same answer and the rail collapsed at the same width as the
full sidebar.

`fitShell()` (`fs-chrome.js`) subtracts the slice from `innerWidth` and compares the remainder with
`--fs-content-min`; it **reads the widths from the CSS tokens** (`--fs-sidebar-w`, `--fs-rail-w`,
`--fs-content-min`, `--fs-content-pad`) through `getComputedStyle` rather than keeping copies —
otherwise narrowing the rail in the styles would leave the measurement subtracting the old number,
and no gate would notice. The result is `data-narrow` on `:root`, read by both the CSS and
`flyoutMode()` in the JS.

The measurement, the observer and the coalescing live in `fs-fit.js`, the theme's one "does it
still fit?" engine (also used by `fitTables` in `fs-select.js`). **Add fit logic there; do not grow
a second observer.**

The one literal is `@media (min-width: 521px)` around the vertical override in `20-shell.css`: the
floor below which no slice leaves a readable 500 px, and simultaneously the safety net with JS
disabled — no JS means no `data-narrow`, and a phone would otherwise draw the desktop sidebar.

The top bar measures too: it first squeezes the pills (`.fs-dense1/2`), and only if the menu still
wraps at the tightest step does it move to a second row (`.fs-bar-stack`). Whether it fits
depends on the number of sections on that particular router, not on the screen.

## `header.ut`

- Shared parts live in `partials/` (`head`, `brand`, `logout`, `notices`, `notice`, `search`,
  `icon`, `footer`). There is no second template directory.
- `<body>` → a `.fs-shell` flex wrapper. Before it, the skip link `.fs-skip`
  ("Skip to content" → `#maincontent`), the first tab stop on the page.
- **Sidebar** — `<nav class="fs-sidebar" aria-label="Menu">`, deliberately `<nav>`: `<aside>` gives
  the `complementary` role, and no landmark jump reaches the menu through it.
  - `.fs-brandrow`: brand (gradient square + wifi SVG on `currentColor` + hostname wordmark) and
    the `#fs-rail-toggle` button;
  - `<div id="indicators">`;
  - `.fs-navlabel` + `<ul class="nav" id="topmenu">` (filled by the menu JS) + `<ul id="modemenu">`;
  - `.fs-spacer` (`flex:1`);
  - the search button (`#fs-search-btn`, the command palette below) and Log out. An Appearance
    button used to sit between them; the axes are a tab on System → System now, so the chrome
    carries one control fewer — see [design-system.md](design-system.md).
- **Main** — `<main class="fs-main" id="maincontent" tabindex="-1">`: `.fs-title.fs-sr` with the
  `<h1>`, `#fs-nav-status`, and `.fs-content` (warnings, `#tabmenu`, `#view`, footer).
- Must be preserved: `http.prepare_content`, `cbi.js`, the translations script, `node.css`, `css`,
  `blank_page`, `noscript`, and the no-root-password / initramfs warnings.

`partials/footer.ut` emits `<footer class="fs-footer" role="contentinfo">` — the role is explicit
because `<footer>` only gets `contentinfo` implicitly when its nearest ancestor is `<body>`, and
this one sits inside `<main>`. It hard-loads `L.require('menu-footstrap')` and then
`L.require('fs-select')`; the `menu_module` parameter that used to pick a renderer went away with
the second renderer.

## `menu-footstrap.js` — the ONLY renderer

There is no `menu-footstrap-top.js`. **A second layout was never a second design**: the sidebar
renderer already produced markup its own CSS turns into a horizontal bar on a phone, and it already
had a flyout mode where a section behaves exactly like a top-menu dropdown. The top layout is
that mode at desktop width. The one piece of unique logic the deleted file carried, `clampDropdown`,
moved here.

- `renderMainMenu` fills `#topmenu`: an item is
  `<li><a><icon><span class="fs-label">title</span><chevron></a></li>`, active by
  `L.env.dispatchpath`. Icons are mapped by section name with a regex fallback and a generic SVG,
  inlined as strings in the JS (`E()` cannot build SVG — see [conventions.md](conventions.md)).
  Everything shared — tabs, modes, the rail, the SPA router, chrome
  measurement — lives in the `fs-*.js` modules that `menu-footstrap-common.js` wires together. Only
  `renderMainMenu` is layout-specific, and it is passed into `common.init()`: composition, not
  inheritance, because LuCI makes a singleton of every baseclass.
- The top-level `admin/logout` node is dropped from the tree — the chrome draws its own Log out
  (`partials/logout.ut`), otherwise it appears twice.
- **A section with children is a W3C APG disclosure pattern**, not a link: `role="button"`,
  `aria-expanded`, `aria-controls`, Enter/Space, and Escape closes the flyout and returns focus.
  Deliberately not `role="menu"` — APG explicitly says site navigation should not take menubar
  semantics. `aria-current="page"` goes on the leaf only; a section header is a button, not a link
  to the current page.
- **`.open` has two meanings**: in the expanded sidebar it is an accordion (several sections at
  once, the set remembered in `localStorage` `fs-menu-open`); in the rail, in the bar, or on a
  narrow screen it is an exclusive flyout. `flyoutMode()` decides, and it reads **exactly what the
  stylesheet reads**: `data-rail` / `data-layout=top` / `data-narrow`. Leaving flyout mode restores
  the accordion (`restoreAccordion()`) — a plain `closeFlyouts()` was not enough, because it
  stripped `.open` from everything while the markup is not rebuilt on a rail toggle, so "Keep open"
  stopped meaning anything.
- `clampDropdown` pushes a dropdown back into the viewport at the right edge. Whenever the chrome is
  a BAR (`barDropdown()` — the top layout at any width, or a `data-narrow` sidebar), because that is
  when a panel hangs off its own `<li>`; the rail is excluded, where a flyout is anchored sideways
  instead. It keeps one scheduled `rAF` **per `<li>`** so it can cancel an
  unfinished measurement when the pointer has moved on; the shared `fit.frame()` coalescer cannot
  express that, and this is a documented exception.
- Hover opening is pure CSS.

## Dark mode and outward compatibility

Mode, palette and layout are all client settings; the pre-paint blocks in `partials/head.ut` stamp
`:root` before the first frame, one block per axis.

Dark mode: a stored value beats the OS, otherwise `prefers-color-scheme`. The `change` subscription
is registered always (it re-reads storage), so Auto keeps following the system if the user
switches to it after load.

**`set()` stamps THREE attributes:** `data-darkmode` (which this theme's CSS reads), plus
`data-theme` and `data-bs-theme` as outbound compatibility for third-party apps that sniff
them — `luci-app-justclash` hangs 21 rules on `data-theme`, `ssclash` checks `data-bs-theme`
first. Nothing inside `styles/` may read the latter two. `tools/axes.mjs` holds the set.

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
- Recently visited paths are kept in `localStorage` `fs-recent`, and they are also what
  `warmRecent()` prefetches — see [spa-router.md](spa-router.md).

**Trap it was built around: do not index through `ui.menu.getChildren()`.** On an alias node it
returns a copy whose `children` are the alias *target's*. That is right for drawing a menu and
wrong for indexing: Network → Firewall is an alias onto the `firewall/zones` view, a leaf, so its
five tabs came back as an empty list and "port" found nothing on a router that plainly has a Port
Forwards page. Measured on the dev router: 78 indexed nodes through `getChildren()`, with every tab
of every aliased page missing.

## `fs-select.js`

Turns every stock `<select>` into a styled `ui.Dropdown`, because a native `<select>` popup cannot
be styled with CSS. The native `<select>` remains the form field and must stay
`frameEl.firstChild` — `ui.Select.getValue()` returns `this.node.firstChild.value`.

It also owns `fitTables()`, which folds data tables into cards. Why config tables are handled
differently, and why that difference is not an unfinished job: [css.md](css.md).

## Translation

Every label on the Footstrap tab carries the `footstrap` `msgctxt`; the chrome (Menu, Logout,
Skip to content) and the login/warning strings deliberately do not. The reasoning — `msgid` is a
global name shared with every app on the router — is in [conventions.md](conventions.md).
