'use strict';
'require baseclass';

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
let _ro = null, _mo = null;
/* one canvas for the whole document: wordFloor() measures text with it, and creating one per call
 * is the expensive half of that measurement */
let _cx = null;
const SPACE_RE = /\s+/;

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
function observeContent() {
	if (_mo) return;
	const host = document.getElementById('view') || document.body;
	_mo = new MutationObserver(run);
	_mo.observe(host, { childList: true, subtree: true });
	watch(host);
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

	/* Does `el` need more width than it has been given? */
	overflows(el) {
		return el.scrollWidth > this.roomFor(el) + 1;	/* +1: sub-pixel rounding */
	},

	/* THE NARROWEST THIS TABLE CAN BE WITHOUT BREAKING A WORD THROUGH — its own breakpoint, in px.
	 *
	 * Every other "does it fit" question here is asked of the browser. This one cannot be: it is
	 * exactly the table's min-content width, and `overflow-wrap: anywhere` (base/40-tables.css) makes
	 * the browser answer ONE CHARACTER per column. That is deliberate — an unbreakable ICCID must not
	 * push a table nobody measures out of its card — but it means a measured table can be starved to
	 * a ribbon of fragments and still report, truthfully, that it fits. Asking the engine the honest
	 * question by flipping `overflow-wrap` for one layout does not work either: Blink returns the same
	 * min-content for `normal`, `break-word` and `anywhere` on a table (measured — 645px in all three,
	 * with the widest word alone needing 367), so the number simply is not available from layout.
	 *
	 * So compute it: per COLUMN, the width of the widest WORD any of its cells has to show, plus that
	 * cell's own side padding; summed across columns. A `nowrap`/`pre` column takes its whole text
	 * instead, because that is what it has committed to showing. Nothing here is a threshold — the
	 * result is the table's content measured in the table's own fonts, so every table gets its own
	 * number and none was picked by anyone.
	 *
	 * Two approximations, both stated rather than hidden:
	 *  - the FONT is sampled once per column, from the first data row. A column that changes face
	 *    row by row would be measured in the first row's; no LuCI table does that, and the
	 *    alternative is a `getComputedStyle` per cell, which is the expensive call here.
	 *  - the widest word is picked by CHARACTER COUNT and only that one is measured, so a column of
	 *    one font is one `measureText` per new maximum instead of one per cell. Within a single font
	 *    that ranks `iiii` above `WWW`; it costs a few px on the floor and takes the walk over
	 *    Processes (114 rows) from 6ms to about 1ms.
	 *
	 * A `colSpan` cell contributes its whole floor to one column, which over-states that column and
	 * under-states its neighbours by the same amount — the sum, which is what the caller compares, is
	 * unaffected. */
	wordFloor(t) {
		const rows = t.querySelectorAll('.tr:not(.table-titles):not(.cbi-section-table-titles):not(.placeholder)');
		if (!rows.length) return 0;
		if (!_cx) _cx = document.createElement('canvas').getContext('2d');
		const floors = [], longest = [];
		let cols = null;
		for (const row of rows) {
			const cells = row.children;
			if (!cols) {
				cols = [];
				for (const c of cells) {
					const s = getComputedStyle(c);
					cols.push({
						font: `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`,
						tracking: parseFloat(s.letterSpacing) || 0,
						pad: parseFloat(s.paddingLeft) + parseFloat(s.paddingRight),
						whole: (s.whiteSpace === 'nowrap' || s.whiteSpace === 'pre')
					});
				}
			}
			for (let i = 0; i < cells.length; i++) {
				const text = (cells[i].textContent || '').trim();
				if (!text) continue;
				const col = cols[i] || cols[cols.length - 1];
				let word = '';
				if (col.whole) word = text;
				else for (const w of text.split(SPACE_RE)) if (w.length > word.length) word = w;
				if (!(word.length > (longest[i] || 0))) continue;
				longest[i] = word.length;
				_cx.font = col.font;
				const need = _cx.measureText(word).width + (col.tracking * word.length) + col.pad;
				if (!(floors[i] >= need)) floors[i] = need;
			}
		}
		let sum = 0;
		for (const f of floors) sum += (f || 0);
		return sum;
	},

	/* How many LINE BOXES of text does `el` render? The fact behind "this column has been
	 * squeezed into a tower" — a cell that has to break its own words is a column that has run
	 * out of width, which is a thing no viewport query can ask.
	 *
	 * NOT height / line-height: the assoclist's first cell is an `.ifacebadge`, a flex COLUMN
	 * with a 32px icon over the text, so a third of that height is not text at all. Ranges over
	 * the TEXT NODES only, so an <img> cannot be counted as a line.
	 *
	 * Cluster by the rect's TOP, not by vertical overlap: consecutive lines OVERLAP. Measured on
	 * the router — tops 15-16px apart while each rect is 17-18px tall (the font's box is taller
	 * than the line advance), so an overlap test merged an 8-line tower into ONE line and the
	 * whole check silently never fired. Half a line of tolerance also merges what belongs on one
	 * line: a `<small>` shares the baseline but sits a few px lower, and is not a new line. */
	textLines(el) {
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		const range = document.createRange();
		const rects = [];
		for (let n; (n = walker.nextNode());) {
			if (!n.nodeValue.trim()) continue;
			range.selectNodeContents(n);
			for (const r of range.getClientRects())
				if (r.width > 0.5 && r.height > 0.5) rects.push(r);
		}
		rects.sort((a, b) => a.top - b.top);
		let lines = 0, top = -Infinity;
		for (const r of rects)
			if (r.top - top > r.height * 0.5) { lines++; top = r.top; }
		return lines;
	}
});
