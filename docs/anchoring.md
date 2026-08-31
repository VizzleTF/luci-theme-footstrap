# Keeping the reader's place

A poll tick changes the height of something above the reader and the page under them moves. This
page is every mechanism the theme has for that, in the order a tick meets them, what each one is
for, and what the sweep measures when it is taken out. The measurements are
`tools/scroll-anchor.mjs` on the stands; the numbers in each row are what that reported.

The chrome's side of it — which element the correction may take, why data tables are excluded — is
in [chrome.md](chrome.md); this page is the machinery.

## Who is responsible: `ENGINE_ANCHORS`

Chromium, Firefox and — since WebKit 26 — Safari implement **scroll anchoring**: the engine picks an
element the reader can see and moves the offset itself so that element stays put. The theme asks the
platform, `CSS.supports('overflow-anchor', 'auto')`, and never a browser name.

**The answer decides which half of this file runs.** Where the engine anchors, growth above the
reader is its job and the theme only cleans up what it leaves behind (`lateDrift`); where it does
not, the theme owns the whole correction (`anchorFor` → `scheduleAnchor` → `applyAnchor`). Running
both is not a safety net: two corrections throw the page the other way, which is the fault the
detection exists to avoid.

`localStorage.fsEngineAnchor = 'off'` forces the second path on any engine — that is how the sweep
reaches it, and how a Safari-only report is reproduced on a machine that has no Safari.

## The document may not get shorter: `holdFloor()`

`dom.content()` — what every LuCI poll calls — empties a container before it refills it. A layout
taken while it is empty clamps the reader's offset into a document that was never really that short,
and nothing puts that back. So each container a poll empties carries a `min-height` at the height it
had at the last settled moment, written BEFORE the tick rather than during it.

Three things about it are load-bearing and each was a measured failure first:

- **On the containers, not on the column.** `min-height` on an ancestor of the engine's own anchor
  suppresses the engine's anchoring (css-scroll-anchoring-1 §2.2.2), so a floor on the column bought
  the clamp back by turning the engine off: 120px of growth moved the page all 120px on Chromium and
  Firefox alike.
- **Not on a table box.** `min-height` is undefined there (CSS 2.1 §10.7) and WebKit acts on it: a
  `.table.cbi-section-table` wearing a 313px floor still collapsed to 30px and the document lost
  284px. The floor climbs to the first box that is not a table.
- **Written before the tick.** Pinning from inside the same statement sequence does nothing —
  `dom.content()` performs no layout, so no layout ever sees the pin: 1882px still clamped away.
- **Not on a box that has no height of its own.** `naturalHeight()` measures the CONTENT — the last
  child's bottom against the box's top — and `visibility: hidden` leaves that content in the layout,
  so a collapsed tab pane answers with its full height and the floor pins the collapse open. On
  Network → Interfaces the hidden `device` pane held 893px and the active pane's content sat that
  far down the page (issue #41). The clear-and-remeasure shape this replaced read the collapsed
  height and wrote nothing; refusing a zero-height box restores that, and gives the same answer for
  a container a tick has just emptied — whose floor is already standing.

## What the reader was looking at: `anchorRef()` and the memo

`anchorRef()` is one hit test at the fold, below `[data-fs-chrome]` (the bar is sticky; a test at
y=1 returns the chrome and the page gets no anchor at all). It refuses `#view` itself — a host's own
top does not move when something inside it grows, so a drift measured against it is zero for ever —
and it refuses data tables, whose layout the fit pass deliberately falsifies mid-pass.

`rememberRest()` stores that element with its top, the offset it was taken at and the page stamp
(`_rest`, `_restAt`, `_restPage`), from the last moment the page was still. The section around it
travels too, as the fallback for the ordinary case where the tick replaces the element itself.

`forgetRest()` voids the memo: the router calls it on a client navigation, where the offset reset is
not a clamp to undo.

## The corrections

| | runs when | what it does |
|---|---|---|
| `applyAnchor()` via `scheduleAnchor()` | the engine does NOT anchor | the whole correction, one rAF after the mutation, against `anchorFor()`'s reference |
| `lateDrift()` | the engine anchors | only what the engine left behind, a frame plus `SCROLL_IDLE` later, against the memo from before the tick |
| `settleDrift()` | the engine anchors | the same, around the deferred pass that runs when the reader stops — that pass re-lays tables and its `min-height` writes can suppress the engine's own compensation |

All three end in **`putBack(el, was)`**, the one write any of them makes: it moves the offset by the
drift it measured, then re-reads the offset (the write may have been clamped short) **and where the
element actually landed** — a clamped write leaves it somewhere other than `was`, and a memo that
goes on naming `was` asks every later tick to spend an unreachable difference on the reader.

## What must never be corrected

- **A page the reader is moving.** `scrolling()` reads the offset over frames rather than trusting
  the event stream: on iOS momentum carries the page long after the finger is gone. A correction
  landing inside a flick is itself a jump.
- **A page the reader just acted on.** `_userUntil` holds the correction off after a deliberate act.
- **A page that is not the one the memo belongs to.** `_restPage` travels with the memo.

## What the engine is told

`theme/30-tables.css` sets `overflow-anchor: none` on `.table.fs-dt` — the data tables the fit pass
re-lays. Without it the engine anchors inside a table whose layout the theme is about to falsify.

## Navigation is a different question

`fs-router.js` keeps its own scroll memory (`_scrollMem`, `saveScroll`/`restoreScroll`) so Back
returns the reader where they were. That is per history entry, not per tick, and none of the above
applies to it — see [spa-router.md](spa-router.md).

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
| `scheduleAnchor()` / `applyAnchor()` | 3 findings per scroller with the engine's anchoring off, every one the full 120px of growth: nobody corrects at all | yes, and it is the whole correction on Safari < 26 |
| `lateDrift()` | 120px on Overview and on Processes, both scrollers, with the engine anchoring | yes — the engine's residual is not small |
| `putBack()` re-reading where the element landed | −52px on five passes out of five; with it, 0px on five out of five | yes, measured as a frequency because one pass is not evidence |
| `ENGINE_ANCHORS` | forcing "no engine anchors" on an engine that does: 120px on Processes | yes — the detection picks the path, and running both corrections is what throws the page the other way |
| the guards on a page in motion (`scrollTop() !== seen`, `_userUntil`) | 6 findings per scroller, on BOTH engines and all three pages: the offset moved on its own mid-flick, worst 185-520px | yes, and it is the only mechanism here that fails on Chromium-class engines too |
| `settleDrift()` | −60px on 2 passes out of 7, against 0 out of 6 with it — **on `imm2410 @390 top large`, webkit, and nowhere else** | yes. It answers a tick that landed while the offset was moving, so it is a race and a single pass does not see it: the first sweep that crossed this mechanism called it unmeasurable, and it took the cell its own note names (88 `min-height` writes and a 58px jump in the same frame, ImmortalWrt 24.10/WebKit) plus five repeats to catch it |
| `anchorRef()` refusing to run while scrolling | nothing measurable | **not measurable here** — it is a cost guard, not a correctness one: every rect read there is a forced layout and this runs on every content mutation |
| `anchorRef()` refusing `#view` as the reference | nothing on the current pages | **not measurable here.** The hit test is retried across the viewport, so it now finds real content where it used to land in a grid gap; the refusal is what keeps a future layout from silently anchoring on the host, whose own top never moves (drift 0 for ever, half the matrix silently unmeasured when it did) |

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

A third, `settleDrift()`, looked like one of them until it was measured on the right cell. Adding a
separate assertion for it — read the reference after the flick, again once the deferred pass has
run, and fail on the difference — caught **nothing** across four sweeps on two engines while the
mechanism was disabled, so it was not kept: what does catch it is the swap case already in the
sweep, on `imm2410 @390 top large`, repeated. **An optional stand is the only place a mechanism of
this theme is measurable**, which is worth knowing before `--only` is narrowed to the core three.

