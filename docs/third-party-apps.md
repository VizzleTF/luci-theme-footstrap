# Living with third-party `luci-app-*`

What foreign apps actually do to a shared LuCI document, and the rules the theme follows because
of it. Written for someone changing the theme.

**Rules for app authors live in [luci-app-styling-guide.md](luci-app-styling-guide.md)**, the
outward-facing document the README links. Where the two disagree, that one is the source of truth.

> Surveyed July 2026 against sources (GitHub tarballs) and on a live OpenWrt 25.12 router with
> Playwright: 20 apps — 6 proxy stacks (OpenClash, passwall, passwall2, ssr-plus, mosdns, vssr),
> 5 clash/mihomo wrappers (ssclash, podkop, justclash, homeproxy, nikki), 4 heavyweights
> (dockerman, diskman, istore, AdGuardHome) — plus stock `openwrt/luci` apps as a baseline.

## What a foreign app actually does

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

The distinction that matters is not `<style>` vs `<link>` — it is **who can put the CSS back**:

- injected in render (filemanager, podkop): the app will repeat it on the next render;
- injected **at module eval** (ACE, HexEditor, banip, adblock): it will never repeat, because
  the module is cached for the life of the document. Deleting such a sheet breaks the app until a
  page reload.

Separately: a `<style>`/`<link>` **inside the view's tree** (package-manager, nftables, aria2,
v2raya, nlbwmon) is harmless — it dies with the contents of `#view`.

### 2. It sniffs dark mode, in four different dialects

There is no standard, so apps guess:

- **`[data-theme="dark"]` on `:root`** — `luci-app-justclash` (21 rules);
- **`:root[data-darkmode="true"]`** — `luci-app-internet-detector` (and OpenClash writes it);
- **`data-bs-theme`** (a Bootstrap 5 convention) — `luci-app-ssclash` checks it first;
- **the brightness of `getComputedStyle(document.body).backgroundColor`** — ssclash (fallback),
  OpenClash (`isDarkBackground`), passwall (four copies of a YIQ function). OpenClash then **stamps
  `data-darkmode` on our `:root`** itself;
- **`@media (prefers-color-scheme: dark)`** — netspeedtest, vssr, passwall, ustreamer. That is the
  **OS**, not the theme: a user with a dark theme on a light OS gets light cards on a dark page.
  Unfixable in CSS, by construction.

### 3. Everything else that breaks, or could

- **z-index wars**: passwall `2147483647`, OpenClash `999999 !important`, dockerman/diskman
  overlays at `20000`, podkop's toast container at `9999` in `document.body`.
- **Global resets**: OpenClash `*{margin:0;padding:0}` (twice), vssr `@import "pure.css"`.
- **Generic class names claimed**: `.hidden`, `.label`, `.description`, `.centered`, `.skeleton`,
  `.toast`, `.flex-row`, `[hidden]{display:none!important}` (`luci-lib-taskd`).
- **Viewport media queries** (justclash 56rem, podkop 900px, netspeedtest 768px): our content
  column is narrower than the viewport by the sidebar's width, so their "mobile" layout switches on
  later than it should.
- **Hard-coded dark editors**: mosdns and AdGuardHome nail CodeMirror to `dracula`, ssclash nails
  ACE to `tomorrow_night_bright`. The editor stays black on a light page — and on bootstrap too, so
  it is not our regression.
- **Legacy Lua/CBI is still the majority** (OpenClash, passwall(2), ssr-plus, vssr, dockerman,
  diskman, AdGuardHome, istore). Full reload on every click, and all their CSS lives exactly on
  their page.

## The theme's rules

### Rule 1. View CSS is NEVER deleted

Deletion is irreversible: a sheet imported at module eval does not come back. Symptom: a
structureless black ACE and a 2-million-pixel page.

### Rule 2. A document holding an "invasive" sheet hands the next page over by full load

A sheet is invasive if it could paint somebody else's page. Three tests, all on the facts rather
than on a list of names — the set of theme names and custom properties is read out of `cascade.css`
at runtime:

1. **A bare selector** — no class, id or attribute (`pre`, `*`, `svg text`, `div > label + select`).
   It hits stock markup by construction.
   *Exception:* if every declaration is a custom property the theme does not read
   (`:root { --app-temp-status-temp: … }`), there is nothing for it to paint — inert. But
   `:root { color-scheme: light dark }` (stock filemanager) is a standard property, and it re-points
   every UA widget in the document at the OS setting.
2. **A stock name with no pin** — a selector made entirely of names the theme knows
   (`.cbi-button-save`, `.label`, `.error`, `.cbi-input-text`). It has nothing to hold it to the app,
   so it matches the same widgets on every page.
   *Not invasive:* `#cbi-podkop-section > .cbi-section-remove`,
   `.bandix-table th.sortable.active`, `.device-toolbar .cbi-input-select` — the stock class is
   **pinned** by the app's own name and cannot match without its markup. Functional pseudo-class
   arguments are discarded when looking for the pin: `.cbi-button-save:not(.custom-save-button)`
   mentions its own name **inside a negation**, which is an exclusion, not a scope, so the sheet
   stays invasive.
3. **An unreadable sheet** (`<link>` still loading, 404, cross-origin) counts as invasive — the
   conservative answer is slow, not broken.

How that lands on the router's actual apps:

| SPA preserved | Full load on leaving |
|---|---|
| ACE/ssclash (`.ace_*`) | filemanager (`.cbi-button-save:not(…)`) |
| podkop (`#cbi-podkop-*`) | stock openvpn (`h4 { white-space: nowrap }`) |
| bandix tables, hex editor (`.hexview`) | bandix (`.error { … }` — a global class; its own un-removed `<body>` nodes hit the DOM extension below independently, issue #56) |
| the overview CPU include | wrtbwmon (`div > label + select { min-width }`) |
| temp-status: its `:root { --app-* }` | temp-status: its own `svg text { fill }` |

A node parked directly on `document.body` and never removed spends the document the same way,
independently of any of the above: podkop's own toast container (`z-index: 9999`, "Everything else
that breaks, or could" above) means leaving podkop is now a full load too, even though its CSS still
earns it the "SPA preserved" cell in this table. See "Rule 2, extended to the DOM" below.

Implementation: `fs-sheets.js` → `themeNames()`, `inertDeclarations()`, `invasiveSheet()`,
`documentPoisoned()`. It covers both `<style>` and `<link rel=stylesheet>`; `[data-fs-shell]` and
everything inside `#view` are excluded. Full detail: [spa-router.md](spa-router.md).

`fs-sheets.js` also re-declares the layer order as a new `<style>`, first child of `<head>`,
because a foreign sheet landing ahead of `cascade.css` inverts the cascade layers — see
[css.md](css.md).

### Rule 2, extended to the DOM: a document holding a stray body node hands the next page over too

A document can also be poisoned by a NODE instead of a sheet. A script that calls
`document.body.appendChild()` (or `insertBefore`/`replaceChild`/`append`/`prepend`/
`insertAdjacentElement`/`insertAdjacentHTML`) parks an element where no page but the one that put it
there can find it. `luci-app-bandix`'s `render()` does exactly this, unconditionally and on EVERY
visit, for its tooltip and modal nodes — it never checks whether they already exist and never
removes the previous copies (issue #56). Under an SPA navigation those nodes would stay in `<body>`
on the next page, unstyled once `scopeToCurrentPage()` switches off bandix's own `<style>`, and a
return to bandix would duplicate every id.

Nothing is deleted here either, for the reason Rule 1 already gives, whichever shape an app's append
turns out to have: some apps really do append once, at module eval, the same way ACE and HexEditor
inject their CSS once — and a sweep cannot tell those apart from bandix's own per-visit shape without
running every foreign script's logic itself. A node an app's code still expects to find is the same
one-way break Rule 1 describes for a sheet imported once. So the theme reads the same signal it
already reads for CSS — is the document still fit to be swapped out from under the reader — and
answers the same way: decline the SPA navigation, let the browser reload, and the reload starts the
next page with an empty `<body>`.

`fs-router.js`'s `strayBodyNode()`/`bodyLittered()` hold the DOM half. A recorder inline script, the
first byte of `header.ut`'s `<body>` — before this template renders a single chrome element, and long
before the dispatched page's own `<div id="view">` + `L.require('ui').then(instantiateView)`
(`view.ut`, luci-base) or `footer.ut`'s two `L.require(...)` calls — wraps `document.body`'s own
append methods as OWN properties of the `<body>` INSTANCE, never `Node.prototype`. That is also the
whole safety argument for why a browser extension's own content script is unaffected: an
isolated-world script shares the DOM nodes with the page but not the page's own property shadows, so
the wrap set here is invisible to it, and an extension injecting into `<body>` is correctly never
recorded.

A recorded node counts as stray unless it is the theme's own chrome (`[data-fs-chrome]`, an `fs-*` id
or class — `#fs-nav-progress`, `fs-search.js`'s `#fs-search-ov`, and the geometry/colour probes
`fs-chrome.js`/`fs-appearance.js` each park on `<body>` once and never remove), a node type that never
renders (`SCRIPT`/`STYLE`/`LINK`/`TEMPLATE`/`NOSCRIPT`/`META`), or something stock LuCI parks in
`<body>` itself and keeps for the document's life: `ui.js`'s `#modal_overlay` and `.cbi-tooltip` from
its own `__init__`, and the hidden `<a download>` its `handleDownload()` leaves in place after
revoking the object URL. An app that downloads the same way and calls `a.remove()` itself
(filemanager, wireguard, snmpd, …) never reaches the classifier at all — the node is gone from
`<body>` by the time anything asks, and `bodyLittered()` prunes it from the recording rather than
re-judging it on every navigation.

### Rule 3. The only safe deletion is a byte-identical duplicate

`dedupeViewSheets()`. The rules do not disappear (the first copy stays), and a library's "have I
imported this?" check still finds its sheet. Without it, podkop accumulates one `<style>` per visit.
A copy is a duplicate only of one with the SAME owner (the page it arrived for): another app's copy
is disabled on this page, so dropping this page's live copy for it would leave no copy painting.
Unowned copies still collapse.

### Rule 4. Dark mode is announced in three dialects

`data-darkmode` (read only by the theme itself) plus `data-theme` and `data-bs-theme` for outbound
compatibility. `styles/` may never read the latter two — the same boundary as the export tier. The
pre-paint in `head.ut` and the live `stampDark()` must stamp the same set.

### Rule 5. `body` must have an OPAQUE background of the right brightness

This is what every brightness sniffer reads. A transparent `body` (background moved to `:root` or a
pseudo-element) makes OpenClash decide "light" — its `/rgb\(/` regex does not even match
`rgba(0,0,0,0)` — and repaint our dark page in its light palette. It has to hold across the whole
palette × mode × tint matrix.

### Rule 6. The export tier is a contract, and it has to be a ramp

Apps read `--primary-color-*`, `--text-color-*`, `--background-color-*`, `--border-color-*` with a
literal fallback. The export surface is exactly **26 names**, and the warning family is called
**`warn`**: `--warn-color-high/-medium/-low` and `--on-warn-color`.

Two findings that look alike:

- **podkop's `var(--warn-color-medium, orange)` (7 uses) WORKS.** The name is correct and resolves
  to the theme's ochre. There is no `--warning-color-*` anywhere in the tree, so "fixing" podkop to
  use that would drop all seven declarations into the `orange` fallback.
- **justclash's `var(--text-color, inherit)` (6 uses) is a real typo.** There is no level in the
  name and no such property; the correct one is `--text-color-high`. Do not invent `--text-color`
  on our side: that fixes somebody's typo at the price of a name we would then support forever.

The private `--fs-*` tier (~130 properties) is not part of the contract and is not addressed to
apps — which is exactly why it is separated. See [design-system.md](design-system.md).

### Rule 7. The chrome is fenced off, in three places that must agree

An app's unlayered `!important` outranks every cascade layer, so the chrome cannot be defended by
the cascade. It is defended by not matching, in three places, and the three must agree. Nothing in
the build notices when they do not.

1. **`header.ut` — the markup.** A chrome root marks itself with `data-fs-chrome`. The `<nav>`
   is one; so are the skip link, the two sr-only elements and the command palette, none of which sits
   inside it. The
   mark is what the other two read.
2. **`fs-sheets.js` — the fence.** `CHROME_FENCE` is appended to a foreign selector's subject so it
   can no longer match a chrome element. That is what beats a third party's `!important`: there
   is nothing left to outrank.
3. **`theme/10-chrome.css` — the pin.** It closes the one way in a fence cannot: inheritance
   from `html`/`body`, where no match is needed at all. It restates exactly the inherited
   properties the chrome does not already declare itself.

The mark lives in `header.ut`; rename it there and the two copies still saying the old name are
wrong. That failure has no symptom — the fence silently stops fencing, nothing on screen changes,
and the menu breaks on someone else's router months later.

The fence and the pin are each **one canonical string**, to be read whole rather than for tokens:
`:where(:not(.fs-sidebar), .fs-sidebar *)` has all the right tokens and is the exact **inverse** of
a fence, targeting the chrome instead of sparing it.

The shapes both strings encode, each a measured bug:

- **`:where()` in both**, because it contributes zero specificity. Drop it from the fence and every
  app rule silently gains a point, re-ordering the app's stylesheet against itself on its own page.
  Drop it from the pin and the pin starts fighting the chrome's own rules on source order.
- **The fence must cover the root AND its subtree** (`[m], [m] *`); the root alone leaves every menu
  element inside it exposed.
- **The pin must cover the root ALONE**, and it says so itself (`:not([m] *)`) rather than trusting
  that nobody ever nests a mark. Pinning descendants breaks the chrome's own inheritance — a direct
  declaration beats an inherited one even when the inherited one is ours, costing `.fs-label` its
  `nowrap` and forcing `text-align` from `start` to `left`, which breaks every RTL language LuCI ships.
- **The pin may carry only inherited properties.** A non-inherited one there is a style decision
  wearing a guard's coat, and at zero specificity it would lose to everything anyway.

**The fence is CSSOM surgery, not a CSS parser** — which is what makes an app written in modern CSS
a non-event rather than the next round of cat-and-mouse. Every selector the fence reads comes out of
the browser's own parser (`CSSStyleRule.selectorText`), and every one it writes goes back in through
the same parser's setter, which is atomic: a selector it cannot parse leaves the rule exactly where
it was. The only text this file ever scans is one already-serialised selector, and only to answer
two questions on it — where the top-level commas are, and where the `::` is. Nesting, `:has()`,
`:is()`, `@scope`, `@container` and an app's own `@layer` are the parser's problem, not ours; the
recursion that reaches them (`r.cssRules`) is three lines and does not care which at-rule it just
descended into.

- **A nested rule under a pinned parent is fenced too, redundantly.** `#app-x .thing { &:hover { … } }`
  comes back as `&:hover:where(:not([data-fs-chrome], …))` — `&:hover` names nothing the theme does
  not know, so it reads as unpinned on its own. It costs nothing (the `&` still requires `#app-x`,
  which can never be chrome, and `:where()` adds no specificity) and the safe default is the right
  one: a nested rule whose parent is itself unpinned MUST be fenced, and from inside `fenceRules()`
  the two cases look the same. Every other shape round-trips byte-identical.
- **The gap the fence does not cover is time, not syntax.** A sheet that lands before `fs-sheets.js`
  has loaded and started watching `<head>` paints unfenced until then. It affects only the page you
  are on, and it is not fixable from a module that has to be fetched.
- **`@import` is followed.** `fenceRules()` descends into `CSSImportRule.styleSheet`, so
  `* { padding: 0 !important }` imported by an app's `<style>` is fenced like its own rules. A
  re-hosted `<link>`'s import is fenced on the shim's `load` event (readable then in Chromium,
  Firefox and WebKit), not on a frame deadline; an import still loading when a `<style>` is
  re-hosted stays unfenced on its own page in all three engines and is switched off on others. The
  shim appends the link's `media` after `layer(theme)`. A `rel=alternate` or `disabled` link is
  skipped but watched: its `rel`/`disabled` change re-runs the passes, because enabling adds no node
  (an attribute observer sees a child only if it is the target; `subtree` on `<body>` would fire on
  every button LuCI's poll disables). Firefox keeps one shim per href on a re-added link.

The dark-mode guard must match `stampDark` the same way: that guard exists because third parties
write the attributes this theme publishes (`luci-app-openclash` does it in seven templates). Add a
fourth dialect to `stampDark` and forget the observer's `attributeFilter`, and that dialect is
unguarded — silently.

### Rule 8. A foreign table is claimed by its HEADER ROW, not by its class

`.table` is LuCI's class, and every table rule the theme has hangs off it — the frame, the cell
padding, the measured card stack. An app that emits a bare `<table>` matches none of it, so untagged
and unmeasured, `.fs-main`'s `overflow-x: clip` would silently cut its right-hand columns.
`tagDataTables()` takes
any table under a content root — `#view` or the `#modal_overlay` an app's dialog is built in — that
has a header row in any of four markups, adds `.table.fs-dt`, and copies the
column headings into `data-title` so the card has something to print. A table with **no** header row
is left alone on purpose and scrolls: see [css.md](css.md#which-of-the-three-a-table-gets-and-what-decides-it).

**The claim is re-made on every fit pass, not once per element.** These tables are polled: the app
replaces the rows inside the element it already has, so a claim that ran once would leave every batch
after it without `.tr`/`.td` and without a caption — on a table that may by then be carding, where the
fresh rows fall out of the card layout uncaptioned. Both
halves are additive, and the one JUDGEMENT — "does this table speak LuCI's row vocabulary, or is it
ours to rewrite?" — is still taken once, at claim time, and remembered on the element, so LuCI's own
markup is never rewritten by a later pass.

**Each half answers the common case before it walks anything**, because a fit pass is a mutation
pass, not a once-a-second one. The adoption returns on its memo. The captioning skips **per row**:
a row whose first cell already carries a caption has been walked, so on everything LuCI renders —
where `ui.Table` writes `data-title` as it builds — the pass costs one attribute read per row and
nothing else.

The question is asked of the ROW because no single row speaks for the table. A table-level probe has
to pick one, and every choice is wrong for some shape: asking the last row stalls forever on a
`<tfoot>` of per-column totals, which takes captions on the first pass and is never bare again while
a poll keeps replacing the `<tbody>` above it, so the fresh rows come back with no caption. Per row there is nothing to guess, and cells replaced inside a
surviving row arrive bare and are walked like any other.

No app surveyed here emits a bare table; the rule exists for the ones that do, which is what the
coverage contract means ([conventions.md](conventions.md)). `<thead><tr><th>` and `<tr><th>` both
card with the right captions; a header-less matrix stays a scrolling matrix.

### Rule 9. A table inside the app's OWN scroller is the app's business

The fit pass cards a data table when it needs more width than it has been given. Inside a box the
app scrolls itself, that question has already been answered by somebody else, and every answer the
ladder can give overrules it: within a 598px box a wide table overflows by definition, so the
remedy ends in a card stack however much room the page has around it.

`luci-app-filemanager` parks its listing in `#file-list-container.resizeable` (`resize: both;
overflow: auto`, and no width of its own): without this rule the listing comes out as cards on a
1280px screen with plenty of column beside it.

`fit.inScroller()` walks from the table to the content root and answers whether any ancestor scrolls
horizontally; `fs-select.js` asks BEFORE it applies the slot's remembered answer, so a table carded
by an older build is un-carded rather than carded again. The walk stops at `#view` and
`#modal_overlay` on purpose: the dialog's own scroller is the theme's (`base/60-modal.css`), and the
scroll fallback the theme gives a foreign table is on the TABLE itself (`theme/30-tables.css`), not
on an ancestor — neither may switch this rule on for everything.

No stock page has a data table inside a scroller of its own.

### What the theme cannot do, and should not try

- `@media (prefers-color-scheme)` in an app's CSS is overridden by nothing — it is an OS setting.
  The only mitigation is that our default is Auto, which follows the OS.
- Hard-coded literals (`background: white` on a passwall modal, justclash's `#1e1e1e` terminal, 167
  colours baked into `luci-app-statistics` PNGs) are not our bytes.
- An app's z-index on its own page is its own page.
- An app's viewport media queries do not know about our sidebar.

**And what the claim buys it.** A claimed table is measured like any other data table,
which means it gets the whole ladder: honest column floors while it is a table, the expendable
columns (`hide-xs`/`hide-sm`) dropped by measurement rather than at 767px, one column allowed to
shred before the table gives up on being a table, and the card as the last rung. A table that has
**no** header row is never claimed — it cannot card, because a card prints `data-title` and it has
none — and instead scrolls inside itself if it is measured to overflow, with its first column
pinned, a tab stop and an accessible name.

**A foreign table that holds a widget is refused the scroll**, and an app author should know why:
`overflow-x: auto` computes `overflow-y` to `auto` as well (css-overflow-3 §3.1), so a scrolling
table clips every absolutely positioned thing inside it, and `luci-base`'s `openDropdown()` sizes an
open list against the nearest scroll parent — which would be the table. If your table holds a
`ui.Dropdown`, a dynlist or a tooltip container, the theme leaves it alone rather than break the
control.

## How to check

On a live router, the scenario that would catch everything above:

1. open an app with ACE/CodeMirror (ssclash) → SPA to a neighbouring tab → back. The editor must
   still be alive (rule 1);
2. open File Manager → go to System. Save/Apply/Reset must still be there (rule 2);
3. visit podkop three times over SPA. The number of `<style>` elements in `<head>` must not grow
   (rule 3);
4. justclash in dark mode: its `[data-theme="dark"]` rules must match (rule 4).
