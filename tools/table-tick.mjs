#!/usr/bin/env node
/* The poll tick, performed on purpose: does a freshly replaced data table ever throw the reader
 * before anything has answered for it?
 *
 * luci-base's poll does not append a row, it REPLACES the table, and the replacement carries none of
 * the marks fs-select stamps. For the moment between landing and being stamped the table is a
 * full-width table — at 390px several screens taller than the card stack it is about to become — and
 * if anything forces layout in that moment the engine re-anchors on the intermediate and throws the
 * reader (612px out and back, twice per tick, on a live router at iPhone width — 2e83050).
 *
 * WHY A DELIBERATE TICK RATHER THAN WATCHING A REAL ONE. The intermediate lasts a microtask:
 * fs-select answers in a MutationObserver callback, before paint, so a per-frame sampler never sees
 * it — measured, with the rule removed, as 0 frames out of 108 while the page grew by 269px. The
 * only way to observe the state is to force layout inside that window, which is exactly what an app
 * reading a width right after rendering does, and what this reproduces.
 *
 * WHAT THIS USED TO MEASURE, AND WHY THAT WAS THE WRONG SIDE OF THE FIX. Before this file asserted
 * `.table.fs-dt:not(.fs-fitted)` had zero height — the exact selector `theme/30-tables.css` uses to
 * hide an unanswered table (`display: none`), and nothing else. That is the CSS rule restated, not
 * the reader's position: a fix that held the page still by some other means (an out-of-flow
 * placement, say) would have read as a failure here for carrying real height while never moving
 * anyone, and a regression that still threw the reader while `fs-select` had already stamped
 * `fs-fitted` on the box would have read as a clean pass, because the selector excludes it by
 * construction.
 *
 * WHAT IT MEASURES NOW. `.fs-footer` sits after every page's content in document order, on both
 * layouts, so its own document position (viewport top + scroll offset) is the sum of everything the
 * poll could have grown above the reader — the target table itself, whatever class it carries, or
 * anything else the tick touches. `before` is the footer's place with the OLD, already-answered
 * table still in the DOM; `during` is read synchronously, in the SAME task, right after the
 * replacement — before fs-select's microtask gets to answer for it; `after` is read once a
 * microtask turn and a frame have run, i.e. once fs-select (or whatever replaces it) has settled.
 * A table that is held out of the flow while unanswered — the theme's own choice — makes `during`
 * SMALLER than `before`/`after`, which is the accepted trade-off this file does not gate on; a table
 * that is laid out full-width before anything has answered makes `during` LARGER than either
 * settled position, which is the 612px this file exists to catch, on any mechanism that produces it.
 *
 *   node tools/table-tick.mjs [--only owrt2512] [--widths 390,768] [--pages /admin/status/overview]
 *
 * Needs a running owlab router (docs/development.md). */
import { chromium } from 'playwright';
import { stands, login, requireStands, sealToRouter } from './lib/stands.mjs';

const arg = (name, dflt) => {
	const i = process.argv.indexOf('--' + name);
	return i === -1 ? dflt : process.argv[i + 1];
};
/* 390 is where the difference between an unanswered table and its card stack is largest; 768 is the
 * width the arrival fault was reported at. */
const WIDTHS = arg('widths', '390,768').split(',').map(Number);
const PAGES = arg('pages', '/admin/status/overview,/admin/status/processes').split(',');
const SLACK = Number(arg('slack', '4'));

/* Runs INSIDE the page: performs the tick and answers with what the reader's own page did DURING it. */
const TICK = () => {
	const view = document.getElementById('view');
	if (!view) return { skip: 'no view' };
	const armed = document.documentElement.hasAttribute('data-fs-fit');
	const all = [ ...document.querySelectorAll('.table.fs-dt') ];
	if (!all.length) return { skip: 'no data table' };
	/* the live half of what table-contract asserts statically: every table under a root the rule names */
	const ungated = all.filter((t) => !t.closest('#view, #modal_overlay')).length;

	const t = all[0];
	const rows = [ ...t.querySelectorAll('.tr') ];
	if (rows.length < 2) return { skip: 'table has no rows to replace' };
	const fresh = rows.map((r) => r.cloneNode(true));
	fresh.push(rows[rows.length - 1].cloneNode(true));

	/* The reader's own place: the footer, which sits after everything a page can show, so growth
	 * anywhere above it — the table this tick targets, or anything else — moves it. */
	const anchor = document.querySelector('.fs-footer') || document.scrollingElement || document.body;
	const place = () => Math.round(anchor.getBoundingClientRect().top + window.scrollY);
	const before = place();

	/* what luci-base's poll leaves behind: a table with none of this theme's marks on it */
	t.classList.remove('fs-fitted', 'fs-stacked', 'fs-drop-xs');
	t.replaceChildren(...fresh);

	/* …and an app reading a width right after rendering, which forces the layout the microtask was
	 * going to prevent. Read in the same task, before fs-select (a MutationObserver callback, i.e. a
	 * microtask) gets to answer. */
	const during = place();

	return { armed, ungated, before, during, tables: all.length, view: true };
};

/* A second call, once a microtask turn and a frame have had time to run — fs-select's own answer,
 * whatever it decided the table should look like. Split from TICK() because `requestAnimationFrame`
 * needs to be awaited from OUTSIDE the synchronous forced-layout window TICK() measures `during` in;
 * folding the two into one async function would let the await itself yield before `during` is read. */
const SETTLED = () => new Promise((resolve) => {
	requestAnimationFrame(() => requestAnimationFrame(() => {
		const anchor = document.querySelector('.fs-footer') || document.scrollingElement || document.body;
		resolve(Math.round(anchor.getBoundingClientRect().top + window.scrollY));
	}));
});

const list = requireStands(stands(arg('only', ''), { all: process.argv.includes('--all') }), 'table-tick');
const browser = await chromium.launch();
const findings = [];
let ticks = 0, attempts = 0;

for (const stand of list) {
	for (const w of WIDTHS) {
		const ctx = await browser.newContext({ viewport: { width: w, height: 844 } });
		await sealToRouter(ctx, stand.base);
		const page = await ctx.newPage();
		await login(page, stand.base);
		for (const path of PAGES) {
			attempts++;
			try { await page.goto(stand.base + path, { waitUntil: 'domcontentloaded', timeout: 20000 }); }
			catch (e) { continue; }
			await page.waitForTimeout(2600);
			let r;
			try { r = await page.evaluate(TICK); }
			catch (e) { continue; }
			if (r.skip) { process.stdout.write(`  ${stand.id} @${w} ${path}: ${r.skip}\n`); continue; }
			let after;
			try { after = await page.evaluate(SETTLED); }
			catch (e) { continue; }
			ticks++;
			const where = `${stand.id} @${w} ${path}`;
			if (!r.armed)
				findings.push(`${where}: data-fs-fit is not armed, so the stylesheet's gate matches nothing`);
			if (r.ungated)
				findings.push(`${where}: ${r.ungated} data table(s) sit outside #view and #modal_overlay, where the gate cannot reach them`);
			/* growth past whichever settled position is taller: a shrink toward the other is the
			 * theme's own accepted trade-off (an unanswered table held out of the flow), a rise past
			 * both is the reader being thrown by a table nothing has answered for yet — on ANY
			 * mechanism, not only the CSS rule that happens to produce it today. */
			const ceiling = Math.max(r.before, after);
			const jump = r.during - ceiling;
			if (jump > SLACK)
				findings.push(`${where}: the reader's page moved ${jump}px the instant the table was `
					+ `replaced, before anything answered for it (footer ${r.before}px before, `
					+ `${r.during}px during, settling to ${after}px) — this is the intermediate the `
					+ `reader is thrown by.`);
			process.stdout.write(`  ${where}  tables ${r.tables}  footer ${r.before} -> ${r.during} -> `
				+ `${after}px, armed ${r.armed}, ungated ${r.ungated}\n`);
		}
		await ctx.close();
	}
}
await browser.close();

/* Zero ticks is not a clean sweep: three skip paths above and a goto failure all leave it at 0, and
 * that reads identically to "no table was ever laid out without an answer" unless the printed lines
 * are read. A stand with no theme, no data table on either page, or an ACL that empties both is a
 * failure to measure, not a pass. */
if (!findings.length && ticks === 0) {
	console.error(`\ntable-tick: 0 of ${attempts} attempt(s) produced a tick — every router/width/page `
		+ 'either failed to load, had no #view, or had no data table with rows to replace. This is not '
		+ 'a clean sweep; it is nothing measured.\n');
	process.exit(1);
}

if (findings.length) {
	console.error(`\ntable-tick: ${findings.length} finding(s)\n`);
	for (const f of findings) console.error('  ' + f);
	console.error('\ntheme/30-tables.css holds an unanswered .table.fs-dt out of the flow, armed by fs-fit.js');
	console.error('and proved selector-side by tools/table-contract.mjs. One of those three did not hold here.\n');
	process.exit(1);
}
console.log(`table-tick: ${ticks} tick(s), the reader's page never moved before a replaced table was answered for.`);
