# Living with third-party `luci-app-*`

What foreign apps do to a shared LuCI document, and the rules the theme follows because of it.
Written for someone changing the theme.
The main rule: the theme never deletes an app's CSS or DOM; it hands the next page over by full load instead.

That full load is intended behaviour, not breakage. The user waits for one ordinary page load, and
every app keeps working.

Rules for app authors live in [luci-app-styling-guide.md](luci-app-styling-guide.md). Where the two
disagree, that one is the source of truth.

## Short version

1. Never delete view CSS. A sheet imported at module eval never comes back (Rule 1).
2. A document holding an invasive sheet or a stray `<body>` node hands the next page over by full
   load (Rule 2).
3. The only safe deletion is a byte-identical duplicate (Rule 3).
4. Announce dark mode in three dialects, and keep `body` opaque at the right brightness (Rules 4, 5).
5. The 26 export names are a contract; the chrome is fenced off in three places that must agree
   (Rules 6, 7).
6. A foreign table is claimed by its header row; a table in the app's own scroller is left alone
   (Rules 8, 9).
7. Fix a layout defect in the shared rule for its shape in `styles/theme/`, never per app.

## Contents

- [Triage: theme or app?](#triage-theme-or-app)
- [What a foreign app does](#what-a-foreign-app-does)
- [The theme's rules](#the-themes-rules)
- [What the theme cannot do, and should not try](#what-the-theme-cannot-do-and-should-not-try)
- [How to check](#how-to-check)

## Triage: theme or app?

Find the symptom, then read the rule. The "Whose" column takes one of three values:

| Value | Meaning |
|---|---|
| theme | A bug to fix in this repo. |
| app | The app breaks a rule in [luci-app-styling-guide.md](luci-app-styling-guide.md). The theme does not patch it. |
| intended | The theme works as designed. The cause is an app breaking the styling guide, and the theme's answer is a full load. |

| Symptom | Rule | Whose | Fix |
|---|---|---|---|
| Leaving an app's page is a full page load, not an SPA navigation | [Rule 2](#rule-2-a-document-holding-an-invasive-sheet-hands-the-next-page-over-by-full-load) and [its DOM extension](#rule-2-extended-to-the-dom-a-document-holding-a-stray-body-node-hands-the-next-page-over-too) | intended | None in the theme. The app can keep SPA by scoping its CSS and removing its `<body>` nodes. To find the trigger, see [Find what forced a full load](#find-what-forced-a-full-load). |
| An editor (ACE, CodeMirror) loses its styles after SPA away and back | [Rule 1](#rule-1-view-css-is-never-deleted) | theme | Something deleted a view sheet. Stop deleting it. |
| Stock Save/Apply/Reset vanish on other pages after File Manager | [Rule 2](#rule-2-a-document-holding-an-invasive-sheet-hands-the-next-page-over-by-full-load) | theme | The invasive-sheet test missed the sheet. Fix `invasiveSheet()` in `fs-sheets.js`. |
| `<style>` elements in `<head>` grow with every visit | [Rule 3](#rule-3-the-only-safe-deletion-is-a-byte-identical-duplicate) | theme | Fix `dedupeViewSheets()`. |
| An app's attribute-keyed dark rules do not match | [Rule 4](#rule-4-dark-mode-is-announced-in-three-dialects) | theme | Keep the three places that stamp the dialects in sync. |
| An app keyed on `prefers-color-scheme` shows light cards on a dark page | [What the theme cannot do](#what-the-theme-cannot-do-and-should-not-try) | app | None in the theme. |
| OpenClash repaints a dark page in its light palette | [Rule 5](#rule-5-body-must-have-an-opaque-background-of-the-right-brightness) | theme | Make `body`'s background opaque again. |
| An app colour falls back to its literal (`--text-color`, `--warning-color-*`) | [Rule 6](#rule-6-the-export-tier-is-a-contract) | app | None in the theme: do not add the name. |
| An app's CSS restyles the sidebar, menu or other chrome | [Rule 7](#rule-7-the-chrome-is-fenced-off-in-three-places-that-must-agree) | theme | Check that the mark, the fence and the pin agree. |
| A bare `<table>` loses its right-hand columns | [Rule 8](#rule-8-a-foreign-table-is-claimed-by-its-header-row-not-by-its-class) | theme | Check `tagDataTables()`. |
| A table inside the app's own scroller comes out as cards | [Rule 9](#rule-9-a-table-inside-the-apps-own-scroller-is-the-apps-business) | theme | Check `fit.inScroller()`. |
| z-index clashes, a late "mobile" layout, hard-coded colours | [What the theme cannot do](#what-the-theme-cannot-do-and-should-not-try) | app | None in the theme. |

## What a foreign app does

### It injects CSS into `<head>`, and that survives an SPA navigation

A full page load throws such a `<style>` away with the document. So the app is right to treat it as
"mine for one page".

Our router does not reload the document, and the CSS stays forever.

| App | What it puts in `<head>` | When |
|---|---|---|
| `luci-app-filemanager` (stock) | `.cbi-button-save/-apply/-reset { display:none !important }`; the sbwml fork adds bare `th`/`td`/`tr:hover`/`.table` | every render |
| `luci-app-filemanager` (newer) | `:root { color-scheme: light dark; --light-bg:… }` | every render |
| `HexEditor.js` (same package) | `:root { --clr-background:… }` | module eval |
| `luci-app-banip`, `luci-app-adblock` | a `<link>` to `custom.css` styling `.cbi-input-text`, `.cbi-input-select` | module eval |
| `luci-app-olsr-viz` | `.label { color:black; background:white }` | every render |
| `luci-app-openvpn` (stock) | `h4 { white-space:nowrap; … }` | every render |
| `luci-app-podkop` | 4 KB: `#cbi-podkop-*`, `.centered`, `.rotate`, `.skeleton`, `.toast*` | every render, no dedup |
| `luci-app-mosdns` | three `<link>`s to CodeMirror 5 | every render |
| ACE (`luci-app-ssclash` and anyone shipping `ace.js`) | `ace_editor.css` (14 KB), `error_marker.css` | module eval |

What matters is who can put the CSS back:

| Injected at | Apps | After deletion |
|---|---|---|
| render | filemanager, podkop | comes back on the next render |
| module eval | ACE, HexEditor, banip, adblock | never comes back: the module is cached for the life of the document, so the app breaks until a page reload |

A `<style>`/`<link>` inside the view's tree is harmless: it dies with the contents of `#view`.
package-manager, nftables, aria2, v2raya and nlbwmon do this.

### It sniffs dark mode, in five different ways

There is no standard, so apps guess. Three ways read an attribute on `:root`, one reads the
brightness of `body`, and one reads the OS:

| Signal | Apps |
|---|---|
| `[data-theme="dark"]` on `:root` | `luci-app-justclash` (21 rules) |
| `:root[data-darkmode="true"]` | `luci-app-internet-detector`; OpenClash writes it |
| `data-bs-theme`, a Bootstrap 5 convention | `luci-app-ssclash` checks it first |
| The brightness of `getComputedStyle(document.body).backgroundColor` | ssclash (fallback), OpenClash (`isDarkBackground`), passwall (four copies of a YIQ function) |
| `@media (prefers-color-scheme: dark)` | netspeedtest, vssr, passwall, ustreamer |

OpenClash then stamps `data-darkmode` on our `:root` itself.

`prefers-color-scheme` is the OS, not the theme. A user with a dark theme on a light OS gets light
cards on a dark page. No CSS can fix this.

### Everything else that breaks, or could

| Problem | Examples |
|---|---|
| z-index wars | passwall `2147483647`, OpenClash `999999 !important`, dockerman/diskman overlays at `20000`, podkop's toast container at `9999` in `document.body` |
| Global resets | OpenClash `*{margin:0;padding:0}` (twice), vssr `@import "pure.css"` |
| Generic class names claimed | `.hidden`, `.label`, `.description`, `.centered`, `.skeleton`, `.toast`, `.flex-row`, `[hidden]{display:none!important}` (`luci-lib-taskd`) |
| Viewport media queries | justclash 56rem, podkop 900px, netspeedtest 768px |
| Hard-coded dark editors | mosdns and AdGuardHome pin CodeMirror to `dracula`; ssclash pins ACE to `tomorrow_night_bright` |
| Legacy Lua/CBI apps | OpenClash, passwall(2), ssr-plus, vssr, dockerman, diskman, AdGuardHome, istore |

Our content column is narrower than the viewport by the sidebar's width. So a viewport query's
"mobile" layout switches on too late.

A hard-coded dark editor stays black on a light page, on bootstrap too.

Legacy Lua/CBI apps reload the page on every click. So all their CSS lives on their own page.

## The theme's rules

### Rule 1. View CSS is NEVER deleted

Why: deletion is irreversible, because a sheet imported at module eval does not come back.

Symptom when broken: a structureless black ACE and a 2-million-pixel page.

### Rule 2. A document holding an "invasive" sheet hands the next page over by full load

Why: an invasive sheet could paint somebody else's page, and deleting it is ruled out by Rule 1.

There are three tests. They check the selector, not a list of app names. The set of theme names and
custom properties is read out of `cascade.css` at runtime.

1. A bare selector: no class, id or attribute (`pre`, `*`, `svg text`, `div > label + select`). It
   hits stock markup by construction.
   - Exception: a rule whose every declaration is a custom property the theme does not read is
     inert. `:root { --app-temp-status-temp: … }` paints nothing.
   - Not an exception: `:root { color-scheme: light dark }` (stock filemanager). It is a standard
     property and re-points every UA widget at the OS setting, so it is invasive.
2. A stock name with no pin: a selector made only of names the theme knows (`.cbi-button-save`,
   `.label`, `.error`, `.cbi-input-text`). Nothing ties it to the app, so it matches the same widgets
   on every page.
   - Not invasive: `#cbi-podkop-section > .cbi-section-remove`, `.bandix-table th.sortable.active`,
     `.device-toolbar .cbi-input-select`. The app's own name pins the stock class to the app's markup.
   - Functional pseudo-class arguments do not count as a pin.
     `.cbi-button-save:not(.custom-save-button)` names the app inside a negation. That excludes
     rather than scopes, so the sheet stays invasive.
3. An unreadable sheet (`<link>` still loading, 404, cross-origin) counts as invasive. The
   conservative answer is slow, not broken.
   - A 404 or a cross-origin sheet is the app's problem. A `<link>` still loading is transient.
   - The user sees one ordinary full page load on leaving that page. The theme still works.

How that lands on real apps:

| SPA preserved | Full load on leaving |
|---|---|
| ACE/ssclash (`.ace_*`) | filemanager (`.cbi-button-save:not(…)`) |
| podkop CSS (`#cbi-podkop-*`) | stock openvpn (`h4 { white-space: nowrap }`) |
| bandix tables, hex editor (`.hexview`) | bandix (`.error { … }`, a global class) |
| the overview CPU include | wrtbwmon (`div > label + select { min-width }`) |
| temp-status: its `:root { --app-* }` | temp-status: its own `svg text { fill }` |

Implementation: `fs-sheets.js` → `themeNames()`, `inertDeclarations()`, `invasiveSheet()`,
`documentPoisoned()`.

- It covers both `<style>` and `<link rel=stylesheet>`.
- `[data-fs-shell]` and everything inside `#view` are excluded.
- Details: [spa-router.md](spa-router.md#foreign-view-css-a-gate-not-a-sweep).

`fs-sheets.js` also re-declares the layer order as a new `<style>`, first child of `<head>`. A
foreign sheet landing ahead of `cascade.css` inverts the cascade layers. See [css.md](css.md).

### Rule 2, extended to the DOM: a document holding a stray body node hands the next page over too

Why: a node a script parks directly on `<body>` and never removes poisons the document the same way.

`luci-app-bandix`'s `render()` appends its tooltip and modal nodes on every visit. It never removes
the old ones.

Issue #56 in this repo reported the result: 7 nodes per visit left unstyled under the next page's
footer, growing the Overview by about 1600px. The theme's answer is this rule. The leak itself is
the app's.

podkop's toast container leaks the same way. Leaving podkop is therefore a full load, even though
its CSS passes Rule 2.

Nothing is swept, for Rule 1's reason: a node an app still expects to find is a one-way break. The
router declines the SPA navigation instead. The reload starts the next page with an empty `<body>`.

An inline recorder is the first `<script>` in `header.ut`'s `<body>`. It wraps `document.body`'s own
append methods as properties of the instance, never `Node.prototype`. An extension's isolated-world
content script therefore is never recorded.

`fs-router.js`'s `strayBodyNode()` judges each recorded node, and `bodyLittered()` counts what is
still attached. A recorded node is not stray if it is one of these:

| Kind | Nodes |
|---|---|
| the theme's own | `[data-fs-chrome]`, or an `fs-*` id or class |
| a node type that never renders | `SCRIPT`, `STYLE`, `LINK`, `TEMPLATE`, `NOSCRIPT`, `META` |
| stock LuCI's own | `#modal_overlay`, `.cbi-tooltip`, and the hidden `<a download>` that `handleDownload()` leaves behind |

A node the app removes itself is pruned from the recording. Details:
[spa-router.md](spa-router.md#foreign-view-dom-recorded-not-swept).

### Rule 3. The only safe deletion is a byte-identical duplicate

Why: the rules do not disappear, because the first copy stays. A library's "have I imported this?"
check still finds its sheet.

The function is `dedupeViewSheets()`. Without it, podkop accumulates one `<style>` per visit.

A copy is a duplicate only of one with the same owner, the page it arrived for. Another app's copy
is disabled on this page. Dropping this page's live copy in its favour would leave no copy painting.

Unowned copies still collapse.

### Rule 4. Dark mode is announced in three dialects

Why: third-party apps read different attributes, so the theme writes all three.

- `data-darkmode` is the theme's own: the only dialect `styles/` reads. Apps read it too
  (`luci-app-internet-detector`).
- `data-theme` and `data-bs-theme` are for outbound compatibility only. `styles/` may never read them,
  the same boundary as the export tier.

Three places must list the same set:

1. the pre-paint in `head.ut`;
2. `stampDark()` in `fs-prefs.js`;
3. the `attributeFilter` of the guard observer next to it.

The guard exists because third parties write these attributes (OpenClash). A dialect added to
`stampDark()` but not to the filter is silently unguarded.

### Rule 5. `body` must have an OPAQUE background of the right brightness

Why: this is what every brightness sniffer reads.

A transparent `body` (background moved to `:root` or a pseudo-element) makes OpenClash decide
"light". Its `/rgb\(/` regex does not even match `rgba(0,0,0,0)`. It then repaints our dark page in
its light palette.

This must hold across the whole palette × mode × tint matrix.

### Rule 6. The export tier is a contract

Why: apps read the 26 `--*-color-*` names with a literal fallback, and any name we add we must
support forever.

The list, and the names that do not exist, are in
[luci-app-styling-guide.md, "The export tier"](luci-app-styling-guide.md#the-export-tier-26-names).

Do not add a name to fix an app's typo, such as justclash's `--text-color`. The private `--fs-*`
tier is not part of the contract. See [design-system.md](design-system.md).

The surface and rule names turn translucent while the Card opacity axis is below 100%. See
[design-system.md](design-system.md#transparency-cards-and-the-menu-over-the-wallpaper).

An app popup painted with `--background-color-high` turns translucent with them. The theme's own
floating surfaces take the solid palette back.

### Rule 7. The chrome is fenced off, in three places that must agree

Why: the cascade cannot defend the chrome, so it is defended by not matching.

A sheet whose every selector is pinned to the app's own names stays unlayered. Its `!important`
outranks every cascade layer.

`fs-sheets.js` re-hosts any other sheet into `@layer theme`. There an `!important` still beats every
normal declaration.

The three places are below. Nothing in the build checks that they agree.

| Place | Role | What it does |
|---|---|---|
| `header.ut` | the mark | A chrome root carries `data-fs-chrome`: e.g. the `<nav>`, `.fs-pattern`, the skip link and the sr-only elements. The command palette overlay (`fs-search.js`) carries it too. The other two places read this mark. |
| `fs-sheets.js` | the fence | `CHROME_FENCE` is appended to a foreign selector's subject, so it can no longer match a chrome element. Nothing is left to outrank. |
| `theme/10-chrome.css` | the pin | It closes the one way in a fence cannot: inheritance from `html`/`body`. |

Invariants:

- Rename the mark in `header.ut` and update the other two. Otherwise the fence silently stops
  fencing and nothing on screen changes.
- Both strings use `:where()`, so they add zero specificity.
- The fence covers the root and its subtree (`[m], [m] *`).
- The pin covers the root alone (`:not([m] *)`) and carries only inherited properties.
- Pinning descendants breaks the chrome's own inheritance: `.fs-label` loses `nowrap`, and
  `text-align` becomes `left` and breaks RTL.
- Read each string whole. `:where(:not(.fs-sidebar), .fs-sidebar *)` has all the right tokens and is
  the inverse of a fence.

The fence uses the browser's own CSS parser. It reads `CSSStyleRule.selectorText` and writes back
through the same setter. That setter leaves a selector it cannot parse unchanged.

Nesting, `:has()`, `@scope`, `@container` and an app's own `@layer` need no special handling.

Known limits:

- A nested rule under a pinned parent is fenced too. That is redundant and harmless.
- A sheet that lands before `fs-sheets.js` has loaded paints unfenced until then, on that page only.
- `@import` is followed. A re-hosted `<link>`'s import is fenced on the shim's `load` event.
- An import still loading when a `<style>` is re-hosted stays unfenced on its own page.

### Rule 8. A foreign table is claimed by its HEADER ROW, not by its class

Why: `.table` is LuCI's class, and every table rule the theme has hangs off it.

An app that emits a bare `<table>` matches none of it. So `.fs-main`'s `overflow-x: clip` would cut
its right-hand columns.

`tagDataTables()` takes any table under a content root (`#view` or `#modal_overlay`) that has a
header row. It adds `.table.fs-dt` and copies the column headings into `data-title`.

A table with no header row is left alone and scrolls. What each kind of table gets:
[css.md](css-fixes.md#which-of-the-three-a-table-gets-and-what-decides-it).

The claim is re-made on every fit pass
([the ladder](css-fixes.md#the-ladder-what-happens-when-a-table-does-not-fit)). These tables are polled:
the app replaces the rows inside the same element. Fresh rows need `.tr`/`.td` and captions again.

The one judgement, "does this table speak LuCI's row vocabulary?", is taken once and remembered on
the element. So LuCI's own markup is never rewritten.

### Rule 9. A table inside the app's OWN scroller is the app's business

Why: inside a box the app scrolls itself, a wide table overflows by definition, so the ladder would
always end in cards.

The fit pass cards a data table when it needs more width than it has.

`luci-app-filemanager` parks its listing in `#file-list-container.resizeable` (`resize: both;
overflow: auto`). Without this rule the listing comes out as cards on a 1280px screen.

`fit.inScroller()` walks from the table to the content root. It answers whether any ancestor
scrolls horizontally.

`fs-select.js` asks before it applies the slot's remembered answer. So a table carded by an older
build is un-carded.

The walk stops at `#view` and `#modal_overlay`. Two scrollers past that point are the theme's, and
neither may switch this rule on:

- the dialog's scroller (`base/60-modal.css`);
- the scroll fallback on the table itself (`theme/30-tables.css`).

## What the theme cannot do, and should not try

| Limit | Why |
|---|---|
| `@media (prefers-color-scheme)` in an app's CSS | It follows the OS. The only mitigation is that our default is Auto, which follows the OS too. |
| Hard-coded literals: `background: white` on a passwall modal, justclash's `#1e1e1e` terminal, colours baked into `luci-app-statistics` PNGs | They are not our bytes. |
| An app's z-index on its own page | It is the app's own business. |
| An app's viewport media queries | They do not know about our sidebar. |

## How to check

On a live router:

1. Open an app with ACE/CodeMirror (ssclash), SPA to a neighbouring tab, go back.
   Expected: the editor still works (Rule 1).
2. Open File Manager, go to System.
   Expected: Save/Apply/Reset are still there (Rule 2).
3. Visit podkop three times over SPA.
   Expected: the number of `<style>` elements in `<head>` does not grow (Rule 3).
4. Open justclash in dark mode.
   Expected: its `[data-theme="dark"]` rules match (Rule 4).

A layout defect on one app's page is fixed in the shared rule for that shape, in `styles/theme/`.
Every app with the same shape then gets the fix.

The theme carries no per-app selectors. `styles/pages/` holds stock pages only, and another
package's namespace is off limits ([conventions.md](conventions.md)).

To name the page in a report, read the `data-page` attribute of `#view` in devtools.

### Find what forced a full load

Neither check logs anything, so ask them from the devtools console. Run these on the app's page,
before you navigate away.

1. Ask whether a sheet is behind it:

   ```js
   L.require('fs-sheets').then((s) => console.log(s.documentPoisoned()))
   ```

   Expected: `true` means an invasive sheet holds the document (Rule 2). `false` does not clear
   the page: a stray `<body>` node can still force the full load, so go on to step 3.
2. Find the sheet. In the Elements panel, look in `<head>` for a `<style>` or a
   `<link rel="stylesheet">` without `data-fs-shell`. Test its selectors against
   [Rule 2's three tests](#rule-2-a-document-holding-an-invasive-sheet-hands-the-next-page-over-by-full-load).
   A sheet the theme has already re-hosted into its own layer does not count.
3. List the recorded `<body>` nodes that are still attached:

   ```js
   (window.__fsBodyAdds || []).filter((n) => n.parentNode === document.body)
   ```

   Expected: any node not in the "not stray" table of
   [Rule 2, extended to the DOM](#rule-2-extended-to-the-dom-a-document-holding-a-stray-body-node-hands-the-next-page-over-too)
   forces the full load.

If both come back clean, the full load has another cause in `navigate()` in `fs-router.js`, such
as a flushed menu cache or an expired session.
