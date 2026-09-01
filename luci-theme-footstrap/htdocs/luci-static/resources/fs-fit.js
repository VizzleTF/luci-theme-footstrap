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
	try { document.documentElement.dataset.fsFit = '1'; } catch (e) { /* no document, no gate */ }
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
 * reference before calling here and applies the offset afterwards. */
function run() {
	if (!fittersEnabled()) return;
	runAll(_fitters, 'fitter');
	/* make the document whole again before anything lays it out, then take the position the next
	 * mutation is measured against — unless a correction is already on its way, which would make
	 * this reference the drifted one */
	holdFloor();
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
/* A section body and a table: what `dom.content()` is called on and this can hold. Its third target,
 * a table's BODY, is deliberately absent — a floor there holds nothing. `min-height` is undefined on
 * a table box (CSS 2.1 §10.7) and WebKit acts on that: a `.table.cbi-section-table` carrying a 313px
 * floor still collapsed to 30px and the document lost 284px (webkit, /admin/network/firewall, 24.10
 * and 25.12 alike; Chromium holds the 313px), and writing the floor on the `.tbody` instead loses
 * the same 284px. 24.10 has no `.tbody` at all: its Overview renders `<table class="table">` with the
 * rows directly inside, and the container a poll empties there is `.cbi-section > div`.
 * tools/scroll-anchor.mjs looks for all three when it picks a box to collapse, which is a different
 * question from which box can carry a floor. */
const SHRINKS = '.cbi-section > div, .table';

/* A box qualifies for a floor through its CHILDREN, so emptying it takes it out of `SHRINKS` — and
 * a floor nothing sweeps any more is a floor nothing can take off: measured on Network ->
 * Interfaces, a section emptied of its table kept 1299px of `min-height` for the life of the page.
 * Every floor this writes is marked, so the sweep finds its own work again whatever became of the
 * markup underneath. The attribute is in the theme's own namespace and says nothing to CSS. */
const FLOORED = '[data-fs-floor]';

/* What the container would stand at with no floor under it, asked of the CONTENT rather than by
 * taking the floor off and re-measuring.
 *
 * Clearing `min-height` to re-measure was the obvious way and is the expensive one: `min-height` is
 * a scroll-anchoring suppression trigger on the path from the anchor to the scroller
 * (css-scroll-anchoring-1 §3.2), so a clear, a forced layout and a write back tell the engine to
 * drop its own compensation for that frame — the theme switching off the very thing it relies on,
 * once per tick.
 *
 * The span of the children answers the same question with reads alone. It is the box's content
 * height plus what the box adds below it; a collapsed margin on the last child can put it a few
 * pixels out, which a floor can afford — the floor is a lower bound on a height that is about to be
 * replaced, not a layout the page is drawn to.
 *
 * An empty container answers 0, and the caller keeps the standing floor for exactly that reason:
 * `dom.content()` empties before it refills, and 0 is the number the floor exists to refuse. */
function naturalHeight(el) {
	const last = el.lastElementChild;
	if (!last) return 0;
	const box = el.getBoundingClientRect();
	/* A BOX WITH NO HEIGHT OF ITS OWN HOLDS NOTHING UP, and asking its content how tall it would be
	 * gets an answer about a page that is not on screen. `visibility: hidden` leaves children in the
	 * layout with rects of their own, so an inactive tab pane — collapsed to height 0 by
	 * theme/30-tables.css — measures its full content here and the floor then pins that collapse
	 * open: on Network -> Interfaces the hidden `device` pane held 893px, and the active pane's
	 * content sat that much further down the page (issue #41, reported against a third-party page
	 * and reproduced on the stock one). The clear-and-remeasure shape this replaced read the
	 * collapsed height and wrote nothing, which is the behaviour restored here.
	 *
	 * A container a tick has just emptied also measures 0, and that is the same answer for the same
	 * reason: the floor it already wears is what holds it up, and holdFloor() leaves it alone. */
	if (!box.height) return 0;
	const end = last.getBoundingClientRect();
	if (!end.height && !end.width) return 0;		/* a last child out of the flow says nothing */
	let bottom = end.bottom;
	/* AND THE TEXT AFTER IT. A box whose content ends in text ends below its last ELEMENT, and
	 * measuring to that element writes a floor shorter than the box: `.cbi-section-descr` on
	 * /admin/network/dhcp measured 115px against the 156px it stands at, and a floor 41px short lets
	 * the document shrink under the reader during the very tick the floor is there to hold.
	 *
	 * Only the tail, not `selectNodeContents(el)`: a Range over the whole box takes in whatever is
	 * out of the flow inside it and writes a floor TALLER than the box instead — 205px against 107
	 * on the Overview, which is the same blank page seen from the other side. */
	if (last.nextSibling) {
		const tail = document.createRange();
		tail.setStartAfter(last);
		tail.setEnd(el, el.childNodes.length);
		const box2 = tail.getBoundingClientRect();
		if (box2.height || box2.width) bottom = Math.max(bottom, box2.bottom);
	}
	const cs = window.getComputedStyle(el);
	const below = parseFloat(cs.paddingBottom) + parseFloat(cs.borderBottomWidth);
	return Math.round(bottom - box.top + (below || 0));
}

/* The floor is the height the next tick may not go below, one per box. Read in one pass and written
 * in another, so the sweep costs a single forced layout rather than one per element.
 *
 * WRITTEN ONLY WHERE THE VALUE CHANGES, which is the difference between a floor and a page the
 * engine refuses to anchor: see naturalHeight() above. Measured over 25 s of real polling on the
 * Overview at 390px, the clear-and-rewrite shape wrote style 1550 times on 25.12 and 170 times on
 * ImmortalWrt 24.10, of which 75 and 62 carried a value that had actually moved — the rest were
 * suppression bought for nothing. It is 45 writes, all of them real, on both.
 *
 * AND NOT ON A TABLE BOX, which cannot hold it: `min-height` is undefined there (CSS 2.1 §10.7) and
 * WebKit acts on that — a `.table.cbi-section-table` wearing a 313px floor still collapsed to 30px
 * when its rows went, and the document lost 284px on /admin/network/firewall, the same on 24.10 and
 * 25.12, while Chromium held the 313px. The `.tbody` inside it is a table box too and loses the same
 * 284px. So the floor climbs to the first box that is not one — the section — where the same
 * emptied `.tbody` costs the document 0px on both engines. `getComputedStyle` resolves style, not
 * layout, so the climb adds no forced layout of its own.
 *
 * Not while the reader scrolls: a rect read is a forced layout, and a floor staying where it was is
 * still a floor. */
/* Boxes that measured empty on the LAST pass, so a floor that is holding nothing up can be told
 * from one that is holding the page still while `dom.content()` refills. WeakSet: a box the router
 * has replaced is garbage, and this must not be what keeps it alive. */
const emptied = new WeakSet();

/* Off in one place, so the mark and the style can never disagree about who wears a floor. */
function dropFloor(box) {
	if (box.style.minHeight) box.style.minHeight = '';
	box.removeAttribute('data-fs-floor');
}

/* THE SECOND LOOK HAS TO BE SCHEDULED, not waited for. Every other pass here is driven by the
 * MutationObserver on `#view`, and a container that empties and stays empty produces no further
 * mutation — so "clear it if it is still empty next pass" never gets a next pass, and the floor
 * stands for the life of the page (measured: 1299px on Network -> Interfaces).
 *
 * One poll interval, because that is how long a container that is genuinely refilling may take: the
 * router's own `pollinterval` when the page will say it, and its shipped default of 5 s otherwise.
 * Shorter risks taking the floor away from a tick still in flight, which is the 568px clamp this
 * whole mechanism exists to stop. */
let _emptyCheck = null;

function checkEmptyLater() {
	if (_emptyCheck) return;
	let secs = 5;
	try { secs = (window.L && L.env && L.env.pollinterval) || 5; } catch (e) { /* not on a LuCI page */ }
	_emptyCheck = setTimeout(() => { _emptyCheck = null; run(); }, secs * 1000);
}

function holdFloor() {
	if (scrolling()) return;
	const host = document.getElementById('view');
	if (!host) return;			/* the login page has no view */
	const boxes = [], hs = [], gone = [];
	host.querySelectorAll(SHRINKS + ', ' + FLOORED).forEach((el) => {
		let box = el, cs = window.getComputedStyle(el);
		while (box && box !== host && cs.display.startsWith('table')) {
			box = box.parentElement;
			if (box) cs = window.getComputedStyle(box);
		}
		/* several tables in one section climb to the same box; it needs one floor, not one each */
		if (!box || box === host || boxes.indexOf(box) !== -1) return;
		boxes.push(box);
		/* `visibility` inherits, so this is equally true of every box inside a collapsed pane */
		const hidden = cs.visibility === 'hidden';
		gone.push(hidden);
		hs.push(hidden ? 0 : naturalHeight(box));
	});
	boxes.forEach((box, i) => {
		/* A BOX THE READER CANNOT SEE GIVES ITS FLOOR BACK. `min-height` beats the `height: 0` an
		 * inactive tab pane is collapsed with (theme/30-tables.css), so a floor written while the pane
		 * was open pins the collapse open once it closes: on Network -> Interfaces the `interface`
		 * pane held its 1265px after the reader left it, and the tab they were looking at started
		 * that far down the page (issue #41). The clear-and-remeasure shape this replaced in 0.14.4
		 * cleared every floor each tick, so a pane going inactive lost its own on the next one; only
		 * a box that cannot hold anything up is cleared here, and it is re-measured the tick after it
		 * comes back. A collapsed pane whose floor is still standing also measures a height of its
		 * own, which is why refusing to write is not enough. */
		if (gone[i]) { dropFloor(box); return; }
		/* ZERO IS AN EMPTY BOX, and the floor it already wears is what holds it up — the moment this
		 * whole mechanism exists for, since `dom.content()` empties before it refills.
		 *
		 * But only for the one pass. A box that is still empty on the next one is not refilling, and
		 * its floor is then blank page that nothing takes back: measured on Network -> Interfaces,
		 * a section emptied and left alone keeps 1299px of `min-height` for the life of the page,
		 * with the document standing at 1720px around no content at all. That is what 0.14.4 changed
		 * by replacing clear-and-remeasure, which read the collapsed height and wrote nothing. */
		if (hs[i] <= 0) {
			if (!box.style.minHeight) return;
			if (emptied.has(box)) { dropFloor(box); emptied.delete(box); }
			else { emptied.add(box); checkEmptyLater(); }
			return;
		}
		emptied.delete(box);
		const px = hs[i] + 'px';
		if (box.style.minHeight !== px) {
			box.style.minHeight = px;
			box.setAttribute('data-fs-floor', '');
		}
	});
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
		_lastOffset = y;
		_movingUntil = Date.now() + SCROLL_IDLE;
	}
	if (scrolling()) { requestAnimationFrame(sampleMotion); return; }
	_sampling = false;
	/* the reader has stopped, so the floor and the reference both belong to where the page now
	 * stands */
	holdFloor();
	rememberRest();
	/* the page has held still for SCROLL_IDLE: whatever was put off may run now */
	if (_deferred) {
		_deferred = false;
		/* where the reference stands BEFORE the put-off pass re-lays the page — see settleDrift() */
		const settled = _rest;
		const before = (settled && settled.el && settled.el.isConnected)
			? settled.el.getBoundingClientRect().top
			: ((settled && settled.sec && settled.sec.isConnected) ? settled.sec.getBoundingClientRect().top : null);
		/* No correction for this batch. Both available references are wrong for a page the reader
		 * has just scrolled through: a fresh one is read against an offset WebKit may not have laid
		 * out yet (the theme then undoes the reader's own move), and the one from the last still
		 * page drags them back to where they were before the flick — the gate caught that as a 231px
		 * jump landing inside a scroll, on all three engines. Nothing here is a poll tick —
		 * the fitters re-measure what the scroll already showed rather than growing the page — and
		 * the next mutation corrects against a reference taken while the page was still. */
		run();
		if (ENGINE_ANCHORS) settleDrift(settled, before);
	}
}

/* ---- the put-off pass moves the page too, and nothing was looking ----
 *
 * A tick landing while the offset is in motion leaves its measurements to the block above, and that
 * pass then re-lays the tables it could not measure. An anchoring engine answers that layout change
 * the way it answers any other — and `min-height`, which the floor writes on every container, is
 * itself a suppression trigger on the path to the anchor (css-scroll-anchoring-1 §3.2), so the
 * engine's compensation can be switched off by the very pass that needs it. Measured on
 * ImmortalWrt 24.10/WebKit: this pass's 88 `min-height` writes and a 58px jump of the offset land in
 * the SAME frame, 429 ms after the mutation (@390, top layout, large density, Overview).
 *
 * `lateDrift()` cannot see it: it is scheduled from the mutation on the same SCROLL_IDLE, so it
 * measures ALONGSIDE this pass rather than after it — it read a drift of zero three milliseconds
 * before the page moved, and scroll-anchor reported those 58px on that cell alone out of 48.
 *
 * MEASURED SYNCHRONOUSLY AROUND THE PASS, not a frame or an idle window later. Two reasons, and the
 * second cost a run: the reader cannot scroll between two statements, so what this sees is the
 * pass's doing and nothing else — a version that looked two frames later corrected inside a flick on
 * three cells of the same sweep. And `getBoundingClientRect()` is exactly the operation the spec
 * makes the engine flush a pending adjustment before, so the read after the pass sees the engine's
 * answer rather than racing it (§2.2: the suppression window ends at the end of the event loop
 * iteration, or before the next operation whose result would differ, whichever is sooner). */
function settleDrift(ref, before) {
	if (before == null || !ref) return;
	if (!anchorEnabled() || Date.now() < _userUntil) return;
	if (_restPage !== pageStamp()) return;
	const el = (ref.el && ref.el.isConnected) ? ref.el : ((ref.sec && ref.sec.isConnected) ? ref.sec : null);
	if (el) putBack(el, before);
}

/* Give the reader back what moved under them: the one write both corrections make, and the rules
 * that write obeys.
 *
 * A drift under a pixel is rounding, and an engine that answered for it reads the same. One
 * viewport is the ceiling, a drift that size being a view that replaced its whole subtree rather
 * than a tick — anchorFor() raises it for the one drift that big with a receipt, a measured clamp.
 *
 * The write moves the page by exactly the drift measured, so the reference is back at the top it
 * was remembered at and the next tick measures zero. Only `_restAt` moves, and the write may have
 * been clamped short, so it is re-read rather than assumed; `rememberRest()` cannot do it, since
 * the write starts the motion sampler and that function returns early while the page moves. */
function putBack(el, was) {
	const drift = el.getBoundingClientRect().top - was;
	if (Math.abs(drift) < 1 || Math.abs(drift) > (window.innerHeight || 800)) return;
	const sc = scroller();
	const at = sc ? sc.scrollTop : window.scrollY;
	if (sc) sc.scrollTop = at + drift; else window.scrollTo(0, at + drift);
	_restAt = scrollTop();
	/* AND WHERE THE ELEMENT ACTUALLY LANDED, which is not always `was`. The line above used to be
	 * the whole of it, on the reasoning this comment states — the write is exactly the drift, so the
	 * element is back at the top it was remembered at. It is not whenever the write was CLAMPED
	 * SHORT, a case the line above already allows for by re-reading the offset: the page had less
	 * room than the drift asked for, the element stops wherever the clamp left it, and `_rest` goes
	 * on naming a top nothing can reach. Every later tick then measures that unreachable difference
	 * and spends it on the reader: measured on webkit/Overview @390 top, `_rest` claiming 93.02 for
	 * an element standing at 105, and the reader 12px off on the next tick (52px at normal density).
	 *
	 * Two rects on a layout the write has already forced. The section half is re-read for the same
	 * reason and cannot be measured by the same probe — the sweep's swap returns the very nodes it
	 * took out, so `_rest.el` survives it and the fallback is never reached, while a real
	 * `dom.content()` puts NEW nodes in and lateDrift() corrects against `sec`/`secTop` instead.
	 *
	 * `_rest.at` is deliberately NOT touched: it belongs to anchorFor(), on the path where the
	 * engine does no anchoring, and this fault is on the other one — measured, the sweep is green
	 * on all 18 cells of the failing axis without it. */
	if (_rest) {
		if (_rest.el && _rest.el.isConnected) _rest.top = _rest.el.getBoundingClientRect().top;
		if (_rest.sec && _rest.sec.isConnected) _rest.secTop = _rest.sec.getBoundingClientRect().top;
	}
}

function noteMotion() {
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
	/* a gesture that IS the scroll: the reader is driving and the page is moving */
	for (const name of [ 'wheel', 'touchstart', 'touchmove' ])
		window.addEventListener(name, noteUser, opts);
	/* Intent only. A scrollbar drag and a Page Down move the page and say so themselves, through
	 * `scroll`. Feeding them to `noteMotion` too would make `scrolling()` answer yes for 400ms after
	 * any click and every keystroke, which gates every layout-reading pass in this file: while
	 * typing into a form, 9 of 10 passes were skipped and landed in one burst afterwards. */
	for (const name of [ 'mousedown', 'keydown' ])
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
 * suppressed, a 120px growth above the fold moves the reader 120px, and 0px with it on. An older
 * WebKit does not, and a current one anchors but gets the COLLAPSE case wrong instead (lateDrift()
 * below). Correcting the offset in an engine that also corrects it means two corrections and a
 * page that jumps the other way, so this is asked of the platform rather than of a browser name —
 * `overflow-anchor` is the property that turns the feature off, and an engine that does not know it
 * does not have it. */
const ENGINE_ANCHORS = (() => {
	/* dev switch: `localStorage.fsEngineAnchor = 'off'` makes any engine take the non-anchoring
	 * path, which is otherwise only reachable on a machine with Safari on it */
	try { if (localStorage.getItem('fsEngineAnchor') === 'off') return false; }
	catch (e) { /* no storage, no switch */ }
	try { return typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('overflow-anchor', 'auto'); }
	catch (e) { return true; }		/* unreadable: assume it is handled rather than fight it */
})();

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
function pageStamp() {
	return (document.body && document.body.getAttribute('data-page')) || '';
}
/* -> the memo is void: whoever calls this owns the offset now (see the export below) */
function forgetRest() {
	_rest = null;
	_restAt = null;
	_restPage = null;
}
function rememberRest() {
	if (scrolling()) return;
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

function lateDrift(ref) {
	/* the reference from BEFORE this tick, captured by the caller: one taken after the mutation
	 * describes the page as the mutation left it, so its drift is zero by construction */
	if (_lateFrame || !ref) return;
	_lateFrame = requestAnimationFrame(() => {
		const seen = scrollTop();
		/* STILL FOR SCROLL_IDLE, the interval this file already calls a page nobody is scrolling.
		 * A frame is not long enough to tell a flick from a still page: a flick moves the offset in
		 * steps of tens of milliseconds and two rAFs (~16 ms) fall inside one step, so the offset
		 * reads the same twice while the page is plainly moving. 120 ms was still short enough to
		 * let one 160px correction through on a loaded runner. */
		_lateFrame = window.setTimeout(() => {
			_lateFrame = 0;
			if (!anchorEnabled() || Date.now() < _userUntil) return;
			if (_restPage !== pageStamp()) return;
			/* THE OFFSET, NOT THE EVENT STREAM. `scrolling()` cannot answer this one: the engine's
			 * own compensation moves the offset and starts the motion sampler, so gating on it
			 * skips every tick this exists for — and in WebKit a programmatic scroll's event
			 * arrives up to 1.2s late, so the sampler is often not running at all when a flick is
			 * in progress. Asking where the offset stands answers both: the reference was taken
			 * with the reference on a still page, so an offset anywhere else means the reader has
			 * moved since, and whatever this would put back they have already scrolled past. A
			 * correction landing inside a flick is itself a jump (161px, webkit/Overview).
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
			if (scrollTop() !== seen) return;
			/* the tick usually replaces the element this was taken on, so without the section
			 * fallback the correction does nothing on the tick it exists for */
			if (ref.el && ref.el.isConnected) putBack(ref.el, ref.top);
			else if (ref.sec && ref.sec.isConnected && ref.secTop != null) putBack(ref.sec, ref.secTop);
		}, SCROLL_IDLE);
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
		applyAnchor(pending);
		/* after the correction, never before: the reference must describe the page as the reader now
		 * sees it, or the next tick pays the same drift twice */
		rememberRest();
	});
}
function applyAnchor(ref) {
	if (!ref) return;
	/* not into a moving page: the correction is scheduled from the mutation and applied a frame
	 * later, and a reader who starts scrolling in between would be put back onto a page they have
	 * already left */
	if (scrolling()) return;
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
		if (sc) sc.scrollTop = at + ref.by;
		else window.scrollTo(0, at + ref.by);
		return;
	}
	if (at <= 0) return;
	if (!ref.el.isConnected) return;
	const drift = ref.el.getBoundingClientRect().top - ref.top;
	if (Math.abs(drift) < 1) return;
	/* A correction is a scroll the reader did not ask for, so an absurd one is a bug: a view that
	 * replaced its whole subtree can move a reference by thousands of pixels. One viewport and 200px
	 * is the most a single tick can honestly account for — where `innerHeight` is unreadable those
	 * 200px are the whole ceiling — plus whatever the engine is on record for having clamped away
	 * (`slack`, see anchorFor()). */
	if (Math.abs(drift) > (window.innerHeight || 0) + 200 + (ref.slack || 0)) return;
	if (sc) sc.scrollTop = at + drift;
	else window.scrollTo(0, at + drift);
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
	_mo = new MutationObserver(() => {
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
		const ref = ENGINE_ANCHORS ? null : anchorFor();
		run();
		if (ENGINE_ANCHORS) lateDrift(settled);
		else scheduleAnchor(ref);
	});
	const hosts = [ document.getElementById('view') || document.body, document.getElementById('modal_overlay') ]
		.filter(Boolean);
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
	_moFlag = new MutationObserver(run);
	_moFlag.observe(document.body, { attributes: true, attributeFilter: [ 'class' ] });

	/* A TAB SWITCH IS A LAYOUT CHANGE WITH NO MUTATION IN IT. `ui.tabs` moves no node — it writes
	 * `data-tab-active` on the panes — so the {childList} registration above never wakes, and the
	 * floor the outgoing pane wears stands until something else sweeps. `min-height` beats the
	 * `height: 0` an inactive pane is collapsed with (theme/30-tables.css), so that floor is blank
	 * page above whatever the reader just opened: measured on 25.12, System -> Startup left 2432px
	 * of it and the "Local Startup" textarea read as missing (#75), Network -> Interfaces 1299px
	 * until the next poll tick, i.e. one `pollinterval`. A page that does not poll never gets that
	 * tick and keeps the blank for the life of the page.
	 *
	 * `run()` direct, not the observer above: the anchoring corrections answer a poll tick that
	 * moved the page under a still reader, and a tab the reader clicked is neither.
	 *
	 * A THIRD observer for the reason the second one exists — observe() replaces the options of a
	 * registration for the same node. The filter keeps it to the one attribute: `subtree: true` on
	 * `class` would wake run() on every row the poll rewrites. */
	_moTabs = new MutationObserver(run);
	for (const host of hosts)
		_moTabs.observe(host, { attributes: true, attributeFilter: [ 'data-tab-active' ], subtree: true });
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
