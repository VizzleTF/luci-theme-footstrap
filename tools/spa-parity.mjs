#!/usr/bin/env node
/* THE NAVIGATION GATE: a page opened by a click must be the same page a full load gives.
 *
 * The theme replaces LuCI's full-page navigation with a client router (docs/spa-router.md), and that
 * is one long list of things a fresh document does for free: an empty uci cache, an empty poll
 * queue, no stray intervals, no leftover notifications, a re-stamped body[data-page], a view
 * constructed rather than a cached singleton reused. Every one of those has been wrong at least once
 * — "four places where a client navigation stopped matching a full load", "close three races the
 * client router opens", and most recently the uci flush that left `network.js` answering out of an
 * empty cache, which emptied Status → Channel Analysis and Network → Switch for a reviewer three
 * days after it shipped.
 *
 * So this gate does not check the router's mechanics. It opens every page BOTH ways and compares
 * what the user ends up with:
 *
 *   content    how much the view painted, and how many elements it built. A view that renders half
 *              of itself is the shape every one of those regressions took.
 *   uci        which config packages are in uci's cache. This is the one that catches a state bug
 *              with no visible symptom on a stand: Channel Analysis renders the same 32 characters
 *              either way on a router with no real radios, while `uci.state.values` was `{}` after a
 *              click and held network, wireless and luci after a load.
 *   wifi       network.getWifiDevices().length, for the same reason one level up: the module answers
 *              out of that cache and never reloads it.
 *   console    an error thrown on the click path that a full load does not produce.
 *
 * There is no baseline: a difference between the two ways of opening the same page is always a bug,
 * and if a page is legitimately different it does not belong in the menu.
 *
 *   node tools/spa-parity.mjs [--only owrt2512,owrt2410] [--pages /admin/network]
 *
 * Needs a running owlab router (docs/development.md).
 */
import { chromium } from 'playwright';
import { stands, login, menuPaths, DESTRUCTIVE, requireStands } from './lib/stands.mjs';

const arg = (name, dflt) => {
	const i = process.argv.indexOf('--' + name);
	return i === -1 ? dflt : process.argv[i + 1];
};
const ONLY_PAGES = arg('pages', '');
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
				/* The staged render puts a second `#view` in the document on purpose — LuCI's own
				 * chain resolves `#view` at paint time and must find the stage — but it is
				 * transient BY CONSTRUCTION, and this is what keeps it so. A stage that outlives
				 * its navigation is two elements answering to one id for the rest of the document,
				 * which is where a duplicate id stops being a technicality: the next view would
				 * paint into the leftover. */
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

/* WHAT A TRIP THROUGH A BACKGROUND TAB LEAVES BEHIND.
 *
 * fs-router pauses a view's own `setInterval` while the tab is hidden and re-arms it on the way
 * back, which is the one piece of the router's state that a navigation does NOT reset — and it was
 * wrong in both directions at once: the re-armed timer came back under a fresh id (so the view
 * could no longer stop its own poller), and while paused it sat outside the registry a navigation
 * sweeps (so a tab hidden across a click brought the previous page's timers back with it).
 *
 * Both are invisible on a page that is merely LOOKED at, and both are cheap to ask here, where a
 * navigation has just happened: hide, look at what is still armed, show, count the registry again.
 * `document.hidden` is read-only and is overridden the way the browser's own tooling does — the
 * page is thrown away by the full load that follows, so the override never outlives this probe. */
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

const list = requireStands(stands(arg('only', '')), 'spa-parity');
const browser = await chromium.launch();
const findings = [];
let compared = 0;

for (const stand of list) {
	const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
	const page = await ctx.newPage();
	const errs = [];
	page.on('pageerror', (e) => errs.push(String(e).replace(/\s+/g, ' ').slice(0, 120)));
	await login(page, stand.base);

	for (const path of await menuPaths(page)) {
		if (DESTRUCTIVE.test(path) || path === ORIGIN) continue;
		if (ONLY_PAGES && !path.startsWith(ONLY_PAGES)) continue;

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
		process.stdout.write(findings.some((f) => f.path === path && f.stand === stand.id) ? 'X' : '.');
	}
	await ctx.close();
	process.stdout.write(`\n${stand.id}: ${compared} page(s) compared\n`);
}
await browser.close();

if (findings.length) {
	console.error(`\nspa-parity: ${findings.length} difference(s) between a click and a load:\n`);
	for (const f of findings) console.error(`  ${f.stand}  ${f.path}\n     ${f.kind}: ${f.detail}`);
	console.error('\nA page reached by a click has to be the page a full load gives. docs/spa-router.md');
	console.error('lists what a fresh document does for free and what fs-router has to do by hand.');
	process.exit(1);
}
console.log(`spa-parity: ${compared} page(s), a click and a load agree on every one.`);
