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
let _ro = null, _mo = null, _moFlag = null;

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
const SHRINKS = '.cbi-section > div, .table';

/* The floor is the height the next tick may not go below, one per container. Cleared before the
 * read, or each floor measures itself and never comes down; batched into one clear, one read pass
 * and one write pass, so the whole sweep costs a single forced layout rather than one per element.
 *
 * Not while the reader scrolls: clearing to re-measure is a layout read, and a floor staying where
 * it was is still a floor. */
function holdFloor() {
	if (scrolling()) return;
	const host = document.getElementById('view');
	if (!host) return;			/* the login page has no view */
	const els = host.querySelectorAll(SHRINKS), hs = [];
	els.forEach((el) => { el.style.minHeight = ''; });
	els.forEach((el) => hs.push(el.offsetHeight));
	els.forEach((el, i) => { if (hs[i] > 0) el.style.minHeight = hs[i] + 'px'; });
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
		_lateFrame = requestAnimationFrame(() => {
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
			if (scrollTop() !== ref.at) return;
			/* the tick usually replaces the element this was taken on, so without the section
			 * fallback the correction does nothing on the tick it exists for */
			let el = ref.el, was = ref.top;
			if (!el || !el.isConnected) {
				if (!ref.sec || !ref.sec.isConnected || ref.secTop == null) return;
				el = ref.sec; was = ref.secTop;
			}
			const drift = el.getBoundingClientRect().top - was;
			if (Math.abs(drift) < 1) return;			/* the engine put it back */
			if (Math.abs(drift) > (window.innerHeight || 800)) return;
			const sc = scroller();
			const at = sc ? sc.scrollTop : window.scrollY;
			if (sc) sc.scrollTop = at + drift; else window.scrollTo(0, at + drift);
			/* The write moves the page by exactly the drift measured, which puts the reference back
			 * at the top it was remembered at, so `_rest.top` still holds and the next tick
			 * measures zero. Only `_restAt` changes, and the write may have been clamped short, so
			 * it is re-read rather than assumed; `rememberRest()` cannot do it, since the write
			 * starts the motion sampler and that function returns early while the page moves. */
			_restAt = scrollTop();
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
	for (const host of [ document.getElementById('view') || document.body, document.getElementById('modal_overlay') ]) {
		if (!host) continue;
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
	 * engine's own floor is 93. */
	overflows(el) {
		return el.scrollWidth > this.roomFor(el) + 1;	/* +1: sub-pixel rounding */
	}

});
