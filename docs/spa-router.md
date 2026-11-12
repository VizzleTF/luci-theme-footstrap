# The SPA router

How the theme removes the full page reload when you click a menu item, and the rules a client
router has to follow to stay correct. For contributors who change the router or anything it
touches. The core rule: when the router cannot match what a full load would show, it declines
and the browser loads the page normally.

## Short version

1. LuCI already renders views on the client, so the router can re-instantiate a view into the
   existing `#view` and update the URL with `history.pushState`.
2. `alias` and `firstchild` nodes are resolved on the client exactly as `dispatcher.uc` resolves
   them, so a click and F5 open the same page.
3. `navigate()` declines on any doubt: a foreign stylesheet, a stray `<body>` node, a stale menu, a
   dead session, a node with no view class.
4. Each navigation renders into its own hidden stage and is swapped in only when finished. A
   superseded render paints into a stage that is dropped.
5. Teardown returns polling, intervals and the uci cache to the state a fresh load leaves them in.
6. Focus, title and scroll are handled by hand: a route change fires no `load`, and
   `pushState` saves no scroll position.

## Contents

- [Every case that falls back to a full load](#every-case-that-falls-back-to-a-full-load)
- [Scroll lost? Check in this order](#scroll-lost-check-in-this-order)
- [Where the code lives](#where-the-code-lives)
- [LuCI already renders views on the client](#luci-already-renders-views-on-the-client)
- [alias and firstchild are resolved on the client, as on the server](#alias-and-firstchild-are-resolved-on-the-client-as-on-the-server)
- [The navigation flow: take, decline, commit](#the-navigation-flow-take-decline-commit)
- [A repeat visit needs a new view instance](#a-repeat-visit-needs-a-new-view-instance)
- [Require through `window.L`](#require-through-windowl)
- [Teardown resets the page to fresh-load state](#teardown-resets-the-page-to-fresh-load-state)
- [Foreign view CSS: a gate, not a sweep](#foreign-view-css-a-gate-not-a-sweep)
- [Foreign view DOM: recorded, not swept](#foreign-view-dom-recorded-not-swept)
- [Module prefetch warms the HTTP cache](#module-prefetch-warms-the-http-cache)
- [A hidden tab pauses polling](#a-hidden-tab-pauses-polling)
- [Accessibility of a route change](#accessibility-of-a-route-change)
- [The router saves scroll itself](#the-router-saves-scroll-itself)
- [A dead session ends the document](#a-dead-session-ends-the-document)
- [Where the router turns itself off](#where-the-router-turns-itself-off)
- [What is left alone](#what-is-left-alone)

## Every case that falls back to a full load

Start here when a click reloaded the page. For lost scroll, see
[Scroll lost? Check in this order](#scroll-lost-check-in-this-order).

| Case | What happens | Details |
|---|---|---|
| a link with a `?query` or `#hash` | the router does not take the click; the browser loads it | [step 1](#1-the-router-takes-only-plain-same-origin-clicks) |
| `navigate()` declines: foreign sheet, stray `<body>` node, menu cache flushed, `window._` replaced, dead session, no view class or its `css` missing, no `.fs-content` | `navigate()` returns `false`; the browser loads the page normally | [step 2](#2-navigate-declines-on-any-doubt) |
| a `rewrite` node | not resolved; full load | [alias and firstchild](#alias-and-firstchild-are-resolved-on-the-client-as-on-the-server) |
| `popstate` onto an entry with a query | `location.reload()` | [step 4](#4-back-and-forward-replay-the-same-path) |
| `popstate` onto a node that cannot be SPA-loaded | `location.reload()` | [step 4](#4-back-and-forward-replay-the-same-path) |
| a render not complete within 15 s | the full-load fallback | [The stage](#the-stage-is-hidden-but-laid-out) |
| any require or instanceof error | `console.error(...)`, then `window.location = pathname` | [Where the router turns itself off](#where-the-router-turns-itself-off) |
| a `template` node other than Status→Overview | full navigation | [Where the router turns itself off](#where-the-router-turns-itself-off) |
| the boot contract misses a luci-base surface | the router wires nothing: every link is a full load | [Where the router turns itself off](#where-the-router-turns-itself-off) |
| the boot document is a `call`, `cbi`, `function` or foreign `template` page | the router stays off | [Where the router turns itself off](#where-the-router-turns-itself-off) |

A full load starts a new document, so the router's in-memory scroll `Map` is gone. Only the
browser's own restoration of the document applies; see
[The router saves scroll itself](#the-router-saves-scroll-itself).

So the two `popstate` rows are the fallbacks that lose scroll: Back or Forward lands on a reload,
and `#maincontent` in the `sidebar` layout is not restored. Every other row happens on a forward
click, which opens at the top anyway.

## Scroll lost? Check in this order

| # | Cause | How to tell | Expected or bug |
|---|---|---|---|
| 1 | a forward click | you clicked a link; the commit scrolls both scrollers to 0 | expected |
| 2 | Back or Forward onto an entry with a query, or onto a node that cannot be SPA-loaded | the URL has a `?query`, or the page reloaded; only the document's own restoration applies | expected |
| 3 | the entry was evicted | more than 50 entries saved since you left that page (`SCROLL_MEM_MAX`); the page opens at the top | expected |
| 4 | the replay was cancelled by the reader | you scrolled, or pressed a scroll key, before the page reached its height | expected |
| 5 | the replay gave up | the incoming page did not reach the saved height within 5 s | expected |
| 6 | the wrong element scrolls, or the page cannot scroll | `<html data-layout>` names the layout: `sidebar` scrolls `#maincontent`, `top` scrolls the document | expected per layout; a bug if the named element does not scroll |
| 7 | none of the above | an SPA Back or Forward onto a saved entry, with no input, on a page that reaches its height in time | bug |

For a bug in row 7, look at `saveScroll()`, `restoreScroll()` and the `popstate` handler that sets
`_pendingRestore` in `fs-router.js`. Report the URL, the layout (`data-layout`), the browser, and
whether you used Back, Forward or a click.

## Where the code lives

| Part | File |
|---|---|
| The router | `htdocs/luci-static/resources/fs-router.js` |
| Path→node resolution, also read by the chrome | `fs-menutree.js` |
| The foreign-CSS gate | `fs-sheets.js` |
| The `<body>` recorder, `window.__fsBodyAdds` | `header.ut`, see [Foreign view DOM](#foreign-view-dom-recorded-not-swept) |

The server and luci-base are unchanged. The recorder is the only piece the templates add.

## LuCI already renders views on the client

LuCI 25.12 is a classic MPA. Every click is a full GET, and the ucode dispatcher re-emits the whole
page shell.

But the content is already rendered on the client. For a `view` node the dispatcher renders
`view.ut`. It emits `<div id="view">` plus an inline
`L.require('ui').then(ui => ui.instantiateView(path))`.

So the server controls navigation, and the client controls rendering. The router repeats what
`view.ut` does, minus the reload. It intercepts the click, re-instantiates the view into the
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

## alias and firstchild are resolved on the client, as on the server

The server does not redirect an alias. `GET /admin/status/logs` answers 200 on the same URL and
resolves the leaf internally.

`pathinfo` stays the requested path. `requestpath`/`dispatchpath`/`nodespec`/`ctx.path` already
carry `…/logs/syslog`.

The client does the same. `resolveSegs()` walks `alias` and `firstchild` until it reaches a real
node. An `alias` is a jump to `action.path` from the root. A hop counter catches a cycle in a
foreign `menu.d`.

`firstChildOf()`/`nodeWeight()` port `resolve_firstchild()`/`node_weight()` from `dispatcher.uc`
line for line:

- weight `min(order ?? 9999, 9999)`, plus 10000 for `auth.login`;
- the `satisfied`/`title`/`firstchild_ineligible` filters;
- recursion into a nested `firstchild`;
- ties broken by key order.

The ACL check is skipped, because `/admin/menu` already filters the tree by the session's ACL.

Why line for line: if the client picked a different child, a click and F5 on the same URL would
open different pages.

`rewrite` is not resolved and falls back to a full load.

`navigate()` keeps two tracks:

| Track | Holds | Goes to |
|---|---|---|
| `segs` | what was clicked | `pushState` and `pathinfo` |
| `rsegs` | the resolved leaf | `requestpath`/`dispatchpath`/`nodespec`/`data-page`/title, as on a full load |

### `readonly` is folded with AND, not OR

`L.env.nodespec.readonly` drives `L.hasViewPermission()`, and so the Save/Apply footer.

The dispatcher collects `depends.acl` from every node on the dispatch path into one list
(`ctx_append`). It asks `check_acl_depends()` once. That call answers writable as soon as any group
grants write.

So a page is read-only only when every acl-bearing node on its path is `readonly`.
`readonlyForSegs()` counts the acl-bearing nodes and the read-only ones and compares the two. Nodes
without `depends.acl` are skipped, as in the dispatcher.

## The navigation flow: take, decline, commit

In short: the router takes a plain click, declines on any doubt, then commits in a fixed order.
`wireRouter()` puts one delegated handler on `document`.

### 1. The router takes only plain same-origin clicks

It takes a click on an `<a href>` with all of these:

- no modifiers, button 0;
- no `target` other than `_self`, no `download`;
- same origin, and an href that does not start with `#`.

A link with a `?query` or `#hash` is a full load, because `navigate()` carries only the pathname.
For the same reason, `popstate` onto an entry with a query calls `location.reload()`.

### 2. `navigate()` declines on any doubt

`navigate(pathname, push)` declines when any of these holds. Declining returns `false`, and the
browser loads the page normally.

| Declines when | Detail |
|---|---|
| `documentPoisoned()` | an invasive foreign stylesheet is in the document |
| `bodyLittered()` | a script left a node of its own on `<body>` |
| `ui.menu.flushCache()` ran in this document | luci-app-package-manager calls it after an install, upgrade or removal, so the menu tree and every view class required so far may be stale |
| `window._` was replaced | an extension's lodash/underscore did it (openwrt/luci#7817, #8342) |
| the session is known to be dead | see [A dead session ends the document](#a-dead-session-ends-the-document) |
| the node has no view class | `viewClassFor()`; also when the node's `menu.d` `css` is not in the document |
| there is no `.fs-content` column | checked before the first write, so a refusal does not supersede the navigation in flight |

### 3. A committed navigation runs in this order

#### At the click: state, URL, title, chrome, focus

1. `_navGen` increments; `_curPath` and `_curSearch` move.
2. The `onNavigate` callbacks run, then `ui.hideModal()`.
3. `L.env` is re-pointed: `requestpath`, `dispatchpath`, `pathinfo`, `nodespec`.
4. `pushState`, or `replaceState` if the page on screen was clicked again. A duplicate entry makes
   Back do nothing.
5. `document.title` and the sr-only `<h1>` (`.fs-title-main`) get the new title.
6. `renderChrome()`.
7. `fit.forgetRest()`.
8. Focus moves and the live region announces the title. See
   [Accessibility of a route change](#accessibility-of-a-route-change).
#### After the previous render: teardown, stage, swap

9. The router waits for `warmedThen()` and for the previous render to finish.
10. Teardown: the poll reset, `clearViewIntervals()`, `flushUciCache()`.
11. `body[data-page]` is stamped, then `sheets.scopeToCurrentPage()`.
12. `stageView()`, then `require()` of the view class. A repeat visit gets a new instance.
13. Commit: `commitStage()` swaps the staged content in, then resets the scrollers. See
    [The staging window](#the-staging-window).

### 4. Back and forward replay the same path

`popstate` calls `navigate(location.pathname, false)`. A node that cannot be SPA-loaded gets
`location.reload()`.

A fragment change is not a navigation, but Chrome fires `popstate` for a same-document `#` jump.
So when `location.pathname === _curPath` and the entry has no query, or the query the document
booted with, the handler adopts the entry (`adoptEntry()`) and returns.

### The URL and `data-page` match a full load

`pushState` stores the real dispatcher URL, so F5 and deep links work server-side unchanged.

`body[data-page]` holds the resolved leaf path (`rsegs.join('-')`), as the server stamps it on a
full load. fs-chrome, fs-fit, fs-overview and menu-footstrap read it as the route's identity, never
as a CSS scope.

## A repeat visit needs a new view instance

In short: build a new instance only on a repeat visit, render it into a hidden stage, and swap it in
only when it is finished.

This is the main subtlety of re-instantiating a view. `require()` in LuCI returns an instance, not a class. The first require constructs the object, and
a view's `__init__` is its render.

A second instance on top of a first `require()` renders the page twice and runs two pollers. So the
router builds a new instance only on a repeat visit, with `new instance.constructor()`. This works
because LuCI's class system sets `ClassConstructor.prototype.constructor = ClassConstructor`.

A page that arrived by full load is seeded into `_seen` at init. Otherwise the first SPA return to
it would render nothing.

### A superseded render cannot be cancelled, so it is given its own page to paint into

`L.Request` is XHR that never exposes its `xhr` handle, so there is nothing to abort.
`View.__init__` writes into whatever `document.getElementById('view')` returns when its render
resolves.

So each navigation renders into its own `#view` inside a hidden stage, after the previous render
has finished. A superseded chain paints into its own stage, which is dropped without a swap.

`_navGen` is the token. A URL cannot be one, because A→B→A is two navigations with one URL.

**The invariant: nothing is swapped in until it is finished, and nothing is finished twice.**

### The stage is hidden but laid out

`stageView()` inserts `<div class="fs-staging"><div id="view"></div></div>` as the first child of
`.fs-content`. `getElementById` returns the first match in tree order. So LuCI's own chain writes
into the stage, and the page on screen stays untouched.

The stage uses `visibility: hidden; height: 0; overflow: clip`, never `display: none`. Why: the
realtime graphs size themselves from `#view.offsetWidth`.

The swap moves the nodes and keeps the live `#view` element, which `fs-fit`'s MutationObserver is
bound to. It goes through `dom.content()`, which also reaps the outgoing page's `data-idref`
registry entries.

`renderedIn()` resolves when a child that is not the spinner appears, or when a mutation leaves the
stage empty. A render not complete within 15 s takes the full-load fallback.

The cost: a click during a slow first load waits for that load.

### The staging window

The outgoing page keeps its page-scoped CSS and its scroll position until `commitStage()` takes it
off screen. For the whole window two pages are real at once. `body` is the ancestor of both, so a
rule keyed on `body[data-page]` is right for only one of them.

So the two pages get two anchors:

| Element | Carries |
|---|---|
| the stage's `#view[data-page]` | the incoming name, from the moment `stageView()` creates it |
| the live `#view[data-page]` and `.fs-content[data-page]` | the outgoing name, until `commitStage()` moves it |

`styles/pages/*.css` and the package-manager rules in `styles/theme/90-responsive.css` key off
`:where(#view)[data-page]`.

The dispatcher's stray `h2[name="content"]` is a sibling of `#view`. So its rules key off
`.fs-content[data-page]`.

`fs-sheets`' `scopeToCurrentPage(segs, keep)` follows the same two phases. `keep` is `_shown`, the
page that last reached `commitStage()`.

**Do not write a new page-scoped rule under `body[data-page]`.** Why: keyed off `body`, 33 rules of
the Overview sheet matched the outgoing page for the whole staging window (1407 ms). That grew the
document 211px and moved the reader 140px.

The scroll reset runs at the commit, in the same synchronous turn as `commitStage()`, and never at
the click. `fit.forgetRest()` stays at the click: it only invalidates a stale anchoring reference.

The swap is a synchronous DOM move, with no `document.startViewTransition()`.

### A slow navigation shows a hairline after 150 ms

`#fs-nav-progress` is a two-pixel hairline at the top of the content area. It shows only once a
navigation outlives 150 ms, so a warm click does not flash it.

Overlapping navigations share one bar through a counter. It animates `transform` and `opacity`
only; reduced motion drops the animation.

## Require through `window.L`

The router requires the view through `window.L`, never the `L` its factory received:
`const RT = window.L; RT.require(className)`.

The rule and its symptom (`L.itemlist is not a function`) are in
[conventions.md](conventions.md#writing-js).

## Teardown resets the page to fresh-load state

Teardown runs once the previous render has finished.

### Polling restarts on an empty queue

```js
L.Poll.queue.length = 0;   // the outgoing view's pollers
L.Poll.stop();             // drop its tick, dispatch `poll-stop`
clearViewIntervals();      // the outgoing view's bare setIntervals
L.Poll.start();            // on an EMPTY queue: tick = 0, no timer armed
```

LuCI runs a queue entry only when `tick % interval == 0`, so a surviving tick delays the incoming
poller. `stop()` alone leaves `tick` null, and `Poll.add()` then never starts.

A `poll-stop` listener hides the "Refreshing"/"Paused" pill, which LuCI never hides. It covers this
teardown and a view's own `L.Poll.remove()`. The hide runs in `queueMicrotask()`, after luci.js's
own listener, and declines on a non-empty queue.

### The uci cache is dropped and reloaded

`flushUciCache()` drops uci's config cache, because some views read `uci.load()`'s return value as
an existence check. Unsaved local edits go with it, as on a full load.

When `L.network` exists, `network`, `wireless` and `luci` are loaded straight back and awaited.
Why: `network.js` loads them once per document.

### Other teardown rules

| Rule | Detail |
|---|---|
| `clearViewIntervals()` clears every bare `window.setInterval` the hooks tracked | `L.Poll`'s own tick is not swept |
| What the router removes by hand goes through `discard()`, never `remove()` | only `dom.content()` deletes a `dom.registry` entry |
| The router names no navigation callback | a module registers with `onNavigate(fn)`, so a module that is not installed cannot break the chrome |

### `renderChrome()` rebuilds the menus

It rebuilds the mode menu, the main menu and the section tabs from the re-pointed `L.env`. It
clears the containers first, so nothing duplicates.

## Foreign view CSS: a gate, not a sweep

A `<style>`/`<link>` a view wrote into `<head>` survives an SPA transition and paints every later
page. Removing it is one-way.

So before every navigation `documentPoisoned()` asks whether an invasive sheet is in the document.
If one is, the navigation is a full load. The rules, the three tests and real apps are in
[third-party-apps.md](third-party-apps.md), Rules 1–3.

`fs-sheets.js` checks `VIEW_SHEETS` outside `#view`:
`style:not([data-fs-shell]), link[rel~="stylesheet"]:not([data-fs-shell])`.

`themeNames()` reads the theme's classes, ids and custom properties from `cascade.css` itself. An
unreadable sheet, or an unreadable `cascade.css`, is invasive.

### Which page a sheet belongs to

A sheet that fs-sheets re-hosts into the theme layer is remembered with the page it arrived for.
`scopeToCurrentPage()` enables the sheets of the page on screen and disables the rest.

The key is the resolved dispatch path: `/admin/status` and `/` both resolve to
`admin/status/overview`.

On a cold require the router names the owner (`sheets.attributeTo(segs, gen)`). Why: its `<style>`
can land after a newer navigation.

## Foreign view DOM: recorded, not swept

A node a script parks directly on `<body>` survives an SPA transition, as a `<style>` does. The rule
and the list of nodes that are not stray are in [third-party-apps.md](third-party-apps.md), "Rule 2,
extended to the DOM".

The recorder is the first `<script>` in `header.ut`'s `<body>`. It records into
`window.__fsBodyAdds`. It wraps these methods of `document.body`:

`appendChild`, `insertBefore`, `replaceChild`, `append`, `prepend`, `insertAdjacentElement`,
`insertAdjacentHTML`.

The wrappers are own properties of the element, never `Node.prototype`. Two gaps follow:

- an extension's isolated-world script does not see those properties;
- `Element.before()`/`after()`/`replaceWith()` on a body child go unrecorded.

`bodyLittered()` counts the stray entries (`strayBodyNode()`) still attached. `navigate()` asks it
right after `documentPoisoned()`, with the same verdict: a full load.

## Module prefetch warms the HTTP cache

Pointing at a link to an SPA-able node `fetch()`es its JS module into the browser's HTTP cache. It
never calls `require`, which would run `__init__`.

`moduleUrl()` must build the URL byte-for-byte as `LuCI.require()` does, or the fetch misses the
cache.

The triggers are `pointerover`, `focusin` and `pointerdown`. The walk follows the module's
`require` pragmas but never fetches a class name with no dot.

A click waits for an unfinished prefetch of its class (`warmedThen()`, capped by `WARM_WAIT_MS`).
Why: two requests for one URL are not coalesced.

`warmRecent()` in `menu-footstrap.js` warms up to 5 recent pages, unless
`navigator.connection.saveData` is set.

## A hidden tab pauses polling

A hidden tab does `L.Poll.stop()` with the queue intact, and disarms every registered view
interval. Showing the tab re-arms them and does `L.Poll.start()`.

Only what the router paused is resumed (`_pollWasActive`). So a pause the user set through the
"Refreshing" indicator holds.

## Accessibility of a route change

A route change fires neither `load` nor a document change, so the router does what a full load
would:

1. It writes `document.title` and the sr-only `<h1>` (WCAG 2.4.2).
2. It focuses `#maincontent` with `focus({preventScroll:true})` (WCAG 2.4.3).
3. It announces the page title in `#fs-nav-status` (`role="status"`, `aria-live="polite"`).

A keyboard activation (`ev.detail === 0`) focuses `.fs-skip` instead, from which Enter jumps into
the content.

Pointer activation and `popstate` keep focus on the wrapper, so the skip link does not flash on
every click. The `<h1>` is not focused because `.fs-sr` clips it.

## The router saves scroll itself

`pushState` saves and restores no scroll position, and the two layouts scroll different elements:

| layout | document | `#maincontent` |
|---|---|---|
| `sidebar` | does not scroll | scrolls |
| `top` | scrolls | does not scroll |

**A forward click resets scroll to the top; only Back and Forward (`popstate`) restore it.** On a
`pushState` navigation the commit scrolls both the document and `#maincontent` to 0.

The browser restores only the document, so the router saves `#maincontent.scrollTop` itself.

Safari rate-limits history writes. So `history.state` holds only a session-unique entry id
(`fsid`), and the offsets live in an in-memory `Map` capped at `SCROLL_MEM_MAX` (50 entries).

Past the cap the oldest-saved entry is dropped. Back onto a dropped entry finds no offset, so that
page opens at the top, as on a forward click.

`history.scrollRestoration` stays `auto`. Why: `manual` is inert in `sidebar` and would break
restoration in `top`.

The popstate handler hands the offset to `navigate()` (`_pendingRestore`). The commit replays it
once only the incoming page's height exists.

The replay is a rAF loop, cancelled by navigation generation and capped at 5 s.
`restoreScroll()` cancels it when the reader scrolls. It ignores these scrolls:

- a scroll on an axis this `pos` leaves at 0;
- a scroll outside `#maincontent`;
- the router's own writes;
- the page settling: while the incoming page is still shorter than the saved offset, the browser
  pins the scroll at the page's current maximum and fires a `scroll`. That is not the reader.

## A dead session ends the document

luci-base answers an expired session with `notifySessionExpiry()`: `Poll.stop()` plus a modal whose
only button reloads.

A navigation does `ui.hideModal()` and restarts the poll, so it would dismiss that warning.
Instead, the first click after expiry is a full load that lands on the login form.

`watchSession()` listens on two interceptors:

| Interceptor | Signal |
|---|---|
| `L.Request.addInterceptor` | a `403` carrying `X-LuCI-Login-Required: yes` |
| `rpc.addInterceptor` | an `error` on the `session.access` probe luci-base fires after a `-32002` |

`access: false` is not a dead session, because it is also an ACL answer. A `session.access`
answering `access: true` clears the flag.

Neither interceptor may throw, or luci-base would reject the caller's request.

## Where the router turns itself off

- **The boot contract.** `wireRouter()` checks that every luci-base surface the router calls
  exists (`CONTRACT_FNS` and the `L.env` keys). On a miss it logs the missing one and wires
  nothing: every link is a full load. `uci` and `L.network` are optional and guarded at their call
  sites.
- **A document it could not have rendered.** The router stays off on a `call`, `cbi`, `function`
  or foreign `template` page (`bootDocumentIsOurs()`). A path the tree does not know keeps it on,
  such as the wildcard URL `admin/network/wireless/radio0.network1`.
- **Third-party `view` nodes.** Apps that register them speed up automatically.
- **Status→Overview.** The `template` node `admin_status/index` is the SPA exception. Its template
  only defines three global helpers and calls `ui.instantiateView('status/index')`.
  `menu-footstrap.js` defines the helpers at module eval (`ensureOverviewHelpers()`), and the
  router instantiates `view.status.index`. Other `template` nodes take a full navigation.
- **Errors.** Any require or instanceof error goes to `console.error(...)`, then
  `window.location = pathname`.

## What is left alone

| Left alone | Why |
|---|---|
| a departing view's `setTimeout` and rAF | a blind cancel would break `ui.js` and `fs-fit.js`'s `frame()` coalescer; a view that needs a cancel gets a targeted one through `onNavigate` |
| a view's global listeners | most are registered once at module eval, so removing them is one-way |
| in-flight responses | `L.Request` accepts no `signal`; the generation counter keeps them harmless |
| `history.scrollRestoration = 'manual'` and the Navigation API | not used |
