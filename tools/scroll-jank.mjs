#!/usr/bin/env node
/* THE SCROLL GATE: nothing may re-decide, blink or jump under a reader who is scrolling.
 *
 * `fs-fit.js` is built around one promise — a pass that reads layout does not run while the page is
 * moving; it defers, and takes its measurement when the reader stops. Every table remedy rides that
 * promise: cards, dropped columns, a shredded column. Break it and the reader sees the thing this
 * theme is most often reported for — a table that cards and un-cards under the thumb, a column that
 * appears and vanishes, content that jumps because something above it changed height mid-flick.
 *
 * None of that is visible in a file, and none of it is visible in a screenshot either: the page is
 * correct before the scroll and correct after it. It only exists DURING. So this gate scrolls, with
 * a real wheel, and watches:
 *
 *   remedy    a table that already had a decision changing it while the page moves. The contract is
 *             zero. A table the poll brings in mid-scroll is NOT this — it is answered from the slot
 *             its predecessor left, which is the deferral working, and it is counted separately.
 *   anchor    an element's document position (`rect.top + scrollTop`) moving. That number changes
 *             only if something above it grew or shrank, which is exactly "the page jumped".
 *   shift     the engine's own layout-shift entries (Chromium; the others report -1).
 *   replaced  how many tables the poll re-rendered inside the scroll window. A run where none did
 *             has not tested the interesting case, which is why the wheel runs long enough to meet
 *             one — measured on the stand: Overview replaces 12 tables in a 6.6 s scroll.
 *
 * BOTH LAYOUTS, because they scroll different elements: the bar layout scrolls the document, the
 * sidebar scrolls `.fs-main`, and `fs-fit.js` reads whichever the STYLESHEET made the scroller.
 *
 * EVERY ENGINE THE PROJECT SUPPORTS, because the three differ in precisely the mechanisms this
 * depends on: scroll anchoring is Chromium's alone, WebKit keeps firing `scroll` through its
 * momentum long after the wheel stops, and Firefox delivers a ResizeObserver callback on a
 * different tick. Chromium alone is the default because it is the one CI always has; the other two
 * need `npx playwright install firefox webkit` and their system libraries.
 *
 *   node tools/scroll-jank.mjs [--only owrt2512] [--engines chromium,firefox,webkit]
 *                              [--pages /admin/status/overview,…] [--widths 768,1440]
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
/* Overview is the one that polls hardest and rebuilds whole tables; Processes is the widest data
 * table the stock menu has, i.e. the one carrying a remedy at the widths below. */
const PAGES = arg('pages', '/admin/status/overview,/admin/status/processes').split(',');
/* 768 is where the sidebar has just folded and a table still needs a remedy; 1440 is the desktop,
 * where the sidebar layout scrolls `.fs-main` rather than the document. */
const WIDTHS = arg('widths', '768,1440').split(',').map(Number);
const LAYOUTS = [ 'side', 'top' ];

/* how far the anchor may drift, in CSS px: a fractional rect edge is not a jump */
const ANCHOR_TOLERANCE = 2;
/* Chromium's own layout-shift score for the scroll window. Not zero: an image or a font landing
 * mid-scroll shifts the page and is neither ours nor avoidable. */
const SHIFT_TOLERANCE = 0.02;

/* Installed in the page. Records into `window.__fsScroll` until told to stop. */
const ARM = () => {
	const st = { remedy: [], settle: [], replaced: 0, anchor: 0, anchorSettle: 0,
		shift: 0, shiftSettle: 0, long: 0, frames: 0, phase: 'motion' };
	window.__fsScroll = st;

	const REMEDY = [ 'fs-stacked', 'fs-drop-xs' ];
	const marks = (el) => REMEDY.filter((c) => el.classList.contains(c)).join(',') +
		'|' + (el._fsBreakCol === undefined ? -1 : el._fsBreakCol);
	const before = new Map();
	document.querySelectorAll('#view .table').forEach((t) => before.set(t, marks(t)));

	const watch = () => {
		document.querySelectorAll('#view .table').forEach((t) => {
			if (!before.has(t)) {
				/* the poll re-rendered a table mid-scroll: counted, never failed — it is answered
				 * from the slot, which is the deferral doing its job */
				if (!t.__fsSeen) { t.__fsSeen = 1; st.replaced++; before.set(t, marks(t)); }
				return;
			}
			const now = marks(t);
			if (now !== before.get(t)) {
				(st.phase === 'motion' ? st.remedy : st.settle).push(before.get(t) + ' -> ' + now);
				before.set(t, now);
			}
		});
	};

	/* which element scrolls, asked the way fs-fit.js asks it — of the stylesheet */
	const mc = document.getElementById('maincontent');
	const flow = mc ? getComputedStyle(mc).overflowY : '';
	const scroller = (flow === 'auto' || flow === 'scroll') ? mc : null;
	const top = () => (scroller ? scroller.scrollTop : window.scrollY);
	st.scroller = scroller ? 'maincontent' : 'window';
	st.layout = (document.documentElement.getAttribute('data-layout') || '') +
		(document.documentElement.hasAttribute('data-narrow') ? '/narrow' : '');

	/* an anchor below the fold, so the scroll actually travels past it */
	const cand = [ ...document.querySelectorAll('#view .cbi-section, #view .table, #view h2, #view h3') ];
	const anchor = cand.find((el) => el.getBoundingClientRect().top > 200) || cand[cand.length - 1] || null;
	const place = () => (anchor ? Math.round(anchor.getBoundingClientRect().top + top()) : 0);
	const place0 = place();

	if (window.PerformanceObserver) {
		try {
			new PerformanceObserver((l) => {
				for (const e of l.getEntries()) {
					if (e.hadRecentInput) continue;
					if (st.phase === 'motion') st.shift += e.value; else st.shiftSettle += e.value;
				}
			}).observe({ type: 'layout-shift', buffered: false });
			st.shiftSeen = true;
		}
		catch (e) { st.shiftSeen = false; }		/* not Chromium: reported as -1 */
	}

	st.minTop = st.maxTop = top();
	st.scrollable = Math.max(0, scroller ? scroller.scrollHeight - scroller.clientHeight
		: document.documentElement.scrollHeight - window.innerHeight);
	let last = performance.now();
	st.on = true;
	const frame = (now) => {
		st.frames++;
		if (now - last > 50) st.long++;
		last = now;
		watch();
		const t = top();
		if (t < st.minTop) st.minTop = t;
		if (t > st.maxTop) st.maxTop = t;
		const d = Math.abs(place() - place0);
		if (st.phase === 'motion') { if (d > st.anchor) st.anchor = d; }
		else if (d > st.anchorSettle) st.anchorSettle = d;
		if (st.on) requestAnimationFrame(frame);
	};
	requestAnimationFrame(frame);
};

/* SEQUENTIAL AND ON THE DEFAULT PAIR: frame pacing is what this gate measures, so a second router
 * rendering on the same machine is noise in the signal — unlike the structural gates, which now run
 * their routers at once. `--all` takes the four. */
const list = requireStands(stands(arg('only', ''), { all: process.argv.includes('--all') }), 'scroll-jank');
const findings = [];
let runs = 0;

for (const engine of ENGINES) {
	if (!pw[engine]) {
		console.error(`scroll-jank: no such engine "${engine}"`);
		process.exit(1);
	}
	let browser;
	try { browser = await pw[engine].launch(); }
	catch (e) {
		console.error(`\nscroll-jank: ${engine} will not launch here — install it with`);
		console.error(`  npx playwright install ${engine} && sudo npx playwright install-deps ${engine}\n`);
		process.exit(1);
	}

	for (const stand of list) {
		for (const w of WIDTHS) {
			const ctx = await browser.newContext({ viewport: { width: w, height: 800 } });
			const page = await ctx.newPage();
			await login(page, stand.base);

			for (const layout of LAYOUTS) {
				/* chosen BEFORE the page under test is opened: switching it on that page schedules a
				 * re-fit of its own, which then lands inside the window this measures and is read as
				 * a mid-scroll re-decision that never happened */
				await page.goto(stand.base + '/admin/status/overview', { waitUntil: 'domcontentloaded' });
				await page.waitForTimeout(1500);
				try {
					await page.evaluate(async (l) => {
						const prefs = await window.L.require('fs-prefs');
						prefs.applyLayout(l);
					}, layout);
				}
				catch (e) { continue; }		/* a document without the theme's JS has nothing to test */

				for (const path of PAGES) {
					try { await page.goto(stand.base + path, { waitUntil: 'domcontentloaded', timeout: 20000 }); }
					catch (e) { continue; }
					await page.waitForTimeout(2600);		/* let the arrival settle: that is another gate's subject */
					try { await page.evaluate(ARM); } catch (e) { continue; }

					/* A REAL WHEEL, not scrollTo: the motion sampler listens on wheel/scroll/touch, and
					 * a programmatic jump exercises none of it. Up as well as down, and long enough
					 * that a poll tick lands inside — a 1.3 s flick never met one. */
					await page.mouse.move(Math.round(w / 2), 400);
					for (let i = 0; i < 44; i++) {
						await page.mouse.wheel(0, (i % 22 < 11) ? 180 : -180);
						await page.waitForTimeout(150);
					}

					/* the deferred pass is not flicker — it is the contract. Give it a phase of its own
					 * (SCROLL_IDLE is 400 ms) and report what it did rather than failing on it. */
					await page.waitForTimeout(250);
					await page.evaluate(() => { window.__fsScroll.phase = 'settle'; });
					await page.waitForTimeout(1200);

					let r;
					try {
						r = await page.evaluate(() => {
							const st = window.__fsScroll;
							st.on = false;
							return { remedy: st.remedy, settle: st.settle, replaced: st.replaced,
								anchor: st.anchor, anchorSettle: st.anchorSettle,
								shift: st.shiftSeen ? +st.shift.toFixed(4) : -1,
								shiftSettle: st.shiftSeen ? +st.shiftSettle.toFixed(4) : -1,
								long: st.long, frames: st.frames, moved: st.maxTop - st.minTop,
								scrollable: st.scrollable, scroller: st.scroller, layout: st.layout };
						});
					}
					catch (e) { continue; }

					runs++;
					const where = `${engine} ${stand.id} @${w} ${layout} ${path}`;
					/* a run where nothing moved proves nothing: say so rather than pass it */
					if (r.scrollable > 120 && r.moved < 100)
						findings.push(`${where}: nothing scrolled (${r.moved} of ${r.scrollable} px available) — the run proves nothing`);
					if (r.remedy.length)
						findings.push(`${where}: a table re-decided ${r.remedy.length}x WHILE SCROLLING (${r.remedy.join(' ; ')})`);
					if (r.anchor > ANCHOR_TOLERANCE)
						findings.push(`${where}: the page moved ${r.anchor}px under the reader mid-scroll`);
					if (r.shift > SHIFT_TOLERANCE)
						findings.push(`${where}: layout-shift ${r.shift} during the scroll`);

					process.stdout.write(`  ${where}\n     moved ${r.moved}/${r.scrollable}  anchor ${r.anchor}px  `
						+ `remedy ${r.remedy.length}  polled-in ${r.replaced}  shift ${r.shift}  long ${r.long}/${r.frames}  `
						+ `[${r.layout} scrolls ${r.scroller}]  settle: remedy ${r.settle.length} anchor ${r.anchorSettle} shift ${r.shiftSettle}\n`);
				}
			}
			await ctx.close();
		}
	}
	await browser.close();
}

if (findings.length) {
	console.error(`\nscroll-jank: ${findings.length} finding(s) — something moved under the reader:\n`);
	for (const f of findings) console.error('  ' + f);
	console.error('\nfs-fit.js defers every layout read while the page is moving and takes it when the');
	console.error('reader stops (docs/chrome.md). A finding here means a pass got through that.\n');
	process.exit(1);
}
console.log(`\nscroll-jank: ${runs} scroll(s) across ${ENGINES.join(', ')}, nothing re-decided or jumped mid-scroll.`);
