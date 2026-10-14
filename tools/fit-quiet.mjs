#!/usr/bin/env node
/* The reader does not move while the chrome measures itself, in either direction.
 *
 * `fitChrome()` strips the bar's layout classes to ask whether the menu fits the brand's row, then
 * walks it back through `fs-ind-compact`/`fs-bar-stack` one step at a time (fs-fit rule 1), so the
 * bar is taller as well as shorter than where it settles. This gate samples `#maincontent`'s
 * document position (viewport top + scroll offset: the sum of everything above the reader) at the
 * pass's two forced layouts, `stripFitsOneRow()`'s `offsetTop` and `getClientRects()` reads, and
 * bounds it both ways within 2px of where it started. The bar's own height is not the reader's
 * place — it is the pin `fitChrome()` installs (docs/anchoring-log.md, "The gates watch the
 * reader's place"); on owrt2512 at 767px the pass shows 41px of dip and 107px of growth.
 *
 *   node tools/fit-quiet.mjs [--only owrt2512] [--all] [--engine chromium|firefox|webkit]
 *                            [--widths 390,480,767]
 *
 * Needs a running owlab router (docs/development.md). */
import * as pw from 'playwright';
import { stands, login, requireStands, sealToRouter } from './lib/stands.mjs';
import { parseFlags } from './lib/util.mjs';

const FLAGS = parseFlags('fit-quiet', {
	engine: { type: 'string', default: 'chromium' }, widths: { type: 'string', default: '390,480,767' },
	only: { type: 'string', default: '' }, all: { type: 'boolean', default: false },
});
const ENGINE = FLAGS.engine;
/* Both sides of the decision: 390px is where the menu takes its own row and the bar walks taller
 * before it settles, 767px is where it does not and the walk is mostly a dip. Only widths that
 * drive the escalation move the bar at all, and both are needed to see either direction. */
const WIDTHS = FLAGS.widths.split(',').map(Number);
const SLACK = 2;

/* Sampled at every forced layout `fitChrome()`'s decision performs, each a moment an engine with no
 * scroll anchoring could paint against; peak and trough are taken against the position at the
 * pass's start. A class-write hook would miss most of the walk: `fitTabStrips()` toggles
 * `fs-dense1`/`fs-dense2` on the MENU, which reflows the bar with no write to the bar's own
 * attributes, and a live DOMTokenList has no pointer back to its element. */
const WATCH = () => {
	const anchor = document.getElementById('maincontent');
	if (!anchor) return;
	const pos = () => Math.round(anchor.getBoundingClientRect().top + window.scrollY);
	const settled = pos();
	window.__fsAnchor = { settled, min: settled, max: settled, samples: 0 };
	const sample = () => {
		const v = pos();
		const w = window.__fsAnchor;
		w.samples++;
		if (v < w.min) w.min = v;
		if (v > w.max) w.max = v;
	};
	const d = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetTop');
	Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
		configurable: true, enumerable: d.enumerable,
		get() { const v = d.get.call(this); sample(); return v; },
	});
	const gcr = Element.prototype.getClientRects;
	Element.prototype.getClientRects = function () { const v = gcr.apply(this, arguments); sample(); return v; };
};

const list = requireStands(stands(FLAGS.only, { all: FLAGS.all }), 'fit-quiet');
if (!['chromium', 'firefox', 'webkit'].includes(ENGINE)) {
	console.error(`fit-quiet: no such engine "${ENGINE}"`);
	process.exit(2);
}
const browser = await pw[ENGINE].launch();
const findings = [];
let runs = 0, attempts = 0, worst = 0;

for (const stand of list) {
	for (const width of WIDTHS) {
		attempts++;
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
			if (!window.__fsAnchor) return { skip: 'no anchor' };
			const host = document.getElementById('view') || document.body;
			/* what a poll tick does to this pass: a mutation inside #view wakes every fitter and the
			 * chrome's own is one of them; a reader gets one five times a minute. */
			for (let i = 0; i < 3; i++) {
				const n = document.createElement('span');
				host.appendChild(n);
				n.remove();
				await new Promise((res) => setTimeout(res, 400));
			}
			return window.__fsAnchor;
		});
		if (r.skip) { process.stdout.write(`  ${stand.id} @${width}: ${r.skip}\n`); await ctx.close(); continue; }
		const where = `${stand.id} @${width}px`;
		if (!r.samples) {
			findings.push(`${where}: the chrome never re-fitted, so this gate proved nothing — a poll `
				+ `tick has to reach fitChrome()`);
			await ctx.close();
			continue;
		}
		runs++;
		const dip = r.settled - r.min;
		const grow = r.max - r.settled;
		const pp = r.max - r.min;
		if (pp > worst) worst = pp;
		if (dip > SLACK || grow > SLACK)
			findings.push(`${where}: #maincontent moved from ${r.settled}px to ${r.min}-${r.max}px `
				+ `document position while the chrome measured itself — ${dip}px up and ${grow}px down `
				+ `(${pp}px peak-to-peak), inside a pass no engine paints in and Safari never `
				+ `compensates for. Growth ANYWHERE above the reader — the bar, a row inside it, a `
				+ `sibling — shows up here, not only a change in the bar's own box.`);
		process.stdout.write(`  ${where}  settled ${r.settled}px, ${r.samples} sample(s), `
			+ `${r.min}-${r.max}px (${pp}px peak-to-peak)\n`);
		await ctx.close();
	}
}
await browser.close();

/* Zero runs is not a clean sweep — it is every cell having skipped or failed to load, which reads
 * identically to a settled chrome unless the lines above are read. A stand with no theme, an
 * unauthenticated session, or a page that never reaches fitChrome() must fail the same as a real
 * finding, not print a worst-case of 0px it never measured. */
if (!findings.length && runs === 0) {
	console.error(`\nfit-quiet: 0 of ${attempts} cell(s) produced a measurable pass — every router/width `
		+ 'either failed to load, had no #maincontent, or never reached fitChrome(). This is not a '
		+ 'clean sweep; it is nothing measured.\n');
	process.exit(1);
}

if (findings.length) {
	console.error(`\nfit-quiet: ${findings.length} finding(s)\n`);
	for (const f of findings) console.error('  ' + f);
	console.error('\nThe pass is fitChrome() in fs-chrome.js, the reason is in docs/anchoring.md.\n');
	process.exit(1);
}
console.log(`fit-quiet: ${ENGINE}, ${runs} width(s) over ${list.length} router(s), worst ${worst}px `
	+ 'peak-to-peak — the reader held still while the chrome measured itself.');
