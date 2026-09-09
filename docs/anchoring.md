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

**`overflow-anchor` stopped being able to say "this engine's anchoring can be trusted", the day
WebKit shipped it too — task wkanchor.** All three now answer `true`, but WebKit's own anchoring can
still get a tick wrong that grows nothing above the reader at all: parked mid-page with real poll
ticks landing (`tools/scroll-anchor.mjs`'s `tick` case), the offset still moved — no `scrollTo`, no
`scrollTop` setter recorded — 21px on the Overview's default park
(`../tmp/task-overview12/tick-probe.mjs`), 41px at 390 wide in the bar/top layout. `lateDrift()`
already wrote that back, one rAF plus `SCROLL_IDLE` later — measured 421/421/408ms after the tick —
which is not wrong, just late enough to read as a jump.

`ENGINE_MISANCHORS` (`fs-fit.js`) is the second question this now takes, once the first says the
platform anchors at all: not `overflow-anchor` again (every engine claims it) and not a browser name
(the same rule as above) — `-webkit-hyphenate-limit-before`, a non-standard WebKit hyphenation
extension Blink and Gecko have never implemented, answers `false` on Chromium and Firefox and `true`
on WebKit. `-webkit-touch-callout` was tried first and rejected: it answers `false` on a touch-less
desktop WebKit build too, so it names a capability rather than the engine and would leave a non-touch
Safari undetected. Where it answers `true`, `fs-fit.js` writes `data-fs-anchor-suppress` on `:root`
once, at module eval — `ENGINE_ANCHORS` reads the same flag and returns `false`, taking the
non-engine correction path for exactly the engine whose own anchoring is being turned off, never for
one whose anchoring is trusted (below).

## The document may not get shorter: `holdFloor()`

`dom.content()` — what every LuCI poll calls — empties a container before it refills it. A layout
taken while it is empty clamps the reader's offset into a document that was never really that short,
and nothing puts that back. So each container a poll empties carries a `min-height` at the height it
had at the last settled moment, written BEFORE the tick rather than during it.

The shape is 0.14.3's again: every floor is cleared, the box re-measured with `offsetHeight`, and
the floor written back where that answer is above zero. 0.14.4-0.14.6 replaced the clear with a
reader over the content (`naturalHeight()`), and then spent three more mechanisms repairing what
that reader got wrong on a hidden pane, on a box that ends in text and on a container that empties
for good. Each of those was measured and each worked; together they were a floor whose value
depended on four decisions taken in the same pass, and the releases carrying them are the ones the
reports are about. The clear costs a forced layout per box per pass and answers 0 for anything the
page is not showing, which is the answer all four repairs were reconstructing.

What stayed out of the revert is the floor's own bookkeeping. Six things are load-bearing, and each
was a measured failure first:

- **On the containers, not on the column.** `min-height` on an ancestor of the engine's own anchor
  suppresses the engine's anchoring (css-scroll-anchoring-1 §2.2.2), so a floor on the column bought
  the clamp back by turning the engine off: 120px of growth moved the page all 120px on Chromium and
  Firefox alike.
- **Not on a table box.** `min-height` is undefined there (CSS 2.1 §10.7) and WebKit acts on it: a
  `.table.cbi-section-table` wearing a 313px floor still collapsed to 30px and the document lost
  284px. The floor climbs to the first box that is not a table.
- **Written before the tick.** Pinning from inside the same statement sequence does nothing —
  `dom.content()` performs no layout, so no layout ever sees the pin: 1882px still clamped away.
- **Cleared and re-measured, not read off the content.** The clear is what makes every other
  question answer itself. A collapsed tab pane measures 0 and keeps no floor, where a content reader
  measured its full height through `visibility: hidden` and pinned the collapse open (893px on
  Network → Interfaces, issue #41). A container the tick has just emptied measures 0 too, which is
  why the write is guarded on the height rather than on the box. Held against the shape it replaced
  by `tools/floor-contract.mjs`, which strips every floor and re-measures: 60 floors on owrt2512,
  worst 1px.
- **Found by its own mark.** A box qualifies for a floor through its CHILDREN, and the climb above
  can put one on a box that is not in `SHRINKS` at all — so emptying the table under it takes the
  whole section out of the sweep and the floor stays for the life of the page: 927px on
  /admin/network/network, 13 s after the section emptied. Every floor carries `data-fs-floor` and
  the sweep looks for its own mark as well as for the selector. Matching on inline `min-height`
  instead would sweep off the ones an app wrote for itself.
- **And a tab switch has to wake the sweep.** Clearing a floor at the next pass is not clearing it:
  a tab switch moves no node — `ui.tabs` writes `data-tab-active` on the panes — so the
  `{childList, subtree}` observer on `#view` never fires, and `min-height` beats the `height: 0` an
  inactive pane is collapsed with. The pane the reader left keeps the height it had while it was
  open and the tab they opened starts below it. On a page that polls that lasts one `pollinterval`,
  which is the "it puts itself right after a few seconds" in the reports; on a page that does not
  poll, the life of the page. Measured on 25.12 at 1440px: System → Startup left 2432px of floor on
  `Initscripts`, the document at 3304px and the "Local Startup" textarea 2716px down — read as a
  missing textarea (#75, and forum post 68 against 0.14.4); Network → Interfaces left 1299px, the
  document at 2647px against 1720. A third MutationObserver, filtered to `data-tab-active`, runs the
  same sweep at the switch. It calls `run()` rather than going through the observer that carries the
  anchoring corrections — those answer a poll tick that moved the page under a still reader, and a
  tab the reader clicked is neither. Whether the blank is ever SEEN is release-dependent and the
  mechanism is not: on the 24.10 stand the same v0.14.6 build cleared both floors within 200 ms of
  the switch, something else in that luci-base having mutated `#view`.

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

Each ends in one write and reads nothing back. A third correction around the deferred pass
(`settleDrift()`), and a shared writer that re-read where the element had landed after a clamped
write (`putBack()`), shipped in 0.14.4-0.14.6 and went out with the revert: both were measured to
work — the rows below say by how much — and both are a correction the theme applies on top of
another correction, which is the shape the reports are about.

## What must never be corrected

- **A page the reader is moving.** `scrolling()` reads the offset over frames rather than trusting
  the event stream: on iOS momentum carries the page long after the finger is gone. A correction
  landing inside a flick is itself a jump.
- **A page the reader just acted on.** `_userUntil` holds the correction off after a deliberate act.
- **A page that is not the one the memo belongs to.** `_restPage` travels with the memo.

## What the engine is told

`theme/30-tables.css` sets `overflow-anchor: none` on `.table.fs-dt` — the data tables the fit pass
re-lays. Without it the engine anchors inside a table whose layout the theme is about to falsify.

`theme/20-shell.css` sets the same property, unconditionally within its own selector list, on
`html`, `body`, `#maincontent`, `.fs-main`, `#view` and `#view *` — but only under
`:root[data-fs-anchor-suppress]`, the attribute `ENGINE_MISANCHORS` writes (above). Chromium and
Firefox never see the attribute and keep anchoring exactly as before; WebKit does, and stops
anchoring the whole document rather than one table. The selector list is the same one
`tools/scroll-anchor.mjs` already forces on to test the theme's own correction against a real
engine's anchoring turned off — carried over rather than narrowed to an unmeasured subset.

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
| `ENGINE_ANCHORS` | forcing "no engine anchors" on an engine that does: 120px on Processes | yes — the detection picks the path, and running both corrections is what throws the page the other way |
| `ENGINE_MISANCHORS` / `data-fs-anchor-suppress` | WebKit's own anchoring left running on a parked reader, real ticks landing, nothing above the reader growing: 21-41px (task wkanchor, `tick` case) | yes — WebKit is trusted by the first question (`overflow-anchor` support) and gets the correction wrong anyway; without this, `lateDrift()` corrects it 421ms late instead of the engine never having moved the offset at all |
| the guards on a page in motion (`scrollTop() !== seen`, `_userUntil`) | 6 findings per scroller, on BOTH engines and all three pages: the offset moved on its own mid-flick, worst 185-520px | yes, and it is the only mechanism here that fails on Chromium-class engines too |
| `anchorRef()` refusing to run while scrolling | nothing measurable | **not measurable here** — it is a cost guard, not a correctness one: every rect read there is a forced layout and this runs on every content mutation |
| `anchorRef()` refusing `#view` as the reference | nothing on the current pages | **not measurable here.** The hit test is retried across the viewport, so it now finds real content where it used to land in a grid gap; the refusal is what keeps a future layout from silently anchoring on the host, whose own top never moves (drift 0 for ever, half the matrix silently unmeasured when it did) |

**A correction that is merely LATE reads as "the reader stayed put" to every case that closes before
it lands — task wkanchor.** `held`/`swapped` insert their own growth and close within 800ms of it;
`quiet` discards any step where the offset held still for 400ms, since its own subject is a reader
in motion. WebKit's mis-anchoring is neither: nothing is inserted, the reader is parked, and
`lateDrift()`'s correction lands 421ms after the tick — past `quiet`'s 400ms-still discard and well
inside `held`/`swapped`'s 800ms window, but neither of those two ever watches a PARKED reader across
a REAL tick, only a synthetic one it grew itself. `tick` is the fourth case this shape needed: it
parks the reader, leaves the poll running rather than stopping it (the one thing `held`/`swapped` do
that this case cannot), and watches the offset across ticks timed off the page's own
`L.env.pollinterval` — a fixed multiple of `pollinterval` was tried first and rejected, since one
real tick on the Overview batches System/Memory/Storage into several separate `MutationObserver`
callbacks and a count-based stop read all of them as separate ticks, closing the case after about
two seconds of page time and reporting 0px on the exact cell a time-based window (and
`tick-probe.mjs`) reported 21px on. Also layout-dependent in a way the other three cases are not:
0px at `390 side` (the sidebar collapsed to a bar under `data-narrow`) against 41px at `390 top` (the
bar layout proper) — same page, same tick, same engine, `data-layout` still carrying a difference
under the collapse that `held`/`swapped`/`quiet` never needed to know about, since which element
scrolls is the same either way. `390 top` joins the default (non-`--full`) axis for every case as a
result, not only `tick`'s own — a regression here would otherwise only be caught on a push or a tag.

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

**The sweep's own mark has to be a faithful proxy, and `position: sticky` is a way for it not to
be.** `markAt()` already refuses `#view` and `.cbi-section-descr` for the same underlying reason —
a candidate whose top cannot move the way the page around it moves makes `after.top - before.top`
answer a question that is not "did the reader move". A sticky element's top is a third such
candidate: pinned to its stuck offset for as long as it stays stuck, so a mark that lands on one
measures the stick state, not the reader. Task 0177 found this live rather than by inspection — a
run on `owrtsnap @1440 side compact` landed its mark on `th.th`, the sidebar's own sticky table
header (`theme/30-tables.css`), where `owrt2512` landed on `td.td` for the same page and point. It
did not fire there (`headerWasPinned=true, tableTop=-166`, moved 0 across every repeat), which is
why the finding itself needed no fix; the trap was that nothing made that true on purpose. A
synthetic sticky header reproduces the failure directly: `markAt()` without the guard read
`rect.top` as 0 on every growth from 0 to 120px, while a plain sibling at the same point moved with
the page — a mark there would pass however badly the theme failed. `markAt()` now walks each
candidate's ancestors up to `#view` and skips one with `position: sticky` anywhere in that chain,
the same "detect and reject" shape as the other two exclusions, in both copies of the function
(`HOLD` and `SWAP`) since both pick a mark the same way.

**A `clamped 0px` in CI cannot say, by itself, whether the engine declined to anchor or the mark
misreported — task 0178.** A finding reproduced 2 of 2 on CI and 0 of 3 locally, a full webkit sweep
included, and the printed line — `floor alone: clamped 0px, reader 120px` — has only one number
that could tell those two apart, and it was never printed: `after.pos - before.pos` for the swap,
the offset the scroller was actually asked to move by. A healthy floor-off pass shows the whole
120px of growth arriving there (the engine compensating for real); a pass where the engine simply
never engaged would print the same `clamped 0px` while this term stayed at 0 too. Both `swap()`
passes (corrected and floor-alone) now report it, printed beside the field it disambiguates rather
than added as a new field CI output has to be re-read to notice — `[offset +120]` next to `swap
moved 0px`, `[offset +120]` next to `reader 120px`. The anchor node's own identity (which element
`fs-fit.js` chose to hold the line, which is the other unverified half of the same CI-only report)
is not in this line: `fs-fit.js` remembers it in a private `_rest.el` and exports no accessor, so
reaching it costs an export this task did not add — recorded rather than reached.

**A cell can report `swap moved 0px` while measuring nothing, and that is worse than a wrong
number — task 0178.** `SWAP`'s body picker takes the tallest `.cbi-section > div` etc. entirely
above the reader; on the Overview that can land inside `.fs-ovl`, the grid `fs-overview.js` wraps
System/Memory/Storage in (`styles/pages/20-overview.css`). The grid sizes a row off its TALLER
column, so a shorter column can absorb the whole 120px pad without the row, and so the document,
growing by a pixel — measured live, `div#fs-ovl-panel-0` at 291px on `owrtsnap @900` and again on
`owrt2410 @1200`, `moved 0` both times, printed exactly like a correction working. The two are
distinguished the same way as the paragraph above: a real measurement grows the document by close
to the pad it inserted, so `swap()` now also reports `docH` before and after the refill, and a cell
where that delta comes back under half the pad folds into `swap.skip` — the same branch "nothing
above the reader big enough to collapse" already uses, printed as a named skip rather than silently
joining the pass line. A skip, not an error: the body picker choosing badly on one page shape is not
a theme fault, and failing the gate over it would be one more thing this file would have to explain
away on every future run of that cell.

**Two mechanisms were measured here and are no longer in the tree**, and their numbers are the
reason the revert stops where it does rather than an argument to put them back. `putBack()`
re-reading where the element landed: −52px on five passes out of five, 0px on five with it.
`settleDrift()`: −60px on 2 passes out of 7 against 0 out of 6 with it, **on `imm2410 @390 top
large`, webkit, and nowhere else** — a race a single pass cannot see, which took that cell (88
`min-height` writes and a 58px jump in the same frame) plus five repeats to catch, and which a
purpose-built assertion caught nothing of across four sweeps. **An optional stand is the only place
a mechanism of this theme is measurable**, which is worth knowing before `--only` is narrowed to the
core three. Both belong to the layer 0.14.7.1 removed: a correction that repairs another correction
is what the reports were about, and neither fault they answer has been reported since.

