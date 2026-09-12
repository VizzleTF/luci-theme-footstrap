'use strict';
'require baseclass';
'require ui';

/* fs-fit — the theme's one "does it still fit?" engine; add fit logic here, never a second
 * observer. No CSS query can ask what the CONTENT needs (media = viewport, container = container):
 * whether the menu fits beside the brand, whether a table is still readable. Breakpoints were tried
 * and are guesses — useless for a third-party luci-app-* table of unknown column count.
 *
 * Three rules, each a bug that was hit:
 *  1. MEASURE UNCOLLAPSED — a collapsed thing always "fits" (a stacked table is a pile of flex
 *     rows), so reading it as it stands un-collapses it and the next frame re-collapses.
 *  2. RE-FIT SYNCHRONOUSLY ON A MUTATION — the poll re-renders content on every tick
 *     (`pollinterval`, 5 s by default) and the fresh element has lost our class. A MutationObserver
 *     callback is a microtask (pre-paint) while rAF runs at paint, so deferring paints a stacked
 *     table one frame at full width — 19-109px of overflow, once per poll tick, on
 *     Firewall/DHCP/Wireless.
 *  3. COALESCE ON RESIZE — every fit forces a synchronous layout.
 *
 * ResizeObserver, not onresize: a rail collapse and a layout toggle change the content width
 * without resizing the window. */

/* The arm belongs to the disarm. `theme/30-tables.css` keeps a data table out of the layout until
 * something marks it `.fs-fitted`, and only fs-select.js ever writes that mark — a module the
 * footer requires separately, with no dependency edge from here. Arming the rule at module eval
 * therefore left every data table invisible in any document where fs-select failed to load. So the
 * arming is exported and the module that clears the rule is the one that raises it. */
function armGate() {
	if (!fittersEnabled()) return;
	/* WRITTEN AS THE LITERAL `dataset.fsFit`, never through a helper: tools/table-contract.mjs
	 * reads this file for exactly that spelling to prove the gate rule is still armed, and an
	 * indirection hides the write from it. The behaviour survives being factored out; the
	 * contract does not. */
	try { document.documentElement.dataset.fsFit = '1'; }
	catch (e) { /* no document, no flag to write */ }
}

const _fitters = [];
let _rafPending = false;
let _ro = null, _mo = null, _moFlag = null, _moTabs = null;

/* ---- a pass that reads layout may not run while the reader scrolls ----
 *
 * `getBoundingClientRect()`, `clientWidth` and `scrollWidth` force a synchronous layout, and doing
 * that from a poll tick in the middle of a flick is what iOS holds the main thread
 * back to prevent — the largest part of the shaking reported from an iPhone.
 *
 * Each pass states the rule for itself: one that reads layout asks `scrolling()` and calls
 * `deferMeasurement()`, one that only writes does neither. Deciding it centrally here was tried and
 * reverted — it also moves WHEN the deferred work lands, and the device shook again. The pass that
 * must always run is the marking of a freshly polled table, since the stylesheet keeps an unmarked
 * table out of the layout. */
function runAll(list, what) {
	for (const fit of list) {
		try { fit(); }
		/* one broken fitter must take neither the others nor the poll's MutationObserver
		 * callback with it: that would stop all re-fitting, silently */
		catch (e) { console.error('fs-fit: a ' + what + ' threw', e); }
	}
}

/* dev switch: `localStorage.fsFit = 'off'` stops every fitter, so a device that shakes can be asked
 * whether the theme's measuring is the cause */
function fittersEnabled() {
	try { return localStorage.getItem('fsFit') !== 'off'; }
	catch (e) { return true; }
}
/* One path for everything that may run now: the mutation observer, the coalesced re-fit and a pass
 * put off during a scroll all come through here, so the order — work, then the floor, then the
 * reference — is stated once. The correction is not this function's: observeContent() takes its
 * reference before calling here and applies the offset afterwards.
 *
 * `records`, passed ONLY by the childList observer's own callback (below), is what lets
 * `holdFloor()` skip a box nothing touched (task floorchurn) — every other caller leaves it
 * undefined and gets the unscoped, every-box sweep, unchanged. */
function run(records) {
	if (!fittersEnabled()) return;
	runAll(_fitters, 'fitter');
	/* make the document whole again before anything lays it out, then take the position the next
	 * mutation is measured against — unless a correction is already on its way, which would make
	 * this reference the drifted one */
	holdFloor(records);
	if (!_anchorPending) rememberRest();
}

/* ---- the document may not get shorter while a tick is in flight ----
 *
 * `dom.content()` — what every LuCI poll calls to refresh a section — empties the container before
 * it refills it, and a layout taken while it is empty clamps the reader's offset into a document
 * that was never really that short. Nothing puts that back.
 *
 * So each container that a poll empties carries a floor: `min-height` at the height it had at the
 * last settled moment, written BEFORE the tick rather than during it. That distinction is the whole
 * mechanism — pinning the container from inside the same statement sequence does nothing, because
 * `dom.content()` performs no layout and no layout ever sees the pin (measured: 1882px still
 * clamped away with the pin in place). A floor already standing when the container empties needs no
 * layout to be seen.
 *
 * The floor is on those containers and NOT on the column around them, which is where it used to be.
 * `min-height` on an ancestor of the engine's own anchor is a suppression trigger —
 * css-scroll-anchoring-1 §2.2.2 lists it, and Blink's list (css_properties.json5,
 * `invalidate: [..., "scroll-anchor"]`) is wider still — so a floor on the column bought the clamp
 * back by turning the engine's anchoring off: 120px grew above the reader and the page moved all
 * 120px under them, on Chromium and Firefox alike. The suppression walks only the path from the
 * anchor to the scroller, and a container that empties is never on it: either the anchor was inside
 * it, in which case the engine has lost the anchor anyway, or the anchor is elsewhere and this
 * container is a sibling.
 *
 * Wrapping `dom.content()` itself also works, at the price of patching a luci-base API every app
 * shares and up to seven read/write pairs per call. */
/* The three things `dom.content()` is called on: a section body, a table, and a TABLE'S BODY. The
 * third was missing and cost a release: on 24.10's Overview the section is a table, so nothing here
 * matched, the floor held nothing, and a poll emptying it took 58px off the document under the
 * reader — on ImmortalWrt 24.10 with a webkit engine, where no CI job looks. tools/scroll-anchor.mjs
 * looks for the same three and says why. */
const SHRINKS = '.cbi-section > div, .table';

/* A floor is swept off the box that wears it, and the climb below can put one on a box that is not
 * in SHRINKS itself — so emptying the table under it takes the whole section out of the sweep and
 * the floor stays for the life of the page: 927px of blank on /admin/network/network, 13 s after
 * the section emptied (tools/floor-contract.mjs). Every floor is marked, so the sweep finds its own
 * work again whatever became of the markup underneath. The attribute is in the theme's own
 * namespace and says nothing to CSS; matching on inline `min-height` instead would sweep off the
 * ones an app wrote for itself. */
const FLOORED = '[data-fs-floor]';

/* The floor is the height the next tick may not go below, one per container. Cleared before the
 * read, or each floor measures itself and never comes down; batched into one clear, one read pass
 * and one write pass, so the whole sweep costs a single forced layout rather than one per element.
 *
 * Not while the reader scrolls: clearing to re-measure is a layout read, and a floor staying where
 * it was is still a floor.
 *
 * AND NOT ON A TABLE BOX, WHICH CANNOT HOLD IT. `min-height` is undefined on a table box (CSS 2.1
 * §10.7) and WebKit acts on that: a `.table` wearing a 313px floor still collapsed to 30px when its
 * rows went, and the document lost 284px on /admin/network/firewall — Chromium held the 313px. So
 * the floor climbs to the first box that is not a table, where the same emptied table costs 0px on
 * both engines. `getComputedStyle` resolves style, not layout, so the climb adds no forced layout.
 *
 * Reported from an iPhone as the Overview sinking a little every five seconds: LuCI's poll takes
 * the whole `table.table` out of the first card and puts a new one back — measured on the stand,
 * once per `pollinterval`, 482px — and between the two the section is empty. On WebKit the floor on
 * the table held nothing, the offset was clamped into a document that short, and the reader was
 * left further down than they had been.
 *
 * The climb is the ONE part of the 0.14.4 floor kept: this pass still clears and re-measures, so a
 * box that cannot hold anything up measures 0 with its floor off and gets none — which is why the
 * collapsed tab pane of issue #41 cannot come back with it.
 *
 * NOT EVERY BOX EVERY TIME — task floorchurn. Instrumented across 25s of real polling, three
 * engines, two stands: 25 calls (5 per tick) times 29 candidate boxes is 725 clears and 625 writes,
 * of which 610 put back the number already standing — only 15 boxes actually changed
 * (`../tmp/task-floorsuppress/`). A box nobody has mutated cannot have a different height from the
 * one this function measured it at last time: nothing else changes what `offsetHeight` answers here
 * except a DOM mutation inside it (caught below) or a WIDTH change (a different codepath entirely —
 * `onResize()` -> `schedule()` -> `run()` with no `records`, which still sweeps every box, since a
 * reflow from a width change is invisible to a childList observer). So `records` — passed only by
 * observeContent()'s own MutationObserver callback, `undefined` everywhere else in this file —
 * narrows the clear/measure/write step to the boxes at least one record's `target` actually touched,
 * either direction (`target` may be the box itself, a descendant the mutation changed, or an
 * ANCESTOR of a box that just appeared as a fresh child of it — a plain `box.contains(target)` alone
 * misses that last shape, since a box cannot contain the parent it was just inserted into).
 *
 * The climb itself — which boxes exist, and whether each one currently wears `data-fs-floor` — is
 * still computed in full every call: cheap (`querySelectorAll` plus `getComputedStyle`, no forced
 * layout) and it is what lets an untouched box be correctly recognised as untouched. What is skipped
 * is only the clear-and-remeasure, the part that forces a layout per box. A box this call finds
 * "not dirty" is left exactly as it was — for the ONE call that matters for correctness, the one
 * `observeContent()`'s own callback reads `r.target`'s floor back from immediately after to compute
 * `grew`/`floorShrink` (task blindref, task wkrefill), `r.target` already carries `data-fs-floor`
 * and IS one of the mutation's own targets, so it is never excluded — this cannot silently swallow
 * the shrink those mechanisms depend on seeing. */
function holdFloor(records) {
	if (scrolling()) return;
	const host = document.getElementById('view');
	if (!host) return;			/* the login page has no view */
	const boxes = [], hs = [];
	host.querySelectorAll(SHRINKS).forEach((el) => {
		let box = el, cs = window.getComputedStyle(el);
		while (box && box !== host && cs.display.startsWith('table')) {
			box = box.parentElement;
			if (box) cs = window.getComputedStyle(box);
		}
		/* several tables in one section climb to the same box; it needs one floor, not one each */
		if (!box || box === host || boxes.indexOf(box) !== -1) return;
		boxes.push(box);
	});
	host.querySelectorAll(FLOORED).forEach((box) => { if (boxes.indexOf(box) === -1) boxes.push(box); });

	let dirty = boxes;
	if (records && records.length) {
		const targets = [];
		for (const r of records) if (r.target && targets.indexOf(r.target) === -1) targets.push(r.target);
		dirty = boxes.filter((box) => targets.some((t) => box.contains(t) || t.contains(box)));
	}
	if (!dirty.length) return;

	/* THE SWEEP MAY NOT COST THE READER THE CLAMP IT EXISTS TO PREVENT — task resid. Clearing every
	 * floor before the measure pass is what makes the answers honest (above), and for the length of
	 * that pass the document stands without them. Measured live (chromium/owrt2512b @390 top normal,
	 * /admin/network/dhcp, `../tmp/task-resid/dbg-before.json`): 38 sweeps, 33 of them took the
	 * document DOWN between the clear and the write-back, and on 13 the offset went with it. Eight of
	 * those 13 are this fault — the unscoped, every-box sweep, document 4730px to 4729px and straight
	 * back to 4730px, offset 3886 to 3885 and NOT back. Nothing in this function is asynchronous and
	 * `scrolling()` at the top already refused a reader who is moving, so an offset that is LOWER
	 * after the write-back than before the clear was lowered by this pass and by nothing else — 0
	 * sweeps of the 38 moved it the other way.
	 *
	 * One pixel, and it is not the pixel that matters: `lateDrift()` reads the offset twice,
	 * SCROLL_IDLE apart, and treats any difference as "the reader has moved since" (its own comment
	 * below). That 1px discarded the whole 60px correction the same tick's shrink was owed
	 * (`late-refuse why: moving, seen 3886, now 3885`), and the unforced `rememberRest()` a
	 * millisecond later adopted the wrong offset as the reference the NEXT refill measures against:
	 * 59px off, carried forward, which is the 47-64px `REPEAT` reports on the second or third of
	 * three back-to-back refills of one section (`tools/scroll-anchor.mjs`, docs/anchoring.md).
	 *
	 * ONLY WHERE THE SCROLLER IS AS TALL AGAIN AS IT WAS, which is what separates this pass's own
	 * transient dip from a floor that came down because the CONTENT really shrank — the eight sweeps
	 * above against the other five, on the same run, that lost 3958 to 3886 with the document
	 * staying 120px shorter for good. That second clamp is real, it belongs to the shrink, and
	 * `lateDrift()`'s `floorShrink` path already corrects for it; touching it here was measured too
	 * — restoring unconditionally and letting the browser re-clamp the write is green on this cell
	 * as well, but it also makes every genuine shrink's clamp this file's OWN write
	 * (`sawOwnWrite()`), so the motion window that clamp used to open stops opening and
	 * `sampleMotion()`'s terminal sweep stops running with it. The narrow form holds the cell on its
	 * own, so the wider one does not ship.
	 *
	 * `writeOffset()` rather than a bare assignment: the restore is a scroll write like the two
	 * corrections, and the motion sampler must read it as this file's own rather than as the reader
	 * arriving. */
	const sc = scroller(), page = sc || document.documentElement;
	const at = scrollTop(), tall = page.scrollHeight;
	dirty.forEach((box) => { box.style.minHeight = ''; });
	/* THE BOX'S OWN HEIGHT, NOT `offsetHeight`'S ROUNDING OF IT — task fourevents. `offsetHeight` is
	 * an integer, rounded to nearest, so a floor written off it stands up to half a pixel TALLER
	 * than the content it was measured from — measured on this page's own boxes with the floors
	 * cleared: 421.875 written back as 422, 40.75 as 41, 292.719 as 293, 475.531 as 476, 1685.656 as
	 * 1686 (`../tmp/task-fourevents/`, the `dip` build). Twenty-two such boxes make the document 2px
	 * taller WITH the floors than without, so every clear above shortens it by that much — 7422 to
	 * 7420 on 57 of 64 sweeps — and a reader parked at the end of the document has their offset
	 * clamped into the gap. That clamp is a scroll position change, which invalidates the engine's
	 * own scroll anchor (css-scroll-anchoring-1 §2.1.1), and the growth that arrives next is then
	 * left uncorrected: 6 of 12 refills on `owrt2410b`/webkit `@390 top normal` against 12 of 12
	 * with the floor written at the height measured here. The rect is the same forced layout the
	 * clear above already pays for, so this costs nothing extra. It DIFFERS from `offsetHeight` on
	 * a transformed box — the rect is the painted size, and a floor wants the layout size — and no
	 * box this sweep reaches is transformed: the theme's own `transform` rules are a spinner, a
	 * rail-toggle glyph, a nav progress bar and `fs-fade`'s 4px rise, none of them a floored
	 * container, and a scale on one would be an app's own doing. */
	dirty.forEach((box) => hs.push(box.getBoundingClientRect().height));
	dirty.forEach((box, i) => {
		if (hs[i] > 0) { box.style.minHeight = hs[i] + 'px'; box.setAttribute('data-fs-floor', ''); }
		else box.removeAttribute('data-fs-floor');
	});
	/* AND WHERE IT IS A REAL SHRINK, SAY SO — task wk1440. The other side of the same test: the
	 * offset came down and the scroller stayed shorter, so the box really did give height up and
	 * the drop is the browser's clamp into it. `applyAnchor()` is the one thing that can put back
	 * the part of the shrink the clamp did NOT take, and it refuses while `scrolling()` — which the
	 * clamp's own scroll event has just made true. Measured (webkit/owrtsnapb @1440 side compact,
	 * /admin/status/overview, `../tmp/task-wk1440/`, the engine's own anchoring ablated away with
	 * `overflow-anchor: none` so the theme is the only corrector): a 120px pad removed above the
	 * reader took the scroller 2793 -> 2673px while the offset clamped 1889 -> 1829 — 60px short of
	 * the 1769 the reader needed, because a clamp only ever gives back what the document lost at its
	 * BOTTOM. One frame later `applyAnchor()` read `scrolling() true, 400ms left` and returned with
	 * a correct -60px correction in hand; the terminal sweep's `rememberRest()` then adopted 1829 as
	 * the reference, and every refill after it measured 0px drift against ground that was already
	 * 60px wrong — `3x repeat 0px/-60px/-60px`, the gate's "left the reader -60px off ... corrected
	 * never". Recorded as a PIXEL, not as a flag or a timestamp, and read back the way
	 * `sawOwnWrite()` reads its own: it stands only while the offset has not left it, so a reader
	 * who really does move clears it by moving. */
	const landed = scrollTop();
	if (landed >= at) return;
	if (page.scrollHeight >= tall) writeOffset(sc, at); else _clampedTo = landed;
}

/* ---- is the page moving right now? asked of the position, never of the events ----
 *
 * Passes that read layout ask this before measuring, and what they skip runs once movement stops.
 *
 * Asking the events (`scroll`, `wheel`, `touchmove` plus a quiet period) does not work: on iOS
 * momentum carries the page long after the finger has gone and events do not reliably arrive
 * through it, so the timer declares the reader still and drops the whole deferred pass into the
 * middle of the glide.
 *
 * Movement is therefore read from the scroll POSITION: a frame whose offset differs from the last
 * is movement, whatever the event stream is doing, and momentum, rubber-banding and a programmatic
 * `scrollTo` all look the same. One offset read per frame, no geometry, no forced layout. */
/* How long the page must hold still before put-off work may run. This is the fix for the shaking,
 * not a tuning knob: 200ms is shorter than the pauses a slow reader leaves, so a gentle rock reads
 * as a stop and the whole deferred pass lands mid-gesture. Measured against an imitated slow rock:
 * 137-256px of roughness at 200ms, and 59px — the floor, one pixel of rounding per frame, the same
 * as switching the fitters off — at 250ms and above. 400 is that floor with room to spare, and
 * still well inside the time a reader takes to look at what they scrolled to. */
const SCROLL_IDLE = 400;
/* set by a pass that skipped its measurement because the page was moving; consumed by the sampler
 * below the moment it stops */
let _deferred = false;
function deferMeasurement() { _deferred = true; }
let _movingUntil = 0;
let _lastOffset = null;
let _sampling = false;
/* THE THEME'S OWN CORRECTION WRITE IS A SCROLL EVENT TOO, and this sampler cannot otherwise tell it
 * from the reader's: `lateDrift()` and `applyAnchor()` write `scrollTop` directly, the browser
 * dispatches `scroll` for that the same as for a finger, and `noteMotion()` below used to treat
 * either as SCROLL_IDLE (400ms) of fresh motion — which then blocks `holdFloor()`, `rememberRest()`
 * and `applyAnchor()` itself for that whole window, since all three refuse while `scrolling()`. On
 * REPEAT's own back-to-back refills of one section a correction's write routinely landed inside the
 * 700ms gap the next refill starts in: measured live (`../tmp/task-refill2/probe.mjs`,
 * owrt2512b/chromium/Overview), a correction's write at t=6530 opened a motion window to t=6930, the
 * next refill's mutation arrived at t=6811 — INSIDE it — and both `holdFloor()` and `rememberRest()`
 * were silently refused for that refill: the floor never picked up the new content's real height and
 * `_rest` kept describing the position from before it, so the correction two ticks later measured a
 * fabricated 59px drift against that stale reference and wrote a real one, the exact 47-60px "never
 * corrected" shape the gate reports. Two such self-inflicted writes are two misses by `lateDrift()`'s
 * own count, which is what tripped `_engineTrusted` false in the same run though the engine had
 * anchored correctly throughout. The write's own resulting offset is remembered here and consumed by
 * `sawOwnWrite()` below, held (not consumed on the first look) until the offset actually leaves that
 * pixel, so both watchers agree; a reader who scrolls to a different pixel in the meantime is
 * unaffected. */
let _ownWrite = null;
/* -> true if `y` is new motion the sampler must count; false if it still reads as this file's own
 * last write settling. NOT single-shot — task refill2: `noteMotion()` (the `scroll` event) and
 * `sampleMotion()`'s own frame loop both ask this of the SAME settling write when the sampler was
 * already running before the write (an earlier, genuine motion still winding down), and a version
 * that cleared `_ownWrite` on the first of the two to ask left the second — whichever it was — with
 * nothing to recognise, reading the already-explained pixel as fresh motion and re-extending
 * `_movingUntil` right back over the write's own settle. Measured live
 * (`../tmp/task-refill2/probe.mjs`, owrt2512b/webkit/Overview @390 top, 3/3 reps): `scrolling()` never
 * came back false at all between refills, `holdFloor()`/`rememberRest()` refused every one of them,
 * and the reader drifted 59px on the second and third with no correction ever landing — the same
 * shape a stale `_rest` produces, from a different cause. The marker now clears only once the offset
 * moves to something ELSE, so however many places ask, the answer for THIS pixel stays consistent. */
function sawOwnWrite(y) {
	if (_ownWrite === null) return true;
	if (Math.abs(y - _ownWrite) < 1) return false;
	_ownWrite = null;
	return true;
}
/* Where the browser's own clamp last put the offset down, set by `holdFloor()`'s real-shrink branch
 * and by nothing else — see the comment there for the measurement. NOT a second `_ownWrite`: this
 * marker does not touch `scrolling()`, which keeps answering "the page is moving, whoever moves it"
 * for the whole theme (task resid measured what happens when a clamp stops opening that window —
 * `sampleMotion()`'s terminal sweep stops running behind it). It answers ONE narrower question, for
 * `applyAnchor()` alone: is the motion that is blocking this correction the clamp the correction is
 * FOR? */
let _clampedTo = null;
function sawClamp() {
	/* the identical `scrollTop() !== seen` shape `lateDrift()` asks its own offset — the pixel was
	 * read out of `scrollTop()` in the first place, so equality is the whole test, and `null` is
	 * never equal to a number */
	if (scrollTop() === _clampedTo) return true;
	_clampedTo = null;
	return false;
}
/* The one place either correction may write the scroll position, so `_ownWrite` cannot go stale by a
 * write skipping it. Reads the offset back rather than trusting the argument: a write near either
 * end of the document is clamped by the browser, and the pixel that actually lands is the one the
 * next `scroll` event will report. */
function writeOffset(sc, value) {
	if (sc) sc.scrollTop = value; else window.scrollTo(0, value);
	_ownWrite = sc ? sc.scrollTop : window.scrollY;
}

/* Which element scrolls, asked once per width rather than once per frame.
 *
 * Every pass consults this before measuring, and it runs in the frame loop below for as long as the
 * page moves, so a `scrollHeight`/`clientHeight` probe here would be a forced layout per frame in
 * the middle of a flick.
 *
 * The question is "which element does this LAYOUT scroll", not "does this element overflow": the
 * latter is a property of the content and cannot be memoised against a width stamp — a short page
 * caches "the window scrolls", and after navigating to a tall one every pass reads `window.scrollY`,
 * which the sidebar layout pins at 0, so no mid-scroll guard in this file ever fires again.
 *
 * The stylesheet decides it (`theme/20-shell.css` gives `.fs-main` `overflow-y: auto` in the
 * desktop sidebar layout only), so the computed value is the answer — correct the moment the CSS
 * changes. `getComputedStyle` resolves style, not layout, and the verdict is cached against the
 * resize stamp and the two attributes that carry a layout change. */
let _scroller = null, _scrollerAt = -1, _scrollerKey = null;
function layoutKey() {
	const root = document.documentElement;
	return (root.getAttribute('data-layout') || '') + (root.hasAttribute('data-narrow') ? '|narrow' : '');
}
function scroller() {
	const key = layoutKey();
	if (_scrollerAt === _resizeSeq && _scrollerKey === key &&
	    (_scroller === null || _scroller.isConnected))
		return _scroller;
	const sc = document.getElementById('maincontent');
	const flow = sc ? window.getComputedStyle(sc).overflowY : '';
	_scroller = (flow === 'auto' || flow === 'scroll') ? sc : null;
	_scrollerAt = _resizeSeq;
	_scrollerKey = key;
	return _scroller;
}
function scrollTop() {
	const sc = scroller();
	return sc ? sc.scrollTop : window.scrollY;
}

function scrolling() { return Date.now() < _movingUntil; }
function sampleMotion() {
	const y = scrollTop();
	if (_lastOffset === null || y !== _lastOffset) {
		const own = !sawOwnWrite(y);
		_lastOffset = y;
		if (!own) _movingUntil = Date.now() + SCROLL_IDLE;
	}
	if (scrolling()) { requestAnimationFrame(sampleMotion); return; }
	_sampling = false;
	/* THE BOX, NOT THE REFERENCE — second attempt, also measured live and also wrong: a check
	 * against `_rest.el`'s own rect never sees this fault, because `_rest` is exactly what gets
	 * RE-ESTABLISHED, at whatever the offset currently is, by the very next successful
	 * `rememberRest()` — which may already have run, on a FRESH reference picked at the fold of an
	 * already-wrong position, before this ever gets to check anything. A reference cannot catch a
	 * fault in the ground it is itself read off. See `settleDeferredFloor()` for what holds instead:
	 * the OFFSET's own response to the ONE write below, measured directly, the same way
	 * `lateDrift()`'s `compensated` already checks the offset against `grow` — just for a shrink
	 * `holdFloor()` is about to (or, silently, already did) apply rather than one a mutation just
	 * grew. Both taken before `holdFloor()` runs it down: a box already settled through the ordinary
	 * mutation path in the meantime shows no shrink here, and costs one `parseFloat` to learn that. */
	const target = _deferredFloor;
	_deferredFloor = null;
	const floorBefore = (target && target.isConnected) ? (parseFloat(target.style.minHeight) || 0) : 0;
	const offsetBefore = scrollTop();
	/* the reader has stopped, so the floor and the reference both belong to where the page now
	 * stands */
	holdFloor();
	if (target && target.isConnected) {
		const shrink = floorBefore - (parseFloat(target.style.minHeight) || 0);
		if (shrink > 1) settleDeferredFloor(offsetBefore, shrink);
	}
	rememberRest();
	/* the page has held still for SCROLL_IDLE: whatever was put off may run now */
	if (_deferred) {
		_deferred = false;
		/* No correction for this batch. Both available references are wrong for a page the reader
		 * has just scrolled through: a fresh one is read against an offset WebKit may not have laid
		 * out yet (the theme then undoes the reader's own move), and the one from the last still
		 * page drags them back to where they were before the flick — the gate caught that as a 231px
		 * jump landing inside a scroll, on all three engines. Nothing here is a poll tick —
		 * the fitters re-measure what the scroll already showed rather than growing the page — and
		 * the next mutation corrects against a reference taken while the page was still. */
		run();
	}
}

function noteMotion() {
	if (!sawOwnWrite(scrollTop())) return;
	_movingUntil = Date.now() + SCROLL_IDLE;
	if (_sampling) return;
	_sampling = true;
	requestAnimationFrame(sampleMotion);
}

/* `passive: true` and `capture: true`: this must never sit in front of the scroll it watches, and
 * `scroll` does not bubble from an element — it travels down the capture phase, which is how the
 * sidebar layout's inner scroller is seen as well as the document. The events only START the
 * sampler; whether the page is still moving is the sampler's answer. */
/* Is the reader DRIVING, as opposed to the page moving? `scrolling()` cannot tell those apart and
 * must not, since every pass reading layout has to stay out of a moving page whoever moves it. But
 * `lateDrift()` exists to inspect an offset the ENGINE moved, so gating it on `scrolling()` makes
 * it fire never — the engine's own correction starts the motion sampler. A gesture is what says the
 * reader is driving. `mousedown` covers the scrollbar thumb and `keydown` Page Down, and both
 * answer this question only. */
let _userUntil = 0;
function noteIntent() {
	_userUntil = Date.now() + SCROLL_IDLE;
}
function noteUser() {
	noteIntent();
	noteMotion();
}

(function watchMotion() {
	const opts = { passive: true, capture: true };
	window.addEventListener('scroll', noteMotion, opts);
	/* A gesture that IS the scroll, from the second event on: `touchmove` and `wheel` fire only once
	 * the page has already moved, so unlike `touchstart` they mean motion, not just presence.
	 * `scroll` (above) and momentum still start the sampler for whatever the first frame of a flick
	 * misses. */
	for (const name of [ 'wheel', 'touchmove' ])
		window.addEventListener(name, noteUser, opts);
	/* Intent only: says the reader is present, not that the page is moving. `touchstart` used to sit
	 * above and feed `noteMotion` too, so a stationary tap on a tab declared the page moving for
	 * SCROLL_IDLE (400ms) and gated `fitChrome()` with it — the freshly drawn tab strip painted at
	 * full padding and only shrank once the sampler saw the page still, ~400ms after the tap. Real
	 * motion is read from the scroll POSITION by `sampleMotion`, not the event: `touchmove` and
	 * `scroll` above, plus momentum, all still start it, so nothing that actually moves the page
	 * loses its guard. A scrollbar drag and a Page Down move the page and say so themselves, through
	 * `scroll`. Feeding them to `noteMotion` too would make `scrolling()` answer yes for 400ms after
	 * any click and every keystroke, which gates every layout-reading pass in this file: while
	 * typing into a form, 9 of 10 passes were skipped and landed in one burst afterwards. */
	for (const name of [ 'mousedown', 'keydown', 'touchstart' ])
		window.addEventListener(name, noteIntent, opts);
})();

/* Next frame, at most once per frame (rule 3). */
function schedule() {
	if (_rafPending) return;
	_rafPending = true;
	requestAnimationFrame(() => { _rafPending = false; run(); });
}

/* Width only, and not as an optimisation: every browser on iOS grows and shrinks the viewport
 * HEIGHT while the user scrolls, because the URL bar slides away, and each step is a resize the
 * ResizeObserver reports. Simulated on a 390px viewport, twenty height-only steps had the fitters
 * rewrite 1054 class attributes, each a forced layout of a page the user is scrolling.
 *
 * Nothing a fitter asks is about height, and the apparent counter-example is not one: a vertical
 * scrollbar appearing takes WIDTH from the content box.
 *
 * Per element, since the roots are observed separately and a dialog can resize while #view does
 * not. The first entry for an element always counts as a change. */
/* bumped whenever an observed root changes WIDTH — the only thing that can change which element
 * scrolls, and therefore what `scroller()` above may cache */
let _resizeSeq = 0;
const _lastWidth = new WeakMap();
function onResize(entries) {
	let widthMoved = false;
	for (const e of entries) {
		/* contentRect, not getBoundingClientRect(): the observer already measured it, and asking
		 * again inside the callback is the forced layout this function exists to avoid */
		const w = Math.round(e.contentRect.width);
		if (_lastWidth.get(e.target) !== w) {
			_lastWidth.set(e.target, w);
			widthMoved = true;
		}
	}
	if (widthMoved) { _resizeSeq++; schedule(); }
}

/* Watch an element's size. A change in WIDTH re-fits everything — the fitters are cheap and few. */
function watch(el) {
	if (!el) return;
	/* No feature test: the shipped CSS needs :has() and container queries, both years younger than
	 * ResizeObserver, so a browser that can render this theme has it. A window-resize fallback would
	 * be worse than nothing — it cannot see a rail collapse or a layout toggle, which is what this
	 * observer is for. */
	if (!_ro) _ro = new ResizeObserver(onResize);
	_ro.observe(el);
}

/* ---- scroll anchoring, where the engine has none ----
 *
 * A poll tick changes the height of what is ABOVE the reader. An engine with scroll anchoring
 * absorbs that by moving the offset the same amount; WebKit has none, and it is every browser on
 * iOS, so the page moves under the reader on every tick — measured on the reporter's own router,
 * `content +133px, +134px, +123px, +108px…`, each next to a `child +1/-1` in a polled section. The
 * height change here is real — nobody compensates for it.
 *
 * So this does, and only where nobody else did. A reference is taken from what survives a poll (the
 * section frames), choosing the one crossing the top of the viewport, because that is the boundary
 * a reader perceives as "where I am"; the fitters run, the reference is read again, and the offset
 * moves by however far it drifted.
 *
 * The correction is computed from the REFERENCE, never from the scroll offset: an anchoring engine
 * has already put the reference back by the time this reads it, so the drift is zero and this does
 * nothing. Measuring the offset instead reads an anchoring adjustment as a fault and corrects a
 * correction, which made Chromium worse (16 movements, 1827px).
 *
 * It never fights the user: a page at the top has no offset to give back, and a drift under a pixel
 * is rounding. */
/* Does the engine anchor at all? Chromium and Firefox do — measured with their anchoring
 * suppressed, a 120px growth above the fold moves the reader 120px, and 0px with it on. So this is
 * asked of the platform rather than of a browser name — `overflow-anchor` is the property that
 * turns the feature off, and an engine that does not know it does not have it. Defended against an
 * engine — or a stub, in a node-run test — with no `CSS` object at all; unreadable answers `true`
 * (assumed handled rather than fought).
 *
 * Task wkanchor shipped a second question here, `ENGINE_MISANCHORS`
 * (`-webkit-hyphenate-limit-before`), reasoning WebKit 26's own anchoring got a real correction
 * wrong: +21-41px on the Overview, reader parked, real poll ticks, nothing above the fold growing
 * by even a pixel. Task barpin found the real mover instead — `fitChrome()` (fs-chrome.js) pinned
 * the bar against SHRINKING during its own measurement pass but not against GROWING, so the bar
 * itself walked up to 107px taller than its settled height and back inside that one pass, on every
 * engine; WebKit was never mis-anchoring, it was the one engine with no scroll anchoring of its own
 * to absorb what the bar was actually doing. With `fitChrome()` pinned both ways, the same probe
 * that measured +21-41px reads 0px on WebKit at 390/top with NO suppression at all
 * (`../tmp/task-toplayout/top-probe.mjs --unsuppress`, 26s of real ticks) — `ENGINE_MISANCHORS` and
 * the `data-fs-anchor-suppress` write it drove are gone with it; see `docs/anchoring.md`. */
const ENGINE_ANCHORS = (() => {
	/* dev switch: `localStorage.fsEngineAnchor = 'off'` makes any engine take the non-anchoring
	 * path, which is otherwise only reachable on a machine with Safari on it */
	try { if (localStorage.getItem('fsEngineAnchor') === 'off') return false; }
	catch (e) { /* no storage, no switch */ }
	try { return typeof CSS !== 'undefined' && typeof CSS.supports === 'function'
		? CSS.supports('overflow-anchor', 'auto') : true; }
	catch (e) { return true; }
})();

/* Support for the property is not proof it is doing the job on THIS page: CI showed a real engine
 * decline to anchor a container refill on two separate passes, `overflow-anchor` still reading
 * `true` throughout — a case `ENGINE_ANCHORS` above cannot see, because it is asked once, at load,
 * of the platform. `lateDrift()` below already computes the residual after every refill the theme
 * did not itself correct, so the evidence is left to accumulate rather than guessed at up front:
 * two residuals it actually had to write back — task latenet's four-way ablation measured that
 * write landing 419-420ms after the refill — and the observer stops trusting this engine, moving to
 * the anchorFor()/scheduleAnchor() path instead, measured 7-36ms on the same refill, UNTIL
 * TRUST_RECOVERY_LIMIT below says otherwise — not for the rest of the session unconditionally: a
 * fork with no way back paid the full 7-36ms path forever after two ticks a loaded runner or a
 * momentary layout hiccup could produce just as easily as a standing fault. One residual is left as
 * headroom for a single one-off rather than tripping on the first. Never a browser name, only a
 * count: an engine that keeps the reference itself never reaches the write this counts — Chromium
 * and Firefox measure 0 residuals today — so the switch cannot trip for them.
 * `docs/anchoring.md`, "Who is responsible", carries the numbers. */
const LATE_MISS_LIMIT = 2;
let _lateMisses = 0;
let _engineTrusted = ENGINE_ANCHORS;
/* How much of the growth witness's own rounding a correctly-anchoring engine may leave unaccounted
 * for before that gap reads as the engine declining rather than as the witness rounding — task
 * missrule. Measured on a 32-36 row DHCP lease table at 390 wide, the one shape in the tree that
 * rounds this large: 8px (compact), 12px (normal/large, webkit), 12.25px (large, firefox) — three
 * points clustered tight against a 120px growth pad (`GROWTH`, tools/scroll-anchor.mjs), none of
 * them a residual, all of them the engine having already done the whole correction
 * (docs/anchoring.md, "The witness is not safe to write on its own"). 16 leaves 3.75px (30%) over
 * the largest of the three — the same margin-over-the-worst-measured-cluster shape the gate's own
 * `LATE_MS` uses — while staying far under half the pad (60px), so a genuine partial failure that
 * leaves the reader in the middle of it is never read as rounding. */
const LATE_ROUND_TOLERANCE = 16;

/* Trust that was never allowed back — task trust. Once `_engineTrusted` went false the fork above
 * stayed on the `anchorFor()`/`scheduleAnchor()` path for the rest of the session even where the
 * two misses that tripped it were the engine having a bad ten seconds, not a standing fault.
 *
 * TWO SHAPES TRIED HERE WERE WRONG, BOTH MEASURED — worth keeping the failures, not only the fix,
 * since a maintainer three lines below reasoning "just read the same drift `lateDrift()` reads" or
 * "just compare the offset to the growth" is about to reproduce one of them.
 *
 * First shape: `applyAnchor()` already reads `ref.el`'s own rect against the remembered top before
 * deciding whether to write — the same measurement `lateDrift()` uses to call a miss on the trusted
 * path — so a hit was counted there whenever that drift read under a pixel. Live against a real,
 * correctly-anchoring engine (`../tmp/task-trust/probe.mjs`, chromium/owrt2410, the Overview's own
 * poll-sized section) that branch never ran at all: `anchorFor()`'s OWN offset read forces the
 * layout the engine's scroll-anchoring resolves against, so by the time it asks "did the reader
 * move", the engine has ALREADY moved the offset to absorb the growth — and `anchorFor()`, built for
 * an engine that does none of that, reads any offset change that is not a downward clamp as the
 * READER having scrolled and returns null. `scheduleAnchor()` then never runs, so `applyAnchor()`
 * never sees the one tick that would prove the engine right — 0 hits recorded across 5 genuinely
 * successful refills, measured directly (a debug build exporting `_lateHits` read 0 throughout).
 *
 * Second shape: read the offset itself instead, in the SAME microtask `grew` (below) is already
 * read in, before `run()` can overwrite `_restAt` — `compensated = scrollTop() - _restAt` against
 * `grew`, the identical comparison `lateDrift()` makes on the trusted path (`seen - ref.at`), just
 * without a rAF plus `SCROLL_IDLE` to wait out. This one DOES see the engine work, but it is not
 * strict enough: measured against a genuinely PARTIAL correction (an offset that moved by about the
 * right amount overall), `compensated` matched `grew` within `LATE_ROUND_TOLERANCE` while the
 * gate's own independent mark still sat 48px off, uncorrected — the container growing by roughly the
 * right amount is not the same fact as the READER'S OWN reference holding, and task blindref already
 * proved a container-based witness can agree with a bad tick.
 *
 * What holds: `_rest.el` itself, read directly rather than through `anchorFor()` — the identical
 * reference and the identical comparison `lateDrift()` trusts on the OTHER path, just made here,
 * before `run()`, instead of a rAF plus `SCROLL_IDLE` later, since the compensation is already done
 * by the time anything in this callback reads geometry. A false negative here only delays recovery;
 * this shape has no cheaper approximation that does not risk a false positive instead. Proven the
 * same way as the two failures: the identical 5-refill run holds `_rest.el`'s drift under a pixel on
 * every one, `_engineTrusted` returns `true` on the second, and the reader's own mark never moved
 * (`moved: 0` throughout, both phases) — recovery costs no visible correction of its own, because
 * there is nothing left for one to do. */
const TRUST_RECOVERY_LIMIT = 2;
let _lateHits = 0;

/* What the reader was looking at, captured while the page was still. `anchorRef()` runs from the
 * mutation observer, i.e. after the DOM changed: right for the FITTERS, which have not run yet, and
 * blind to the mutation itself. An anchoring engine covers that other half; where none does, the
 * reference is kept from the last still moment instead. */
let _rest = null;
/* The offset is remembered even when the element is not — see anchorFor(). `_restPage` travels
 * with it because a page the reader navigated away from has no meaningful offset: the router resets
 * both scrollers on a client navigation and replays them on a Back, and neither is a clamp to
 * undo. */
let _restAt = null, _restPage = null;
/* The floored box a mutation found `holdFloor()` refused for (`scrolling()` was true) — its own
 * shrink or grow still happens eventually, once `holdFloor()` finally does run, and until now that
 * later call was `sampleMotion()`'s own bare `holdFloor(); rememberRest();`, wired to neither
 * `lateDrift()` nor `scheduleAnchor()` — task wkrefill. Stashed by the mutation callback below,
 * cleared the moment any tick's `holdFloor()` stops being refused, consumed once by
 * `sampleMotion()`/`settleDeferredFloor()` (the write, and why it checks the OFFSET rather than a
 * reference element, are there). Measured live (`../tmp/task-wkrefill/run-probe2.mjs`,
 * webkit/owrt2512b @390 top, normal): a growth-then-shrink refill landing entirely inside one
 * motion window left `_restAt` 59px higher than it started — `mark`'s own PAGE position never
 * changed (7441.15625px throughout) while its viewport position read 440 against a `before` of 499
 * — because the shrink's `min-height` write (a real scroll-anchor invalidation, `holdFloor()`'s own
 * citation) landed inside `sampleMotion()`'s unwired call, the engine gave back only 61px of the
 * 120px it owed, and the 59px gap was adopted as truth by the very next `rememberRest()`,
 * uncounted and uncorrected — the exact shape task refill2's `compensated` check already catches on
 * the GROWTH side, missing here only because nothing measured the SHRINK side at all. */
let _deferredFloor = null;
function pageStamp() {
	return (document.body && document.body.getAttribute('data-page')) || '';
}
/* -> the memo is void: whoever calls this owns the offset now (see the export below) */
function forgetRest() {
	_rest = null;
	_restAt = null;
	_restPage = null;
}
/* `force`: skip the `scrolling()` guard — for the one caller that just wrote the scroll offset
 * itself and needs the reference to match THAT write, not whatever unrelated motion happens to have
 * `_movingUntil` still in the future at that instant. `lateDrift()`'s own correction and the
 * engine's real compensation for the SAME underlying mutation both settle around the same
 * SCROLL_IDLE window, so the two routinely overlap by a few milliseconds — measured live
 * (`../tmp/task-refill2/probe.mjs`, owrt2512b/chromium/Overview): an ordinary, unforced
 * `rememberRest()` right after the write was refused on `scrolling()` still reading true from the
 * engine's own, unrelated scroll event 1ms earlier, leaving `_rest` stale for the NEXT refill and
 * reproducing the same fabricated drift this call exists to prevent. Safe here specifically because
 * the write just performed is a single, deliberate one this file made, not a multi-step animation to
 * read mid-flight — by the time this call happens, that write has already landed. */
function rememberRest(force) {
	if (scrolling() && !force) return;
	/* A page at the top has nothing to be put back to, so it does not pay for a reference: at
	 * offset 0 there is nothing to lose, and anchorRef()'s hit test plus rect costs 0.2ms typical,
	 * 6ms on a poll-dirtied WebKit layout. The offset is still remembered — one read, and
	 * anchorFor()'s clamp test is written in terms of it. */
	if (ENGINE_ANCHORS && scrollTop() <= 0) {
		_rest = null;
		_restAt = 0;
		_restPage = pageStamp();
		return;
	}
	const ref = anchorRef();
	/* the offset it was taken at travels with it: the page moving under the reader is a different
	 * fact from the reader moving through it */
	_restAt = scrollTop();
	_restPage = pageStamp();
	_rest = ref ? { el: ref.el, top: ref.top, at: _restAt, sec: ref.sec, secTop: ref.secTop } : null;
}

/* -> the reference to correct against, on the path where the engine does no anchoring of its own;
 * where it anchors, the mutation observer hands its pre-mutation reference to `lateDrift()`
 * instead. A remembered reference is worth using only while it still describes the reader's
 * position. */
function anchorFor() {
	const at = scrollTop();
	/* An offset that dropped with nobody scrolling, on the page it was taken on, is a clamp. All
	 * three conditions are load-bearing: a clamp only ever moves the offset DOWN, a reader who moved
	 * is one `scrolling()` still answers for (their scroll starts the sampler, while the clamp's own
	 * scroll event arrives a rendering step later), and the page stamp keeps a router scroll reset
	 * from being read as a clamp to undo. */
	const clamped = (_restAt != null && at < _restAt && !scrolling() && _restPage === pageStamp());
	/* The reference not surviving the tick is the common case, not an edge one: `dom.content()`
	 * replaces a section's children with new nodes, so the element at the top of the content area
	 * is usually gone by the time this runs. Measured on 24.10 with only a fresh reference to take:
	 * its drift was refused by the ceiling and the reader stayed 1206px from where they had been.
	 *
	 * With no element there is no drift to measure, but the number the engine took is known exactly
	 * — the offset dropped by this much and nothing else happened. Giving it back is the correction,
	 * and it cannot run away with the page: if the document really is shorter, the browser clamps
	 * the write straight back. The element path below stays preferred where it survives, because it
	 * also compensates the height change the tick brought. */
	if (!_rest || !_rest.el.isConnected) {
		if (clamped) return { by: _restAt - at };
		/* the element is gone but its section is not — see anchorRef() */
		if (_rest && _rest.sec && _rest.sec.isConnected && at === _restAt)
			return { el: _rest.sec, top: _rest.secTop, slack: 0 };
		return anchorRef();
	}
	/* The reader moved, so there is nothing to put back — and taking a fresh reference here is worse
	 * than taking none: `anchorRef()` reads a rect, and just after a scroll WebKit reports the new
	 * `scrollTop` against the old layout, so the reference describes the page from before the
	 * scroll and the correction a frame later drags the reader back to where they started.
	 *
	 * The clamp case is the exception, and it is why the compensation above is not enough on its
	 * own: `dom.content()` empties a container before refilling it, the engine clamps the offset
	 * into the briefly shorter document and nothing puts it back (measured in WebKit with its own
	 * anchoring off: the offset clamped by 130px, the page moved 255px). Both cases change the
	 * offset; the two facts above are what separate them. */
	if (at !== _rest.at && !clamped) return null;
	/* How much of the drift is already accounted for. applyAnchor() refuses a correction bigger than
	 * a viewport, since a drift that size usually means the view replaced its whole subtree. A clamp
	 * is the one drift that big with a receipt, so the ceiling is raised by that measured amount and
	 * nothing else — otherwise the worst clamps (690px in a 300px viewport) are the ones refused. */
	return { el: _rest.el, top: _rest.top, slack: Math.max(0, _rest.at - at) };
}

function anchorRef() {
	/* not while the reader scrolls: every rect read here is a forced layout, and this runs on every
	 * content mutation. The compensation exists for a page the reader is looking at. */
	if (scrolling()) return null;

	/* What the reader is looking at, asked of the page rather than of a selector list. Walking a
	 * list of frames and taking the one the fold cuts through misses the case that matters: a tick
	 * growing something INSIDE that frame leaves the frame's own top where it was (drift 0) while
	 * everything after it moves. The deepest element AT the fold is cheaper (one hit test, no rect
	 * walk) and is what the engine's own anchoring picks, so the two agree on what "still" means.
	 *
	 * A data table is never the anchor: the fit pass deliberately falsifies its layout mid-pass, so
	 * the theme excludes it from the engine's anchoring too (`overflow-anchor: none`,
	 * theme/30-tables.css). */
	const host = document.getElementById('view');
	if (!host) return null;
	const box = host.getBoundingClientRect();
	const x = Math.round(box.left + (Math.min(box.width, window.innerWidth || box.width) / 2));
	/* below the chrome, not at y=1: the bar is sticky and owns the first rows of the viewport, so a
	 * hit test at the top returns the chrome and the page gets no anchor at all. `[data-fs-chrome]`
	 * is the mark the chrome already carries, so no height or selector is named here. */
	let y = 1;
	let el = document.elementFromPoint(x, y);
	const chrome = el && el.closest ? el.closest('[data-fs-chrome]') : null;
	if (chrome) y = Math.max(1, Math.round(chrome.getBoundingClientRect().bottom) + 1);

	/* The hit is a search, not a single probe, and neither the host nor anything outside it counts.
	 * `#view` itself answers wherever the point lands in a gap, and its own top does not move when a
	 * poll changes something inside it, so a drift measured against it is zero for ever; a point
	 * above the first section answers with `.fs-content`, which is outside the host, and returning
	 * null there leaves the page with no reference at all.
	 *
	 * So: take the whole stack at the point — what a gap belongs to is directly underneath it — and
	 * if nothing inside the host turns up, step down the viewport and ask again. */
	const floor = Math.max(1, Math.round(window.innerHeight || 800));
	const pick = (yy) => {
		if (typeof document.elementsFromPoint === 'function') {
			for (const cand of document.elementsFromPoint(x, yy))
				if (cand !== host && host.contains(cand)) return cand;
			return null;
		}
		const one = document.elementFromPoint(x, yy);
		return (one && one !== host && host.contains(one)) ? one : null;
	};
	el = null;
	for (let step = 0; step < 5 && !el; step++)
		el = pick(Math.min(floor - 1, y + (Math.round(floor * 0.12) * step)));
	if (!el) return null;
	const table = el.closest('.table.fs-dt');
	if (table) {
		const up = table.parentElement;
		el = (up && up !== host && host.contains(up)) ? up : table;
	}
	if (!el || el === host || !host.contains(el)) return null;
	/* `getClientRects()`, not `offsetParent` plus a `getComputedStyle` fallback: the question is
	 * only whether the box is in the layout, and a box with no rects reports a top of 0 — a
	 * reference to nowhere */
	if (!el.getClientRects().length) return null;
	/* A second reference that survives the tick. `dom.content()` replaces a section's children, so
	 * the element the hit landed on is usually gone by the time the correction runs — and where the
	 * tick also grew the page nothing was clamped, so the "give back what the engine took" path has
	 * no number either and a fresh reference measures a drift of zero (measured with the engine's
	 * anchoring suppressed: the page moved 136px under the reader). What survives is the frame —
	 * `.cbi-section`, `.cbi-map` or `.fs-ovl`, whichever the walk below reaches first — since the
	 * stock poll refreshes it in place.
	 *
	 * The nearest such ANCESTOR, not `closest()` on the element itself: where the hit already
	 * climbed to the section, `closest()` answers with that same element and the fallback is the
	 * reference. */
	let keep = el.parentElement;
	while (keep && keep !== host && !keep.classList.contains('cbi-section')
			&& !keep.classList.contains('cbi-map') && !keep.classList.contains('fs-ovl'))
		keep = keep.parentElement;
	if (!keep || keep === host || !host.contains(keep)) keep = null;
	return { el, top: el.getBoundingClientRect().top,
		sec: keep, secTop: keep ? keep.getBoundingClientRect().top : 0 };
}

let _anchorPending = null;
let _anchorFrame = 0;
/* dev switch: `localStorage.fsAnchor = 'off'` stops the theme writing the scroll offset at all,
 * which is the one thing here that can move a page nobody is touching */
function anchorEnabled() {
	try { return localStorage.getItem('fsAnchor') !== 'off'; }
	catch (e) { return true; }
}
/* ---- what the engine's own anchoring leaves behind ----
 *
 * Scroll anchoring keeps a reference element still while things above it change size, which is not
 * the same promise as "a section can vanish and come back". Every LuCI poll empties a container
 * before refilling it, the offset is clamped into a briefly shorter document, and the way back is
 * the engine's own business: Chromium lands where it started, WebKit overshoots (a section growing
 * 120px moved the offset by 180, so the reader creeps up the page on every tick).
 *
 * The offset cannot answer this — it comes back LARGER, not smaller — and neither can a feature
 * test: WebKit shipped `overflow-anchor`, so every engine claims it, and a synthetic probe that
 * performs the collapse itself calls Firefox broken too, because a real page puts layout and a
 * frame between the collapse and the refill — that probe cost Chromium and Firefox 15px of drift
 * they did not have.
 *
 * So nothing is assumed: the element the reader was looking at is asked where it is now, two frames
 * after the mutation, once the engine has finished its own correction. An engine that got it right
 * reports zero and this does nothing. Same guards as the main correction — not while the reader
 * scrolls, not across a navigation, never more than a viewport. */
let _lateFrame = 0;
/* WHY THE LAST LATE CORRECTION DID OR DID NOT WRITE — an unmarked export for the sweep, the same
 * shape and the same reason as `restAt()` and `engineTrusted()` beside it. `lateDrift()` has eight
 * ways to return without writing, and from outside they are one symptom: `writes: []`. Three CI
 * runs were spent guessing between them — whether the theme tried and missed, had no reference to
 * try from, or read the engine as having already done the job — and each guess cost a push. One
 * short string, set at every exit, ends that: the finding names the line instead of the silence. */
let _lateWhy = null;
function why(w) { _lateWhy = w; }

function lateDrift(ref, grow, floorShrink) {
	/* the reference from BEFORE this tick, captured by the caller: one taken after the mutation
	 * describes the page as the mutation left it, so its drift is zero by construction */
	if (_lateFrame) return why('busy');
	if (!ref) return why('no-reference');
	why('armed');
	_lateFrame = requestAnimationFrame(() => {
		const seen = scrollTop();
		const settle = () => {
			_lateFrame = 0;
			if (!anchorEnabled()) return why('anchoring-off');
			if (Date.now() < _userUntil) return why('reader-intent');
			if (_restPage !== pageStamp()) return why('page-changed');
			/* THE OFFSET, NOT THE EVENT STREAM. `scrolling()` cannot answer this one: the engine's
			 * own compensation moves the offset and starts the motion sampler, so gating on it
			 * skips every tick this exists for — and in WebKit a programmatic scroll's event
			 * arrives up to 1.2s late, so the sampler is often not running at all when a flick is
			 * in progress. Asking where the offset stands answers both: the reference was taken
			 * with the reference on a still page, so an offset anywhere else means the reader has
			 * moved since, and whatever this would put back they have already scrolled past. A
			 * correction landing inside a flick is itself a jump (161px, webkit/Overview).
			 *
			 * The wait-length fork at the bottom of this function does consult `scrolling()`, and
			 * it is not this rule loosened: it decides HOW LONG to wait, never WHETHER to write. A
			 * tick the engine did move the offset for takes the long road and still arrives here,
			 * where this same check is what answers.
			 *
			 * `ref.at` and not `_restAt`: run() re-remembers between the mutation and this frame,
			 * and where the sampler has not started yet — WebKit again — that re-take records the
			 * offset the reader has already flicked to, so comparing against it compares a value
			 * with itself and lets the correction through (320px, @1440 side, .fs-main scrolling). */
			/* Still, not equal to the reference. An anchoring engine moves the offset ITSELF to keep
			 * the reader over content that grew — measured on webkit/Overview, +658px of offset
			 * against 600px of growth — so an offset that merely differs is the engine working, and
			 * refusing on that leaves the engine's own residual (58px) uncorrected. What must not be
			 * touched is a page still in motion, which is asked directly instead. */
			if (scrollTop() !== seen) return why('offset-moved');
			/* the tick usually replaces the element this was taken on, so without the section
			 * fallback the correction does nothing on the tick it exists for */
			let el = ref.el, was = ref.top;
			if (!el || !el.isConnected) {
				if (!ref.sec || !ref.sec.isConnected || ref.secTop == null) return why('reference-gone');
				el = ref.sec; was = ref.secTop;
			}
			let drift = el.getBoundingClientRect().top - was;
			/* THE WITNESS CAN BE BLIND. `el`/`ref.sec` is whatever anchorRef() hit-tested at the fold
			 * on the LAST still page — it is not guaranteed to sit below the container this tick
			 * actually refilled, and an element's own top does not move when growth happens somewhere
			 * it is not connected to. Measured live: a compact-density reference at top -362 read 0px
			 * of drift on 13 of 13 refills while the reader sat 120px off (CI, webkit/owrtsnap @1440
			 * side, task blindref). `grow` — the mutation record's OWN target measured by the caller
			 * (observeContent()) against the height `data-fs-floor` pinned it at before this tick —
			 * cannot make that mistake: it IS what the refilled container actually grew by, not a
			 * guess at what moved.
			 *
			 * IT IS NOT A SAFE NUMBER TO WRITE ON ITS OWN, though — task detector, reverting the claim
			 * this comment used to make. `compensated` is what the OFFSET already did since the
			 * reference was taken; where it is exactly zero the engine never touched the offset at
			 * all, the same blindness `drift` above just had, and `grow` is the only witness that saw
			 * it — writing the whole growth back is correct and IS a miss: the engine did nothing.
			 * Where `compensated` is NOT zero the engine already moved the offset roughly by its own
			 * anchoring, and a SMALL gap between the two is not a residual to correct — it is this
			 * witness's own rounding on a many-row table re-laid at a narrow width: a 32-36 row DHCP
			 * lease table clamped by exactly 8px (compact), 12px (normal/large, webkit) or 12.25px
			 * (large, firefox) while `compensated` already matched `grow` to within that same amount,
			 * on BOTH engines, at every density and every layout tested (task detector, 21 CI
			 * findings, /admin/network/dhcp @390 — the overshoot equalled the clamp the gate itself
			 * reported in every one). Writing that gap is a second correction on top of one the engine
			 * already made; instrumented locally against the failing cell, withholding the write reads
			 * `swap moved 0px` on all 21 with no write logged, engine alone.
			 *
			 * BUT a gap that small is not the only shape this branch used to see, and task detector's
			 * own `>= 1` counted every one of them as a miss regardless of size — so on the SAME table,
			 * two ticks (10s) later, `_engineTrusted` went false while the engine was still anchoring
			 * perfectly (task missrule, `../tmp/task-anchor-audit/inventory.md` §2.2): the fast path
			 * then ran ALONGSIDE a live engine, the exact "two corrections throw the page the other
			 * way" `ENGINE_ANCHORS` above warns about. A miss must mean the engine did not do the job,
			 * not that this witness rounded — so only a gap ABOVE `LATE_ROUND_TOLERANCE` counts as one;
			 * within it, the engine did the job and lateDrift() returns having written nothing, same as
			 * the direct `drift < 1` case two lines below. Below the tolerance is not "no drift to
			 * report" — WITHIN it, this file already knows the engine is right, which `drift` alone
			 * (still whatever `anchorRef()`'s possibly-blind reference read) does not. Re-measured live
			 * against a real engine that never anchors this section at all (task missrule,
			 * ../tmp/task-missrule/probe.mjs, webkit and chromium, a table swapped three times running):
			 * `compensated` stays exactly 0 every tick, so this branch is never reached for that case —
			 * it counts the ordinary way, below, and `_engineTrusted` still goes false on the second
			 * one, switch working as built. */
			if (Math.abs(drift) < 1 && grow > 1) {
				const compensated = seen - ref.at;
				if (Math.abs(compensated) < 1) drift = grow - compensated;
				else if (Math.abs(grow - compensated) > LATE_ROUND_TOLERANCE) {
					/* fresh distrust starts the recovery count at 0 too — a streak from a PREVIOUS
					 * spell of distrust proves nothing about this one */
					if (++_lateMisses >= LATE_MISS_LIMIT) { _engineTrusted = false; _lateHits = 0; }
					/* MIRROR OF task refill2's WRITE-PATH FIX, ON THE NO-WRITE PATH — task nine.
					 * A miss here means the OFFSET did not fully move; it does not mean this tick's
					 * geometry is unknown. Leaving `_rest` as `run()`'s own mid-transition capture (the
					 * DOM already changed, nothing had compensated yet) makes THAT stale snapshot the
					 * `ref.at`/`was` the NEXT tick measures against, same as the write path used to
					 * before `rememberRest(true)` was added there. `seen` and `el`'s rect, just read,
					 * ARE the true current position — uncorrected, but real — so the next comparison
					 * should start from here, not from before this tick began. Measured, `../tmp/
					 * task-nine/`: without this, `firefox owrt2410 @390 top overview` counted a SECOND
					 * phantom miss off the stale baseline and tripped `_engineTrusted` false while
					 * REPEAT's own mark never moved (misses [true,true,false]) — e0b6db4's fault on the
					 * other side of the same comparison. */
					rememberRest(true);
					return why('engine-partly-' + Math.round(compensated) + '-of-' + Math.round(grow));
				}
				/* else: within table-row rounding — drift is still whatever it was (< 1 per the guard
				 * above), so the plain `drift < 1` return two lines down is what fires, unwritten and
				 * uncounted: the engine did the job. */
			}
			if (Math.abs(drift) < 1) {
				/* SAME MIRROR AS ABOVE, FOR THE "engine already got it right" EXIT — task nine.
				 * Gated on `grow` OR `floorShrink`, not unconditional: a tick where this floored box
				 * neither grew nor shrank pays nothing extra here (P5), and `run()`'s own synchronous
				 * reference is only ever wrong relative to what THIS tick's mutation did. `grow` alone
				 * is not enough — REPEAT's own SHRINK leg (the pad it removes between refills) is a
				 * real box change `grow` reads as <=1 (growth witness is deliberately one-sided,
				 * task detector), so gating on `grow > 1` alone left the SAME hole one level down: the
				 * shrink between refill 1 and refill 2 left `_rest` at run()'s mid-transition capture,
				 * and refill 2 read ITS drift against that stale baseline. Where it did change (either
				 * way) and the engine handled it without a write, `run()`'s snapshot is still what the
				 * NEXT tick's `lateDrift()` would measure against — masking a real residual as "small"
				 * until it surfaces as a flat, un-recovered offset. Measured, `../tmp/task-nine/`:
				 * gating on `grow > 1` alone left `/admin/network/dhcp @390` at 47-59px off on the
				 * second of three back-to-back refills, unchanged — chromium/firefox/webkit alike,
				 * `_engineTrusted` true throughout. */
				if (grow > 1 || floorShrink > 1) rememberRest(true);
				return why('no-drift-grow-' + Math.round(grow));	/* the engine put it back */
			}
			if (Math.abs(drift) > (window.innerHeight || 800)) return why('drift-too-big');
			const sc = scroller();
			const at = sc ? sc.scrollTop : window.scrollY;
			writeOffset(sc, at + drift);
			why('wrote-' + Math.round(drift));
			/* A FRESH, FORCED rememberRest(), not just `_restAt = scrollTop()` — task refill2. The
			 * write moves the page by exactly the drift measured, so `_rest.top` still holds FOR THIS
			 * TICK's own `el`, but `_rest` itself was taken by run() at the top of THIS callback,
			 * before the mutation had a settled height and before the engine had done any of its own
			 * compensating scroll for it — a snapshot mid-transition, not the page as it will stay.
			 * Left standing, the NEXT refill's own correction reads its drift against that stale,
			 * mid-transition top instead of the one this write just settled, and computes a fabricated
			 * number: on REPEAT's own back-to-back refills of one section this was the 59px "never
			 * corrected" drift itself, not merely late bookkeeping. `force` (`rememberRest()`'s own
			 * comment) because the engine's real, unrelated compensation for the SAME underlying
			 * mutation routinely settles inside the same SCROLL_IDLE window as this write and leaves
			 * `scrolling()` reading true by a handful of milliseconds — an unforced call here reproduced
			 * the identical fabricated drift on the very next refill (measured,
			 * `../tmp/task-refill2/probe.mjs`, owrt2512b/chromium/Overview: `moved 0, 0, -59` without
			 * `force`, `moved 0, 0, 0` with it, both `trusted true` throughout). */
			rememberRest(true);
			/* A DROP IN THIS SAME BOX'S OWN FLOOR IS NOT EVIDENCE ABOUT THE ENGINE — task refill2. Every
			 * `run()` clears and rewrites the floored box's `min-height`, and a WRITE to that property is a
			 * scroll-anchor invalidation in its own right (`holdFloor()`'s own citation), independent of
			 * how reliably this engine otherwise keeps a reference: a floored box whose content really
			 * did shrink pays this cost on every engine, every time, structurally — counting it toward
			 * `_lateMisses` measures the theme's own floor bookkeeping, not the engine, and two ordinary
			 * shrinks ten seconds apart used to be enough to distrust an engine that had anchored every
			 * real growth on the same section at 0px throughout (measured, `../tmp/task-refill2/
			 * probe.mjs`, owrt2512b/chromium/Overview: `trustedBefore true, trustedAfter false`, reader
			 * never moved). The correction still runs — P1/P2 do not care why the engine left a
			 * residual — only the bookkeeping is skipped. */
			if (floorShrink > 1) return;
			/* A DIRECT DRIFT INSIDE THE SAME TOLERANCE THE BLIND BRANCH ALREADY USES IS THE SAME
			 * ROUNDING, NOT A SECOND FAULT — task refill2. The blind branch above only ever sees this
			 * table's row-rounding when the engine's own compensation left `drift` under 1px; on the
			 * SAME table's GROWTH refill this measured a direct `drift` of exactly 1px against a 132px
			 * growth (`../tmp/task-refill2/probe.mjs`, owrt2512b/chromium, `/admin/network/dhcp @390`
			 * side and top) — one pixel over the `< 1` line above, so neither guard caught it, and a
			 * write this small still counted as a miss. `REPEAT`'s own three-refill window turns that
			 * into two: one from this 1px growth-side rounding, a second from the very next one, and
			 * `_engineTrusted` tripped false on an engine anchoring within a pixel every time. Read
			 * against the SAME LATE_ROUND_TOLERANCE the blind branch already measured this exact page
			 * and width against (8-12.25px) rather than a new number for what is the same table. */
			if (Math.abs(drift) <= LATE_ROUND_TOLERANCE) return;
			/* This engine did not keep the reference across a container refill, once more on this
			 * page — see LATE_MISS_LIMIT above for what happens once that has been measured twice. */
			if (++_lateMisses >= LATE_MISS_LIMIT) { _engineTrusted = false; _lateHits = 0; }
		};
		/* HOW LONG TO WAIT IS A QUESTION ABOUT THE READER, NOT A CONSTANT — task late419.
		 *
		 * STILL FOR SCROLL_IDLE is the answer where the page is, or might be, in motion: a frame is
		 * not long enough to tell a flick from a still page by the offset alone, because a flick
		 * moves it in steps of tens of milliseconds and two rAFs (~16ms) fall inside one step, so
		 * the offset reads the same twice while the page is plainly moving. 120ms was still short
		 * enough to let one 160px correction through on a loaded runner. That is unchanged, and it
		 * is what every branch below still runs on.
		 *
		 * But a page the theme ALREADY KNOWS is still does not need to be asked again. `scrolling()`
		 * is this file's own answer to "has anything moved the offset in the last SCROLL_IDLE",
		 * sampled from the POSITION every frame rather than from the event stream, so it sees
		 * momentum and rubber-banding that dispatch nothing (its own comment) — and `_userUntil` is
		 * the reader's hand on the page: a `touchstart`, `wheel`, `mousedown` or `keydown` arrives
		 * BEFORE the offset it is about to move, so a flick about to begin has already said so.
		 * Where both answer "nobody is driving and nothing has moved", the only thing that can have
		 * touched the offset since the reference was taken is the engine, whose own correction
		 * window is measured at 7-36ms — not 400 — so the wait is the next frame and the same
		 * `scrollTop() !== seen` check decides, exactly as it does on the long path. Two rAFs in
		 * total, one apart: `settleDeferredFloor()`'s own shape, and for its stated reason — the
		 * offset read twice a frame apart is the check, and the wait is only there to space the
		 * two reads. A third frame was measured and is not bought: it costs 11-16ms of the
		 * headroom under the gate's own `LATE_MS` and changes no reading — webkit 67/71/72ms
		 * against 51/54/61ms on the same three stands, everything else identical.
		 *
		 * NEITHER GUARD ALONE WOULD DO, and that is the whole reason this is a pair. `_userUntil` is
		 * a 400ms timer off the last EVENT, and iOS momentum carries the page long after the finger
		 * has gone — the same fault `scrolling()` exists because of. And `scrolling()` alone would
		 * write into the moment a finger is down on a page that has not moved yet. A synthetic flick
		 * makes the first half concrete: `tools/scroll-anchor.mjs`'s QUIET drives its 24 steps by
		 * assigning `scrollTop`, so it carries no intent event at all, and an intent-only gate would
		 * take the short path straight through the middle of it.
		 *
		 * Measured (`tools/scroll-anchor.mjs`, the `engine DECLINES` cell this task added — the
		 * engine ablated off while the theme still trusts it, which is the state CI caught 2 runs in
		 * 3 and no local run ever): 404-422ms before, 8-61ms after, on nine cells — three engines
		 * against three stands, `@1440 side compact overview`, the cell CI reported. The other two
		 * cells of the same axis are untouched, which is the point: the engine-anchoring-on cell
		 * corrects at 4-19ms (the engine's own work, which never reaches this path) and the
		 * engine-OFF cell at 6-44ms (`applyAnchor()`, a different function). `mid-flick surprises`
		 * reads 0 on all 27. */
		if (!scrolling() && Date.now() >= _userUntil) _lateFrame = requestAnimationFrame(settle);
		else _lateFrame = window.setTimeout(settle, SCROLL_IDLE);
	});
}

/* ---- a floor `holdFloor()` could not clear at mutation time, cleared later with nobody watching ----
 *
 * `_deferredFloor`'s own comment has the fault; this is the fix, and it needs a THIRD frame slot,
 * not either of the two `lateDrift()`/`scheduleAnchor()` already own. Measured live, first attempt:
 * routing the same information through `lateDrift(ref, 0, floorShrink)` from `sampleMotion()`
 * collided with the regular mutation's OWN pending call for the SAME tick — `seen` there is
 * captured one rAF after the ORIGINAL (refused) mutation, well before `sampleMotion()` ever gets to
 * clear the floor, so by the time this one tried to arm, `_lateFrame` was still occupied, and by
 * the time the ORIGINAL one's own timeout fired, `holdFloor()`'s belated write had already moved
 * the offset on its own — read by that timeout as `scrollTop() !== seen`, "the reader is still
 * moving", and refused too. Two correct guards, aimed at two different questions, defeating each
 * other on the one tick both fire for.
 *
 * NOT A REFERENCE ELEMENT'S OWN DRIFT — second attempt, also measured live and also wrong, and the
 * one worth explaining because it looks safer than it is. Checking `_rest.el`'s (or `ref.sec`'s)
 * rect the way `lateDrift()` does cannot see this fault BY CONSTRUCTION: `_rest` is exactly what
 * gets RE-ESTABLISHED, at whatever the offset happens to be, by the very next successful
 * `rememberRest()` — which runs a fresh `anchorRef()` hit test at the CURRENT fold, wherever that
 * now falls. Once one has run on an already-59px-wrong offset, the reference it picks (measured
 * live: an `H3` a NEW hit test landed on, in a position the fold only reaches because the offset is
 * already wrong) shows zero drift for ever after — it was established AT the wrong position, not
 * moved away from a right one. A witness cannot catch a fault in the ground it is itself read off.
 *
 * WHAT HOLDS: the OFFSET's own response to the ONE write below, measured directly against how much
 * the box actually shrank — the same `compensated` vs `grow` comparison `lateDrift()`'s blind branch
 * already makes for a GROWTH, just made here for a SHRINK `holdFloor()` is about to apply (or,
 * silently, already did) rather than one a mutation just grew. Neither snapshot depends on `_rest`
 * staying pure, so neither can be corrupted by the fault this exists to catch. */
/* NOT GATED ON `scrolling()` — third attempt, also measured live and also wrong, and the one
 * `lateDrift()`'s own comment already warned this file about once: "an anchoring engine moves the
 * offset ITSELF … so an offset that merely differs is the engine working, and refusing on that
 * leaves the engine's own residual uncorrected." `holdFloor()`'s belated write is exactly such a
 * change — a real `min-height` clear the engine reacts to by moving the offset — and that reaction
 * dispatches its own `scroll` events, which is what this correction exists to read. Gating on
 * `scrolling()` therefore refuses on the very motion it is trying to observe: measured live,
 * `scrolling()` still read true one whole rAF after `holdFloor()` ran, on every one of three cells,
 * because the reaction itself kept re-arming `_movingUntil`. `lateDrift()` does not make this
 * mistake either — it checks `scrollTop() !== seen` (STILL, not "not moving"), two reads apart, the
 * same check used here: two rAFs, not `SCROLL_IDLE` (400ms) — `REPEAT`'s own back-to-back refills
 * leave under a second between this write's inputs being known and the NEXT refill's mutation
 * landing, and a 400ms wait routinely lands its own check after that next refill has already
 * restarted the motion sampler, checking a `now` the reader has already moved past. */
let _floorLateFrame = 0;
function settleDeferredFloor(offsetBefore, shrink) {
	if (_floorLateFrame) return;
	_floorLateFrame = requestAnimationFrame(() => {
		const seen = scrollTop();
		_floorLateFrame = requestAnimationFrame(() => {
			_floorLateFrame = 0;
			if (!anchorEnabled() || Date.now() < _userUntil) return;
			if (_restPage !== pageStamp()) return;
			if (scrollTop() !== seen) return;		/* still settling, or the reader has moved */
			/* A box that shrinks above the reader must lower the offset by the same amount for them
			 * to stay put — `wanted` is that target, not an estimate: `shrink` is what the box
			 * actually gave up, read fresh by the caller against its own pre-write height, the
			 * identical measurement `grow` already is for the growth side. */
			const wanted = offsetBefore - shrink;
			const gap = wanted - seen;
			if (Math.abs(gap) <= LATE_ROUND_TOLERANCE) return;		/* the engine already gave it back */
			if (Math.abs(gap) > (window.innerHeight || 800)) return;
			const sc = scroller();
			const at = sc ? sc.scrollTop : window.scrollY;
			writeOffset(sc, at + gap);
			/* `_rest` ADJUSTED IN PLACE, NOT `rememberRest(true)` — fourth attempt, also measured
			 * live and also wrong: this write's own `scroll` event can still be in flight when this
			 * line runs, and `rememberRest(true)` calls `anchorRef()` regardless of `force` —
			 * `anchorRef()` has its OWN, unconditional `if (scrolling()) return null;` guard, so a
			 * write landing inside that window leaves `_rest` NULL rather than merely stale. Measured
			 * live (`../tmp/task-wkrefill/run-probe.mjs --cellonly owrt2410b@top`): the very next
			 * mutation's `lateDrift()` then refused with "no ref", `_rest` was re-established fresh
			 * off whatever the fold happened to be two ticks later, and the reader ended up 120px off
			 * in the OTHER direction — worse than doing nothing. `_rest.el` itself did not move; only
			 * the offset it was measured against did, by exactly `gap`, so its remembered screen
			 * position shifts by the same amount and nothing needs re-reading off the page. */
			if (_rest) { _rest.top -= gap; if (_rest.sec) _rest.secTop -= gap; _rest.at = scrollTop(); }
			_restAt = scrollTop();
			/* NOT COUNTED TOWARD `_lateMisses` — same rule as `lateDrift()`'s own `floorShrink > 1`
			 * skip: this write answers for the theme's own bookkeeping catching up late, not for
			 * anything the engine declined to do, so it says nothing about whether the engine can be
			 * trusted on an ordinary tick. */
		});
	});
}

function scheduleAnchor(ref) {
	if (!ref || !anchorEnabled()) return;
	if (_anchorPending) return;
	_anchorPending = ref;
	if (_anchorFrame) return;
	_anchorFrame = requestAnimationFrame(() => {
		_anchorFrame = 0;
		const pending = _anchorPending;
		_anchorPending = null;
		const wrote = applyAnchor(pending);
		/* after the correction, never before: the reference must describe the page as the reader now
		 * sees it, or the next tick pays the same drift twice. Forced only where a write just
		 * happened — task refill2's `force` on `rememberRest()` is for resyncing after THIS file's
		 * own write, not for skipping the guard when `applyAnchor()` did nothing (refused because the
		 * page was moving, at the top, or the reference was gone): forcing unconditionally would read
		 * a reference off a page mid-flick on exactly the refusal this guard exists for. */
		rememberRest(wrote);
	});
}
function applyAnchor(ref) {
	if (!ref) return;
	/* not into a moving page: the correction is scheduled from the mutation and applied a frame
	 * later, and a reader who starts scrolling in between would be put back onto a page they have
	 * already left.
	 *
	 * UNLESS THE MOTION IS THE CLAMP THIS CORRECTION EXISTS FOR — task wk1440, the same trap
	 * `settleDeferredFloor()`'s own third attempt already fell into once ("gating on `scrolling()`
	 * refuses on the very motion it is trying to observe") and `lateDrift()` was built to avoid.
	 * A shrink above the reader clamps the offset down inside `holdFloor()`'s own synchronous pass,
	 * that clamp dispatches a `scroll` event of its own, and one frame later this guard reads it as
	 * a reader who started moving: measured on the cell this task closes, `apply-enter scrolling
	 * true, moving 400ms, at 1829` with a -60px correction already computed and never written.
	 * `sawClamp()` is the pixel `holdFloor()` watched the clamp land on, and it stands only while
	 * the offset has not left it — a reader who really is scrolling has moved off it by definition,
	 * so this reopens the guard for exactly one case and no other. */
	if (scrolling() && !sawClamp()) return;
	/* through scroller(), not a second probe: two copies of the same question can answer
	 * differently within one frame */
	const sc = scroller();
	const at = sc ? sc.scrollTop : window.scrollY;
	/* The element-free form: give back exactly what the engine clamped away, with no geometry read
	 * (anchorFor() says when this is the only form available). No ceiling, because the number is not
	 * an estimate — it is what the offset lost, and the document's length bounds the write.
	 *
	 * It runs before the "a page at the top is left alone" rule below, and must: a deep enough
	 * collapse clamps the offset to zero, which is the worst version of this fault rather than the
	 * one case to sit out. */
	if (ref.by != null) {
		if (ref.by < 1) return;
		writeOffset(sc, at + ref.by);
		return true;
	}
	if (at <= 0) return;
	if (!ref.el.isConnected) return;
	const drift = ref.el.getBoundingClientRect().top - ref.top;
	if (Math.abs(drift) < 1) return;			/* nothing needed correcting here */
	/* A definite write is a definite miss — task trust: any recovery streak counted so far said
	 * nothing about THIS tick, and this tick just proved the engine did not do the job on its own.
	 * (Recovery evidence itself is gathered earlier, in the mutation callback — see TRUST_RECOVERY
	 * _LIMIT above: this path never sees the tick that proves the engine right, because a reference
	 * the engine has already put back is exactly what makes anchorFor() return null instead of
	 * reaching here — measured live, `../tmp/task-trust/probe.mjs`.) */
	_lateHits = 0;
	/* A correction is a scroll the reader did not ask for, so an absurd one is a bug: a view that
	 * replaced its whole subtree can move a reference by thousands of pixels. One viewport and 200px
	 * is the most a single tick can honestly account for — where `innerHeight` is unreadable those
	 * 200px are the whole ceiling — plus whatever the engine is on record for having clamped away
	 * (`slack`, see anchorFor()). */
	if (Math.abs(drift) > (window.innerHeight || 0) + 200 + (ref.slack || 0)) return;
	writeOffset(sc, at + drift);
	return true;
}

/* Rule 2's mutation side. Deliberately not filtered by node type: a filter is a second place to
 * get wrong (LuCI renders most of its tables as DIVs), and run() is a handful of measurements.
 *
 * The content lives in TWO roots. `ui.showModal` builds its dialog inside `#modal_overlay`, which
 * ui appends to <body> beside #view, so a dialog's content mutates nothing inside #view and its
 * tables would never be measured. Both roots get the same observer and ResizeObserver.
 *
 * `require ui` above is what makes the overlay exist by the time this runs: it is created in ui's
 * constructor, and luci-base instantiates a class once, at the first require. */
function observeContent() {
	if (_mo) return;
	/* read before the observer closes over it: the swap test below compares node identity, and the
	 * `#view` bound here is the one the router keeps between navigations (liveView(), fs-router.js) */
	const hosts = [ document.getElementById('view') || document.body, document.getElementById('modal_overlay') ]
		.filter(Boolean);
	const viewHost = hosts[0];
	_mo = new MutationObserver((records) => {
		/* The theme corrects only where the engine will not. Where it anchors, growth above the
		 * reader is the engine's job and the floor covers the collapse, so there is nothing left for
		 * a correction to do: one written here would read its reference in the same instant the poll
		 * mutated the page, and after a scroll WebKit hands back the new `scrollTop` before the
		 * layout that goes with it, so the drift measures the reader's own move and the correction
		 * undoes it — measured, the page went back to 0 from 591 on every run. A residual check two
		 * frames later was carried for that engine and is gone: with the floor on the containers
		 * rather than on the column the collapse it answered no longer happens, and its own
		 * correction landed inside a flick (161px, webkit/Overview, scroll-anchor).
		 *
		 * Where the engine does not anchor at all — Safari before 27 — nobody puts the reader back
		 * within the frame, so the immediate correction stays, measured against the reference from
		 * the last still page. */
		const settled = _rest;
		/* `_engineTrusted`, not `ENGINE_ANCHORS`: the platform check above answers once, at load,
		 * whether the property exists — it cannot see an engine that has it but declines to use it
		 * on a given refill, which is what `lateDrift()`'s own residual count is for (LATE_MISS_LIMIT
		 * above). Once that has happened twice this session the fork moves here too, so the engine
		 * gets no third 420ms-late chance at a correction the fast path already does in 7-36ms. */
		const trustEngine = _engineTrusted;
		const ref = trustEngine ? null : anchorFor();
		/* THE RECORD'S OWN TARGET, read before run() below rewrites its floor for the NEXT tick — the
		 * only place this callback sees which container a poll actually refilled, as opposed to
		 * whichever element anchorRef() happened to hit-test at the fold, which need not be connected
		 * to THIS growth at all (task blindref). A record's target already wearing `data-fs-floor` IS
		 * the box holdFloor() pinned at its last settled height, so its height against that pin, taken
		 * NOW — the mutation already happened, so this is its final height; nothing here waits on the
		 * engine, which only ever moves the SCROLL POSITION, never an element's own size — is the
		 * growth lateDrift() needs, in pixels rather than a live reference to carry forward.
		 *
		 * FOUND EVERY TICK, TRUSTED OR NOT — task trust. Gating this to the trusted branch was fine
		 * while distrust was permanent, since nothing downstream of it would ever read the number
		 * again; recovering trust needs to tell a tick that tested the engine from one that tested
		 * nothing on the distrusted path too, in the recovery check right below, so the read can no
		 * longer be skipped there. One extra `records.find` and an `offsetHeight` per distrusted
		 * tick — the one path that used to pay nothing here at all. */
		/* THE FLOORED BOX THE RECORD SITS IN, not only a record whose target IS one — task blindgrow.
		 * `dom.content()` empties and refills the node it is handed, and that node is often a level
		 * or two INSIDE the box `holdFloor()` pinned: measured live on Overview (webkit/owrtsnapb,
		 * `../tmp/floorprobe.mjs`), of twelve nodes a poll refills on that page one sits inside a
		 * floored box without wearing the mark itself. For those the old `m.target.hasAttribute`
		 * matched nothing, `grew` read 0, and a `lateDrift()` whose element-based `drift` was ALSO
		 * blind — `anchorRef()` having hit-tested something the growth never reached — concluded
		 * there was nothing to correct and wrote nothing at all. That is the `writes: []`,
		 * `corrected never` shape CI reported on `webkit owrtsnap @1440 side compact overview` in
		 * three runs of three while every local run of the same cell passed: locally the fold
		 * happened to land BELOW the growing block, so `drift` carried the correction on its own and
		 * the missing `grew` never showed.
		 *
		 * `closest()` and not a parent walk: it stops at the first floored ancestor, which is the box
		 * whose `min-height` holds the pre-tick height this measures against, and it costs one call
		 * on the handful of records a tick delivers. Strictly wider than what it replaces — a target
		 * that already wore the mark is its own `closest()` — so no tick that used to find a witness
		 * can stop finding one. */
		let r = null, box = null;
		for (const m of records) {
			if (m.type !== 'childList' || !m.target.closest) continue;
			const b = m.target.closest(FLOORED);
			if (b) { r = m; box = b; break; }
		}
		/* a box freshly wearing its FIRST floor has no "before" to measure against — parseFloat
		 * of an unset `min-height` is NaN, `|| 0` reads as "no growth" rather than false growth
		 * the size of the whole box */
		const before = box && (parseFloat(box.style.minHeight) || 0);
		const grew = before ? box.offsetHeight - before : 0;
		/* RECOVERY EVIDENCE, task trust — read here and nowhere else; see TRUST_RECOVERY_LIMIT's own
		 * comment for why `applyAnchor()` cannot see it. THE SAME REFERENCE `lateDrift()` trusts on
		 * the other path (`_rest.el`'s own rect against the top it was remembered at), read before
		 * `run()` can overwrite it, instead of a rAF plus `SCROLL_IDLE` later — the compensation is
		 * already done by the time anything here reads geometry (`anchorFor()`'s own read, just
		 * above, forces the layout the engine resolves it in).
		 *
		 * NOT `compensated` vs `grew` (the OFFSET against the CONTAINER'S height, `lateDrift()`'s own
		 * comparison for the case its element-based drift is blind) — measured live and wrong here:
		 * `../tmp/task-trust/probe.mjs` against a genuinely partial correction (an offset that moved
		 * ROUGHLY the growth pad's own size) read `compensated≈grew` and recovered trust while the
		 * probe's own independent mark still sat 48px off, uncorrected. The container growing by
		 * about the right amount is not the same fact as THIS reference holding, and recovery needs
		 * the stricter of the two: a false negative here only delays recovery, a false positive
		 * un-distrusts an engine that is still getting it wrong. */
		if (!trustEngine && grew > 1 && _rest && _rest.el.isConnected && Date.now() >= _userUntil
				&& !scrolling() && _restPage === pageStamp()
				&& Math.abs(_rest.el.getBoundingClientRect().top - _rest.top) < 1
				&& ++_lateHits >= TRUST_RECOVERY_LIMIT) {
			_engineTrusted = true;
			_lateMisses = _lateHits = 0;
		}
		/* THE SAME BOX'S FLOOR, BEFORE AND AFTER THIS run() — task refill2. `holdFloor()` inside
		 * run() clears and rewrites `box`'s own `min-height` every tick, which is a scroll-
		 * anchor-invalidating style write on its own account (css-scroll-anchoring-1 §2.2.2,
		 * `holdFloor()`'s own comment) — so a floored box whose CONTENT genuinely shrinks (a poll's
		 * data losing rows, or in this callback the mutation record ITSELF being a removal) drops the
		 * engine's own anchoring for that write no matter how reliable the engine otherwise is. That
		 * residual reads to `lateDrift()` exactly like an engine that declined a real refill — the
		 * `grow` witness above is already 0 for it (`before` still equals the box's own pre-shrink
		 * offsetHeight at the point `grew` was read, min-height not yet cleared) — and every one of
		 * them used to count as a miss: measured live (`../tmp/task-refill2/probe.mjs`,
		 * owrt2512b/chromium/Overview, `REPEAT_TIMES` back-to-back refills of one section), two such
		 * shrinks ten seconds apart tripped `_engineTrusted` false on an engine that had anchored
		 * every real growth on the same section at 0px throughout. Read AFTER run(), which is what
		 * actually clears and rewrites it for this tick. */
		/* STASHED BEFORE run(), against the identical `scrolling()` its own `holdFloor()` call is
		 * about to check: a floored box `holdFloor()` is refused for right now still shrinks or grows
		 * eventually — see `_deferredFloor`'s own comment for where and why nothing used to notice.
		 * THE BOX ITSELF, not a height or a reference: `settleDeferredFloor()` re-reads the height
		 * fresh at consumption time, so an intervening successful sweep of the SAME box (this tick's
		 * own `run()`, or another mutation's) leaves nothing stale behind — cleared below the moment
		 * any tick's `holdFloor()` actually runs, for the identical reason. */
		const wasScrolling = scrolling();
		if (r && before && wasScrolling) _deferredFloor = box;
		run(records);
		if (!wasScrolling) _deferredFloor = null;
		const floorShrink = (r && before) ? Math.max(0, before - (parseFloat(box.style.minHeight) || 0)) : 0;
		/* `#view` ITSELF EMPTIED AND REFILLED IS A PAGE SWAP, NOT A REFILL — task latecommit,
		 * docs/anchoring.md "The commit is not a refill". The router commits a client navigation
		 * with `dom.content()` on the live `#view` (commitStage(), fs-router.js) and the browser
		 * delivers it as two batches: `run()`'s own `rememberRest()` fires between them and adopts
		 * a reference measured mid-swap, which `lateDrift()` reads 431px out 420ms later and writes
		 * back over a correct `restoreScroll()` (2723 -> 2292.21875, owrt2410b/chromium, Back to
		 * /admin/status/overview). `lateDrift()`'s own `_restPage` guard cannot see it: every stamp
		 * in the document already names the incoming page by the time the commit is observable, so
		 * carrying the same stamp on the reference instead is the same number twice.
		 *
		 * BOTH HALVES OF `dom.content()`, not merely a record naming `#view`: a plain insertion
		 * there is an ordinary growth that must still be corrected, and matching on the target
		 * alone left scroll-anchor's HOLD case 120px uncorrected on all three twins @1440 side
		 * normal with the engine ablated off. One pass and no `type` test, unlike the
		 * `records.find()` above: this observer registers `childList` only, and a record of any
		 * other type carries two empty node lists anyway. */
		let gone = 0, came = 0, took = 0, gave = 0;
		for (const m of records) {
			if (m.target === viewHost) { gone += m.removedNodes.length; came += m.addedNodes.length; }
			if (m.type === 'childList') { took += m.removedNodes.length; gave += m.addedNodes.length; }
		}
		if (gone && came) {
			forgetRest();
			return;
		}
		/* NOT ON A BATCH THAT ONLY TOOK NODES AWAY — task twohalves. `dom.content()` is empty-then-fill,
		 * and where the two halves reach this observer as two batches, arming on the first aims the
		 * correction at a page that is about to stop existing: CI measured `wrote--834` for a refill
		 * that grew the page by 120, the reader thrown by the transient and nothing left for the real
		 * half. Superseding the armed call with the later batch was measured instead and is WORSE —
		 * a real tick delivers around twenty records, each one cancelling the last, and the sweep went
		 * from clean to 12 findings of ordinary drift (docs/anchoring.md, "The later batch must NOT
		 * win"). This is the discriminator that survives both: a batch that removed nodes, added none
		 * and left the floored box no taller is a removal, and a removal is not a page to correct
		 * against. A synchronous `dom.content()` — every real poll tick — delivers its removals and
		 * its additions in ONE batch and is untouched. */
		if (trustEngine) {
			if (took && !gave && grew <= 0) why('emptying');
			else lateDrift(settled, grew, floorShrink);
		}
		else scheduleAnchor(ref);
	});
	for (const host of hosts) {
		_mo.observe(host, { childList: true, subtree: true });
		watch(host);
	}
	/* The moment the dialog becomes visible, which no mutation inside it announces: `showModal`
	 * writes the content first and adds `modal-overlay-active` to <body> after, so the pass the
	 * content mutation triggers still sees a closed dialog and skips it (a hidden overlay
	 * shrink-fits, so it would measure a width the dialog never has).
	 *
	 * It must be a SECOND observer: `MutationObserver.observe()` replaces the options of an existing
	 * registration for the same node, so calling it on `document.body` would drop the
	 * {childList, subtree} registration above wherever body IS the content host. Merging them the
	 * other way is worse — `subtree: true` plus an attribute filter wakes `run()` on every class
	 * change in the document, and the poll rewrites row classes on every tick. */
	/* wrapped, not passed bare: `run(records)` above means a MutationObserver callback handed to it
	 * directly would forward ITS OWN records as the dirty scope, and this observer's targets are
	 * `document.body`'s class attribute — never a box `holdFloor()` tracks — which would read as
	 * "nothing here is dirty" and skip the very sweep this observer exists to force (a dialog just
	 * became visible, or a poll rewrote a row's class). Call with none, and `holdFloor()` sweeps
	 * every box, as it always has for this trigger. */
	_moFlag = new MutationObserver(() => run());
	_moFlag.observe(document.body, { attributes: true, attributeFilter: [ 'class' ] });

	/* A TAB SWITCH — OR A DISCLOSURE CLOSING, OR A depends() ROW HIDING — MUTATES NO NODE. ui.tabs
	 * writes `data-tab-active` on the panes and fs-appearance.js's foldable() closes by writing
	 * `hidden`/`aria-expanded` only, so the `{childList}` registration above never wakes for either
	 * and the floor taken while the content was open/visible just stays — `min-height` beats the
	 * `height: 0` a hidden pane collapses with (theme/30-tables.css), so that floor IS blank page.
	 * Measured on 25.12, /admin/network/network, Interfaces -> Devices: a tab switch left 1299px
	 * standing, the document at 2647px against 1720, still there 13s later on a page whose poll
	 * never mutates #view (tools/floor-contract.mjs, issue #75); the disclosure shape measured
	 * 731/1485/1485 (open/close/still-1485) on /admin/system/footstrap before this observer
	 * covered it, 731/1485/731 with it (docs/anchoring.md).
	 *
	 * STOCK LuCI HIDES A ROW THE SAME WAY, WIDER: form.js's setActive() — what every `depends()`
	 * calls — toggles the CLASS `hidden` on the `[data-field]` element, not the attribute. `class`
	 * cannot join `data-tab-active`/`hidden`/`aria-expanded` in this filter unguarded — the poll
	 * rewrites row classes on every tick, and an unfiltered `class` watch would call run(), a
	 * forced layout, on every one of them (see _moFlag's own comment) — so a `class` record only
	 * counts where the mutated element itself carries `data-field`, a property check with no
	 * forced layout, once per delivered record rather than once per poll tick. Measured: System ->
	 * System -> Time Synchronization, unticking "Enable NTP client", left 258px of empty ground
	 * before this filter existed and 0px with it (../tmp/task-spoilerfloor/probe3.mjs).
	 *
	 * A THIRD observer for the reason the second one exists — observe() replaces the options of a
	 * registration for the same node; ONE registration per host covers all four attributes since
	 * none of this needs `subtree: true` on a different scope than `data-tab-active` already has. */
	/* AND A WRITE THAT CHANGED NOTHING IS NOT A CHANGE — task freeze. Without this half the filter
	 * above is a feedback loop that pins the main thread: the fitters `run()` calls re-apply their
	 * classes on EVERY pass by design (fs-select.js's adoptMarkup, "additive only and cheap to
	 * re-run every pass"), `classList.add()` of a token already present still WRITES the class
	 * attribute, and a same-value attribute write still queues a mutation record — the trap
	 * fs-chrome.js's `toggleAttribute` comment names for `setAttribute`. Land one of those on an
	 * element carrying `data-field` and the guard above says yes, run() sweeps, the sweep writes
	 * the same classes again, and nothing ever yields. `data-field` on a table cell is markup any
	 * app may ship: luci-app-filemanager puts it on every `<th>`. Measured on owrt2512b,
	 * /admin/system/filemanager, with every MutationObserver on the page instrumented
	 * (`../tmp/task-freeze/mo-probe.mjs`): 391 callbacks in 432ms — 926 a second, capped only by
	 * the probe's own budget — 3910 records, every one of them `class`, every one written from
	 * inside the previous callback by `tagDataTables`/`adoptMarkup`/`fitTables`, and 2340 of them
	 * on the same six `th[data-field]`. The tab never returns and the renderer sits at ~105% CPU
	 * for as long as it is open (`tools/spa-parity.mjs`, `tools/floor-contract.mjs`). With the
	 * check: 2 callbacks, 20 records, 0 of them reaching run(), and the same page answers in 4ms.
	 *
	 * The VALUE, not a flag and not `takeRecords()` after the sweep. A flag cannot work — delivery
	 * is a microtask that runs after run() has returned — and draining the queue drops whatever an
	 * external writer had queued and not yet been delivered for, which on a task that both refills
	 * a section and re-runs `depends()` is a real hide this observer exists to catch. Comparing
	 * `oldValue` against what the attribute reads NOW drops only writes that moved nothing, so a
	 * real tab switch, a real fold and a real `depends()` row all still arrive: their values
	 * change. `attributeOldValue` costs the engine a string per watched write and no layout. */
	_moTabs = new MutationObserver((records) =>
		records.some((r) => r.oldValue !== r.target.getAttribute(r.attributeName)
			&& (r.attributeName !== 'class' || r.target.dataset.field)) && run());
	for (const host of hosts)
		_moTabs.observe(host, { attributes: true, attributeOldValue: true,
			attributeFilter: [ 'data-tab-active', 'hidden', 'aria-expanded', 'class' ], subtree: true });

}

return baseclass.extend({
	/* Register a fitter and run it once. A fitter selects its own elements, strips its class
	 * (rule 1), measures and re-applies. */
	add(fit) {
		if (typeof fit !== 'function') return;
		_fitters.push(fit);
		observeContent();
		/* a fitter throwing on its first run would otherwise propagate out of add() and out of
		 * init(), so every later registration is never made — and with the gate raised that leaves
		 * every data table `display: none` for good. The passes in fs-select.js are registered
		 * separately so each fails alone. */
		try { fit(); }
		catch (e) { console.error('fs-fit: a fitter threw on registration', e); }
	},

	/* "is the reader scrolling" and "I could not measure, wake me when they stop": a pass that reads
	 * layout asks the first and calls the second, one that only writes does neither */
	scrolling,
	/* unmarked, for tools/scroll-anchor.mjs — see `_lateWhy` */
	lateWhy: () => _lateWhy,
	deferMeasurement,

	/* -> the offset this file last took a reference at, or null before it has taken one.
	 *
	 * For the gates: every correction is measured against a reference captured while the page was
	 * still, so a probe that grows the page before that reference exists measures the guard rather
	 * than the anchor. Nothing else can answer it — "is it scrolling" says no both before the motion
	 * sampler starts and after it finishes, 1.5 seconds apart in WebKit. Waiting a flat interval
	 * instead was tried: tools/scroll-anchor.mjs then reported a jump on every WebKit run and none
	 * on the other two engines, with the theme identical on all three.
	 *
	 * It carries no probe marker, and the four exports that do are the contrast: those are read by
	 * node tests against this checkout, this one by a browser sweep against the INSTALLED package.
	 * Marked, it was stripped out of the package and the sweep fell back to that same flat wait --
	 * 14 findings on one router, every one of them WebKit, every one on the Overview, and not a
	 * word about the missing method, because the call sits in a try/catch written for "no theme
	 * here at all". */
	restAt: () => _restAt,

	/* -> whether this session still lets the engine's own scroll anchoring correct a refill, or has
	 * moved to the anchorFor()/scheduleAnchor() fallback instead (LATE_MISS_LIMIT above) — until
	 * TRUST_RECOVERY_LIMIT measured refills in a row put it back (task trust). Unmarked for the same
	 * reason `restAt` is: a browser sweep against the INSTALLED package needs it, and a probe marker
	 * is what packaging strips. Task missrule — SWAP closes after one refill, so nothing before this
	 * could see the flag go false on the SECOND one; this is what a several-refill case reads instead
	 * of inferring it from timing. */
	engineTrusted: () => _engineTrusted,

	/* "the offset is mine now, forget what you remembered": called by fs-router when it resets both
	 * scrollers for an incoming page. The router resets synchronously and stamps `body[data-page]`
	 * an await later, so in between a poll tick from the OUTGOING page satisfies every term of "the
	 * engine clamped this" — offset 0, a remembered offset, nobody scrolling, the old stamp — and
	 * the reader is dragged back down a page they have left. The stamp cannot close that window
	 * alone, because it is written afterwards. */
	forgetRest,

	/* Raise the stylesheet's "an unanswered table takes no room" rule. Called only by the module
	 * that answers — see armGate above. */
	armGate,

	/* Re-fit on the next frame, coalesced. There is no exported `run`: everything that changes the
	 * available room schedules, and only the mutation observer re-fits synchronously (rule 2). */
	schedule,

	/* Coalesce any callback into one call per frame (rule 3, for non-fitters): schedule() runs every
	 * fitter, so a caller wanting only its own work batched cannot use it. Not for the per-element
	 * case — menu-footstrap.js's clamp keeps a rAF handle per <li> so it can cancel a pending
	 * measure, which a one-flag coalescer cannot express. */
	frame(fn) {
		let pending = false;
		return () => {
			if (pending) return;
			pending = true;
			requestAnimationFrame(() => { pending = false; fn(); });
		};
	},

	/* Did this batch add anything matching `sel`? The poll rewrites content on every tick, so an
	 * observer needs this cheap question before any document-wide query. */
	touches(mutations, sel) {
		for (const m of mutations)
			for (const n of m.addedNodes) {
				if (n.nodeType !== 1) continue;
				if (n.matches(sel) || n.querySelector(sel)) return true;
			}
		return false;
	},

	/* Room for `el` is its PARENT's content box: measuring against itself does not work, because a
	 * `display: table` box with width:100% still grows past it when min-content needs more, so
	 * scrollWidth and clientWidth grow together and the overflow is invisible. */
	roomFor(el) {
		const p = el && el.parentElement;
		if (!p) return Infinity;
		const cs = getComputedStyle(p);
		return p.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
	},

	/* Does `el` need more width than it has been given? The browser's own answer is the whole test:
	 * theme/30-tables.css gives a data table an honest min-content floor for as long as it is a
	 * table, so a starved column really does overflow. Do not reconstruct min-content in JS — a
	 * canvas approximation cost ~1ms per pass on a 114-row table and claimed 144px where the
	 * engine's own floor is 93.
	 *
	 * TWO measurements, because a table overflows in two directions and `scrollWidth` only sees one.
	 * A `display: table` box does not clip: when min-content needs more than it was given it GROWS
	 * PAST its parent, so its scrollWidth and clientWidth rise together and the overflow is
	 * invisible from inside — the same trap `roomFor()` above is written around. The box's own
	 * width is what the reader sees sticking out, and it is what tools/live-audit.mjs measures
	 * (`right > host + 1.5`). Taking the larger of the two makes this test answer the question the
	 * gate asks: `#packages` on a fresh snapshot router came out 2px past the content column at
	 * 1440 and stayed un-carded, because scrollWidth alone said it fitted. */
	overflows(el) {
		const room = this.roomFor(el);
		const grown = el.getBoundingClientRect().width;
		return Math.max(el.scrollWidth, grown) > room + 1;	/* +1: sub-pixel rounding */
	},

	/* IS SOMEBODY ELSE ALREADY SCROLLING THIS? An app that puts its table in a box of its own with
	 * `overflow-x: auto` has answered the overflow question itself, and the theme re-laying that
	 * table overrules a decision that was not its to take: luci-app-filemanager parks its listing in
	 * a 598px `div.resizeable` and the whole table came out as cards on a 1280px screen, where the
	 * page had 1224px of room and the reader had asked for none of it.
	 *
	 * The walk stops at the content root, so the theme's own scrollers are not this test's business:
	 * `#modal_overlay` is the dialog's scroller (base/60-modal.css) and the scroll fallback the theme
	 * gives a foreign table is on the TABLE itself (theme/30-tables.css), not on an ancestor. */
	inScroller(el) {
		for (let p = el.parentElement; p && p.id !== 'view' && p.id !== 'modal_overlay'; p = p.parentElement)
			if ((/(auto|scroll)/).test(window.getComputedStyle(p).overflowX)) return true;
		return false;
	}

});
