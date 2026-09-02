#!/usr/bin/env node
/* The chrome may not get shorter while it measures itself.
 *
 * `fitChrome()` decides whether the menu fits on the brand's row by taking the bar's layout classes
 * off and asking the engine (fs-fit rule 1). `fs-bar-stack` is what gives a narrow menu a row of its
 * own, so for the width where the menu needs that row the bar is a row SHORTER while the question is
 * being asked — and every pixel of the bar is above the reader. Measured on owrt2512 at 767px: the
 * bar stands at 98px and answers 65px with the classes off, 33px of it above whatever the reader is
 * looking at.
 *
 * Chromium and Firefox put the reader back; Safari implements no scroll anchoring, on any platform
 * (MDN: `overflow-anchor` ships in neither), and an iPhone reported the Overview creeping upward
 * once per poll tick. Bisected there with switches in a diagnostic build: `?off=chromefit` stopped
 * it, `?off=measure` — the tables' own re-measure — did not.
 *
 * WHAT THIS GATE CAN AND CANNOT SEE. The symptom does not reproduce headless: the pass is one
 * synchronous task, so no frame is painted inside it, and both engines restore the offset once the
 * bar is back (measured, 390/480/767px, at half the page and at its bottom: 0px lost either way).
 * So the gate watches the CAUSE and not the symptom — it hands the bar a classList of its own and
 * reads its height at the instant the pass takes the classes off. That height is what an engine
 * without anchoring lays out against, and it may not be below the height the bar settled at.
 *
 *   node tools/fit-quiet.mjs [--only owrt2512] [--all] [--engine chromium|webkit]
 *
 * Needs a running owlab router (docs/development.md). */
import { chromium, webkit } from 'playwright';
import { stands, login, requireStands, sealToRouter } from './lib/stands.mjs';

const arg = (name, dflt) => {
	const i = process.argv.indexOf('--' + name);
	return i === -1 ? dflt : process.argv[i + 1];
};
const ENGINE = arg('engine', 'chromium');
/* Both sides of the decision: 390px is where the menu takes its own row and the bar is TALLER with
 * the classes off, 767px is where it does not and the bar is 33px shorter. Only the second can move
 * a reader, and only that width would have caught it. */
const WIDTHS = (arg('widths', '390,480,767')).split(',').map(Number);
const SLACK = Number(arg('slack', '2'));

/* The bar gets a classList of its own, so the pass announces itself: a live DOMTokenList carries no
 * pointer back to its element, and the height wanted here is the one that exists between the remove
 * and the restore — inside a task no observer and no frame gets to run in. */
const WATCH = () => {
	const bar = document.querySelector('.fs-sidebar');
	if (!bar) return;
	const real = bar.classList;
	window.__fsBar = { dip: 0, at: 0, calls: 0, settled: Math.round(bar.getBoundingClientRect().height) };
	const proxy = new Proxy(real, {
		get(t, k) {
			const v = t[k];
			if (typeof v !== 'function') return v;
			if (k !== 'remove') return v.bind(t);
			return (...names) => {
				const out = v.apply(t, names);
				if (names.indexOf('fs-bar-stack') !== -1) {
					const h = Math.round(bar.getBoundingClientRect().height);
					const w = window.__fsBar;
					w.calls++;
					if (w.settled - h > w.dip) { w.dip = w.settled - h; w.at = h; }
				}
				return out;
			};
		},
	});
	Object.defineProperty(bar, 'classList', { get: () => proxy, configurable: true });
};

const list = requireStands(stands(arg('only', ''), { all: process.argv.includes('--all') }), 'fit-quiet');
const browser = await (ENGINE === 'webkit' ? webkit : chromium).launch();
const findings = [];
let runs = 0, worst = 0;

for (const stand of list) {
	for (const width of WIDTHS) {
		const ctx = await browser.newContext({ viewport: { width, height: 844 } });
		await sealToRouter(ctx, stand.base);
		await ctx.addInitScript(() => { try { localStorage.setItem('fs-layout', 'top'); } catch (e) {} });
		const page = await ctx.newPage();
		await login(page, stand.base);
		try { await page.goto(stand.base + '/admin/status/overview', { waitUntil: 'domcontentloaded', timeout: 20000 }); }
		catch (e) { await ctx.close(); continue; }
		await page.waitForTimeout(4000);
		await page.evaluate(WATCH);
		const r = await page.evaluate(async () => {
			if (!window.__fsBar) return { skip: 'no bar' };
			const host = document.getElementById('view') || document.body;
			/* what a poll tick does to this pass: a mutation inside #view wakes every fitter and the
			 * chrome's own is one of them. A resize drives the same pass; a reader gets the first of
			 * the two five times a minute. */
			for (let i = 0; i < 3; i++) {
				const n = document.createElement('span');
				host.appendChild(n);
				n.remove();
				window.dispatchEvent(new Event('resize'));
				await new Promise((res) => setTimeout(res, 400));
			}
			return window.__fsBar;
		});
		if (r.skip) { process.stdout.write(`  ${stand.id} @${width}: ${r.skip}\n`); await ctx.close(); continue; }
		const where = `${stand.id} @${width}px`;
		if (!r.calls) {
			findings.push(`${where}: the chrome never re-fitted, so this gate proved nothing — a poll `
				+ `tick and a resize both have to reach fitChrome()`);
			await ctx.close();
			continue;
		}
		runs++;
		if (r.dip > worst) worst = r.dip;
		if (r.dip > SLACK)
			findings.push(`${where}: the bar measured itself at ${r.at}px having settled at `
				+ `${r.settled}px — ${r.dip}px taken off ABOVE the reader, inside a task no engine `
				+ `paints in and Safari never compensates for. fs-chrome.js pins the bar's `
				+ `min-height for the pass; that pin is what this reads back`);
		process.stdout.write(`  ${where}  settled ${r.settled}px, ${r.calls} pass(es), dip ${r.dip}px\n`);
		await ctx.close();
	}
}
await browser.close();

if (findings.length) {
	console.error(`\nfit-quiet: ${findings.length} finding(s)\n`);
	for (const f of findings) console.error('  ' + f);
	console.error('\nThe pass is fitChrome() in fs-chrome.js, the reason is in docs/chrome.md.\n');
	process.exit(1);
}
console.log(`fit-quiet: ${ENGINE}, ${runs} width(s) over ${list.length} router(s), worst ${worst}px — `
	+ 'the chrome measured itself without getting shorter.');
