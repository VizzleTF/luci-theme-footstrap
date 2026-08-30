#!/usr/bin/env node
/* The page gate: every page the router's menu offers, at every width that matters, measured for the
 * faults that have actually reached users.
 *
 * The static gates read the stylesheet; every field report so far was about a PAGE — a column
 * shredded to one character per line (#11), a submenu title clipped (#22), an indicator that did
 * not fit the sidebar (#14), a hidden tab pane leaving phantom scroll (#10), a doubled scrollbar
 * in Firefox (#12), a widget or a whole app laid out wrong (#5, #15, #32, #33, #36). Not one is
 * visible in a file, and every one is one DOM query away on a live page.
 *
 * WHAT IT LOOKS FOR: `doc-scroll` (the document scrolls sideways — the symptom users report as
 * "вёрстка плывёт", #1), `overflow` (past the content column with nothing to scroll it back),
 * `clipped` (a non-scroller whose content is wider than itself), `target` (a hit target under
 * 24x24 CSS px with a neighbour inside 24px of its centre — WCAG 2.2 SC 2.5.8 with its spacing
 * exception), `noname` (an operable element with no accessible name — SC 4.1.2, the one a11y
 * failure a stylesheet CAN cause), `ungated-table`/`unanswered-table` (see below),
 * `nested-scroll` (two scrollports stacked on the shell), `geometry` (the chrome's model against
 * the real box) and `console` (a view that threw while rendering). The width sweep starts at 320,
 * which is the narrowest reflow WCAG 1.4.10 requires.
 *
 * A BASELINE, NOT A CLEAN SHEET. Some findings belong to the app, not the theme, and a gate that
 * fails on them is a gate that gets disabled. So every finding is signed `path|width|kind|element`
 * and the known set lives in tools/baselines/live-audit.json: a NEW signature fails the run, a
 * signature that stopped appearing is printed so the baseline can shrink. A ratchet, exactly like
 * css-metrics.mjs. The file is a UNION ACROSS PLATFORMS, not a photograph of one machine — text
 * metrics differ between a maintainer's containers and CI's runner, and a few findings sit within
 * a pixel of their threshold.
 *
 *   node tools/live-audit.mjs [--only owrt2512,owrt2410] [--widths 320,390,768,1440]
 *                             [--pages /admin/status] [--pages-all] [--all] [--arrive 768]
 *                             [--update] [--prune] [--engine chromium|firefox|webkit]
 *
 * Needs a running owlab router (docs/development.md). `--update` rewrites the baseline: read the
 * diff before you do that — it is the whole value of the file. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pw from 'playwright';
import { stands, login, menuPaths, DESTRUCTIVE, requireStands, sealToRouter } from './lib/stands.mjs';
import { classify, representatives, reportReduction, PINNED } from './lib/page-shapes.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE = resolve(HERE, 'baselines/live-audit.json');

const arg = (name, dflt) => {
	const i = process.argv.indexOf('--' + name);
	return i === -1 ? dflt : process.argv[i + 1];
};
const UPDATE = process.argv.includes('--update');
/* with --update: replace each measured router's set instead of unioning into it. Removes findings
 * that belong to apps this machine simply does not install, so it is the flag you reach for after
 * reading the "no longer reproduce" list, not the one you run by habit. */
const PRUNE = process.argv.includes('--prune');
const ENGINE = arg('engine', 'chromium');
/* 320 is the narrowest width WCAG 1.4.10 requires content to reflow to; 390 is the modal phone;
 * 568 is where the theme's own card decision sits; 768 and 1024 bracket the sidebar's fit; 1440 is
 * the desktop the reports come from. */
const WIDTHS = arg('widths', '320,390,568,768,1024,1440').split(',').map(Number);
const ONLY_PAGES = arg('pages', '');
/* Measure one page per SHAPE instead of every leaf of the menu — see lib/page-shapes.mjs for what a
 * shape is and for the three sets that are never sampled away. `--pages-all` takes them all. */
const ALL_PAGES = process.argv.includes('--pages-all');
/* the four routers rather than the OpenWrt pair (lib/stands.mjs) */
const ALL_STANDS = process.argv.includes('--all');
/* Entering a page at a width is not the same as RESIZING into it. A sweep that loads each page once
 * and then walks the widths takes every measurement after the first on a page that has already been
 * laid out, fitted and corrected — and the fitters re-run on the resize, which is exactly the event
 * that hides an arrival bug: a first fit pass judges a table its own gate is still hiding, caches
 * "no remedy", and on a page that renders once and stands still no later mutation corrects it —
 * the table then sits 65px past its column.
 *
 * So ONE width is also entered, with a load of its own: the fault is in the arrival, not in the
 * width, so any width whose layout needs a remedy will do, and 768 is where the sidebar has just
 * folded and a data table still has to break a column to fit. Its findings are signed `<width>a`
 * so an arrival-only fault cannot hide behind the identical resize signature. */
const ARRIVE = Number(arg('arrive', '768'));
if (!Number.isFinite(ARRIVE) || ARRIVE < 0) {
	/* a typo may not turn a check off in silence — that is how a gate stops holding anything */
	console.error(`live-audit: --arrive wants a width in px (or 0 to skip it), got "${arg('arrive', '')}"`);
	process.exit(1);
}

/* Does the chrome's arithmetic still describe the page it is about?
 *
 * `fs-chrome.contentWidth()` answers "how wide is the content column" WITHOUT reading layout, for
 * the one pass that may not read it. It gets there by subtracting the sidebar and the shell's
 * gutter from the window, every term a token read out of the stylesheet — so it is a model of the
 * page, and a model drifts silently. It has: the gutter was once subtracted twice, and the top-bar
 * layout kept a sidebar in the sum, both worth enough to cross fs-select's CRAMPED threshold and
 * card a table that had room. */
const GEOMETRY = function () {
	const RT = window.L;
	if (!RT || typeof RT.require !== 'function') return [];
	return RT.require('fs-chrome').then((chrome) => {
		const col = document.querySelector('.fs-content');
		if (!col || typeof chrome.contentWidth !== 'function') return [];
		const cs = getComputedStyle(col);
		/* clientWidth is the padding box; the model answers the width the CONTENT gets */
		const real = col.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
		const off = Math.round(chrome.contentWidth() - real);
		/* 2px: a fractional layout edge and a subpixel scrollbar are not a drift */
		return Math.abs(off) > 2 ? [ { kind: 'geometry', el: 'fs-content', by: off } ] : [];
	}).catch(() => []);
};

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
	const hostRect = host.getBoundingClientRect();
	const hostRight = hostRect.right;
	/* A vertical scrollbar takes width from the content column but not from its border box, so a
	 * page long enough to scroll measures differently from the same page that is not — which is why
	 * a finding seen in CI need not reproduce on a stand. Reported with every overflow. */
	const scrollbar = Math.round(window.innerWidth - document.documentElement.clientWidth);

	/* 1. the document itself */
	const docScroll = Math.round(document.documentElement.scrollWidth - document.documentElement.clientWidth);
	if (docScroll > 1) out.push({ kind: 'doc-scroll', el: 'document', by: docScroll });

	/* 2. reach: past the content column with nothing to scroll it back. 1.5px because a border-box edge
	 * lands on a fraction at some zoom levels.
	 *
	 * Inside an <svg> nothing is laid out by the CSS box model — the stock realtime views draw a
	 * polyline wider than the viewport on purpose and slide it leftwards — so every one of its points
	 * reports as "past the column" while the drawing is correct. The <svg> element itself is still
	 * measured, that being the box the theme sizes. */
	for (const el of host.querySelectorAll('*')) {
		if (!vis(el) || inScroller(el) || el.ownerSVGElement) continue;
		const r = el.getBoundingClientRect();
		if (!r.width || r.right <= hostRight + 1.5) continue;
		/* THE NUMBER ALONE IS NOT ACTIONABLE. `table#packages (2)` says two pixels and nothing about
		 * WHICH box is two pixels too wide — the element itself, or a parent it fills at 100%. That
		 * is a day of guessing on a finding that does not reproduce off the runner, so the boxes are
		 * printed with it: the element, the column it overflows, its parent, and whether a scrollbar
		 * was taking width at the time. Only `by` carries this; the signature the baseline is keyed
		 * on stays `path|width|kind|element`. */
		const p = el.parentElement;
		const pr = p ? p.getBoundingClientRect() : null;
		const px = (n) => Math.round(n);
		out.push({
			kind: 'overflow',
			el: label(el),
			by: `${px(r.right - hostRight)}px  el ${px(r.width)}`
				+ ` · host ${px(hostRect.width)}`
				+ (pr ? ` · parent ${label(p)} ${px(pr.width)}` : '')
				+ ` · ${getComputedStyle(el).boxSizing}`
				+ (scrollbar ? ` · scrollbar ${scrollbar}` : ''),
		});
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
	 * Per LINE BOX, not per element: an inline link that wraps has one rect per line and
	 * getBoundingClientRect() returns their union, whose centre lies on neither — in the footer that
	 * phantom centre sat 15px from a real one and the gate reported a violation no pointer can
	 * reach. getClientRects() is what the criterion is about anyway. */
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

	/* 6. The gate that keeps a fresh table out of the layout, asked of the page rather than of the
	 * stylesheet. theme/30-tables.css holds a `.fs-dt` out of the flow until fs-select stamps it
	 * `.fs-fitted`, because a poll tick REPLACES these tables and an unstamped one is laid out
	 * full-width for an instant, which the engine re-anchors on. Two ways that protection can be
	 * absent without anything else looking wrong: a data table outside every root the rule names,
	 * and a table the fitter never stamped. */
	if (document.documentElement.hasAttribute('data-fs-fit')) {
		for (const t of document.querySelectorAll('.table.fs-dt')) {
			if (!t.closest('#view, #modal_overlay')) out.push({ kind: 'ungated-table', el: label(t) });
			else if (!t.classList.contains('fs-fitted') && t.getBoundingClientRect().height > 0)
				out.push({ kind: 'unanswered-table', el: label(t), by: Math.round(t.getBoundingClientRect().height) });
		}
	}

	/* 7. two stacked scrollports on the shell — the doubled scrollbar of #12 */
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

const list = requireStands(stands(arg('only', ''), { all: ALL_STANDS }), 'live-audit');
const browser = await pw[ENGINE].launch();
const seen = {}, fresh = [];
let checked = 0;

/* THE ROUTERS RUN AT THE SAME TIME. Nothing here is a timing measurement — every finding is a
 * geometry or a name read out of a settled page — so two containers answering at once cannot change
 * an answer, and the wall clock is halved. (`scroll-jank` is the one gate that stays sequential,
 * because frame pacing IS its subject.) */
await Promise.all(list.map(async (stand) => {
	let here = 0;
	const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
	await sealToRouter(ctx, stand.base);
	const page = await ctx.newPage();
	const errs = [];
	/* A FETCH THAT FAILED IS NOT THIS THEME'S. The theme reaches no third-party host at run time —
	 * that is a rule of the package, not an accident (CLAUDE.md; the one convenience tool that ever
	 * wanted `curl` was refused over it) — so a console line about a resource that would not load,
	 * or an app's own updater giving up on an HTTP status, can only belong to somebody else's code.
	 *
	 * They are dropped rather than baselined because the text carries the stand's own port
	 * (`http://localhost:8024/…`), so a baseline entry would be keyed to a port and go stale the
	 * moment owlab hands out a different one.
	 *
	 * Measured: `luci-app-ssclash` asks GitHub for the latest mihomo release on two of its pages,
	 * and on a GitHub Actions runner — whose egress IP is shared and rate-limited — that answers
	 * 403. Nine findings across three routers, none of them reproducible here, all of them the
	 * runner's network rather than the page's markup. Anything that is not a network failure is
	 * still recorded: a TypeError out of a view, an unhandled rejection, our own broken require. */
	/* Every spelling a blocked or failed request reaches the console in. `Failed to fetch` is
	 * Chromium's rejection of a fetch(), `Load failed` is WebKit's and `NetworkError` Firefox's;
	 * `net::ERR_` is what stands.mjs's own seal produces when it aborts the request. An app may
	 * wrap any of them in its own sentence, in its own language — ssclash says
	 * `Не удалось получить последний релиз: TypeError: Failed to fetch` — so the match is on the
	 * engine's words inside the line, never on the app's. */
	const NETWORK_NOISE =
		/Failed to load resource|Failed to fetch|Load failed|NetworkError|net::ERR_|ERR_INTERNET_DISCONNECTED|HTTP \d{3}\b/i;
	const note = (text) => {
		const line = text.replace(/\s+/g, ' ').slice(0, 120);
		if (!NETWORK_NOISE.test(line)) errs.push(line);
	};
	page.on('pageerror', (e) => note(String(e)));
	page.on('console', (m) => { if (m.type() === 'error') note(m.text()); });
	await login(page, stand.base);

	/* Baselines are per ENGINE as well as per router: a second engine finds different things (the
	 * doubled scrollbar of #12 was Firefox-only), and mixing the two sets would let a chromium run
	 * bless a firefox finding it never saw. */
	const key = ENGINE === 'chromium' ? stand.id : `${stand.id}@${ENGINE}`;
	const known = baseline[key] || [];
	const kset = new Set(known);
	seen[key] = new Set();

	let paths = (await menuPaths(page)).filter((p) => !DESTRUCTIVE.test(p));
	if (ONLY_PAGES) paths = paths.filter((p) => p.startsWith(ONLY_PAGES));

	if (!ALL_PAGES && !ONLY_PAGES) {
		/* one load per page to read its shape, then one representative per shape — plus every path
		 * the baseline names and every pinned page, which may never be sampled away */
		const shapes = await classify(page, stand.base, paths);
		const { picked, dropped } = representatives(shapes, [ ...known.map((sig) => sig.split('|')[0]), ...PINNED ]);
		reportReduction(stand.id, picked, dropped, shapes);
		paths = picked;
	}

	for (const path of paths) {
		await page.setViewportSize({ width: 1440, height: 900 });
		errs.length = 0;
		try { await page.goto(stand.base + path, { waitUntil: 'domcontentloaded', timeout: 20000 }); }
		catch (e) { continue; }
		/* a view renders behind an RPC; give it the time a user would wait before judging it */
		await page.waitForTimeout(1800);
		/* a page the router refuses (an app in the menu whose ACL says no) is not a layout finding */
		if (!(await page.evaluate(() => !!document.getElementById('view')))) continue;
		checked++; here++;

		/* what the RESIZE pass saw at the arrival width, so the arrival pass can report only what is
		 * new about arriving. See the arrival block below. */
		const atArrive = new Set();
		const record = (width, f) => {
			const sig = `${path}|${width}|${f.kind}|${f.el}`;
			if (width === ARRIVE) atArrive.add(`${f.kind}|${f.el}`);
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
			try { for (const f of await page.evaluate(GEOMETRY)) record(w, f); } catch (e) { /* see there */ }
		}

		/* The arrival (see ARRIVE above): the page reached AT this width rather than resized into it.
		 *
		 * Only what the resize at this width did not already say. A fault the same width produces
		 * either way is one fault, and recording it under a second signature doubles the baseline with
		 * copies that carry no information — and those copies are machine-specific, since the baseline
		 * is a union across platforms and a machine only sees the apps it installs, so a duplicate
		 * recorded where those apps exist is a red gate everywhere they do not. */
		if (ARRIVE > 0) {
			await page.setViewportSize({ width: ARRIVE, height: 900 });
			let arrived = true;
			try { await page.goto(stand.base + path, { waitUntil: 'domcontentloaded', timeout: 20000 }); }
			catch (e) { arrived = false; }
			if (arrived) {
				await page.waitForTimeout(1800);
				let found = [];
				try { found = await page.evaluate(CHECK); } catch (e) { found = []; }
				try { found = found.concat(await page.evaluate(GEOMETRY)); } catch (e) { /* see there */ }
				for (const f of found) {
					if (atArrive.has(`${f.kind}|${f.el}`)) continue;
					record(ARRIVE + 'a', f);
				}
			}
		}
	}
	await ctx.close();
	process.stdout.write(`${key}: ${seen[key].size} finding(s) over ${here} page(s)\n`);
}));
await browser.close();

/* A run narrowed by --pages or --widths visited only part of the baseline, so it may neither rewrite
 * it nor report the rest as fixed. */
/* …and a run that measured one page per shape is narrowed like any other: it cannot tell a finding
 * that stopped happening from a page it did not open. */
const fullSweep = !ONLY_PAGES && arg('widths', null) === null && arg('arrive', null) === null && ALL_PAGES;

if (UPDATE) {
	if (!fullSweep) {
		console.error('live-audit: --update needs a full sweep — a run narrowed by --pages or --widths');
		console.error('would drop every signature it did not visit. Drop the narrowing flags.');
		process.exit(2);
	}
	/* Adding is safe, removing is a decision — and this file is a UNION ACROSS PLATFORMS, which is what
	 * makes the difference matter: a run sees the apps THIS machine has. Rewriting a router's set
	 * from what one machine saw deletes every finding belonging to an app it does not have, and the
	 * next CI run reports them as new — a red gate produced by a green one. So `--update` unions and
	 * prints what did not reproduce, while `--prune` is the deliberate act of dropping those. */
	const next = Object.assign({}, baseline);
	for (const id of Object.keys(seen)) {
		const now = [ ...seen[id] ];
		next[id] = PRUNE ? now.sort() : [ ...new Set([ ...(baseline[id] || []), ...now ]) ].sort();
	}
	const untouched = Object.keys(baseline).filter((id) => !(id in seen));
	mkdirSync(dirname(BASELINE), { recursive: true });
	writeFileSync(BASELINE, JSON.stringify(next, null, '\t') + '\n');
	console.log(PRUNE ? 'baseline rewritten (pruned to this run):' : 'baseline updated (union):', BASELINE);
	if (untouched.length)
		console.log(`  kept as they were: ${untouched.join(', ')} (not measured by this run)`);
	process.exit(0);
}

/* A signature that stopped appearing is not a failure — it is a fix, and the baseline should shrink
 * to match. Printed, never gating: a page an app no longer installs would otherwise fail the run.
 *
 * Only a FULL sweep may say that: a run narrowed by --pages or --widths did not visit most of the
 * baseline, and reporting the rest as "no longer reproduces" is how a baseline gets emptied by
 * someone debugging one page. */
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
