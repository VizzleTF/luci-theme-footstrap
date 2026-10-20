#!/usr/bin/env node
/* The page gate: every page the router's menu offers, at every width that matters, measured for the
 * faults that reached users (#1, #5, #10-#15, #22, #32, #33, #36) and that no file shows.
 * Kinds: `doc-scroll`, `overflow`, `clipped`, `target` (WCAG 2.5.8), `noname` (WCAG 4.1.2),
 * `ungated-table`/`unanswered-table`, `nested-scroll`, `dead-floor`, `geometry` (chrome model vs
 * real box), `console`. The sweep starts at 320 px, the narrowest reflow WCAG 1.4.10 asks.
 * Ratchet like css-metrics.mjs: signatures `path|width|kind|element` in tools/baselines/
 * live-audit.json, a NEW one fails, a vanished one is printed; the file is a union across platforms
 * (text metrics differ). `noname` (not width dependent), `console` (a page event): width 0.
 *
 *   node tools/live-audit.mjs [--only owrt2512,owrt2410] [--widths 320,390,768,1440]
 *                             [--pages /admin/status] [--pages-all] [--all] [--update] [--prune]
 *                             [--seen-out f.json] [--seen-in a.json,b.json [--update --prune]]
 *                             [--engine chromium|firefox|webkit] [--lang ru] [--settle 460]
 *
 * Needs a running owlab router. `--update` rewrites the baseline: read the diff first.
 * `--pages-all --seen-in …` alone is a dry run: prints how many entries --prune would drop.
 * `--settle`, `--lang`: docs/development.md, "The live gates". */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/root.mjs';
import { execFileSync } from 'node:child_process';
import * as pw from 'playwright';
import { stands, coreId, login, menuPaths, DESTRUCTIVE, requireStands, sealToRouter, eachStand, reportDown } from './lib/stands.mjs';
import { mergeBaseline, baselineKey, openSeen, noteFinding, seenToJson, readSeenIn, prunable, isFullSweep, staleCounts } from './lib/baseline-merge.mjs';
import { classify, representatives, reportReduction, reportFrozen, PINNED } from './lib/page-shapes.mjs';
import { parseFlags, makeSay } from './lib/util.mjs';

const BASELINE = join(ROOT, 'tools/baselines/live-audit.json');

const FLAGS = parseFlags('live-audit', {
	update: { type: 'boolean', default: false }, prune: { type: 'boolean', default: false },
	'seen-out': { type: 'string', default: '' }, 'seen-in': { type: 'string', default: '' },
	engine: { type: 'string', default: 'chromium' }, lang: { type: 'string', default: 'en' },
	/* `widths` has no parseArgs `default:` on purpose — `fullSweep` below tells "not passed" from
	 * "passed the default value" by checking FLAGS.widths for undefined, which a parseArgs default
	 * would erase. */
	widths: { type: 'string' }, pages: { type: 'string', default: '' },
	'pages-all': { type: 'boolean', default: false }, all: { type: 'boolean', default: false },
	settle: { type: 'string', default: '460' }, only: { type: 'string', default: '' },
});
const UPDATE = FLAGS.update;
/* with --update: replace each measured router's set instead of unioning into it. Removes findings
 * that belong to apps this machine simply does not install, so it is the flag you reach for after
 * reading the "no longer reproduce" list, not the one you run by habit. */
const PRUNE = FLAGS.prune;
/* A run narrowed by --pages or --widths, or one page per shape, visited only part of the baseline:
 * it may neither rewrite it nor report the rest as fixed. Decided from the flags, before launch. */
const fullSweep = isFullSweep(FLAGS);
if (FLAGS.update && !fullSweep) {
	console.error('live-audit: --update needs a full sweep (--pages-all, no --pages or --widths) —');
	console.error('a narrowed run would drop every signature it did not visit.');
	process.exit(2);
}
/* --prune weighs a signature against this run only unless the files of other runs (CI's) vouch too. */
if (PRUNE && !FLAGS.update) {
	console.error('live-audit: --prune only acts together with --update (a full sweep); alone it does nothing.');
	process.exit(2);
}
if (FLAGS['seen-in'] && FLAGS.update && !PRUNE) {
	console.error('live-audit: --seen-in only vouches for --prune; add --prune, or drop --update for a dry run.');
	process.exit(2);
}
/* --seen-in alone is a dry run: it reports what --prune would drop, writes nothing. */
if (FLAGS['seen-in'] && !fullSweep) {
	console.error('live-audit: --seen-in needs a full sweep (--pages-all, no --pages or --widths).');
	process.exit(2);
}
const SEEN_IN = readSeenIn(FLAGS['seen-in'], (f) => readFileSync(f, 'utf8'));
const ENGINE = FLAGS.engine;
/* the language the router is measured in — see the file header. `en` is the default and maps to
 * `auto`, which is what every existing baseline entry was collected against. */
const LANG = FLAGS.lang;
if (!/^[a-z]{2,3}(-[a-zA-Z0-9]+)?$/.test(LANG)) {
	console.error(`live-audit: --lang wants a language code (or "en"), got "${LANG}"`);
	process.exit(2);
}
/* uci wants `auto`, never the literal `en` — LuCI ships no catalogue for English, it's the source
 * strings, so `en` names in this file are the AUDIT's language, not a `uci luci.main.lang` value. */
const setRouterLang = (id, code) => {
	try {
		execFileSync('owlab', [ 'exec', id, '--', 'uci', 'set', `luci.main.lang=${code === 'en' ? 'auto' : code}` ], { stdio: 'ignore' });
		execFileSync('owlab', [ 'exec', id, '--', 'uci', 'commit', 'luci' ], { stdio: 'ignore' });
	} catch (e) {
		console.error(`live-audit: could not set luci.main.lang on ${id} (${e.message})`);
		process.exit(2);
	}
};
/* 320 is the narrowest width WCAG 1.4.10 requires content to reflow to; 390 is the modal phone;
 * 568 is where the theme's own card decision sits; 768 and 1024 bracket the sidebar's fit; 1440 is
 * the desktop the reports come from. */
const ONLY_PAGES = FLAGS.pages;
/* Measure one page per SHAPE instead of every leaf of the menu — see lib/page-shapes.mjs for what a
 * shape is and for the three sets that are never sampled away. `--pages-all` takes them all. */
const ALL_PAGES = FLAGS['pages-all'];
/* every running OpenWrt router rather than CORE (lib/stands.mjs) */
const ALL_STANDS = FLAGS.all;
/* Entering a page at a width is not RESIZING into it: the fitters re-run on a resize, which hides an
 * arrival bug (a first fit pass caches "no remedy" for a table, which then sits 65px past its column).
 * So ONE width is also entered with a load of its own; 768 is where the sidebar has just folded and
 * a data table still has to break a column. Its findings are signed `<width>a`. */
const ARRIVE = 768;
/* the arrival pass diffs against the resize pass at ARRIVE, so a narrowed --widths still sweeps it;
 * without it `atArrive` stays empty and every arrival finding is reported NEW */
const WIDTHS = [ ...new Set([ ...(FLAGS.widths ?? '320,390,568,768,1024,1440').split(',').map(Number), ARRIVE ]) ].sort((a, b) => a - b);
/* Past fs-fit.js's SCROLL_IDLE (400ms): sampling inside that window reads the theme's own deferred
 * state, not a break (docs/development.md, "The live gates"). */
const SETTLE_MS = Number(FLAGS.settle);
if (!Number.isFinite(SETTLE_MS) || SETTLE_MS < 0) {
	console.error(`live-audit: --settle wants a wait in ms, got "${FLAGS.settle}"`);
	process.exit(2);
}

/* Does the chrome's arithmetic still describe the page it is about?
 *
 * `fs-chrome.contentWidth()` answers "how wide is the content column" from the chrome's cached model plus
 * one window-width read, for the one pass that may not read layout per table. It gets there by subtracting the sidebar and the shell's
 * gutter from the window, every term a token read out of the stylesheet — so it is a model of the
 * page, and a model drifts silently. It has: the gutter was once subtracted twice, and the top-bar
 * layout kept a sidebar in the sum, both worth enough to cross fs-select's CRAMPED threshold and
 * card a table that had room. Compared only below the column's max-width: the model has no cap. */
const GEOMETRY = function () {
	const RT = window.L;
	if (!RT || typeof RT.require !== 'function') return [];
	return RT.require('fs-chrome').then((chrome) => {
		const col = document.querySelector('.fs-content');
		if (!col || typeof chrome.contentWidth !== 'function') return [];
		const cs = getComputedStyle(col);
		/* the model has no cap: a column held at its max-width is margin, not a drift */
		if (col.offsetWidth >= parseFloat(cs.maxWidth)) return [];
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
	for (const el of host.querySelectorAll('.cbi-section, .table, .alert-message, .cbi-value')) {
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

	/* 7. A poll floor that holds page the reader cannot see: `min-height` beats the `height: 0` of an
	 * inactive tab pane, so a floor on the PANE pins it open (1265px blank on Network -> Interfaces,
	 * issue #41). Only the pane, or a hidden box nothing clips, is flagged: `visibility` inherits and
	 * a floor on a child of the zeroed pane is clipped away (stripping 32 of them at 320px changed
	 * the document by 0px; flagging them cost 408 findings that named nothing). */
	if (document.documentElement.hasAttribute('data-fs-fit')) {
		for (const el of document.querySelectorAll('#view [style*="min-height"]')) {
			if (getComputedStyle(el).visibility !== 'hidden') continue;
			const pane = el.closest('[data-tab-title]:not([data-tab-active="true"])');
			/* the pane itself wearing one, or a hidden floor with no collapsed pane above it */
			if (pane === el || !pane)
				out.push({ kind: 'dead-floor', el: label(el), by: el.style.minHeight });
		}
	}

	/* 8. two stacked scrollports on the shell — the doubled scrollbar of #12 */
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

if (!pw[ENGINE]) {
	console.error(`live-audit: no such engine "${ENGINE}"`);
	process.exit(2);
}
const list = requireStands(stands(FLAGS.only, { all: ALL_STANDS }), 'live-audit');
const browser = await pw[ENGINE].launch();
const seen = {}, fresh = [];
/* pages that froze while their shape was being read — their own kind of finding, and fatal on
 * their own: reportFrozen() below (lib/page-shapes.mjs) */
const frozen = [];
/* pages or widths the run could not measure (goto failed, CHECK threw): never a baseline change */
const unreached = [], skipped = [];
let checked = 0, armed = 0;

const say = makeSay();

/* The routers run at the same time: every finding is a geometry or a name read out of a settled
 * page, so concurrent containers change no answer and halve the wall clock (scroll-jank stays
 * sequential, frame pacing being its subject). */
const down = await eachStand(list, async (stand) => {
	let here = 0;
	/* Set before the sweep and restored to `auto` in the `finally` below: a router never stays parked
	 * in a language a later, unflagged run would inherit. */
	setRouterLang(stand.id, LANG);
	try {
		const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
		await sealToRouter(ctx, stand.base);
		const page = await ctx.newPage();
		const errs = [];
		/* A failed fetch is not this theme's: it reaches no third-party host at run time. Network
		 * failures are dropped, not baselined, because the text carries the stand's port
		 * (`http://localhost:8024/…`) and a baseline entry would go stale. Measured: ssclash asks
		 * GitHub for a release on two pages and a CI runner gets 403, nine findings on three routers.
		 * Anything else (a TypeError out of a view, an unhandled rejection) is still recorded. */
		/* Every spelling a failed request reaches the console in: `Failed to fetch` Chromium, `Load
		 * failed` WebKit, `NetworkError` Firefox, `net::ERR_` stands.mjs's own seal. An app may wrap
		 * them in its own language, so the match is on the engine's words inside the line. */
		const NETWORK_NOISE =
			/Failed to load resource|Failed to fetch|Load failed|NetworkError|net::ERR_|ERR_INTERNET_DISCONNECTED|HTTP \d{3}\b/i;
		const note = (text) => {
			const line = text.replace(/\s+/g, ' ').slice(0, 120);
			if (!NETWORK_NOISE.test(line)) errs.push(line);
		};
		page.on('pageerror', (e) => note(String(e)));
		page.on('console', (m) => { if (m.type() === 'error') note(m.text()); });
		await login(page, stand.base, stand.id);

		/* Baselines are per ENGINE and per LANGUAGE, as well as per router: a second engine finds different
		 * things (the doubled scrollbar of #12 was Firefox-only), a second language finds different things
		 * for the reason the file header gives, and mixing either pair of sets would let one run bless a
		 * finding it never saw. Suffixes compose (`owrt2512@ru@firefox`) rather than picking one. */
		const key = baselineKey(stand.id, LANG, ENGINE);
		const known = baseline[key] || [];
		openSeen(seen, key);
		/* the stand's own id for output (a twin is not its core), the core's key for the baseline */
		const label = key.replace(coreId(stand.id), stand.id), mine = new Set();

		let paths = (await menuPaths(page)).filter((p) => !DESTRUCTIVE.test(p));
		if (ONLY_PAGES) paths = paths.filter((p) => p.startsWith(ONLY_PAGES));

		if (!ALL_PAGES && !ONLY_PAGES) {
			/* one load per page to read its shape, then one representative per shape — plus every path
			 * the baseline names and every pinned page, which may never be sampled away */
			say(`${label}: reading the shape of ${paths.length} page(s)`);
			const shapes = await classify(page, stand.base, paths, { frozen, id: label });
			const { picked, dropped } = representatives(shapes, [ ...known.map((sig) => sig.split('|')[0]), ...PINNED ]);
			reportReduction(stand.id, picked, dropped, shapes);
			paths = picked;
		}

		let n = 0;
		for (const path of paths) {
			say(`${label} ${++n}/${paths.length} ${path}`);
			await page.setViewportSize({ width: 1440, height: 900 });
			errs.length = 0;
			try { await page.goto(stand.base + path, { waitUntil: 'domcontentloaded', timeout: 20000 }); }
			catch (e) { unreached.push(`${label} ${path} (goto: ${e.message.split('\n')[0]})`); continue; }
			/* a view renders behind an RPC; give it the time a user would wait before judging it */
			await page.waitForTimeout(1800);
			/* a page the router refuses (an app in the menu whose ACL says no) is not a layout finding */
			if (!(await page.evaluate(() => !!document.getElementById('view')))) { skipped.push({ key, path }); continue; }
			checked++; here++;
			/* whether the theme actually ran on this page — a stand rebuilt without `owlab sync`
			 * (docs/development.md) serves every page LuCI-bare, `data-fs-fit` never appears, and
			 * ungated-table/unanswered-table/dead-floor (all three gated on it) check nothing on any
			 * page for the whole run without a single line saying so */
			if (await page.evaluate(() => document.documentElement.hasAttribute('data-fs-fit'))) armed++;

			/* what the RESIZE pass saw at the arrival width, so the arrival pass can report only what is
			 * new about arriving. See the arrival block below. */
			const atArrive = new Set();
			const record = (width, f) => {
				const sig = `${path}|${f.kind === 'noname' ? 0 : width}|${f.kind}|${f.el}`;
				if (width === ARRIVE) atArrive.add(`${f.kind}|${f.el}`);
				mine.add(sig);
				noteFinding(seen, baseline, fresh, key, sig, f.by);
			};

			for (const w of WIDTHS) {
				await page.setViewportSize({ width: w, height: 900 });
				/* GEOMETRY is sampled immediately, inside the defer window: its promise holds whenever it
				 * is asked (fs-select reads it mid-scroll), and a later sample hides a stale
				 * contentWidth(). Sampled again after the wait; one signature either way. */
				try { for (const f of await page.evaluate(GEOMETRY)) record(w, f); } catch (e) { /* see there */ }
				/* Every other check needs the deferred pass to have run, so it waits past SCROLL_IDLE. */
				await page.waitForTimeout(SETTLE_MS);
				let found = [];
				try { found = await page.evaluate(CHECK); } catch (e) { unreached.push(`${label} ${path} at ${w}px (CHECK: ${e.message.split('\n')[0]})`); continue; }
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
			await page.setViewportSize({ width: ARRIVE, height: 900 });
			let arrived = true;
			try { await page.goto(stand.base + path, { waitUntil: 'domcontentloaded', timeout: 20000 }); }
			catch (e) { arrived = false; unreached.push(`${label} ${path} at ${ARRIVE}px (arrival goto: ${e.message.split('\n')[0]})`); }
			if (arrived) {
				await page.waitForTimeout(1800);
				let found = [];
				try { found = await page.evaluate(CHECK); } catch (e) { unreached.push(`${label} ${path} at ${ARRIVE}px (arrival CHECK: ${e.message.split('\n')[0]})`); }
				try { found = found.concat(await page.evaluate(GEOMETRY)); } catch (e) { /* see there */ }
				for (const f of found) {
					if (atArrive.has(`${f.kind}|${f.el}`)) continue;
					record(ARRIVE + 'a', f);
				}
			}
			for (const e of [...new Set(errs)].slice(0, 3)) record(0, { kind: 'console', el: e });
		}
		await ctx.close();
		say(`${label}: ${mine.size} finding(s) over ${here} page(s)`);
	} finally {
		/* Never leave a router parked off `auto` — the next unflagged run must not silently inherit
		 * this one's language, which is the exact shape of the incident this flag exists to close. */
		setRouterLang(stand.id, 'en');
	}
});
await browser.close();
const unanswered = reportDown('live-audit', down);

function reportFresh() {
	console.error(`\nlive-audit: ${fresh.length} NEW finding(s):\n`);
	for (const f of fresh.slice(0, 60)) console.error(`  ${f.stand}  ${f.sig}${f.by != null ? '  (' + f.by + ')' : ''}`);
	if (fresh.length > 60) console.error(`  … and ${fresh.length - 60} more`);
	console.error('\nEach line is path|width|kind|element. Fix it, or — if it belongs to the app and');
	console.error('not to the theme — say so in the commit and re-run with --update.');
}

/* A page that froze is measured by nobody, and it is never a baseline entry: a signature can be
 * blessed, a stopped main thread cannot. First of the three, because it names the actual cause —
 * enough of them and `checked === 0` below would blame the login instead — and before --update,
 * because a run that lost pages to a freeze may not rewrite the baseline from what it did see. */
if (reportFrozen(frozen)) {
	console.error('live-audit: those pages were not audited at any width. Fix the freeze first.\n');
	process.exit(1);
}

if (unreached.length) {
	console.error(`\nlive-audit: ${unreached.length} page/width(s) were not measured:\n`);
	for (const u of unreached.slice(0, 30)) console.error(`  ${u}`);
	if (unreached.length > 30) console.error(`  … and ${unreached.length - 30} more`);
	console.error('\nA run that lost pages may not pass, and may not rewrite the baseline (--update/--prune).\n');
	process.exit(1);
}

/* A router that never answered lost all its pages: same rule (no --seen-out, no --update), its empty
 * section would read as "reproduced nothing". The routers that did answer still get their verdict. */
if (unanswered) {
	if (fresh.length) reportFresh();
	else if (checked) console.log(`live-audit: ${checked} page render(s) on the router(s) that answered, no new findings.`);
	process.exit(1);
}

/* Zero of either is not a clean sweep. `checked === 0` is every router unauthenticated or every
 * page in the menu lacking #view — the shape `login()` never checks for (lib/stands.mjs). `armed
 * === 0` with `checked > 0` is pages rendering LuCI-bare: a stand rebuilt with `owlab up --rebuild`
 * carries no theme until `owlab sync` (docs/development.md), every check gated on data-fs-fit
 * (ungated-table, unanswered-table, dead-floor) then checks nothing for the whole run, and nothing
 * before this printed that it had not. */
if (checked === 0) {
	console.error('\nlive-audit: 0 of ' + list.length + ' router(s) rendered a page — every router '
		+ 'was unauthenticated, or every page in its menu lacked #view. This is not a clean sweep; it is nothing measured.\n');
	process.exit(1);
}
if (armed === 0) {
	console.error(`\nlive-audit: ${checked} page(s) rendered but data-fs-fit never appeared on any of `
		+ 'them — the theme is not installed on the stand(s) measured (owlab sync after a rebuild, '
		+ 'docs/development.md). ungated-table, unanswered-table and dead-floor were not checked.\n');
	process.exit(1);
}

if (FLAGS['seen-out']) writeFileSync(FLAGS['seen-out'], JSON.stringify(seenToJson(seen), null, '\t') + '\n');

/* A signature that stopped appearing is not a failure — it is a fix, and the baseline should shrink
 * to match. Printed, never gating: a page an app no longer installs would otherwise fail the run.
 *
 * Only a FULL sweep may say that: a run narrowed by --pages or --widths did not visit most of the
 * baseline, and reporting the rest as "no longer reproduces" is how a baseline gets emptied by
 * someone debugging one page. */
const { stale, wouldDrop } = staleCounts(baseline, seen, SEEN_IN);
if (stale && fullSweep)
	console.log(`${stale} baseline entr(ies) not reproduced on their own stand; ${wouldDrop} would be dropped by --update --prune`
		+ (FLAGS['seen-in'] ? ' (seen nowhere in this run or the --seen-in files).' : ' (seen by no stand of this run; without --seen-in this counts this run only).'));

if (UPDATE) {
	/* Adding is safe, removing is a decision — and this file is a UNION ACROSS PLATFORMS, which is what
	 * makes the difference matter: a run sees the apps THIS machine has. Rewriting a router's set
	 * from what one machine saw deletes every finding belonging to an app it does not have, and the
	 * next CI run reports them as new — a red gate produced by a green one. So `--update` unions and
	 * prints what did not reproduce, while `--prune` is the deliberate act of dropping those. */
	const blocked = PRUNE ? prunable(baseline, skipped) : [];
	if (blocked.length) {
		console.error('live-audit: --prune refused, these pages rendered no #view so their entries cannot be judged:');
		for (const b of blocked) console.error(`  ${b}`);
		process.exit(1);
	}
	const { next, dropped } = mergeBaseline(baseline, seen, PRUNE, SEEN_IN);
	if (PRUNE && !FLAGS['seen-in'])
		console.warn('live-audit: --prune without --seen-in weighs this run alone; signatures only CI reproduces may be lost.');
	const untouched = Object.keys(baseline).filter((id) => !(id in seen));
	writeFileSync(BASELINE, JSON.stringify(next, null, '\t') + '\n');
	console.log(PRUNE ? 'baseline rewritten (pruned of entries no stand of this run reproduced):' : 'baseline updated (union):', BASELINE);
	for (const d of dropped) console.log(`  dropped ${d}`);
	if (untouched.length)
		console.log(`  kept as they were: ${untouched.join(', ')} (not measured by this run)`);
	process.exit(0);
}


if (fresh.length) {
	reportFresh();
	process.exit(1);
}
console.log(`live-audit: ${checked} page render(s) across ${list.length} router(s), no new findings.`);
