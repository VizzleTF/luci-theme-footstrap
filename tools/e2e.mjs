#!/usr/bin/env node
/* The package's whole life on a real router, the way an admin lives it, against one running owlab
 * router that has LuCI and its apps but not this theme:
 *
 *   1. install the last published release        -> it is offered in Language and Style, and the
 *                                                     active theme is left alone (README: the admin
 *                                                     picks Footstrap there)
 *   2. the admin picks footstrap, and a marker section is written to /etc/config/footstrap, the
 *      conffile Appearance saves to
 *   3. upgrade to this build                       -> the admin's theme and the marker survive
 *   4. every page of the menu is opened under bootstrap, the reference, then under footstrap by a
 *      full load at desktop and phone width, and every entry of footstrap's menu by a click on it
 *      (crawl() below says what fails a page); then tools/anchor-check.mjs: a poll tick that grows
 *      the page above a parked reader leaves them where they were, in Chromium, Firefox and WebKit
 *      (--no-anchor leaves it out: CI runs it as a job of its own, on a router of its own)
 *   5. remove the package                          -> LuCI falls back to bootstrap and still serves
 *   6. install this build again                    -> offered, active theme left alone
 *
 * No list of expected problems: the stock theme on the same router is the reference.
 *
 *   node tools/e2e.mjs --router owrt2512 --old <last release pkg> --new <this build pkg> [--out dir] [--no-anchor]
 *
 * Exit 0 when every step passed, 1 otherwise; the report, anchor-check's log and one screenshot per
 * page and width land in --out (default ../tmp/e2e-<router>). */
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { ROOT } from './lib/root.mjs';
import { StandDown, login, menuPaths, standStopped, stoodDown, unreached } from './lib/stands.mjs';
import { ghData, ghProp } from './lib/util.mjs';

const { values: opt } = parseArgs({ options: {
	router: { type: 'string' },
	old: { type: 'string' },
	new: { type: 'string' },
	out: { type: 'string' },
	'no-anchor': { type: 'boolean' },
} });
if (!opt.router || !opt.old || !opt.new) {
	console.error('usage: node tools/e2e.mjs --router <id> --old <pkg> --new <pkg> [--out dir] [--no-anchor]');
	process.exit(2);
}
const OUT = opt.out || join(ROOT, '..', 'tmp', `e2e-${opt.router}`);
mkdirSync(OUT, { recursive: true });

const status = JSON.parse(execFileSync('owlab', [ 'status', '-json' ], { encoding: 'utf8', timeout: 60000, killSignal: 'SIGKILL' }));
const router = (status.routers || []).find((r) => r.id === opt.router && r.state === 'running');
if (!router) { console.error(`${opt.router}: not running (owlab up ${opt.router})`); process.exit(2); }
const CONTAINER = `owlab-${status.project}-${router.id}`;
const BASE = `http://localhost:${router.http_port}/cgi-bin/luci`;
const SCRIPT = new URL(BASE).pathname;
const APK = router.package_manager === 'apk';

/* ---- the router side ---- */

/* Every docker call is on a clock: a stand that stops answering ends the run red, not in the step's
 * timeout. One that never returns, that the daemon refuses (the container paused, stopped or
 * gone), or that its container's stop cut short is the stand's, as in anchor-check.mjs: a StandDown. */
const refused = (stderr) => (String(stderr || '').match(/^Error response from daemon.*$/m) || [ '' ])[0];
function docker(...args) {
	try {
		return execFileSync('docker', args, { encoding: 'utf8', stdio: [ 'ignore', 'pipe', 'pipe' ], timeout: 60000 });
	} catch (e) {
		if (e.code === 'ETIMEDOUT') throw new StandDown(`${opt.router}: docker ${args[0]} did not return in 60 s`);
		if (refused(e.stderr)) throw new StandDown(`${opt.router}: ${refused(e.stderr)}`);
		if (standStopped(opt.router)) throw new StandDown(`${opt.router}: the router stopped during docker ${args[0]}`);
		throw e;
	}
}
const sh = (script) => docker('exec', CONTAINER, 'sh', '-c', script).trim();
const uci = (key) => sh(`uci -q get ${key} || true`);
const theme = () => uci('luci.main.mediaurlbase');

/* The package manager runs from an argument vector, never a shell line: the package path comes from
 * the command line. Output is stdout and stderr together, the way an admin reads it. Its clock is no
 * StandDown: a package script of the theme's may be what hangs. */
function pm(...args) {
	const r = spawnSync('docker', [ 'exec', CONTAINER, ...args ], { encoding: 'utf8', timeout: 120000 });
	const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
	if (r.error) {
		const why = `${args.join(' ')} ${r.error.code === 'ETIMEDOUT' ? 'did not return in 120 s' : r.error.message}`;
		/* last in the output, where the run's detail reads it */
		throw Object.assign(new Error(why), { stderr: `${out}\n${why}` });
	}
	if (r.status !== 0 && refused(r.stderr)) throw new StandDown(`${opt.router}: ${refused(r.stderr)}`);
	if (r.status !== 0) throw Object.assign(new Error(`${args.join(' ')} exited ${r.status}`), { stderr: out });
	return out;
}
/* --no-network: the file and luci-base are all it needs; a stale index must not send apk to every feed */
function install(file) {
	const dst = `/tmp/${basename(file)}`;
	docker('cp', file, `${CONTAINER}:${dst}`);
	return APK ? pm('apk', 'add', '--no-network', '--allow-untrusted', dst) : pm('opkg', 'install', dst);
}
const remove = () => APK ? pm('apk', 'del', 'luci-theme-footstrap') : pm('opkg', 'remove', 'luci-theme-footstrap');
const installedVersion = () => sh(APK
	? "apk list --installed luci-theme-footstrap 2>/dev/null | sed -n 's/^luci-theme-footstrap-\\([^ ]*\\) .*/\\1/p'"
	: "opkg status luci-theme-footstrap | sed -n 's/^Version: //p'");
const setTheme = (url) => sh(`uci set luci.main.mediaurlbase=${url} && uci commit luci && rm -f /tmp/luci-indexcache* /tmp/luci-modulecache/*`);

/* ---- the report ---- */

/* `standDown`: the step failed because the stand did not answer, so it judged nothing. */
const results = [];
function check(step, ok, detail = '', standDown = false) {
	results.push(ok ? { step, ok, detail } : { step, ok, detail, standDown });
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? ` — ${detail}` : ''}`);
	/* a red step shows on the pull request, not only in the log; one the stand failed is annotated
	 * at the run's end, once it is known whether anything else failed */
	if (!ok && !standDown && process.env.GITHUB_ACTIONS) console.log(`::error title=${ghProp(step)}::${ghData(detail || step)}`);
	return ok;
}

/* ---- the browser side ---- */

/* What the theme serves: a request to one of these that fails is footstrap's whatever bootstrap did. */
const THEME_FILE = /^\/luci-static\/footstrap\/|^\/luci-static\/resources\/(fs-[\w-]+|menu-footstrap[\w-]*)\.js$|^\/luci-static\/resources\/view\/footstrap\/|^\/cgi-bin\/luci-theme-footstrap-pattern$/;

/* How long a page is watched after its view rendered. The full load at desktop width is watched for
 * one LuCI poll interval (5 s, header.ut's `pollinterval` default) plus 1 s for the tick's handlers:
 * theme code that runs late runs on a poll tick or on a timer of its own, the longest of which is
 * fs-router's 5 s warm wait. The phone and click passes look for what differs by width or by
 * client navigation, which shows at render, and get 1 s. The reference gets LONG + 1 s, so it
 * vouches for all of footstrap's desktop span, then waits for the network to go quiet (settle()). */
const LONG = 6000, SHORT = 1000;

/* The view has rendered: a client-side view has replaced its "Loading view…" spinner, a legacy CBI
 * or template page has put something into #maincontent. Runs inside the page. */
const RENDERED = () => {
	const v = document.getElementById('view');
	if (v) return v.children.length > 0 && !v.querySelector(':scope > .spinning');
	const m = document.getElementById('maincontent');
	return !!(m && m.textContent.trim());
};

/* What the reader gets, measured inside the page under either theme:
 * - text: characters of visible text in the view (#view, else #maincontent): every text node whose
 *   element is rendered, outside a <select> (a native one under bootstrap lists every option in
 *   innerText, footstrap's styled one shows the chosen one: 8289 against 494 characters on System
 *   for the same 454 visible ones) and outside script and style;
 * - rules: style rules in footstrap's stylesheet, nested ones included (the sheet is a handful of
 *   @layer blocks at the top level);
 * - token: an export-tier token footstrap's sheet defines on :root (the private --fs-* names are
 *   mangled in a release build, so one of those cannot be named here);
 * - nav: footstrap's menu column is rendered with a box of its own. */
const MEASURE = () => {
	const host = document.getElementById('view') || document.getElementById('maincontent');
	let text = 0;
	const walk = host && document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
	for (let t; walk && (t = walk.nextNode());) {
		const el = t.parentElement;
		if (!el.closest('select, datalist, script, style, template, noscript') &&
		    el.checkVisibility({ opacityProperty: true, visibilityProperty: true }))
			text += t.data.trim().length;
	}
	const count = (list) => { let n = 0; for (const r of list) n += 1 + (r.cssRules ? count(r.cssRules) : 0); return n; };
	const sheet = document.querySelector('link[data-fs-shell]')?.sheet;
	const nav = document.querySelector('nav[data-fs-chrome]');
	const box = nav && nav.getBoundingClientRect();
	return {
		text,
		rules: sheet ? count(sheet.cssRules) : 0,
		token: getComputedStyle(document.documentElement).getPropertyValue('--primary-color-high').trim(),
		nav: !!(nav && nav.checkVisibility() && box.width > 0 && box.height > 0),
	};
};
/* The shipped sheet carries about 1000 rules. An empty, truncated or wrong file carries far fewer
 * than half of that; a refactor does not move it by half. */
const RULES_FLOOR = 500;

/* Errors and requests are compared as text with the volatile parts (session ids, UUIDs such as a
 * blob: URL's, query strings, numbers) removed, so the same thing under both themes is one signature. */
const signature = (s) => String(s).split('\n')[0]
	.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, 'U').replace(/[0-9a-f]{32}/g, 'S').replace(/\?[^\s'")]*/g, '').replace(/\d+/g, 'N').slice(0, 300);
const pathOf = (url) => { try { return new URL(url).pathname; } catch (e) { return String(url); } };
/* the scripts on an error's stack, as paths; the first is where it was thrown */
const scriptsOf = (stack) => (String(stack).match(/https?:\/\/[^\s)]+/g) || []).map((u) => pathOf(u.replace(/(:\d+)+$/, '')));
const requestKey = (req) => signature(`${req.method()} ${pathOf(req.url())} ${req.postData() || ''}`);

/* Everything one page shows, each with the time it showed up: JS errors with the file they came
 * from (`theme` when a theme file is on the stack, or logged the line), failed requests, and every
 * request made (the reference's are what an app asks for on its own). Chromium's console line
 * "Failed to load resource" is left out: it names no path, and the request itself is recorded
 * below with its path. A request the page cancelled itself (a navigation away) is no failure. */
function watch(page) {
	const seen = { errors: new Map(), failed: new Map(), requested: new Set(), rendered: 0 };
	const net = page.__net = { pending: new Set(), last: Date.now() };
	const error = (sig, scripts) => seen.errors.has(sig) ||
		seen.errors.set(sig, { at: Date.now(), theme: scripts.some((p) => THEME_FILE.test(p)) });
	const failed = (req, what) => seen.failed.has(requestKey(req)) ||
		seen.failed.set(requestKey(req), { path: pathOf(req.url()), what, at: Date.now() });
	page.on('request', (r) => { net.pending.add(r); net.last = Date.now(); seen.requested.add(requestKey(r)); });
	const done = (r) => { if (net.pending.delete(r)) net.last = Date.now(); };
	page.on('requestfinished', done);
	page.on('requestfailed', done);
	page.on('pageerror', (e) => {
		const scripts = scriptsOf(e.stack);
		error(`pageerror: ${signature(e.message)} (${scripts[0] || ''})`, scripts);
	});
	page.on('console', (m) => {
		if (m.type() !== 'error' || /^Failed to load resource/.test(m.text())) return;
		const where = pathOf(m.location().url);
		error(`console: ${signature(m.text())} (${where})`, [ where ]);
	});
	page.on('response', (r) => { if (r.status() >= 400) failed(r.request(), `http ${r.status()}`); });
	page.on('requestfailed', (r) => {
		const why = (r.failure() || {}).errorText || '';
		if (!/ERR_ABORTED/.test(why)) failed(r, why);
	});
	seen.clear = () => { seen.errors.clear(); seen.failed.clear(); seen.requested.clear(); seen.rendered = 0; };
	return seen;
}

/* Wait for the view, then watch the page `span` ms; the reference then also waits until nothing this
 * page asked for has been in flight for a second, 10 s in all at most: an app's own requests keep
 * arriving after its view rendered (adblock and banip fetch their reports late) and must land in
 * the reference. */
async function settle(page, seen, span, reference) {
	const rendered = await page.waitForFunction(RENDERED, null, { timeout: 20000 }).then(() => true, () => false);
	seen.rendered = Date.now();
	await page.waitForTimeout(span);
	if (reference)
		for (let waited = span; waited < 10000; waited += 250) {
			if (page.__net.pending.size === 0 && Date.now() - page.__net.last >= 1000) break;
			await page.waitForTimeout(250);
		}
	return rendered;
}

/* What LuCI's root answers: `fault` is '' for its login form, else what came instead (the status
 * and the start of the text, or the error), so a red step says whether the stand or the removal
 * broke it; `down`: no whole answer came (refused, cut off, or none in 15 s). LuCI answers the form
 * with a 403, so the body is the evidence, not the status. */
const loginForm = () => fetch(BASE + '/', { signal: AbortSignal.timeout(15000) })
	.then(async (r) => { const t = await r.text(); return { down: false, fault: /luci_password/.test(t) ? '' : `${r.status} ${t.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)}` }; })
	.catch((e) => ({ down: true, fault: `${e.name}: ${e.message}${e.cause ? ` (${e.cause.code || e.cause.message})` : ''}` }));

/* A page that got no answer (none, or none in time), by a full load or a click, while LuCI's root
 * gets none either for a minute: the stand stopped answering. The crawl ends there in a StandDown;
 * reading every page left would run into the step's timeout and lose the report. A root that
 * answers, at once or within the minute, leaves the failure the page's own, and a view a blip
 * emptied is read once more after its pass. */
async function standGone(e, path) {
	const down = unreached(e, opt.router, BASE + path);
	if (!(down instanceof StandDown)) return;
	for (const end = Date.now() + 60e3; Date.now() < end; await new Promise((r) => setTimeout(r, 5000)))
		if (!(await loginForm()).down) return;
	throw down;
}

/* Footstrap's menu takes a click at this width: Playwright's actionability check (visible, stable,
 * not covered) on its first entry, without clicking. Null when it does, else why not. */
const unreachable = (page) => page.locator('#topmenu > li > a').first().click({ trial: true, timeout: 3000 })
	.then(() => null, (e) => signature(e.message));

/* A load the router never answered stays pending, and page.evaluate and locator.count(), which have
 * no clock, wait for it to commit: one such page held its pass until the step's timeout. A reading
 * is bounded (a TimeoutError, so unreached() reads it as one); a page that goes on clicking is told
 * to stop the load, and keeps the document it has. */
const inTime = (p, ms) => Promise.race([ p, new Promise((_, no) => setTimeout(() =>
	no(Object.assign(new Error(`the page did not answer in ${ms / 1000} s`), { name: 'TimeoutError' })), ms)) ]);
async function stopLoading(page) {
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('Page.stopLoading');
	await cdp.detach();
}

/* What a page showed, as `open` and `click` return it; `after` is ms after the view rendered. */
async function reading(page, seen, rendered, extra = {}) {
	const m = await inTime(page.evaluate(MEASURE), 10000).catch((e) => ({ text: 0, rules: 0, token: '', nav: false, unmeasured: signature(e.message) }));
	const t0 = seen.rendered || Date.now();
	return {
		errors: [ ...seen.errors ].map(([ sig, e ]) => ({ sig, theme: e.theme, after: e.at - t0 })),
		failed: [ ...seen.failed ].map(([ key, f ]) => ({ key, path: f.path, what: f.what, after: f.at - t0 })),
		watched: Date.now() - t0, rendered, ...m, ...extra,
	};
}

const shotName = (path) => path.replace(/^\//, '').replace(/\//g, '_') || 'root';

/* One full load of `path`. */
async function open(page, seen, path, { shotDir, span, reference = false, menu = false }) {
	seen.clear();
	let rendered = false;
	page.__net.pending.clear();	/* Playwright never finishes a request the last document left in flight */
	try {
		await page.goto(BASE + path, { waitUntil: 'load', timeout: 30000 });
		rendered = await settle(page, seen, span, reference);
	} catch (e) {
		seen.errors.set(`navigation: ${signature(e.message)}`, { at: Date.now(), theme: false });
		await standGone(e, path);
	}
	const r = await reading(page, seen, rendered, reference ? { requested: [ ...seen.requested ] }
		: menu ? { unreachable: await unreachable(page) } : {});
	await page.screenshot({ path: join(shotDir, `${shotName(path)}.jpg`), type: 'jpeg', quality: 60, timeout: 10000 }).catch(() => {});
	return r;
}

/* The entries footstrap's menu offers, from the router's own menu tree the way fs-chrome.js renders
 * it: every top-level entry of the admin mode, and every entry under one. `leaf` is the page an
 * entry lands on, which the reference was read on: an alias's target, else the first child, all
 * the way down. */
const menuEntries = (page) => page.evaluate(async () => {
	const ui = await window.L.require('ui');
	const tree = await ui.menu.load();
	const admin = tree.children && tree.children.admin;
	const at = (path) => path.split('/').filter(Boolean).reduce((n, k) => n && n.children && n.children[k], tree);
	const leaf = (path) => {
		for (let node = at(path), hops = 0; node && hops < 10; node = at(path), hops++) {
			const a = node.action || {};
			if ((a.type === 'alias' || a.type === 'rewrite') && a.path) { path = '/' + a.path; continue; }
			const kids = ui.menu.getChildren(node);
			if (!kids.length) break;
			path += '/' + kids[0].name;
		}
		return path;
	};
	const out = [];
	for (const top of admin ? ui.menu.getChildren(admin) : []) {
		if (top.name === 'logout') continue;
		const subs = ui.menu.getChildren(top);
		if (!subs.length) out.push({ path: `/admin/${top.name}`, leaf: leaf(`/admin/${top.name}`) });
		for (const sub of subs) {
			const path = `/admin/${top.name}/${sub.name}`;
			out.push({ path, top: top.name, leaf: leaf(path) });
		}
	}
	return out;
});

/* An entry reached the way a reader reaches it: its section opened if its link is not showing, then
 * a click on the link through Playwright's actionability path, so a link that is hidden, covered or
 * zero-sized cannot be clicked. The view that was on screen must be replaced by a rendered one. */
async function click(page, seen, entry) {
	seen.clear();
	const href = `[href$="${SCRIPT}${entry.path}"]`;
	const link = page.locator(entry.top ? `#topmenu > li > ul a${href}` : `#topmenu > li > a${href}`).first();
	/* fs-chrome.js builds the menu after the page loaded */
	await page.locator('#topmenu > li > a').first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
	if (!(await link.count())) return { missing: true };
	try {
		const header = page.locator(`#topmenu > li:has(> ul a${href}) > a`).first();
		for (let i = 0; entry.top && i < 2 && !(await link.isVisible()); i++) await header.click({ timeout: 5000 });
		await inTime(page.evaluate(() => { window.__e2eStale = (document.getElementById('view') || document.getElementById('maincontent'))?.firstElementChild; }), 5000);
		/* a click that starts a full load waits for it to commit */
		await link.click({ timeout: 5000 });
	} catch (e) {
		await standGone(e, entry.path);
		return { unclickable: signature(e.message) };
	}
	let rendered = false;
	try {
		await page.waitForFunction((p) => location.pathname.replace(/\/$/, '').endsWith(p) &&
			(document.getElementById('view') || document.getElementById('maincontent'))?.firstElementChild !== window.__e2eStale,
		entry.path, { timeout: 20000 });
		rendered = await settle(page, seen, SHORT, false);
	} catch (e) {
		seen.errors.set(`navigation: ${signature(e.message)}`, { at: Date.now(), theme: false });
		await standGone(e, entry.path);
	}
	return reading(page, seen, rendered);
}

/* What footstrap adds on a page over the bootstrap reference `ref` read on the same page:
 * - a JS error with a theme file on its stack, or that footstrap's code logged: footstrap's,
 *   always. Any other JS error that bootstrap did not show, while bootstrap was still watched; the
 *   reference vouches for nothing past the span it was watched, so a later error counts only when
 *   it is the theme's;
 * - a failed request to a theme file: footstrap's, always. A failed request to anything else that
 *   bootstrap never made, within the same span. An app's request that bootstrap also made is the
 *   app's, whatever its answer: the answer depends on the router's state at that moment
 *   (adblock's runtime file does not exist until its first run ends, and cgi-download answers 404
 *   until then), and footstrap cannot change it — it never writes the session or its cookie, and a
 *   lost session turns the next page into the login form, which the view, text and menu checks
 *   fail. A request footstrap makes in an app's name (the router's view prefetch, a client
 *   navigation) is one bootstrap never made, so it counts. One that failed the same way under
 *   bootstrap on any page (`known`) is the app's too: a page left by a load or a click finishes its
 *   late requests into the next page's reading (banIP's runtime file, 404; OpenClash's GitHub
 *   avatar, which the browser's seal refuses);
 * - a view that never renders where bootstrap's did, or shows less than half of bootstrap's text
 *   (hidden by CSS, or not drawn), or that could not be read at all;
 * - footstrap's stylesheet missing or near empty, its token unresolved, its menu not visible or not
 *   clickable. LuCI falls back to another theme silently on a broken template, which shows here. */
function judge(r, ref, known) {
	const problems = new Set();
	const errors = new Set(ref ? ref.errors.map((e) => e.sig) : []);
	const asked = new Set(ref ? ref.requested : []);
	const vouched = (x) => !!ref && x.after <= ref.watched;
	for (const e of r.errors)
		if (e.theme || (!errors.has(e.sig) && (vouched(e) || !ref))) problems.add(e.sig);
	for (const f of r.failed)
		if (THEME_FILE.test(f.path) || (!asked.has(f.key) && !known.has(`${f.key} ${f.what}`) && (vouched(f) || !ref)))
			problems.add(`${f.what}: ${f.path}`);
	if (!r.rendered && (!ref || ref.rendered)) problems.add('the view never rendered');
	/* a page the evaluate could not read (its context gone) showed nothing, which is no broken shell */
	if (r.unmeasured) problems.add(`could not measure the page: ${r.unmeasured}`);
	else {
		if (ref && r.text < ref.text / 2) problems.add(`the view shows ${r.text} characters of text, bootstrap ${ref.text}`);
		if (r.rules < RULES_FLOOR) problems.add(`footstrap's stylesheet holds ${r.rules} rules (floor ${RULES_FLOOR})`);
		if (!r.token) problems.add('--primary-color-high does not resolve');
		if (!r.nav) problems.add('the menu is not visible');
	}
	if (r.unreachable) problems.add(`the menu takes no click: ${r.unreachable}`);
	return [ ...problems ];
}

async function session(browser, viewport) {
	const ctx = await browser.newContext({ viewport, ignoreHTTPSErrors: true });
	const page = await ctx.newPage();
	const seen = watch(page);
	await login(page, BASE, opt.router);
	return { ctx, page, seen };
}

/* Pages read at once, each in a logged-in context of its own. Most of a page's time is the span it
 * is watched, so more pages at once cut a pass; the reference and footstrap run at the same count,
 * so the router carries the same load under both. */
const WORKERS = 8;
const sessions = (browser, viewport) => Promise.all(Array.from({ length: WORKERS }, () => session(browser, viewport)));
const closeAll = (list) => Promise.all(list.map((s) => s.ctx.close()));

/* Every pass is timed: the log says where a slow run spent it. Each session takes the next item;
 * an item in `alone` is read after the rest, with nothing else loading. */
async function pass(name, items, list, fn, alone = new Set()) {
	const t0 = Date.now(), out = {};
	const shared = items.filter((x) => !alone.has(x.path || x));
	let next = 0;
	await Promise.all(list.map(async (s) => {
		while (next < shared.length) {
			const x = shared[next++];
			out[x.path || x] = await fn(s, x);
		}
	}));
	const lone = items.filter((x) => alone.has(x.path || x));
	/* the other sessions' last views poll on, and a poll is a neighbour too; a page that cannot leave
	 * (its renderer gone) polls nothing either */
	if (lone.length) await Promise.all(list.slice(1).map((s) => s.page.goto('about:blank').catch(() => {})));
	for (const x of lone) out[x.path || x] = await fn(list[0], x);
	console.log(`  ${name}: ${items.length} in ${Math.round((Date.now() - t0) / 1000)} s`);
	return out;
}

/* The reference is read first, closest to the router's boot: a state an app is still settling into
 * (a first run, a first download) then lands under bootstrap, where it costs nothing. Each pass's
 * reading lands in `into` as it ends, so a crawl that throws leaves what it finished. */
async function crawl(browser, into) {
	const dir = (...p) => { const d = join(OUT, ...p); mkdirSync(d, { recursive: true }); return d; };
	const DESK = { width: 1280, height: 800 }, PHONE = { width: 390, height: 844 };

	setTheme('/luci-static/bootstrap');
	const refs = await sessions(browser, DESK);
	/* menuPaths() leaves out a page whose node has children (Status > Firewall: an untitled
	 * `iptables` child) or renders through a `call` (OpenVPN, OpenClash), yet the menu links it:
	 * every page an entry lands on is read too, so its click has a reference. LuCI's menu tree is
	 * the same under either theme. */
	const entries = into.entries = await inTime(menuEntries(refs[0].page), 30000)
		.catch(async (e) => { throw await stoodDown(e, opt.router, BASE, "LuCI's menu did not load"); });
	const paths = into.paths = [ ...new Set([ ...await menuPaths(refs[0].page, opt.router), ...entries.map((e) => e.leaf) ]) ]
		.filter((p) => !/\/logout$/.test(p));
	check('the menu lists pages', paths.length > 0, `${paths.length} pages`);
	const bs = into.bootstrap = await pass('bootstrap', paths, refs, (s, p) => open(s.page, s.seen, p, { shotDir: dir('bootstrap'), span: LONG + 1000, reference: true }));
	await closeAll(refs.slice(1));
	/* The process_list race (below) empties the reference too, and an empty reference vouches for an
	 * empty footstrap view (3 runs in 5 on 24.10): a view that asked for the process list is read
	 * once more alone, and the fuller reading kept. Its errors, failures and requests join the
	 * first's, so the second reading takes back nothing the first vouched for. Footstrap's passes
	 * read such a view alone from the start: among the phone pass's neighbours on 24.10 it came out
	 * empty 5 runs in 5. */
	const lone = new Set(paths.filter((x) => bs[x].requested.some((k) => k.includes('"getProcessList"'))));
	for (const p of lone) {
		const r = await open(refs[0].page, refs[0].seen, p, { shotDir: dir('bootstrap'), span: LONG + 1000, reference: true });
		console.log(`  again, alone: bootstrap ${p}: ${bs[p].text} -> ${r.text} characters`);
		if (r.text > bs[p].text) bs[p] = { ...r, watched: Math.max(bs[p].watched, r.watched), rendered: bs[p].rendered || r.rendered,
			errors: [ ...bs[p].errors, ...r.errors ], failed: [ ...bs[p].failed, ...r.failed ],
			requested: [ ...new Set([ ...bs[p].requested, ...r.requested ]) ] };
	}
	await closeAll(refs.slice(0, 1));
	setTheme('/luci-static/footstrap');

	const desks = await sessions(browser, DESK);
	const desktop = await pass('desktop', paths, desks, (s, p) => open(s.page, s.seen, p, { shotDir: dir('footstrap', 'desktop'), span: LONG, menu: true }), lone);
	into.footstrap = { desktop };
	await closeAll(desks.slice(2));
	/* two pages, each taking half the entries one after another: each click leaves from the view the
	 * last one rendered (after one that rendered nothing, from the document its stopped load left),
	 * and each page starts on the other half's last entry */
	const half = Math.ceil(entries.length / 2);
	const chains = [ entries.slice(0, half), entries.slice(half) ];
	const t0 = Date.now(), clicks = into.footstrap.click = {};
	await Promise.all(chains.map(async (chain, i) => {
		const s = desks[i], start = chains[1 - i].at(-1) || chain.at(-1);
		await s.page.goto(BASE + start.path, { waitUntil: 'load' })
			.catch(async (e) => { await standGone(e, start.path); await stopLoading(s.page); });
		for (const e of chain)
			if (!(clicks[e.path] = await click(s.page, s.seen, e)).rendered) await stopLoading(s.page);
	}));
	console.log(`  click: ${entries.length} in ${Math.round((Date.now() - t0) / 1000)} s`);
	await closeAll(desks.slice(0, 2));

	const phones = await sessions(browser, PHONE);
	const phone = into.footstrap.phone = await pass('phone', paths, phones, (s, p) => open(s.page, s.seen, p, { shotDir: dir('footstrap', 'phone'), span: SHORT, menu: true }), lone);
	await closeAll(phones);

	/* LuCI's process_list (luci/sys.uc, 24.10 and 25.12) answers an empty list when another rpcd
	 * child exits while it reads top's output, as a neighbour's file.exec does: a view short of
	 * bootstrap's text, or one the measurement could not read, is read once more on its own, with
	 * nothing else loading. A theme that hides a view hides it again. `thin` also holds for a reading
	 * without a text count (a second click that found no link). The race empties a view at a time,
	 * one in each run it hit: more than 20 short in a pass is the theme, and reading every one again
	 * would outlast the e2e step's 15 min and lose the report, so they stay as read. */
	const thin = (r, ref) => !!r.unmeasured || !(r.text >= ref.text / 2);
	const racy = (how, short) => {
		if (short.length <= 20) return true;
		console.log(`  again: ${short.length} ${how} readings short, more than the race leaves; none read again`);
		return false;
	};
	const again = into.again = [];
	for (const [ how, results, viewport, span ] of [ [ 'desktop', desktop, DESK, LONG ], [ 'phone', phone, PHONE, SHORT ] ]) {
		const short = paths.filter((p) => bs[p] && thin(results[p], bs[p]));
		if (!short.length || !racy(how, short)) continue;
		const s = await session(browser, viewport);
		for (const p of short) {
			const before = results[p].text;
			results[p] = await open(s.page, s.seen, p, { shotDir: dir('footstrap', how), span, menu: true });
			console.log(`  again, alone: ${how} ${p}: ${before} -> ${results[p].text} characters (bootstrap ${bs[p].text})`);
			again.push({ how, path: p, before, after: results[p].text, rescued: !thin(results[p], bs[p]) });
		}
		await s.ctx.close();
	}
	/* The same race on a click: an entry whose view shows less than half of bootstrap's text is
	 * clicked once more on its own, from another entry's page. */
	const thinClicks = entries.filter((e) => { const r = clicks[e.path];
		return !r.missing && !r.unclickable && bs[e.leaf] && thin(r, bs[e.leaf]); });
	if (thinClicks.length && racy('click', thinClicks)) {
		const s = await session(browser, DESK);
		for (const e of thinClicks) {
			const before = clicks[e.path].text;
			const from = (entries.find((x) => x.leaf !== e.leaf) || e).leaf;
			await s.page.goto(BASE + from, { waitUntil: 'load' })
				.catch(async (err) => { await standGone(err, from); await stopLoading(s.page); });
			clicks[e.path] = await click(s.page, s.seen, e);
			console.log(`  again, alone: click ${e.path}: ${before} -> ${clicks[e.path].text} characters (bootstrap ${bs[e.leaf].text})`);
			again.push({ how: 'click', path: e.path, before, after: clicks[e.path].text, rescued: !thin(clicks[e.path], bs[e.leaf]) });
		}
		await s.ctx.close();
	}
	/* a view short only on its first reading says so where the run is read; one short on both is judged below */
	if (process.env.GITHUB_ACTIONS)
		for (const a of again.filter((x) => x.rescued))
			console.log(`::warning title=${ghProp('Rescued by a second reading')}::${ghData(`${a.how} ${a.path}: ${a.before} -> ${a.after} characters`)}`);

	const known = new Set(Object.values(bs).flatMap((b) => b.failed.map((f) => `${f.key} ${f.what}`)));
	const pages = into.pages = [];
	for (const p of paths) {
		pages.push({ path: p, how: 'desktop', problems: judge(desktop[p], bs[p], known) });
		pages.push({ path: p, how: 'phone', problems: judge(phone[p], bs[p], known) });
	}
	for (const e of entries) {
		const r = clicks[e.path];
		const problems = r.missing ? [ 'the menu has no link to this entry' ]
			: r.unclickable ? [ `its menu link takes no click: ${r.unclickable}` ]
			: judge(r, bs[e.leaf], known);
		pages.push({ path: e.path, how: 'click', problems });
	}
	const bad = pages.filter((x) => x.problems.length);
	for (const x of bad) for (const pr of x.problems) console.log(`  ${x.how.padEnd(7)} ${x.path}: ${pr}`);
	const clicked = entries.filter((e) => !clicks[e.path].missing && !clicks[e.path].unclickable).length;
	check('every menu entry is reached by a click', entries.length > 0 && clicked === entries.length,
		`${clicked} of ${entries.length} entries`);
	check('every page renders under footstrap with nothing bootstrap does not also show', bad.length === 0,
		`${paths.length} pages × desktop/phone, ${entries.length} menu entries by a click; ${bad.length} failing`);
}

/* A fresh install registers the theme for Language and Style and leaves the active one alone. */
function offered(what) {
	check(`a fresh install of ${what} offers Footstrap`, uci('luci.themes.Footstrap') === '/luci-static/footstrap', uci('luci.themes.Footstrap'));
	check(`a fresh install of ${what} leaves the active theme alone`, theme() === '/luci-static/bootstrap', theme());
}

/* ---- the run ---- */

const report = { router: opt.router, results };
try {
	/* A clean router: no footstrap files, LuCI on its stock theme. owlab's own `theme:` setting may
	 * have pointed LuCI at a theme that is not installed yet; that is undone, not judged. */
	check('the router starts without footstrap', sh('[ -e /www/luci-static/footstrap ] && echo yes || echo no') === 'no');
	sh('uci -q delete luci.themes.Footstrap; uci set luci.main.mediaurlbase=/luci-static/bootstrap; uci commit luci');

	const oldOut = install(opt.old);
	check('the last release installs', installedVersion() !== '', oldOut.split('\n').slice(-1)[0]);
	offered('the last release');

	setTheme('/luci-static/footstrap');
	sh('uci set footstrap.e2e=marker && uci commit footstrap');
	const before = installedVersion();
	const upOut = install(opt.new);
	const after = installedVersion();
	check('this build upgrades the last release', after !== '' && after !== before, `${before} -> ${after}; ${upOut.split('\n').slice(-1)[0]}`);
	check('the upgrade keeps the admin\'s theme', theme() === '/luci-static/footstrap', theme());
	check('the upgrade keeps the admin\'s footstrap settings', uci('footstrap.e2e') === 'marker');

	/* Every host but the router is refused at once and the same way under both themes: an app's call
	 * to GitHub (ssclash, nlbw) no longer depends on the runner's network or GitHub's rate limit. A
	 * proxy rather than sealToRouter(): any route turns the HTTP cache off. `bypass` must name
	 * localhost, or Playwright sends loopback through the proxy too. */
	const browser = await chromium.launch({ proxy: { server: 'http://127.0.0.1:9', bypass: 'localhost' } });
	/* A crawl that throws (a login, or a page and LuCI's root, the stand did not answer) is a red step
	 * of its own: the removal and the fresh install below still run, and the passes it finished stay
	 * in the report. */
	report.crawl = {};
	try {
		await crawl(browser, report.crawl);
	} catch (e) {
		check('the crawl completes', false, String(e.message).split('\n')[0], e instanceof StandDown);
		/* the removal is judged from the admin's theme, whichever pass the crawl stopped in */
		setTheme('/luci-static/footstrap');
	} finally { await browser.close().catch(() => {}); }

	/* the installed build, still the active theme */
	if (!opt['no-anchor']) {
		/* past anchor-check's own 20 min verdict, which puts the theme and the leases back first */
		const anchor = spawnSync(process.execPath, [ join(ROOT, 'tools', 'anchor-check.mjs'), '--router', opt.router ], { encoding: 'utf8', timeout: 25 * 60e3 });
		const anchorLog = `${anchor.stdout || ''}${anchor.stderr || ''}`;
		writeFileSync(join(OUT, 'anchor-check.txt'), anchorLog);
		/* its exit 3: the stand stopped answering, so it judged nothing */
		check('a poll tick that changes the page above the reader leaves them in place', anchor.status === 0,
			anchorLog.split('\n').filter((l) => /^FAIL |^anchor-check /.test(l)).join(' | ') || `exit ${anchor.status}`, anchor.status === 3);
	}

	const control = await loginForm();
	check('LuCI serves its login form before the removal', !control.fault, control.fault, control.down);
	const rmOut = remove();
	check('the package removes', installedVersion() === '', rmOut.split('\n').slice(-1)[0]);
	check('removal falls back to bootstrap', theme() === '/luci-static/bootstrap', theme());
	const form = await loginForm();
	/* silence after the removal is the stand's only when it was silent before it too: a stand that
	 * answered the control and then stopped may have been stopped by the removal */
	check('LuCI still serves its login form after removal', !form.fault, form.fault, form.down && control.down);

	install(opt.new);
	offered('this build');
} catch (e) {
	check('the run completes', false, String(e.stderr || e.message).split('\n').filter(Boolean).slice(-3).join(' | '), e instanceof StandDown);
}

writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, '\t'));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${opt.router}: ${results.length - failed}/${results.length} passed; report in ${OUT}`);
/* A run whose every failure is the stand's judged nothing: on the first attempt it says so once, in
 * the title CI re-runs such a run by. One other failure, or a second attempt, names each under its
 * own step instead: a theme finding keeps the run red, and the same silence twice is no hiccup. */
const down = results.filter((r) => !r.ok && r.standDown);
if (down.length && process.env.GITHUB_ACTIONS) {
	if (down.length === failed && process.env.GITHUB_RUN_ATTEMPT === '1')
		console.log(`::error title=${ghProp('Upstream outage (safe to rerun)')}::${ghData(`e2e on ${opt.router}: ${down.map((r) => `${r.step}: ${r.detail}`).join(' | ')}`)}`);
	else for (const r of down) console.log(`::error title=${ghProp(r.step)}::${ghData(r.detail || r.step)}`);
}
/* A red run's failing steps and pages on the run's page: GitHub shows at most 10 error annotations
 * a step, and a broken theme fails hundreds of pages. Output only, so a summary that cannot be
 * written changes no verdict; the rows stop at 300, far under the summary's 1 MiB. */
if (failed && process.env.GITHUB_STEP_SUMMARY) {
	const cell = (s) => String(s).replace(/\s+/g, ' ').replace(/[\\|]/g, '\\$&').replace(/&/g, '&amp;').replace(/</g, '&lt;');
	const rows = (report.crawl?.pages || []).flatMap((x) => x.problems.map((pr) => `| ${x.how} | ${cell(x.path)} | ${cell(pr)} |`));
	const md = [ `### e2e on ${opt.router}: ${results.length - failed}/${results.length} passed`, '',
		...results.filter((r) => !r.ok).map((r) => `- ${cell(r.step)}${r.detail ? `: ${cell(r.detail)}` : ''}`), '',
		...(rows.length ? [ '| how | path | problem |', '|---|---|---|', ...rows.slice(0, 300) ] : []),
		...(rows.length > 300 ? [ '', `${rows.length - 300} more in report.json` ] : []), '' ];
	try { appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join('\n')); }
	catch (e) { console.log(`the step summary was not written: ${e.message}`); }
}
process.exit(failed ? 1 : 0);
