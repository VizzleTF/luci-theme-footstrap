'use strict';
'require baseclass';

/* fs-fit — the theme's ONE "does it still fit?" engine.
 *
 * Several places in this theme must decide something no CSS query can ask, because the
 * answer depends on what the CONTENT needs rather than on how wide the screen is:
 *
 *   - the top bar   — does the menu fit beside the brand, or must it take its own row?
 *                     (a stock router renders 5 sections; a box with a few luci-app-*
 *                     renders eleven)
 *   - a data table  — is there still room to read it as a table, or must it become cards?
 *                     (the DHCP leases carry 8 nowrap mono columns; another table has 3)
 *
 * Every one of these was once written as a breakpoint — `@media (max-width: 1199px)` for
 * the bar, and FIVE different `@container` thresholds for the tables — and every one of
 * those numbers was a guess that some real router got wrong. A media or container query can
 * only measure the VIEWPORT or the CONTAINER; it can never know what the content needs. So
 * the numbers drifted apart, the rules had to be copied under each of them, and a table
 * from a third-party luci-app-*, whose column count we cannot know, was never going to be
 * handled correctly by any of them.
 *
 * The shape of the answer is always identical: measure the element in its UNCOLLAPSED
 * state, then toggle a class. So the measuring, the scheduling and the observers live here
 * once, and a caller supplies only the decision.
 *
 * THREE RULES THE ENGINE EXISTS TO ENFORCE. Each is a bug that was actually hit:
 *
 *  1. MEASURE UNCOLLAPSED. A collapsed thing always "fits" — a stacked table is a pile of
 *     flex rows, a wrapped menu has a whole row to itself. Measure it as it stands and you
 *     un-collapse it; the next frame collapses it again. That is a layout oscillation, and
 *     it is why every fitter must strip its class BEFORE reading.
 *
 *  2. RE-FIT SYNCHRONOUSLY ON A MUTATION. LuCI's poll re-renders page content once a second
 *     and the fresh element comes back WITHOUT our class. A MutationObserver callback is a
 *     microtask: it runs after the mutation but BEFORE the frame is painted, so re-fitting
 *     there is invisible. Deferring it to requestAnimationFrame — which runs at paint time —
 *     let a stacked table paint one frame at full width and overflow its section, on every
 *     single tick. Measured: 19-109px of overflow, once a second, on Firewall/DHCP/Wireless.
 *
 *  3. COALESCE ON RESIZE. Dragging a window edge produces dozens of callbacks a second, and
 *     every fit forces a synchronous layout. Resize-driven runs are batched into one frame.
 *
 * WHY A ResizeObserver AND NOT window.onresize: the content column also changes width when
 * the sidebar collapses to its icon rail, and when the layout is toggled between the sidebar
 * and the top bar. Neither of those resizes the window.
 */

const _fitters = [];
let _rafPending = false;
let _ro = null, _mo = null;

/* Run every registered fitter NOW, synchronously. Each one measures and may write a class;
 * a fitter must be idempotent, because this is called on every relevant mutation. */
function run() {
	for (const fit of _fitters) {
		try { fit(); }
		/* one broken fitter must not take the others — and must not take the poll's
		 * MutationObserver callback with it, which would silently stop ALL re-fitting */
		catch (e) { console.error('fs-fit: a fitter threw', e); }
	}
}

/* Run on the next frame, at most once per frame (see rule 3). */
function schedule() {
	if (_rafPending) return;
	_rafPending = true;
	requestAnimationFrame(() => { _rafPending = false; run(); });
}

/* Watch an element's size. Any change re-fits everything — the fitters are cheap and few,
 * and which of them a given box affects is not worth tracking. */
function watch(el) {
	if (!el) return;
	if (!_ro) {
		if (!window.ResizeObserver) {			/* no RO: fall back to the window */
			window.addEventListener('resize', schedule);
			return;
		}
		_ro = new ResizeObserver(schedule);
	}
	_ro.observe(el);
}

/* The mutation side of rule 2: LuCI re-renders content under #view, and a fresh element
 * arrives without whatever class a fitter had put on it. Observe once, run synchronously.
 *
 * Deliberately NOT filtered by node type. A filter here is a second place to get wrong (the
 * table fitter's own filter used to say `table.table`, and LuCI renders most of its tables
 * as DIVs — so the poll never triggered a re-measure at all), and run() is a handful of
 * measurements over a handful of elements. The guard that matters is that fitters are cheap
 * and idempotent, not that the observer is clever. */
function observeContent() {
	if (_mo) return;
	const host = document.getElementById('view') || document.body;
	_mo = new MutationObserver(run);
	_mo.observe(host, { childList: true, subtree: true });
	watch(host);
}

return baseclass.extend({
	/* Register a fitter and run it once. A fitter is `() => void`: it selects its own
	 * elements, strips its class (rule 1), measures, and re-applies the class if needed. */
	add(fit) {
		if (typeof fit !== 'function') return;
		_fitters.push(fit);
		observeContent();
		fit();
	},

	/* Re-fit now, synchronously — call this from a place that has just changed the room
	 * available to something (the layout toggle, the icon-rail collapse). */
	run,

	/* Re-fit on the next frame, coalesced. */
	schedule,

	/* Also watch this element's size (beyond #view, which is watched automatically). */
	watch,

	/* The measurement every fitter in this theme has needed so far: how much room does this
	 * element actually have? Its PARENT's content box.
	 *
	 * Measuring an element against ITSELF does not work, and getting that wrong is what made
	 * the table fitter look broken on its first outing: a `display: table` box with
	 * `width: 100%` still grows past that width when its min-content needs more (auto table
	 * layout beats the declared width), so scrollWidth and clientWidth grow together and the
	 * overflow is invisible. The parent is an ordinary block and does not grow — it is the
	 * honest ruler. */
	roomFor(el) {
		const p = el && el.parentElement;
		if (!p) return Infinity;
		const cs = getComputedStyle(p);
		return p.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
	},

	/* Does `el` need more width than it has been given? */
	overflows(el) {
		return el.scrollWidth > this.roomFor(el) + 1;	/* +1: sub-pixel rounding */
	}
});
