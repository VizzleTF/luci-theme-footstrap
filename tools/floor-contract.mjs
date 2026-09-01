#!/usr/bin/env node
/* The poll floor, asked the two questions no other gate asks: is it the RIGHT height, and does it
 * ever come off?
 *
 * `holdFloor()` in fs-fit.js pins `min-height` on the containers a poll empties, so the document
 * cannot get shorter under the reader while `dom.content()` refills them (docs/anchoring.md). Both
 * ways of getting that wrong ship as the same symptom — blank page — and neither is visible in a
 * file or on a page that is merely loaded:
 *
 *   TOO SHORT and the floor does not hold: `.cbi-section-descr` on /admin/network/dhcp measured
 *   115px against the 156px it stands at, because the span was taken to the last ELEMENT and that
 *   box ends in text. 41px the document may shrink during the tick the floor exists for.
 *
 *   TOO TALL, or never taken off, and the floor IS the blank page: a section emptied of its table
 *   kept 1299px of `min-height` for the life of the page, and the reader's tab started that far
 *   down (issue #41). A box qualifies for a floor through its CHILDREN, so emptying it takes it out
 *   of the sweep's selector — which is why every floor is marked `data-fs-floor` and found again by
 *   the mark.
 *
 * Both were shipped, four releases apart, and 0.14.3 had neither: it cleared every floor on every
 * tick and measured `offsetHeight` — correct, at 1550 style writes per 25 s of polling, each one a
 * scroll-anchoring suppression. This gate is what lets the cheaper shape stay: it holds it to the
 * old one's answer.
 *
 *   node tools/floor-contract.mjs [--only owrt2512] [--all] [--pages /admin/network/network,…]
 *
 * Needs a running owlab router (docs/development.md). */
import { chromium } from 'playwright';
import { stands, login, requireStands, sealToRouter } from './lib/stands.mjs';

const arg = (name, dflt) => {
	const i = process.argv.indexOf('--' + name);
	return i === -1 ? dflt : process.argv[i + 1];
};

/* Pages that carry the three shapes a floor is written on: a tabbed map of tables (Interfaces), a
 * status page of tables a poll rewrites (Overview), and a form page whose sections end in prose —
 * the shape that caught the short measurement. */
const PAGES = arg('pages', '/admin/network/network,/admin/status/overview,/admin/network/dhcp').split(',');

/* A floor is a lower bound on a height that is about to be replaced, not a layout the page is drawn
 * to, so it may sit a pixel or two off what the box measures: a collapsed bottom margin on the last
 * child is not in the span, and both numbers are rounded. 4px is that slack and nothing more —
 * the faults this gate exists for were 41 and 98. */
const SLACK = Number(arg('slack', '4'));

/* What the 0.14.3 shape wrote, asked of every box wearing one of ours: take the floor off, read the
 * box, put it back. Expensive — a forced layout per box — which is why the theme does not do this
 * per tick and this gate does it once per page. */
const ACCURACY = () => {
	const out = [];
	for (const el of document.querySelectorAll('#view [data-fs-floor]')) {
		const floor = Math.round(parseFloat(el.style.minHeight) || 0);
		const keep = el.style.minHeight;
		el.style.minHeight = '';
		const bare = el.offsetHeight;
		el.style.minHeight = keep;
		out.push({ cls: (el.className || el.tagName).split(' ')[0], floor, bare, delta: floor - bare });
	}
	/* An inline min-height inside #view that carries no mark is either an app's own or a floor this
	 * sweep can no longer find — the second is the bug, and the two are told apart in the report. */
	const unmarked = [ ...document.querySelectorAll('#view [style*="min-height"]:not([data-fs-floor])') ]
		.map((el) => (el.className || el.tagName).split(' ')[0]);
	return { floors: out, unmarked };
};

/* Empty the tallest floored box the way a tick does, and DO NOT refill it: a container that is not
 * coming back must not keep holding the page open. Returns what to look at afterwards. */
const EMPTY_TALLEST = () => {
	const el = [ ...document.querySelectorAll('#view [data-fs-floor]') ]
		.sort((a, b) => parseFloat(b.style.minHeight) - parseFloat(a.style.minHeight))[0];
	if (!el) return null;
	window.__fsFloorBox = el;
	while (el.firstChild) el.removeChild(el.firstChild);
	return { cls: (el.className || el.tagName).split(' ')[0], min: el.style.minHeight,
	         doc: document.documentElement.scrollHeight };
};

const AFTER = () => {
	const el = window.__fsFloorBox;
	/* A POLL MAY HAVE REPLACED THE BOX rather than refilled it — on the Overview it replaces whole
	 * sections — and a detached node keeps whatever inline style it died with. It holds nothing up,
	 * so it is not a stale floor and this gate must not report one: the page is judged by what is
	 * still in it. */
	return { inDoc: document.getElementById('view').contains(el),
	         /* …and a poll that REFILLED it earns its floor back, so the box is judged only while it
	          * is still empty. Both are true on the Overview, whose tick rewrites whole sections. */
	         empty: !el.childElementCount && !(el.textContent || '').trim(),
	         min: el.style.minHeight, marked: el.hasAttribute('data-fs-floor'),
	         h: Math.round(el.getBoundingClientRect().height), doc: document.documentElement.scrollHeight };
};

/* One poll interval is what the theme waits before deciding a container is not refilling, so the
 * release cannot be seen sooner than that. Two of them plus a second of slack. */
const RELEASE_WAIT = Number(arg('wait', '0')) || 13000;

const list = requireStands(stands(arg('only', ''), { all: process.argv.includes('--all') }), 'floor-contract');
const browser = await chromium.launch();
const findings = [];
let boxes = 0, worst = 0, released = 0;

for (const stand of list) {
	const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
	await sealToRouter(ctx, stand.base);
	const page = await ctx.newPage();
	await login(page, stand.base);

	for (const path of PAGES) {
		try { await page.goto(stand.base + path, { waitUntil: 'domcontentloaded', timeout: 20000 }); }
		catch (e) { continue; }
		/* long enough for a settled tick to have written the floors it is going to write */
		await page.waitForTimeout(7000);

		let r;
		try { r = await page.evaluate(ACCURACY); }
		catch (e) { continue; }
		const where = `${stand.id} ${path}`;
		if (!r.floors.length) { process.stdout.write(`  ${where}: no floor standing\n`); continue; }

		for (const f of r.floors) {
			boxes++;
			if (Math.abs(f.delta) > Math.abs(worst)) worst = f.delta;
			if (Math.abs(f.delta) > SLACK)
				findings.push(`${where}: the floor on ${f.cls} is ${f.floor}px where the box measures `
					+ `${f.bare}px (${f.delta > 0 ? '+' : ''}${f.delta}px) — ${f.delta > 0
						? 'that difference IS blank page' : 'the document may shrink by that much mid-tick'}`);
		}
		if (r.unmarked.length)
			process.stdout.write(`  ${where}: ${r.unmarked.length} unmarked inline min-height (${r.unmarked.join(', ')})\n`);

		process.stdout.write(`  ${where}  ${r.floors.length} floor(s), worst ${
			r.floors.reduce((a, f) => Math.abs(f.delta) > Math.abs(a) ? f.delta : a, 0)}px\n`);

		/* …and the release, on the tallest floor this page carries */
		const before = await page.evaluate(EMPTY_TALLEST);
		if (!before) continue;
		await page.waitForTimeout(RELEASE_WAIT);
		const after = await page.evaluate(AFTER);
		if (!after.inDoc || !after.empty) {
			process.stdout.write(`  ${where}  emptied ${before.cls}: the poll `
				+ `${after.inDoc ? 'refilled' : 'replaced'} the box, nothing to release\n`);
			continue;
		}
		released++;
		if (after.min)
			findings.push(`${where}: ${before.cls} emptied and left empty still wears ${after.min} `
				+ `after ${Math.round(RELEASE_WAIT / 1000)}s — ${after.h}px of page holding nothing, `
				+ `document ${before.doc} -> ${after.doc}`);
		else if (after.marked)
			findings.push(`${where}: ${before.cls} gave its floor back but kept data-fs-floor — the mark and `
				+ 'the style disagree about who wears one');
		process.stdout.write(`  ${where}  emptied ${before.cls}: ${before.min} -> ${after.min || 'released'}, `
			+ `document ${before.doc} -> ${after.doc}\n`);
	}
	await ctx.close();
}
await browser.close();

if (findings.length) {
	console.error(`\nfloor-contract: ${findings.length} finding(s)\n`);
	for (const f of findings) console.error('  ' + f);
	console.error('\nThe floor is written by holdFloor() in fs-fit.js and explained in docs/anchoring.md.');
	console.error('Too short and it does not hold; too tall, or never taken off, and it IS the blank page.\n');
	process.exit(1);
}
console.log(`floor-contract: ${boxes} floor(s) over ${list.length} router(s), worst ${worst}px against the box, `
	+ `${released} released after emptying.`);
