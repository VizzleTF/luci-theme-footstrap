#!/usr/bin/env node
/* The reader's place, on an engine that will not keep it.
 *
 * A poll tick changes the height of things above the reader and the page below moves. The engines
 * hide that with scroll anchoring of their own (docs/anchoring.md, `ENGINE_ANCHORS`) except an
 * older WebKit, and a current one can still get the collapse case wrong; fs-fit.js covers it.
 * Cells: held (growth, correction forced on), floor (correction off), swapped (a body emptied and
 * refilled), not twice (engine alone), quiet (no correction mid-flick), tick (a REAL tick, reader
 * parked), repeat (three refills; the trust flag). Growth is inserted, not waited for, except in
 * tick. Why each exists, with numbers: docs/anchoring-log.md, "Gate details moved out of
 * `tools/scroll-anchor.mjs`".
 *
 *   node tools/scroll-anchor.mjs [--only owrt2512] [--all] [--engines chromium,firefox] [--full|--bail]
 *   … [--width 390] [--layout top]   one cell
 *   … [--quick] [--page <name>] [--no-pair]
 * Needs a running owlab router (docs/development.md). */
import * as pw from 'playwright';
import { stands, login, requireStands, sealToRouter, pairStands, eachStand, reportDown } from './lib/stands.mjs';
import { parseFlags } from './lib/util.mjs';

const FLAGS = parseFlags('scroll-anchor', {
	engines: { type: 'string', default: 'chromium' }, full: { type: 'boolean', default: false },
	bail: { type: 'boolean', default: false }, quick: { type: 'boolean', default: false },
	page: { type: 'string' }, width: { type: 'string', default: '' }, layout: { type: 'string', default: '' },
	only: { type: 'string', default: '' }, all: { type: 'boolean', default: false },
	'no-pair': { type: 'boolean', default: false },
});
const ENGINES = FLAGS.engines.split(',').map((s) => s.trim()).filter(Boolean);
/* `--full` restores the axes this sweep used to cross in full: every width against every layout,
 * and all three densities. Measured on 132 cells, they multiply the sweep without dividing its
 * answers — see SCROLLERS and DENSITIES. CI crosses them on a push and a tag, where an hour is
 * affordable and a narrowing that turns out to be wrong is caught before a release. */
const FULL = FLAGS.full;
/* Stop at the first finding. A full sweep is 144 cells and tens of minutes, so an answer that only
 * arrives at the end is one nobody can iterate against — a fix attempt cost a whole sweep to learn
 * it had failed in the third cell. CI never passes this: how WIDE a fault is is half of what the
 * sweep says. */
const BAIL = FLAGS.bail;
/* A local iteration loop, not the sweep CI runs: the first stand only, the Overview page alone, the
 * default width/layout/density axes. Says what it left out on every run, loudly,
 * so a clean `--quick` is never mistaken for a clean sweep — the same reason a page that never
 * opened is reported apart from a pass rather than folded into one. `--only`/`--page` still override
 * when given explicitly; CI never sets this flag. */
const QUICK = FLAGS.quick;

/* Three page shapes, because the shape decides what the theme can anchor ON: overview (section
 * bodies a poll refills; the only page where a refilled block sits entirely above the reader, so
 * `swapped` is measured here alone), dhcp (a polled table's ROWS, the shape a third-party app most
 * likely emits) and processes (one table directly under `#view`: it proves the climb, never the
 * swap). wireless and connections were measured and dropped as not repeatable; the numbers are in
 * docs/anchoring-log.md. `--page a,b` overrides. */
/* No parseArgs `default:` here: it depends on QUICK, which parseArgs cannot express. */
const PAGES = (FLAGS.page ?? (QUICK ? '/admin/status/overview'
	: '/admin/status/overview,/admin/network/dhcp,/admin/status/processes'))
	.split(',').map((p) => p.trim()).filter(Boolean);

/* WIDTH AND LAYOUT ARE ONE AXIS FOR HOLD/SWAP/QUIET, with two values: they measure which element
 * the correction scrolls, and only 1440 side scrolls anything but the window. `tick` does not fit
 * the reduction: 390 side and 390 top scroll the same window yet WebKit's own anchoring misfires
 * on one only (0px against 41px peak-to-peak on one real tick, owrt2512/Overview), so `top` stays
 * in the default axis for that case rather than only under `--full`. */
const SCROLLERS = (() => {
	const all = FULL
		? [ 1440, 390 ].flatMap((width) => [ 'side', 'top' ].map((layout) => ({ width, layout })))
		: [ { width: 1440, layout: 'side' }, { width: 390, layout: 'side' }, { width: 390, layout: 'top' } ];
	/* `--width 390 --layout top` narrows the sweep to the cell a finding names, which is what turns
	 * a fix attempt from a sweep into a minute. Neither is set in CI, where the axes above are the
	 * contract. */
	const w = FLAGS.width, l = FLAGS.layout;
	return all.filter((c) => (!w || String(c.width) === w) && (!l || c.layout === l));
})();

/* One density. The axis moves the geometry — type and spacing scale, so a section is a different
 * height and the fold falls elsewhere — but it does not move the ANSWER: across all 72 Overview
 * cells of a full sweep, normal, compact and large reported the same two outcomes and nothing else
 * (`anchor on` clamped 0-1px with the reader still; `anchor off` clamped 59-60px with the reader
 * moved 60-61px). Three densities measured one thing three times, so the axis is FULL alone. */
const DENSITIES = FULL ? [ 'normal', 'compact', 'large' ] : [ 'normal' ];
const GROWTH = 120;
/* a rect edge lands on a fraction; two pixels is not a jump */
const TOLERANCE = 2;
/* how many REAL poll ticks TICK insists on before it will trust a 0px reading — see the note on
 * TICK below for why fewer would pass a fault this gate exists to catch */
const TICK_COUNT = 3;
/* How late a correction may land before the drift is itself a finding, apart from SWAP never
 * seeing one. The theme's own fallback lands 7-36ms after a refill; `lateDrift()` (fs-fit.js)
 * answers on the next frame when the page was already still (8-61ms) and waits out a moving reader
 * otherwise (404-422ms). 200ms sits between with over 150ms of headroom either side. */
const LATE_MS = 200;
/* How long SWAP watches a refill before a correction "never came": past `lateDrift()`'s slow path
 * (404-422ms, the reader in motion) with margin for a loaded runner. Not shortened to match the
 * faster path: it must outlast the SLOWEST legitimate correction, or "late" and "never" read alike. */
const SWAP_WINDOW = 900;
/* How many refills REPEAT performs on the SAME section (see its note). `LATE_MISS_LIMIT`
 * (fs-fit.js) is 2: the second refill reaches the limit, the third proves the flag it trips stays
 * tripped (or, on an engine anchoring correctly, never trips) rather than resetting on the next tick. */
const REPEAT_TIMES = 3;

/* Park the reader and wait for the THEME to notice, not for a stopwatch: fs-fit treats the reader
 * as moving until SCROLL_IDLE (400 ms) of stillness and only then takes the reference every
 * correction is measured against. A flat wait is a race WebKit loses — a programmatic `scrollTop`
 * write there fires `scroll` up to 1.2 s late — so the wait is on the EVENT, then on the idle
 * window, both bounded. */

/* Runs in the page: park the reader, grow something above them, report what they saw. The poll is
 * held here too: a tick refills the section the reader is over, and the element this probe
 * measures by is gone before the second read (`the reader's element was replaced
 * mid-measurement`, webkit/Overview at 1440 side). The growth is synthetic either way. */
/* BELOW — content arriving UNDER the reader must not move them. Every other case grows content
 * above the reader, so a theme that scrolls the reader for growth below passed them all (0f298ef:
 * a 120 px refill in a floored box below the viewport moved the offset +120 and the reader -120 on
 * firefox and chromium, engine anchoring on). The pad goes INSIDE the floored box, a child deep,
 * the shape a LuCI refill has. */
const BELOW = async (growth) => {
	const wait = (ms) => new Promise((r) => setTimeout(r, ms));
	const view = document.getElementById('view');
	if (!view || !view.firstElementChild) return { skip: 'nothing to grow' };
	const mc = document.getElementById('maincontent');
	const flow = mc ? getComputedStyle(mc).overflowY : '';
	const sc = (flow === 'auto' || flow === 'scroll') ? mc : null;
	const pos = () => (sc ? sc.scrollTop : window.scrollY);
	const vh = sc ? sc.clientHeight : window.innerHeight;

	const room = (sc ? sc.scrollHeight - sc.clientHeight : document.documentElement.scrollHeight - window.innerHeight);
	if (room < 600) return { skip: 'page too short to scroll' };
	const poll = (window.L && window.L.Poll) || null;
	if (poll && typeof poll.active === 'function' && poll.active()) poll.stop();

	const at = Math.round(room * 0.25);
	const target = sc || window;
	const landed = new Promise((res) => {
		let done = false;
		const on = () => { if (!done) { done = true; target.removeEventListener('scroll', on); res(); } };
		target.addEventListener('scroll', on, { passive: true });
		setTimeout(() => { if (!done) { done = true; target.removeEventListener('scroll', on); res(); } }, 2500);
	});
	if (sc) sc.scrollTop = at; else window.scrollTo(0, at);
	await landed;
	const fit = await window.L.require('fs-fit').then((m) => m, () => null);
	if (fit && typeof fit.restAt === 'function')
		for (let i = 0; i < 160; i++) { if (fit.restAt() === pos() && !fit.scrolling()) break; await wait(25); }
	await wait(600);

	/* a floored box entirely below the viewport, the kind a poll refills */
	const scTop = sc ? sc.getBoundingClientRect().top : 0;
	const box = Array.from(view.querySelectorAll('[data-fs-floor]'))
		.find((b) => b.getBoundingClientRect().top - scTop > vh + 40 && b.offsetHeight > 60);
	if (!box) return { skip: 'no floored box below the reader' };

	const markAt = (y, x) => {
		for (const el of document.elementsFromPoint(x, y)) {
			if (el === view || !view.contains(el) || box.contains(el)) continue;
			let stuck = false;
			for (let a = el; a && a !== view; a = a.parentElement)
				if (getComputedStyle(a).position === 'sticky') { stuck = true; break; }
			if (!stuck) return el;
		}
		return null;
	};
	const h = window.innerHeight || 800;
	const vw = window.innerWidth || 800;
	let mark = null;
	for (const fy of [ 0.5, 0.4, 0.6, 0.3 ]) {
		for (const fx of [ 0.5, 0.25, 0.75 ]) {
			mark = markAt(Math.round(h * fy), Math.round(vw * fx));
			if (mark) break;
		}
		if (mark) break;
	}
	if (!mark) return { skip: 'no content under the reader' };
	const before = { pos: pos(), top: Math.round(mark.getBoundingClientRect().top) };

	const w0 = (window.__fsW || []).length;
	const pad = document.createElement('div');
	pad.style.height = growth + 'px';
	(box.firstElementChild || box).appendChild(pad);
	await wait(1200);

	const after = { pos: pos(), top: mark.isConnected ? Math.round(mark.getBoundingClientRect().top) : null };
	const writes = (window.__fsW || []).slice(w0);
	pad.remove();
	return { before, after, moved: after.top === null ? null : after.top - before.top,
		scrollDelta: after.pos - before.pos, boxDesc: box.id || box.className || box.tagName, writes };
};

const HOLD = async (growth) => {
	const wait = (ms) => new Promise((r) => setTimeout(r, ms));
	const view = document.getElementById('view');
	/* A page that rendered at all, not one that rendered a particular way. Counting `#view`'s children
	 * was a stand-in for that and got it wrong: the realtime Connections page puts everything inside a
	 * single `.cbi-map`, so one child meant 3219px of content read as an empty page and every cell of
	 * that shape skipped. What "nothing to grow" has to mean is that there is nothing under `#view`;
	 * whether there is enough of it to scroll is the next check's question, and it asks it in pixels. */
	if (!view || !view.firstElementChild) return { skip: 'nothing to grow' };
	const mc = document.getElementById('maincontent');
	const flow = mc ? getComputedStyle(mc).overflowY : '';
	const sc = (flow === 'auto' || flow === 'scroll') ? mc : null;
	const pos = () => (sc ? sc.scrollTop : window.scrollY);

	const room = (sc ? sc.scrollHeight - sc.clientHeight : document.documentElement.scrollHeight - window.innerHeight);
	if (room < 600) return { skip: 'page too short to scroll' };
	const poll = (window.L && window.L.Poll) || null;
	const polling = !!(poll && typeof poll.active === 'function' && poll.active());
	if (polling) poll.stop();
	/* the poll stays stopped — see the note on QUIET, which starts it again */
	const at = Math.min(Math.round(room / 2), 1600);
	/* park the reader and wait for the ENGINE to say the scroll happened — see the note above */
	const parkAt = async (y) => {
		const target = sc || window;
		const landed = new Promise((res) => {
			let done = false;
			const on = () => { if (!done) { done = true; target.removeEventListener('scroll', on); res(); } };
			target.addEventListener('scroll', on, { passive: true });
			setTimeout(() => { if (!done) { done = true; target.removeEventListener('scroll', on); res(); } }, 2500);
		});
		if (sc) sc.scrollTop = y; else window.scrollTo(0, y);
		await landed;
		/* AND THEN UNTIL THE THEME SAYS IT IS STILL, which is not the same as SCROLL_IDLE elapsing.
		 * fs-fit starts its motion sampler on the scroll event and only remembers where the page
		 * stands once that sampler has been quiet for SCROLL_IDLE; in WebKit the sampler starts late
		 * enough that a flat wait measured the theme before it had a reference at all — the gate then
		 * reported a jump on every WebKit run and none on the other two engines, with the theme
		 * identical. Asking the theme removes the guess: `scrolling` is exported for exactly this
		 * kind of question. */
		const fit = await window.L.require('fs-fit').then((m) => m, () => null);
		/* A theme that answers but cannot say where it rested is a FAILURE, not a fallback. This
		 * used to be one try/catch around both, so a stripped export threw a TypeError that read as
		 * "no theme here" and the sweep quietly went back to the flat wait below — which is the
		 * WebKit flake this call exists to remove, and it measured nothing while saying nothing. */
		if (fit && typeof fit.restAt !== 'function')
			throw new Error('fs-fit is loaded but exports no restAt(): the sweep cannot tell when '
				+ 'the theme has taken its reference, and a flat wait is not a substitute');
		if (fit) {
			/* until the theme has taken a reference AT THIS OFFSET. "Is it scrolling" cannot answer
			 * that: it says no both before the motion sampler starts and after it finishes, and in
			 * WebKit those are 1.5s apart — the probe grew the page in between, while the theme still
			 * had no reference, and the gate reported a jump on every WebKit run and none on the
			 * other two engines with the theme identical on all three. */
			for (let i = 0; i < 160; i++) {
				if (fit.restAt() === (sc ? sc.scrollTop : window.scrollY) && !fit.scrolling()) break;
				await wait(25);
			}
		}
		await wait(600);		/* the still moment the theme measures from */
	};
	await parkAt(at);

	/* The host is not a mark: `#view` is a `.cbi-section` gap wide enough to hit at 390px and its own
	 * top does not move when the pad grows INSIDE it, so a compensated page reads -120px. The whole
	 * STACK at the point is read, plus two more rows (a gap is a gap only at its y). `position:
	 * sticky` is excluded the same way: its rect.top stays pinned while stuck, so it stops tracking
	 * the reader. The walk climbs to `view` because a child of a stuck header inherits the pin. */
	const markAt = (y, x) => {
		for (const el of document.elementsFromPoint(x, y)) {
			if (el === view || !view.contains(el)) continue;
			let stuck = false;
			for (let a = el; a && a !== view; a = a.parentElement)
				if (getComputedStyle(a).position === 'sticky') { stuck = true; break; }
			if (!stuck) return el;
		}
		return null;
	};
	/* THE HIT IS TRIED ACROSS THE VIEWPORT, not at three points down its middle: a mark is anything
	 * inside #view, and on 25.12's Overview the middle column is a grid gap for most of its height,
	 * so all three of those points answered `#view` and every run on that release reported "no
	 * content under the reader" and measured nothing — half the matrix, silently unmeasured. */
	const h = window.innerHeight || 800;
	const vw = window.innerWidth || 800;
	let mark = null;
	for (const fy of [ 0.6, 0.5, 0.7, 0.4, 0.8, 0.35 ]) {
		for (const fx of [ 0.5, 0.25, 0.75 ]) {
			mark = markAt(Math.round(h * fy), Math.round(vw * fx));
			if (mark) break;
		}
		if (mark) break;
	}
	if (!mark) return { skip: 'no content under the reader' };
	const before = { pos: pos(), top: Math.round(mark.getBoundingClientRect().top) };

	/* Sliced from HERE, not from navigation: the writes `parkAt()` made to reach this offset are not
	 * this measurement's business. `window.__fsW` wraps `scrollTo`/`scrollBy`, the `scrollTop` setter
	 * and `Element.scrollTo`, and is read back only for a finding: it tells a mark that reached the
	 * viewport top (-505px, firefox owrt2512 @1440 top compact) from a failed correction. */
	const w0 = (window.__fsW || []).length;
	const pad = document.createElement('div');
	pad.style.height = growth + 'px';
	view.insertBefore(pad, view.firstChild);
	await wait(800);

	const after = { pos: pos(), top: mark.isConnected ? Math.round(mark.getBoundingClientRect().top) : null };
	const writes = (window.__fsW || []).slice(w0);
	pad.remove();
	return { before, after, moved: after.top === null ? null : after.top - before.top,
		scrollDelta: after.pos - before.pos, scroller: sc ? 'maincontent' : 'window', writes };

};

/* Runs in the page: a poll tick the way LuCI actually performs one — `dom.content()` empties the
 * section before it refills it — and reports where that left the reader.
 *
 * Not the HOLD case above: HOLD inserts a pad, so the page only ever gets TALLER and the reference
 * the theme keeps stays valid. A real tick passes through a moment where the section has no height
 * at all, and a document that short is one the engine clamps the offset into; the section fills
 * again, nobody puts the offset back, and the reader is somewhere else. */
const SWAP = async ([ growth, tol, winMs ]) => {
	const wait = (ms) => new Promise((r) => setTimeout(r, ms));
	const view = document.getElementById('view');
	if (!view) return { skip: 'no view' };
	const mc = document.getElementById('maincontent');
	const flow = mc ? getComputedStyle(mc).overflowY : '';
	const sc = (flow === 'auto' || flow === 'scroll') ? mc : null;
	const pos = () => (sc ? sc.scrollTop : window.scrollY);
	const room = (sc ? sc.scrollHeight - sc.clientHeight : document.documentElement.scrollHeight - window.innerHeight);
	if (room < 600) return { skip: 'page too short to scroll' };

	/* The router's own poll is held for the duration, which is what makes this a measurement rather
	 * than a coin toss: this case performs a tick BY HAND, to control when the container is empty,
	 * and a real tick landing in the same window rewrites the very section being swapped. Measured
	 * before it was stopped, the same router and width reported 689px, 577px and 0px on three
	 * consecutive runs. HOLD holds it too, for the reference rather than the pad — see the note there.
	 * QUIET only inserts a pad of its own, so a tick underneath it is noise it survives. */
	const poll = (window.L && window.L.Poll) || null;
	const polling = !!(poll && typeof poll.active === 'function' && poll.active());
	if (polling) poll.stop();
	/* the poll stays stopped — see the note on QUIET, which starts it again */

	/* as far down as the page goes: what the reader loses to a clamp is what is left below them */
	const at = room - 60;
	/* park the reader and wait for the ENGINE to say the scroll happened — see the note above */
	const parkAt = async (y) => {
		const target = sc || window;
		const landed = new Promise((res) => {
			let done = false;
			const on = () => { if (!done) { done = true; target.removeEventListener('scroll', on); res(); } };
			target.addEventListener('scroll', on, { passive: true });
			setTimeout(() => { if (!done) { done = true; target.removeEventListener('scroll', on); res(); } }, 2500);
		});
		if (sc) sc.scrollTop = y; else window.scrollTo(0, y);
		await landed;
		/* AND THEN UNTIL THE THEME SAYS IT IS STILL, which is not the same as SCROLL_IDLE elapsing.
		 * fs-fit starts its motion sampler on the scroll event and only remembers where the page
		 * stands once that sampler has been quiet for SCROLL_IDLE; in WebKit the sampler starts late
		 * enough that a flat wait measured the theme before it had a reference at all — the gate then
		 * reported a jump on every WebKit run and none on the other two engines, with the theme
		 * identical. Asking the theme removes the guess: `scrolling` is exported for exactly this
		 * kind of question. */
		const fit = await window.L.require('fs-fit').then((m) => m, () => null);
		/* A theme that answers but cannot say where it rested is a FAILURE, not a fallback. This
		 * used to be one try/catch around both, so a stripped export threw a TypeError that read as
		 * "no theme here" and the sweep quietly went back to the flat wait below — which is the
		 * WebKit flake this call exists to remove, and it measured nothing while saying nothing. */
		if (fit && typeof fit.restAt !== 'function')
			throw new Error('fs-fit is loaded but exports no restAt(): the sweep cannot tell when '
				+ 'the theme has taken its reference, and a flat wait is not a substitute');
		if (fit) {
			/* until the theme has taken a reference AT THIS OFFSET. "Is it scrolling" cannot answer
			 * that: it says no both before the motion sampler starts and after it finishes, and in
			 * WebKit those are 1.5s apart — the probe grew the page in between, while the theme still
			 * had no reference, and the gate reported a jump on every WebKit run and none on the
			 * other two engines with the theme identical on all three. */
			for (let i = 0; i < 160; i++) {
				if (fit.restAt() === (sc ? sc.scrollTop : window.scrollY) && !fit.scrolling()) break;
				await wait(25);
			}
		}
		await wait(600);		/* the still moment the theme measures from */
	};
	await parkAt(at);

	/* The tallest section body ENTIRELY ABOVE the viewport: tall, because the clamp only bites when
	 * the swap takes away more than the room below the reader; above, because a section straddling
	 * the fold is one the theme anchors inside, where growth below the anchor is meant to move. It is
	 * what a poll replaces, not one page's idea of it: tables refresh by replacing their rows, the
	 * same collapse with a different parent, so `.cbi-section > div` alone measured Overview only. */
	let body = null;
	/* What a poll replaces, and nothing wider. `:scope > div` also matches `.fs-ovl`, which would
	 * delete three whole sections at once and take the theme's reference with them; the stock poll
	 * refreshes a section's BODY, a table, a table's body (`dom.content()`). `.cbi-section-descr` is
	 * excluded too: static text appended once, never replaced by a tick (121px of movement reported
	 * on firefox and webkit, DHCP at 1440 with the top bar). */
	for (const el of view.querySelectorAll('.cbi-section > div:not(.cbi-section-descr), .table > .tbody, .table')) {
		if (el.getBoundingClientRect().bottom > 0) continue;		/* must be entirely above the reader */
		if (el.contains(view) || el === view) continue;
		if (!body || el.offsetHeight > body.offsetHeight) body = el;
	}
	if (!body || body.offsetHeight < 200) return { skip: 'nothing above the reader big enough to collapse' };
	/* Stashed for REPEAT as soon as `body` is settled, before the mark search below can still fail
	 * — see the note beside the full stash a few lines down. `mark: null` here so REPEAT can tell
	 * "SWAP found no candidate at all" apart from "SWAP found one but nothing survived under the
	 * reader", rather than reading the second as the first. */
	window.__fsRepeatSection = { body, mark: null };
	/* Named for the guard below: `body` living inside `.fs-ovl` (System/Memory/Storage's own grid,
	 * fs-overview.js) can grow by the full pad and move the DOCUMENT by nothing — the grid's row
	 * tracks size off the taller column, so a shorter column growing 120px never reaches the
	 * scroller. Measured live: `div#fs-ovl-panel-0` at 291px grew the document 0px on both
	 * owrtsnap@900 and owrt2410@1200 — a cell that would otherwise print "moved 0px" and read as
	 * the correction working. */
	const bodyDesc = body.tagName.toLowerCase() + (body.id ? '#' + body.id : '')
		+ (body.className ? '.' + String(body.className).trim().replace(/\s+/g, '.') : '');
	/* What the theme's growth witness can see from here: `observeContent()` measures a refill against
	 * the floored box's `min-height`, so with no floored box in the ancestry the witness is blind
	 * and `lateDrift()` writes nothing, which reads like a correction that ran and failed. Printed so
	 * a "never came back" finding says which. Read BEFORE the swap, while the settled floor stands. */
	const floorBox = body.closest && body.closest('[data-fs-floor]');
	const witness = !floorBox ? 'none'
		: (floorBox === body ? 'self' : floorBox.tagName.toLowerCase() + (floorBox.id ? '#' + floorBox.id : ''))
			+ '@' + Math.round(parseFloat(floorBox.style.minHeight) || 0);
	/* AND WHETHER THE THEME HAS A REFERENCE AT ALL — the other half of "why was nothing written".
	 * `anchorRef()` returns null outright while `scrolling()` is true, and `rememberRest()` then
	 * clears `_rest` while still setting `_restAt`, so the wait above (`restAt() === scrollTop`) is
	 * satisfied by a theme that has no reference. `lateDrift()`'s first line is `if (_lateFrame ||
	 * !ref) return`, so that reads as `writes: []` — indistinguishable, in a report, from a
	 * correction that ran and missed. Read here, immediately before the refill. */
	const fitMod = await window.L.require('fs-fit').then((m) => m, () => null);
	const themeStill = fitMod ? !fitMod.scrolling() : null;
	const lateWhy = () => (fitMod && typeof fitMod.lateWhy === 'function' ? fitMod.lateWhy() : 'n/a');
	const anchorWhy = () => (fitMod && typeof fitMod.anchorWhy === 'function' ? fitMod.anchorWhy() : 'n/a');
	const bodyH0 = body.offsetHeight;
	const docH = () => (sc ? sc.scrollHeight : document.documentElement.scrollHeight);

	/* The host is not a mark (see HOLD): the whole STACK at the point is read, since in a grid gap
	 * the top of the stack is `#view` itself. `position: sticky` is excluded too: its rect.top stays
	 * pinned while stuck (a stuck `th.th` on owrtsnap read 0 on every growth from 0 to 120px), so
	 * it stops tracking the reader. The walk climbs to `view` because a child of a stuck header
	 * inherits the pin. */
	const markAt = (y, x) => {
		for (const el of document.elementsFromPoint(x, y)) {
			if (el === view || !view.contains(el) || body.contains(el)) continue;
			let stuck = false;
			for (let a = el; a && a !== view; a = a.parentElement)
				if (getComputedStyle(a).position === 'sticky') { stuck = true; break; }
			if (!stuck) return el;
		}
		return null;
	};
	/* THE HIT IS TRIED ACROSS THE VIEWPORT, not at three points down its middle: a mark is anything
	 * inside #view, and on 25.12's Overview the middle column is a grid gap for most of its height,
	 * so all three of those points answered `#view` and every run on that release reported "no
	 * content under the reader" and measured nothing — half the matrix, silently unmeasured. */
	const h = window.innerHeight || 800;
	const vw = window.innerWidth || 800;
	let mark = null;
	for (const fy of [ 0.6, 0.5, 0.7, 0.4, 0.8, 0.35 ]) {
		for (const fx of [ 0.5, 0.25, 0.75 ]) {
			mark = markAt(Math.round(h * fy), Math.round(vw * fx));
			if (mark) break;
		}
		if (mark) break;
	}
	if (!mark) return { skip: 'nothing under the reader that survives the swap' };
	const before = { pos: pos(), top: Math.round(mark.getBoundingClientRect().top) };

	/* `mark` filled in on the same stash — REPEAT reads this rather than re-searching, which runs
	 * next in the same page. Measured live: an independent search, run 700ms after this one, picked
	 * `table.table.cbi-section-table` (1145px, a legitimate-looking candidate) on a cell where THIS
	 * search had already found a sibling that reached the scroller; the growth landed on the wrong
	 * element and `grewDoc` read 0 on every one of 274 cells swept. Nothing here mutates between the
	 * two searches on purpose — it is SWAP's own two `swap()` passes below, each a `dom.content()`-
	 * shaped refill, that wake `holdFloor()` in between and let it hand a second search a different
	 * answer. */
	window.__fsRepeatSection.mark = mark;

	/* the two halves of dom.content(), with the layout the engine performs in between made explicit
	 * — WebKit gets there on its own, and a gate must not depend on when */
	const swap = async () => {
		const startDocH = docH();
		const kept = Array.prototype.slice.call(body.childNodes);
		for (const n of kept) body.removeChild(n);
		const empty = { docH: (sc ? sc.scrollHeight : document.documentElement.scrollHeight), pos: pos() };
		for (const n of kept) body.appendChild(n);
		const pad = document.createElement('div');
		pad.style.height = growth + 'px';
		pad.dataset.fsProbe = '1';
		body.appendChild(pad);
		/* WHEN the mark comes back, not only WHETHER — see LATE_MS above. A single read at a fixed
		 * delay cannot tell "never corrected" from "corrected after the maintainer would call it a
		 * jump": both look identical if the delay lands after the fault has resolved and before a
		 * true non-correction would have. Sampled every frame for winMs instead — long enough to
		 * hold lateDrift()'s 419-420ms correction with margin for a loaded runner — noting the
		 * first frame the drift falls back under tolerance. */
		const t0 = performance.now();
		const w0 = (window.__fsW || []).length;
		let correctedAt = null, lastTop = mark.isConnected ? Math.round(mark.getBoundingClientRect().top) : null;
		/* Longest gap between two of this loop's frames (the first from t0), and when it ended.
		 * `performance.now()` only, so the measurement cannot stall the frames it is measuring. */
		let prevFrame = t0, gapMax = 0, gapAt = 0;
		/* A frame is read as it PAINTED, not as it started: this loop's rAF is queued before the
		 * theme's own, so a read at the top of the callback sees the page before that frame's
		 * correction and credits it to the next frame (a whole stall on a stalled runner: a 2702ms
		 * finding for a 2681ms gap, firefox owrt2512 @390 top). Re-observing the root each frame gets a
		 * ResizeObserver notification after every rAF and before paint. `painted` counts the frames
		 * read that way; a missed one is read at the next top and can only look later. */
		let pending = null, painted = 0, frames = 0;
		const read = (at) => {
			lastTop = mark.isConnected ? Math.round(mark.getBoundingClientRect().top) : null;
			if (correctedAt === null && lastTop !== null && Math.abs(lastTop - before.top) <= tol)
				correctedAt = Math.round(at - t0);
		};
		const ro = new ResizeObserver(() => { if (pending !== null) { pending = null; painted++; read(prevFrame); } });
		await new Promise((done) => {
			const frame = () => {
				const nowF = performance.now();
				if (pending !== null) { pending = null; read(nowF); }
				if (nowF - prevFrame > gapMax) { gapMax = nowF - prevFrame; gapAt = nowF - t0; }
				prevFrame = nowF;
				frames++;
				if (nowF - t0 < winMs) {
					pending = nowF;
					ro.unobserve(document.documentElement);
					ro.observe(document.documentElement);
					requestAnimationFrame(frame);
				} else { ro.disconnect(); read(nowF); done(); }
			};
			requestAnimationFrame(frame);
		});
		const after = { pos: pos(), top: lastTop };
		const writes = (window.__fsW || []).slice(w0);
		/* WHICH LINE DECIDED — see `_lateWhy` in fs-fit.js. Read after the window, so it holds the
		 * decision this refill produced rather than the previous cell's. */
		const why = lateWhy(), awhy = anchorWhy();
		/* each entry as `decision+ms`, relative to this refill's own t0 — see `_lateTrail` in fs-fit.js */
		const rel = (tr) => (tr || []).map((e) => {
			const i = e.lastIndexOf('@');
			return e.slice(0, i) + '+' + Math.round(Number(e.slice(i + 1)) - t0);
		}).join(' ');
		const trail = fitMod && typeof fitMod.lateTrail === 'function' ? rel(fitMod.lateTrail()) : 'n/a';
		const atrail = fitMod && typeof fitMod.anchorTrail === 'function' ? rel(fitMod.anchorTrail()) : 'n/a';
		/* The offset the swap actually asked the scroller to move by — separate from `clamped`
		 * (what the engine took OUT of a document momentarily empty) and from `moved` (what the
		 * reader's mark shows). A cell that reports `clamped 0px` because the engine declined to
		 * anchor reads identically here to one where the mark itself misreported; this term is
		 * the one number both a healthy pass and a false one can be told apart by. */
		const offsetDelta = after.pos - before.pos;
		/* Did the pad reach the SCROLLER at all — see the note on `bodyDesc` above. A grid whose
		 * row tracks size off a sibling column can absorb the whole 120px inside `body` without the
		 * document growing by a pixel, which is a different failure from "the reader didn't move". */
		const grewDoc = docH() - startDocH;
		pad.remove();
		await wait(700);		/* let the floor come back down before the next pass measures */
		return { empty, after, moved: after.top === null ? null : after.top - before.top,
			clamped: before.pos - empty.pos, offsetDelta, grewDoc, correctedAt, writes, why, awhy, trail, atrail, gapMax: Math.round(gapMax), gapAt: Math.round(gapAt), painted, frames };
	};

	const corrected = await swap();

	/* THE SAME SWAP WITH THE CORRECTION SWITCHED OFF, which is what isolates the other half. The
	 * content column keeps a floor between ticks (fs-fit.js, holdFloor), so a section emptying inside
	 * it takes nothing off the document and there is nothing for the engine to clamp into. With
	 * `fsAnchor = 'off'` no correction is written (the floor sweep still puts back the clamp its own
	 * clear pass took), so anything that still moves the reader here is the floor failing rather
	 * than the correction covering for it. */
	let floorOnly = { skip: 'no storage' };
	try {
		localStorage.setItem('fsAnchor', 'off');
		floorOnly = await swap();
	} catch (e) { /* no storage, no second pass */ }
	finally { try { localStorage.removeItem('fsAnchor'); } catch (e) { /* … */ } }

	return { empty: corrected.empty, moved: corrected.moved,
		clamped: corrected.clamped, offsetDelta: corrected.offsetDelta, grewDoc: corrected.grewDoc,
		correctedAt: corrected.correctedAt,
		writes: corrected.writes,
		bodyDesc, bodyH: bodyH0, witness, themeStill, why: corrected.why, awhy: corrected.awhy, trail: corrected.trail, atrail: corrected.atrail, gapMax: corrected.gapMax, gapAt: corrected.gapAt, painted: corrected.painted, frames: corrected.frames,
		floorMoved: floorOnly.skip ? null : floorOnly.moved,
		floorClamped: floorOnly.skip ? null : floorOnly.clamped,
		floorOffsetDelta: floorOnly.skip ? null : floorOnly.offsetDelta };

};

/* Runs in the page: SEVERAL of dom.content()'s empty-then-refill cycles on the SAME section, back
 * to back, with the engine's own anchoring left alone.
 *
 * Not SWAP again: SWAP closes inside one refill, so `LATE_MISS_LIMIT` (2, fs-fit.js) is
 * unreachable from it, and a switch that flips only on the SECOND miss — including one that flips
 * on an engine doing the job — had no case that could see it. `fs-fit.engineTrusted()` is read,
 * not inferred from timing. The section is SWAP's own, `window.__fsRepeatSection`: a second search
 * after SWAP's refills picks a worse candidate (docs/anchoring-log.md). */
const REPEAT = async ([ growth, tol, times ]) => {
	const wait = (ms) => new Promise((r) => setTimeout(r, ms));
	const view = document.getElementById('view');
	if (!view) return { skip: 'no view' };
	const mc = document.getElementById('maincontent');
	const flow = mc ? getComputedStyle(mc).overflowY : '';
	const sc = (flow === 'auto' || flow === 'scroll') ? mc : null;
	const pos = () => (sc ? sc.scrollTop : window.scrollY);
	const room = (sc ? sc.scrollHeight - sc.clientHeight : document.documentElement.scrollHeight - window.innerHeight);
	if (room < 600) return { skip: 'page too short to scroll' };

	/* only against the REAL engine — see the note on TICK below for why `noEngineAnchor` skips this
	 * case entirely rather than reaching it with the fallback forced on */
	const poll = (window.L && window.L.Poll) || null;
	const polling = !!(poll && typeof poll.active === 'function' && poll.active());
	if (polling) poll.stop();
	/* the poll stays stopped, matching HOLD/SWAP — nothing here restarts it */

	/* The same section SWAP picked, not a second search (see the note on REPEAT). Re-parking below is
	 * still needed — SWAP's settling window may leave the reader a pixel or two off `before.top` —
	 * but WHICH element is measured is SWAP's call, read off `window.__fsRepeatSection`. */
	const picked = window.__fsRepeatSection;
	let body = picked && picked.body && picked.body.isConnected ? picked.body : null;
	if (!body || body.offsetHeight < 200) return { skip: 'nothing above the reader big enough to collapse' };
	let mark = picked && picked.mark && picked.mark.isConnected ? picked.mark : null;
	if (!mark) return { skip: 'nothing under the reader that survives the swap' };
	const bodyDesc = body.tagName.toLowerCase() + (body.id ? '#' + body.id : '')
		+ (body.className ? '.' + String(body.className).trim().replace(/\s+/g, '.') : '');
	/* The growth witness, as in SWAP: with no floored box in the ancestry `observeContent()` is blind
	 * and `lateDrift()` writes nothing, which reads like a correction that ran and failed. Printed
	 * so a "never came back" finding says which. Read BEFORE the swap. */
	const floorBox = body.closest && body.closest('[data-fs-floor]');
	const witness = !floorBox ? 'none'
		: (floorBox === body ? 'self' : floorBox.tagName.toLowerCase() + (floorBox.id ? '#' + floorBox.id : ''))
			+ '@' + Math.round(parseFloat(floorBox.style.minHeight) || 0);
	const bodyH0 = body.offsetHeight;
	const docH = () => (sc ? sc.scrollHeight : document.documentElement.scrollHeight);

	/* park/wait: the same shape as SWAP above, because the fault this measures is downstream of the
	 * SAME candidate section — duplicated rather than shared, matching every other case in this
	 * file, since each has to run standalone inside `page.evaluate()`. */
	const at = room - 60;
	const parkAt = async (y) => {
		const target = sc || window;
		const landed = new Promise((res) => {
			let done = false;
			const on = () => { if (!done) { done = true; target.removeEventListener('scroll', on); res(); } };
			target.addEventListener('scroll', on, { passive: true });
			setTimeout(() => { if (!done) { done = true; target.removeEventListener('scroll', on); res(); } }, 2500);
		});
		if (sc) sc.scrollTop = y; else window.scrollTo(0, y);
		await landed;
		const fit = await window.L.require('fs-fit').then((m) => m, () => null);
		if (fit && typeof fit.restAt !== 'function')
			throw new Error('fs-fit is loaded but exports no restAt(): the sweep cannot tell when '
				+ 'the theme has taken its reference, and a flat wait is not a substitute');
		if (fit) {
			for (let i = 0; i < 160; i++) {
				if (fit.restAt() === (sc ? sc.scrollTop : window.scrollY) && !fit.scrolling()) break;
				await wait(25);
			}
		}
		await wait(600);
	};
	await parkAt(at);
	const before = { pos: pos(), top: Math.round(mark.getBoundingClientRect().top) };

	const fit = await window.L.require('fs-fit').then((m) => m, () => null);
	/* Absent on a checkout that stripped it, same guard as `restAt` — a case that silently measured
	 * nothing here would read as "trust never left true", which is not the same claim. */
	if (fit && typeof fit.engineTrusted !== 'function')
		throw new Error('fs-fit is loaded but exports no engineTrusted(): this case cannot tell '
			+ 'whether the switch tripped, and a missing export is not the same as "it did not"');
	const trusted = () => (fit ? fit.engineTrusted() : null);
	const trustedBefore = trusted();

	/* Grown by `body`'s OWN mutation, in dom.content()'s shape — empty, then refill, one tick at a
	 * time. The pad is removed and the floor allowed to settle between ticks (SWAP's own comment on
	 * why: the next pass reads a floor already standing, not one still clearing). */
	const startDocH = docH();
	const refills = [];
	/* Read WHILE the first pad is still standing — see SWAP's own `grewDoc`, taken before ITS pad
	 * comes off. This used to be `docH() - startDocH` computed after the loop, by which point every
	 * refill's pad had already been removed and the document was back at its start height on
	 * purpose: net zero on every cell, `.fs-ovl` grid or not, and indistinguishable from the growth
	 * genuinely never reaching the scroller. Measured live on the 39 cells SWAP itself measured
	 * something on in the same run: every one still read `grewDoc` 0 under the old placement. */
	let grewDoc = null;
	for (let i = 0; i < times; i++) {
		const kept = Array.prototype.slice.call(body.childNodes);
		for (const n of kept) body.removeChild(n);
		for (const n of kept) body.appendChild(n);
		const pad = document.createElement('div');
		pad.style.height = growth + 'px';
		pad.dataset.fsProbe = '1';
		body.appendChild(pad);
		const t0 = performance.now();
		const w0 = (window.__fsW || []).length;
		/* the same diagnostics SWAP prints — a REPEAT finding used to say only "corrected never" */
		const themeStill = fit ? !fit.scrolling() : null;
		let correctedAt = null, lastTop = mark.isConnected ? Math.round(mark.getBoundingClientRect().top) : null;
		let prevFrame = t0, gapMax = 0, gapAt = 0;
		/* read as the frame paints it — see SWAP's note */
		let pending = null;
		const read = (at) => {
			lastTop = mark.isConnected ? Math.round(mark.getBoundingClientRect().top) : null;
			if (correctedAt === null && lastTop !== null && Math.abs(lastTop - before.top) <= tol)
				correctedAt = Math.round(at - t0);
		};
		const ro = new ResizeObserver(() => { if (pending !== null) { pending = null; read(prevFrame); } });
		await new Promise((done) => {
			const frame = () => {
				const now = performance.now();
				if (pending !== null) { pending = null; read(now); }
				if (now - prevFrame > gapMax) { gapMax = Math.round(now - prevFrame); gapAt = Math.round(now - t0); }
				prevFrame = now;
				if (now - t0 < 900) {
					pending = now;
					ro.unobserve(document.documentElement);
					ro.observe(document.documentElement);
					requestAnimationFrame(frame);
				} else { ro.disconnect(); read(now); done(); }
			};
			requestAnimationFrame(frame);
		});
		const writes = (window.__fsW || []).slice(w0);
		const rel = (tr) => (tr || []).map((e) => {
			const k = e.lastIndexOf('@');
			return e.slice(0, k) + '+' + Math.round(Number(e.slice(k + 1)) - t0);
		}).join(' ');
		const why = fit && typeof fit.lateWhy === 'function' ? fit.lateWhy() : 'n/a';
		const awhy = fit && typeof fit.anchorWhy === 'function' ? fit.anchorWhy() : 'n/a';
		const trail = fit && typeof fit.lateTrail === 'function' ? rel(fit.lateTrail()) : 'n/a';
		const atrail = fit && typeof fit.anchorTrail === 'function' ? rel(fit.anchorTrail()) : 'n/a';
		if (i === 0) grewDoc = docH() - startDocH;
		pad.remove();
		refills.push({ i, moved: lastTop === null ? null : lastTop - before.top, correctedAt, writes,
			engineTrusted: trusted(), themeStill, why, awhy, trail, atrail, gapMax, gapAt });
		await wait(700);
	}
	return { bodyDesc, bodyH: bodyH0, grewDoc, witness,
		trustedBefore, trustedAfter: trusted(), refills };

};

/* Runs in the page: a scripted flick up and down while ticks land, reporting any offset change the
 * wheel did not ask for. */
/* The poll is started HERE and nowhere else: `Poll.start()` calls `step()` synchronously (luci.js),
 * so a case that hands the poll back fires a real tick into the next one (HOLD returning it put a
 * live tick under SWAP's floor measurement, 120px, webkit/owrt2410 @390 top compact). This case
 * WANTS ticks landing mid-flick. */
const QUIET = async (growth) => {
	const wait = (ms) => new Promise((r) => setTimeout(r, ms));
	const view = document.getElementById('view');
	const mc = document.getElementById('maincontent');
	const flow = mc ? getComputedStyle(mc).overflowY : '';
	const sc = (flow === 'auto' || flow === 'scroll') ? mc : null;
	const pos = () => (sc ? sc.scrollTop : window.scrollY);
	const room = (sc ? sc.scrollHeight - sc.clientHeight : document.documentElement.scrollHeight - window.innerHeight);
	if (room < 600) return { skip: 'page too short to scroll' };

	/* A flick that never reaches an edge: assigning the current scrollTop fires no scroll event, so
	 * steps clamped at 0 or the bottom are a page standing still, and 400 ms of that is the theme
	 * rightly putting the pending growth back. Travel stays inside the page: a margin at each end,
	 * steps small enough that six fit between. */
	/* The ticks this case measures against start BEFORE the park, with a tick's worth of time:
	 * `Poll.start()` performs one synchronously, and later it lands inside the flick (worst 145.5px,
	 * firefox/owrt2410 @390 top compact). */
	const poll = (window.L && window.L.Poll) || null;
	if (poll && typeof poll.active === 'function' && !poll.active()) {
		poll.start();
		await wait(1500);
	}

	const edge = Math.max(80, Math.min(200, Math.round(room * 0.15)));
	const lo = edge, hi = room - edge;
	/* six steps out and six back, from the MIDDLE of that band: half the band is what one direction
	 * gets, so the step is a twelfth of it. Measured on the stands, where the Overview has 1582px of
	 * room at 1440 and 4355 at 390 — the old fixed 160px reached the bottom in three steps at 1440
	 * and stood there for the rest of the half-cycle, which is how a page nobody was scrolling came
	 * to be measured as a flick. */
	const reach = Math.max(40, Math.min(160, Math.floor((hi - lo) / 12)));

	let unexplained = 0, biggest = 0, expected = 0, stalls = 0;
	/* WHO MOVED IT — the first surprise's step, the theme's own scroll writes and its decision trails, so
	 * a "moved on its own" finding says whether the theme wrote or the engine adjusted. A CI report
	 * (firefox owrt2410 @390 top large, engine on, dhcp, 562px) arrived without any of it. */
	let surprise = null;
	const fitQ = await window.L.require('fs-fit').then((m) => m, () => null);
	let last = Math.round((lo + hi) / 2);
	if (sc) sc.scrollTop = last; else window.scrollTo(0, last);
	await wait(700);
	last = pos();
	let lastAt = Date.now();
	let movedAt = Date.now();
	for (let i = 0; i < 24; i++) {
		const step = (i % 12 < 6) ? reach : -reach;
		const stepT0 = performance.now();
		const w0 = (window.__fsW || []).length;
		const docH0 = sc ? sc.scrollHeight : document.documentElement.scrollHeight;
		expected = Math.max(lo, Math.min(hi, last + step));
		if (sc) sc.scrollTop = expected; else window.scrollTo(0, expected);
		/* a growth lands mid-flick, which is when the theme must NOT correct */
		if (i % 6 === 3) {
			const pad = document.createElement('div');
			pad.style.height = growth + 'px';
			pad.dataset.fsProbe = '1';
			view.insertBefore(pad, view.firstChild);
		}
		await wait(70);
		const now = pos();
		/* Was this step still part of a flick? The theme calls the reader "scrolling" until the offset
		 * has held still for SCROLL_IDLE (400 ms, fs-fit.js), and a step here is 70 ms, so on a machine
		 * that keeps up the whole loop is one motion. A loaded CI runner does not always keep up, and a
		 * step that took longer has the theme rightly deciding the reader stopped. A gap that long is
		 * not a flick, so the step is excluded — and counted and printed, because silence would make a
		 * run that measured nothing look like a run that found nothing. */
		const gap = Date.now() - lastAt;
		lastAt = Date.now();
		if (now !== last) movedAt = Date.now();
		/* …and the same question asked of the PAGE rather than of the loop: an offset that has not
		 * changed for SCROLL_IDLE is a page nobody is scrolling, whatever this loop asked for. */
		const idle = Date.now() - movedAt;
		/* the offset may differ from the request by the growth the engine compensated; what must not
		 * happen is a correction of the theme's own on top of it while the reader is moving */
		const off = Math.abs(now - expected);
		if (off > growth + 4) {
			if (gap >= 400 || idle >= 400) stalls++;
			else {
				unexplained++; biggest = Math.max(biggest, off);
				if (!surprise) {
					const rel = (tr) => (tr || []).map((e) => {
						const k = e.lastIndexOf('@');
						return e.slice(0, k) + '+' + Math.round(Number(e.slice(k + 1)) - stepT0);
					}).filter((e) => Number(e.slice(e.lastIndexOf('+') + 1)) > -2000).join(' ');
					surprise = { step: i, padded: i % 6 === 3, expected, now, gap,
						docDelta: (sc ? sc.scrollHeight : document.documentElement.scrollHeight) - docH0,
						writes: (window.__fsW || []).slice(w0),
						trail: fitQ && typeof fitQ.lateTrail === 'function' ? rel(fitQ.lateTrail()) : 'n/a',
						atrail: fitQ && typeof fitQ.anchorTrail === 'function' ? rel(fitQ.anchorTrail()) : 'n/a',
						trusted: fitQ && typeof fitQ.engineTrusted === 'function' ? fitQ.engineTrusted() : null };
				}
			}
		}
		last = now;
	}
	view.querySelectorAll('[data-fs-probe]').forEach((el) => el.remove());
	return { unexplained, biggest, stalls, surprise };
};

/* Runs in the page: park the reader, LEAVE THE POLL RUNNING, and watch the offset across several
 * REAL ticks — nothing inserted by the probe. HOLD and SWAP stop the poll and close inside 800ms;
 * QUIET discards any step where the offset held still for 400ms. None watches a PARKED reader
 * across a tick the poll fires itself, which is where WebKit's own anchoring moved the offset
 * +21px with nothing above the reader changing and `lateDrift()` wrote it back 408-421ms later,
 * inside both of their tolerances. */
const TICK = async (ticks) => {
	const wait = (ms) => new Promise((r) => setTimeout(r, ms));
	const view = document.getElementById('view');
	if (!view) return { skip: 'no view' };
	const mc = document.getElementById('maincontent');
	const flow = mc ? getComputedStyle(mc).overflowY : '';
	const sc = (flow === 'auto' || flow === 'scroll') ? mc : null;
	const pos = () => (sc ? sc.scrollTop : window.scrollY);
	const room = (sc ? sc.scrollHeight - sc.clientHeight : document.documentElement.scrollHeight - window.innerHeight);
	if (room < 600) return { skip: 'page too short to scroll' };

	const poll = (window.L && window.L.Poll) || null;
	/* An empty queue polls nothing to watch. `L.Poll.queue` is not a new liberty taken with a
	 * private property — fs-router.js already reads it directly (`L.Poll.queue.length === 0`), so
	 * this asks the same question the theme itself asks. Processes registers none, and starting the
	 * interval anyway would just wait out HARD_TIMEOUT below for a tick that can never land. */
	if (!poll || !Array.isArray(poll.queue) || poll.queue.length === 0)
		return { skip: 'this page registers no poll — nothing to tick' };
	if (typeof poll.active === 'function' && !poll.active()) poll.start();

	/* NOT room/2: this case's fault is where the reader rests relative to the FOLD, not to the
	 * document's length, and a run parked thousands of pixels past it measured 0px on 3/3 tries where
	 * the default park read 21px. ~0.6 viewport heights down is the fraction `anchorRef()` (fs-fit.js)
	 * uses for the fold: a reader who just opened a page rests about one screen in. */
	const at = Math.min(Math.round((window.innerHeight || 800) * 0.6), room);
	/* park the reader and wait for the ENGINE to say the scroll happened — see the note on HOLD */
	const parkAt = async (y) => {
		const target = sc || window;
		const landed = new Promise((res) => {
			let done = false;
			const on = () => { if (!done) { done = true; target.removeEventListener('scroll', on); res(); } };
			target.addEventListener('scroll', on, { passive: true });
			setTimeout(() => { if (!done) { done = true; target.removeEventListener('scroll', on); res(); } }, 2500);
		});
		if (sc) sc.scrollTop = y; else window.scrollTo(0, y);
		await landed;
		const fit = await window.L.require('fs-fit').then((m) => m, () => null);
		if (fit && typeof fit.restAt !== 'function')
			throw new Error('fs-fit is loaded but exports no restAt(): the sweep cannot tell when '
				+ 'the theme has taken its reference, and a flat wait is not a substitute');
		if (fit) {
			for (let i = 0; i < 160; i++) {
				if (fit.restAt() === (sc ? sc.scrollTop : window.scrollY) && !fit.scrolling()) break;
				await wait(25);
			}
		}
		await wait(600);		/* the still moment the theme measures from */
	};
	await parkAt(at);

	/* The budget is TIME, off the page's own `L.env.pollinterval` (what `Poll.add()` defaults to), not
	 * mutation callbacks: one Overview tick is three microtask-batched callbacks, so counting them
	 * exited after about 2s of page time, before the real ticks 5 s apart, and read 0px. */
	const interval = (window.L && window.L.env && Number(window.L.env.pollinterval)) || 5;
	let mutations = 0;
	const mo = new MutationObserver(() => { mutations++; });
	mo.observe(view, { childList: true, subtree: true });

	const samples = [];
	const start = performance.now();
	/* `ticks` real intervals, plus one more tick's worth of headroom for lateDrift's correction
	 * (measured up to 421ms after the mutation, fs-fit.js) to land inside the window instead of
	 * just past its close. */
	const budget = (ticks + 1) * interval * 1000 + 1500;
	await new Promise((done) => {
		const frame = () => {
			samples.push(pos());
			if (performance.now() - start < budget) requestAnimationFrame(frame); else done();
		};
		requestAnimationFrame(frame);
	});
	mo.disconnect();

	if (mutations === 0)
		return { skip: `no tick landed in ${Math.round(performance.now() - start)}ms — the poll did not run` };

	const mn = Math.min(...samples), mx = Math.max(...samples);
	return { moved: Math.round((mx - mn) * 10) / 10, mutations };
};

let list = stands(FLAGS.only, { all: FLAGS.all });
/* `--quick`'s stand narrowing: the first stand `stands()` handed back, unless `--only` already said
 * which ones — an explicit `--only` is the caller overriding the default, and `--quick` narrowing it
 * again on top would make the flag's own effect depend on argument order. */
if (QUICK && !FLAGS.only) list = list.slice(0, 1);
requireStands(list, 'scroll-anchor');
/* Each `-b` twin owlab boots beside a release line is a second container for the SAME
 * measurement, not a fourth release line — see the note on `pairStands()`. `--no-pair` is the
 * escape hatch for debugging the pairing itself, or for a run that wants the twin left idle. */
const PAIRS = FLAGS['no-pair'] ? new Map() : pairStands(list, 'scroll-anchor');
/* Printed as it is found, not held until the end: the first finding is the whole answer for someone
 * iterating on a fix, and the list below is what says how many cells and which axes. */
const findings = [];
const found = (line) => {
	findings.push(line);
	process.stdout.write(`  FINDING ${line}\n`);
};
/* Cells whose page never loaded. They are NOT findings: this gate measures where the reader ends up
 * after a layout change, and a page that did not open measured nothing at all. Reported separately,
 * and fatal only in bulk — see UNOPENED_TOLERANCE below. */
const unopened = [];
/* stands that did not serve LuCI at all (lib/stands.mjs loginFault): named, and the other stands still run */
const down = [];
let runs = 0;

if (QUICK) {
	console.log(`scroll-anchor --quick: ${ENGINES.join(',')} on ${list.map((s) => s.id).join(',')} `
		+ `only, page ${PAGES.join(',')} only, default width/layout/density axes. This is NOT the full `
		+ 'sweep: it skips every other stand, both other page shapes (dhcp, processes), and — without '
		+ '--full — compact/large density and every scroller but 1440 side/390 side/390 top. Run without '
		+ '--quick (`npm run anchor`, or CI\'s own `--full` sweep) before trusting a clean result.\n');
}

/* A single `page.goto` in CI is not reliable enough to fail a release on. Two runs an hour apart on
 * the same commit died on webkit/owrt2410 with `page.goto: Timeout 20000ms exceeded` and
 * `page.goto: WebKit encountered an internal error` — two cells out of the sweep, every other cell
 * reporting `reader moved 0px`, and the same sweep green locally over 174 runs. So: three attempts
 * before a cell is written off. */
async function openPage(page, url) {
	let last;
	for (let attempt = 1; attempt <= 3; attempt++) {
		try {
			await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
			return;
		} catch (e) {
			last = e;
			/* the WebKit process may still be dying; give it a moment rather than racing it */
			if (attempt < 3) await page.waitForTimeout(1500);
		}
	}
	throw last;
}

/* How many cells may go unopened before the sweep itself is the problem. One flaky cell is the
 * runner; a stand that stopped answering is not, and a run that measured almost nothing must not
 * report that the reader stayed put. 2% of a ~170-cell sweep is 3 cells. */
const UNOPENED_TOLERANCE = 0.02;
/* one line out of a Playwright error: the rest is a stack through the evaluate wrapper, and the
 * first line is the sentence the browser or this file actually wrote */
const first = (e) => String((e && e.message) || e).split('\n')[0].trim();

/* Reuse a logged-in session across every cell aimed at the same physical container, instead of
 * performing the POST-and-redirect login flow once per cell. Captured with a throwaway context and
 * handed to every context a worker opens afterward; `login()` still runs on each of them and still
 * re-authenticates for real the moment a cookie has expired (LuCI's own session timeout) — this
 * removes the ROUND TRIP for the common case, it does not replace the check. */
async function captureSession(browser, base, id) {
	const ctx = await browser.newContext();
	await sealToRouter(ctx, base);
	const page = await ctx.newPage();
	await login(page, base, id);
	const state = await ctx.storageState();
	await ctx.close();
	return state;
}

/* One cell, against ONE physical container — every case in this file, run once, findings printed
 * under `reportId` rather than under `base`'s own container id, so a cell an owlab `-b` twin
 * happened to draw reads identically to one the base container drew (see `pairStands()`). Pulled out
 * of the sweep below so a worker can run its own slice of the cell list without duplicating what
 * used to be the loop body. */
async function runCell(browser, engine, reportId, base, sessionState, { PAGE, width: w, layout, density, noEngineAnchor, declines }) {
	const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, storageState: sessionState });
	await sealToRouter(ctx, base);
	/* HOLD and SWAP's own record of every scroll write in their measurement window, read back only
	 * when a finding needs it: it tells a mark that legitimately reached the viewport top (-505px,
	 * firefox owrt2512 @1440 top compact) from a failed correction. */
	await ctx.addInitScript(() => {
		window.__fsW = [];
		const rec = (how, val) => { try { window.__fsW.push({ t: Math.round(performance.now()), how, val: Math.round(val) }); } catch (e) { /* … */ } };
		const st = window.scrollTo;
		window.scrollTo = function (...a) { rec('window.scrollTo', typeof a[0] === 'object' ? (a[0] && a[0].top) : a[1]); return st.apply(this, a); };
		const sb = window.scrollBy;
		window.scrollBy = function (...a) { rec('window.scrollBy', typeof a[0] === 'object' ? (a[0] && a[0].top) : a[1]); return sb.apply(this, a); };
		const d = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
		Object.defineProperty(Element.prototype, 'scrollTop', { configurable: true, enumerable: d.enumerable,
			get() { return d.get.call(this); },
			set(v) { rec('scrollTop=' + (this.id || this.className || this.tagName), v); return d.set.call(this, v); } });
		const es = Element.prototype.scrollTo;
		if (es) Element.prototype.scrollTo = function (...a) { rec('el.scrollTo=' + (this.id || this.className || this.tagName), typeof a[0] === 'object' ? (a[0] && a[0].top) : a[1]); return es.apply(this, a); };
	});
	/* the Safari path, forced: `fsEngineAnchor=off` makes fs-fit believe the platform has no
	 * anchoring of its own, and the stylesheet turns the engine's off for real, so the two agree
	 * about which is responsible. `declines` is the same stylesheet WITHOUT the localStorage half:
	 * the engine has `overflow-anchor` and declines it on a refill, so the theme TRUSTS an engine
	 * that did nothing (`lateDrift()`, fs-fit.js). CI hit that state on a loaded runner in two of
	 * three runs and a quiet machine never did; ablating the engine alone makes it deterministic. */
	if (noEngineAnchor || declines)
		await ctx.addInitScript((tellTheTheme) => {
			if (tellTheTheme) try { localStorage.setItem('fsEngineAnchor', 'off'); } catch (e) { /* no storage */ }
			document.addEventListener('DOMContentLoaded', () => {
				const s = document.createElement('style');
				s.textContent = 'html, body, #maincontent, .fs-main, #view, #view * { overflow-anchor: none !important; }';
				document.head.appendChild(s);
			});
		}, !!noEngineAnchor);
	const page = await ctx.newPage();
	const mode = noEngineAnchor ? 'engine-anchoring OFF' : (declines ? 'engine DECLINES     ' : 'engine-anchoring on ');
	const where = `${engine} ${reportId} @${w} ${layout.padEnd(4)} ${density.padEnd(7)} ${mode} ${PAGE.replace('/admin/status/', '')}`;
	try {
		await login(page, base, reportId);
		await page.evaluate(async ([l, d]) => {
			const prefs = await window.L.require('fs-prefs');
			prefs.applyLayout(l);
			(await window.L.require('fs-axes')).density.apply(d);
		}, [ layout, density ]);
		await openPage(page, base + PAGE);
	}
	catch (e) {
		/* NOT a finding: a page that never opened says nothing about where the reader
		 * ended up. Kept apart and counted — see UNOPENED_TOLERANCE. */
		const why = first(e);		/* a StandDown already leads with the router, which `where` names */
		unopened.push(`${where}: ${why.startsWith(`${reportId}: `) ? why.slice(reportId.length + 2) : why}`);
		await ctx.close();
		return;
	}
	await page.waitForTimeout(3000);

	let held, swap, quiet, tick, repeat, below;
	try {
		/* TICK FIRST, on the page exactly as it loaded: HOLD's pad, SWAP's cycles and QUIET's flicks
		 * perturb whatever the engine picked as its anchor node, and after them TICK read 0px on a
		 * cell a fresh navigation read 21px on. Only against the REAL engine: with `noEngineAnchor`
		 * the stylesheet already turns anchoring off, which is what TICK watches for misbehaving. */
		tick = (noEngineAnchor || declines)
			? { skip: 'engine already forced off — HOLD/SWAP cover the theme\'s own correction' }
			: await page.evaluate(TICK, TICK_COUNT);
		held = await page.evaluate(HOLD, GROWTH);
		swap = await page.evaluate(SWAP, [ GROWTH, TOLERANCE, SWAP_WINDOW ]);
		/* only against the REAL engine — same reasoning as TICK above: with `noEngineAnchor`
		 * the fallback already runs every refill, so `_engineTrusted` has nothing to say.
		 * AND NOT ON THE `declines` CELL EITHER, for the opposite reason: there the flag going
		 * false is the switch working exactly as built — the engine really is doing nothing —
		 * so REPEAT's "the flag tripped while the reader never moved" finding would fire on
		 * correct behaviour. SWAP above performs one trusted refill per page load, which is
		 * the one measurement this cell is for; a second would be taken on an already-
		 * distrusted theme and measure `applyAnchor()`, which the OFF cell already covers. */
		repeat = (noEngineAnchor || declines)
			? { skip: 'engine already forced off — HOLD/SWAP cover the theme\'s own correction' }
			: await page.evaluate(REPEAT, [ GROWTH, TOLERANCE, REPEAT_TIMES ]);
		below = await page.evaluate(BELOW, GROWTH);
		quiet = await page.evaluate(QUIET, GROWTH);
	}
	/* A cell that threw proved nothing, and dropping it without a word is how a sweep comes
	 * back green having measured a fraction of what it was asked to. That is not a theory:
	 * `fs-fit.restAt()` was stripped out of the package, every measurement threw, and both
	 * of these catches took the whole run down to "0 run(s)" and exit 0. */
	catch (e) {
		/* A page that is no longer a LuCI page measured nothing either. The throw above stays a finding
		 * where LuCI still answers (a stripped `restAt()` throws with `window.L` in place); a page that
		 * cannot answer, or answers without `L.require`, is the unopened case arriving late, still
		 * counted against UNOPENED_TOLERANCE (docs/anchoring-log.md). */
		const luci = await page.evaluate(() => !!(window.L && typeof window.L.require === 'function')).catch(() => false);
		if (luci) findings.push(`${where}: the measurement threw — ${first(e)}`);
		else unopened.push(`${where}: the page stopped being a LuCI page mid-measurement (${page.isClosed() ? 'closed' : page.url()}) — ${first(e)}`);
		await ctx.close();
		return;
	}

	/* A cell that grew `body` by the full pad without the DOCUMENT growing has proven
	 * nothing: `.fs-ovl`'s grid sizes a row off its taller column, so a shorter column
	 * (`div#fs-ovl-panel-0`, 291px, on owrtsnap@900 and owrt2410@1200) can absorb 120px
	 * and leave the scroller untouched — `swap.moved` then reads 0 for the same reason a
	 * correctly-anchored page would, and the two are indistinguishable without this
	 * check. Folded into `swap.skip` rather than a separate branch so it is excluded from
	 * the pass line below the same way "nothing to collapse" already is — a skip, not a
	 * silent pass: it says the growth never reached what it was measuring. */
	if (!swap.skip && swap.grewDoc < GROWTH / 2)
		swap.skip = `the ${GROWTH}px pad only grew the document ${swap.grewDoc}px `
			+ `(${swap.bodyDesc}, ${swap.bodyH}px) — the growth never reached the scroller`;
	/* the same `.fs-ovl` grid guard as SWAP's, above — REPEAT walks the same candidates */
	if (!repeat.skip && repeat.grewDoc < GROWTH / 2)
		repeat.skip = `the ${GROWTH}px pad only grew the document ${repeat.grewDoc}px `
			+ `(${repeat.bodyDesc}, ${repeat.bodyH}px) — the growth never reached the scroller`;

	if (held.skip || quiet.skip) {
		process.stdout.write(`  ${where}: ${held.skip || quiet.skip}\n`);
		await ctx.close();
		return;
	}
	runs++;
	const geom = (h) => `before.top=${h && h.before ? h.before.top : '-'} after.top=${h && h.after ? h.after.top : '-'}`;
	if (held.moved === null)
		findings.push(`${where}: the reader's element was replaced mid-measurement, so nothing was proven`);
	else if (Math.abs(held.moved) > TOLERANCE) {
		/* ONE FLAKE IN ~216 CELLS MUST NOT FAIL A RUN ON ITS OWN. A -505px HOLD finding on
		 * firefox owrt2512 @1440 top compact was chased for a full round and never
		 * reproduced locally: before.top read 503 every run, so after.top≈0 was the mark
		 * landing at the viewport top — a different event from a failed correction — and
		 * nothing here printed the geometry that would have said so at the time. Both
		 * readings are printed now, and a second measurement is taken before either one
		 * becomes a finding. */
		const held2 = await page.evaluate(HOLD, GROWTH);
		if (held2.moved !== null && Math.abs(held2.moved) > TOLERANCE)
			found(`${where}: ${GROWTH}px grew above the reader and the page moved ${held.moved}px `
				+ `under them (${geom(held)}); re-measured: ${held2.moved}px (${geom(held2)})`
				+ ((held.writes && held.writes.length) ? ` — writes: ${JSON.stringify(held.writes)}` : ''));
		else
			process.stdout.write(`  ${where}: HOLD read ${held.moved}px once (${geom(held)}) but `
				+ `${held2.moved}px on re-measure (${geom(held2)}) — one flake, not a finding\n`);
	}
	if (below && !below.skip && below.moved !== null && Math.abs(below.moved) > TOLERANCE)
		found(`${where}: ${GROWTH}px grew BELOW the reader and the page moved ${below.moved}px under them `
			+ `(offset ${below.scrollDelta >= 0 ? '+' : ''}${below.scrollDelta}, ${below.boxDesc}) — content arriving under the reader must not move them`
			+ ((below.writes && below.writes.length) ? ` — writes: ${JSON.stringify(below.writes)}` : ''));
	if (swap.skip)
		process.stdout.write(`  ${where}: the swap measured nothing (${swap.skip})\n`);
	else if (swap.moved === null)
		found(`${where}: the reader's element did not survive the swap, so nothing was proven`);
	else if (Math.abs(swap.moved) > TOLERANCE)
		/* `correctedAt` is null here BY CONSTRUCTION: swap() only sets it once the drift has
		 * fallen back under tolerance, so a moved this large at the end of the window means
		 * it never did — NEVER CORRECTED, not corrected late. `writes` — HOLD's finding
		 * already appends it, this one did not, which is why three CI runs of the same finding
		 * could not say whether the theme ever attempted a correction: an empty array here means
		 * it never wrote, a non-empty one means it wrote somewhere the mark did not see. */
		found(`${where}: a section was refilled the way a poll refills one and the page never `
			+ `came back — still ${swap.moved}px off after ${SWAP_WINDOW}ms `
			+ `(the engine clamped ${swap.clamped}px of offset away)`
			+ `, growth witness: ${swap.witness}, theme still at refill: ${swap.themeStill}, theme said: ${swap.why}, anchor said: ${swap.awhy}, late trail: [${swap.trail}], anchor trail: [${swap.atrail}], longest frame gap: ${swap.gapMax}ms ending at +${swap.gapAt}ms`
			+ ` — writes: ${JSON.stringify(swap.writes || [])}`);
	else if (swap.correctedAt !== null && swap.correctedAt > LATE_MS)
		found(`${where}: a section was refilled the way a poll refills one and the correction `
			+ `landed ${swap.correctedAt}ms after the refill (over the ${LATE_MS}ms late `
			+ `threshold — visible to the reader as a jump)`
			+ `, growth witness: ${swap.witness}, theme still at refill: ${swap.themeStill}, theme said: ${swap.why}, anchor said: ${swap.awhy}, late trail: [${swap.trail}], anchor trail: [${swap.atrail}], longest frame gap: ${swap.gapMax}ms ending at +${swap.gapAt}ms`
			+ ((swap.writes && swap.writes.length) ? ` — writes: ${JSON.stringify(swap.writes)}` : ''));
	/* The floor is judged on the CLAMP, not on the movement, and only where the theme owns the job:
	 * with the correction switched off nobody compensates the pad the probe grows, so the
	 * reader moves by exactly that and should. What must not happen is the engine taking an
	 * offset away. Where the engine anchors for itself the same subtraction measures its
	 * compensation rather than a clamp — 629px of it, and the reader still level — so it is
	 * printed rather than judged. */
	if (noEngineAnchor && swap.floorClamped !== null && swap.floorClamped !== undefined && swap.floorClamped > TOLERANCE)
		found(`${where}: with the correction switched off the engine clamped `
			+ `${swap.floorClamped}px away — the content column's floor is not holding the document up`);
	if (quiet.unexplained)
		found(`${where}: the offset moved on its own ${quiet.unexplained} time(s) mid-flick (worst ${quiet.biggest}px) `
			+ '— a correction landing inside a scroll is itself a jump'
			+ (quiet.surprise ? `, first at step ${quiet.surprise.step}${quiet.surprise.padded ? ' (pad inserted)' : ''}: `
				+ `asked ${quiet.surprise.expected}, read ${quiet.surprise.now} after ${quiet.surprise.gap}ms, document ${quiet.surprise.docDelta >= 0 ? '+' : ''}${quiet.surprise.docDelta}px, `
				+ `engineTrusted ${quiet.surprise.trusted}, late trail: [${quiet.surprise.trail}], anchor trail: [${quiet.surprise.atrail}], `
				+ `theme writes: ${JSON.stringify(quiet.surprise.writes)}` : ''));
	/* THE PARKED READER, ACROSS REAL TICKS — see the note on TICK. Nothing here inserted the
	 * growth: a page that ticks at all and still moves is the engine's own anchoring (or its
	 * absence of one), the fault HOLD/SWAP's synthetic pad and QUIET's motion cannot reach. */
	if (tick.skip)
		process.stdout.write(`  ${where}: TICK measured nothing (${tick.skip})\n`);
	else if (Math.abs(tick.moved) > TOLERANCE)
		found(`${where}: the reader drifted ${tick.moved}px across real poll ticks `
			+ `(${tick.mutations} mutation(s) observed) while parked and nobody scrolling`);
	/* Several refills on one page (see REPEAT). Two faults, reported apart: the reader moving (a
	 * correction ran where it should not, or none where it should) is a finding regardless of the
	 * trust flag; the flag going false while the reader never moved is its own — the engine was
	 * doing the job and the switch took the correction away from it. */
	if (repeat.skip)
		process.stdout.write(`  ${where}: REPEAT measured nothing (${repeat.skip})\n`);
	else {
		const jumped = repeat.refills.find((r) => r.moved === null || Math.abs(r.moved) > TOLERANCE);
		if (jumped)
			found(`${where}: refill ${jumped.i + 1}/${REPEAT_TIMES} on the same section left the `
				+ `reader ${jumped.moved === null ? 'without a surviving reference' : jumped.moved + 'px off'} `
				+ `(engineTrusted ${jumped.engineTrusted}, corrected ${jumped.correctedAt === null ? 'never' : jumped.correctedAt + 'ms'})`
				+ `, growth witness: ${repeat.witness}, theme still at refill: ${jumped.themeStill}, theme said: ${jumped.why}, anchor said: ${jumped.awhy}, late trail: [${jumped.trail}], anchor trail: [${jumped.atrail}], longest frame gap: ${jumped.gapMax}ms ending at +${jumped.gapAt}ms`
				+ (jumped.writes && jumped.writes.length ? ` — writes: ${JSON.stringify(jumped.writes)}` : ''));
		else if (repeat.trustedBefore === true && repeat.trustedAfter === false)
			found(`${where}: _engineTrusted went false after ${REPEAT_TIMES} refills the reader `
				+ `never moved for — the engine was anchoring correctly the whole time `
				+ `(misses: ${JSON.stringify(repeat.refills.map((r) => r.engineTrusted))})`);
	}
	/* signed for readability: a positive offset is the scroller compensating for growth
	 * above the reader, which is what tells "the engine declined to anchor" (0px here)
	 * apart from "the mark misreported" (moved itself would be the tell, not this term) */
	const signed = (v) => (v === null || v === undefined ? '-' : (v >= 0 ? '+' : '') + v);
	process.stdout.write(`  ${where}  reader moved ${held.moved}px (${geom(held)}, `
		+ `scroll ${held.scrollDelta >= 0 ? '+' : ''}${held.scrollDelta}, ${held.scroller})`
		+ `  below ${below && !below.skip && below.moved !== null ? below.moved + 'px' : '-'}`
		+ `  swap moved ${swap.skip ? '-' : swap.moved + 'px'} `
		+ `[offset ${swap.skip ? '-' : signed(swap.offsetDelta)}]`
		+ `  corrected ${swap.skip ? '-' : (swap.correctedAt === null ? 'never' : swap.correctedAt + 'ms')}${swap.skip ? '' : ` painted ${swap.painted}/${swap.frames}`}`
		+ `  floor alone: clamped ${swap.skip || swap.floorClamped === null ? '-' : swap.floorClamped + 'px'}`
		+ `, reader ${swap.skip || swap.floorMoved === null ? '-' : swap.floorMoved + 'px'} `
		+ `[offset ${swap.skip || swap.floorOffsetDelta === null ? '-' : signed(swap.floorOffsetDelta)}]`
		+ `  mid-flick surprises ${quiet.unexplained}`
		+ (quiet.stalls ? `  (${quiet.stalls} step(s) too slow to still be a flick, not counted)` : '')
		+ `  tick drift ${tick.skip ? '-' : tick.moved + 'px/' + tick.mutations + 'mut'}`
		+ `  ${REPEAT_TIMES}x repeat ${repeat.skip ? '-' : repeat.refills.map((r) => (r.moved === null ? '?' : r.moved) + 'px').join('/')} `
		+ `trusted ${repeat.skip ? '-' : `${repeat.trustedBefore}->${repeat.trustedAfter}`}` + '\n');
	await ctx.close();
}

/* THE STANDS AND ENGINES RUN AT THE SAME TIME, as live-audit and spa-parity do: nothing measured
 * here is a frame rate, every wait is on an EVENT with a bounded fallback, so concurrent routers
 * and browsers cannot move an answer — unlike scroll-jank, whose subject IS frame pacing and which
 * stays serial. Each engine gets its own browser, launched and run concurrently (the gate was 52
 * minutes of the release's critical path against live's 17; docs/ci.md). */
await Promise.all(ENGINES.map(async (engine) => {
	if (!pw[engine]) { console.error(`scroll-anchor: no such engine "${engine}"`); process.exit(2); }
	const browser = await pw[engine].launch();
	down.push(...await eachStand(list, async (stand) => {
		/* One flat list of GROUPS per stand — both `noEngineAnchor` states of the same page/scroller/
		 * density. TICK and REPEAT only run with the engine's anchoring live (~26s of real ticks), so
		 * splitting individual cells by index gave one worker every expensive cell (16 anchor-OFF cells
		 * done against 4 anchor-ON at the same moment); whole groups keep every share even. */
		const groups = [];
		for (const PAGE of PAGES)
			for (const { width, layout } of SCROLLERS)
				for (const density of DENSITIES)
					/* Three states, not two — see the note beside the init script in runCell():
					 * the engine working, the engine off with the theme knowing, and the engine
					 * off with the theme still trusting it. The third costs what the second does
					 * (TICK and REPEAT skip it), and it is the only one that exercises
					 * `lateDrift()` as the page's ONLY corrector without waiting for a loaded
					 * runner to arrange it. */
					groups.push([ { noEngineAnchor: false }, { noEngineAnchor: true }, { declines: true } ]
						.map((mode) => ({ PAGE, width, layout, density, ...mode })));
		const twin = PAIRS.get(stand.id);
		const workers = twin ? [ stand.base, twin.base ] : [ stand.base ];
		/* Split evenly across the pair rather than handing the twin a copy of the same list — every
		 * cell still runs exactly once, on whichever of the two containers gets to it, so the sweep
		 * is exactly as wide as before and the wall clock for THIS stand is roughly halved. */
		const perWorker = workers.map(() => []);
		groups.forEach((g, i) => perWorker[i % workers.length].push(...g));
		const sessions = await Promise.all(workers.map((base) => captureSession(browser, base, stand.id)));
		await Promise.all(workers.map(async (base, wi) => {
			for (const cell of perWorker[wi]) {
				/* --bail: the cells after the first finding measure the same fix attempt again */
				if (BAIL && findings.length) return;
				await runCell(browser, engine, stand.id, base, sessions[wi], cell);
			}
		}));
	}));
	await browser.close();
}));
const unanswered = reportDown('scroll-anchor', down);

if (unopened.length) {
	console.error(`\nscroll-anchor: ${unopened.length} cell(s) never opened — the browser or the stand,`
		+ ' not the theme:\n');
	for (const u of unopened) console.error('  ' + u);
	console.error('\nA page that did not load measured nothing about the reader. Tell the two apart by'
		+ '\nre-running the same cell: a real anchor finding reproduces, a runner does not.\n');
}

if (findings.length) {
	console.error(`\nscroll-anchor: ${findings.length} finding(s)\n`);
	for (const f of findings) console.error('  ' + f);
	console.error('\nfs-fit.js keeps the reader\'s place where the engine does not (ENGINE_ANCHORS), and must');
	console.error('stay out of the way where it does. docs/chrome.md.\n');
	process.exit(1);
}
if (unanswered) process.exit(1);

/* Bulk failure to open is its own defect: the sweep did not measure what it claims to have. */
if (unopened.length && unopened.length > Math.max(3, (runs + unopened.length) * UNOPENED_TOLERANCE)) {
	console.error(`scroll-anchor: ${unopened.length} of ${runs + unopened.length} cell(s) never opened `
		+ '— too many to call the runner. Fix the stand or the browser, then re-run.\n');
	process.exit(1);
}
/* A sweep that measured nothing has not shown that the reader stays put, so it may not say so. */
if (!runs) {
	console.error(`\nscroll-anchor: 0 of ${ENGINES.length * list.length} engine/router cell(s) produced a run — every cell was skipped. `
		+ 'This is not a clean sweep; it is nothing measured.\n');
	process.exit(1);
}
console.log(`scroll-anchor: ${runs} run(s), the reader stayed put with and without the engine's own anchoring.`);
