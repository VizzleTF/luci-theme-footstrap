#!/usr/bin/env node
/* The scroll gate: nothing may re-decide, blink or jump under a reader who is scrolling.
 *
 * fs-fit.js defers every layout-reading pass while the page moves and measures when the reader
 * stops. That promise exists only DURING a scroll, so this gate drives a real wheel and reports
 * four columns: `remedy` (a decided table changing mid-scroll; the contract is zero), `anchor`
 * (an element's document position moving), `shift` (layout-shift entries; Chromium only, the
 * others report -1) and `replaced` (tables the poll re-rendered in the window). The columns and
 * why every engine runs: docs/development.md, "The live gates", `scroll-jank`.
 *
 *   node tools/scroll-jank.mjs [--only owrt2512] [--all] [--engines chromium,firefox,webkit]
 *                              [--pages /admin/status/overview,…] [--widths 768,1440]
 *
 * Needs a running owlab router (docs/development.md). */
import * as pw from 'playwright';
import { stands, login, openPage, requireStands, sealToRouter, waitForPaint, eachStand, reportDown, tooManyUnopened } from './lib/stands.mjs';
import { parseFlags } from './lib/util.mjs';

const FLAGS = parseFlags('scroll-jank', {
	engines: { type: 'string', default: 'chromium' },
	pages: { type: 'string', default: '/admin/status/overview,/admin/status/processes' },
	widths: { type: 'string', default: '768,1440' },
	only: { type: 'string', default: '' }, all: { type: 'boolean', default: false },
});
const ENGINES = FLAGS.engines.split(',').map((s) => s.trim()).filter(Boolean);
/* Overview is the one that polls hardest and rebuilds whole tables; Processes is the widest data
 * table the stock menu has, i.e. the one carrying a remedy at the widths below. */
const PAGES = FLAGS.pages.split(',');
/* 768 is where the sidebar has just folded and a table still needs a remedy; 1440 is the desktop,
 * where the sidebar layout scrolls `.fs-main` rather than the document. */
const WIDTHS = FLAGS.widths.split(',').map(Number);
const LAYOUTS = [ 'side', 'top' ];

/* how far the anchor may drift, in CSS px: a fractional rect edge is not a jump */
const ANCHOR_TOLERANCE = 2;
/* Chromium's own layout-shift score for the scroll window. Not zero: an image or a font landing
 * mid-scroll shifts the page and is neither ours nor avoidable. */
const SHIFT_TOLERANCE = 0.02;

/* PAINTED and waitForPaint() are shared with spa-parity.mjs's Back case — both start on this same
 * Overview and hit this same late RPC — lib/stands.mjs. */

/* Installed in the page. Records into `window.__fsScroll` until told to stop. */
const ARM = () => {
	const st = { remedy: [], settle: [], replaced: 0, anchor: 0, anchorSettle: 0,
		shift: 0, shiftSettle: 0, long: 0, frames: 0, phase: 'motion' };
	window.__fsScroll = st;

	const REMEDY = [ 'fs-stacked', 'fs-drop-xs' ];
	/* the break column is read off the cells, not the table's `_fsBreakCol` expando: the expando
	 * survives a row swap, so rows a poll swapped in unmarked left the signature unchanged */
	const marks = (el) => REMEDY.filter((c) => el.classList.contains(c)).join(',') + '|' +
		[ ...el.querySelectorAll('.tr:not(.table-titles)') ].map((r) =>
			[ ...r.children ].findIndex((c) => c.classList.contains('fs-td-break'))).join('');
	const before = new Map();
	document.querySelectorAll('#view .table').forEach((t) => before.set(t, marks(t)));
	/* A poll tick on a marked table, performed on purpose: ui.Table.update keeps the <table> and swaps
	 * in fresh body rows with no break mark (the title row is left out: fs-select marks it on a
	 * re-walk but not on the first fit). No stock page both polls rows and carries a mark, so waiting
	 * for a real tick proves nothing; the mark has to be back by the next frame. */
	st.tick = () => {
		let n = 0;
		document.querySelectorAll('#view .table').forEach((t) => {
			if (!t.querySelector('.fs-td-break')) return;
			t.querySelectorAll('.tr:not(.table-titles)').forEach((r) => {
				const c = r.cloneNode(true);
				c.querySelectorAll('.fs-td-break').forEach((x) => x.classList.remove('fs-td-break'));
				r.replaceWith(c);
			});
			n++;
		});
		st.ticked += n;
	};
	st.ticked = 0;

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

	/* Chromium alone reports layout-shift; elsewhere the column stays -1 */
	st.shiftSeen = !!window.PerformanceObserver?.supportedEntryTypes?.includes('layout-shift');
	if (st.shiftSeen) new PerformanceObserver((l) => {
		for (const e of l.getEntries()) {
			if (e.hadRecentInput) continue;
			if (st.phase === 'motion') st.shift += e.value; else st.shiftSettle += e.value;
		}
	}).observe({ type: 'layout-shift', buffered: false });

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
 * their routers at once. `--all` takes every running OpenWrt router. */
const list = requireStands(stands(FLAGS.only, { all: FLAGS.all }), 'scroll-jank');
const findings = [];
/* Pages under test openPage gave up on: not findings, nothing was measured there. Printed, and fatal
 * only past tooManyUnopened's floor of 1 or its 2% of `attempted` (lib/stands.mjs). */
const unopened = [];
const down = [];
let runs = 0, attempted = 0;

for (const engine of ENGINES) {
	if (!pw[engine]) {
		console.error(`scroll-jank: no such engine "${engine}"`);
		process.exit(2);
	}
	let browser;
	try { browser = await pw[engine].launch(); }
	catch (e) {
		console.error(`\nscroll-jank: ${engine} will not launch here — install it with`);
		console.error(`  npx playwright install ${engine} && sudo npx playwright install-deps ${engine}\n`);
		process.exit(1);
	}

	down.push(...await eachStand(list, async (stand) => {
		for (const w of WIDTHS) {
			const ctx = await browser.newContext({ viewport: { width: w, height: 800 } });
			await sealToRouter(ctx, stand.base);
			const page = await ctx.newPage();
			await login(page, stand.base, stand.id);

			for (const layout of LAYOUTS) {
				/* chosen BEFORE the page under test is opened: switching it on that page schedules a
				 * re-fit of its own, which then lands inside the window this measures and is read as
				 * a mid-scroll re-decision that never happened */
				await openPage(page, stand.base + '/admin/status/overview');
				await page.waitForTimeout(1500);
				try {
					await page.evaluate(async (l) => {
						const prefs = await window.L.require('fs-prefs');
						prefs.applyLayout(l);
					}, layout);
				}
				catch (e) { continue; }		/* a document without the theme's JS has nothing to test */

				for (const path of PAGES) {
					const where = `${engine} ${stand.id} @${w} ${layout} ${path}`;
					attempted++;
					try { await openPage(page, stand.base + path); }
					catch (e) { unopened.push(`${where}: ${String(e.message).split('\n')[0]}`); continue; }
					/* wait for the real thing instead of a fixed clock: bounded at 20s, well past the
					 * ~17s worst case measured booting a single PR stand (tools/ci-boot.sh) */
					if (!await waitForPaint(page, 20000)) {
						findings.push(`${where}: page not painted, run proves nothing`);
						continue;
					}
					await page.waitForTimeout(400);		/* let the arrival settle: that is another gate's subject */
					try { await page.evaluate(ARM); } catch (e) { continue; }

					/* A REAL WHEEL, not scrollTo: the motion sampler listens on wheel/scroll/touch, and
					 * a programmatic jump exercises none of it. Up as well as down, and long enough
					 * that a poll tick lands inside — a 1.3 s flick never met one. */
					await page.mouse.move(Math.round(w / 2), 400);
					for (let i = 0; i < 44; i++) {
						await page.mouse.wheel(0, (i % 22 < 11) ? 180 : -180);
						if (i === 14 || i === 30) await page.evaluate(() => window.__fsScroll.tick());
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
								long: st.long, frames: st.frames, ticked: st.ticked, moved: st.maxTop - st.minTop,
								scrollable: st.scrollable, scroller: st.scroller, layout: st.layout };
						});
					}
					catch (e) { continue; }

					runs++;
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
						+ `remedy ${r.remedy.length}  polled-in ${r.replaced}  ticked ${r.ticked}  shift ${r.shift}  long ${r.long}/${r.frames}  `
						+ `[${r.layout} scrolls ${r.scroller}]  settle: remedy ${r.settle.length} anchor ${r.anchorSettle} shift ${r.shiftSettle}\n`);
				}
			}
			await ctx.close();
		}
	}, { serial: true }));
	await browser.close();
}
const unanswered = reportDown('scroll-jank', down);

if (unopened.length) {
	console.error(`\nscroll-jank: ${unopened.length} of ${attempted} page(s) never opened — the browser or the stand,`
		+ ' not the theme:\n');
	for (const u of unopened) console.error('  ' + u);
	console.error('\nA page that did not load measured nothing about the reader.\n');
}

if (findings.length) {
	console.error(`\nscroll-jank: ${findings.length} finding(s) — something moved under the reader:\n`);
	for (const f of findings) console.error('  ' + f);
	console.error('\nfs-fit.js defers every layout read while the page is moving and takes it when the');
	console.error('reader stops (docs/chrome.md). A finding here means a pass got through that.\n');
	process.exit(1);
}
if (unanswered) process.exit(1);
if (tooManyUnopened(unopened.length, attempted, 1)) {
	console.error(`scroll-jank: ${unopened.length} of ${attempted} page(s) never opened `
		+ '— too many to call the runner. Fix the stand or the browser, then re-run.\n');
	process.exit(1);
}
if (!runs) {
	console.error(`\nscroll-jank: 0 of ${ENGINES.length * list.length} engine/router cell(s) produced a scroll — the theme JS is absent `
		+ '(fs-prefs not requirable, e.g. owlab up --rebuild without sync) or every run failed. This is not a clean sweep; '
		+ 'it is nothing measured.\n');
	process.exit(1);
}
console.log(`\nscroll-jank: ${runs} scroll(s) across ${ENGINES.join(', ')}, nothing re-decided or jumped mid-scroll (${unopened.length} unopened).`);
