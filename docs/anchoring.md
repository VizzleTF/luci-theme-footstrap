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
WebKit shipped it too — task wkanchor.** All three now answer `true`, and parked mid-page with real
poll ticks landing (`tools/scroll-anchor.mjs`'s `tick` case), the offset still moved on WebKit — no
`scrollTo`, no `scrollTop` setter recorded — 21px on the Overview's default park
(`../tmp/task-overview12/tick-probe.mjs`), 41px at 390 wide in the bar/top layout. Task wkanchor read
that as WebKit's own scroll anchoring getting a real correction wrong and shipped `ENGINE_MISANCHORS`
(`fs-fit.js`, `-webkit-hyphenate-limit-before`) to turn WebKit's anchoring off on the theme's own
scroller wherever it fired, `overflow-anchor: none` under `data-fs-anchor-suppress`
(`theme/20-shell.css`). `lateDrift()` had already been writing the drift back one rAF plus
`SCROLL_IDLE` later — measured 421/421/408ms after the tick — and the new mechanism was meant to make
that correction unnecessary rather than merely late.

**That diagnosis was wrong — task barpin.** Nothing about WebKit's own anchoring was misfiring: the
bar itself was moving. `fitChrome()` (fs-chrome.js) pins the bar's box against SHRINKING while it
measures whether the menu still fits, so the question can be asked with the layout classes off, but
until this task it pinned only that direction — with the classes off, and again as `fs-bar-stack`/
`fs-ind-compact` are added back one at a time, the bar's OWN height was free to answer whatever its
content needed at that instant, up to 107px taller than its settled height, one synchronous pass at a
time. `fitChrome()` runs once per poll-driven mutation, and the Overview's own poll batches
System/Memory/Storage into several separate `MutationObserver` callbacks rather than one — so the
walk landed as a sequence of real, differently-sized boxes with a paint between them, and EVERY
engine followed it, not only WebKit. Chromium and Firefox hid that behind their own scroll anchoring,
each correcting its own move before the next one landed; WebKit has no anchoring of its own to hide
behind, so the walk showed up directly as drift, and `lateDrift()` — built to clean up after an
anchoring engine's own residual — was instead cleaning up after this. `tools/fit-quiet.mjs`, extended
to watch the bar's height in both directions rather than only the dip, measured the walk directly:
230 → 202 → 164 → 144 → 123 → 131 → 123px against a settled 123px, 107px of growth a floor alone
never sees. `fitChrome()` now pins the bar's height BOTH ways for the whole decision and releases the
pin only once the final class set is chosen, right before the height is published — nothing the pass
measures (`stripFitsOneRow()`'s `offsetTop`, `clusterFitsBrandRow()`'s widths) reads the bar's own
height, so the pin changes nothing about which classes get chosen. With that in place, the same
probe that measured 21-41px on WebKit reads 0px at 390/top with the suppression removed entirely, 26s
of real poll ticks (`../tmp/task-toplayout/top-probe.mjs --unsuppress`) — `ENGINE_MISANCHORS` and
`data-fs-anchor-suppress` are gone from the tree (`fs-fit.js`, `theme/20-shell.css`): there was never
a WebKit-specific fault for them to hold.

## When the platform check is not enough: `_engineTrusted` (task latenet)

`ENGINE_ANCHORS` answers once, at load, whether the property EXISTS — it cannot see an engine that
has it but declines to use it on a given refill, which CI showed does happen: two passes where a
real engine anchored the platform check trusted but left the correction to `lateDrift()`, the
theme's cleanup path for an anchoring engine's own residual (`lateDrift()`, above). That path is
built to be a safety net, not the primary corrector, and it answers slowly on purpose: it waits a
frame, then reads the offset again after `SCROLL_IDLE` (400ms) to make sure the reader has not
started scrolling in between. Task latenet's four-way SWAP ablation put a number on what that costs
when the net is actually the one doing the work: `overflow-anchor: none` alone (engine off, theme
still on the `ENGINE_ANCHORS` path) — `lateDrift()` carries the correction at 419-420ms. Both halves
suppressed together (`fsEngineAnchor=off` plus the CSS rule, the shape accc451 shipped) —
`applyAnchor()` carries it at 7ms on chromium/firefox, 32-36ms on webkit. Neither number changed for
the base case (untouched): the engine corrects itself, 0ms, 3/3 reps on every engine.

So the fork in the mutation observer (`observeContent()`) no longer trusts `ENGINE_ANCHORS` for the
whole session once the evidence says otherwise. `lateDrift()` already computes the residual after
every refill the theme did not correct itself; each one it actually has to write back increments
`_lateMisses`, and once that count reaches `LATE_MISS_LIMIT` (2 — one residual is headroom for a
single one-off, since a page that corrects at all some of the time is not the same fault as one that
never does; a second is the count, not a guess), `_engineTrusted` goes false and every later refill
on that page takes the `anchorFor()` → `scheduleAnchor()` path instead — the one `applyAnchor()`
measures at 7-36ms rather than `lateDrift()`'s 419-420ms. The comment at the increment site claims
only what is measured: "this engine did not keep the reference across a container refill, N times on
this page" — never a browser name, because the count is what is asked, not the identity. Chromium and
Firefox measure 0 residuals on the pages this sweep covers, so `_lateMisses` never advances for them
and the switch cannot trip.

**What the gate had to learn to see this at all.** `tools/scroll-anchor.mjs`'s `SWAP` case used to
read the mark once, at a single fixed delay (800ms), which cannot tell "never corrected" from
"corrected after the delay had already been long enough to hide it" — the CI failure that opened
task latenet was exactly that: a `--settle` read at 300ms reported the full drift, the same cell at
500ms reported 0px, and neither number said whether the correction was fast, late, or absent.
`swap()` now samples the mark every frame for `SWAP_WINDOW` (900ms — comfortably past the measured
419-420ms, with margin for a loaded runner) and records `correctedAt`, the first frame the drift
falls back under `TOLERANCE`. A drift still outside tolerance at the end of the window is reported as
"never came back"; one that corrected but past `LATE_MS` — 200ms, picked because it sits roughly
midway between the two measured clusters (7-36ms fast path, 419-420ms slow path) with well over
150ms of headroom either side, so ordinary CI jitter cannot cross it — is reported as "corrected
late", a finding in its own right even though the reader ends up in the right place: 420ms of visible
drift is what a maintainer reading a bug report calls a jump, not a pass. Chromium and Firefox stay
under 36ms on every cell this sweep reaches, so the threshold does not trip for them either.

**Coverage `SWAP` does not have, and does not claim.** The full CI sweep (`--full`) measures 91 of
171 cells; 80 are skipped because nothing above the reader on that page/width/layout/density
combination is big enough to collapse (`nothing above the reader big enough to collapse`, the same
skip the `.fs-ovl` grid case uses). Widening what `SWAP` can measure — a smaller minimum collapse
size, or picking a body nearer the fold instead of the tallest one entirely above it — is a change to
what the case tests, not a flag on top of it, and is out of scope here.

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
- **And hiding content IN PLACE has to wake the sweep too, not only a tab strip.**
  `fs-appearance.js`'s `foldable()` OPENS a disclosure by mutating nodes (`refreshColours()`, a
  childList change the first observer already sees) but CLOSES it by writing `hidden` on the panel
  and `aria-expanded` on the button only — the same asymmetry as a tab pane, one level down, and it
  is why the floor only ever grows: /admin/system/footstrap, "Colours", measured 731px before
  opening, 1485px open, and STAYED at 1485px after closing again, 754px of empty ground still there
  21s later on a page that never polls (`../tmp/task-spoilerfloor`); "Background" has the same shape
  at 55px held. **Stock LuCI has it too, wider than the theme:** `form.js`'s `setActive()` — what
  every `depends()` calls — hides a row by toggling the CLASS `hidden` on the `[data-field]` element,
  not the attribute, so it wakes nothing that watches attributes alone. System → System, Time
  Synchronization, unticking "Enable NTP client": 308px of floor held against a 50px bare section,
  258px of empty ground, unchanged 10s later. `_moTabs` closes both, rather than a fourth
  `MutationObserver` instance: one more registration on the SAME node replaces the one before it, so
  `data-tab-active` grows into `attributeFilter: ['data-tab-active', 'hidden', 'aria-expanded',
  'class']` on the same call, over the same two hosts, instead of paying for a second instance and a
  second `for` loop over `hosts` — measured at 108 B less minified than a separate observer wired the
  same way. `hidden` and `aria-expanded` are cheap to watch across the whole subtree — nothing
  rewrites them on a poll tick — but **`class` is not**: `_moFlag`'s own comment is why watching it
  unfiltered would call `run()` on every row a tick rewrites. So a `class` record only wakes the
  sweep where the mutated element itself carries `data-field` (`r.target.dataset.field`, cheaper
  minified than `hasAttribute()` and just as correct — the value is a cbid, never empty where the
  attribute is present) — once per delivered record, a property read with no forced layout, not once
  per poll tick — and `hidden`/`aria-expanded`/`data-tab-active` records wake it unconditionally.
  `tools/floor-contract.mjs` gained the two triggers this needs (a disclosure open-then-close, a
  `depends()` row switched off) — its ACCURACY check already caught the discrepancy outright once
  something exercised it. Cost: 82 B minified over `tools/size-budget.mjs`'s `coldJs` limit (45 B of
  head-room before this fix), the array and the filter both irreducible without dropping coverage —
  reported rather than raised, per the budget's own rule.

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

Task wkanchor added the same property, unconditionally within its own selector list, on `html`,
`body`, `#maincontent`, `.fs-main`, `#view` and `#view *` — under `:root[data-fs-anchor-suppress]`,
the attribute `ENGINE_MISANCHORS` used to write. Task barpin removed both: the attribute was gating a
correction for a WebKit fault that was never real (above), so turning the whole document's anchoring
off under it bought nothing measurable once the actual cause — the bar's own box changing height
inside `fitChrome()`'s measurement pass — was fixed. `theme/20-shell.css` carries no anchoring rule
outside the tables one above.

## Navigation is a different question

`fs-router.js` keeps its own scroll memory (`_scrollMem`, `saveScroll`/`restoreScroll`) so Back
returns the reader where they were. That is per history entry, not per tick, and none of the above
applies to it — see [spa-router.md](spa-router.md).

### The scroll reset (task navstamp)

A forward click resets both scrollers to the top — `window.scrollTo(0, 0)` and the same on
`#maincontent` — because a full load starts the new page there and the in-place swap has to match
it. That write used to run synchronously at the click, before the staged render, alongside the
`body[data-page]` stamp `spa-router.md`'s "The staging window" covers. It now runs in the same
synchronous turn as `commitStage()`, at the swap, instead.

**Measured, with the incoming module's fetch held open 1.2 s so the window is long enough to
sample** (`../tmp/task-navflash/navflash-slow.mjs`, `owrt2512`): at the click, `y` reached 0 within
12 ms and stayed there for the whole staging window — the reader, still looking at the OUTGOING
page (this doc's other corrections are about ITS position not moving; this one is about it moving to
a position the reader did not choose), found themselves at its top before they had any reason to be.
Moved to the commit, `y` stays at the reader's own offset — 1878px in the measured run — for the
entire window and reaches 0 in the same frame the incoming page's content replaces it, matching what
a full load looks like: one page, one position, both changing together.

**Why this is safe to move and the anchoring corrections above are not touched by it.** Every
mechanism on this page corrects a scroller that is meant to STAY PUT while the document under it
grows or shrinks — a poll tick, a floor collapsing, an image loading. A forward navigation is the one
case that is deliberately going to move the reader, by design, to a page they chose; moving the
WRITE that does that later does not turn it into a case those mechanisms need to answer for. What
does have to stay where it is: `fit.forgetRest()`, which merely invalidates the anchoring reference a
now-superseded page held. That runs at the click, unmoved — the reader is committed to leaving from
that point on, and a mutation the outgoing page's own poller makes during the staging window (before
`clearViewIntervals()` runs, later in the same chain) must not be read against a reference that
belongs to a page about to go away, whether or not the scroll write that follows has happened yet.

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
| `_engineTrusted` (task latenet) | an engine that anchors but declines to on a given refill left uncaught by `ENGINE_ANCHORS` (a load-time check) leaves every later correction on `lateDrift()`'s 419-420ms path instead of `applyAnchor()`'s 7-36ms one | yes, once `LATE_MISS_LIMIT` (2) residuals have been measured on the page — not needed, and never trips, where the engine keeps the reference itself (0 residuals measured on chromium/firefox) |
| the guards on a page in motion (`scrollTop() !== seen`, `_userUntil`) | 6 findings per scroller, on BOTH engines and all three pages: the offset moved on its own mid-flick, worst 185-520px | yes, and it is the only mechanism here that fails on Chromium-class engines too |
| `anchorRef()` refusing to run while scrolling | nothing measurable | **not measurable here** — it is a cost guard, not a correctness one: every rect read there is a forced layout and this runs on every content mutation |
| `anchorRef()` refusing `#view` as the reference | nothing on the current pages | **not measurable here.** The hit test is retried across the viewport, so it now finds real content where it used to land in a grid gap; the refusal is what keeps a future layout from silently anchoring on the host, whose own top never moves (drift 0 for ever, half the matrix silently unmeasured when it did) |

`ENGINE_MISANCHORS`/`data-fs-anchor-suppress` is not in the table above — task barpin removed it
from the tree entirely rather than leaving a row that says "not needed". The 21-41px it was built to
answer was real (below), but the cause was `fitChrome()`'s own bar changing height inside its
measurement pass, not WebKit's anchoring; once that pin covers both directions the drift is 0px on
WebKit with no suppression at all, so there was nothing left for the attribute to gate.

**A correction that is merely LATE reads as "the reader stayed put" to every case that closes before
it lands — task wkanchor.** `held`/`swapped` insert their own growth and close within 800ms of it;
`quiet` discards any step where the offset held still for 400ms, since its own subject is a reader
in motion. The fault `tick` was built for is neither: nothing is inserted, the reader is parked, and
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

`swapped`'s own window is no longer a single read at a fixed delay — see `_engineTrusted` above.
Task latenet found the same LATE-reads-as-PUT-STILL shape one level down, inside `swapped` itself
rather than only across the case boundary: a fixed-delay read cannot tell a correction that landed
late from one that never landed at all, which is what let a real fault pass on one `--settle` and
fail on another. `swapped` now samples the whole `SWAP_WINDOW` and reports which of the two
happened, with a stated `LATE_MS` threshold for when "eventually" stops being good enough.

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

**`HOLD` reporting `moved -505px` said nothing by itself — task latenet.** The finding was
`firefox owrt2512 @1440 top compact`, and it was chased for a full round without reproducing: 0 of
several local attempts came back with anything but a healthy read. The printed line — `reader moved
-505px` — carries no geometry, only the delta, so there was no way to tell "the correction failed"
from "the mark ended up somewhere that makes the delta read like a failure for an unrelated reason".
It turned out to be the second kind: `before.top` reads 503 on every local run, and a mark whose
`after.top` lands near 0 is the mark sitting at the viewport's own top — a real, different event from
a page moving under a still reader — not −503px of uncorrected drift. `HOLD` now returns `before` and
`after` in full, and the sweep prints both (`before.top=… after.top=…`) beside every `moved` value,
finding or not, so a reading like this one is legible without a follow-up session. It also carries
`writes`, the scroll-write log an `addInitScript` wrapper records for the whole context (wrapping
`scrollTo`, `scrollBy`, the `scrollTop` setter and `Element.scrollTo`, borrowed from
`../tmp/task-holdreg/hold-probe.mjs`), printed on a finding only — the log of who actually wrote the
scroll position, not just what it ended at. And because one flake in roughly 216 cells (the size of a
full three-engine sweep) must not fail a run on its own, a `HOLD` reading past `TOLERANCE` is
re-measured once, on the same page, before it is allowed to become a finding at all; only a reading
that reproduces on the second pass is reported, with both readings' geometry printed together.

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

