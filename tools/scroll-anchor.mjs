#!/usr/bin/env node
/* THE READER'S PLACE, ON AN ENGINE THAT WILL NOT KEEP IT.
 *
 * A poll tick changes the height of things above the reader — a station joins the associated list, a
 * lease expires, an interface box grows a line — and the page below it moves. Chromium and Firefox
 * hide that with scroll anchoring: they compensate the offset so the reader stays where they were.
 * WebKit has never implemented it, so on Safari and on every iPhone the same tick moves the page
 * under the reader's thumb, which is what "the Overview jitters" is.
 *
 * The theme now does that job where nobody else does (`fs-fit.js`, ENGINE_ANCHORS). This gate holds
 * both halves of that sentence, because both can break silently:
 *
 *   held      with the engine's anchoring suppressed AND the theme's fallback forced on, a growth
 *             above the fold must move the reader by no more than a pixel or two. That is the
 *             Safari path, exercised on an engine CI actually has.
 *   floor    the same refill again with the correction switched off (`fsAnchor = 'off'`): the content
 *             column holds its height between ticks, so the document never gets short enough to be
 *             clamped and nothing has to be put back. This is the half that keeps the reader from
 *             seeing even a frame of it, and it can only be measured with the other half silent.
 *   swapped  a section refilled the way `dom.content()` refills one — emptied, then filled again —
 *             must leave the reader where they were too. The moment in between has no height, and a
 *             document that short is one the engine clamps the offset into; `held` cannot see that,
 *             because a growth that is only ever inserted never collapses anything.
 *   not twice with the engine's anchoring left alone, the same growth must move the reader just as
 *             little — a fallback that also runs there would correct what the engine already
 *             corrected and throw the page the other way.
 *   quiet     while the reader is SCROLLING, the theme must not correct at all: the compensation is
 *             for a page being read, not for one already moving, and a correction landing inside a
 *             flick is itself a jump. Measured as the scroll offset following the wheel and nothing
 *             else — a scripted flick up and down across several ticks.
 *
 * The growth is inserted rather than waited for: a real tick depends on what the router's radios are
 * doing, and a gate that only fails when a station happens to join is not a gate. `#view`'s first
 * child is the unambiguous place — everything below it moves, whatever either side considers "the
 * fold".
 *
 *   node tools/scroll-anchor.mjs [--only owrt2512] [--engines chromium,firefox] [--widths 390,1440]
 *
 * Needs a running owlab router (docs/development.md).
 */
import * as pw from 'playwright';
import { stands, login, requireStands } from './lib/stands.mjs';

const arg = (name, dflt) => {
	const i = process.argv.indexOf('--' + name);
	return i === -1 ? dflt : process.argv[i + 1];
};
const ENGINES = arg('engines', 'chromium').split(',').map((s) => s.trim()).filter(Boolean);
const WIDTHS = arg('widths', '390,1440').split(',').map(Number);
const PAGE = arg('page', '/admin/status/overview');
/* both layouts: they scroll different elements, and the correction has to find the right one */
const LAYOUTS = [ 'side', 'top' ];
const GROWTH = 120;
/* a rect edge lands on a fraction; two pixels is not a jump */
const TOLERANCE = 2;

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
	if (sc) sc.scrollTop = at; else window.scrollTo(0, at);
	/* past SCROLL_IDLE (400ms): inside it the theme treats the reader as still moving and anchors
	 * nothing on purpose, so a growth landing there would measure the guard instead of the anchor */
	await wait(1200);

	/* THE HOST IS NOT A MARK, and taking it as one made this gate report a jump that was its own.
	 * `#view` is a `.cbi-section` gap wide enough to hit at 390px, and `elementFromPoint` answers
	 * with the host there; the host's own top does not move when the pad grows INSIDE it, so a
	 * correctly compensated page reads as -120px. Measured on imm2410 at 390 in the top layout, both
	 * with the engine's anchoring and with the theme's, and on the released build as well — the
	 * instrument, not the theme. Two more rows are tried before giving up, because a gap is a gap
	 * only at the y it was measured at. */
	const markAt = (y) => {
		const el = document.elementFromPoint(Math.round((window.innerWidth || 800) / 2), y);
		return el && el !== view && view.contains(el) ? el : null;
	};
	const h = window.innerHeight || 800;
	const mark = markAt(Math.round(h * 0.6)) || markAt(Math.round(h * 0.5)) || markAt(Math.round(h * 0.7));
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
 * WHY THIS IS NOT THE `HOLD` CASE ABOVE. HOLD inserts a pad, so the page only ever gets TALLER and
 * the reference the theme keeps stays valid the whole time. A real tick passes through a moment
 * where the section has no height at all, and a document that short is a document the engine clamps
 * the offset into — the section fills again, nobody puts the offset back, and the reader is
 * somewhere else. That is the fault Safari reported after the anchoring above already shipped, and
 * HOLD could not see it: the growth it measures never collapses anything.
 *
 * The swap only ever GROWS the section (the same children back plus a pad), so a page parked near
 * the bottom cannot report the engine's honest end-of-document clamp as a jump. */
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

	/* THE ROUTER'S OWN POLL IS HELD FOR THE DURATION, and that is what makes this a measurement
	 * rather than a coin toss. This case performs a tick BY HAND — it has to, to control when the
	 * container is empty — and a real tick landing in the same window rewrites the very section
	 * being swapped, taking the probe's own pad with it. Measured before it was stopped: the same
	 * router and width reported 689px, 577px and 0px on three consecutive runs. `HOLD` and `QUIET`
	 * only ever insert a pad of their own, so a tick underneath them is noise they survive. */
	const poll = (window.L && window.L.Poll) || null;
	const polling = !!(poll && typeof poll.active === 'function' && poll.active());
	if (polling) poll.stop();
	try {

	/* as far down as the page goes: what the reader loses to a clamp is what is left below them */
	const at = room - 60;
	if (sc) sc.scrollTop = at; else window.scrollTo(0, at);
	await wait(1200);	/* past SCROLL_IDLE, so the theme has a reference from a still page */

	/* THE TALLEST SECTION BODY THAT IS ENTIRELY ABOVE THE VIEWPORT, and both halves of that matter.
	 * Tall, because the clamp only bites when what the swap takes away is more than the room left
	 * below the reader — a stock overview has one, the interface or the DHCP list. Above, because
	 * "the reader must not move" is only true of a change ABOVE them: a section that straddles the
	 * fold is a section the theme anchors INSIDE, and content growing below that anchor is content
	 * that is supposed to move. Measured at 390px before this was pinned down: the theme put the
	 * reference back exactly where it was and this still called the 120px below it a jump. */
	let body = null;
	for (const el of view.querySelectorAll('.cbi-section > div')) {
		if (el.getBoundingClientRect().bottom > 0) continue;
		if (!body || el.offsetHeight > body.offsetHeight) body = el;
	}
	if (!body || body.offsetHeight < 200) return { skip: 'no section body above the reader big enough to collapse' };

	const markAt = (y) => {
		const el = document.elementFromPoint(Math.round((window.innerWidth || 800) / 2), y);
		/* not the host itself — see markAt in HOLD above for the -120px it reported when it was */
		return el && el !== view && view.contains(el) && !body.contains(el) ? el : null;
	};
	const h = window.innerHeight || 800;
	const mark = markAt(Math.round(h * 0.6)) || markAt(Math.round(h * 0.5)) || markAt(Math.round(h * 0.7));
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
		/* WAS THIS STEP STILL PART OF A FLICK? The theme calls the reader "scrolling" until the
		 * offset has held still for SCROLL_IDLE (400 ms, fs-fit.js), and a step here is 70 ms — so on
		 * a machine that keeps up, the whole loop is one motion. A loaded CI runner does not always
		 * keep up: one step took longer than that, the theme rightly decided the reader had stopped
		 * and put the two pads' 240px back, and this pass counted the contract working as a
		 * surprise. A gap that long is not a flick any more, so the step is excluded — and counted
		 * and printed, because silence about it would make a run that measured nothing look like a
		 * run that found nothing. */
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
		for (const w of WIDTHS) {
			for (const layout of LAYOUTS)
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
					await page.evaluate(async (l) => { (await window.L.require('fs-prefs')).applyLayout(l); }, layout);
					await page.goto(stand.base + PAGE, { waitUntil: 'domcontentloaded', timeout: 20000 });
				}
				catch (e) { await ctx.close(); continue; }
				await page.waitForTimeout(3000);

				const where = `${engine} ${stand.id} @${w} ${layout.padEnd(4)} ${noEngineAnchor ? 'engine-anchoring OFF' : 'engine-anchoring on '}`;
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
				/* THE FLOOR IS JUDGED ON THE CLAMP, NOT ON THE MOVEMENT, and only where the theme owns the
				 * job. With the correction switched off nobody compensates the 120px the probe grows, so
				 * the reader moves by exactly that and should; what must not happen is the engine taking
				 * an offset away, which is the fault the floor prevents and the one nothing puts back.
				 * Where the engine anchors for itself the same subtraction measures its compensation
				 * rather than a clamp — 629px of it, and the reader still level — so it is not a verdict
				 * on anything and is printed rather than judged. */
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
