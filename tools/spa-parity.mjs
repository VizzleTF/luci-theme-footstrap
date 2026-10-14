#!/usr/bin/env node
/* The navigation gate: a page opened by a click must be the same page a full load gives.
 *
 * The client router (docs/spa-router.md) must redo what a fresh document does for free: an empty uci
 * cache and poll queue, no stray intervals or notifications, a re-stamped body[data-page], a view
 * constructed rather than reused. This gate opens every page BOTH ways and compares what the user
 * ends up with: how much the view painted, which config packages are in uci's cache (a state bug
 * with no visible symptom: `uci.state.values` is `{}` after a click), how many wifi devices
 * network.js answers with, and whether the click path threw where a full load did not.
 * No baseline: a difference between the two ways is always a bug.
 *
 *   node tools/spa-parity.mjs [--only owrt2512,owrt2410] [--all] [--pages /admin/network] [--pages-all]
 *
 * Needs a running owlab router (docs/development.md). */
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { stands, login, menuPaths, DESTRUCTIVE, requireStands, sealToRouter, waitForPaint } from './lib/stands.mjs';
import { classify, representatives, reportReduction, reportFrozen, PINNED } from './lib/page-shapes.mjs';
import { read } from './lib/root.mjs';
import { parseFlags, makeSay } from './lib/util.mjs';

const FLAGS = parseFlags('spa-parity', {
	pages: { type: 'string', default: '' }, 'pages-all': { type: 'boolean', default: false },
	all: { type: 'boolean', default: false }, only: { type: 'string', default: '' },
});
const ONLY_PAGES = FLAGS.pages;
/* one page per SHAPE rather than every leaf — lib/page-shapes.mjs; `--pages-all` takes them all */
const ALL_PAGES = FLAGS['pages-all'];
const ALL_STANDS = FLAGS.all;
/* Every navigation starts here, so each page is reached as a real click from another page rather
 * than from whatever the previous iteration left behind. */
const ORIGIN = '/admin/status/overview';
/* CLICK a link, because that is the only thing the router hooks — driving navigate() directly would
 * test a function nobody calls that way. A page with no such link in its menu gets a probe anchor. */
const clickTo = (page, to) => page.evaluate((to) => {
	const href = '/cgi-bin/luci' + to;
	let a = [ ...document.querySelectorAll('a[href]') ].find((x) => x.getAttribute('href') === href);
	if (!a) { a = document.createElement('a'); a.href = href; a.textContent = 'probe'; document.getElementById('view').append(a); }
	a.click();
}, to);
/* the origin itself is clicked to from here, so `--pages /admin/status/overview` has a click to compare */
const ORIGIN_ALT = '/admin/system/package-manager';

const measure = async (page) => {
	try {
		return await page.evaluate(() => {
			const v = document.getElementById('view');
			const text = (v ? v.textContent : '').replace(/\s+/g, ' ').trim();
			const out = {
				/* an untitled node must fall back to the hostname in the heading on a click as on a load */
				heading: ((document.querySelector('.fs-title-main') || {}).textContent || '').trim(), docTitle: document.title,
				chars: text.length, nodes: v ? v.querySelectorAll('*').length : 0, uci: '', wifi: -1,
				/* The staged render puts a second `#view` in the document on purpose — LuCI's own chain
				 * resolves `#view` at paint time and must find the stage — but it is transient BY
				 * CONSTRUCTION, and this is what keeps it so: a stage that outlives its navigation is
				 * two elements answering to one id for the rest of the document, and the next view
				 * would paint into the leftover. */
				views: document.querySelectorAll('#view').length,
				stages: document.querySelectorAll('.fs-staging').length,
			};
			try { out.uci = Object.keys(window.L.uci.state.values || {}).sort().join(','); } catch (e) {}
			return (window.L.network
				? window.L.network.getWifiDevices().then((d) => { out.wifi = d.length; return out; }).catch(() => out)
				: out);
		});
	} catch (e) {
		/* a page that navigates on its own (logout, reboot) destroys the context mid-read */
		return null;
	}
};

/* What a trip through a background tab leaves behind: fs-router pauses a view's `setInterval` while
 * hidden and re-arms it on return. A re-armed timer under a fresh id cannot be stopped by its view,
 * and a paused one sat outside the registry a navigation sweeps, so the previous page's timers came
 * back. `document.hidden` is overridden as browser tooling does; the full load that follows discards it. */
const timerProbe = async (page) => {
	try {
		return await page.evaluate(async () => {
			const reg = window.__fsViewIntervals;
			if (!reg || typeof reg.size !== 'number') return null;
			const hide = (v) => {
				Object.defineProperty(document, 'hidden', { configurable: true, get: () => v });
				document.dispatchEvent(new Event('visibilitychange'));
			};
			const settle = () => new Promise((r) => setTimeout(r, 150));
			const before = reg.size;
			hide(true);
			await settle();
			/* the hide handler stops L.Poll before it pauses the view timers, so its tick is not armed either */
			const armedHidden = [ ...reg.values() ].filter((s) => s && s.live != null).length;
			hide(false);
			await settle();
			return { before, armedHidden, after: reg.size };
		});
	}
	catch (e) { return null; }
};

/* ---- the staging window itself, not just what arrives after it ----
 *
 * The outgoing page keeps its page-scoped CSS until commitStage: when `body[data-page]` flipped at
 * the click, 33 rules of 20-overview.css stopped matching for 1407 ms, +211px of document, reader
 * moved 140px (docs/spa-router.md, "The staging window"). Sampled mid-flight with the incoming
 * view's module fetch held open (a stand's window is ~210 ms, too short; development.md, "The live gates"). */
const STAGING_ROUTE = '**/luci-static/resources/view/**';
const STAGING_DELAY_MS = 1200;
const STAGING_CASES = [
	/* the Overview's own stray `<h2 name="content">` (view.ut) is hidden by
	 * `.fs-content[data-page="admin-status-overview"] h2[name="content"]`
	 * (styles/pages/20-overview.css) — present only right after a full load, before the first SPA
	 * nav sweeps it, which is exactly the ORIGIN every case below full-loads to first. */
	{ from: '/admin/status/overview', to: '/admin/system/package-manager',
	  owned: '#maincontent h2[name="content"]', prop: 'display', want: 'none' },
	/* package-manager's own page CSS (styles/pages/30-software.css) has no single always-present
	 * element as reliable as the Overview's heading, so only the height half is checked here — the
	 * half the card asks to prove on this page by name. */
	{ from: '/admin/system/package-manager', to: '/admin/status/overview' },
];

/* ---- the narrow-viewport pass ----
 *
 * theme/90-responsive.css scopes its package-manager rules through
 * `:where(#view)[data-page="admin-system-package-manager"]`, inside `@media (max-width: …px)`; that
 * query never matches at the 1440px context the cases above run in, so this pass is a regression
 * guard for the scope. The width is read out of the file, not hard-coded, so an edit to the
 * breakpoint cannot make this pass silently stop testing anything. */
const NARROW_CSS_PATH = 'luci-theme-footstrap/styles/theme/90-responsive.css';
function narrowBreakpoint() {
	const m = read(NARROW_CSS_PATH).match(/@media\s*\(max-width:\s*(\d+)px\)/);
	if (!m)
		throw new Error(`spa-parity: no @media (max-width) in ${NARROW_CSS_PATH} to size the narrow-viewport pass off of`);
	return Number(m[1]);
}
const NARROW_WIDTH = narrowBreakpoint();
const NARROW_STAGING_CASES = [
	/* `body[data-page="admin-system-package-manager"] #view .controls > div:not(.pager) { display:
	 * block !important }` stacks each labelled control. Leaving the page, mid-flight the outgoing
	 * `#view`/`.fs-content` still carry the OUTGOING name (commitStage), but `body`'s is already the
	 * incoming route's (navigate(), fs-router.js) — an unfixed body-scoped rule here stops matching
	 * and the row reverts to its unstacked flex layout while the reader is still looking at it. */
	{ from: '/admin/system/package-manager', to: '/admin/status/overview',
	  owned: '#view .controls > div:not(.pager)', prop: 'display', want: 'block' },
];

/* Attempts per case while the outgoing page's own content moved (a height change WITH content
 * mutations proves nothing, so it is retried; the `owned` rule check is a finding on any attempt).
 * Overview still rendered at the click on CI, 2959 -> 3540px: development.md, "The live gates". */
const STAGING_ATTEMPTS = 3;

async function stagingWindowCheck(page, stand, findings, cases = STAGING_CASES, widthLabel) {
	for (const c of cases) {
		const add = (detail) => findings.push({ stand: stand.id,
			path: c.from + ' -> ' + c.to + (widthLabel ? ` @${widthLabel}px` : ''), kind: 'staging', detail });
		const busy = [];
		for (let attempt = 1; attempt <= STAGING_ATTEMPTS; attempt++) {
			const r = await stagingAttempt(page, stand, c);
			if (!r) break;
			if (r.unpainted) { add(`${c.from} page not painted, run proves nothing`); break; }
			if (r.mid.staged === 0) { add('the fake-slow route never caught a staging window — this case measured nothing'); break; }
			if (c.owned && r.mid.prop !== c.want) {
				add(`${c.owned} read ${JSON.stringify(r.mid.prop)} mid-flight, wanted ${JSON.stringify(c.want)} — `
					+ 'the outgoing page\'s own rule stopped matching');
				break;
			}
			if (r.mid.docH === r.before.docH) break;
			if (r.mid.mutations === 0) {
				add(`the outgoing page's document height moved during the staging window: ${r.before.docH} -> ${r.mid.docH}px`
					+ ' (no node of the outgoing page was added or removed inside the window)');
				break;
			}
			busy.push(`${r.before.docH} -> ${r.mid.docH}px with ${r.mid.mutations} content mutation(s)`);
			if (attempt === STAGING_ATTEMPTS)
				add(`the outgoing page's own content kept arriving inside the staging window on all ${STAGING_ATTEMPTS} `
					+ `attempts (${busy.join('; ')}) — this case measured nothing`);
		}
	}
}

/* One pass of a staging case: full-load the outgoing page, sample, click with the incoming view held open,
 * sample mid-flight. `mutations` counts nodes added to or removed from the outgoing page (the stage excluded)
 * between the two samples — see STAGING_ATTEMPTS. */
async function stagingAttempt(page, stand, c) {
	let before, mid;
	try {
		await page.goto(stand.base + c.from, { waitUntil: 'domcontentloaded', timeout: 20000 });
	}
	catch (e) { return null; }
	/* the router queues a click behind the outgoing page's first render, so a fixed wait on a freshly
	 * booted 24.10 (Overview paints at 3.1-6.4 s) clicked into no staging window at all */
	if (!await waitForPaint(page, 20000)) return { unpainted: true };
	await page.waitForTimeout(400);	/* let the arrival settle, same margin as backRestoreCheck */
	before = await page.evaluate((c) => {
		const el = c.owned ? document.querySelector(c.owned) : null;
		window.__fsStagingMut = 0;
		const host = document.querySelector('.fs-content') || document.body;
		const inStage = (n) => !!(n && ((n.classList && n.classList.contains('fs-staging'))
			|| (n.closest && n.closest('.fs-staging'))));
		window.__fsStagingMo = new MutationObserver((recs) => {
			for (const m of recs) {
				if (inStage(m.target)) continue;
				const nodes = [ ...m.addedNodes, ...m.removedNodes ].filter((n) => !inStage(n));
				if (nodes.length) window.__fsStagingMut++;
			}
		});
		window.__fsStagingMo.observe(host, { childList: true, subtree: true });
		return { docH: document.documentElement.scrollHeight,
		         prop: el ? getComputedStyle(el)[c.prop] : null };
	}, c);

	/* held open only for the click below, not for the goto()/settle above: slowing the
	 * outgoing page's own load would tell us nothing about the staging window */
	await page.route(STAGING_ROUTE, async (route) => {
		await delay(STAGING_DELAY_MS);
		/* the prefetch fetch() and require()'s own XHR can both name the same URL, and a route
		 * already settled by the other rejects a second continue() — nothing this probe reads
		 * depends on which of the two wins */
		try { await route.continue(); } catch (e) {}
	});
	await clickTo(page, c.to);
	/* mid-flight: well inside the held-open fetch, well before commitStage can run */
	await page.waitForTimeout(500);
	mid = await page.evaluate((c) => {
		const el = c.owned ? document.querySelector(c.owned) : null;
		if (window.__fsStagingMo) window.__fsStagingMo.disconnect();
		return { docH: document.documentElement.scrollHeight,
		         prop: el ? getComputedStyle(el)[c.prop] : null,
		         staged: document.querySelectorAll('.fs-staging').length,
		         mutations: window.__fsStagingMut || 0 };
	}, c);
	await page.unroute(STAGING_ROUTE);
	/* let the held-open navigation actually finish before the next case reuses this page */
	await page.waitForTimeout(STAGING_DELAY_MS + 1000);
	return { before, mid };
}

/* ---- browser Back must restore the reader's own scroll offset ----
 *
 * Scroll down on `from`, click into `to`, go Back, and read the element `saveScroll()`/
 * `restoreScroll()` use at this width: `#maincontent` where its `overflow-y` computes to
 * `auto`/`scroll` (sidebar layout), the document otherwise (docs/spa-router.md, "Scroll"). Run at
 * 1440 and at the narrow width, since the two layouts scroll different elements. */
const BACK_CASES = [
	{ from: ORIGIN, to: '/admin/system/package-manager' },
];
/* ---- the traversal is held open too, for the same reason the staging cases are ----
 *
 * Holding the incoming view's ubus calls open 700 ms makes the page whole at the swap every time
 * (owrt2410 2680 -> 2249 once in 15 runs otherwise); the settle is the swap's end plus fs-fit.js's
 * late-correction window, 419 ms after the commit, not a flat 3 s. SCROLL_IDLE is read out of
 * fs-fit.js, like the narrow breakpoint out of the CSS (development.md, "The live gates"). */
const BACK_RPC_ROUTE = '**/ubus**';
const BACK_RPC_DELAY_MS = 700;
const FIT_JS_PATH = 'luci-theme-footstrap/htdocs/luci-static/resources/fs-fit.js';
function lateWindow() {
	const m = read(FIT_JS_PATH).match(/const SCROLL_IDLE = (\d+);/);
	if (!m)
		throw new Error(`spa-parity: no SCROLL_IDLE in ${FIT_JS_PATH} to size the Back settle off of`);
	/* the correction is one rAF plus SCROLL_IDLE after the last commit batch; doubled is the slack
	 * a busy stand needs, stated once rather than as a number of its own */
	return Number(m[1]) * 2;
}
const BACK_SETTLE_MS = lateWindow();
/* rounding plus the odd late layout pass; the bug dropped a reader to 0 from ~3274px, far past this */
const BACK_TOLERANCE_PX = 40;

function readScrollOffset(page, useDoc) {
	return page.evaluate((doc) => {
		const sc = document.getElementById('maincontent');
		return doc ? Math.round(window.scrollY) : (sc ? sc.scrollTop : 0);
	}, useDoc);
}
function writeScrollOffset(page, useDoc, v) {
	return page.evaluate(({ doc, v }) => {
		const sc = document.getElementById('maincontent');
		if (doc) window.scrollTo(0, v);
		else if (sc) sc.scrollTop = v;
	}, { doc: useDoc, v });
}

async function backRestoreCheck(page, stand, findings, widthLabel) {
	for (const c of BACK_CASES) {
		const label = `${c.from} -> ${c.to}` + (widthLabel ? ` @${widthLabel}px (Back)` : ' (Back)');
		const add = (detail) => findings.push({ stand: stand.id, path: label, kind: 'back-scroll', detail });

		try { await page.goto(stand.base + c.from, { waitUntil: 'domcontentloaded', timeout: 20000 }); }
		catch (e) { continue; }
		/* the fixed 1400ms this used to wait raced the same late RPC scroll-jank.mjs hit in 7e08d1e:
		 * Overview's sections stay hidden until network.flushCache() answers, and on a router that
		 * just booted one answers past 1400ms — parked read 0 and this case misdiagnosed it as "no
		 * room to scroll". waitForPaint() is the same bounded wait, from lib/stands.mjs. */
		if (!await waitForPaint(page, 20000)) {
			add(`${c.from} page not painted, run proves nothing`);
			continue;
		}
		await page.waitForTimeout(400);	/* let the arrival settle, same margin scroll-jank.mjs uses */

		/* which scroller THIS width uses, read the same way fs-fit.js's own scroller() does — never
		 * assumed from the layout name, which a CSS edit could move independently of this gate */
		const useDoc = await page.evaluate(() => {
			const sc = document.getElementById('maincontent');
			const flow = sc ? getComputedStyle(sc).overflowY : '';
			return !(flow === 'auto' || flow === 'scroll');
		});

		await writeScrollOffset(page, useDoc, 100000);	/* as far as this page allows */
		const parked = await readScrollOffset(page, useDoc);
		if (parked < 80) {
			add(`${c.from} has no room to scroll at this width (parked at ${parked}px) — this case `
				+ 'proves nothing here');
			continue;
		}

		await clickTo(page, c.to);
		await page.waitForTimeout(1400);

		/* held only across the traversal itself — slowing the outgoing page would move the very
		 * timing under test */
		await page.route(BACK_RPC_ROUTE, async (route) => {
			await delay(BACK_RPC_DELAY_MS);
			try { await route.continue(); } catch (e) {}
		});
		await page.goBack();
		/* the swap's own start and end, not a clock: `.fs-staging` is the marker the staging cases
		 * above already read, and the window this route holds open is what makes it observable */
		let staged = false;
		try {
			await page.waitForFunction(() => document.querySelectorAll('.fs-staging').length > 0,
				null, { timeout: 15000 });
			staged = true;
			await page.waitForFunction(() => document.querySelectorAll('.fs-staging').length === 0,
				null, { timeout: 20000 });
		}
		catch (e) { /* reported below — a case that saw no swap measured nothing */ }
		await page.unroute(BACK_RPC_ROUTE);
		await page.waitForTimeout(BACK_SETTLE_MS);
		const restored = await readScrollOffset(page, useDoc);

		if (!staged)
			add('the held-open ubus route never caught a staging window on the traversal — this case '
				+ 'measured nothing');
		if (Math.abs(restored - parked) > BACK_TOLERANCE_PX)
			add(`parked at ${parked}px, Back restored ${restored}px — the reader was dropped `
				+ `${parked - restored}px from where they were`);
	}
}

const list = requireStands(stands(FLAGS.only, { all: ALL_STANDS }), 'spa-parity');
const browser = await chromium.launch();
const findings = [];
/* pages that froze while their shape was being read — their own kind of finding, reported by
 * reportFrozen() below (lib/page-shapes.mjs) */
const frozen = [];
let compared = 0;

const say = makeSay();

/* the routers run at the same time: every comparison here is content against content on one router,
 * so nothing another container does can reach it (see the same note in live-audit.mjs) */
await Promise.all(list.map(async (stand) => {
	let here = 0;
	const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
	await sealToRouter(ctx, stand.base);
	const page = await ctx.newPage();
	const errs = [];
	page.on('pageerror', (e) => errs.push(String(e).replace(/\s+/g, ' ').slice(0, 120)));
	await login(page, stand.base);
	say(`${stand.id}: logged in, staging + Back at 1440px`);

	await stagingWindowCheck(page, stand, findings);
	await backRestoreCheck(page, stand, findings);

	/* the narrow pass: its own context, since theme/90-responsive.css's rules never match at 1440px */
	say(`${stand.id}: staging + Back at ${NARROW_WIDTH}px`);
	const narrowCtx = await browser.newContext({ viewport: { width: NARROW_WIDTH, height: 900 } });
	await sealToRouter(narrowCtx, stand.base);
	const narrowPage = await narrowCtx.newPage();
	await login(narrowPage, stand.base);
	await stagingWindowCheck(narrowPage, stand, findings, NARROW_STAGING_CASES, NARROW_WIDTH);
	await backRestoreCheck(narrowPage, stand, findings, NARROW_WIDTH);
	await narrowCtx.close();

	/* a named page may be an untitled node (status/nftables) that the menu walk hides: take the raw tree then */
	let paths = (await menuPaths(page, { all: !!ONLY_PAGES })).filter((p) => !DESTRUCTIVE.test(p) && (ONLY_PAGES || p !== ORIGIN));
	if (ONLY_PAGES) paths = paths.filter((p) => p.startsWith(ONLY_PAGES));
	if (ONLY_PAGES && !paths.length)
		findings.push({ stand: stand.id, path: ONLY_PAGES, kind: 'selection', detail: '--pages matched no page on this router' });
	if (!ALL_PAGES && !ONLY_PAGES) {
		say(`${stand.id}: reading the shape of ${paths.length} page(s)`);
		const shapes = await classify(page, stand.base, paths, { frozen, id: stand.id });
		const { picked, dropped } = representatives(shapes, PINNED);
		reportReduction(stand.id, picked, dropped, shapes);
		paths = picked;
	}

	let n = 0;
	for (const path of paths) {
		say(`${stand.id} ${++n}/${paths.length} ${path}`);

		const from = path === ORIGIN ? ORIGIN_ALT : ORIGIN;
		try { await page.goto(stand.base + from, { waitUntil: 'domcontentloaded', timeout: 20000 }); }
		catch (e) { continue; }
		/* same as stagingAttempt: a click before the origin's first render is queued behind it */
		if (!await waitForPaint(page, 20000)) {
			findings.push({ stand: stand.id, path, kind: 'paint', detail: `${from} page not painted, run proves nothing` });
			continue;
		}
		await page.waitForTimeout(400);
		errs.length = 0;
		await clickTo(page, path);
		await page.waitForTimeout(2600);
		const spa = await measure(page);
		const timers = await timerProbe(page);
		const spaErrs = errs.slice();

		try { await page.goto(stand.base + path, { waitUntil: 'domcontentloaded', timeout: 20000 }); }
		catch (e) { continue; }
		errs.length = 0;
		await page.waitForTimeout(2600);
		const full = await measure(page);
		const fullErrs = errs.slice();
		if (!spa || !full) continue;
		/* a page that answers with nothing either way is not installed on this router */
		if (full.chars === 0 && full.nodes === 0) continue;
		here++;
		compared++;

		const add = (kind, detail) => findings.push({ stand: stand.id, path, kind, detail });
		if (spa.heading !== full.heading)
			add('heading', `page heading ${JSON.stringify(spa.heading)} on a click, ${JSON.stringify(full.heading)} on a load`);
		if (spa.docTitle !== full.docTitle)
			add('heading', `document.title ${JSON.stringify(spa.docTitle)} on a click, ${JSON.stringify(full.docTitle)} on a load`);
		if (full.chars > 40 && full.chars - spa.chars > Math.max(30, full.chars * 0.15))
			add('content', `${spa.chars} characters on a click, ${full.chars} on a load`);
		if (full.nodes - spa.nodes > Math.max(5, full.nodes * 0.15))
			add('content', `${spa.nodes} elements on a click, ${full.nodes} on a load`);
		const missing = full.uci.split(',').filter(Boolean).filter((p) => !spa.uci.split(',').includes(p));
		if (missing.length)
			add('uci', `a full load has ${missing.join(', ')} in uci's cache and the click does not`);
		if (full.wifi > spa.wifi)
			add('wifi', `network.getWifiDevices(): ${spa.wifi} on a click, ${full.wifi} on a load`);
		if (spa.views !== 1 || spa.stages !== 0)
			add('stage', `after the navigation settled: ${spa.views} #view element(s), ${spa.stages} staging wrapper(s)`);
		if (full.views !== 1)
			add('stage', `a full load left ${full.views} #view element(s)`);
		if (timers) {
			if (timers.armedHidden > 1)
				add('timers', `${timers.armedHidden} interval(s) still armed in a hidden tab — only `
					+ 'the hide handler stops LuCI\'s own 1 s tick first, so at most one is tolerated');
			if (timers.after !== timers.before)
				add('timers', `the registry held ${timers.before} interval(s) before a hide/show and `
					+ `${timers.after} after — a timer was lost, duplicated, or re-armed under an id `
					+ 'the view that owns it does not know');
		}
		for (const e of spaErrs.filter((e) => !fullErrs.includes(e)).slice(0, 2))
			add('console', e);
		/* the page's own line is already out (above, before it was opened); mark it only when this
		 * page is where a difference landed, so a long log still shows the interesting rows */
		if (findings.some((f) => f.path === path && f.stand === stand.id))
			say(`${stand.id}    ^ a click and a load DISAGREE here`);
	}
	await ctx.close();
	say(`${stand.id}: ${here} page(s) compared`);
}));
await browser.close();

/* Before the differences, because a page that stopped answering was not compared at all: reporting
 * "a click and a load agree on every one" over a walk that lost pages to a frozen thread is the
 * silence this gate is here to stop. */
if (reportFrozen(frozen)) {
	console.error('spa-parity: a page that will not answer cannot be compared. Fix the freeze first.\n');
	process.exit(1);
}

if (findings.length) {
	console.error(`\nspa-parity: ${findings.length} difference(s) between a click and a load:\n`);
	for (const f of findings) console.error(`  ${f.stand}  ${f.path}\n     ${f.kind}: ${f.detail}`);
	console.error('\nA page reached by a click has to be the page a full load gives. docs/spa-router.md');
	console.error('lists what a fresh document does for free and what fs-router has to do by hand.');
	process.exit(1);
}
if (!compared) {
	console.error(`\nspa-parity: 0 of ${list.length} router(s) compared a page — every router either failed to load or answered no page. `
		+ 'This is not a clean sweep; it is nothing measured.\n');
	process.exit(1);
}
console.log(`spa-parity: ${compared} page(s), a click and a load agree on every one.`);
