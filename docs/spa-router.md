# The SPA router

How the theme removes the full page reload when you click a menu item, and the rules a client
router has to follow to stay correct.

Lives in `htdocs/luci-static/resources/fs-router.js`; path→node resolution in `fs-menutree.js`
(also read by the chrome), the foreign-CSS gate in `fs-sheets.js`. **No changes to the server,
luci-base or the templates** — this is purely additive theme JS.

## Why it is possible at all

LuCI 25.12 is a classic MPA: every click is a full GET and the ucode dispatcher re-emits the whole
page shell. But **the content is already rendered on the client**: for a `view` node the dispatcher
renders `view.ut`, which emits `<div id="view">` plus an inline
`L.require('ui').then(ui => ui.instantiateView(path))`.

So the server controls *navigation*, not *rendering*. The router repeats exactly what `view.ut`
does, minus the reload: intercept the click, re-instantiate the view into the existing `#view`,
update the URL with `history.pushState`.

Count clickable nodes, not leaves — the ones `ui.menu.getChildren()` turns into an `<a href>`
(`satisfied` plus a title). A node with an `action` can have children (`admin/status/nftables`),
while `rpc/*`, `admin/uci/*` and `admin/menu` never become links. On the test router that is **65**
nodes, of which SPA serves **62**:

| type | count | SPA |
|---|--:|---|
| `view` | 54 | yes |
| `alias`, `firstchild` | 10 | yes — resolved to a leaf |
| `template` (overview) | 1 | yes — special case |
| `call` (Lua CBI) | 1 | no — server-rendered |
| `function` (`admin/logout`) | 1 | no — and does not need to be |
| `firstchild` → into a `call` | 1 | no |

So the only non-SPA nodes are the ones with no client view class in principle.

## alias / firstchild resolved on the client

This was the router's blind spot: 7 of the 27 links the menu draws (Firewall, System Log, Realtime
Graphs, Administration, Terminal, …) are not pages but redirects. `viewClassFor` saw a non-`view`
and fell back to a full load — meaning **the most-clicked menu items reloaded the page**.

The server does not redirect them: `GET /admin/status/logs` answers **200 on the same URL** and
resolves the leaf internally — `pathinfo` stays the requested path while
`requestpath`/`dispatchpath`/`nodespec`/`ctx.path` already carry `…/logs/syslog`. The client does
the same:

- `resolveSegs()` walks `alias` (jump to `action.path` from the root) and `firstchild` (pick a
  child) until it reaches a real node; a hop counter catches a cycle in a foreign `menu.d`.
- `firstChildOf()`/`nodeWeight()` are a port of `resolve_firstchild()`/`node_weight()` from
  `dispatcher.uc`, not a paraphrase: weight `min(order ?? 9999, 9999)` plus 10000 for a node with
  `auth.login`, the `satisfied`/`title`/`firstchild_ineligible` filters, recursion into a nested
  `firstchild`, ties broken by key order. The ACL check is skipped: the tree the client gets from
  `/admin/menu` is already filtered by the session's ACL.
- `navigate()` keeps both tracks: `segs` (what was clicked) goes to `pushState` and `pathinfo`;
  `rsegs` (the resolved leaf) goes to `requestpath`/`dispatchpath`/`nodespec`/`data-page`/title —
  exactly as a full load does.

Accuracy here is not aesthetics: pick a different child and a click opens one page while F5 on the
same URL opens another. `rewrite` is deliberately not resolved — it is not in the tree, and a
mistake in `splice` semantics would open the wrong page, which is worse than the reload it
falls back to.

### `readonly` is folded with AND, not OR

`L.env.nodespec.readonly` drives `L.hasViewPermission()` and therefore the Save/Apply footer, so the
client has to reach the same answer the dispatcher does. It collects `depends.acl` from every node
on the dispatch path into one list (`ctx_append`) and asks `check_acl_depends()` once, which
answers **writable as soon as any group in that list grants write**. So a page is read-only exactly
when no group on the path is writable — i.e. when *every* acl-bearing node on it is `readonly`, not
when *one* is. A leaf that declares a writable acl of its own re-opens a path that runs through a
read-only section.

`readonlyForSegs()` therefore counts acl-bearing nodes and read-only ones and compares the two.
Nodes without `depends.acl` are skipped: the dispatcher contributes nothing for them, and the flag
alone cannot distinguish "gated and writable" from "not gated", which is why the fold needs the acl
list that `/admin/menu` serves (66 of 243 nodes carry one on the stand).

Verified live rather than argued: with `admin/status/logs` (read-only `luci-mod-status-logs`) given a
child carrying a writable acl, a full load reported `nodespec.readonly` **false** while the previous
OR fold said true — a Save/Apply the server allows, taken away by a click. `../tmp/readonly-parity.mjs`
walks the whole menu comparing the server's stamp against both folds; on 110 comparable pages of an
unmodified stand the two folds agree, and only the constructed case separates them.

## The navigation flow

`wireRouter()` puts one delegated handler on `document`:

1. A click on an `<a href>`, no modifiers, button 0, not `target=_blank`, not `download`, same
   origin, href not `#…`. Links with a `?query` or `#hash` also go to a full load: `navigate()`
   carries only the pathname, and `pushState` of a bare path would drop both (views read
   `location.search`). For the same reason, `popstate` onto an entry with a query is just
   `location.reload()`.
2. `navigate(pathname, push=true)`:
   - `segsFromPath` strips `L.env.scriptname` into path segments;
   - `documentPoisoned()` — has an invasive foreign stylesheet poisoned the document? If so,
     `return false`;
   - `nodeForSegs` walks the menu tree; `viewClassFor` gives the view class name, or `null` if the
     node is not SPA-able;
   - **no class → `return false`** → the handler does not `preventDefault` → the browser loads the
     page normally;
   - otherwise: teardown → update `L.env` → `body[data-page]` → `pushState` (or **`replaceState`**
     if the already-open page was clicked — a second entry would make one Back press dead) →
     `renderChrome()` → `scrollTo(0, 0)` → focus `#maincontent` and announce the new title in the
     polite live region → re-instantiate the view;
   - `return true` → `preventDefault`.

   Every committed navigation increments `_navGen`.
3. `popstate` (back/forward): `navigate(location.pathname, push=false)`; a non-SPA-able node →
   `location.reload()`. Two guards first: an entry with a `?query` reloads immediately, and **a
   fragment change is not a navigation** — Chrome fires `popstate` for a same-document `#` jump, so
   a click on `<a href="#">` inside a view arrived here as "the user pressed Back" and the router
   re-instantiated the view, wiping the state that click had just set (issue #3:
   `luci-app-filemanager`'s tab strip is four `<a href="#">` whose handler never calls
   `preventDefault`). If `location.pathname === _curPath`, the page owns the fragment; return.

Because `pushState` stores the real dispatcher URL, F5 and deep links work server-side
unchanged.

The router re-stamps `document.body[data-page]` itself, from the resolved leaf path
(`rsegs.join('-')`), exactly as the server stamps `ctx.path` on a full load. Otherwise the incoming
page would keep the previous page's `data-page` and the page-scoped CSS in `styles/pages/*` would
silently not apply.

## Re-instantiating a view — the main subtlety

`require()` in LuCI returns an instance, not a class: the first require constructs the object,
and a view's `__init__` *is* its render (that is all `ui.instantiateView()` does). The router used
to `require()` and then build a second instance on top — the page rendered twice and ran **two
pollers**, permanently doubling the RPC rate. So a new instance is built only on a repeat visit.
A page that arrived by full load is already instantiated by LuCI, so its class is seeded into
`_seen` at init — otherwise the first SPA return to it would render nothing. The benchmark found
this; the double render is invisible to the eye.

On a repeat visit, require hands back a singleton whose `__init__` has already run, so calling it
again repaints nothing. The class is taken from the instance — LuCI's class system sets
`ClassConstructor.prototype.constructor = ClassConstructor`, so `instance.constructor` is the class,
and `new instance.constructor()` runs a fresh `__init__` → fresh `load()` + `render()` into `#view`.
Identical to a full load, which also always starts from a new instance.

### A superseded render cannot be cancelled, so it is given its own page to paint into

`AbortController` is hygiene, not correctness. The primary source is blunt about it:

> "It's ok to call `.abort()` after the fetch has already completed, fetch simply ignores it."
> — Chrome, *Abortable fetch*

`abort()` cancels neither an already-arrived response nor an already-running handler, and
**`L.Request` in LuCI is XHR that never exposes its `xhr` handle at all** — there is nothing to
abort. `View.__init__` is asynchronous too (`ready.then(load).then(render).then(nodes =>
DOM.content(document.getElementById('view'), nodes))`), so the write lands two awaits after the
navigation that started it, and the element it writes into is resolved **at that moment**, not when
the chain began.

That is the whole problem, and it has exactly two shapes of answer: repair the damage afterwards, or
arrange for there to be no damage. This router did the first for a year and now does the second.

**What it does now.** Each navigation renders into a `#view` of its own inside a hidden stage, and
waits for the previous render to finish before it stages anything. A chain that is superseded
therefore paints into the stage its own navigation created; that stage is then dropped, unswapped,
and the live page — either the one still on screen or the one the newer navigation committed — never
sees it. `_navGen` is still the token (a URL is not one: A→B→A is two navigations with one URL), but
it is now only ever *read* to decide whether a finished render may be swapped in.

**What it replaced**, kept here because the failure modes are worth remembering:

- a wrapper installed on `prototype.render` before `new`, which stamped the navigation's generation
  on the instance and made a stale render return a promise that never resolved. Reproduced before it
  existed: leave a slow cached view (Software) for a fast one (System) after 150 ms, and the result
  was stable until F5 — System's URL, title, `data-page` and menu highlight with Software's content
  in `#view`;
- `repairStaleRender()`, which re-ran the current navigation after a superseded FIRST render had
  already painted and registered its pollers — the uncached case, where `require()` *is* the render
  and there was nothing to cancel;
- and the cold-route spinner, which emptied `#view` at the click so that something would be moving
  while the module loaded.

All three are gone: about 80 lines of mechanism, plus the double-render class of bug they existed to
contain. What replaced them is one rule — *nothing is swapped in until it is finished, and nothing
is finished twice*.

### The stage

`stageView()` inserts `<div class="fs-staging"><div id="view"></div></div>` as the **first** child of
`.fs-content`. `getElementById` returns the first match in tree order, so LuCI's own chain — the
spinner in `View.__init__` and the `DOM.content()` when the render resolves — writes into the stage
while the page the user is reading stays untouched.

- **Hidden, but laid out.** `visibility: hidden; height: 0; overflow: clip` — never `display: none`:
  the realtime graphs size themselves from `#view.offsetWidth` inside `render()`, and a
  `display: none` stage hands them a zero width they keep. The width is the container's, exactly
  what it will be after the swap.
- **The swap moves the nodes; it does not swap the element.** The obvious alternative — insert the
  staged `#view`, delete the old one — changes the identity of `#view`, and this theme binds
  observers to that element: `fs-fit`'s content MutationObserver and `fs-appearance`'s view observer
  are registered on the node that existed at chrome init. Swapping the element leaves both watching
  a detached node, i.e. the fitters silently stop re-running. So the live `#view` keeps its identity
  and its children are replaced through `dom.content()`, which also reaps the outgoing page's
  `data-idref` registry entries.
- **Completion is observed, not assumed.** `renderedIn()` resolves when a child that is not the
  spinner appears, or when a mutation leaves the stage empty (a view that renders nothing still
  finishes). A render that has not completed within 15 s is a **failure**, not a completion: swapping
  a spinner in and releasing the serialization would let the still-running chain paint into a later
  navigation's stage. It rejects into the same full-load fallback every other error takes.
- **The cost, stated plainly:** a click during a slow first load waits for that load. Measured
  against the previous shape on the same stand, six pages, three runs each: warm median 136 ms before
  and 142 ms after, cold median 197 ms before and 196 ms after — i.e. the same, within noise. The
  change is not about speed; it is that the outgoing page stays readable instead of being replaced
  by a spinner, and that three repair mechanisms could be deleted.

### Saying that a slow navigation is under way

With the outgoing page left on screen, a cold route would otherwise look like a click that did
nothing: the chrome switches instantly, the content does not move until the module and its first RPC
land. `#fs-nav-progress` is a two-pixel hairline at the top of the content area, shown only once a
navigation outlives **150 ms** — below that a bar would flash on and off on every warm click, which
reads as a glitch rather than as progress. Overlapping navigations share one bar through a counter.
It animates `transform` and `opacity` only, so it cannot cost the render it reports on, and reduced
motion keeps the bar and drops the animation.
## The two `L` trap

`L` inside a module (the factory parameter) and `window.L` (the runtime instance the dispatcher
creates) are different objects. `ui` hangs its helpers (`itemlist`, `showModal`, `hideTooltip`)
on `window.L`, not on the prototypal `L` factories receive. A required module captures whichever `L`
`require()` was called on.

So a view must be required through `window.L`, or it captures the helper-less `L` and dies
mid-render on the first `L.itemlist(...)`. In the code: `const RT = window.L; RT.require(className)`.

**The trap propagates down the chain, and the cache makes it a race.** `view/status/index.js` loads
its includes with its own `L`, so the `L` that index.js got is also what `30_network.js` gets —
and that one calls `L.itemlist(...)` directly. One wrong `require` at the top kills the render three
modules down. And because `require()` caches by class name, the class↔`L` binding is fixed by the
**first** requirer: on a full load that is always the dispatcher with `window.L`, but on an SPA
transition it can be any theme module that touches a stock class. That is exactly what
`fs-overview.js` did — `patchOverview()` required `view.status.index` through its prototypal `L`,
beat the router's `RT.require`, and the overview died on `L.itemlist is not a function` with
"Loading view…" on screen. "Sometimes, and only when coming from another page" is precisely why.

**Rule: any require of a STOCK class from theme code goes through `window.L`** — not only in the
router. `L.env` and `L.Poll` are shared (closure/singleton), so those can be reached through either;
only the `require` target matters.

## Teardown

Before rendering the new view:

- **Polling is returned to the state a fresh load leaves it in** — all three steps are required:

  ```js
  L.Poll.queue.length = 0;   // the outgoing view's pollers
  L.Poll.stop();             // drop its tick
  L.Poll.start();            // on an EMPTY queue: tick = 0, no timer armed
  ```

  *The flush* stops the departed page's pollers hammering detached DOM and burning RPC. The only
  non-view poller LuCI adds is a transient reachability check during apply/reboot, so clearing the
  queue is safe.

  *One flush is not enough.* LuCI keeps one tick per second and runs a queue entry only when
  `tick % interval == 0`. The outgoing page's surviving tick made the incoming view's poller
  wait for the next multiple of its interval — up to 5 s. Wireless draws its station list from the
  first poll and sat spinning for **4950 ms** against ~360 ms on a full load.

  *One `stop()` is not enough either*, which is why there are three steps: `stop()` removes
  `tick`, and `Poll.add()` only auto-starts when `tick != null`, so the page would not poll at all.
  `stop()` + `start()` on an empty queue gives exactly what a fresh document has. This is not a
  workaround — it is literally upstream's sequence: on a full load `initDOM()` calls `Poll.start()`
  on an empty queue before the view renders.
- The "Refreshing"/"Paused" indicator used to outlive its own polling: LuCI shows it on `poll-start`,
  switches it on `poll-stop` and never hides it again, while our `stop()` dispatches `poll-stop`
  on every navigation — so moving from a polling page to a non-polling one left "Paused" about
  polling that did not exist. Our own `poll-stop` listener (registered at module eval, therefore
  after LuCI's, therefore running second) hides the pill when the queue is empty.
- **uci's config cache is dropped** (`flushUciCache()`). `uci.load()` does not answer "is this
  config present?" — it answers "which of these packages did THIS call fetch", skipping every
  package already in `state.values`. Four shipped views read the return value as an existence check
  (`luci-app-banip` and `luci-app-adblock`'s overview, `luci-app-travelmate`'s overview and
  stations): `if (!result[3] || result[3].length === 0) → _('No banIP config found!')`. On a full
  load the cache is empty, so the check passes; under SPA the second visit gets `[]` and the page
  draws an error notification over an empty view until a reload. The apps' reading is wrong, the
  divergence is ours — a document-scoped cache outliving the page that filled it is exactly the
  shape of the poll queue and the stray intervals above. `unload()` is upstream's own idiom for it:
  `uci.save()` ends with `self.unload(pkgs); return self.load(pkgs)`. Unsaved local edits
  (`creates`/`changes`/`deletes`) go with it, as they do on a full load; **saved** changes are on
  the server, so the Unsaved-changes banner is unaffected. Reached through `window.L.uci`, not a
  `'require uci'` pragma — the class attaches to `L`'s prototype when its first requirer compiles
  it, so this sees the instance the pages use, does not bind it to the router's prototypal `L` (the
  two-`L` trap above), and does not pull uci.js onto pages that never touch uci. `state.values` and
  `loaded` are private, so a shape we do not recognise is one loud `console.error` and no sweep —
  the same rule as `L.Poll.timer`.
- **…except the three packages `network.js` will never load again**, which are put straight back and
  which the incoming view WAITS for. `initNetworkState()` loads `network`, `wireless` and `luci`
  once, fills its own `_state`, and from then on answers everyone with
  `return (_state != null ? Promise.resolve(_state) : _init)` — no uci call ever again for the life
  of the document — while still answering *out of the uci cache*: `getWifiDevices()` **is**
  `uci.sections('wireless', 'wifi-device')`, and `view/network/switch` reads
  `uci.sections('network', 'switch')` in its own `render()`. Dropping those packages therefore does
  not refresh them; it hands every consumer an empty config until the next full load. Measured on
  24.10, one navigation away from Interfaces: `uci.state.values` `{}`, `network.getWifiDevices()`
  2 → 0 — Status → Channel Analysis with no band tabs and Network → Switch with no VLAN sections,
  both right again after F5, which is how it was reported upstream. The refill is awaited because a
  *cached* module resolves within a microtask, well before the request lands, and only fires when
  `L.network` exists: no module, no derived state to keep in step. The ubus half of `_state` stays
  as stale as upstream leaves it — a view that needs it fresh calls `network.flushCache()`, and that
  is not the router's call to make.
- `clearViewIntervals()` kills the outgoing view's bare `window.setInterval`s. A full load would
  have killed them; SPA must do it explicitly. `setInterval`/`clearInterval` are hooked at module
  eval and the timers tracked in a `Map` keyed by **the id the caller was handed**; `L.Poll`'s own
  1-second tick is preserved. The entry carries what the timer was armed with and `live`, the id the
  platform has armed right now — `null` while the hidden-tab pause below has it disarmed. Two rules
  follow, and both were once broken: the caller's id never changes, so a view can still stop its own
  poller after a trip through a background tab, and a paused timer stays in this Map, so a
  navigation that happens while the tab is hidden sweeps it like any other instead of having it
  handed back on the way in. Clearing an id whose entry is paused touches no platform timer at all —
  that number is the platform's to hand out again.
- **What the router removes by hand goes through `discard()`, not `remove()`.** `dom.data()` does not
  live on the element: luci.js keeps it in `dom.registry` keyed by a `data-idref` attribute, and the
  only thing that deletes an entry is `dom.content()`. `#view` is safe — the incoming view's own
  `dom.content(#view, …)` reaps the outgoing page — but the siblings a template emitted next to it
  and the runtime notification banners are removed by the router, and `remove()` leaves their
  entries, and through them the elements and any class instance stored on them, reachable for the
  life of the document. `discard()` moves the element into a detached container and calls
  `dom.content(bin, null)`, which reaps the element's own entry as well as its descendants', using
  only the public API. Measured before writing it: nothing the sweeps remove carries a `data-idref`
  on the stands today (banners 0, siblings 0) and the registry does not grow across laps (83 entries
  after the first lap of four pages, 83 after the third) — this closes the class rather than fixes a
  leak we can see, the same reasoning the table selector uses for a `<table>` with no LuCI classes.
- Running the registered navigation callbacks — **and the router names none of them**. The seam is
  inverted: `fs-router.js` exports `onNavigate(fn)` and a module registers itself, so an optional
  module that is not installed is not a `DependencyError` that takes out the chrome. The search
  palette uses it today (recent pages, close on navigate); it was written for the retired self-update
  poll cancel.
- `ui.hideModal()`.

### `renderChrome()`

After `L.env` changes (`requestpath`/`dispatchpath`/`pathinfo`/`nodespec`), rebuilds the mode menu,
the main menu and the section tabs. The containers are cleared first so nothing duplicates.
`document.title` and `.fs-title-main` are updated too.

## Foreign view CSS: a gate, not a sweep

A `<style>`/`<link>` a view wrote into `<head>` dies with the document on a full load — but
**survives an SPA transition** and paints every page afterwards. `luci-app-filemanager` injects
`.cbi-button-apply, .cbi-button-reset, .cbi-button-save:not(.custom-save-button) { display: none
!important }` — unlayered *and* important, so it beats every cascade layer: one visit and Save/Reset
vanished from every config page.

**Removing them on navigation is not an option** — it was tried, and it broke SSClash. A poller is
recoverable by re-rendering the view; a stylesheet comes back only if the injector runs again,
and a library that imports CSS at module eval never runs again (the module is cached for the life of
the document). `ace_editor.css` (14 KB of absolutely positioned layers) is imported once — after a
sweep, returning to the editor gave a black rectangle 2 007 346 px tall. **Deletion is silently
one-way.**

Hence: **`documentPoisoned()` before every navigation.** An invasive sheet in the document →
`navigate()` returns `false` → an ordinary full load. Speed is traded for correctness, never the
other way; a fresh document carries no view CSS, so SPA resumes immediately.

`VIEW_SHEETS` is `style:not([data-fs-shell]), link[rel~="stylesheet"]:not([data-fs-shell])`. The
`<link>` half is not hypothetical: `luci-app-banip`/`luci-app-adblock` append a `<link …/custom.css>`
at module eval, and it paints `.cbi-input-text` / `.cbi-input-select` — stock widgets, on every page,
unlayered. Excluded: `[data-fs-shell]` (the one `<style>` the server emits is marked, not
guessed) and everything inside `#view` (it dies with the content). LuCI's core injects no runtime
`<style>` at all (checked in `luci.js`, `ui.js`, `cbi.js`).

**The universe of theme names is read from `cascade.css` itself** (`themeNames()`; same-origin, so
`cssRules` is readable) — every class/id the theme styles and every custom property it declares or
reads. Not a hand-written list: that would fall behind the theme on day one. An unreadable sheet
(still loading, 404, cross-origin) or an unreadable `cascade.css` is **invasive by default**: unknown
CSS takes the slow path, not the broken one. The whole gate costs ~0.3 ms per navigation.

Three tests in `invasiveSheet()`:

1. **A bare type selector** (`pre`, `*`, `:root`, `svg text` — no class, id or attribute) matches
   stock markup on any page → invasive. Unless its declarations are inert:
   `inertDeclarations()` passes a rule that declares only custom properties the theme does not
   read — it cannot paint us. `luci-app-temp-status` opens with `:root { --app-temp-status-temp: … }`
   and would otherwise poison the document on selector shape alone. Invasive: any standard
   property on a bare selector (stock filemanager writes `:root { color-scheme: light dark }`, which
   re-points every UA widget at the OS setting) and any custom property the theme *does* read —
   which is the point of the private `--fs-*` tier.
2. **A stock name with no anchor.** A rule can name a stock widget and still be harmless if it can
   only match inside its own app's markup: `#cbi-podkop-section > .cbi-section-remove` requires a
   podkop section. What pins it down is a name the theme does not know — the app's own. A
   selector built entirely from names the theme knows is pinned by nothing and matches the same
   widgets on anyone's page → invasive.
3. **Functional pseudo-class arguments are stripped** before looking for the anchor — and that is
   the whole difference between podkop and filemanager. `.cbi-button-save:not(.custom-save-button)`
   also names an app class, but **inside a negation**: it does not require that markup, it excludes it.

**The only safe removal is a byte-identical second copy.** Not removing is expensive where an app
injects on every render: podkop calls `injectGlobalStyles()` from `render()` (4 KB, unguarded)
and `luci-app-mosdns` re-attaches three CodeMirror `<link>`s, so every SPA visit adds a copy the
browser parses forever. An exact duplicate is safe to drop for the same reason sweeping was not: the
rules do not go anywhere — the surviving copy is byte-identical, and a library's "have I imported
this already?" check still finds its sheet. **The FIRST copy is kept**: that is the one the app holds
a handle to. `watchViewSheets()` observes `<head>` rather than sweeping on navigation, because podkop
injects from `render()`, which resolves after the router's `require()` callback — sweeping on
navigation left the document carrying one permanently stale copy. The observer cannot loop: a removal
is a mutation with no added nodes, and the handler returns when nothing was added.

### Which page a sheet belongs to

A sheet the module re-hosts into the theme layer is remembered with the page it arrived for, and
`scopeToCurrentPage()` — called by the router right after it stamps `data-page` — enables the ones
belonging to the page on screen and disables the rest. The key is the **resolved** dispatch path,
not the URL: `/admin/status` and `/` both resolve to `admin/status/overview`, and a key taken from
the address bar could never match the one the router hands over one navigation later, so the first
navigation away disabled the sheets that page owns for good (measured with `luci-app-mwan3`, whose
status include sizes the interface cards: 240px wide on a full load, 966px after one round trip).

Two things decide the owner, and both exist because **a require in flight cannot be stopped**:

- **The router names the owner for a COLD require** (`sheets.attributeTo(segs, gen)`), because on a
  first visit the require *is* the render: the module's `<style>` can land after a newer navigation
  has already stamped `data-page`, and it belongs to the page that asked for it. A require that
  resolves from LuCI's class cache injects nothing and therefore never touches that slot — it used
  to, and clearing it a microtask later is what put a superseded page's sheet on the page that
  superseded it (`luci-app-filemanager`'s `.cbi-button-save { display: none !important }`, live on
  System → System). The slot carries the navigation generation that set it, so a stale require's
  cleanup cannot clear a slot a newer one now holds. Two *cold* requires overlapping still credit
  the older one's sheet to the newer page: LuCI evaluates a view module inside `eval()` in its own
  `require()`, so nothing observable says which module is running when a `<style>` appears.
- **A sheet is scoped the moment it is taken**, not at the next navigation — otherwise a late
  arrival paints whatever page is on screen until the user clicks again. That switch is the **last**
  step of re-hosting: `el.disabled` is the element's view of `el.sheet.disabled`, and assigning
  `textContent` (which is how the sheet is wrapped in `@layer theme`) throws the old
  `CSSStyleSheet` away and builds a fresh, enabled one — so switching off before the wrap switched
  it back on within the same call.

## Module prefetch

`wireRouter()` adds a delegated `pointerover`: entering a link to an SPA-able node `fetch()`es its
JS module to warm the browser's HTTP cache — not `require`, which would run `__init__` and render
a foreign view into `#view`. The URL is built by `moduleUrl()` byte-for-byte as `LuCI.require()`
builds it, or it misses the cache. Deduplicated by class name; errors are swallowed.

**The walk is transitive, and that is most of the win.** Warming one view class leaves its own
`require` pragmas an extra round trip away: `view/network/routes.js` pulls `tools/network.js`
(40.5 KB). The root's bytes are already in hand, so the body is scanned for pragmas for free and
what it finds is warmed by the same `fetch()`. Measured at 120 ms RTT, first visit:
`network/routes` 418 ms with only the view warmed against **296 ms** with dependencies — exactly one
RTT. Across six pages: 1713 ms without prefetch → 1184 → **1052**.

Three traps, each one actually hit:

- **Pragmas cannot be scanned line by line.** On a router the files are minified and every pragma is
  on one line, so `/^'require …'$/m` finds nothing — silently. The first version of this feature
  measured its own gain as zero because of it. `luci.js` lexes the leading string literals; we read
  the same file head with one regex.
- **Six class names have no file**, and requesting one is a guaranteed 404 in the user's console.
  `luci.js` keeps its registry as a literal (`baseclass`, `dom`, `poll`, `request`, `session`,
  `view`) and answers `require()` for them from memory. Every view file's pragmas name `view` and
  `baseclass`, so the walk trips on this at the first step. That literal used to be copied here; the
  rule is now the SHAPE of the name — a class name is a path, so a name with no dot is either one of
  those virtual classes or a flat library (`ui`, `form`, `network`, `uci`, `rpc`, `fs`,
  `validation`), and the chrome has already loaded every one of those before a prefetch can run
  (measured from three landing pages including System → Reboot: all eight were instances on
  arrival, and a walk over seven pages fetched 10 files, all of them nested). Declining the flat
  half outright therefore costs nothing measurable and covers a seventh built-in before it ships.
  The dotted half is asked properly: `require()` attaches a class at its path, so `tools.widgets`
  reads back as `L.tools.widgets` once any form page has pulled it.
- **Speculation stops under an already-clicked link** (`_committed`). After the click, `require()`
  fetches the same graph and parallelises parsing with loading; our walk would only race it.
  Measured at 120 ms RTT: 658 ms waiting for the whole subtree against 525 ms racing — for a
  duplicate that stopping avoids entirely.

**A click waits for an unfinished prefetch rather than racing it** (`warmedThen()`). Two requests for
one URL are not coalesced, so a click that lands before the prefetch finishes downloads the module
**twice**, both at full latency, and gains nothing. On a **touch device this is the normal case**:
`pointerover` arrives at the same moment as the tap. Waiting costs nothing — the XHR would have
waited for those bytes anyway — but is capped by `WARM_WAIT_MS` so a hung prefetch cannot hang the
navigation.

**Three triggers, because a pointer is not the only way to choose a link.** A keyboard user tabs to
a link and presses Enter, producing no pointer event at all — `focusin` covers that.
`pointerdown` adds the one case `pointerover` misses: a link that scrolled under a stationary
cursor crosses no boundary and fires nothing.

**Recent-page warming** lives in `fs-search.js` (`warmRecent()`), because the recents list belongs to
the palette; the edge points `search → router` through the exported `prefetchSegs` so the router need
not know about the palette. At most 5 entries, the current page excluded, `requestIdleCallback` with
a timeout, and a full opt-out on `navigator.connection.saveData` — speculation should be the first
thing to go on a metered link, while hover prefetch stays (there is a deliberate gesture behind it).
Walking the whole menu instead would pull every view module on the box. Measured at 120 ms RTT with a
cold HTTP cache and **no hover at all**: `network/routes` 289 ms against 553 cold, `network/dhcp`
315 against 443, `system/system` 288 against 421.

## Background polling pause

`wireVisibility()`: `visibilitychange` → a hidden tab does `L.Poll.stop()` (clearInterval, queue
intact), showing does `L.Poll.start()` (re-arm plus an immediate `step()`). LuCI has no handler of
its own, so status/overview in a background tab otherwise hammers ubus 24/7 (the expensive iwinfo
`getAssocList`). Only what we paused is resumed (`wasActive`) — the user may have stopped polling by
hand through the "Refreshing" indicator, and an unconditional `start()` would silently undo that.

## Accessibility of a route change

A route change fires neither `load` nor a document change, so assistive technology learns nothing:
focus dies with the `<a>` that the chrome just redrew, and the new `<title>` is not announced. Only
two things are actually required by WCAG 2.2, both level A:

| SC | Level | Required? |
|---|---|---|
| **2.4.2 Page Titled** | **A** | **Yes.** Understanding names SPAs explicitly |
| **2.4.3 Focus Order** | **A** | **Yes.** Focus dropped on `<body>` is a failure |
| 4.1.3 Status Messages | AA | **Mostly no** — it excludes anything delivered by a change of context. It bites on *loading* states, not route announcements |

So a route announcer is best practice, not conformance. The claim "4.1.3 requires one" is false.

What the router does: writes `document.title` and syncs the sr-only `<h1>`; focuses
`#maincontent` with `focus({preventScroll:true})` (scroll is handled a line earlier); announces the
page in `#fs-nav-status` (`role="status"`, `aria-live="polite"` — not `assertive`, for a
user-requested navigation). The two texts deliberately differ ("Skip to content" vs the page
name), which is the condition under which a focus move and a live region complement rather than
repeat each other.

**Keyboard activation gets the hybrid Sutton recommends**: `ev.detail === 0` on the click means the
link was activated from the keyboard, so `.fs-skip` takes focus — a small target with a visible
focus overlay, from which Enter jumps into the content. Pointer activation and `popstate` (input
modality unknown) keep focus on the wrapper, so the skip link does not flash on every mouse click.

Why not focus the `<h1>`: ours is clipped under `.fs-sr`, and focusing an invisible target tells a
sighted keyboard user nothing about where they are — and those are exactly the users the skip-link
variant serves.

## Scroll

`pushState` performs no scroll save/restore at all — those steps belong to document-changing
navigation and traversal, and the URL-and-history-update steps skip them. Three facts worth knowing
before touching this:

- **`history.scrollRestoration` is a property of the history ENTRY**, not a global. New entries
  inherit the active one's mode.
- **`manual` does not mean "it will land at 0"** — set the position explicitly, including to the top.
- **Keying a saved offset by URL is wrong** (A→B→A gives several entries with one URL), and
  restoring only works once the content has height.

**The two layouts genuinely scroll different elements** (measured, Software page, 1440×900):

| layout | document | `#maincontent` |
|---|---|---|
| `sidebar` | does not scroll | **scrolls** |
| `top` | **scrolls** | does not scroll |

So Back restores scroll in `top` and not in `sidebar` — the same theme behaving differently
depending on a client setting, which nobody chose. Fixed by saving `#maincontent.scrollTop`
explicitly, with one difference from the obvious sketch: **the offset is NOT kept in
`history.state`**, because Safari rate-limits history writes (100 per 30 s). `history.state` holds
only a session-unique entry id (`fsid`, stamped once per entry); the offsets live in an in-memory
`Map` in the router, which dies on a full load exactly when the browser takes over restoring
internal scroll regions. Saving happens at the two exit points (click and popstate, while the old
DOM is still on screen); restoring is a rAF loop until the height appears, cancelled by navigation
generation, capped at ~5 s.

`scrollRestoration` is deliberately left alone: `manual` is inert in `sidebar` (the document does not
scroll) and would take away working restoration in `top`.

**The replay starts at the SWAP, not at the traversal**, and that is a bug the staged render
introduced rather than a refinement. `restoreScroll()` writes as soon as the scroller is tall enough
for the saved offset — and while the incoming page renders off screen, the outgoing one is still on
it, so the height that satisfies the test can be the page being left. Measured in the `top` layout:
parked at 386, restored to 386 while Processes was still up, then the swap put a shorter page in its
place and the browser clamped the offset to 197. The popstate handler therefore hands the offset to
`navigate()` (`_pendingRestore`) and the commit replays it, when there is only one height to read.
Verified in both layouts afterwards: parked 411 → restored 411 in `top`, 370 → 370 in `sidebar`.

## A dead session ends the document

luci-base answers an expired session with `notifySessionExpiry()`: `Poll.stop()` plus a modal whose
only button reloads, which the dispatcher then answers with the login form. Every navigation of ours
does the opposite of both halves — `ui.hideModal()` and `Poll.stop()` + `start()` — so before this
existed, the first click after the session died dismissed luci-base's own warning and browsed on.
Measured on the stand: kill the session from inside the document, let one rpc reject
(`SessionError`, modal up, polling stopped), then click a menu link — the router swapped the view,
the modal was gone and the page sat on "Loading view…" with every call behind it failing; only a
reload reached a login form. Now the same click is a full load that lands on the login form.

`watchSession()` (fs-router.js) learns it from luci-base's own two decision points, through the
documented interceptor APIs:

- `L.Request.addInterceptor` — a `403` carrying `X-LuCI-Login-Required: yes`;
- `rpc.addInterceptor` — the `session.access` probe luci-base fires after some other call came back
  `-32002`, when that probe carries an `error` with a code and a message. That is the condition
  under which `rpc.js`'s `handleCallReply()` rejects on an ANSWER, i.e. what upstream's own
  `.catch(notifySessionExpiry)` reacts to. A frame that is not JSON-RPC 2.0 is rejected there too
  and is deliberately NOT read here: it says the reply is malformed, not that the session ended.

`access: false` is deliberately not one of them: the probe is declared `expect: { access: true }`,
so a `false` answer resolves rather than rejects and luci-base carries on. It is an ACL answer, and
treating it as a dead session would drop a restricted user out of the SPA for the rest of the
document over a permission they simply do not have. (luci-theme-aurora's otherwise-equivalent gate
does treat it as expiry.)

Neither interceptor may throw: luci-base runs both through `Promise.all(…).catch(req.reject)`, so an
exception in there would reject the caller's own request. Both bodies are wrapped.

**The verdict is reversible, and that is not a softening of it.** It was a latch, and a latch is the
wrong shape for a signal read off somebody else's reply: an interceptor sees a message only once the
transport succeeded and the body parsed (`parseCallReply()` rejects before that), so a missing or
malformed frame is not a network flap — but it is a captive portal's page, a proxy's error body, one
truncated reply, and any of those took client navigation off for the rest of the document while the
session was alive throughout. A `session.access` answering `access: true` proves the sid is
live, so it counts as evidence the other way and clears the flag. If the session really has ended
none arrives, because every call carries the same dead sid — the router stays off exactly as long as
it should, and the visibility handler still will not restart a poll while the flag is up, so a tab
coming back into view spends no burst of failing calls.

**Which reply means what is measured, not assumed** (all four stands, 24.10 and 25.12, both
distros): a live sid answers `[0, {access:true}]`, a DEAD one answers `[0, {access:false}]` — HTTP
200, no error frame — and the `-32002` that made luci-base fire the probe landed on the ordinary
call before it. So "the reply parsed" is not "the session is there": reading it that way would clear
the verdict with the very probe that confirms it. `access: false` therefore moves the verdict in
neither direction, for the same reason it may not expire a session: an ACL denial looks identical. `tools/upstream-contract.mjs` carries the
`expiry-signals` probe for the day upstream renames any of it; `tests/session-expiry.test.mjs` holds
both directions.

## Boundaries and degradation

- **The boot contract: a luci-base without one of the surfaces this router calls turns CLIENT
  NAVIGATION off — the theme itself keeps working, every link simply becomes a full load.**
  `wireRouter()` looks up twelve names before it wires anything —
  `L.require`, `L.Class`, `L.dom.content`, the five `L.env` keys a navigation re-points,
  `L.Poll.queue`, `L.Poll.start/stop`, `L.Request.addInterceptor`, `rpc.addInterceptor`,
  `ui.instantiateView`, `ui.hideModal`, `ui.hideIndicator`, `ui.addNotification` — and on a miss it
  logs *which* and returns. The page is then the server-dispatched MPA the theme was before the
  router existed: every link a full load, nothing else lost.

  Not a duplicate of [`tools/upstream-contract.mjs`](../tools/upstream-contract.mjs), which asks
  whether those surfaces still BEHAVE as assumed — the deeper question, and the one that caught the
  `network.js` coupling. But that gate only ever runs here, against the two userlands this repo owns.
  A fork, a backport or a distribution that trims `luci.js` is a luci-base nobody in this repo can
  run, and there the first symptom used to be a click that opened nothing: the interception ran, the
  swap threw halfway, and the reader was left on a page the theme had half torn down. Existence at
  boot, semantics in the live gate.

  The check is existence-only on purpose. A probe that called these to see what they answer would
  have to run them for effect — there is no dry `instantiateView` — and a boot check that navigates
  is worse than the fault it looks for. `uci` and `L.network` are deliberately out of the list: they
  are optional at their own call sites (a document that never loaded `network.js` has nothing to
  refill) and are guarded there.

  The OFF branch cannot be seen on a stand, since both stands ship every name, so it is pinned by
  [`tests/router-contract.test.mjs`](../tests/router-contract.test.mjs) instead: a hand-broken `L`
  must name exactly the surface that is gone, a probe that throws counts as a break, and a broken
  contract must leave the document with no click interception on it at all.
- Layout is irrelevant to the router: there is one renderer, and sidebar/top is a client attribute
  the CSS morphs.
- **A document the router could not have rendered is not one it navigates away from.** `wireRouter()`
  asks whether the page it booted on resolves to a node the theme can serve; a `call`, `cbi`,
  `function` or foreign `template` node may carry inline timers set before this module was evaluated,
  which no teardown of ours can retire — only the document's death. The test is deliberately narrower
  than "did the path resolve": a path the tree does not know (a wildcard URL such as
  `admin/network/wireless/radio0.network1`) keeps today's behaviour, or the router would switch
  itself off on some of the most-used pages in LuCI. On the stands this is a no-op: of 243 menu
  nodes the 110 `call` and 8 `function` ones answer with JSON or a redirect and never render this
  theme, and the one `template` node is the Overview, which the router does serve.
- Third-party apps that register `view` nodes speed up automatically.
- **Status→Overview** (`template` node `admin_status/index`) is the SPA exception: its server
  template only defines three global helpers and calls `ui.instantiateView('status/index')`. The
  theme reproduces that — `fs-overview.js` calls `ensureOverviewHelpers()` at its own module eval,
  which defines the helpers idempotently (the template's inline script does not run under SPA), and
  the router then instantiates `view.status.index`. The helpers are deliberately NOT the router's:
  they are luci-mod-status's globals, and a router that owned them would be reaching into another
  module's namespace. Other
  `template` nodes → full navigation.
- Legacy `cbi` and `call`/`function` handlers → full navigation.
- Any require/instanceof error → `console.error(...)` and `window.location = pathname`. The error is
  **logged** deliberately: a silent fallback made every router regression look like "the page is
  just loading slowly".
- A cold route gets a placeholder immediately — `#view` used to hold the previous page under the new
  title until the view module arrived (measured at 600 ms latency: old content at 150 and 400 ms,
  a spinner only at 900 ms). The idiom is luci-base's own (`div.spinning` + the `Loading view…`
  msgid), so there is no jump on replacement and the string arrives translated.

## What is left alone, and why

Three kinds of not-doing, kept together so the next reader finds the answer before re-deriving it:
something measured and judged not worth fixing, something that cannot be fixed from here, and
something that must not be picked up again.

### Deliberately not fixed: timers a departing view leaves behind

**A departing view's `setTimeout` and rAF survive navigation.** The router hooks `setInterval` only.
Measured: `timeout 22 → 34 (+12) SURVIVED`, `interval 6 → 6 (+0) silenced`,
`raf 256 → 406 (+150) SURVIVED`.

But the measurement is synthetic — the tickers were planted by the test — and a search for a real
victim failed. Across every view on the router (6 installed `luci-app`s), every `setTimeout` is
one-shot: podkop's toast, package-manager's filter debounce, `system/reboot`'s modal,
`awaitReconnect`. There is not one self-rescheduling `setTimeout` or rAF loop; podkop's log
tailer, the thing this was for, runs on `setInterval` and is already covered.

**And a blind fix breaks real things**, also verified in the code: `ui.js` keeps tooltips, the
notification timeout and a `setTimeout(rejectFn, 1000)` on timers, so killing all pending
`setTimeout` on navigation breaks all of that. A blind `cancelAnimationFrame` **irreversibly breaks
`fs-fit.js`**: its callback clears the `_rafPending` flag, so a cancelled frame leaves the flag
`true` forever and the fitter dies silently for the rest of the document's life.

The asymmetry with `setInterval` is its own justification: the core uses `setInterval` for exactly
one thing, the `L.Poll` tick, which the hook explicitly preserves (`keep = L.Poll.timer`). "Kill
everything but one" is a correct operation there and has no equivalent for `setTimeout`/rAF. **If
such a view ever appears, the right answer is a targeted cancel through `onNavigate`, not a global
hook.**

### Deliberately not fixed: global listeners a departing view leaves behind

**A view's `window.addEventListener` survives navigation, and hooking it the way `setInterval` is
hooked would be a one-way deletion — the same mistake as sweeping a view's CSS.** The proposal is
always the same: wrap `addEventListener`, keep the tuples, `removeEventListener` them all in
`navigate()`. The asymmetry that makes the interval hook correct is exactly what makes this wrong.

A poller is re-created on every render, so clearing it costs nothing — re-entering the page starts a
new one. A listener registered at a module's TOP LEVEL is created once, because `L.require` caches
the module for the life of the document and never runs its factory again. Remove it and it is gone
for good, on every later visit, with no error and nothing to re-run it. That is the ACE stylesheet
bug in a different medium (see [third-party-apps.md](third-party-apps.md)).

Which shape the real apps have is a measurement, not a guess. Grepped on owrt2512: **9 view files
register global listeners** (`system/filemanager`, `system/sshkeys`, `ssclash/config`, ACE itself,
`justclash/{connections,realtime_logs,status}`, `adblock/dnsreport`, `nlbw/display`) — 15
registrations, mostly `beforeunload` and `visibilitychange`. Then measured through CDP
`DOMDebugger.getEventListeners` on `window` and `document`, **8 SPA round trips overview →
File Manager → overview**, counted at the same page each time: **27 → 28 on the first visit, then
flat for all 8** (`window:click` +1, once). ACE adds three the same way on ssclash. Nothing
accumulates, because nothing re-registers — which is the direct evidence that these are module-eval
registrations, i.e. exactly the ones a sweep would delete permanently.

A sweep also cannot tell them from ours or from LuCI's: `luci.js` and `ui.js` register 21 listeners
on `document` between them (`validation-failure`, `poll-start`, tooltips), the theme registers its
own, and a global hook sees one undifferentiated list. **If a view that re-registers per render ever
appears, the answer is a targeted teardown through `onNavigate`,** the same conclusion the
`setTimeout`/rAF section reaches.

### Still open: in-flight responses

**In-flight responses are not cancelled on leaving.** Measured: an XHR still in flight when you
navigate is still in flight afterwards and will arrive and run. There is nothing to cancel it with —
`L.Request` keeps its `xhr` in local state and accepts no `signal`. **Correctness is not affected**
(that is the generation counter's job), but it is waste: a ubus call the router will execute and
throw away, competing with the page the user actually opened. Honest conclusion: **only upstream can
fix this** (`L.Request` would have to accept a `signal`). Recorded so nobody hunts for a handle that
does not exist.

### Explicitly do not touch

- **Navigation API.** It is objectively the better model and cheaper than ours — one `navigate`
  event for every navigation including your own `pushState`, `NavigateEvent.signal`, `intercept()`
  with `focusReset`/`scroll`. We do not take it on support grounds: Baseline "newly available"
  only since January 2026 (Chrome/Edge since 2022, but **Firefox 147 and Safari 26.2 are January
  2026**), and a router is configured from whatever machine is to hand — a corporate Firefox ESR, a
  macOS stuck on Safari 18. `precommitHandler` is absent from Safari entirely. Revisit around 2027,
  as a feature-detected progressive enhancement.
- **`history.scrollRestoration = 'manual'`** — inert in `sidebar`, actively worse in `top`.
- **A second "does it fit?" observer** — that is `fs-fit.js`. See [conventions.md](conventions.md).

## Verified

- **No leaks, and that is a measurement.** 20 navigations across 4 pages, real listeners read
  through CDP `DOMDebugger.getEventListeners` (not a count of `addEventListener` calls — the browser
  deduplicates an identical type/ref/capture triple, and the naive counter lied, showing +5
  `window:click` per navigation that do not exist). `window` and `document` counts identical
  before and after; heap **10.0 MB → 10.0 MB**. The centralised `fs-fit.js` (one ResizeObserver for
  the document's life instead of one per view) is the structural reason this is clean.
- **A long soak says the same thing about the CACHE, which is the part a SPA is actually accused
  of.** 72 navigations over 12 distinct pages on 25.12 and 96 on 24.10, sampling always on the same
  page after a forced GC: after the FIRST pass everything is pinned to the byte — heap
  **21.16 → 21.13 MB**, DOM nodes 26998 → 26998, listeners 8110 → 8110, documents 13 → 13, poll
  queue 1, view intervals 1, over the following 60 navigations; on 24.10, 3.68 → 3.66 MB and
  2116 → 2116 nodes over 96. A full-load run of the same walk sits at 4.4 MB, flat.
  That difference IS the cache and it is one-time: measured per page, the first visit costs
  0.02–1.18 MB except `admin/system/package-manager`, whose package index costs **+16.9 MB** and
  keeps it until a real reload. Nothing the theme owns grows — the structures are `WeakMap`/
  `WeakSet` or capped (`SCROLL_MEM_MAX`), and the one-per-document `fs-fit` observer is why the
  listener count does not move at all.
- **A full walk of all 65 clickable nodes**, in both layouts, comparing each against a **real full
  load of the same URL**: **62 SPA-OK, 0 divergences, 3 fallbacks**. `data-page`, `dispatchpath`,
  `pathinfo`, URL and tab count all match; console clean. Back/Forward through a chain of alias and
  firstchild URLs (6 back + 3 forward): not one reload.
- Complex CBI form views (Interfaces, DHCP) render fully, the save/apply footer is present, pollers
  are alive.

**Trap when writing such a walk: do not iterate the tree's leaves.** A node with an `action` can have
children, and `alias`/`firstchild` nodes almost always do. A leaf walk skips exactly the 8 nodes
where the bug lived.

Another trap that cost a false alarm: `admin/status/channel_analysis` shows `.spinning` forever,
on SPA and on a full load alike. That is the page's own spinner (an airspace scan), not a stuck view
spinner. Compare against a full load, never against an expectation.
