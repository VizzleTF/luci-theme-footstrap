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

const _fitters = [];
let _rafPending = false;
let _ro = null, _mo = null, _moFlag = null;

/* Run every fitter NOW, synchronously. A fitter must be idempotent — this fires on every
 * relevant mutation. */
function run() {
	for (const fit of _fitters) {
		try { fit(); }
		/* one broken fitter must take neither the others nor the poll's MutationObserver
		 * callback with it — that would silently stop ALL re-fitting */
		catch (e) { console.error('fs-fit: a fitter threw', e); }
	}
}

/* Next frame, at most once per frame (rule 3). */
function schedule() {
	if (_rafPending) return;
	_rafPending = true;
	requestAnimationFrame(() => { _rafPending = false; run(); });
}

/* Watch an element's size. Any change re-fits everything — the fitters are cheap and few. */
function watch(el) {
	if (!el) return;
	/* No feature test: the shipped CSS needs :has() and container queries, both years younger than
	 * ResizeObserver in every engine, so a browser that can render this theme at all has it. The
	 * window-resize fallback that used to sit here was worse than nothing anyway — it cannot see a
	 * rail collapse or a layout toggle, which is the pair this file uses an observer FOR. */
	if (!_ro) _ro = new ResizeObserver(schedule);
	_ro.observe(el);
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
	_mo = new MutationObserver(run);
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
		fit();
	},

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
