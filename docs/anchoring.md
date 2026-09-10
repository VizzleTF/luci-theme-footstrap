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

## A witness that cannot be blind: the growth itself (task blindref)

`lateDrift()`'s drift is `el.getBoundingClientRect().top - was`, and `el` is whatever `anchorRef()`
hit-tested at the fold the last time the page was still — not guaranteed to sit below the container
THIS tick refilled, and an element's own top does not move when growth happens somewhere it is not
connected to. Reproduced on CI, the same finding across three SHAs (1e88310, 7ff9e56, 76b3c7a):
`webkit owrtsnap @1440 side compact, engine-anchoring on, overview` — a section refilled the way a
poll refills one and the page never came back, still 120px off after the 900ms `SWAP_WINDOW`. Of
`lateDrift()`'s five refusals, `drift < 1px` fired 13 of 13 refills — `anchorRef()`'s hit test lands
on a different element per density (a plain `DIV` at top -362 in compact, `DIV.network-status-table`
at top -33 in normal), and the compact one sits where the growth never reaches it: a reference there
reads 0px whether the engine corrected or not, and the code reads that zero as "the engine put it
back." `_lateMisses` never advanced (identical numbers on 7ff9e56, before the counter existed)
because incrementing needs a WRITE and `lateDrift()` never wrote one — the raw scroll offset stayed
at `+0` for the whole window, `SWAP`'s own diagnostic metric confirming the theme's net never
engaged at all.

`lateDrift()` now takes a second witness that cannot make that mistake: `grow`, the height the
mutation's own target actually gained. `observeContent()`'s `MutationObserver` callback receives
`records` (previously discarded) and finds the first `childList` record whose target already wears
`data-fs-floor` — the mark `holdFloor()` writes at "the height it had at the last settled moment,
written BEFORE the tick" (below) — and reads its `offsetHeight` against that pin right there in the
callback: the mutation has already happened, so this IS the container's final height, and nothing
here waits on the engine, which only ever moves the SCROLL POSITION, never an element's own size. A
carried-forward number cannot misread the way a live reference can if the container is later gone.
Where `el`'s own drift already reads under 1px AND `grow` is over 1px, the residual is `grow` minus
however much the offset already moved since the reference was taken (`seen - ref.at` — `seen`, not a
fresh read, since the guard above it already proved the offset has not changed since): an engine
that anchored moves the offset by (about) the growth, one that declined leaves it where it was. The
other four refusals (`_lateFrame` already pending, the page navigated away, the reader is moving,
over a viewport) are untouched — the fault was never the tolerance, only that the question was asked
of an element that need not have moved.

**The gate had to learn to say which refusal fired, too.** `SWAP`'s "never came back" finding string
omitted `swap.writes` — the scroll-write log — though the "corrected late" finding beside it already
carried it, which is exactly why three CI runs of the same finding could not say whether the theme
wrote nothing at all or wrote somewhere the mark did not see. Both branches now print it: an empty
array means `lateDrift()` never wrote, matching `_lateMisses` staying at 0.

**Proof.** Rebuilt `owrtsnap`, webkit, `@1440 side compact`: `swap moved 0px [offset +120] corrected
16ms` — where CI read `still 120px off … [writes: []]` before the fix (the fault itself did not
reproduce locally even before the fix, on the rebuilt image — CI's three SHAs are the reproduction).
`normal` and `large` stay green on the same cell. Chromium and Firefox stay at 0px on every
default-axis cell of `overview` this sweep reaches. `fit-quiet` (0px peak-to-peak, 3 widths) and
`SWAP`'s own `TICK` case (0px, 20 mutations observed) are unmoved — the hot path this task touches
runs on every anchoring pass, not only the one CI caught.

**The witness is not safe to write on its own — task detector.** This page used to say a false
witness here "only ever refuses, never writes"; that was reasoned, not measured, and the very next
CI run measured it false: 21 findings, both webkit and firefox, all on `/admin/network/dhcp @390`,
every density, both layouts, both stands, every one printing `writes:
[{"how":"window.scrollTo",…}]` beside a `swap.clamped` the gate itself already reported — and the
overshoot equalled that clamp in every single one. Instrumented directly against the failing shape
(route interception on `fs-fit.js`, the SWAP case lifted from the gate itself): the 32-36-row leases
table `SWAP` empties and refills grows its floor box by 128-132px against a 120px pad — table-row
rounding at 390 wide, not the pad — while `compensated` (`seen - ref.at`, how much the OFFSET already
moved since the reference) reads exactly 120px, matching the pad: the engine had already carried out
the whole correction, and `grow`'s own rounding (8-12.25px, the exact overshoot of every finding) was
the only thing the old formula still read as outstanding. Writing that gap back is a second
correction on top of one the engine already made — not a case `grow` failing to see growth (it saw
the growth correctly), but the formula treating "the engine responded, imprecisely" the same as "the
engine never responded at all".

The two are now told apart by what the OFFSET did, not only by what the CONTAINER did.
`compensated` exactly zero is the blind case above, unchanged: the engine never touched the offset,
`grow` is the only witness that saw it, and the whole growth is still the correction. `compensated`
anything else means the engine already moved the offset roughly by its own anchoring, and the
residual is this witness's own rounding, not a number to write — it counts as a miss instead (the
same `_lateMisses` bookkeeping `_engineTrusted` above already keeps) and `lateDrift()` returns
without writing, leaving the correction to `anchorFor()`/`scheduleAnchor()` once `LATE_MISS_LIMIT`
trips — a path that reads the offset back rather than a container's raw height and does not share
this failure.

**Proof.** All 21 CI-failing cells, re-measured through the real gate against the fix
(`tools/scroll-anchor.mjs`, `owrt2512` and `owrtsnap`, webkit and firefox, `@390` `side` and `top`,
`normal`/`compact`/`large`, `/admin/network/dhcp`): `swap moved 0px`, engine alone, no write logged —
zero findings, 24 runs on webkit and 24 on firefox. The overview cell above is unaffected:
`compensated` reads 120px there, matching `grow` to within rounding, so neither branch's write fires
and the cell already passes on its own — the same 0px this page's earlier "Proof" already recorded.

**A miss must mean the engine did not do the job, not that this witness rounded — task missrule.**
Task detector's own fix counted EVERY non-zero gap between `compensated` and `grow` as a miss,
`>= 1`, no matter how small. On `/admin/network/dhcp @390` that gap is 8-12.25px of table-row
rounding, not a residual — so two ticks (10s, `LATE_MISS_LIMIT` is 2) after the fix landed,
`_engineTrusted` went false on an engine that was anchoring that page correctly the whole time. From
the third tick on, EVERY refill took `anchorFor()`/`scheduleAnchor()` **while the engine's own
anchoring was still fully on** — precisely the configuration `ENGINE_ANCHORS`'s own comment warns
against: "running both is not a safety net: two corrections throw the page the other way." §1.17 and
§2.2 of `../tmp/task-anchor-audit/inventory.md` found this the same day the fix above shipped —
"the most important unmeasured consequence in the tree" — because SWAP performs ONE refill and
closes, and `_engineTrusted` only ever moves on the SECOND miss: every one of the 48 green sub-runs
proving the fix above was a first-miss run, and nothing in the suite ever reached a second.

**The three cases, told apart by measurement, not by reasoning this time.** `compensated` exactly
zero — the engine never touched the offset — is unchanged: write the growth back, and that IS a
miss, the engine did nothing. A gap ABOVE `LATE_ROUND_TOLERANCE` (16px, fs-fit.js) is unchanged too:
a real partial failure, no write, and it counts. What changed is the middle: a gap AT OR BELOW 16px
is no longer counted at all — the engine did the job, `lateDrift()` returns having written nothing,
same as the direct `drift < 1` case beside it. 16 is 3.75px (30%) of headroom over the largest of the
three measured gaps (12.25px, large/firefox) — the same margin-over-the-worst-measured-cluster shape
`LATE_MS` already uses two sections up — while staying far under half the 120px pad, so a genuine
partial failure that leaves the reader in the middle of it is never mistaken for rounding. Verified
against the formula directly, the three measured gaps plus a boundary and a control:

| case | grow | compensated | gap | write | miss |
|---|---|---|---|---|---|
| engine did nothing | 120 | 0 | 120 | yes | yes |
| compact rounding | 120 | 112 | 8 | no | **no** (was: yes) |
| normal/large, webkit | 120 | 108 | 12 | no | **no** (was: yes) |
| large, firefox | 120 | 107.75 | 12.25 | no | **no** (was: yes) |
| tolerance edge | 120 | 104 | 16 | no | **no** |
| just past it | 120 | 103.99 | 16.01 | no | yes |
| genuine partial failure | 120 | 60 | 60 | no | yes |

**The gate could not see the switch trip, so it gained a case that can: `REPEAT`**
(`tools/scroll-anchor.mjs`). SWAP's own shape — one refill, then close — is why 48 green sub-runs
never once crossed `LATE_MISS_LIMIT`. `REPEAT` performs `REPEAT_TIMES` (3) of `dom.content()`'s
empty-then-refill cycle on the SAME section, back to back, reading the reader's position after every
one AND `fs-fit.engineTrusted()` (new export, unmarked like `restAt()` — a browser sweep against the
INSTALLED package needs it kept) at the end, so "the reader never moved" and "the switch stayed
trusting" are two separate, both-required assertions rather than one inferred from the other.

**Proof, live, both required shapes, the REAL gate code against the REAL fix (route-interception on
`fs-fit.js`, the same technique as task detector's own proof above — `../tmp/task-missrule/probe3.mjs`,
never committed; `owlab sync` was not used, so the concurrent 3-engine sweep on the same stands was
never touched):**
- `owrt2410`, chromium, `/admin/status/overview @390 top`, a correctly-anchoring cell (`compensated`
  matches `grow` exactly, 0px gap): three consecutive refills, `moved: 0, 0, 0`,
  `trustedBefore: true`, `trustedAfter: true`. The engine did the job every time and the switch never
  moved — the fault this whole task is about, gone.
- `owrt2410`, chromium, `/admin/network/dhcp` (Static Leases tab, a plain `cbi-section-table` the
  probe's own park could get entirely above the fold — the `fs-dt` Active Leases table on THIS
  stand's fixture could not, a container shape difference from whatever CI's routers carried when
  task detector measured 32-36 rows there; noted, not chased further this round): three refills on
  an engine that never anchors this table at all, `moved: -132, -131, -180`, `correctedAt: null`
  throughout — `_lateMisses` reaches 2 on the second refill and `_engineTrusted` goes
  `true -> false` exactly as built. The switch still trips where the engine genuinely declines.

**That proof was never against the shipped `REPEAT` — this task's own developer round found `REPEAT`
measured nothing, anywhere, once it reached a live sweep.** A full three-engine run over
`owrt2512`/`owrt2410`/`owrtsnap` reported 274 of 274 cells `nothing above the reader big enough to
collapse`. Two independent defects, both now fixed:

1. `REPEAT` ran its own body/mark search — the identical selector, the identical park `SWAP` uses —
   but a SECOND time, after `SWAP`'s own two `swap()` passes had already woken `holdFloor()` in
   between. A fresh search there can land on a smaller or grid-absorbed candidate than the one
   `SWAP` just proved reaches the scroller: measured live, an independent search picked
   `table.table.cbi-section-table` (1145px) where `SWAP`'s own search had found a sibling that DID
   reach it. `REPEAT` now reuses `window.__fsRepeatSection` — stashed by `SWAP` the moment it settles
   on a candidate — instead of searching again.
2. `grewDoc` was read AFTER all three of `REPEAT`'s own pads had already been removed — net zero on
   purpose, so even a correctly-picked candidate always reported "the growth never reached the
   scroller." It is now read on the first refill while that pad is still standing, matching `SWAP`'s
   own timing.

Re-run on the same three routers, all three engines, default axes: `REPEAT` measures all 39 of the
39 cells `SWAP` itself measured in the same run (100% parity, up from 0), and it immediately found
**31 real findings, unforced**, on chromium, firefox AND webkit alike: the reader holds through the
first refill of `/admin/status/overview` and `/admin/network/dhcp` but drifts 47-60px on the second
or third back-to-back refill of the SAME section, `corrected: never`. This is the exact shape §2.1
below named "the most important unmeasured consequence in the tree" and could only describe, never
catch — `holdFloor()`'s per-tick `min-height` churn compounding across several ticks rather than one.
**Out of this task's scope: `fs-fit.js` is untouched, and this fault ships unfixed.** `SWAP`, `HOLD`,
`QUIET` and `TICK` are unchanged — 0 findings between them, `mid-flick surprises 0` on all 156 runs.

Confirmed as a real signal rather than a fixture quirk, the same forced-flip technique as the proof
above: a cell that reads clean unpatched (`owrt2410`, chromium, `/admin/status/overview @390 side`,
`moved: 0, 0, 0`, trust `true` throughout) reads `trustedAfter: false` with the reader still not
moving once a route-intercepted, never-synced copy of `fs-fit.js` is made to answer `engineTrusted()`
falsely from its second call on — proof that `REPEAT` fails as readily as it passes.

## Trust that comes back — task trust

Before this task, `_engineTrusted` only ever moved one way. Once `LATE_MISS_LIMIT` tripped it false,
every later refill on that page paid `applyAnchor()`'s 7-36ms path for the rest of the session, even
where the two misses that tripped it were the engine having a bad ten seconds rather than a standing
fault — and nothing in the file could tell those two apart, because nothing ever looked again.

**What restores it.** `TRUST_RECOVERY_LIMIT` (2, symmetric with `LATE_MISS_LIMIT` for the identical
reason: one clean refill is headroom for a one-off, a second is the count) consecutive refills where
`_rest.el` — the same remembered reference `lateDrift()` trusts on the trusted path — holds its own
position, on a tick that actually grew something (`grew > 1`, the same growth witness task blindref
already reads off the mutation record). Both counters live in `fs-fit.js`, read in the mutation
callback itself rather than in `applyAnchor()` — the next section is why.

**Two shapes were tried here and both were wrong, not merely pricier — kept in the code's own comment
for the reason both are kept here.**

1. *Read `applyAnchor()`'s own drift.* It already computes `ref.el`'s rect against the remembered
   top before deciding whether to write, the identical measurement `lateDrift()` uses to call a
   miss — so a hit was counted whenever that drift read under a pixel. Live against a real,
   correctly-anchoring engine (`../tmp/task-trust/probe.mjs`, chromium/owrt2410, the Overview's own
   poll-refilled section) this branch never ran at all: `anchorFor()`'s own offset read forces the
   layout the engine's scroll-anchoring resolves against, so by the time it asks "did the reader
   move", the engine has already moved the offset to absorb the growth — and `anchorFor()`, built for
   an engine that does none of that, reads any offset change that is not a downward clamp as the
   READER having scrolled, and returns null. `scheduleAnchor()` then never runs, so `applyAnchor()`
   never sees the one tick that would prove the engine right — 0 hits across 5 genuinely successful
   refills, measured directly against a debug build exporting the counters.
2. *Compare the offset to the growth instead* (`compensated = scrollTop() - _restAt` against `grew`,
   the identical comparison `lateDrift()` makes for its own blind-witness case). This one does see
   the engine work — but it is not strict enough: measured against a genuinely PARTIAL correction (an
   offset that moved by roughly the growth pad's own size), `compensated` matched `grew` within
   `LATE_ROUND_TOLERANCE` while the gate's own independent mark still sat 48px off, uncorrected. A
   container growing by about the right amount, or an offset moving by about the right amount, is not
   the same fact as THIS specific reference holding — task blindref's own finding (a container-shaped
   witness can agree with a bad tick) applies here just as it did to the miss side.

**What holds.** `_rest.el.getBoundingClientRect().top` against `_rest.top`, read directly in the
mutation callback, before `run()` can overwrite `_rest` — the SAME reference and the SAME comparison
`lateDrift()` already trusts on the trusted path, just made here instead of a rAF plus `SCROLL_IDLE`
later, since the engine's own compensation is already visible by the time anything in this callback
reads geometry (the same fact shape 1 above discovered the hard way). The same guards `lateDrift()`
carries against misreading a reader's own scroll as the engine's — `_userUntil`, `scrolling()`,
`_restPage` — apply here too, plus `_rest.el.isConnected` (the reference may not have survived the
tick at all). None of the three shapes measured a version where dropping one of these was safe; the
asymmetry the design leans on throughout is that **a false negative here only delays recovery, while
a false positive un-distrusts an engine that is still getting it wrong** — so where a cheaper shape
could not be told apart from a wrong one, the stricter shape is what shipped.

**Proof.** `../tmp/task-trust/probe.mjs`, real Playwright against the real, route-intercepted
`fs-fit.js` (never synced to a shared router), `owrt2410`/chromium: forced two genuine misses on
`/admin/network/dhcp`'s Static Leases table (a plain `cbi-section-table` this engine never anchors at
all on this fixture) — `trustedBefore: false`, and the reader's own probe mark stayed within a pixel
through all three refills of that phase, `_engineTrusted` correctly still false. An SPA navigation
(a real click through `fs-router`, not a reload — `_engineTrusted`/`_lateHits` are module state and
have to survive it) then moved the SAME page to the Overview, where the SAME engine keeps the
reference on its own poll-refilled section: trust stayed false through 3000ms of real, unscripted
polling (no organic recovery from ambient noise — nothing accidentally counts), then two explicit
refills recovered it (`trustedBefore: true` once the recovery had happened, `moved: 0, 0, 0` for the
three that followed) — the reader's own position never moved in either phase, matching the rule this
whole file exists to hold. Re-checked on firefox and webkit on the same stand: neither ever recovers
falsely — a real, pre-existing drift on this router's webkit build and session churn on firefox both
left `_rest.el` unable to prove a clean hold, the safe side of the asymmetry above rather than the
dangerous one. `tools/fit-quiet.mjs` (0px peak-to-peak on all three widths) and `tools/scroll-anchor
.mjs`'s `tick`/`3x repeat` cases (`trusted true->true`, 0px throughout on the default axis) are
unmoved: this touches only the already-distrusted branch, which the default, correctly-anchoring axis
of either gate cannot reach at all.

**What this does not claim.** `REPEAT`'s own 31 unforced findings (previous section) are a SEPARATE,
open fault — `holdFloor()`'s per-tick churn compounding across several real ticks on the SAME
section — and recovering trust does not touch it: an engine that keeps drifting on the second or
third back-to-back refill of one section still counts misses the ordinary way, and two of them still
trip distrust exactly as before. Recovery only answers the question this task was scoped to: once
distrusted, does the theme have a way back on genuine evidence, or is the flip permanent regardless of
what the engine does afterward.

## A floor that shrinks with nobody watching — task wkrefill

`holdFloor()` refuses outright while `scrolling()` reads true (the next section explains why: a
clear-and-remeasure pass is a forced layout, and running one mid-flick is the shaking this whole
file exists to stop). A floored box whose real content shrank while that guard was up does not lose
the shrink — it is simply not cleared THIS tick. The next thing to call `holdFloor()` successfully
was, until this task, `sampleMotion()`'s own termination: `holdFloor(); rememberRest();`, run the
moment the reader is judged still again, wired to neither `lateDrift()` nor `scheduleAnchor()`. The
`min-height` write that call performs is a real scroll-anchor invalidation (`holdFloor()`'s own
citation, css-scroll-anchoring-1 §2.2.2) — the engine reacts to it — and nothing here was reading
whether that reaction was complete.

**Measured** (`../tmp/task-wkrefill/run-probe2.mjs`, webkit/owrt2512b @390 top, normal, the exact
shape `REPEAT` exercises): a growth-then-shrink refill landing entirely inside one motion window —
the pad's own growth starts the sampler, and the probe's own refill cadence does not give it time to
fully settle before the shrink lands — left `_restAt` 59px higher than where it started. `mark`'s
own PAGE position never moved (7441.15625px in every snapshot, before the refill, mid-growth, and
after); its VIEWPORT position read 440 against a `before` of 499, purely because the scroller's
offset itself was left 59px off a page that had not, in fact, changed. `_rest` had already been
re-established on top of that wrong offset — a fresh `anchorRef()` hit test, at whatever the fold
happened to be — so the NEXT refill's own reference (an `H3` this run, a different element from the
`DIV` the reader was originally parked against) showed zero drift for every check after: the
findings this task started from (`webkit owrt2512b/owrt2410b @390 side/top normal overview: refill
2/3 or 3/3 left the reader 58-60px off`) are the visible half of exactly this.

**Three shapes were tried and measured wrong before this one, kept for the reason task trust's own
two are kept above.**

1. *Route the same information through `lateDrift(ref, 0, floorShrink)` from `sampleMotion()`.*
   Collided with the regular mutation's own pending call for the SAME tick: that call's `seen` is
   captured one rAF after the original (refused) mutation, well before `sampleMotion()` ever gets to
   clear the floor, so by the time this second call tried to arm, `_lateFrame` was already occupied
   — and by the time the original call's own 400ms timeout fired, `holdFloor()`'s belated write had
   already moved the offset on its own, read there as `scrollTop() !== seen`, "the reader is still
   moving", and refused too. Two correct guards, aimed at two different questions, defeating each
   other on the one tick both fire for.
2. *Check `_rest.el`'s own drift once the streak of refusals is over,* the same rect comparison
   `lateDrift()` and task trust's own recovery check both already trust. Cannot see this fault BY
   CONSTRUCTION: `_rest` is exactly what gets RE-ESTABLISHED, at whatever the offset happens to be,
   by the very next successful `rememberRest()` — which is a fresh hit test at the CURRENT fold, not
   a check on the OLD one. Once established on an already-59px-wrong offset, the reference it picks
   shows zero drift for ever after, because it was placed AT the wrong position, not moved away from
   the right one. A witness cannot catch a fault in the ground it is itself read off — the third
   instance of the exact class task blindref and task detector already found twice.
3. *Gate the check on `scrolling()`,* the same guard `holdFloor()` itself uses. Refuses on the very
   motion it exists to observe: `holdFloor()`'s belated write is itself what the engine reacts to,
   and that reaction dispatches the `scroll` events which keep re-arming `_movingUntil` — measured,
   `scrolling()` still read true one whole animation frame after the write, on every one of three
   cells, for exactly this reason. `lateDrift()` never makes this mistake; it checks `scrollTop() !==
   seen`, stability between two reads, not "is anything moving at all" — and once this used the same
   check, the guard stopped refusing on its own effect.

**What holds.** `settleDeferredFloor()`, a dedicated frame slot so it cannot collide with either of
`lateDrift()`'s or `scheduleAnchor()`'s, comparing the OFFSET's own response to the shrink directly —
`wanted = offsetBefore - shrink` against the offset two animation frames later, `scrollTop() !==
seen` in between as the stability check — the same `compensated` vs `grow` shape `lateDrift()`'s
blind branch already uses for a GROWTH, made here for a SHRINK `holdFloor()` is about to apply. On a
write, `_rest` is adjusted IN PLACE (`_rest.top -= gap`) rather than re-established through
`rememberRest(true)`: the fourth attempt measured that a forced `rememberRest()` calls `anchorRef()`
regardless of `force`, and `anchorRef()` carries its OWN unconditional `scrolling()` refusal, so a
call landing inside this write's own settling window left `_rest` NULL rather than merely stale — the
very next mutation's `lateDrift()` then had no reference at all and the reader ended up 120px off in
the OTHER direction, worse than doing nothing. `_rest.el` did not move; only the offset it is measured
against did, by exactly `gap`, so its remembered screen position needs adjusting, not re-reading.

**Not counted toward `_lateMisses`** — the same rule `lateDrift()`'s own `floorShrink > 1` skip
already states: this write answers for the theme's own bookkeeping catching up late, not for
anything the engine declined to do on an ordinary tick.

**Proof.** The real gate, not this task's own probe: `node tools/scroll-anchor.mjs --only owrt2512b
--engines webkit --width 390 --layout side|top --page /admin/status/overview` and the same for
`owrt2410b` all read `3x repeat 0px/0px/0px`, `trusted true->true`. A full default-axis webkit sweep
across `owrt2512b`, `owrt2410b` and `owrtsnapb` (overview, dhcp, processes; 390/1440, side/top) found
one residual finding, on `owrt2410b @390 top overview` — `_engineTrusted` still goes false there
(a genuine pair of uncompensated growths on that router's specific webkit build, unrelated to any
floor), but the reader's own position holds at `3x repeat 0px/0px/0px` throughout: a SEPARATE,
pre-existing fault this task did not touch and left for its own investigation — read as the
miss-count's own asymmetry here, which task close later measured and disproved ("The theme's own
floor write is what the engine declines for"). `fit-quiet` (0px peak-to-peak, all widths, all three routers) and `npm run check` are
unaffected: this is additive bookkeeping on a path only a refused `holdFloor()` ever reaches.

## `_rest`'s own baseline goes stale mid-tick — task nine, open

Task wkrefill's own residual note (previous section) named the shape without chasing it: "the
miss-count's own asymmetry... never cross-checks `compensated` when `drift` reads large rather than
near-zero." This task traced that asymmetry to its source and found it is wider than the miss-count
alone.

**The mechanism.** `lateDrift()`'s baseline (`ref`/`settled`, passed in as `_rest` from BEFORE the
current tick's own `run()`) is only ever refreshed by three things: a WRITE inside `lateDrift()`
itself (forced, `rememberRest(true)`, task refill2's own fix), `scheduleAnchor()`'s forced call on
the untrusted path, and — unforced, unconditional, synchronous — `run()`'s own bare `rememberRest()`
call on EVERY mutation the trusted path does NOT write for. That bare call reads `anchorRef()`'s
geometry in the SAME microtask as the mutation, before the engine has had a rendering step to react
— a mid-transition snapshot, not the settled one `lateDrift()` itself takes 420ms later. Where the
engine settles in one step this is invisible; where it settles gradually (measured live on webkit —
`scrollTop()` still moving 400-900ms after a mutation, task nine's own instrumented
`rememberRest()`) it is not, and the mid-transition value becomes the baseline the NEXT mutation's
own drift is measured against, indistinguishable from a real residual. Confirmed at four call sites:
`run()`'s own line (the main path), `_moFlag`'s and `_moTabs`'s bare `run()` calls (a poll's own
request-in-flight class and a `depends()` re-evaluation can each land inside the same tick as a
growth), and `sampleMotion()`'s deferred-batch `run()`.

**Reproduced directly** (`../tmp/task-nine/probe-overview.mjs`, never synced to a shared stand,
instrumented copy only): three back-to-back growth/shrink cycles on `/admin/status/overview`,
webkit/owrt2410. `_rest.at` drifted 60-120px from the offset the reference was actually taken at,
purely from the ordinary sequence of bare `rememberRest()` calls chasing a still-settling offset —
`_engineTrusted` tripped false on a section the reader never saw move (the mirror of task missrule's
own fault: there, the theme's OWN rounding was counted as an engine failure; here, the theme's own
STALE BASELINE is).

**Two fixes measured, one shipped, one reverted — read before trying either again.**

1. *Refresh `_rest` in `lateDrift()`'s own no-write exits too* (the blind-branch miss, and the plain
   `drift < 1` return), mirroring task refill2's existing write-path fix, gated on `grow > 1 ||
   floorShrink > 1` so an uneventful tick pays nothing extra. Low-risk, principled, and measured to
   change NOTHING on its own (`--only owrt2512,owrt2410,owrtsnap`, all three engines: still 8-10
   findings, same shapes) — because the very next mutation's own bare `run()` call overwrites
   whatever this just fixed before it is ever read. **Shipped** (it does not regress anything and the
   write-path already uses the identical pattern), but it is not the fix on its own.
2. *Defer `run()`'s own bare call the same way `_anchorPending` already defers it for the untrusted
   path* — skip the unforced `rememberRest()` on a trusted tick that has a reference to hand
   `lateDrift()`, at all four call sites above, so lateDrift()'s own settle-verified capture is the
   ONLY thing that ever touches `_rest` on a tick it is watching. This DID close the specific traced
   case (`_rest.at` stayed accurate for all three refills in the isolated probe). It also introduced a
   NEW failure at full-sweep scale that was not visible in the isolated probe: `webkit/owrt2410 @390
   top overview` reported `refill 1/3 left the reader 120px off (corrected 22ms)` — the engine
   corrected briefly, then something moved the page the FULL, uncompensated growth away from it,
   worse than the fault being fixed. Likely cause, not yet confirmed: deferring `run()`'s bare call
   removes a "self-healing" property it incidentally had — even an imperfect mid-transition snapshot
   gets overwritten on the NEXT tick, so a reference that went stale for a reason OTHER than this
   mechanism (this session's own probe runs `REPEAT` after `SWAP`, whose own "floor alone" ablation
   phase runs with the correction path different from the rest of the sweep) no longer self-corrects
   and persists into `REPEAT`'s own park. **Reverted** — the sweep as a whole went from 9-10 findings
   to 9, but with a new, unproven-safe shape among them, which is not the trade this task's acceptance
   asked for.

**What is not yet tried.** Narrowing the defer to `_lateFrame`'s own pending window rather than
"trusted + has a reference" unconditionally — measured NOT to help the specific M1→M2 case this task
traced (`_lateFrame` clears at the top of its own `setTimeout`, ~420ms after the mutation that armed
it, and the interfering mutation in the traced case arrives ~900ms later, well outside that window)
without ALSO moving the `_lateFrame = 0` reset to the end of the callback — untried, because it
changes refusal 1's own timing contract (`lateDrift()`'s doc comment: "one per tick, whichever batch
armed it first") in a way this task did not have the budget to re-measure against `SWAP`/`TICK`/
`QUIET` as well as `REPEAT`. The isolated-probe proof above (`../tmp/task-nine/probe-overview.mjs`)
is scratch, not committed, and the exact shape of the full-sweep regression above was not chased past
naming it — the next session should reproduce it on its own before trying fix 2 again.

## The sweep's own clamp — task resid

`REPEAT`'s 47-64px residual (two sections up, left open by task nine) is not a reference going stale
on its own. It starts one pixel at a time, inside `holdFloor()`, and the pixel is the theme's.

**Measured, not reasoned.** An instrumented copy of `fs-fit.js` served by route interception over the
real gate (`../tmp/task-resid/`, never synced anywhere; the gate itself unmodified apart from a dump
of the log), chromium/`owrt2512b` `@390 top normal` `/admin/network/dhcp` — the cheapest cell of the
finding, which reproduces on demand: `3x repeat 0px/-47px/-47px`.

| what | number (`../tmp/task-resid/dbg-before.json`) |
|---|---|
| `holdFloor()` sweeps in the run | 38 |
| of those, document shorter between the clear and the write-back | 33 |
| of those, the offset went down with it | 13 |
| … the document came back and the offset did not (this fault) | 8 |
| … the document stayed shorter, a real shrink clamped for real | 5 |
| sweeps that moved the offset UP | 0 |
| corrections `lateDrift()` then refused as "the reader is moving" | 6 |

The eight are the unscoped, every-box sweep `sampleMotion()` runs when the reader is judged still:
33 boxes cleared at once, document 4730px → **4729px** → 4730px, offset 3886 → **3885** → 3885. The
floors go back and the document with them; the offset does not. `holdFloor()` clears every floor
before it measures — that clear is what makes the answers honest (next section) — and for the length
of the measure pass the document stands without them, one pixel short of what the reader's offset
needs. The clamp that costs is the floor's own.

**One pixel, and then 59.** `lateDrift()` reads the offset twice, `SCROLL_IDLE` apart, and treats any
difference as the reader having moved (`scrollTop() !== seen`). The sweep landed six milliseconds
before that second read, so the tick's own shrink correction — 60px, already computed — was thrown
away as "the reader is moving" (`late-refuse why: moving, seen 3886, now 3885`), and the unforced
`rememberRest()` a millisecond later adopted 3885 as the reference the NEXT refill measures against.
The next refill then measured `drift 10.63` off that wrong ground and wrote `4017`: the reader's own
mark at -47px, `corrected: never`, `engineTrusted` true throughout — the finding, end to end, with no
step in it that anything before this task could see.

**The fix is in `holdFloor()`: it puts back the offset its own pass took.** The offset is read before
the clear, and the scroller's height with it; after the write-back, where the offset is lower AND the
scroller is as tall again as it was, the pre-sweep offset is written back through `writeOffset()` —
the same door both corrections use, so the motion sampler reads the restore as this file's own
(`sawOwnWrite()`) rather than as the reader arriving. Nothing in the function is asynchronous and
`scrolling()` at its top already refused a moving reader, so an offset that is lower at the end than
at the start was lowered by this pass and by nothing else.

**Two forms were measured; the narrow one shipped.** Restoring unconditionally — no height test, the
browser's own clamp doing the separating, since a write above the maximum lands back on the pixel it
already stands on — is green on this cell too, and 70 B cheaper minified (`fs-fit.js` 8202 B at HEAD,
8238 B unconditional, 8308 B as shipped). It also turns every genuine
floor-shrink clamp into this file's own write, so the motion window that clamp used to open stops
opening and `sampleMotion()`'s terminal sweep stops running behind it: a change to what `scrolling()`
answers for the whole theme, on a path this task measured one cell of. `scrolling()`'s own contract is
"the page is moving, whoever moves it", and the height test holds the cell on its own, so the wider
form does not ship.

**Proof.** The real gate, against the working tree synced to the stand (`owlab sync owrt2512b`), the
same cell: `3x repeat 0px/0px/0px`, `trusted true->true`, no finding — where the same command on the
same stand read `refill 2/3 … -47px off (engineTrusted true, corrected never) — writes:
[{"how":"window.scrollTo","val":4017}]` before it. `SWAP`'s own floor-only ablation on that cell moved
with it, `clamped -59px, reader -47px` → `clamped 0px, reader 1px`. `tools/floor-contract.mjs`
(`owrt2512b`, the gate `js.md` names for anything in `holdFloor()`): 62 floors, worst -1px against the
box, 4 released after emptying, 3 on a tab switch, 5 partial shrinks — unmoved.

**And the sweep around it.** `--only owrt2512b,owrt2410b,owrtsnapb --engines chromium,firefox,webkit`,
default axes, all three pages: **no `REPEAT` position finding anywhere** — not one refill left the
reader outside tolerance on any engine, stand or page. The single finding the run does carry is
`webkit owrt2410b @390 top normal overview: _engineTrusted went false after 3 refills the reader never
moved for (misses: [true,true,false])` — the same cell, the same shape and the same reader-holds-at-0px
reading task wkrefill's own Proof already recorded as pre-existing and separate. Untouched here; the
cause is measured in the next section, and it is not the miss-count asymmetry both earlier sections
guessed at.

**Cost:** +106 B minified. `coldJs` 60,400 → 60,550 and `resourcesJs` 95,300 → 95,400
(`tools/size-budget.mjs`, each with the note the raise is written against); the unconditional form's
+36 B fits inside both, and is the only reason the choice above is a trade rather than a preference.

## The theme's own floor write is what the engine declines for — task close, open

The residual the section above leaves — `webkit owrt2410b @390 top normal overview: _engineTrusted
went false after 3 refills the reader never moved for (misses: [true,true,false])` — is not the
asymmetry task wkrefill and task nine both guessed at. **The two misses are counted for refills the
engine really did decline; what makes it decline is this file's own `min-height` write, and no
narrow rule separating that from a real decline was found. Nothing shipped. Read this before trying
the miss-count again.**

**The hypothesis on this page until now, disproven.** Both earlier sections named it the same way:
"the miss count never cross-checks `compensated` when `drift` reads large rather than near-zero".
Instrumented through the real gate's own code (`../tmp/task-close/`, scratch, never committed and
never synced to a stand: an instrumented `fs-fit.js` served by route interception, and a copy of
`tools/scroll-anchor.mjs` carrying that route plus a log dump — the gate in the tree is untouched,
and reproduces the finding by itself), the two counted misses read
`drift 120, grow 120, compensated 0` — the cross-check the hypothesis asks for gives ZERO, which is
"the engine never touched the offset", the one case that IS a miss. The offset stood at 6518 through
a 120px growth entirely above the reader, and the mark held only because `lateDrift()` wrote the
120px itself (`out=write/miss`, `wrote 6638`). The gate's own finding text — "the engine was
anchoring correctly the whole time" — is its inference from the reader not moving, and the reader
not moving is the theme's correction, not the engine's.

**What the engine is actually doing, measured against the theme with its correction off**
(`../tmp/task-close/probe2.mjs`, `fsAnchor=off` so the floors and the observer still run and no
scroll write in the window is the theme's; a 120px pad appended above the fold, 14 add/remove cycles,
`owrt2410b`/webkit `@390 top`): the engine anchors **every other cycle**, `moved 136 / 0 / 136 / 0 …`,
and the alternation is indifferent to a programmatic scroll before the mutation — the delays 0, 30,
100, 300, 600 and 1200ms and the no-scroll control all sit on the same alternating sequence. It is
not a suppression window after a scroll write, which is what the instrumented gate run made it look
like.

**The ablation that names the cause.** The same probe against a copy whose `holdFloor()` returns at
its first line — no floors written at all, everything else identical: **13 of 14 cycles anchored**
(`moved 136`, one 198, one 0) against 8 of 14 with the floors on. The `min-height` clear-and-rewrite
this file performs on every `run()` is what costs the engine its adjustment, on roughly half the
refills, on this page — `holdFloor()`'s own citation for why that write is a scroll-anchor
invalidation (css-scroll-anchoring-1 §2.2.2) reaching the growth side, where only the SHRINK side is
excused today (`floorShrink > 1`, task refill2). `owrt2512b` on the same engine and width reads
`compensated 120` on every refill of the same case, with no theme write anywhere in the run: the
same code, a different page, and the invalidating write does not coincide with the growth there.

**Why nothing shipped.** The obvious rule — do not count a miss on a tick this file rewrote a floor
in — is not narrow, it is unconditional: every `run()` sweeps, so the counter would never fire again
and `_engineTrusted` could never move, which is `LATE_MISS_LIMIT`'s whole purpose. Nothing measured
here separates the half that suppresses from the half that does not: the floor is written on every
cycle and the engine anchors on half of them, so "a floor was written" is not the discriminator, and
neither is "the floor's value changed" (it grows by the pad on both stands, and `owrt2512b` anchors
anyway). Raising `LATE_MISS_LIMIT` to 3 is tuning a threshold for green and was not tried. The one
direction not yet measured is making the sweep stop clearing a box whose floor it is about to write
back unchanged — that touches the "cleared and re-measured, not read off the content" contract six
measured failures stand behind (next section), and holding it needs the whole sweep, not one cell.

**Impact while it stands.** The reader does not move on this cell — `3x repeat 0px/0px/0px` — because
the fast path takes over and corrects. What the flip costs is the guarantee `ENGINE_ANCHORS` exists
for: `anchorFor()`/`scheduleAnchor()` running beside an engine that anchors the OTHER half of the
refills, which is the "two corrections throw the page the other way" configuration. It has been
measured not to throw the reader on this cell, and only on this cell.

## A clamp is not the reader — task wk1440

The last cell CI failed on — `webkit owrtsnap @1440 side compact overview`, engine-anchoring on, run
34483363796 — carried two findings, and only ONE of them was the reader ending up in the wrong place:
`3x repeat 0px/-60px/-60px`, `refill 2/3 … left the reader -60px off (engineTrusted true, corrected
never)`, with a write of its own recorded in the window. That is this section. The other finding is
the `419ms` one, and it is still open — the last paragraph here says what it is and what it is not.

**The cell is `.fs-main`, not the window**, which is why 28788d0 did not reach it: every cell that
commit closed scrolled the document. Nothing about the inner scroller turned out to matter, though —
the fault below is the same on either, and it was reproduced on this one because this is the one CI
named.

**Reproduced, and the reproduction is the useful half.** The cell is green on demand locally: WebKit's
own anchoring works there, so the theme is never the corrector and there is nothing to get wrong (3
runs, `3x repeat 0px/0px/0px`, `corrected 16ms`). What CI has that a fast machine does not is an
engine that DECLINES on this cell — so the engine's own anchoring was ablated away with
`overflow-anchor: none` and NOTHING else (task latenet's own SWAP ablation: the theme still believes
the platform anchors, `fsEngineAnchor` untouched), and both CI findings appeared verbatim, first try:
`3x repeat 0px/-60px/-60px`, `corrected 419ms`. Scratch, never synced anywhere and not committed
(`../tmp/task-wk1440/`): an instrumented `fs-fit.js` served by route interception, plus a copy of
`tools/scroll-anchor.mjs` carrying that route and the ablation — the gate in the tree is untouched
and reproduces nothing by itself here.

**What the instrumented run shows, and it is not the refill.** The -60px is made between two refills,
by the pad coming OFF:

| what | number (`../tmp/task-wk1440/dbg-*.json`) |
|---|---|
| the scroller when the 120px pad is removed above the reader | 2793 → **2673px** |
| where the browser's clamp put the offset | 1889 → **1829** |
| where the reader needed it | **1769** |
| `applyAnchor()` one frame later | `scrolling true, moving 400ms, at 1829` — refused |
| the correction it was holding | `drift -60`, never written |
| what `rememberRest()` then adopted | 1829, `_rest.top` -362.625 → **-422.625** |

A clamp gives back only what the document lost at its BOTTOM. A 120px shrink ABOVE the reader needs
120px of offset; the bottom had 60px to give, so the clamp took 60 and the reader was left 60px short
— and `applyAnchor()`, the one thing that puts back the rest, refuses while `scrolling()`, which the
clamp's own `scroll` event had just made true 11ms earlier. **The very trap `settleDeferredFloor()`'s
own third attempt already fell into once** ("gating on `scrolling()` refuses on the very motion it is
trying to observe"), on a different path, in the one guard nobody had re-read for it. From there the
terminal sweep's `rememberRest()` re-took the reference AT 1829, and every refill afterwards measured
a textbook 0px of drift against ground that was already 60px wrong: `refill 2/3 … corrected never`,
`engineTrusted` saying nothing, no step in it visible to the gate.

**The fix is one pixel, recorded where the clamp is already watched.** `holdFloor()` reads the offset
and the scroller's height before its clear and again after the write-back — task resid's own
measurement — and it already separates its own transient dip (`scrollHeight` back where it was, the
offset restored) from a real shrink (`scrollHeight` still shorter). That second branch did nothing
until now; it now records the PIXEL the clamp landed on, and `applyAnchor()` treats `scrolling()` as
not blocking while the offset is still standing on it. Read back with the identical `scrollTop() !==
seen` shape `lateDrift()` asks of its own offset, so the mark stands only while nothing has moved: a
reader who really is scrolling has left that pixel by definition, which is what keeps this to one
case.

**NOT a second `_ownWrite`, and that is the whole difference from the form task resid declined.**
`scrolling()` is untouched: it keeps answering "the page is moving, whoever moves it" for the whole
theme, the motion window a real clamp opens still opens, and `sampleMotion()`'s terminal sweep still
runs behind it. The new marker answers one narrower question, for `applyAnchor()` alone — is the
motion blocking this correction the clamp the correction is FOR?

**Proof, the same rig.** `clamp-mark 1829` → `saw-clamp mark 1829 now 1829` → `apply-in drift -60` →
`apply-write to 1769`, and the reference stays honest (`_rest.top` -362.625 throughout). `3x repeat
0px/0px/0px`, corrected 34/23/23ms where it read 0/-60/-60 and `corrected never` before. The NEXT pad
removal then clamps nothing at all (`at 1769, landed 1769`): with the offset already where the reader
belongs, there is no clamp left to make. `tools/floor-contract.mjs` — the gate `js.md` names for
anything in `holdFloor()` — over all three twins: 175 floors, worst -1px against the box, 12 released
after emptying, 9 on a tab switch, 3 folds closed, 3 `depends()` rows, 15 partial shrinks; unmoved.

**And the sweep around it.** Before, on the three twins with the tree at HEAD: `--engines webkit
--full`, 181 cells measured, **3 findings**. After, the same twins with the fix synced and all three
engines this time: `--engines chromium,firefox,webkit --full`, **552 cells measured, 2 findings** —
both of them ones the before run also carries (`webkit owrt2410b @390 top normal overview:
_engineTrusted went false after 3 refills the reader never moved for`, task close's own open cell, and
`webkit owrtsnapb @390 side normal /admin/network/dhcp: refill 2/3 … -49px … corrected never`, a
window-scroller shape with THREE `window.scrollTo` writes in its window rather than this fault's one,
present identically before and after and absent from CI's own run of the same axes). Nothing new on
chromium or firefox, nothing new on any window-scrolling cell, `mid-flick surprises 0` on all 552 —
which is the regression this change had to be measured against, since it lets `applyAnchor()` run
while `scrolling()` reads true. The third before-finding (the owrt2512b twin of that same dhcp shape)
did not reappear; one pass is not enough to call it closed, and nothing here was aimed at it.

**Cost:** +53 B minified (`fs-fit.js` 8308 → 8361 B). `tools/size-budget.mjs` is unchanged and green
— shipped JS 93.1 → 93.2 KB against a 95400 B budget.

**What this does NOT close, measured.** The cell's other finding — `a section was refilled … and the
correction landed 419ms after the refill` — survives the fix, and it is not this fault: with the
engine ablated off, `lateDrift()` is the only corrector for the first two refills of a page and it
answers one rAF plus `SCROLL_IDLE` later BY CONSTRUCTION (task latenet measured that path at
419-420ms and picked `LATE_MS` to sit between it and the fast path's 7-36ms). The trace is
unambiguous: HOLD's own pad is miss 1, SWAP's refill is miss 2 and is corrected late, `_engineTrusted`
goes false immediately after it, and every refill from there is corrected at 23-34ms
(`3x repeat 0px/0px/0px`, `trusted false->false`). Closing it means one of two things, neither of them
this task's: stopping the engine from declining in the first place — task close's own open cause, the
theme's `min-height` write — or letting the switch trip on the FIRST refill the engine provably did
nothing for, which is `LATE_MISS_LIMIT`'s headroom and a threshold, not a cause.

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
- **And a box nothing touched must not be re-cleared at all — task floorchurn.** Every one of the six
  points above assumes the clear-and-remeasure pass is the cost of correctness; it is also, on its
  own, a cost worth not paying twice. Instrumented across 25s of real polling on the Overview, three
  routers whose poll delivers System/Memory/Storage as separate `MutationObserver` batches (`owrt2512`,
  `owrtsnap`, `imm2512`): 25 `holdFloor()` calls (5 per tick) times up to 29 candidate boxes is 725
  clears and 625 writes, and 610 of those 625 write back the value already standing — only 15 boxes
  ever actually change (`../tmp/task-floorsuppress/`). A box no mutation touched cannot have a
  different true content height from the one this function measured it at last time — the only other
  thing that changes what a box's content needs is a WIDTH change, which is a different codepath
  entirely (`onResize()` → `schedule()` → `run()` with no records, still an unscoped sweep). So
  `holdFloor()` now takes the mutation observer's own `records` and narrows the clear/measure/write
  step to the boxes at least one record's `target` actually touched, either direction (a box may be
  the target itself, contain it, or — a fresh child just inserted into it — be contained BY it);
  every other caller (the resize re-fit, `_moFlag`, `_moTabs`, the deferred-floor sampler) passes
  none and still gets the full, unscoped sweep, so none of the six points above lost any coverage —
  `r.target` (above, `grew`/`floorShrink`) is never excluded, since it already carries `data-fs-floor`
  and is by construction one of the mutation's own targets. Measured live against the real fix,
  same page, same 25s window: 725/625 down to 70/70 on the three routers above (a ~90% cut, `changed`
  unmoved at 15 — nothing missed), and 80/75 down to 75/75 on `owrt2410`/`imm2410`, whose Overview
  batches the same tick into a single callback rather than five, leaving little for a per-call skip
  to find — not a regression, the unscoped-equivalent case this design already had to be safe under.
  This is a COST fix, not a correctness one: the same probe that measured the churn found it does not
  suppress the engine's own anchoring on any engine, and forcing every box "unchanged" by reading its
  height WHILE ITS OLD FLOOR IS STILL APPLIED — `min-height` masks a real shrink the same way it masks
  everything under the floor — was tried and rejected for exactly the danger this file exists to
  guard against: `tools/floor-contract.mjs` gained a case that shrinks a floored box by half its
  children (not empty — `EMPTY_TALLEST`/`AFTER` above already cover that) and reads the floor back
  against what the box actually stands at; the masked check fails it outright (a real live cell:
  `owrt2410`/`imm2410` overview, a table cut from 15 to 8 rows, floor stuck at 639px against a 339px
  box, +300px of blank the theme would never take back), the mutation-scoped fix passes it (339px
  against 339px, 0px), and `floor-contract`'s existing ACCURACY/RELEASE/switch/fold/depends cases are
  unmoved on the full default sweep (175 floors, worst −1px, 0 findings).

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
| `holdFloor()` putting back the offset its own clear pass lost (task resid) | `REPEAT`'s refill 2 or 3 on the same section left the reader -47px off, chromium `@390 top` on `/admin/network/dhcp`, `corrected never` and `engineTrusted` true throughout — every other mechanism here green in the same run | yes — one pixel taken by the sweep is enough for `lateDrift()` to read the page as moving and discard a 60px correction whole |
| `applyAnchor()` seeing past the clamp's own scroll event (task wk1440) | `REPEAT`'s refills 2 and 3 on the same section left the reader -60px off, `corrected never`, webkit `@1440 side compact` on the Overview with the engine's own anchoring ablated away — `applyAnchor()` refused on `scrolling()` 11ms after the clamp that caused it, holding a correct -60px correction it never wrote | yes — the shrink that is not fully clamped is invisible to every other mechanism here, and the reference is re-taken on top of it |
| `settleDeferredFloor()` (task wkrefill) | `REPEAT`'s refill 2 or 3 on the same section left the reader 58-60px off on WebKit @390, side and top, every other mechanism above green throughout | yes, and narrowly: the ablation is `holdFloor()`'s own `scrolling()` guard being reached at all — a floored mutation landing while the reader is already moving, which the default axis's first refill does not produce but its second and third routinely do |
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

