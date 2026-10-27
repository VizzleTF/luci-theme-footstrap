# Living with third-party `luci-app-*`

What foreign apps do to a shared LuCI document, and the rules the theme follows because of it.
Written for someone changing the theme.

Rules for app authors live in [luci-app-styling-guide.md](luci-app-styling-guide.md). Where the two
disagree, that one is the source of truth.

## What a foreign app does

### 1. It injects CSS into `<head>`, and that survives an SPA navigation

A full page load throws such a `<style>` away with the document, so the app is right to treat it as
"mine for one page". Our router does not reload the document, and the CSS stays forever.

| App | What it puts in `<head>` | When |
|---|---|---|
| `luci-app-filemanager` (stock) | `.cbi-button-save/-apply/-reset { display:none !important }`; the sbwml fork adds bare `th`/`td`/`tr:hover`/`.table` | every render |
| `luci-app-filemanager` (newer) | `:root { color-scheme: light dark; --light-bg:… }` | every render |
| `HexEditor.js` (same package) | `:root { --clr-background:… }` | **module eval** |
| `luci-app-banip`, `luci-app-adblock` | a `<link>` to `custom.css` styling `.cbi-input-text`, `.cbi-input-select` | **module eval** |
| `luci-app-olsr-viz` | `.label { color:black; background:white }` | every render |
| `luci-app-openvpn` (stock) | `h4 { white-space:nowrap; … }` | every render |
| `luci-app-podkop` | 4 KB: `#cbi-podkop-*`, `.centered`, `.rotate`, `.skeleton`, `.toast*` | **every render, no dedup** |
| `luci-app-mosdns` | three `<link>`s to CodeMirror 5 | every render |
| ACE (`luci-app-ssclash` and anyone shipping `ace.js`) | `ace_editor.css` (14 KB), `error_marker.css` | **module eval** |

What matters is who can put the CSS back:

- CSS injected in render (filemanager, podkop) comes back on the next render.
- CSS injected at module eval (ACE, HexEditor, banip, adblock) never comes back, because the module
  is cached for the life of the document. Deleting such a sheet breaks the app until a page reload.

A `<style>`/`<link>` inside the view's tree (package-manager, nftables, aria2, v2raya, nlbwmon) is
harmless. It dies with the contents of `#view`.

### 2. It sniffs dark mode, in four different dialects

There is no standard, so apps guess:

- `[data-theme="dark"]` on `:root`: `luci-app-justclash` (21 rules).
- `:root[data-darkmode="true"]`: `luci-app-internet-detector`. OpenClash writes it.
- `data-bs-theme`, a Bootstrap 5 convention: `luci-app-ssclash` checks it first.
- The brightness of `getComputedStyle(document.body).backgroundColor`: ssclash (fallback), OpenClash
  (`isDarkBackground`), passwall (four copies of a YIQ function). OpenClash then stamps
  `data-darkmode` on our `:root` itself.
- `@media (prefers-color-scheme: dark)`: netspeedtest, vssr, passwall, ustreamer. That is the OS, not
  the theme. A user with a dark theme on a light OS gets light cards on a dark page. No CSS can fix
  this.

### 3. Everything else that breaks, or could

- z-index wars: passwall `2147483647`, OpenClash `999999 !important`, dockerman/diskman overlays at
  `20000`, podkop's toast container at `9999` in `document.body`.
- Global resets: OpenClash `*{margin:0;padding:0}` (twice), vssr `@import "pure.css"`.
- Generic class names claimed: `.hidden`, `.label`, `.description`, `.centered`, `.skeleton`,
  `.toast`, `.flex-row`, `[hidden]{display:none!important}` (`luci-lib-taskd`).
- Viewport media queries (justclash 56rem, podkop 900px, netspeedtest 768px). Our content column is
  narrower than the viewport by the sidebar's width, so their "mobile" layout switches on too late.
- Hard-coded dark editors: mosdns and AdGuardHome pin CodeMirror to `dracula`, ssclash pins ACE to
  `tomorrow_night_bright`. The editor stays black on a light page, on bootstrap too.
- Legacy Lua/CBI apps (OpenClash, passwall(2), ssr-plus, vssr, dockerman, diskman, AdGuardHome,
  istore) reload the page on every click, so all their CSS lives on their own page.

## The theme's rules

### Rule 1. View CSS is NEVER deleted

Deletion is irreversible: a sheet imported at module eval does not come back. Symptom: a
structureless black ACE and a 2-million-pixel page.

### Rule 2. A document holding an "invasive" sheet hands the next page over by full load

A sheet is invasive if it could paint somebody else's page. There are three tests. They check the
selector, not a list of app names. The set of theme names and custom properties is read out of
`cascade.css` at runtime.

1. A bare selector: no class, id or attribute (`pre`, `*`, `svg text`, `div > label + select`). It
   hits stock markup by construction.
   Exception: a rule whose every declaration is a custom property the theme does not read
   (`:root { --app-temp-status-temp: … }`) paints nothing and is inert. `:root { color-scheme: light
   dark }` (stock filemanager) is a standard property and re-points every UA widget at the OS
   setting, so it is invasive.
2. A stock name with no pin: a selector made only of names the theme knows (`.cbi-button-save`,
   `.label`, `.error`, `.cbi-input-text`). Nothing ties it to the app, so it matches the same widgets
   on every page.
   Not invasive: `#cbi-podkop-section > .cbi-section-remove`, `.bandix-table th.sortable.active`,
   `.device-toolbar .cbi-input-select`. The app's own name pins the stock class to the app's markup.
   Functional pseudo-class arguments do not count as a pin:
   `.cbi-button-save:not(.custom-save-button)` names the app inside a negation, which excludes
   rather than scopes, so the sheet stays invasive.
3. An unreadable sheet (`<link>` still loading, 404, cross-origin) counts as invasive. The
   conservative answer is slow, not broken.

How that lands on real apps:

| SPA preserved | Full load on leaving |
|---|---|
| ACE/ssclash (`.ace_*`) | filemanager (`.cbi-button-save:not(…)`) |
| podkop CSS (`#cbi-podkop-*`) | stock openvpn (`h4 { white-space: nowrap }`) |
| bandix tables, hex editor (`.hexview`) | bandix (`.error { … }`, a global class) |
| the overview CPU include | wrtbwmon (`div > label + select { min-width }`) |
| temp-status: its `:root { --app-* }` | temp-status: its own `svg text { fill }` |

Implementation: `fs-sheets.js` → `themeNames()`, `inertDeclarations()`, `invasiveSheet()`,
`documentPoisoned()`. It covers both `<style>` and `<link rel=stylesheet>`. `[data-fs-shell]` and
everything inside `#view` are excluded. Details: [spa-router.md](spa-router.md#foreign-view-css-a-gate-not-a-sweep).

`fs-sheets.js` also re-declares the layer order as a new `<style>`, first child of `<head>`,
because a foreign sheet landing ahead of `cascade.css` inverts the cascade layers. See
[css.md](css.md).

### Rule 2, extended to the DOM: a document holding a stray body node hands the next page over too

A node a script parks directly on `<body>` and never removes poisons the document the same way.
`luci-app-bandix`'s `render()` appends its tooltip and modal nodes on every visit and never removes
the old ones (issue #56). podkop's toast container leaks the same way. Leaving podkop is therefore a
full load, even though its CSS passes Rule 2.

Nothing is swept, for Rule 1's reason: a node an app still expects to find is a one-way break. The
router declines the SPA navigation instead, and the reload starts the next page with an empty
`<body>`.

An inline recorder, the first `<script>` in `header.ut`'s `<body>`, wraps `document.body`'s own
append methods as properties of the instance, never `Node.prototype`. An extension's isolated-world
content script therefore is never recorded. `fs-router.js`'s `strayBodyNode()` judges each recorded
node and `bodyLittered()` counts what is still attached. A recorded node is not stray if it is:

- the theme's own: `[data-fs-chrome]`, or an `fs-*` id or class;
- a node type that never renders: `SCRIPT`, `STYLE`, `LINK`, `TEMPLATE`, `NOSCRIPT`, `META`;
- stock LuCI's own: `#modal_overlay`, `.cbi-tooltip`, and the hidden `<a download>` that
  `handleDownload()` leaves behind.

A node the app removes itself is pruned from the recording. Details:
[spa-router.md](spa-router.md#foreign-view-dom-recorded-not-swept).

### Rule 3. The only safe deletion is a byte-identical duplicate

`dedupeViewSheets()`. The rules do not disappear (the first copy stays), and a library's "have I
imported this?" check still finds its sheet. Without it, podkop accumulates one `<style>` per visit.
A copy is a duplicate only of one with the same owner, the page it arrived for. Another app's copy is
disabled on this page, so dropping this page's live copy in its favour would leave no copy painting.
Unowned copies still collapse.

### Rule 4. Dark mode is announced in three dialects

`data-darkmode` (read only by the theme itself) plus `data-theme` and `data-bs-theme` for outbound
compatibility. `styles/` may never read the latter two, the same boundary as the export tier. Three
places must list the same set: the pre-paint in `head.ut`, `stampDark()` in `fs-prefs.js`, and the
`attributeFilter` of the guard observer next to it. The guard exists because third parties write
these attributes (OpenClash). A dialect added to `stampDark()` but not to the filter is silently
unguarded.

### Rule 5. `body` must have an OPAQUE background of the right brightness

This is what every brightness sniffer reads. A transparent `body` (background moved to `:root` or a
pseudo-element) makes OpenClash decide "light", because its `/rgb\(/` regex does not even match
`rgba(0,0,0,0)`. It then repaints our dark page in its light palette. This must hold across the whole
palette × mode × tint matrix.

### Rule 6. The export tier is a contract

Apps read the 26 `--*-color-*` names with a literal fallback. The list, and the names that do not
exist, are in [luci-app-styling-guide.md §3.1](luci-app-styling-guide.md#31-the-export-surface-is-exactly-26-names-and-it-is-colour-only).
Do not add a name to fix an app's typo, such as justclash's `--text-color`: we would support it
forever. The private `--fs-*` tier is not part of the contract. See
[design-system.md](design-system.md).

The surface and rule names turn translucent while the Card opacity axis is below 100% (see
[design-system.md](design-system.md#transparency-cards-and-the-menu-over-the-wallpaper)). An app
popup painted with `--background-color-high` turns translucent with them; the theme's own floating
surfaces take the solid palette back.

### Rule 7. The chrome is fenced off, in three places that must agree

A sheet whose every selector is pinned to the app's own names stays unlayered, and its
`!important` outranks every cascade layer. `fs-sheets.js` re-hosts any other sheet into
`@layer theme`, where an `!important` still beats every normal declaration. So the cascade cannot
defend the chrome. The chrome is defended by not matching, in three places. Nothing in the build checks that
they agree.

1. `header.ut`, the mark. A chrome root carries `data-fs-chrome`: e.g. the `<nav>`, `.fs-pattern`,
   the skip link and the sr-only elements. The command palette overlay (`fs-search.js`) carries it
   too. The other two places read this mark.
2. `fs-sheets.js`, the fence. `CHROME_FENCE` is appended to a foreign selector's subject so it can no
   longer match a chrome element. Nothing is left to outrank.
3. `theme/10-chrome.css`, the pin. It closes the one way in a fence cannot: inheritance from
   `html`/`body`.

Invariants:

- Rename the mark in `header.ut` and update the other two. Otherwise the fence silently stops
  fencing and nothing on screen changes.
- Both strings use `:where()`, so they add zero specificity.
- The fence covers the root and its subtree (`[m], [m] *`).
- The pin covers the root alone (`:not([m] *)`) and carries only inherited properties. Pinning
  descendants breaks the chrome's own inheritance (`.fs-label` loses `nowrap`, `text-align` becomes
  `left` and breaks RTL).
- Read each string whole. `:where(:not(.fs-sidebar), .fs-sidebar *)` has all the right tokens and is
  the inverse of a fence.

The fence uses the browser's own CSS parser. It reads `CSSStyleRule.selectorText` and writes back
through the same setter, which leaves a selector it cannot parse unchanged. Nesting, `:has()`,
`@scope`, `@container` and an app's own `@layer` need no special handling. Known limits:

- A nested rule under a pinned parent is fenced too. That is redundant and harmless.
- A sheet that lands before `fs-sheets.js` has loaded paints unfenced until then, on that page only.
- `@import` is followed. A re-hosted `<link>`'s import is fenced on the shim's `load` event. An import
  still loading when a `<style>` is re-hosted stays unfenced on its own page.

### Rule 8. A foreign table is claimed by its HEADER ROW, not by its class

`.table` is LuCI's class, and every table rule the theme has hangs off it. An app that emits a bare
`<table>` matches none of it, so `.fs-main`'s `overflow-x: clip` would cut its right-hand columns.
`tagDataTables()` takes any table under a content root (`#view` or `#modal_overlay`) that has a
header row, adds `.table.fs-dt`, and copies the column headings into `data-title`. A table with no
header row is left alone and scrolls. What each kind of table gets:
[css.md](css.md#which-of-the-three-a-table-gets-and-what-decides-it).

The claim is re-made on every fit pass ([the ladder](css.md#the-ladder-what-happens-when-a-table-does-not-fit)). These tables are polled: the app replaces the rows inside the
same element, and fresh rows need `.tr`/`.td` and captions again. The one judgement, "does this table
speak LuCI's row vocabulary?", is taken once and remembered on the element, so LuCI's own markup is
never rewritten.

### Rule 9. A table inside the app's OWN scroller is the app's business

The fit pass cards a data table when it needs more width than it has. Inside a box the app scrolls
itself, a wide table overflows by definition, so the ladder would always end in cards.
`luci-app-filemanager` parks its listing in `#file-list-container.resizeable` (`resize: both;
overflow: auto`): without this rule the listing comes out as cards on a 1280px screen.

`fit.inScroller()` walks from the table to the content root and answers whether any ancestor scrolls
horizontally. `fs-select.js` asks before it applies the slot's remembered answer, so a table carded
by an older build is un-carded. The walk stops at `#view` and `#modal_overlay`: the dialog's scroller
(`base/60-modal.css`) and the scroll fallback on the table itself (`theme/30-tables.css`) are the
theme's, and neither may switch this rule on.

### What the theme cannot do, and should not try

- `@media (prefers-color-scheme)` in an app's CSS follows the OS. The only mitigation is that our
  default is Auto, which follows the OS too.
- Hard-coded literals (`background: white` on a passwall modal, justclash's `#1e1e1e` terminal,
  colours baked into `luci-app-statistics` PNGs) are not our bytes.
- An app's z-index on its own page is its own business.
- An app's viewport media queries do not know about our sidebar.

## How to check

On a live router:

1. Open an app with ACE/CodeMirror (ssclash), SPA to a neighbouring tab, go back. The editor must
   still work (Rule 1).
2. Open File Manager, go to System. Save/Apply/Reset must still be there (Rule 2).
3. Visit podkop three times over SPA. The number of `<style>` elements in `<head>` must not grow
   (Rule 3).
4. Open justclash in dark mode. Its `[data-theme="dark"]` rules must match (Rule 4).

A layout defect on one app's page is fixed in the shared rule for that shape, in `styles/theme/`,
so every app with the same shape gets the fix. The theme carries no per-app selectors:
`styles/pages/` holds stock pages only, and another package's namespace is off limits
([conventions.md](conventions.md)). To name the page in a report, read the `data-page` attribute of
`#view` in devtools.
