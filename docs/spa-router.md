# The SPA router

How the theme removes the full page reload when you click a menu item, and the rules a client
router has to follow to stay correct.

The router lives in `htdocs/luci-static/resources/fs-router.js`. Path→node resolution is in
`fs-menutree.js` (the chrome reads it too), and the foreign-CSS gate is in `fs-sheets.js`. The
server and luci-base are unchanged. The templates add one piece: the `<body>` recorder in
`header.ut` (`window.__fsBodyAdds`, see "Foreign view DOM").

## Why it is possible at all

LuCI 25.12 is a classic MPA: every click is a full GET, and the ucode dispatcher re-emits the whole
page shell. But the content is already rendered on the client. For a `view` node the dispatcher
renders `view.ut`, which emits `<div id="view">` plus an inline
`L.require('ui').then(ui => ui.instantiateView(path))`.

So the server controls navigation, and the client controls rendering. The router repeats what
`view.ut` does, minus the reload: it intercepts the click, re-instantiates the view into the
existing `#view` and updates the URL with `history.pushState`.

| type | SPA |
|---|---|
| `view` | yes |
| `alias`, `firstchild` | yes, resolved to a leaf |
| `template` (overview) | yes, a special case |
| `call` (Lua CBI) | no, server-rendered |
| `function` (`admin/logout`) | no, and it does not need to be |
| `firstchild` → into a `call` | no |

The only non-SPA nodes are the ones that have no client view class.

## alias / firstchild resolved on the client

The server does not redirect an alias. `GET /admin/status/logs` answers 200 on the same URL and
resolves the leaf internally: `pathinfo` stays the requested path, while
`requestpath`/`dispatchpath`/`nodespec`/`ctx.path` already carry `…/logs/syslog`.

The client does the same. `resolveSegs()` walks `alias` (a jump to `action.path` from the root) and
`firstchild` until it reaches a real node; a hop counter catches a cycle in a foreign `menu.d`.
`firstChildOf()`/`nodeWeight()` port `resolve_firstchild()`/`node_weight()` from `dispatcher.uc`
line for line: weight `min(order ?? 9999, 9999)` plus 10000 for `auth.login`, the
`satisfied`/`title`/`firstchild_ineligible` filters, recursion into a nested `firstchild`, ties by
key order. The ACL check is skipped, because `/admin/menu` already filters the tree by the
session's ACL. If the client picked a different child, a click and F5 on the same URL would open
different pages. `rewrite` is not resolved and falls back to a full load.

`navigate()` keeps two tracks. `segs` (what was clicked) goes to `pushState` and `pathinfo`.
`rsegs` (the resolved leaf) goes to `requestpath`/`dispatchpath`/`nodespec`/`data-page`/title, as on
a full load.

### `readonly` is folded with AND, not OR

`L.env.nodespec.readonly` drives `L.hasViewPermission()` and so the Save/Apply footer. The
dispatcher collects `depends.acl` from every node on the dispatch path into one list
(`ctx_append`) and asks `check_acl_depends()` once. That call answers writable as soon as any group
grants write, so a page is read-only only when every acl-bearing node on its path is `readonly`.
`readonlyForSegs()` counts the acl-bearing nodes and the read-only ones and compares the two. Nodes
without `depends.acl` are skipped, as in the dispatcher.

## The navigation flow

`wireRouter()` puts one delegated handler on `document`.

1. It takes a click on an `<a href>` with no modifiers, button 0, no `target` other than `_self`,
   no `download`, same origin, and an href that does not start with `#`. A link with a `?query` or
   `#hash` is a full load, because `navigate()` carries only the pathname. For the same reason,
   `popstate` onto an entry with a query calls `location.reload()`.
2. `navigate(pathname, push)` declines (returns `false`, and the browser loads the page normally)
   when any of these holds:
   - `documentPoisoned()`: an invasive foreign stylesheet is in the document;
   - `bodyLittered()`: a script left a node of its own on `<body>`;
   - an extension's lodash/underscore replaced `window._` (openwrt/luci#7817, #8342);
   - the session is known to be dead (see "A dead session ends the document");
   - the node has no view class (`viewClassFor()`), or its `menu.d` `css` is not in the document;
   - there is no `.fs-content` column. This check runs before the first write, so a refusal does
     not supersede the navigation in flight.
3. From there the navigation is committed, in this order:
   - `_navGen` increments; `_curPath` and `_curSearch` move;
   - the `onNavigate` callbacks run, then `ui.hideModal()`;
   - `L.env` is re-pointed (`requestpath`, `dispatchpath`, `pathinfo`, `nodespec`);
   - `pushState`, or `replaceState` if the page on screen was clicked again (a duplicate entry
     makes Back do nothing);
   - `document.title` and the sr-only `<h1>` (`.fs-title-main`) get the new title;
   - `renderChrome()`;
   - `fit.forgetRest()`;
   - focus moves and the live region announces the title (see "Accessibility of a route change");
   - the router waits for `warmedThen()` and for the previous render to finish;
   - teardown: the poll reset, `clearViewIntervals()`, `flushUciCache()`;
   - `body[data-page]` is stamped, then `sheets.scopeToCurrentPage()`;
   - `stageView()`, then `require()` of the view class (a new instance on a repeat visit);
   - commit: `commitStage()` swaps the staged content in, then resets the scrollers (see "The
     staging window").
4. `popstate` (back/forward) calls `navigate(location.pathname, false)`. A node that cannot be
   SPA-loaded gets `location.reload()`. A fragment change is not a navigation: Chrome fires
   `popstate` for a same-document `#` jump. If `location.pathname === _curPath` and the entry has
   no query, or the query the document booted with, the handler adopts the entry (`adoptEntry()`)
   and returns.

`pushState` stores the real dispatcher URL, so F5 and deep links work server-side unchanged.
`body[data-page]` holds the resolved leaf path (`rsegs.join('-')`), as the server stamps it on a
full load. fs-chrome, fs-fit, fs-overview and menu-footstrap-common read it as the route's identity,
never as a CSS scope.

## Re-instantiating a view — the main subtlety

`require()` in LuCI returns an instance, not a class. The first require constructs the object, and
a view's `__init__` is its render. A second instance on top of a first `require()` renders the page
twice and runs two pollers. So the router builds a new instance only on a repeat visit, with
`new instance.constructor()`: LuCI's class system sets
`ClassConstructor.prototype.constructor = ClassConstructor`. A page that arrived by full load is
seeded into `_seen` at init, or the first SPA return to it would render nothing.

### A superseded render cannot be cancelled, so it is given its own page to paint into

`L.Request` is XHR that never exposes its `xhr` handle, so there is nothing to abort. `View.__init__`
writes into whatever `document.getElementById('view')` returns when its render resolves.

So each navigation renders into its own `#view` inside a hidden stage, after the previous render
has finished. A superseded chain paints into its own stage, which is dropped without a swap.
`_navGen` is the token; a URL cannot be one, because A→B→A is two navigations with one URL. The
invariant: nothing is swapped in until it is finished, and nothing is finished twice.

### The stage

`stageView()` inserts `<div class="fs-staging"><div id="view"></div></div>` as the first child of
`.fs-content`. `getElementById` returns the first match in tree order, so LuCI's own chain writes
into the stage, and the page on screen stays untouched.

The stage is hidden but laid out (`visibility: hidden; height: 0; overflow: clip`, never
`display: none`), because the realtime graphs size themselves from `#view.offsetWidth`. The swap
moves the nodes and keeps the live `#view` element, which `fs-fit`'s MutationObserver is bound to.
It goes through `dom.content()`, which also reaps the outgoing page's `data-idref` registry entries.
`renderedIn()` resolves when a child that is not the spinner appears, or when a mutation leaves the
stage empty. A render not complete within 15 s takes the full-load fallback. The cost: a click
during a slow first load waits for that load.

### The staging window

The outgoing page keeps its page-scoped CSS and its scroll position until `commitStage()` takes it
off screen. For the whole window two pages are real at once. `body` is the ancestor of both, so a
rule keyed on `body[data-page]` is right for only one of them.

So the two pages get two anchors. The stage's `#view[data-page]` carries the incoming name from the
moment `stageView()` creates it. The live `#view[data-page]` and `.fs-content[data-page]` keep the
outgoing name until `commitStage()` moves it. `styles/pages/*.css` and the package-manager rules in
`styles/theme/90-responsive.css` key off `:where(#view)[data-page]`. The dispatcher's stray
`h2[name="content"]` is a sibling of `#view`, so its rules key off `.fs-content[data-page]`.
`fs-sheets`' `scopeToCurrentPage(segs, keep)` follows the same two phases (`keep` is `_shown`, the
page that last reached `commitStage()`). Do not write a new page-scoped rule under
`body[data-page]`.

The scroll reset runs at the commit, in the same synchronous turn as `commitStage()`, and never at
the click. `fit.forgetRest()` stays at the click: it only invalidates a stale anchoring reference.
The swap is a synchronous DOM move, with no `document.startViewTransition()`.

### Saying that a slow navigation is under way

`#fs-nav-progress` is a two-pixel hairline at the top of the content area. It shows only once a
navigation outlives 150 ms, so a warm click does not flash it. Overlapping navigations share one bar
through a counter. It animates `transform` and `opacity` only; reduced motion drops the animation.

## Require through `window.L`

The router requires the view through `window.L`, never the `L` its factory received:
`const RT = window.L; RT.require(className)`. The rule and its symptom
(`L.itemlist is not a function`) are in [conventions.md](conventions.md#writing-js).

## Teardown

It runs once the previous render has finished.

- Polling returns to the state a fresh load leaves it in:

  ```js
  L.Poll.queue.length = 0;   // the outgoing view's pollers
  L.Poll.stop();             // drop its tick, dispatch `poll-stop`
  clearViewIntervals();      // the outgoing view's bare setIntervals
  L.Poll.start();            // on an EMPTY queue: tick = 0, no timer armed
  ```

  LuCI runs a queue entry only when `tick % interval == 0`, so a surviving tick delays the incoming
  poller. `stop()` alone leaves `tick` null, and `Poll.add()` then never starts.
- A `poll-stop` listener hides the "Refreshing"/"Paused" pill, which LuCI never hides. It covers
  this teardown and a view's own `L.Poll.remove()`. The hide runs in `queueMicrotask()`, after
  luci.js's own listener, and declines on a non-empty queue.
- `flushUciCache()` drops uci's config cache, because some views read `uci.load()`'s return value
  as an existence check. Unsaved local edits go with it, as on a full load. When `L.network`
  exists, `network`, `wireless` and `luci` are loaded straight back and awaited: `network.js` loads
  them once per document.
- `clearViewIntervals()` clears every bare `window.setInterval` the hooks tracked. `L.Poll`'s own
  tick is not swept.
- What the router removes by hand goes through `discard()`, never `remove()`. Only `dom.content()`
  deletes a `dom.registry` entry.
- The router names no navigation callback. A module registers with `onNavigate(fn)`, so a module
  that is not installed cannot break the chrome.

### `renderChrome()`

Rebuilds the mode menu, the main menu and the section tabs from the re-pointed `L.env`. It clears
the containers first, so nothing duplicates.

## Foreign view CSS: a gate, not a sweep

A `<style>`/`<link>` a view wrote into `<head>` survives an SPA transition and paints every later
page. Removing it is one-way. So before every navigation `documentPoisoned()` asks whether an
invasive sheet is in the document, and if one is, the navigation is a full load. The rules, the
three tests and real apps are in [third-party-apps.md](third-party-apps.md), Rules 1–3.

`fs-sheets.js` checks `VIEW_SHEETS`
(`style:not([data-fs-shell]), link[rel~="stylesheet"]:not([data-fs-shell])`) outside `#view`.
`themeNames()` reads the theme's classes, ids and custom properties from `cascade.css` itself. An
unreadable sheet, or an unreadable `cascade.css`, is invasive.

### Which page a sheet belongs to

A sheet that fs-sheets re-hosts into the theme layer is remembered with the page it arrived for.
`scopeToCurrentPage()` enables the sheets of the page on screen and disables the rest. The key is
the resolved dispatch path: `/admin/status` and `/` both resolve to `admin/status/overview`. On a
cold require the router names the owner (`sheets.attributeTo(segs, gen)`), because its `<style>`
can land after a newer navigation.

## Foreign view DOM: recorded, not swept

A node a script parks directly on `<body>` survives an SPA transition, as a `<style>` does. The rule
and the list of nodes that are not stray are in [third-party-apps.md](third-party-apps.md), "Rule 2,
extended to the DOM".

The recorder is the first `<script>` in `header.ut`'s `<body>`. It wraps `document.body`'s own
`appendChild`/`insertBefore`/`replaceChild`/`append`/`prepend`/`insertAdjacentElement`/
`insertAdjacentHTML` as own properties of the element, never `Node.prototype`. It records into
`window.__fsBodyAdds`. An extension's isolated-world script does not see those properties.
`Element.before()`/`after()`/`replaceWith()` on a body child go unrecorded.

`bodyLittered()` counts the stray entries (`strayBodyNode()`) still attached. `navigate()` asks it
right after `documentPoisoned()`, with the same verdict: a full load.

## Module prefetch

Pointing at a link to an SPA-able node `fetch()`es its JS module into the browser's HTTP cache. It
never calls `require`, which would run `__init__`. `moduleUrl()` must build the URL byte-for-byte as
`LuCI.require()` does, or the fetch misses the cache. The triggers are `pointerover`, `focusin` and
`pointerdown`. The walk follows the module's `require` pragmas but never fetches a class name with
no dot.

A click waits for an unfinished prefetch of its class (`warmedThen()`, capped by `WARM_WAIT_MS`),
because two requests for one URL are not coalesced. `warmRecent()` in `menu-footstrap-common.js`
warms up to 5 recent pages, unless `navigator.connection.saveData` is set.

## Background polling pause

A hidden tab does `L.Poll.stop()` (queue intact) and disarms every registered view interval.
Showing the tab re-arms them and does `L.Poll.start()`. Only what the router paused is resumed
(`_pollWasActive`), so a pause the user set through the "Refreshing" indicator holds.

## Accessibility of a route change

A route change fires neither `load` nor a document change, so the router does what a full load
would. It writes `document.title` and the sr-only `<h1>` (WCAG 2.4.2). It focuses `#maincontent`
with `focus({preventScroll:true})` (WCAG 2.4.3). It announces the page title in `#fs-nav-status`
(`role="status"`, `aria-live="polite"`).

A keyboard activation (`ev.detail === 0`) focuses `.fs-skip` instead, from which Enter jumps into
the content. Pointer activation and `popstate` keep focus on the wrapper, so the skip link does not
flash on every click. The `<h1>` is not focused because `.fs-sr` clips it.

## Scroll

`pushState` saves and restores no scroll position, and the two layouts scroll different elements:

| layout | document | `#maincontent` |
|---|---|---|
| `sidebar` | does not scroll | scrolls |
| `top` | scrolls | does not scroll |

The browser restores only the document, so the router saves `#maincontent.scrollTop` itself.
Safari rate-limits history writes, so `history.state` holds only a session-unique entry id (`fsid`).
The offsets live in an in-memory `Map` capped at `SCROLL_MEM_MAX`. `history.scrollRestoration`
stays `auto`: `manual` is inert in `sidebar` and would break restoration in `top`.

The popstate handler hands the offset to `navigate()` (`_pendingRestore`), and the commit replays
it once only the incoming page's height exists. The replay is a rAF loop, cancelled by navigation
generation and capped at 5 s. `restoreScroll()` cancels it when the reader scrolls. It ignores a
scroll on an axis this `pos` leaves at 0 or outside `#maincontent`, the router's own writes, and
the engine clamping to a ceiling still shorter than the saved offset.

## A dead session ends the document

luci-base answers an expired session with `notifySessionExpiry()`: `Poll.stop()` plus a modal whose
only button reloads. A navigation does `ui.hideModal()` and restarts the poll, so it would dismiss
that warning. Instead, the first click after expiry is a full load that lands on the login form.

`watchSession()` listens through `L.Request.addInterceptor` for a `403` carrying
`X-LuCI-Login-Required: yes`. It also listens through `rpc.addInterceptor` for an `error` on the
`session.access` probe luci-base fires after a `-32002`. `access: false` is not a dead session,
because it is also an ACL answer. Neither interceptor may throw, or luci-base would reject the
caller's request. A `session.access` answering `access: true` clears the flag.

## Boundaries and degradation

- The boot contract. `wireRouter()` checks that every luci-base surface the router calls exists
  (`CONTRACT_FNS` and the `L.env` keys). On a miss it logs the missing one and wires nothing: every
  link is a full load. `uci` and `L.network` are optional and guarded at their call sites.
- The router stays off on a document it could not have rendered: a `call`, `cbi`, `function` or
  foreign `template` page (`bootDocumentIsOurs()`). A path the tree does not know keeps it on, such
  as the wildcard URL `admin/network/wireless/radio0.network1`.
- Third-party apps that register `view` nodes speed up automatically.
- Status→Overview (`template` node `admin_status/index`) is the SPA exception. Its template only
  defines three global helpers and calls `ui.instantiateView('status/index')`.
  `menu-footstrap-common.js` defines the helpers at module eval (`ensureOverviewHelpers()`), and
  the router instantiates `view.status.index`. Other `template` nodes take a full navigation.
- Any require or instanceof error goes to `console.error(...)`, then `window.location = pathname`.

## What is left alone

- A departing view's `setTimeout` and rAF survive navigation; a blind cancel would break `ui.js`
  and `fs-fit.js`'s `frame()` coalescer. A view that needs a cancel gets a targeted one through
  `onNavigate`.
- A view's global listeners survive navigation. Most are registered once at module eval, so
  removing them is one-way.
- In-flight responses are not cancelled: `L.Request` accepts no `signal`. The generation counter
  keeps them harmless.
- `history.scrollRestoration = 'manual'` and the Navigation API are not used.
