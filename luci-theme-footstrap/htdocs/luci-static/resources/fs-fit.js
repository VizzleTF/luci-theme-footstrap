'use strict';
'require baseclass';
'require ui';

/* fs-fit — the theme's ONE "does it still fit?" engine; add fit logic here, do not grow a second
 * observer. No CSS query can ask what the CONTENT needs (media = viewport, container =
 * container): does the menu fit beside the brand, is a table still readable? Both were once
 * breakpoints (one @media, five @container thresholds) — guessed numbers that real routers got
 * wrong, useless for a third-party luci-app-* table of unknown column count.
 *
 * THREE RULES, each a bug that was hit:
 *  1. MEASURE UNCOLLAPSED — a collapsed thing always "fits" (a stacked table is a pile of flex
 *     rows): read it as it stands and it un-collapses, next frame re-collapses. Oscillation.
 *  2. RE-FIT SYNCHRONOUSLY ON A MUTATION — the poll re-renders content once a second and the
 *     fresh element has lost our class. A MutationObserver callback is a microtask (pre-paint),
 *     rAF runs AT paint: deferring there painted a stacked table one frame at full width —
 *     19-109px of overflow, once a second, on Firewall/DHCP/Wireless.
 *  3. COALESCE ON RESIZE — every fit forces a synchronous layout.
 *
 * ResizeObserver, not onresize: a rail collapse and a layout toggle change the content width
 * without resizing the window. */

/* THE STYLESHEET MAY ONLY HIDE WHAT THIS FILE WILL SHOW, AND THE ARM BELONGS TO THE DISARM.
 * `theme/30-tables.css` keeps a data table out of the layout until something marks it `.fs-fitted`.
 * This attribute is what arms that rule — and it used to be written here, at module eval, while the
 * only code that ever writes `.fs-fitted` lives in fs-select.js, which the footer requires
 * SEPARATELY (`partials/footer.ut`: one require for menu-footstrap, another for fs-select, with no
 * dependency edge between them). A document that loaded this file and not that one — a failed
 * fetch, a parse error, a throw in fs-select's own init — armed a rule nobody could clear, and every
 * data table on Status/Leases/Processes/Wireless rendered as nothing at all, silently.
 *
 * So the arming is exported instead, and the module that clears the rule is the one that raises it.
 * A document where fs-select never ran carries no attribute and shows every table exactly as it did
 * before the rule existed. */
function armGate() {
	if (!fittersEnabled()) return;
	try { document.documentElement.dataset.fsFit = '1'; } catch (e) { /* no document, no gate */ }
}

const _fitters = [];
let _rafPending = false;
let _ro = null, _mo = null, _moFlag = null;

/* ---- A PASS THAT READS LAYOUT MAY NOT RUN WHILE THE READER SCROLLS ----
 *
 * Reading layout — `getBoundingClientRect()`, `clientWidth`, `scrollWidth` — forces the engine to
 * lay the page out synchronously. Once a second, from a poll tick, in the middle of a flick on a
 * phone, that is what iOS holds the main thread back to prevent, and it was the largest part of the
 * shaking reported from an iPhone; a stock theme has no JS in that path at all.
 *
 * The rule is stated by each pass rather than by this file, and that is not an oversight — the
 * central version was written, measured and reverted, because moving the decision here also moved
 * WHEN the deferred work lands and the device started shaking again. A pass that reads layout asks
 * `scrolling()` and calls `deferMeasurement()`; a pass that only writes does neither and runs
 * always. The one that must run always is the marking of a freshly polled table: the stylesheet
 * keeps an unmarked data table out of the layout, so waiting would leave it invisible for as long
 * as the reader keeps scrolling. */
function runAll(list, what) {
	for (const fit of list) {
		try { fit(); }
		/* one broken fitter must take neither the others nor the poll's MutationObserver
		 * callback with it — that would silently stop ALL re-fitting */
		catch (e) { console.error('fs-fit: a ' + what + ' threw', e); }
	}
}

/* Everything that may run right now, with the reader kept where they were.
 *
 * ONE PATH: the mutation observer, the coalesced re-fit and the pass that was put off during a
 * scroll all come through here, so the order — reference, work, correction — is stated once.
 * `anchorRef()` answers null while the reader scrolls and the correction below does nothing with a
 * pass that happens mid-scroll costs neither of the two layout reads.
 *
 * WHAT MAY RUN MID-SCROLL IS EACH PASS'S OWN ANSWER, not this function's. A pass that only writes —
 * marking a freshly polled table, which cannot wait because the stylesheet holds an unmarked table
 * out of the layout — runs always; a pass that reads layout asks `scrolling()` first and calls
 * `deferMeasurement()`. Deciding it here instead was tried and reverted: it changed WHEN the
 * deferred work lands, and the device that had the problem started shaking again. */
/* DEV SWITCH: `localStorage.fsFit = 'off'` stops every fitter. It exists because the only way to
 * tell "the theme's measuring is what shakes this phone" from "something else is" is to turn the
 * measuring off ON THAT PHONE, and a laptop cannot answer it. */
function fittersEnabled() {
	try { return localStorage.getItem('fsFit') !== 'off'; }
	catch (e) { return true; }
}
function run() {
	if (!fittersEnabled()) return;
	runAll(_fitters, 'fitter');
}

/* ---- IS THE PAGE MOVING RIGHT NOW? — ASKED OF THE POSITION, NEVER OF THE EVENTS ----
 *
 * A pass that reads layout must not run while the page moves: on a phone every such read forces a
 * synchronous layout in the middle of a flick, which is the work iOS holds the main thread back to
 * prevent. So the passes ask this before measuring, and what they skipped is run once the movement
 * stops.
 *
 * THE FIRST VERSION ASKED THE EVENTS — `scroll`, `wheel`, `touchmove`, plus 200 ms of quiet — and it
 * was wrong in the one place it mattered. On iOS the momentum keeps carrying the page long after the
 * finger has gone, and events do not reliably arrive through it; the timer then declared the reader
 * still and dropped the whole deferred pass — every table stripped and measured, the chrome
 * re-fitted — into the middle of the glide. That is a stall and a relayout while the page is
 * visibly moving, and it is the shaking that came BACK when a refactor made less work happen during
 * the scroll and more of it land in that burst. The measurement that named it: the same device
 * shook more with strictly less work in the scroll path.
 *
 * So movement is read from the SCROLL POSITION. A frame in which the offset differs from the last is
 * movement, whatever the event stream is doing; the sampler runs only while there is reason to
 * think the page moves, and stops itself when the offset has held for SCROLL_IDLE. Momentum,
 * rubber-banding and a programmatic `scrollTo` all look the same to it, which is the point.
 *
 * The offset read is one per frame, and it is the cheapest question there is — no geometry, no
 * element, no forced layout beyond what the frame already needs. */
/* HOW LONG THE PAGE MUST HOLD STILL BEFORE THE PUT-OFF WORK MAY RUN, and the number is the fix for
 * the shaking, not a tuning knob.
 *
 * 200ms was shorter than the pauses a slow reader leaves. Rocking a page gently at the tables — the
 * reader's own description of when it happens — the offset stops for a moment between one movement
 * and the next, this timer called that a stop, and the whole deferred pass landed in the middle of
 * the gesture: every table stripped of its marks, measured, marked again. That is a full relayout
 * while the page is visibly moving, and it is what "jerks back and forth" was.
 *
 * Measured on a stand with the reader's motion imitated (a slow rock, 60 frames, the error between
 * what the wheel asked for and what the page did, summed): 137-256px of roughness at 200ms with
 * every twentieth frame off by 40px, and 59px — the floor, one pixel of rounding per frame, the same
 * as switching the fitters off entirely — at 250ms and above. 400 is that floor with room to spare,
 * and still well inside the time a reader takes to look at what they scrolled to. */
const SCROLL_IDLE = 400;
/* set by a pass that skipped its measurement because the page was moving; consumed by the sampler
 * below the moment it stops */
let _deferred = false;
function deferMeasurement() { _deferred = true; }
let _movingUntil = 0;
let _lastOffset = null;
let _sampling = false;

/* WHICH ELEMENT SCROLLS, ASKED ONCE PER WIDTH RATHER THAN ONCE PER FRAME.
 *
 * This function is the one every other pass consults before it dares to measure, and it ran in the
 * frame loop below for as long as the page moved — so the `scrollHeight`/`clientHeight` probe it
 * used to make WAS a forced synchronous layout, once per frame, in the middle of the flick this file
 * exists to keep clear. Worse, a poll tick lands as a microtask that writes classes, so the very
 * next frame's probe paid for a layout that had just been dirtied; and `touchstart` starts the
 * sampler, so a plain tap on a button bought ~24 of them.
 *
 * WHAT IS ASKED IS ALSO NOT WHAT IT USED TO ASK. "Does this element currently overflow" is a
 * property of the CONTENT, and it was being memoised against a stamp that only moves when a WIDTH
 * does: open a short page (no overflow, answer cached as "the window scrolls"), navigate to a tall
 * one — `#view` keeps its identity and its width, so nothing bumps the stamp — and every pass went
 * on reading `window.scrollY`, which in the sidebar layout is pinned at 0 by
 * `.fs-shell { height: 100svh; overflow: hidden }`. The offset then never appeared to move, the
 * sampler never extended `_movingUntil`, and every mid-scroll guard in this file was inert on
 * exactly the pages tall enough to scroll.
 *
 * The question is "which element does this layout scroll", and the STYLESHEET is what decides it:
 * `theme/20-shell.css` gives `.fs-main` `overflow-y: auto` for the desktop sidebar layout and
 * nothing else, so the computed value IS the answer — no content-height probe, no viewport literal
 * copied out of a media query, and correct the moment the CSS changes. `getComputedStyle` resolves
 * style, not layout, and the verdict is cached against the resize stamp AND the two attributes that
 * carry a layout change (`data-layout`, `data-narrow`), so the frame loop reads neither. */
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
	/* the page has held still for SCROLL_IDLE: whatever was put off may run now */
	if (_deferred) {
		_deferred = false;
		const ref = anchorRef();
		run();
		scheduleAnchor(ref);
	}
}

function noteMotion() {
	_movingUntil = Date.now() + SCROLL_IDLE;
	if (_sampling) return;
	_sampling = true;
	requestAnimationFrame(sampleMotion);
}

/* `passive: true` and `capture: true`: this must never sit in front of the scroll it is watching,
 * and `scroll` does not bubble from an element — it only travels down the capture phase, which is
 * how the sidebar layout's inner scroller is seen as well as the document. The events only START
 * the sampler; whether the page is still moving is the sampler's answer, not theirs. */
(function watchMotion() {
	const opts = { passive: true, capture: true };
	window.addEventListener('scroll', noteMotion, opts);
	window.addEventListener('wheel', noteMotion, opts);
	window.addEventListener('touchstart', noteMotion, opts);
	window.addEventListener('touchmove', noteMotion, opts);
})();

/* Next frame, at most once per frame (rule 3). */
function schedule() {
	if (_rafPending) return;
	_rafPending = true;
	requestAnimationFrame(() => { _rafPending = false; run(); });
}

/* WIDTH ONLY, and this is not an optimisation — it is what makes the theme usable on a phone.
 *
 * Every browser on iOS grows and shrinks the viewport HEIGHT while the user scrolls, because the
 * URL bar slides away and comes back; each step of that animation is a resize, and a ResizeObserver
 * on #view reports it. Measured with the bar's travel simulated on a 390px viewport — twenty
 * height-only steps, width untouched — the fitters ran often enough to rewrite 1054 class
 * attributes, each one a forced synchronous layout of a page the user is scrolling. That is the
 * juddering reported from an iPhone.
 *
 * Nothing a fitter asks is about height: `roomFor()`/`overflows()` compare a table against its
 * column, `fitChrome()` asks whether the menu fits beside the brand, the rail and the density axes
 * change widths. A height-only change cannot alter any of those answers — and the one case that
 * looks like a counter-example is not one: a vertical scrollbar appearing takes WIDTH from the
 * content box, so the observer sees it as the width change it is.
 *
 * Per element, because the roots are observed separately and a dialog can resize while #view does
 * not. The first entry for an element always counts as a change, so nothing is lost at start-up. */
/* bumped whenever an observed root changes WIDTH — the only thing that can change which element
 * scrolls, and therefore what `scroller()` above may cache */
let _resizeSeq = 0;
const _lastWidth = new WeakMap();
function onResize(entries) {
	let widthMoved = false;
	for (const e of entries) {
		/* contentRect, not getBoundingClientRect(): the observer already measured it, and asking
		 * again inside the callback is the forced layout this function exists to avoid. */
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
	 * ResizeObserver in every engine, so a browser that can render this theme at all has it. The
	 * window-resize fallback that used to sit here was worse than nothing anyway — it cannot see a
	 * rail collapse or a layout toggle, which is the pair this file uses an observer FOR. */
	if (!_ro) _ro = new ResizeObserver(onResize);
	_ro.observe(el);
}

/* ---- SCROLL ANCHORING, WHERE THE ENGINE HAS NONE ----
 *
 * A poll tick changes the height of what is ABOVE the reader: a lease expires, a station joins, a
 * section renders one row fewer. An engine with scroll anchoring absorbs that — it moves the scroll
 * offset by the same amount, so the page under the reader does not move. WebKit has none, and it is
 * every browser on iOS: measured on the reporter's own router, `content +133px, +134px, +123px,
 * +108px…` one after another, each next to a `child +1/-1` in a polled section. That is the shaking,
 * and it is not the tall-intermediate problem the rest of this file solves — the height change here
 * is REAL, and simply nobody compensates for it.
 *
 * So this compensates for it, and only when nobody else did. A reference is taken from the elements
 * that survive a poll — the section frames — choosing the one that crosses the top of the viewport,
 * because that is the boundary a reader perceives as "where I am". The fitters run, the reference is
 * read again, and the offset is moved by however far it drifted.
 *
 * WHY THIS IS SAFE ON AN ENGINE THAT DOES ANCHOR, which an earlier attempt got wrong by measuring
 * the wrong thing: the correction is computed from the REFERENCE, not from the scroll offset. An
 * anchoring engine has already put the reference back where it was by the time this reads it — the
 * read forces layout, and the adjustment happens during layout — so the drift is zero and this does
 * nothing at all. Measuring the offset instead reads an anchoring adjustment as a fault and corrects
 * a correction, which is exactly how a previous version made Chromium worse (16 movements, 1827px).
 *
 * It never fights the user: a page at the very top has no offset to give back and is left alone, and
 * a drift under a pixel is rounding rather than movement. */
function anchorRef() {
	/* NOT WHILE THE READER SCROLLS. Every rect read here is a forced layout, and this runs on every
	 * content mutation — i.e. once a second, in the middle of a flick, which is the work iOS holds
	 * the main thread back to avoid. The compensation exists for a page the reader is looking at,
	 * not for one they are already moving; while they scroll there is nothing to keep still. */
	if (scrolling()) return null;
	const frames = document.querySelectorAll('#view .cbi-section, #view > .cbi-section-node, #view > div');
	for (const el of frames) {
		const r = el.getBoundingClientRect();
		/* the frame the viewport's top edge cuts through */
		if (r.top <= 0 && r.bottom > 0) return { el, top: r.top };
	}
	return null;
}
/* THE CORRECTION IS UNCONDITIONAL, AND IT IS A NO-OP WHERE THE ENGINE DOES THE JOB.
 *
 * There used to be a watching phase here: the first three mutations were only measured, and a
 * reference that had held still meant "this engine anchors, never touch the offset again". It was
 * wrong in the way that mattered. WebKit does not anchor, but the drift it leaves is often small —
 * a value grew a line, a row appeared — so three quiet samples were easy to come by, the
 * compensation switched itself off for the life of the document, and the page walked downwards a
 * few pixels at a time, once per poll tick. That is exactly how it was reported: "jerks a little
 * downwards, all the time".
 *
 * Correcting always is safe because the correction is computed from the REFERENCE, not from the
 * scroll offset: an engine that anchors has already put the reference back by the time this reads
 * it — the read forces layout, and the adjustment happens during layout — so the drift is zero and
 * nothing is written. Measuring the OFFSET instead reads an anchoring adjustment as a fault and
 * corrects a correction, which is how an earlier version made Chromium worse (10 movements up to
 * 1616px against 0 without it); that mistake is not in this shape.
 *
 * Two guards remain, and both are about not fighting the reader: a page at the very top has no
 * offset to give back, and a drift under a pixel is rounding rather than movement. */
/* ONCE PER FRAME, AFTER EVERYTHING HAS LANDED — not once per mutation batch.
 *
 * A poll tick does not arrive as one mutation: luci-mod-status fills its sections one after another,
 * and each fill wakes this observer. Correcting on each of them measures a page that is still being
 * written: the reference is read between two batches, the drift is computed against a layout that
 * the next batch immediately invalidates, and the correction is wrong by whatever the rest of the
 * tick brought. The next tick corrects the other way. That is a page that jerks while nobody
 * touches it, and it is what was reported — with a telling detail: it went away whenever a
 * diagnostic probe that forced layout on EVERY frame was loaded, because then every reading this
 * code took happened to be against a settled layout.
 *
 * So the reference is taken at the first mutation of a batch and the correction is applied in a
 * requestAnimationFrame — after the batch, after style and layout have settled, once. A newer
 * reference is not taken while one is pending: the first one is where the reader actually was. */
let _anchorPending = null;
let _anchorFrame = 0;
/* DEV SWITCH, for the device that has the problem: `localStorage.fsAnchor = 'off'` stops the theme
 * from ever writing the scroll offset, which is the one thing here that can move a page nobody is
 * touching. It exists to answer a question a laptop cannot — whether the correction is the cure or
 * the disease — and comes out with the answer. */
function anchorEnabled() {
	try { return localStorage.getItem('fsAnchor') !== 'off'; }
	catch (e) { return true; }
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
	});
}
function applyAnchor(ref) {
	if (!ref || !ref.el.isConnected) return;
	/* through scroller(), not a second probe of its own: the two asked the same question in the
	 * same two lines and could already answer differently within one frame */
	const sc = scroller();
	const at = sc ? sc.scrollTop : window.scrollY;
	if (at <= 0) return;
	const drift = ref.el.getBoundingClientRect().top - ref.top;
	if (Math.abs(drift) < 1) return;
	if (sc) sc.scrollTop = at + drift;
	else window.scrollTo(0, at + drift);
}

/* Rule 2's mutation side. Deliberately NOT filtered by node type: a filter is a second place to
 * get wrong (the table fitter's own once said `table.table`, and LuCI renders most of its tables
 * as DIVs — so the poll never re-measured at all), and run() is a handful of measurements. */
/* THE CONTENT IS IN TWO PLACES, and watching one of them was a bug with a phone screenshot behind it.
 *
 * `ui.showModal` builds its dialog inside `#modal_overlay`, which ui's `__init__` appends to `<body>`
 * beside #view — so a dialog's content mutates NOTHING inside the observed host. A table opened in the
 * wireless scan dialog was therefore measured only if some unrelated mutation in #view happened to
 * run the fitters, and its rows (which that dialog re-renders once a second) were never re-measured
 * at all. Both roots get the same observer and the same ResizeObserver.
 *
 * `require ui` above is what makes the overlay exist by the time this runs: it is created in ui's
 * constructor, and luci-base instantiates a class exactly once, at the first require. */
function observeContent() {
	if (_mo) return;
	_mo = new MutationObserver(() => {
		/* what the reader is looking at, before the poll's mutation and the fitters move anything */
		const ref = anchorRef();
		run();
		scheduleAnchor(ref);
	});
	for (const host of [ document.getElementById('view') || document.body, document.getElementById('modal_overlay') ]) {
		if (!host) continue;
		_mo.observe(host, { childList: true, subtree: true });
		watch(host);
	}
	/* AND THE MOMENT THE DIALOG BECOMES VISIBLE, which no mutation inside it announces: `showModal`
	 * writes the content FIRST and adds `modal-overlay-active` to <body> after, so the pass that the
	 * content mutation triggers still sees a closed dialog (fs-select.js skips one — a hidden overlay
	 * shrink-fits, so it would be measuring a width the dialog will never have). Nothing else changes
	 * afterwards, so without this the dialog's table would wait for its first poll to be fitted. One
	 * attribute, on one element.
	 *
	 * A SECOND OBSERVER, and it has to be one — this is a spec fact, not a preference.
	 * `MutationObserver.observe()` REPLACES the options of an existing registration for the same node,
	 * so calling it here on `document.body` would have silently dropped the `{childList, subtree}`
	 * registration above on any page where `#view` does not exist and `body` IS the content host: the
	 * fitters would then never run on a content mutation again, and nothing would say so.
	 *
	 * Merging the two into one call is the other wrong answer: `subtree: true` plus an attribute
	 * filter wakes `run()` on every class change anywhere in the document, and the poll rewrites
	 * classes on rows once a second. Two observers, one narrow node each, same callback. */
	_moFlag = new MutationObserver(run);
	_moFlag.observe(document.body, { attributes: true, attributeFilter: [ 'class' ] });
}

return baseclass.extend({
	/* Register a fitter and run it once. A fitter selects its own elements, strips its class
	 * (rule 1), measures, re-applies. */
	add(fit) {
		if (typeof fit !== 'function') return;
		_fitters.push(fit);
		observeContent();
		/* Caught for the same reason runAll() catches, and this was the one run that was not: a
		 * fitter that throws on its FIRST run propagated out of add() and out of the theme's init(),
		 * so every registration after it was never made. With the gate already raised that is a page
		 * whose data tables are `display: none` for good — nothing left to write `.fs-fitted`. The
		 * five passes in fs-select.js are registered separately precisely so each fails alone. */
		try { fit(); }
		catch (e) { console.error('fs-fit: a fitter threw on registration', e); }
	},

	/* Is the reader scrolling, and "I could not measure, wake me when they stop". A pass that has to
	 * read layout asks the first and calls the second; a pass that only writes does neither. */
	scrolling,
	deferMeasurement,

	/* Raise the stylesheet's "an unanswered table takes no room" rule. Called by the module that
	 * answers — see armGate above; nothing else may call it. */
	armGate,

	/* Re-fit on the next frame, coalesced. (There is no exported `run`: everything that changes
	 * the available room — the layout toggle, the rail collapse — schedules. Only the mutation
	 * observer re-fits synchronously, and that is rule 2's whole point.) */
	schedule,

	/* Coalesce ANY callback into one call per frame (rule 3, for non-fitters): schedule() runs
	 * EVERY fitter, so a caller wanting only its own work batched cannot use it — three had
	 * hand-rolled the identical five lines. NOT for the per-element case: menu-footstrap.js's
	 * clamp keeps a rAF handle per <li> so it can CANCEL a pending measure, which a one-flag
	 * coalescer cannot express. */
	frame(fn) {
		let pending = false;
		return () => {
			if (pending) return;
			pending = true;
			requestAnimationFrame(() => { pending = false; fn(); });
		};
	},

	/* Did this batch add anything matching `sel`? The poll rewrites content once a second, so a
	 * MutationObserver here needs that cheap question before its document-wide queries. */
	touches(mutations, sel) {
		for (const m of mutations)
			for (const n of m.addedNodes) {
				if (n.nodeType !== 1) continue;
				if (n.matches(sel) || n.querySelector(sel)) return true;
			}
		return false;
	},

	/* Room for `el` = its PARENT's content box. Measuring against ITSELF does not work: a
	 * `display: table` box with width:100% still grows past it when min-content needs more (auto
	 * layout beats the declared width), so scrollWidth and clientWidth grow together and the
	 * overflow is invisible. The parent is an ordinary block and does not grow. */
	roomFor(el) {
		const p = el && el.parentElement;
		if (!p) return Infinity;
		const cs = getComputedStyle(p);
		return p.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
	},

	/* Does `el` need more width than it has been given?
	 *
	 * THE ONE QUESTION LEFT, and it is the browser's own answer. `wordFloor()` and `textLines()`
	 * used to stand beside it — a canvas reimplementation of min-content and a line counter — and
	 * both existed only because the stylesheet lowered every cell's min-content to one character,
	 * so a starved column produced no overflow for this to read. theme/30-tables.css gives a data
	 * table an honest floor for as long as it is a table, so the starvation cannot happen and the
	 * reconstructions are gone: 75 lines of approximation (whitespace-split words, one font per
	 * column, `iiii` ranked above `WWW`) that cost about 1 ms per pass on a 114-row table and, on
	 * `WPA2-PSK/CCMP`, claimed 144px where the engine's own floor is 93. */
	overflows(el) {
		return el.scrollWidth > this.roomFor(el) + 1;	/* +1: sub-pixel rounding */
	}

});
