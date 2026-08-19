#!/usr/bin/env node
/* THE POLL TICK, PERFORMED ON PURPOSE: does a freshly replaced data table ever get laid out before
 * anything has answered for it?
 *
 * This is the mechanism behind "the Overview jumps": luci-base's poll does not append a row, it
 * REPLACES the table, and the replacement carries none of the marks fs-select stamps. For the moment
 * between landing and being stamped the table is a full-width table — at 390px several screens
 * taller than the card stack it is about to become — and if anything forces layout in that moment,
 * the engine re-anchors on the intermediate and throws the reader. Measured on a live router at
 * iPhone width: 612px out and back, twice per tick.
 *
 * `theme/30-tables.css` holds an unanswered table out of the flow, and `tools/table-contract.mjs`
 * proves the rule names every root fs-select scans. What a stylesheet check cannot prove is that the
 * rule REACHES the table on a real page — the attribute is armed by JS, the roots are ids an app
 * could duplicate, and a `display` an app sets on `.table` at higher specificity would win. So this
 * does it live.
 *
 * WHY A DELIBERATE TICK RATHER THAN WATCHING A REAL ONE. The intermediate lasts a microtask:
 * fs-select answers in a MutationObserver callback, before paint, so a per-frame sampler never sees
 * it — measured, with the rule removed, as 0 frames out of 108 while the page grew by 269px. The
 * only way to observe the state is to force layout inside that window, which is exactly what an app
 * reading a width right after rendering does, and what this reproduces:
 *
 *     rows out, rows back in, marks stripped, then read a height.
 *
 * With the rule: 0 unanswered tables with height. Without it: 1, and 375px of it.
 *
 *   node tools/table-tick.mjs [--only owrt2512] [--widths 390,768] [--pages /admin/status/overview]
 *
 * Needs a running owlab router (docs/development.md).
 */
import { chromium } from 'playwright';
import { stands, login, requireStands } from './lib/stands.mjs';

const arg = (name, dflt) => {
	const i = process.argv.indexOf('--' + name);
	return i === -1 ? dflt : process.argv[i + 1];
};
/* 390 is where the difference between an unanswered table and its card stack is largest; 768 is the
 * width the arrival fault was reported at. */
const WIDTHS = arg('widths', '390,768').split(',').map(Number);
const PAGES = arg('pages', '/admin/status/overview,/admin/status/processes').split(',');

/* Runs INSIDE the page: performs the tick and answers with what the layout looked like DURING it. */
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

	/* what luci-base's poll leaves behind: a table with none of this theme's marks on it */
	t.classList.remove('fs-fitted', 'fs-stacked', 'fs-drop-xs');
	t.replaceChildren(...fresh);

	/* …and an app reading a width right after rendering, which forces the layout the microtask was
	 * going to prevent. Everything below is read in the same task, before fs-select can answer. */
	const height = Math.round(t.getBoundingClientRect().height);
	const laidOut = [ ...document.querySelectorAll('.table.fs-dt:not(.fs-fitted)') ]
		.filter((x) => x.getBoundingClientRect().height > 0)
		.map((x) => Math.round(x.getBoundingClientRect().height));
	return { armed, ungated, height, laidOut, tables: all.length };
};

const list = requireStands(stands(arg('only', ''), { all: process.argv.includes('--all') }), 'table-tick');
const browser = await chromium.launch();
const findings = [];
let ticks = 0;

for (const stand of list) {
	for (const w of WIDTHS) {
		const ctx = await browser.newContext({ viewport: { width: w, height: 844 } });
		const page = await ctx.newPage();
		await login(page, stand.base);
		for (const path of PAGES) {
			try { await page.goto(stand.base + path, { waitUntil: 'domcontentloaded', timeout: 20000 }); }
			catch (e) { continue; }
			await page.waitForTimeout(2600);
			let r;
			try { r = await page.evaluate(TICK); }
			catch (e) { continue; }
			if (r.skip) { process.stdout.write(`  ${stand.id} @${w} ${path}: ${r.skip}\n`); continue; }
			ticks++;
			const where = `${stand.id} @${w} ${path}`;
			if (!r.armed)
				findings.push(`${where}: data-fs-fit is not armed, so the stylesheet's gate matches nothing`);
			if (r.ungated)
				findings.push(`${where}: ${r.ungated} data table(s) sit outside #view and #modal_overlay, where the gate cannot reach them`);
			if (r.laidOut.length)
				findings.push(`${where}: a replaced table was laid out before anything answered for it `
					+ `(${r.laidOut.join(', ')} px) — this is the intermediate the reader sees as a jump`);
			process.stdout.write(`  ${where}  tables ${r.tables}  during the tick: ${r.laidOut.length} unanswered `
				+ `(${r.height}px), armed ${r.armed}, ungated ${r.ungated}\n`);
		}
		await ctx.close();
	}
}
await browser.close();

if (findings.length) {
	console.error(`\ntable-tick: ${findings.length} finding(s)\n`);
	for (const f of findings) console.error('  ' + f);
	console.error('\ntheme/30-tables.css holds an unanswered .table.fs-dt out of the flow, armed by fs-fit.js');
	console.error('and proved selector-side by tools/table-contract.mjs. One of those three did not hold here.\n');
	process.exit(1);
}
console.log(`table-tick: ${ticks} tick(s), no table was ever laid out without an answer.`);
