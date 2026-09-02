#!/usr/bin/env node
/* The poll floor, asked the three questions no other gate asks: is it the RIGHT height, does it
 * ever come off, and does it come off IN TIME?
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
 *   of the sweep's selector, so a floor is found here by the inline `min-height` it IS. The 0.14.4
 *   shape marked each one with an attribute and was reverted with the rest of that release's
 *   anchoring; this gate outlived it.
 *
 * Both were shipped, four releases apart, and 0.14.3 had neither: it cleared every floor on every
 * tick and measured `offsetHeight` — correct, at 1550 style writes per 25 s of polling, each one a
 * scroll-anchoring suppression. This gate is what lets the cheaper shape stay: it holds it to the
 * old one's answer.
 *
 *   TOO LATE and it is the same blank page for as long as it stands. A tab switch writes
 *   `data-tab-active` and moves no node, so the sweep that takes the floor off has nothing to wake
 *   it: the pane the reader left kept 2432px of `min-height` on System -> Startup, and the tab they
 *   opened started below it — for one poll interval on a page that polls, and for the life of a
 *   page that does not (#75, forum posts 68 and 73). `min-height` beats the `height: 0` an inactive
 *   pane is collapsed with, which is why refusing to WRITE a floor there was never enough.
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
	for (const el of document.querySelectorAll('#view [style*="min-height"]')) {
		const floor = Math.round(parseFloat(el.style.minHeight) || 0);
		const keep = el.style.minHeight;
		el.style.minHeight = '';
		const bare = el.offsetHeight;
		el.style.minHeight = keep;
		out.push({ cls: (el.className || el.tagName).split(' ')[0], floor, bare, delta: floor - bare });
	}
	return { floors: out, unmarked: [] };
};

/* Switch to the next tab and read what the pane the reader LEFT is still wearing.
 *
 * The click is the real one — `ui.tabs` writes `data-tab-active` on the panes and moves no node, so
 * a synthetic attribute write would be measuring this gate rather than the theme. What must be true
 * the moment the switch lands: no inactive pane carries an inline `min-height`. It is checked after
 * a beat rather than in the same frame because the sweep runs from a MutationObserver callback, one
 * microtask after the attribute. */
const TAB_SWITCH = () => {
	const tabs = [ ...document.querySelectorAll('#view .cbi-tabmenu li a') ];
	if (tabs.length < 2) return null;
	const panes = () => [ ...document.querySelectorAll('#view [data-tab-title]') ];
	const open = panes().find((p) => p.getAttribute('data-tab-active') === 'true');
	const from = open ? open.getAttribute('data-tab-title') : '?';
	const doc = document.documentElement.scrollHeight;
	const next = tabs.findIndex((a) => a.parentElement.className.indexOf('cbi-tab-disabled') !== -1);
	tabs[next === -1 ? 1 : next].click();
	return { from, doc };
};

const TAB_AFTER = () => {
	const panes = [ ...document.querySelectorAll('#view [data-tab-title]') ];
	const open = panes.find((p) => p.getAttribute('data-tab-active') === 'true');
	return {
		to: open ? open.getAttribute('data-tab-title') : '?',
		/* the pane the reader can see must start where the page starts, and the ones they cannot
		 * must hold nothing up */
		openTop: open ? Math.round(open.getBoundingClientRect().top + window.scrollY) : null,
		stale: panes.filter((p) => p.getAttribute('data-tab-active') !== 'true' && p.style.minHeight)
			.map((p) => (p.getAttribute('data-tab-title') || '?') + '=' + p.style.minHeight),
		doc: document.documentElement.scrollHeight,
	};
};

/* Empty the tallest floored box the way a tick does, and DO NOT refill it: a container that is not
 * coming back must not keep holding the page open. Returns what to look at afterwards. */
const EMPTY_TALLEST = () => {
	const el = [ ...document.querySelectorAll('#view [style*="min-height"]') ]
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
	         min: el.style.minHeight,
	         /* WHAT THE EMPTY BOX STANDS AT WITH NO FLOOR UNDER IT. A box empty of children is not
	          * empty of padding and border, and a floor at exactly that height holds nothing up:
	          * /admin/network/network's section measures 34px either way. The blank page is a floor
	          * TALLER than the box, so the two are asked apart the way the theme itself does it —
	          * clear, measure, put back. */
	         bare: (() => {
	                 const was = el.style.minHeight;
	                 el.style.minHeight = '';
	                 const h = Math.round(el.getBoundingClientRect().height);
	                 el.style.minHeight = was;
	                 return h;
	         })(),
	         h: Math.round(el.getBoundingClientRect().height), doc: document.documentElement.scrollHeight };
};

/* One poll interval is what the theme waits before deciding a container is not refilling, so the
 * release cannot be seen sooner than that. Two of them plus a second of slack. */
const RELEASE_WAIT = Number(arg('wait', '0')) || 13000;

const list = requireStands(stands(arg('only', ''), { all: process.argv.includes('--all') }), 'floor-contract');
const browser = await chromium.launch();
const findings = [];
let boxes = 0, worst = 0, released = 0, switches = 0;

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

		/* …and the switch, on a page that has a tab strip. Before the release test, which empties
		 * a box: the floors this reads are the ones a settled page wrote. */
		const tabBefore = await page.evaluate(TAB_SWITCH);
		if (tabBefore) {
			await page.waitForTimeout(600);
			const tabAfter = await page.evaluate(TAB_AFTER);
			if (tabAfter.stale.length)
				findings.push(`${where}: switching from "${tabBefore.from}" to "${tabAfter.to}" left `
					+ `${tabAfter.stale.join(', ')} on a pane the reader cannot see — that floor IS blank `
					+ `page above the tab they opened, document ${tabBefore.doc} -> ${tabAfter.doc}, `
					+ `its content ${tabAfter.openTop}px down`);
			else
				process.stdout.write(`  ${where}  tab "${tabBefore.from}" -> "${tabAfter.to}": no floor left `
					+ `standing, document ${tabBefore.doc} -> ${tabAfter.doc}\n`);
			switches++;
		}

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
		const held = after.min ? Math.round(parseFloat(after.min) - after.bare) : 0;
		if (held > SLACK)
			findings.push(`${where}: ${before.cls} emptied and left empty still wears ${after.min} `
				+ `after ${Math.round(RELEASE_WAIT / 1000)}s — ${held}px more than the empty box `
				+ `stands at (${after.bare}px), which is that much page holding nothing, `
				+ `document ${before.doc} -> ${after.doc}`);
		process.stdout.write(`  ${where}  emptied ${before.cls}: ${before.min} -> `
			+ `${after.min ? after.min + ' over ' + after.bare + 'px of box' : 'released'}, `
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
	+ `${released} released after emptying, ${switches} released on a tab switch.`);
