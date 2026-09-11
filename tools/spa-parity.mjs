#!/usr/bin/env node
/* The navigation gate: a page opened by a click must be the same page a full load gives.
 *
 * The theme replaces LuCI's full-page navigation with a client router (docs/spa-router.md), and that
 * is one long list of things a fresh document does for free: an empty uci cache, an empty poll
 * queue, no stray intervals, no leftover notifications, a re-stamped body[data-page], a view
 * constructed rather than a cached singleton reused. Every one of those has been wrong at least
 * once.
 *
 * So this gate does not check the router's mechanics: it opens every page BOTH ways and compares
 * what the user ends up with — how much the view painted, which config packages are in uci's cache
 * (the axis that catches a state bug with no visible symptom: a page can render the same characters
 * either way while `uci.state.values` is `{}` after a click), how many wifi devices network.js
 * answers with, and whether the click path threw where a full load did not.
 *
 * There is no baseline: a difference between the two ways of opening the same page is always a bug,
 * and if a page is legitimately different it does not belong in the menu.
 *
 *   node tools/spa-parity.mjs [--only owrt2512,owrt2410] [--pages /admin/network] [--pages-all]
 *
 * Needs a running owlab router (docs/development.md). */
import { chromium } from 'playwright';
import { stands, login, menuPaths, DESTRUCTIVE, requireStands, sealToRouter } from './lib/stands.mjs';
import { classify, representatives, reportReduction, reportFrozen, PINNED } from './lib/page-shapes.mjs';
import { read } from './lib/root.mjs';

const arg = (name, dflt) => {
	const i = process.argv.indexOf('--' + name);
	return i === -1 ? dflt : process.argv[i + 1];
};
const ONLY_PAGES = arg('pages', '');
/* one page per SHAPE rather than every leaf — lib/page-shapes.mjs; `--pages-all` takes them all */
const ALL_PAGES = process.argv.includes('--pages-all');
const ALL_STANDS = process.argv.includes('--all');
/* Every navigation starts here, so each page is reached as a real click from another page rather
 * than from whatever the previous iteration left behind. */
const ORIGIN = '/admin/status/overview';

const measure = async (page) => {
	try {
		return await page.evaluate(() => {
			const v = document.getElementById('view');
			const text = (v ? v.textContent : '').replace(/\s+/g, ' ').trim();
			const out = {
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

/* What a trip through a background tab leaves behind.
 *
 * fs-router pauses a view's own `setInterval` while the tab is hidden and re-arms it on the way
 * back, the one piece of the router's state a navigation does not reset — and it was wrong in both
 * directions at once: the re-armed timer came back under a fresh id, so the view could no longer
 * stop its own poller, and while paused it sat outside the registry a navigation sweeps, so a tab
 * hidden across a click brought the previous page's timers back.
 *
 * Both are invisible on a page that is merely looked at, and both are cheap to ask here, where a
 * navigation has just happened. `document.hidden` is read-only and is overridden the way the
 * browser's own tooling does — the page is thrown away by the full load that follows, so the
 * override never outlives this probe. */
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
			/* L.Poll's own tick is deliberately left running — wireVisibility() owns that one */
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
 * Every check below samples AFTER commitStage, which is exactly how 1407 ms of the OUTGOING page
 * standing unstyled went unmeasured (task navstamp): `body[data-page]` used to flip to the
 * incoming name at the click, and every page-scoped rule for the page still on screen stopped
 * matching for the whole require — 33 rules in styles/pages/20-overview.css, +211px of document,
 * the reader moved 140px. fs-router.js now keys that CSS off `#view[data-page]`/
 * `.fs-content[data-page]` instead, spared until commitStage the same way fs-sheets spares a
 * page's stylesheets (fs-router.js, docs/spa-router.md "The staging window").
 *
 * Sampled here mid-flight, with the incoming view's own module fetch held open long enough to
 * have a window to sample in: a stand's own staging window is ~210 ms against 1.2 s on real
 * hardware (../tmp/task-navflash/navflash.mjs), too short to catch this without the same fake
 * slow route that probe uses. */
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
 * theme/90-responsive.css still scopes ~11 package-manager rules through
 * `body[data-page="admin-system-package-manager"]`, inside `@media (max-width: …px)` — the same
 * scope bug STAGING_CASES above was written for, one layer over, and invisible to every case
 * above because they all run at the 1440px context (see below): that query never matches there.
 * The width is read out of the file, not hard-coded, so an edit to the breakpoint cannot make
 * this pass silently stop testing anything. */
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

async function stagingWindowCheck(page, stand, findings, cases = STAGING_CASES, widthLabel) {
	for (const c of cases) {
		let before, mid;
		try {
			await page.goto(stand.base + c.from, { waitUntil: 'domcontentloaded', timeout: 20000 });
		}
		catch (e) { continue; }
		await page.waitForTimeout(1400);
		before = await page.evaluate((c) => {
			const el = c.owned ? document.querySelector(c.owned) : null;
			return { docH: document.documentElement.scrollHeight,
			         prop: el ? getComputedStyle(el)[c.prop] : null };
		}, c);

		/* held open only for the click below, not for the goto()/settle above: slowing the
		 * outgoing page's own load would tell us nothing about the staging window */
		await page.route(STAGING_ROUTE, async (route) => {
			await new Promise((r) => setTimeout(r, STAGING_DELAY_MS));
			/* the prefetch fetch() and require()'s own XHR can both name the same URL, and a route
			 * already settled by the other rejects a second continue() — nothing this probe reads
			 * depends on which of the two wins */
			try { await route.continue(); } catch (e) {}
		});
		await page.evaluate((to) => {
			const href = '/cgi-bin/luci' + to;
			let a = [ ...document.querySelectorAll('a[href]') ].find((x) => x.getAttribute('href') === href);
			if (!a) { a = document.createElement('a'); a.href = href; a.textContent = 'probe'; document.getElementById('view').append(a); }
			a.click();
		}, c.to);
		/* mid-flight: well inside the held-open fetch, well before commitStage can run */
		await page.waitForTimeout(500);
		mid = await page.evaluate((c) => {
			const el = c.owned ? document.querySelector(c.owned) : null;
			return { docH: document.documentElement.scrollHeight,
			         prop: el ? getComputedStyle(el)[c.prop] : null,
			         staged: document.querySelectorAll('.fs-staging').length };
		}, c);
		await page.unroute(STAGING_ROUTE);
		/* let the held-open navigation actually finish before the next case reuses this page */
		await page.waitForTimeout(STAGING_DELAY_MS + 1000);

		const add = (detail) => findings.push({ stand: stand.id,
			path: c.from + ' -> ' + c.to + (widthLabel ? ` @${widthLabel}px` : ''), kind: 'staging', detail });
		if (mid.staged === 0) {
			add('the fake-slow route never caught a staging window — this case measured nothing');
			continue;
		}
		if (mid.docH !== before.docH)
			add(`the outgoing page's document height moved during the staging window: ${before.docH} -> ${mid.docH}px`);
		if (c.owned && mid.prop !== c.want)
			add(`${c.owned} read ${JSON.stringify(mid.prop)} mid-flight, wanted ${JSON.stringify(c.want)} — `
				+ 'the outgoing page\'s own rule stopped matching');
	}
}

/* ---- browser Back must restore the reader's own scroll offset ----
 *
 * Nothing above drives HISTORY at all: stagingWindowCheck proves the swap itself, but a reader who
 * scrolls down, opens another page and presses Back is a full round trip through fs-router.js's
 * `_scrollMem`/`restoreScroll()` that no case here exercised — task-back's card was opened against
 * exactly this gap. Scroll down on `from`, click into `to`, go Back, and read whichever element
 * `saveScroll()`/`restoreScroll()` would have used AT THIS WIDTH: `#maincontent` where its own
 * `overflow-y` computes to `auto`/`scroll` (the sidebar layout), the document otherwise (the top
 * layout) — docs/spa-router.md, "Scroll". Run at both the 1440px context every case above uses and
 * the narrow one, since the two layouts genuinely scroll different elements. */
const BACK_CASES = [
	{ from: ORIGIN, to: '/admin/system/package-manager' },
];
const BACK_SETTLE_MS = 3000;
/* rounding plus the odd late layout pass, not a tolerance for the bug itself: task-back's own
 * measurement was a reader dropped to 0 from ~3274px, orders of magnitude past this */
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
		await page.waitForTimeout(1400);

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

		await page.evaluate((to) => {
			const href = '/cgi-bin/luci' + to;
			let a = [ ...document.querySelectorAll('a[href]') ].find((x) => x.getAttribute('href') === href);
			if (!a) { a = document.createElement('a'); a.href = href; a.textContent = 'probe'; document.getElementById('view').append(a); }
			a.click();
		}, c.to);
		await page.waitForTimeout(1400);

		await page.goBack();
		await page.waitForTimeout(BACK_SETTLE_MS);
		const restored = await readScrollOffset(page, useDoc);

		if (Math.abs(restored - parked) > BACK_TOLERANCE_PX)
			add(`parked at ${parked}px, Back restored ${restored}px — the reader was dropped `
				+ `${parked - restored}px from where they were`);
	}
}

const list = requireStands(stands(arg('only', ''), { all: ALL_STANDS }), 'spa-parity');
const browser = await chromium.launch();
const findings = [];
/* pages that froze while their shape was being read — their own kind of finding, reported by
 * reportFrozen() below (lib/page-shapes.mjs) */
const frozen = [];
let compared = 0;

/* SAY WHERE THE SWEEP IS, ON EVERY PAGE AND WITH THE CLOCK.
 *
 * This gate used to print one `.` per page — no newline, so a CI runner buffers the whole run into a
 * single line that is only flushed at the end — and nothing at all until the first router had
 * finished classifying. A slice cancelled before that (task liveslice: `/admin/system/filemanager`
 * pinned the browser's main thread under `13e9864`, and `page.evaluate()` has no deadline of its
 * own, so both measuring slices sat at the 45-minute cap) left a log with not one word in it about
 * which page it was on, for a whole day of runs.
 *
 * A line per page, newline-terminated, with seconds since the gate started: the wall clock is then
 * readable straight off the log, and a run that dies names the page it died on. */
const T0 = Date.now();
const at = () => `${String(Math.round((Date.now() - T0) / 1000)).padStart(4)}s`;
const say = (line) => process.stdout.write(`${at()}  ${line}\n`);

/* the routers run at the same time: every comparison here is content against content on one router,
 * so nothing another container does can reach it (see the same note in live-audit.mjs) */
await Promise.all(list.map(async (stand) => {
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

	let paths = (await menuPaths(page)).filter((p) => !DESTRUCTIVE.test(p) && p !== ORIGIN);
	if (ONLY_PAGES) paths = paths.filter((p) => p.startsWith(ONLY_PAGES));
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

		try { await page.goto(stand.base + ORIGIN, { waitUntil: 'domcontentloaded', timeout: 20000 }); }
		catch (e) { continue; }
		await page.waitForTimeout(1400);
		errs.length = 0;
		/* CLICK a link, because that is the only thing the router hooks — driving navigate()
		 * directly would test a function nobody calls that way. */
		await page.evaluate((t) => {
			const href = '/cgi-bin/luci' + t;
			let a = [ ...document.querySelectorAll('a[href]') ].find((x) => x.getAttribute('href') === href);
			if (!a) { a = document.createElement('a'); a.href = href; a.textContent = 'probe'; document.getElementById('view').append(a); }
			a.click();
		}, path);
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
		compared++;

		const add = (kind, detail) => findings.push({ stand: stand.id, path, kind, detail });
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
					+ 'LuCI\'s own 1 s tick may be, and wireVisibility() stops that one');
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
	say(`${stand.id}: ${compared} page(s) compared`);
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
console.log(`spa-parity: ${compared} page(s), a click and a load agree on every one.`);
