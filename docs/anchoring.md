# Keeping the reader's place

A poll tick changes the height of something above the reader and the page under them moves. This
page is every mechanism the theme has for that: what each one is, the invariant it holds, and the
one number that justifies it. `fs-fit.js` cites a heading here.

**The findings are next door.** [anchoring-log.md](anchoring-log.md) carries every measurement, every
disproven diagnosis and every attempt that was measured and rejected, one heading per finding. This
page states the rule; that page says how it was learned. The chrome's half — which element a
correction may take, why data tables are excluded — is in [chrome.md](chrome.md).

The measurements are `tools/scroll-anchor.mjs` on the stands, `tools/floor-contract.mjs` for the
floor and `tools/fit-quiet.mjs` for the chrome.

## Who is responsible: `ENGINE_ANCHORS`

Chromium, Firefox and — since WebKit 26 — Safari implement **scroll anchoring**: the engine picks an
element the reader can see and moves the offset itself so that element stays put. The theme asks the
platform, `CSS.supports('overflow-anchor', 'auto')`, and never a browser name.

**The answer decides which half of `fs-fit.js` runs.** Where the engine anchors, growth above the
reader is its job and the theme only cleans up the residual (`lateDrift()`); where it does not, the
theme owns the whole correction (`anchorFor()` → `scheduleAnchor()` → `applyAnchor()`). Running both
is not a safety net: two corrections throw the page the other way, which is the fault the detection
exists to avoid.

The property no longer separates one engine from another — all three answer `true`. The 21-41px
WebKit was once read as mis-anchoring was the bar's own box walking 230 → 123px inside one
`fitChrome()` pass; with that pin held both ways the same probe reads 0px with no suppression at
all, and `ENGINE_MISANCHORS`/`data-fs-anchor-suppress` are gone from the tree
(anchoring-log.md, "Why WebKit looked like it was mis-anchoring").

## When the platform check is not enough: `_engineTrusted`

`ENGINE_ANCHORS` answers once, at load, whether the property EXISTS. An engine that has it and
declines to use it on a given refill is invisible to it, and that happens: `lateDrift()` had to
write the residual back on two passes of a real, trusting engine.

So the evidence accumulates instead of being guessed at. Each residual `lateDrift()` actually writes
increments `_lateMisses`; at `LATE_MISS_LIMIT` (2 — one is headroom for a one-off, a second is a
count) `_engineTrusted` goes false and every later refill takes the `anchorFor()`/`scheduleAnchor()`
path. `TRUST_RECOVERY_LIMIT` (2) refills where the remembered reference holds its own position put
it back. Never a browser name, only a count: Chromium and Firefox measure 0 residuals on the pages
the sweep covers, so the switch cannot trip for them.

| number | what it buys |
|---|---|
| `lateDrift()` on a page that was already still: 8-61ms; on one that was not: 419-420ms | the slow road is the price of telling a flick from a still page |
| `applyAnchor()`: 7-36ms | why distrust switches paths rather than waiting harder |
| `LATE_ROUND_TOLERANCE` 16px | the largest table-row rounding measured is 12.25px; 16 leaves 30% over it and stays far under half a 120px growth |

## How long to wait is a question about the reader

`lateDrift()` waits one frame and then decides. Where `scrolling()` and `_userUntil` both say nobody
is driving and nothing has moved, the only thing that can have touched the offset since the
reference was taken is the engine, whose window is 7-36ms — so it settles in the frame it already
has. Where the page is, or might be, in motion it waits `SCROLL_IDLE` instead.

**The fork decides HOW LONG to wait, never WHETHER to write.** The `scrollTop() !== seen` check runs
on both roads. Measured over nine `engine DECLINES` cells, three engines against three stands:
404-422ms → 8-61ms, with the engine-on (4-19ms) and engine-off (6-44ms) cells unmoved and `mid-flick
surprises` at 0 on all 27 (anchoring-log.md, "How long to wait: the fork that closed the 419 ms
road").

## Is the page moving: `scrolling()`

Asked of the scroll POSITION, one read per frame, never of the event stream: on iOS momentum carries
the page long after the finger has gone and events do not reliably arrive through it, so a timer off
the last event declares the reader still and drops a deferred pass into the middle of the glide.

`SCROLL_IDLE` is 400ms, and it is the fix for the shaking rather than a tuning knob: against an
imitated slow rock, 137-256px of roughness at 200ms and 59px — the floor, one pixel of rounding per
frame, the same as switching the fitters off — at 250ms and above.

Three markers keep this file from reading its own writes as the reader:

| marker | question it answers | who reads it |
|---|---|---|
| `_ownWrite` / `sawOwnWrite()` | is this pixel where my own last write landed? | the motion sampler and the `scroll` handler, both, for the same pixel |
| `_clampedTo` / `sawClamp()` | is the motion blocking this correction the clamp the correction is FOR? | `applyAnchor()` alone — `scrolling()` itself is untouched |
| `_userUntil` | is the reader DRIVING, as opposed to the page moving? | `lateDrift()` and `settleDeferredFloor()` |

`writeOffset()` is the one door either correction writes through, and it reads the offset back: a
write near either end of the document is clamped, and the pixel that lands is the one the next
`scroll` event reports.

## The document may not get shorter: `holdFloor()`

`dom.content()` — what every LuCI poll calls — empties a container before it refills it. A layout
taken while it is empty clamps the reader's offset into a document that was never really that short,
and nothing puts that back. So each container a poll empties carries a `min-height` at the height it
had at the last settled moment, written BEFORE the tick rather than during it.

Every floor is cleared, the box re-measured, and the floor written back where that answer is above
zero. Nine things are load-bearing, and each was a measured failure first:

- **On the containers, not on the column.** `min-height` on an ancestor of the engine's own anchor
  suppresses its anchoring (css-scroll-anchoring-1 §2.2.2), so a floor on the column bought the
  clamp back: 120px of growth moved the page all 120px, Chromium and Firefox alike.
- **Not on a table box.** `min-height` is undefined there (CSS 2.1 §10.7) and WebKit acts on it: a
  `.table` wearing a 313px floor still collapsed to 30px and the document lost 284px. The floor
  climbs to the first box that is not a table.
- **Written before the tick.** Pinning from inside the same statement sequence does nothing —
  `dom.content()` performs no layout, so no layout ever sees the pin: 1882px still clamped away.
- **Cleared and re-measured, not read off the content.** The clear is what makes every other question
  answer itself: a collapsed tab pane measures 0 and keeps no floor, where a content reader pinned
  the collapse open (893px, issue #41). `tools/floor-contract.mjs` holds it: 175 floors, worst 0px
  against the box.
- **Written at the box's own rect height, not `offsetHeight`.** An integer floor stands up to half a
  pixel taller than its content; 22 such boxes made the document 2px taller with the floors than
  without, and the next clear handed that back as a clamp — 6 of 12 refills corrected against 12 of
  12 (anchoring-log.md, "The floor is written half a pixel too tall").
- **Found by its own mark.** A box qualifies through its CHILDREN and the climb can floor a box that
  is not in `SHRINKS` at all, so emptying the table under it takes the section out of the sweep:
  927px still standing 13 s later. Every floor carries `data-fs-floor` and the sweep looks for its
  own mark.
- **Only the boxes a mutation touched are re-cleared.** 725 clears and 625 writes per 25 s of real
  polling, of which 610 wrote back the value already standing; scoping to the mutation's own targets
  reads 70/70 with `changed` unmoved at 15 (anchoring-log.md, "A box nothing touched must not be
  re-cleared"). Every other caller passes no records and still gets the full sweep.
- **A tab switch, a fold and a `depends()` row wake the sweep too.** None of them moves a node, and
  `min-height` beats the `height: 0` a hidden pane collapses with: 1299px of blank left standing on
  Network → Interfaces, 258px on an unticked NTP client. `_moTabs` watches
  `data-tab-active`/`hidden`/`aria-expanded` plus `class` where the element carries `data-field`.
- **A write that changed nothing is not a change.** The fitters re-apply their classes every pass by
  design, so an unguarded `class` watch is a feedback loop: 391 callbacks in 432ms, 3910 records, the
  tab never returning. `_moTabs` compares `oldValue` against what the attribute reads now — 2
  callbacks, 20 records, 0 sweeps (anchoring-log.md, "A same-value class write is a feedback loop").

**The sweep puts back the offset its own clear pass took.** For the length of the measure pass the
document stands without its floors; 8 sweeps of 38 took it down one pixel and the offset with it,
and one pixel is enough for `lateDrift()` to read the page as moving and discard a 60px correction
whole. The restore is conditional on the scroller being as tall again as it was, which is what
separates the transient from a real shrink; a real shrink records the pixel the browser's clamp
landed on for `applyAnchor()` instead.

## A floor cleared late: `_deferredFloor` and `settleDeferredFloor()`

`holdFloor()` refuses while the reader is moving, so a floored box whose content really shrank loses
the shrink only until the next successful sweep — which used to run unwired to any correction. The
box is stashed by the mutation callback and consumed once the reader is still: the correction is the
OFFSET's own response to that one write, `wanted = offsetBefore - shrink` against the offset two
frames later, and not a reference element's drift — a reference re-established on an already-wrong
offset shows zero drift for ever. Without it the reader ended 58-60px off on WebKit @390, both
layouts (anchoring-log.md, "A floor that shrinks with nobody watching").

## The growth witness: `grew`

`lateDrift()`'s drift is read off whatever `anchorRef()` hit-tested at the fold, and that element
need not sit below the container this tick refilled. `grew` is the second witness: the refilled
box's height now against the `min-height` `holdFloor()` pinned it at, read in the mutation callback
where the height is already final.

- **The floored box the record sits IN**, through `closest(FLOORED)` — `dom.content()` refills a node
  a level or two inside the pinned box on 1 of the 12 nodes a poll refills on the Overview.
- **Only growth ABOVE the reader's reference.** A box whose top is at or below the reference cannot
  move it; counting it wrote the whole growth back and threw the reader 120px the other way, 8 cells
  of 12 (anchoring-log.md, "Growth below the reader").
- **Not a number to write on its own.** Where the offset already moved (`compensated` non-zero) the
  engine has done the work and the gap is this witness's own rounding on a many-row table; only a gap
  over `LATE_ROUND_TOLERANCE` is a miss (anchoring-log.md, "The witness is not safe to write on its
  own").

## What the reader was looking at: `anchorRef()` and the memo

`anchorRef()` is one hit test at the fold, below `[data-fs-chrome]` (the bar is sticky; a test at
y=1 returns the chrome and the page gets no anchor at all). It refuses `#view` itself — a host's own
top does not move when something inside it grows, so a drift measured against it is zero for ever —
and it refuses data tables, whose layout the fit pass deliberately falsifies mid-pass.

`rememberRest()` stores that element with its top, the offset it was taken at and the page stamp
(`_rest`, `_restAt`, `_restPage`), from the last moment the page was still. The section around it
travels too, as the fallback for the ordinary case where the tick replaces the element itself.

`rememberRest(true)` skips the `scrolling()` guard, and only the caller that has just written the
offset itself may use it: the engine's own compensation for the same mutation settles inside the
same `SCROLL_IDLE` window, so an ordinary call a millisecond after a write is refused and leaves the
memo describing the page from before the tick — the 47-60px of fabricated drift the next refill then
measures (anchoring-log.md, "The reference after this file's own write must be re-taken forced").

`forgetRest()` voids the memo: the router calls it on a client navigation, where the offset reset is
not a clamp to undo.

## The corrections

| | runs when | what it does |
|---|---|---|
| `applyAnchor()` via `scheduleAnchor()` | the engine does NOT anchor | the whole correction, one rAF after the mutation, against `anchorFor()`'s reference |
| `lateDrift()` | the engine anchors | only what the engine left behind, against the memo from before the tick — the frame it already has where the page was still, a frame plus `SCROLL_IDLE` where it was not |
| `settleDeferredFloor()` | a floored box shrank while the reader was moving | the part of that shrink the browser's clamp did not take |

Each ends in one write through `writeOffset()` and reads nothing back. A correction that repairs
another correction is what the 0.14.4-0.14.6 reports were about; two such mechanisms were measured
and removed (anchoring-log.md, "Two mechanisms measured and removed").

## What must never be corrected

- **A page the reader is moving.** `scrolling()` reads the offset over frames rather than trusting
  the event stream. A correction landing inside a flick is itself a jump (161px, webkit/Overview).
- **A page the reader just acted on.** `_userUntil` holds the correction off after a deliberate act.
- **A page that is not the one the memo belongs to.** `_restPage` travels with the memo.
- **A batch that only took nodes away.** The empty half of a refill is a page about to stop
  existing: arming on it wrote -834px for a refill that grew the page by 120. Superseding the armed
  call with the later batch is worse — a real tick delivers around twenty records and every arm
  cancels the last: 12 findings of ordinary drift (anchoring-log.md, "The later batch must not win").
- **A batch that emptied and refilled `#view` itself.** That is a page swap, not a refill — see "The
  commit is not a refill" below.

## What the engine is told

`theme/30-tables.css` sets `overflow-anchor: none` on `.table.fs-dt` — the data tables the fit pass
re-lays. Without it the engine anchors inside a table whose layout the theme is about to falsify.
`theme/20-shell.css` carries no anchoring rule at all.

## The dev switches

Each is read at the point it gates and nowhere else, so a device that misbehaves can be asked which
half of this file is responsible.

| switch | effect |
|---|---|
| `localStorage.fsFit = 'off'` | no fitter runs, and no floor is written |
| `localStorage.fsAnchor = 'off'` | the theme writes the scroll offset nowhere |
| `localStorage.fsEngineAnchor = 'off'` | any engine takes the non-anchoring path — how the sweep reaches it, and how a Safari-only report is reproduced on a machine with no Safari |

## Navigation is a different question

`fs-router.js` keeps its own scroll memory (`_scrollMem`, `saveScroll`/`restoreScroll`) so Back
returns the reader where they were. That is per history entry, not per tick, and none of the above
applies to it — see [spa-router.md](spa-router.md).

### The scroll reset

A forward click resets both scrollers to the top — `window.scrollTo(0, 0)` and the same on
`#maincontent` — because a full load starts the new page there and the in-place swap has to match
it. That write runs in the same synchronous turn as `commitStage()`, at the swap, not at the click.

**Measured with the incoming module's fetch held open 1.2 s** (`owrt2512`): at the click, `y` reached
0 within 12 ms and stayed there for the whole staging window — the reader, still looking at the
OUTGOING page, found themselves at its top before they had any reason to be. Moved to the commit,
`y` holds the reader's own offset (1878px in the measured run) for the entire window and reaches 0 in
the same frame the incoming content replaces it, which is what a full load looks like.

**Why the corrections above are untouched by that move.** They all correct a scroller that is meant
to STAY PUT while the document under it changes. A forward navigation is the one case deliberately
moving the reader, to a page they chose. What does NOT move is `fit.forgetRest()`, still called at
the click: from that point the reader is committed to leaving, and a mutation the outgoing page's
poller makes during the staging window must not be read against a reference belonging to a page
about to go away.

### The commit is not a refill

`fit.forgetRest()` at the click is not enough: the commit arriving seconds later reaches `fs-fit.js`
as an ordinary content mutation and re-establishes a reference of its own. The browser delivers
`dom.content()` on the live `#view` as TWO batches; `run()`'s own `rememberRest()` fires between them
and adopts a reference measured mid-swap, which `lateDrift()` reads 431px out 420ms later and writes
back over a correct `restoreScroll()` (2723 → 2292.21875, chromium, Back to the Overview).

**The page stamp cannot see it, in any form.** `navigate()` restamps `body[data-page]` seconds
before the commit and `commitStage()` restamps `#view` and `.fs-content` before `dom.content()`, so
every stamp in the document already names the incoming page; carrying the stamp on the reference
instead is the same number twice.

**What holds.** A batch that both removes and adds children of the live `#view` is `dom.content()`'s
own shape on the one node only `commitStage()` calls it on. On such a batch the observer calls
`forgetRest()` and returns: the memo is void and the next tick re-takes one on a settled page. 3 of
3 red before, 3 of 3 green after, no `writeOffset()` logged at all. Testing the target alone does
not hold — `HOLD` grows the page by inserting a pad as `#view`'s own first child and matched too,
leaving 120px uncorrected on all three twins (anchoring-log.md, "What the sweep itself could not
see"; `spa-parity`'s `back-scroll` case is the gate).

## Is each one still needed

One mechanism disabled at a time, on the agent's own stand so nothing else moves, over the axes that
mechanism is supposed to hold. `tools/scroll-anchor.mjs`, `--width`/`--layout` to reach the cell and
`--full` to cross the rest; every number below is what the sweep printed. A cell is only counted
when it repeats — a lone finding on one pass is the parallel-stand noise `development.md` describes.

**The poll belongs to one case of the sweep, and that is part of the measurement.** `Poll.start()`
performs a tick synchronously (luci-base), so a case that restores the poll on its way out fires a
real tick into the case that runs next — HOLD doing that had SWAP measuring the floor under a live
tick, and CI reported 120px of unheld floor on a cell every other build calls green. HOLD and SWAP
therefore leave it stopped, and QUIET — whose subject IS ticks landing mid-flick — starts it before
it parks, with a tick's worth of time to land: started later, that first tick lands inside the very
flick being timed and the sweep reports the jump it came to look for (145.5px, firefox/owrt2410
@390 top compact). Both shapes are in [development.md](development.md), with what tells them apart
from a theme fault.

| mechanism | without it | needed |
|---|---|---|
| `holdFloor()` | reader moved 568px @390 top and 610px @1440 side; the clamp took 444px and 610px | yes — the largest effect of any of them |
| `holdFloor()` putting back the offset its own clear pass lost | `REPEAT`'s refill 2 or 3 on the same section left the reader -47px off, chromium `@390 top` on `/admin/network/dhcp`, `corrected never` and `engineTrusted` true throughout | yes — one pixel taken by the sweep is enough for `lateDrift()` to read the page as moving and discard a 60px correction whole |
| the floor written at the box's OWN height rather than `offsetHeight`'s rounding of it | 22 floors each stand up to half a pixel taller than their content, the document with them is 2px taller than without, and the next sweep's own clear hands that back: 6 of 12 refills corrected on `owrt2410b`/webkit `@390 top normal` against 12 of 12 | yes — it is what makes the clamp `holdFloor()`'s own restore is about, and the clamp with the theme out of the loop is harmless (12/12) |
| `applyAnchor()` seeing past the clamp's own scroll event | `REPEAT`'s refills 2 and 3 left the reader -60px off, `corrected never`, webkit `@1440 side compact` with the engine's anchoring ablated away — refused on `scrolling()` 11ms after the clamp that caused it, holding a correct -60px correction | yes — the shrink that is not fully clamped is invisible to every other mechanism here, and the reference is re-taken on top of it |
| `settleDeferredFloor()` | `REPEAT`'s refill 2 or 3 left the reader 58-60px off on WebKit @390, side and top, every other mechanism green throughout | yes, and narrowly: the ablation is `holdFloor()`'s own `scrolling()` guard being reached at all |
| `scheduleAnchor()` / `applyAnchor()` | 3 findings per scroller with the engine's anchoring off, every one the full 120px of growth: nobody corrects at all | yes, and it is the whole correction on Safari < 26 |
| `lateDrift()` | 120px on Overview and on Processes, both scrollers, with the engine anchoring | yes — the engine's residual is not small |
| `ENGINE_ANCHORS` | forcing "no engine anchors" on an engine that does: 120px on Processes | yes — the detection picks the path, and running both corrections is what throws the page the other way |
| `_engineTrusted` | an engine that anchors but declines on a given refill leaves every later correction on `lateDrift()`'s 419-420ms path instead of `applyAnchor()`'s 7-36ms one | yes, once `LATE_MISS_LIMIT` (2) residuals have been measured on the page — never trips where the engine keeps the reference itself (0 residuals on chromium/firefox) |
| `lateDrift()` settling in the frame it already has where the page was still | every refill a trusted engine declines is corrected 419ms after it happened instead of 8-61ms: 9 findings of 9 `engine DECLINES` cells, three engines, three twins | yes, and the ablation IS the third cell of that axis — nothing else can put the theme on `lateDrift()` as the only corrector on demand |
| the growth witness seeing past a blind reference (`closest(FLOORED)`, the positional guard) | a fold above the growing block leaves both witnesses blind and nothing is corrected (13 of 13 refills, 120px off); counting a box below the reader throws them 120px the other way (8 cells of 12) | yes — the two guards are one mechanism and each was a separate live failure |
| the guards on a page in motion (`scrollTop() !== seen`, `_userUntil`) | 6 findings per scroller, on BOTH engines and all three pages: the offset moved on its own mid-flick, worst 185-520px | yes, and it is the only mechanism here that fails on Chromium-class engines too |
| `anchorRef()` refusing to run while scrolling | nothing measurable | **not measurable here** — a cost guard, not a correctness one: every rect read there is a forced layout and this runs on every content mutation |
| `anchorRef()` refusing `#view` as the reference | nothing on the current pages | **not measurable here.** The hit test is retried across the viewport, so it finds real content where it used to land in a grid gap; the refusal keeps a future layout from anchoring on the host, whose own top never moves |

And four parts that carry the machinery rather than decide anything, so there is nothing to ablate:

| part | why it is not in the table above |
|---|---|
| `rememberRest()` and `_rest` / `_restAt` / `_restPage` | the memo itself. Removing it removes every correction at once, which is what the rows above already measure one at a time |
| `forgetRest()` | belongs to navigation, not to a tick: the router calls it when it resets both scrollers, and `spa-parity` is what covers that |
| `.table.fs-dt { overflow-anchor: none }` (`theme/30-tables.css`) | tells the ENGINE not to anchor inside a table whose layout the fit pass falsifies mid-pass. The sweep measures the theme's corrections, not the engine's choice of anchor |
| `_scrollMem` / `saveScroll` / `restoreScroll` (`fs-router.js`) | per history entry, not per tick — see [spa-router.md](spa-router.md) |

**Two of them the sweep cannot reach**, and that is a finding about the sweep. Both are held by the
measurement in their own comment rather than by a gate, so a change there is not caught by CI:
extend `tools/scroll-anchor.mjs` before touching one, or accept that the proof is historical.

## What the gate itself cannot answer

`lateWhy()`, `lateTrail()`, `anchorWhy()` and `anchorTrail()` exist because a correction that did
not write reads from outside as one symptom, `writes: []`, and `lateDrift()` has eight ways to reach
it. Each exit sets one short string with `performance.now()` beside it, the clock the sweep measures
the refill on, and the last eight are kept: a correction whose settle has not run yet and one that
ran and was re-armed both read `armed` at the end of the window otherwise (anchoring-log.md, "The
last eight exits, with the clock").

Nothing else can answer "has a reference been taken yet": `scrolling()` says no both before the
motion sampler starts and after it finishes, **1.5 s apart in WebKit**, and a flat wait instead made
`tools/scroll-anchor.mjs` report a jump on every WebKit run and none on the other two engines with
the theme identical on all three.

`restAt()` and `engineTrusted()` carry no `/* fs:probe */` marker on purpose: they are read by a
browser sweep against the INSTALLED package, and a probe marker is what packaging strips. Marked,
`restAt()` was stripped out and the sweep fell back to a flat wait — 14 findings on one router, every
one of them WebKit, and not a word about the missing method.
