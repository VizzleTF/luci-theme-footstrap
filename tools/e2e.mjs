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
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { ROOT } from './lib/root.mjs';
import { login, menuPaths } from './lib/stands.mjs';

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

const status = JSON.parse(execFileSync('owlab', [ 'status', '-json' ], { encoding: 'utf8' }));
const router = (status.routers || []).find((r) => r.id === opt.router && r.state === 'running');
if (!router) { console.error(`${opt.router}: not running (owlab up ${opt.router})`); process.exit(2); }
const CONTAINER = `owlab-${status.project}-${router.id}`;
const BASE = `http://localhost:${router.http_port}/cgi-bin/luci`;
const SCRIPT = new URL(BASE).pathname;
const APK = router.package_manager === 'apk';

/* ---- the router side ---- */

const sh = (script) => execFileSync('docker', [ 'exec', CONTAINER, 'sh', '-c', script ],
	{ encoding: 'utf8', stdio: [ 'ignore', 'pipe', 'pipe' ] }).trim();
const uci = (key) => sh(`uci -q get ${key} || true`);
const theme = () => uci('luci.main.mediaurlbase');

/* The package manager runs from an argument vector, never a shell line: the package path comes from
 * the command line. Output is stdout and stderr together, the way an admin reads it. */
function pm(...args) {
	const r = spawnSync('docker', [ 'exec', CONTAINER, ...args ], { encoding: 'utf8' });
	const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
	if (r.status !== 0) throw Object.assign(new Error(`${args.join(' ')} exited ${r.status}`), { stderr: out });
	return out;
}
function install(file) {
	const dst = `/tmp/${basename(file)}`;
	execFileSync('docker', [ 'cp', file, `${CONTAINER}:${dst}` ]);
	return APK ? pm('apk', 'add', '--allow-untrusted', dst) : pm('opkg', 'install', dst);
}
const remove = () => APK ? pm('apk', 'del', 'luci-theme-footstrap') : pm('opkg', 'remove', 'luci-theme-footstrap');
const installedVersion = () => sh(APK
	? "apk list --installed luci-theme-footstrap 2>/dev/null | sed -n 's/^luci-theme-footstrap-\\([^ ]*\\) .*/\\1/p'"
	: "opkg status luci-theme-footstrap | sed -n 's/^Version: //p'");
const setTheme = (url) => sh(`uci set luci.main.mediaurlbase=${url} && uci commit luci && rm -f /tmp/luci-indexcache* /tmp/luci-modulecache/*`);

/* ---- the report ---- */

const results = [];
function check(step, ok, detail = '') {
	results.push({ step, ok, detail });
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? ` — ${detail}` : ''}`);
	return ok;
}

/* ---- the browser side ---- */

/* What the theme serves: a request to one of these that fails is footstrap's whatever bootstrap did. */
const THEME_FILE = /^\/luci-static\/footstrap\/|^\/luci-static\/resources\/(fs-[\w-]+|menu-footstrap[\w-]*)\.js$|^\/luci-static\/resources\/view\/footstrap\/|^\/cgi-bin\/luci-theme-footstrap-pattern$/;

/* How long a page is watched after its view rendered. The full load at desktop width is watched for
 * one LuCI poll interval (5 s, header.ut's `pollinterval` default) plus 1 s for the tick's handlers:
 * theme code that runs late runs on a poll tick or on a timer of its own, the longest of which is
 * fs-router's 5 s warm wait. The phone and click passes look for what differs by width or by
 * client navigation, which shows at render, and get 1 s, as does the reference before it waits
 * for the network to go quiet (settle()). */
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

/* Errors and requests are compared as text with the volatile parts (session ids, query strings,
 * numbers) removed, so the same thing under both themes is one signature. */
const signature = (s) => String(s).split('\n')[0].replace(/[0-9a-f]{32}/g, 'S').replace(/\?[^\s'")]*/g, '').replace(/\d+/g, 'N').slice(0, 300);
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
	const net = page.__net = { inflight: 0, last: Date.now() };
	const error = (sig, scripts) => seen.errors.has(sig) ||
		seen.errors.set(sig, { at: Date.now(), theme: scripts.some((p) => THEME_FILE.test(p)) });
	const failed = (req, what) => seen.failed.has(requestKey(req)) ||
		seen.failed.set(requestKey(req), { path: pathOf(req.url()), what, at: Date.now() });
	page.on('request', (r) => { net.inflight++; net.last = Date.now(); seen.requested.add(requestKey(r)); });
	const done = () => { net.inflight = Math.max(0, net.inflight - 1); net.last = Date.now(); };
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

/* Wait for the view, then watch the page `span` ms; the reference then also waits until nothing has
 * been in flight for a second, 10 s in all at most: an app's own requests keep arriving after its
 * view rendered (adblock and banip fetch their reports late) and must land in the reference. */
async function settle(page, seen, span, reference) {
	const rendered = await page.waitForFunction(RENDERED, null, { timeout: 20000 }).then(() => true, () => false);
	seen.rendered = Date.now();
	await page.waitForTimeout(span);
	if (reference)
		for (let waited = span; waited < 10000; waited += 250) {
			if (page.__net.inflight === 0 && Date.now() - page.__net.last >= 1000) break;
			await page.waitForTimeout(250);
		}
	return rendered;
}

/* Footstrap's menu takes a click at this width: Playwright's actionability check (visible, stable,
 * not covered) on its first entry, without clicking. Null when it does, else why not. */
const unreachable = (page) => page.locator('#topmenu > li > a').first().click({ trial: true, timeout: 3000 })
	.then(() => null, (e) => signature(e.message));

/* What a page showed, as `open` and `click` return it; `after` is ms after the view rendered. */
async function reading(page, seen, rendered, extra = {}) {
	const m = await page.evaluate(MEASURE).catch(() => ({ text: 0, rules: 0, token: '', nav: false }));
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
	try {
		await page.goto(BASE + path, { waitUntil: 'load', timeout: 30000 });
		rendered = await settle(page, seen, span, reference);
	} catch (e) { seen.errors.set(`navigation: ${signature(e.message)}`, { at: Date.now(), theme: false }); }
	const r = await reading(page, seen, rendered, reference ? { requested: [ ...seen.requested ] }
		: menu ? { unreachable: await unreachable(page) } : {});
	await page.screenshot({ path: join(shotDir, `${shotName(path)}.jpg`), type: 'jpeg', quality: 60 }).catch(() => {});
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
		await page.evaluate(() => { window.__e2eStale = (document.getElementById('view') || document.getElementById('maincontent'))?.firstElementChild; });
		await link.click({ timeout: 5000 });
	} catch (e) { return { unclickable: signature(e.message) }; }
	let rendered = false;
	try {
		await page.waitForFunction((p) => location.pathname.replace(/\/$/, '').endsWith(p) &&
			(document.getElementById('view') || document.getElementById('maincontent'))?.firstElementChild !== window.__e2eStale,
		entry.path, { timeout: 20000 });
		rendered = await settle(page, seen, SHORT, false);
	} catch (e) { seen.errors.set(`navigation: ${signature(e.message)}`, { at: Date.now(), theme: false }); }
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
 *   navigation) is one bootstrap never made, so it counts;
 * - a view that never renders where bootstrap's did, or shows less than half of bootstrap's text
 *   (hidden by CSS, or not drawn);
 * - footstrap's stylesheet missing or near empty, its token unresolved, its menu not visible or not
 *   clickable. LuCI falls back to another theme silently on a broken template, which shows here. */
function judge(r, ref) {
	const problems = new Set();
	const errors = new Set(ref ? ref.errors.map((e) => e.sig) : []);
	const asked = new Set(ref ? ref.requested : []);
	const vouched = (x) => !!ref && x.after <= ref.watched;
	for (const e of r.errors)
		if (e.theme || (!errors.has(e.sig) && (vouched(e) || !ref))) problems.add(e.sig);
	for (const f of r.failed)
		if (THEME_FILE.test(f.path) || (!asked.has(f.key) && (vouched(f) || !ref))) problems.add(`${f.what}: ${f.path}`);
	if (!r.rendered && (!ref || ref.rendered)) problems.add('the view never rendered');
	if (ref && r.text < ref.text / 2) problems.add(`the view shows ${r.text} characters of text, bootstrap ${ref.text}`);
	if (r.rules < RULES_FLOOR) problems.add(`footstrap's stylesheet holds ${r.rules} rules (floor ${RULES_FLOOR})`);
	if (!r.token) problems.add('--primary-color-high does not resolve');
	if (!r.nav) problems.add('the menu is not visible');
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

/* Every pass is timed: the log says where a slow run spent it. Each session takes the next item. */
async function pass(name, items, list, fn) {
	const t0 = Date.now(), out = {};
	let next = 0;
	await Promise.all(list.map(async (s) => {
		while (next < items.length) {
			const x = items[next++];
			out[x.path || x] = await fn(s, x);
		}
	}));
	console.log(`  ${name}: ${items.length} in ${Math.round((Date.now() - t0) / 1000)} s`);
	return out;
}

/* The reference is read first, closest to the router's boot: a state an app is still settling into
 * (a first run, a first download) then lands under bootstrap, where it costs nothing. */
async function crawl(browser) {
	const dir = (...p) => { const d = join(OUT, ...p); mkdirSync(d, { recursive: true }); return d; };
	const DESK = { width: 1280, height: 800 }, PHONE = { width: 390, height: 844 };

	setTheme('/luci-static/bootstrap');
	const refs = await sessions(browser, DESK);
	const paths = (await menuPaths(refs[0].page)).filter((p) => !/\/logout$/.test(p));
	check('the menu lists pages', paths.length > 0, `${paths.length} pages`);
	const bs = await pass('bootstrap', paths, refs, (s, p) => open(s.page, s.seen, p, { shotDir: dir('bootstrap'), span: LONG, reference: true }));
	await closeAll(refs);
	setTheme('/luci-static/footstrap');

	const desks = await sessions(browser, DESK);
	const desktop = await pass('desktop', paths, desks, (s, p) => open(s.page, s.seen, p, { shotDir: dir('footstrap', 'desktop'), span: LONG, menu: true }));
	await closeAll(desks.slice(2));
	/* two pages, each taking half the entries one after another: each click leaves from the view the
	 * last one rendered, and each page starts on the other half's last entry */
	const entries = await menuEntries(desks[0].page);
	const half = Math.ceil(entries.length / 2);
	const chains = [ entries.slice(0, half), entries.slice(half) ];
	const t0 = Date.now(), clicks = {};
	await Promise.all(chains.map(async (chain, i) => {
		const s = desks[i], start = chains[1 - i].at(-1) || chain.at(-1);
		await s.page.goto(BASE + start.path, { waitUntil: 'load' }).catch(() => {});
		for (const e of chain) clicks[e.path] = await click(s.page, s.seen, e);
	}));
	console.log(`  click: ${entries.length} in ${Math.round((Date.now() - t0) / 1000)} s`);
	await closeAll(desks.slice(0, 2));

	const phones = await sessions(browser, PHONE);
	const phone = await pass('phone', paths, phones, (s, p) => open(s.page, s.seen, p, { shotDir: dir('footstrap', 'phone'), span: SHORT, menu: true }));
	await closeAll(phones);

	/* LuCI's process_list (luci/sys.uc, 24.10 and 25.12) answers an empty list when another rpcd
	 * child exits while it reads top's output, as a neighbour's file.exec does: a view short of
	 * bootstrap's text is read once more on its own, with nothing else loading. A theme that hides
	 * a view hides it again. */
	for (const [ how, results, viewport, span ] of [ [ 'desktop', desktop, DESK, LONG ], [ 'phone', phone, PHONE, SHORT ] ]) {
		const thin = paths.filter((p) => bs[p] && results[p].text < bs[p].text / 2);
		if (!thin.length) continue;
		const s = await session(browser, viewport);
		for (const p of thin) {
			const before = results[p].text;
			results[p] = await open(s.page, s.seen, p, { shotDir: dir('footstrap', how), span, menu: true });
			console.log(`  again, alone: ${how} ${p}: ${before} -> ${results[p].text} characters (bootstrap ${bs[p].text})`);
		}
		await s.ctx.close();
	}

	const pages = [];
	for (const p of paths) {
		pages.push({ path: p, how: 'desktop', problems: judge(desktop[p], bs[p]) });
		pages.push({ path: p, how: 'phone', problems: judge(phone[p], bs[p]) });
	}
	for (const e of entries) {
		const r = clicks[e.path];
		const problems = r.missing ? [ 'the menu has no link to this entry' ]
			: r.unclickable ? [ `its menu link takes no click: ${r.unclickable}` ]
			: judge(r, bs[e.leaf]);
		pages.push({ path: e.path, how: 'click', problems });
	}
	const bad = pages.filter((x) => x.problems.length);
	for (const x of bad) for (const pr of x.problems) console.log(`  ${x.how.padEnd(7)} ${x.path}: ${pr}`);
	const clicked = entries.filter((e) => !clicks[e.path].missing && !clicks[e.path].unclickable).length;
	check('every menu entry is reached by a click', entries.length > 0 && clicked === entries.length,
		`${clicked} of ${entries.length} entries`);
	check('every page renders under footstrap with nothing bootstrap does not also show', bad.length === 0,
		`${paths.length} pages × desktop/phone, ${entries.length} menu entries by a click; ${bad.length} failing`);
	return { paths, entries, pages, bootstrap: bs, footstrap: { desktop, phone, click: clicks } };
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

	const browser = await chromium.launch();
	try {
		report.crawl = await crawl(browser);
	} finally { await browser.close(); }

	/* the installed build, still the active theme */
	if (!opt['no-anchor']) {
		const anchor = spawnSync(process.execPath, [ join(ROOT, 'tools', 'anchor-check.mjs'), '--router', opt.router ], { encoding: 'utf8', timeout: 900000 });
		const anchorLog = `${anchor.stdout || ''}${anchor.stderr || ''}`;
		writeFileSync(join(OUT, 'anchor-check.txt'), anchorLog);
		check('a poll tick that changes the page above the reader leaves them in place', anchor.status === 0,
			anchorLog.split('\n').filter((l) => /^FAIL |^anchor-check /.test(l)).join(' | ') || `exit ${anchor.status}`);
	}

	const rmOut = remove();
	check('the package removes', installedVersion() === '', rmOut.split('\n').slice(-1)[0]);
	check('removal falls back to bootstrap', theme() === '/luci-static/bootstrap', theme());
	/* LuCI answers the login form with a 403, so the body is the evidence, not the status */
	const form = await fetch(BASE + '/', { signal: AbortSignal.timeout(15000) }).then((r) => r.text(), (e) => String(e));
	check('LuCI still serves its login form after removal', /luci_password/.test(form));

	install(opt.new);
	offered('this build');
} catch (e) {
	check('the run completes', false, String(e.stderr || e.message).split('\n').filter(Boolean).slice(-3).join(' | '));
}

writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, '\t'));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${opt.router}: ${results.length - failed}/${results.length} passed; report in ${OUT}`);
process.exit(failed ? 1 : 0);
