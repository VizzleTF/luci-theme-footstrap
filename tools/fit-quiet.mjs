#!/usr/bin/env node
/* The reader does not move while the chrome measures itself, in EITHER direction.
 *
 * `fitChrome()` decides whether the menu fits on the brand's row by taking the bar's layout classes
 * off and asking the engine (fs-fit rule 1), then walks it back through `fs-ind-compact`/
 * `fs-bar-stack` one step at a time. Every step is a real, differently-sized box: with the classes
 * off the bar is free to answer whatever height its content currently needs, taller as well as
 * shorter than where it settles. Measured with the two hooks below, on owrt2512 at 767px: the bar
 * walked 230 -> 202 -> 164 -> 144 -> 123 -> 131 -> 123px against a settled 123px — 41px of dip AND
 * 107px of growth, in the same pass (`../tmp/task-toplayout/pass-probe.mjs`), and the reader
 * followed it 1:1 on all three engines (49a1ff5).
 *
 * WHAT THIS USED TO WATCH, AND WHY THAT WAS THE WRONG SIDE OF THE FIX. Before this file measured
 * `.fs-sidebar`'s own `getBoundingClientRect().height` — but that box is the pin `fitChrome()`
 * installs for the exact same pass (`bar.style.minHeight`/`height`, fs-chrome.js), so the gate was
 * reading back the fix's own artefact, not the reader's place. Move the same 107px of growth into a
 * sibling of the bar — the menu row inside it, or `.fs-main`'s own top offset — and the OLD
 * measurement read 0px peak-to-peak while the reader still moved. Reader audit, 2026-09-10.
 *
 * WHAT IT WATCHES NOW. `#maincontent` (`.fs-main`) is the sibling the bar sits above in document
 * order in both layouts — everything the poll or a resize can put above the reader, the bar's own
 * box or anything beside it, shows up as a change in `#maincontent`'s document position, because
 * that position is the sum of everything above it. Sampled at the same instants as before —
 * `stripFitsOneRow()`'s `offsetTop` and `getClientRects()` reads (fs-chrome.js), the only forced
 * layouts inside the pass — so the trigger is unchanged; only what gets read at each one moved from
 * the mechanism to the promise.
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
/* Both sides of the decision: 390px is where the menu takes its own row and the bar walks taller
 * before it settles, 767px is where it does not and the walk is mostly a dip. Only widths that
 * drive the escalation move the bar at all, and both are needed to see either direction. */
const WIDTHS = (arg('widths', '390,480,767')).split(',').map(Number);
const SLACK = Number(arg('slack', '2'));

/* Every forced layout `fitChrome()`'s own decision performs — `stripFitsOneRow()`'s `offsetTop` and
 * `getClientRects()` reads (fs-chrome.js) — is a moment an engine with no scroll anchoring could
 * paint against, so `#maincontent`'s own document position (viewport top + scroll offset — the
 * reader's place, not the bar's) is sampled at each one, peak AND trough against the position it
 * had when the pass started. A live DOMTokenList carries no pointer back to its element and a
 * class-write hook only fires when the BAR's own class list changes — most of the walk comes from
 * `fitTabStrips()` toggling `fs-dense1`/`fs-dense2` on the MENU, which reflows the bar around it
 * with no write to the bar's own attributes at all — so the hook sits on the two reads instead,
 * same as `../tmp/task-toplayout/pass-probe.mjs`, which is what found the 107px this gate used to
 * miss while it was still reading the bar. */
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

const list = requireStands(stands(arg('only', ''), { all: process.argv.includes('--all') }), 'fit-quiet');
const browser = await (ENGINE === 'webkit' ? webkit : chromium).launch();
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
			 * chrome's own is one of them. A resize drives the same pass; a reader gets the first of
			 * the two five times a minute. */
			for (let i = 0; i < 3; i++) {
				const n = document.createElement('span');
				host.appendChild(n);
				n.remove();
				window.dispatchEvent(new Event('resize'));
				await new Promise((res) => setTimeout(res, 400));
			}
			return window.__fsAnchor;
		});
		if (r.skip) { process.stdout.write(`  ${stand.id} @${width}: ${r.skip}\n`); await ctx.close(); continue; }
		const where = `${stand.id} @${width}px`;
		if (!r.samples) {
			findings.push(`${where}: the chrome never re-fitted, so this gate proved nothing — a poll `
				+ `tick and a resize both have to reach fitChrome()`);
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
