#!/usr/bin/env node
/* THE PAGE GATE: every page the router's menu offers, at every width that matters, measured for the
 * five things that have actually reached users.
 *
 * The static gates read the stylesheet; every field report so far was about a PAGE. #11 a column
 * shredded to one character per line, #22 a submenu title clipped, #14 an indicator that did not fit
 * the sidebar, #10 a hidden tab pane leaving phantom scroll, #12 a doubled scrollbar in Firefox,
 * #5/#15/#32/#33/#36 a widget or a whole app laid out wrong. Not one of them is visible in a file,
 * and every one of them is one DOM query away on a live page. This is that query, run everywhere.
 *
 * WHAT IT LOOKS FOR, and why each one is here:
 *
 *   doc-scroll     the document scrolls sideways. The single symptom users describe as "вёрстка
 *                  плывёт" (#1) and the only one that needs no interpretation.
 *   overflow       an element's right edge is past the content column and no scroll container owns
 *                  it, i.e. it is unreachable rather than scrollable — the Diagnostics Ping button
 *                  shape, measured at 320px of room needing 338.
 *   clipped        a box that is not a scroller has content wider than itself: `overflow: hidden`
 *                  or `clip` eats it silently, which is what `.fs-main`'s backstop does when a
 *                  table has no remedy left.
 *   target         a hit target under 24x24 CSS px with another target within 24px of its centre —
 *                  WCAG 2.2 SC 2.5.8 with its own spacing exception, the rule the chevron hit-area
 *                  fix (#2-class) was about.
 *   noname         an operable element with no accessible name — SC 4.1.2, and the one a11y failure
 *                  a stylesheet CAN cause, by hiding the text a control's name came from.
 *   nested-scroll  two scrollports stacked on the shell: the doubled scrollbar of #12, which only
 *                  ever appeared on one page in one engine.
 *   console        an uncaught error or a console.error while the page rendered. A view that throws
 *                  paints half of itself and says nothing.
 *
 * THE BASELINE IS A UNION ACROSS PLATFORMS, not a photograph of one machine. Text metrics differ
 * between a maintainer's containers and CI's ubuntu runner, and a few findings sit within a pixel or
 * two of their threshold: the same link is 16px tall in one place and 15 in the other (SC 2.5.8 is a
 * hard 24), the same tooltip clears the column by 1px here and misses by 2px there. Six signatures
 * appeared on the runner that had never appeared locally. The magnitude is not part of a signature,
 * so only these threshold-straddling cases can differ at all — and the honest answer is to hold every
 * KNOWN finding in one file rather than one file per machine, which would double the maintenance and
 * leave each half unverifiable from the other.
 *
 * A BASELINE, NOT A CLEAN SHEET. Some findings belong to the app, not the theme (a third-party page
 * that writes its own 1200px table), and a gate that fails on them is a gate that gets disabled. So
 * every finding is signed `path|width|kind|element` and the known set lives in
 * tools/baselines/live-audit.json: a NEW signature fails the run, a signature that stopped appearing
 * is printed so the baseline can shrink. Ratchet, exactly like css-metrics.mjs.
 *
 *   node tools/live-audit.mjs [--only owrt2512,owrt2410] [--widths 320,390,768,1440]
 *                             [--pages /admin/status] [--update] [--engine chromium|firefox|webkit]
 *
 * Needs a running owlab router (docs/development.md). `--update` rewrites the baseline: read the
 * diff before you do that — it is the whole value of the file.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pw from 'playwright';
import { stands, login, menuPaths, DESTRUCTIVE, requireStands } from './lib/stands.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE = resolve(HERE, 'baselines/live-audit.json');

const arg = (name, dflt) => {
	const i = process.argv.indexOf('--' + name);
	return i === -1 ? dflt : process.argv[i + 1];
};
const UPDATE = process.argv.includes('--update');
const ENGINE = arg('engine', 'chromium');
/* 320 is the narrowest width WCAG 1.4.10 requires content to reflow to; 390 is the modal phone;
 * 568 is where the theme's own card decision sits; 768 and 1024 bracket the sidebar's fit; 1440 is
 * the desktop the reports come from. */
const WIDTHS = arg('widths', '320,390,568,768,1024,1440').split(',').map(Number);
const ONLY_PAGES = arg('pages', '');

/* Runs INSIDE the page. Kept as one function so what CI measures and what a developer measures
 * cannot be two different definitions of "overflows". */
const CHECK = function () {
	const out = [];
	const vis = (el) => {
		const cs = getComputedStyle(el);
		return cs.display !== 'none' && cs.visibility !== 'hidden' && el.getClientRects().length > 0;
	};
	const label = (el) => {
		const cls = (typeof el.className === 'string' ? el.className : '').split(' ').filter(Boolean)[0];
		return el.tagName.toLowerCase() + (el.id ? '#' + el.id : cls ? '.' + cls : '');
	};
	const scrolls = (el) => /(auto|scroll)/.test(getComputedStyle(el).overflowX + getComputedStyle(el).overflowY);
	const inScroller = (el) => {
		for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement)
			if (scrolls(p)) return true;
		return false;
	};

	const host = document.getElementById('view') || document.body;
	const hostRight = host.getBoundingClientRect().right;

	/* 1. the document itself */
	const docScroll = Math.round(document.documentElement.scrollWidth - document.documentElement.clientWidth);
	if (docScroll > 1) out.push({ kind: 'doc-scroll', el: 'document', by: docScroll });

	/* 2. reach: past the content column with nothing to scroll it back. 1.5px because a border-box
	 * edge lands on a fraction at some zoom levels and a half-pixel is not a defect.
	 *
	 * INSIDE an <svg> nothing is laid out by the CSS box model — the stock realtime views draw a
	 * polyline wider than the viewport ON PURPOSE and slide it leftwards one sample at a time, so
	 * every one of its points reported as "past the column" while the drawing was correct. The
	 * <svg> element itself is still measured, which is the box the theme actually sizes. */
	for (const el of host.querySelectorAll('*')) {
		if (!vis(el) || inScroller(el) || el.ownerSVGElement) continue;
		const r = el.getBoundingClientRect();
		if (r.width && r.right > hostRight + 1.5) out.push({ kind: 'overflow', el: label(el), by: Math.round(r.right - hostRight) });
	}

	/* 3. clipped: a non-scrolling box holding content wider than itself. Only the containers the
	 * theme owns the geometry of — every element would report the browser's own rounding. */
	for (const el of host.querySelectorAll('.cbi-section, .table, .alert-message, .cbi-value, .fs-card')) {
		if (!vis(el) || scrolls(el)) continue;
		const inner = el.scrollWidth - el.clientWidth;
		if (inner > 1) out.push({ kind: 'clipped', el: label(el), by: inner });
	}

	/* 4. hit targets, SC 2.5.8 with the spacing exception.
	 *
	 * PER LINE BOX, not per element: an inline link that wraps has one rect per line and
	 * getBoundingClientRect() returns their UNION, whose centre lies on neither of them — in the
	 * footer, where three links share three wrapped lines, that phantom centre sat 15px from a real
	 * one and the gate reported a violation that no pointer can reach. getClientRects() is what the
	 * criterion is about anyway: the target is the area a finger can land on. */
	const targets = [];
	for (const el of document.querySelectorAll('button, a[href], .cbi-button, input[type="checkbox"], input[type="radio"], select, [role="button"]')) {
		if (!vis(el)) continue;
		for (const r of el.getClientRects()) targets.push({ el, r });
	}
	const centre = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
	for (const t of targets) {
		if (t.r.width >= 23.5 && t.r.height >= 23.5) continue;
		const a = centre(t.r);
		if (targets.some((o) => o.el !== t.el && Math.hypot(centre(o.r).x - a.x, centre(o.r).y - a.y) < 24))
			out.push({ kind: 'target', el: label(t.el), by: Math.round(t.r.width) + 'x' + Math.round(t.r.height) });
	}

	/* 5. names, SC 4.1.2. The multi-select checkbox is ui.js's own presentational shape — excluded
	 * by markup, not by rule, exactly as in tools/a11y-gallery.mjs. */
	for (const el of document.querySelectorAll('button, a[href], input:not([type="hidden"]), select, textarea, [role="button"]')) {
		if (!vis(el) || el.matches('.cbi-dropdown[multiple] li > form > input[type="checkbox"]')) continue;
		const name = (el.textContent || '').trim() || el.getAttribute('aria-label') || el.getAttribute('title')
			|| (el.labels && el.labels.length ? 'label' : '') || el.getAttribute('placeholder') || el.getAttribute('value');
		if (!name) out.push({ kind: 'noname', el: label(el) });
	}

	/* 6. two stacked scrollports on the shell — the doubled scrollbar of #12 */
	const shellScrollers = [ document.documentElement, document.body, ...document.querySelectorAll('.fs-shell, .fs-main, .fs-content, #maincontent') ]
		.filter((el) => el && /(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 1);
	if (shellScrollers.length > 1)
		out.push({ kind: 'nested-scroll', el: shellScrollers.map(label).join('+') });

	return out;
};

const baseline = (() => {
	try { return JSON.parse(readFileSync(BASELINE, 'utf8')); }
	catch (e) { return {}; }
})();

const list = requireStands(stands(arg('only', '')), 'live-audit');
const browser = await pw[ENGINE].launch();
const seen = {}, fresh = [];
let checked = 0;

for (const stand of list) {
	let here = 0;
	const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
	const page = await ctx.newPage();
	const errs = [];
	page.on('pageerror', (e) => errs.push(String(e).replace(/\s+/g, ' ').slice(0, 120)));
	page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().replace(/\s+/g, ' ').slice(0, 120)); });
	await login(page, stand.base);

	/* Baselines are per ENGINE as well as per router: a second engine finds different things (the
	 * doubled scrollbar of #12 was Firefox-only), and mixing the two sets would let a chromium run
	 * bless a firefox finding it never saw. */
	const key = ENGINE === 'chromium' ? stand.id : `${stand.id}@${ENGINE}`;
	const known = baseline[key] || [];
	const kset = new Set(known);
	seen[key] = new Set();

	for (const path of await menuPaths(page)) {
		if (DESTRUCTIVE.test(path)) continue;
		if (ONLY_PAGES && !path.startsWith(ONLY_PAGES)) continue;
		await page.setViewportSize({ width: 1440, height: 900 });
		errs.length = 0;
		try { await page.goto(stand.base + path, { waitUntil: 'domcontentloaded', timeout: 20000 }); }
		catch (e) { continue; }
		/* a view renders behind an RPC; give it the time a user would wait before judging it */
		await page.waitForTimeout(1800);
		/* a page the router refuses (an app in the menu whose ACL says no) is not a layout finding */
		if (!(await page.evaluate(() => !!document.getElementById('view')))) continue;
		checked++; here++;

		const record = (width, f) => {
			const sig = `${path}|${width}|${f.kind}|${f.el}`;
			seen[key].add(sig);
			if (!kset.has(sig)) fresh.push({ stand: key, sig, by: f.by });
		};
		for (const e of errs.slice(0, 3)) record(0, { kind: 'console', el: e });

		for (const w of WIDTHS) {
			await page.setViewportSize({ width: w, height: 900 });
			/* the fitters run on a resize observer and settle within a frame or two */
			await page.waitForTimeout(220);
			let found = [];
			try { found = await page.evaluate(CHECK); } catch (e) { continue; }
			for (const f of found) record(w, f);
		}
	}
	await ctx.close();
	process.stdout.write(`${key}: ${seen[key].size} finding(s) over ${here} page(s)\n`);
}
await browser.close();

/* A run narrowed by --pages or --widths visited only part of the baseline, so it may neither rewrite
 * it nor report the rest as fixed. */
const fullSweep = !ONLY_PAGES && arg('widths', null) === null;

if (UPDATE) {
	if (!fullSweep) {
		console.error('live-audit: --update needs a full sweep — a run narrowed by --pages or --widths');
		console.error('would drop every signature it did not visit. Drop the narrowing flags.');
		process.exit(2);
	}
	const next = {};
	for (const id of Object.keys(seen)) next[id] = [ ...seen[id] ].sort();
	mkdirSync(dirname(BASELINE), { recursive: true });
	writeFileSync(BASELINE, JSON.stringify(next, null, '\t') + '\n');
	console.log('baseline rewritten:', BASELINE);
	process.exit(0);
}

/* A signature that stopped appearing is not a failure — it is a fix, and the baseline should shrink
 * to match. Printed, never gating: a page an app no longer installs would otherwise fail the run.
 *
 * Only a FULL sweep may say that, though: a run narrowed by --pages or --widths did not visit most
 * of the baseline, and reporting the rest as "no longer reproduces" is how a baseline gets emptied
 * by someone debugging one page. */
let stale = 0;
for (const id of Object.keys(seen))
	for (const sig of baseline[id] || [])
		if (!seen[id].has(sig)) stale++;
if (stale && fullSweep) console.log(`${stale} baseline entr(ies) no longer reproduce — re-run with --update to drop them.`);

if (fresh.length) {
	console.error(`\nlive-audit: ${fresh.length} NEW finding(s):\n`);
	for (const f of fresh.slice(0, 60)) console.error(`  ${f.stand}  ${f.sig}${f.by != null ? '  (' + f.by + ')' : ''}`);
	if (fresh.length > 60) console.error(`  … and ${fresh.length - 60} more`);
	console.error('\nEach line is path|width|kind|element. Fix it, or — if it belongs to the app and');
	console.error('not to the theme — say so in the commit and re-run with --update.');
	process.exit(1);
}
console.log(`live-audit: ${checked} page render(s) across ${list.length} router(s), no new findings.`);
