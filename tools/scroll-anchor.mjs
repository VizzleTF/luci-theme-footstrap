#!/usr/bin/env node
/* The reader's place, on an engine that will not keep it.
 *
 * A poll tick changes the height of things above the reader and the page below moves. Chromium and
 * Firefox hide that with scroll anchoring; WebKit has never implemented it, so on Safari and on
 * every iPhone the same tick moves the page under the reader's thumb.
 *
 * The theme does that job where nobody else does (fs-fit.js, ENGINE_ANCHORS). This gate holds both
 * halves of that sentence, since both can break silently:
 *
 *   held      with the engine's anchoring suppressed AND the theme's fallback forced on, a growth
 *             above the fold must move the reader by no more than a pixel or two.
 *   floor     the same refill with the correction switched off (`fsAnchor = 'off'`): the content
 *             column holds its height between ticks, so the document never gets short enough to be
 *             clamped. It can only be measured with the other half silent.
 *   swapped   a section refilled the way `dom.content()` refills one — emptied, then filled again —
 *             must leave the reader where they were too. The moment in between has no height, and
 *             `held` cannot see that: a growth only ever inserted never collapses anything.
 *   not twice with the engine's anchoring left alone, the same growth must move the reader just as
 *             little — a fallback that also ran there would throw the page the other way.
 *   quiet     while the reader is SCROLLING the theme must not correct at all: a correction landing
 *             inside a flick is itself a jump.
 *
 * The growth is inserted rather than waited for: a real tick depends on what the router's radios are
 * doing, and a gate that only fails when a station happens to join is not a gate.
 *
 *   node tools/scroll-anchor.mjs [--only owrt2512] [--engines chromium,firefox] [--widths 390,1440]
 *
 * Needs a running owlab router (docs/development.md). */
import * as pw from 'playwright';
import { stands, login, requireStands } from './lib/stands.mjs';

const arg = (name, dflt) => {
	const i = process.argv.indexOf('--' + name);
	return i === -1 ? dflt : process.argv[i + 1];
};
const ENGINES = arg('engines', 'chromium').split(',').map((s) => s.trim()).filter(Boolean);
const WIDTHS = arg('widths', '390,1440').split(',').map(Number);
/* Two shapes, not one page: the Overview is sections with tables inside them, Processes a single
 * table that is a direct child of `#view`. That difference decides which element the theme can
 * anchor on — on the second shape the climb out of the table used to land on the host and give up,
 * so nothing held the reader at all, on every engine, while a gate that only opened the first shape
 * passed throughout. `--page a,b` overrides. */
const PAGES = arg('page', '/admin/status/overview,/admin/status/processes')
	.split(',').map((p) => p.trim()).filter(Boolean);
/* both layouts: they scroll different elements, and the correction has to find the right one */
const LAYOUTS = [ 'side', 'top' ];
/* AND EVERY DENSITY, because the axis moves the geometry this gate is about: type and spacing scale,
 * so a section is a different height, the fold falls on a different element, and the hit test that
 * finds the reference lands somewhere else. `--density normal` narrows it when iterating. */
const DENSITIES = arg('density', 'normal,compact,large').split(',').map((d) => d.trim()).filter(Boolean);
const GROWTH = 120;
/* a rect edge lands on a fraction; two pixels is not a jump */
const TOLERANCE = 2;

/* Park the reader and wait for the THEME to notice, rather than for a stopwatch.
 *
 * A probe scrolls the page and then has to let the theme settle: fs-fit treats the reader as moving
 * until SCROLL_IDLE (400 ms) of stillness and only then remembers where the page stands — the
 * reference every correction is measured against. A flat wait is a race WebKit loses: a programmatic
 * `scrollTop` write there does not fire `scroll` on the next frame, it arrives up to 1.2 seconds
 * later, so the sampler had not begun settling when the probe grew the page (measured: three
 * findings on WebKit, none on the other two engines, with the theme identical).
 *
 * So the wait is on the EVENT and then on the idle window, both bounded. */

/* Runs in the page: park the reader, grow something above them, report what they saw. */
const HOLD = async (growth) => {
	const wait = (ms) => new Promise((r) => setTimeout(r, ms));
	const view = document.getElementById('view');
	if (!view || view.children.length < 2) return { skip: 'nothing to grow' };
	const mc = document.getElementById('maincontent');
	const flow = mc ? getComputedStyle(mc).overflowY : '';
	const sc = (flow === 'auto' || flow === 'scroll') ? mc : null;
	const pos = () => (sc ? sc.scrollTop : window.scrollY);

	const room = (sc ? sc.scrollHeight - sc.clientHeight : document.documentElement.scrollHeight - window.innerHeight);
	if (room < 600) return { skip: 'page too short to scroll' };
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
		try {
			const fit = await window.L.require('fs-fit');
			/* until the theme has taken a reference AT THIS OFFSET. "Is it scrolling" cannot answer
			 * that: it says no both before the motion sampler starts and after it finishes, and in
			 * WebKit those are 1.5s apart — the probe grew the page in between, while the theme still
			 * had no reference, and the gate reported a jump on every WebKit run and none on the
			 * other two engines with the theme identical on all three. */
			for (let i = 0; i < 160; i++) {
				if (fit.restAt() === (sc ? sc.scrollTop : window.scrollY) && !fit.scrolling()) break;
				await wait(25);
			}
		} catch (e) { /* no module, fall back to the wait below */ }
		await wait(600);		/* the still moment the theme measures from */
	};
	await parkAt(at);

	/* The host is not a mark, and taking it as one makes this gate report a jump that is its own:
	 * `#view` is a `.cbi-section` gap wide enough to hit at 390px, its own top does not move when the
	 * pad grows INSIDE it, and a correctly compensated page then reads as -120px. Measured: on
	 * 25.12's Overview every point down the middle answered `#view`, so all eight runs on that
	 * release reported "no content under the reader" and measured nothing.
	 *
	 * So the whole STACK at the point is read rather than the topmost element — the section a grid
	 * gap belongs to is right underneath it — and two more rows are tried before giving up, a gap
	 * being a gap only at the y it was measured at. */
	const markAt = (y, x) => {
		for (const el of document.elementsFromPoint(x, y))
			if (el !== view && view.contains(el)) return el;
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

	const pad = document.createElement('div');
	pad.style.height = growth + 'px';
	view.insertBefore(pad, view.firstChild);
	await wait(800);

	const after = { pos: pos(), top: mark.isConnected ? Math.round(mark.getBoundingClientRect().top) : null };
	pad.remove();
	return { before, after, moved: after.top === null ? null : after.top - before.top,
		scrollDelta: after.pos - before.pos, scroller: sc ? 'maincontent' : 'window' };
};

/* Runs in the page: a poll tick the way LuCI actually performs one — `dom.content()` empties the
 * section before it refills it — and reports where that left the reader.
 *
 * Not the HOLD case above: HOLD inserts a pad, so the page only ever gets TALLER and the reference
 * the theme keeps stays valid. A real tick passes through a moment where the section has no height
 * at all, and a document that short is one the engine clamps the offset into; the section fills
 * again, nobody puts the offset back, and the reader is somewhere else. */
const SWAP = async (growth) => {
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
	 * consecutive runs. HOLD and QUIET only insert a pad of their own, so a tick underneath them is
	 * noise they survive. */
	const poll = (window.L && window.L.Poll) || null;
	const polling = !!(poll && typeof poll.active === 'function' && poll.active());
	if (polling) poll.stop();
	try {

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
		try {
			const fit = await window.L.require('fs-fit');
			/* until the theme has taken a reference AT THIS OFFSET. "Is it scrolling" cannot answer
			 * that: it says no both before the motion sampler starts and after it finishes, and in
			 * WebKit those are 1.5s apart — the probe grew the page in between, while the theme still
			 * had no reference, and the gate reported a jump on every WebKit run and none on the
			 * other two engines with the theme identical on all three. */
			for (let i = 0; i < 160; i++) {
				if (fit.restAt() === (sc ? sc.scrollTop : window.scrollY) && !fit.scrolling()) break;
				await wait(25);
			}
		} catch (e) { /* no module, fall back to the wait below */ }
		await wait(600);		/* the still moment the theme measures from */
	};
	await parkAt(at);

	/* The tallest section body that is ENTIRELY ABOVE the viewport, and both halves matter. Tall,
	 * because the clamp only bites when what the swap takes away is more than the room left below the
	 * reader. Above, because "the reader must not move" is only true of a change above them: a
	 * section that straddles the fold is one the theme anchors INSIDE, and content growing below that
	 * anchor is supposed to move. */
	/* What a poll actually replaces, not one page's idea of it. Looking for `.cbi-section > div` alone
	 * is the Overview's shape, so the gate measures this fault there and nowhere else: Processes,
	 * Routes and the realtime pages are a TABLE inside the section, and `L.ui.Table` refreshes by
	 * replacing its rows — the same collapse with a different parent — so every one of those runs
	 * reported "no section body big enough to collapse" and passed on the engine where the fault is
	 * real. */
	let body = null;
	/* What a poll replaces, and nothing wider. `:scope > div` also matches `.fs-ovl`, the theme's own
	 * wrapper around System/Memory/Storage, so the probe deletes three whole sections at once, which
	 * no poll does — the stock one refreshes a section's BODY in place. The theme's reference lives
	 * inside that grid, so removing all of it takes the reference and its fallback together and the
	 * gate reports a jump the theme could not have prevented. A section body, a table, a table's
	 * body: those are the three things `dom.content()` is called on. */
	for (const el of view.querySelectorAll('.cbi-section > div, .table > .tbody, .table')) {
		if (el.getBoundingClientRect().bottom > 0) continue;		/* must be entirely above the reader */
		if (el.contains(view) || el === view) continue;
		if (!body || el.offsetHeight > body.offsetHeight) body = el;
	}
	if (!body || body.offsetHeight < 200) return { skip: 'nothing above the reader big enough to collapse' };

	/* the whole STACK at the point, not just the topmost element: in a grid gap the top of the
	 * stack is `#view` itself — a host is not a mark, its own top does not move when something
	 * grows INSIDE it — and the section that gap belongs to is right underneath it. Measured: on
	 * 25.12's Overview every point down the middle answered `#view`, so all eight runs on that
	 * release reported "no content under the reader" and measured nothing. */
	const markAt = (y, x) => {
		for (const el of document.elementsFromPoint(x, y))
			if (el !== view && view.contains(el) && !body.contains(el)) return el;
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

	/* the two halves of dom.content(), with the layout the engine performs in between made explicit
	 * — WebKit gets there on its own, and a gate must not depend on when */
	const swap = async () => {
		const kept = Array.prototype.slice.call(body.childNodes);
		for (const n of kept) body.removeChild(n);
		const empty = { docH: (sc ? sc.scrollHeight : document.documentElement.scrollHeight), pos: pos() };
		for (const n of kept) body.appendChild(n);
		const pad = document.createElement('div');
		pad.style.height = growth + 'px';
		pad.dataset.fsProbe = '1';
		body.appendChild(pad);
		await wait(800);
		const after = { pos: pos(), top: mark.isConnected ? Math.round(mark.getBoundingClientRect().top) : null };
		pad.remove();
		await wait(700);		/* let the floor come back down before the next pass measures */
		return { empty, after, moved: after.top === null ? null : after.top - before.top,
			clamped: before.pos - empty.pos };
	};

	const corrected = await swap();

	/* THE SAME SWAP WITH THE CORRECTION SWITCHED OFF, which is what isolates the other half. The
	 * content column keeps a floor between ticks (fs-fit.js, holdFloor), so a section emptying inside
	 * it takes nothing off the document and there is nothing for the engine to clamp into. With
	 * `fsAnchor = 'off'` the theme writes no offset at all, so anything that still moves the reader
	 * here is the floor failing rather than the correction covering for it. */
	let floorOnly = { skip: 'no storage' };
	try {
		localStorage.setItem('fsAnchor', 'off');
		floorOnly = await swap();
	} catch (e) { /* no storage, no second pass */ }
	finally { try { localStorage.removeItem('fsAnchor'); } catch (e) { /* … */ } }

	return { before, empty: corrected.empty, after: corrected.after, moved: corrected.moved,
		clamped: corrected.clamped, floorMoved: floorOnly.skip ? null : floorOnly.moved,
		floorClamped: floorOnly.skip ? null : floorOnly.clamped,
		scroller: sc ? 'maincontent' : 'window' };

	} finally { if (polling) poll.start(); }
};

/* Runs in the page: a scripted flick up and down while ticks land, reporting any offset change the
 * wheel did not ask for. */
const QUIET = async (growth) => {
	const wait = (ms) => new Promise((r) => setTimeout(r, ms));
	const view = document.getElementById('view');
	const mc = document.getElementById('maincontent');
	const flow = mc ? getComputedStyle(mc).overflowY : '';
	const sc = (flow === 'auto' || flow === 'scroll') ? mc : null;
	const pos = () => (sc ? sc.scrollTop : window.scrollY);
	const room = (sc ? sc.scrollHeight - sc.clientHeight : document.documentElement.scrollHeight - window.innerHeight);
	if (room < 600) return { skip: 'page too short to scroll' };

	/* A FLICK THAT NEVER REACHES AN EDGE. Assigning a scrollTop that is already the current one
	 * fires no scroll event, so a run of steps clamped at 0 or at the bottom is a page standing
	 * still — 400 ms of that and the theme is right to put the pending growth back, which is the
	 * theme's contract and not a jump. So the travel is kept inside the page: a margin at each end,
	 * and a step small enough that six of them fit between the two. */
	const edge = Math.max(80, Math.min(200, Math.round(room * 0.15)));
	const lo = edge, hi = room - edge;
	/* six steps out and six back, from the MIDDLE of that band: half the band is what one direction
	 * gets, so the step is a twelfth of it. Measured on the stands, where the Overview has 1582px of
	 * room at 1440 and 4355 at 390 — the old fixed 160px reached the bottom in three steps at 1440
	 * and stood there for the rest of the half-cycle, which is how a page nobody was scrolling came
	 * to be measured as a flick. */
	const reach = Math.max(40, Math.min(160, Math.floor((hi - lo) / 12)));

	let unexplained = 0, biggest = 0, expected = 0, stalls = 0;
	let last = Math.round((lo + hi) / 2);
	if (sc) sc.scrollTop = last; else window.scrollTo(0, last);
	await wait(700);
	last = pos();
	let lastAt = Date.now();
	let movedAt = Date.now();
	for (let i = 0; i < 24; i++) {
		const step = (i % 12 < 6) ? reach : -reach;
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
			else { unexplained++; biggest = Math.max(biggest, off); }
		}
		last = now;
	}
	view.querySelectorAll('[data-fs-probe]').forEach((el) => el.remove());
	return { unexplained, biggest, stalls };
};

const list = requireStands(stands(arg('only', ''), { all: process.argv.includes('--all') }), 'scroll-anchor');
const findings = [];
let runs = 0;

for (const engine of ENGINES) {
	if (!pw[engine]) { console.error(`scroll-anchor: no such engine "${engine}"`); process.exit(1); }
	const browser = await pw[engine].launch();
	for (const stand of list) {
		for (const PAGE of PAGES)
		for (const w of WIDTHS) {
			for (const layout of LAYOUTS)
			for (const density of DENSITIES)
			for (const noEngineAnchor of [ false, true ]) {
				const ctx = await browser.newContext({ viewport: { width: w, height: 844 } });
				/* the Safari path, forced: `fsEngineAnchor=off` makes fs-fit believe the platform has
				 * no anchoring of its own, and the stylesheet turns the engine's off for real, so the
				 * two agree about which of them is responsible */
				if (noEngineAnchor)
					await ctx.addInitScript(() => {
						try { localStorage.setItem('fsEngineAnchor', 'off'); } catch (e) { /* no storage */ }
						document.addEventListener('DOMContentLoaded', () => {
							const s = document.createElement('style');
							s.textContent = 'html, body, #maincontent, .fs-main, #view, #view * { overflow-anchor: none !important; }';
							document.head.appendChild(s);
						});
					});
				const page = await ctx.newPage();
				await login(page, stand.base);
				try {
					await page.evaluate(async ([l, d]) => {
						const prefs = await window.L.require('fs-prefs');
						prefs.applyLayout(l);
						prefs.applyDensity(d);
					}, [ layout, density ]);
					await page.goto(stand.base + PAGE, { waitUntil: 'domcontentloaded', timeout: 20000 });
				}
				catch (e) { await ctx.close(); continue; }
				await page.waitForTimeout(3000);

				const where = `${engine} ${stand.id} @${w} ${layout.padEnd(4)} ${density.padEnd(7)} ${noEngineAnchor ? 'engine-anchoring OFF' : 'engine-anchoring on '} ${PAGE.replace('/admin/status/', '')}`;
				let held, swap, quiet;
				try {
					held = await page.evaluate(HOLD, GROWTH);
					swap = await page.evaluate(SWAP, GROWTH);
					quiet = await page.evaluate(QUIET, GROWTH);
				}
				catch (e) { await ctx.close(); continue; }

				if (held.skip || quiet.skip) {
					process.stdout.write(`  ${where}: ${held.skip || quiet.skip}\n`);
					await ctx.close();
					continue;
				}
				runs++;
				if (held.moved === null)
					findings.push(`${where}: the reader's element was replaced mid-measurement, so nothing was proven`);
				else if (Math.abs(held.moved) > TOLERANCE)
					findings.push(`${where}: ${GROWTH}px grew above the reader and the page moved ${held.moved}px under them`);
				if (swap.skip)
					process.stdout.write(`  ${where}: the swap measured nothing (${swap.skip})\n`);
				else if (swap.moved === null)
					findings.push(`${where}: the reader's element did not survive the swap, so nothing was proven`);
				else if (Math.abs(swap.moved) > TOLERANCE)
					findings.push(`${where}: a section was refilled the way a poll refills one and the page moved `
						+ `${swap.moved}px under the reader (the engine clamped ${swap.clamped}px of offset away)`);
				/* The floor is judged on the CLAMP, not on the movement, and only where the theme owns the job:
				 * with the correction switched off nobody compensates the pad the probe grows, so the
				 * reader moves by exactly that and should. What must not happen is the engine taking an
				 * offset away. Where the engine anchors for itself the same subtraction measures its
				 * compensation rather than a clamp — 629px of it, and the reader still level — so it is
				 * printed rather than judged. */
				if (noEngineAnchor && swap.floorClamped !== null && swap.floorClamped !== undefined && swap.floorClamped > TOLERANCE)
					findings.push(`${where}: with the correction switched off the engine clamped `
						+ `${swap.floorClamped}px away — the content column's floor is not holding the document up`);
				if (quiet.unexplained)
					findings.push(`${where}: the offset moved on its own ${quiet.unexplained} time(s) mid-flick (worst ${quiet.biggest}px) `
						+ '— a correction landing inside a scroll is itself a jump');
				process.stdout.write(`  ${where}  reader moved ${held.moved}px (scroll ${held.scrollDelta >= 0 ? '+' : ''}${held.scrollDelta}, `
					+ `${held.scroller})  swap moved ${swap.skip ? '-' : swap.moved + 'px'}`
					+ `  floor alone: clamped ${swap.skip || swap.floorClamped === null ? '-' : swap.floorClamped + 'px'}`
					+ `, reader ${swap.skip || swap.floorMoved === null ? '-' : swap.floorMoved + 'px'}`
					+ `  mid-flick surprises ${quiet.unexplained}`
					+ (quiet.stalls ? `  (${quiet.stalls} step(s) too slow to still be a flick, not counted)` : '') + '\n');
				await ctx.close();
			}
		}
	}
	await browser.close();
}

if (findings.length) {
	console.error(`\nscroll-anchor: ${findings.length} finding(s)\n`);
	for (const f of findings) console.error('  ' + f);
	console.error('\nfs-fit.js keeps the reader\'s place where the engine does not (ENGINE_ANCHORS), and must');
	console.error('stay out of the way where it does. docs/chrome.md.\n');
	process.exit(1);
}
console.log(`scroll-anchor: ${runs} run(s), the reader stayed put with and without the engine's own anchoring.`);
