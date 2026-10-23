#!/usr/bin/env node
/* The package's whole life on a real router, the way an admin lives it, against one running owlab
 * router that has LuCI and its apps but not this theme:
 *
 *   1. install the last published release        -> it becomes the active theme
 *   2. the admin switches to bootstrap and saves a footstrap setting
 *   3. upgrade to this build                       -> the admin's theme and setting survive
 *   4. the admin picks footstrap again, and every page of the menu is opened: by a full load at
 *      desktop and phone width, and by a click in the chrome. The same pages are then opened
 *      under bootstrap, and a page fails only for what footstrap adds: a JS error, a failed
 *      request or a view that never renders where bootstrap had none, or the theme's own
 *      stylesheet and chrome missing (LuCI falls back to another theme silently on a broken
 *      template).
 *   5. remove the package                          -> LuCI falls back to bootstrap and still serves
 *   6. install this build on the clean router      -> it becomes the active theme
 *
 * No list of expected problems: the stock theme on the same router is the reference.
 *
 *   node tools/e2e.mjs --router owrt2512 --old <last release pkg> --new <this build pkg> [--out dir]
 *
 * Exit 0 when every step passed, 1 otherwise; the report and one screenshot per page and width
 * land in --out (default ../tmp/e2e-<router>). */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { ROOT } from './lib/root.mjs';

const { values: opt } = parseArgs({ options: {
	router: { type: 'string' },
	old: { type: 'string' },
	new: { type: 'string' },
	out: { type: 'string' },
} });
if (!opt.router || !opt.old || !opt.new) {
	console.error('usage: node tools/e2e.mjs --router <id> --old <pkg> --new <pkg> [--out dir]');
	process.exit(2);
}
const OUT = opt.out || join(ROOT, '..', 'tmp', `e2e-${opt.router}`);
mkdirSync(OUT, { recursive: true });

const status = JSON.parse(execFileSync('owlab', [ 'status', '-json' ], { encoding: 'utf8' }));
const router = (status.routers || []).find((r) => r.id === opt.router && r.state === 'running');
if (!router) { console.error(`${opt.router}: not running (owlab up ${opt.router})`); process.exit(2); }
const CONTAINER = `owlab-${status.project}-${router.id}`;
const BASE = `http://localhost:${router.http_port}/cgi-bin/luci`;
const APK = router.package_manager === 'apk';

/* ---- the router side ---- */

const sh = (script) => execFileSync('docker', [ 'exec', CONTAINER, 'sh', '-c', script ],
	{ encoding: 'utf8', stdio: [ 'ignore', 'pipe', 'pipe' ] }).trim();
const uci = (key) => sh(`uci -q get ${key} || true`);
const theme = () => uci('luci.main.mediaurlbase');

function install(file) {
	const dst = `/tmp/${basename(file)}`;
	execFileSync('docker', [ 'cp', file, `${CONTAINER}:${dst}` ]);
	return sh(APK ? `apk add --allow-untrusted ${dst} 2>&1` : `opkg install ${dst} 2>&1`);
}
const remove = () => sh(APK ? 'apk del luci-theme-footstrap 2>&1' : 'opkg remove luci-theme-footstrap 2>&1');
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

/* The view has rendered: a client-side view has replaced its "Loading view…" spinner, a legacy CBI
 * or template page has put something into #maincontent. Runs inside the page. */
const RENDERED = () => {
	const v = document.getElementById('view');
	if (v) return v.children.length > 0 && !v.querySelector(':scope > .spinning');
	const m = document.getElementById('maincontent');
	return !!(m && m.textContent.trim());
};
/* footstrap is what painted the page: its stylesheet loaded and its chrome is in the document. */
const FOOTSTRAP = () => {
	const link = document.querySelector('link[data-fs-shell]');
	return !!(link && link.sheet && document.querySelector('[data-fs-chrome]'));
};

/* Errors are compared as text with the volatile parts (numbers, query strings) removed, so the same
 * fault under both themes is one signature. */
const signature = (s) => String(s).split('\n')[0].replace(/\?[^\s'")]*/g, '').replace(/\d+/g, 'N').slice(0, 300);

function watch(page, origin) {
	const errors = new Set();
	page.on('pageerror', (e) => errors.add(`pageerror: ${signature(e.message)}`));
	page.on('console', (m) => { if (m.type() === 'error') errors.add(`console: ${signature(m.text())}`); });
	page.on('response', (r) => {
		if (r.status() >= 400 && new URL(r.url()).origin === origin)
			errors.add(`http ${r.status()}: ${signature(new URL(r.url()).pathname)}`);
	});
	page.on('requestfailed', (r) => {
		if (new URL(r.url()).origin === origin) errors.add(`failed: ${signature(new URL(r.url()).pathname)}`);
	});
	return errors;
}

async function login(page) {
	await page.goto(BASE, { waitUntil: 'domcontentloaded' });
	if (await page.$('input[name="luci_password"]')) {
		await page.fill('input[name="luci_username"]', 'root');
		await Promise.all([ page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
			page.press('input[name="luci_password"]', 'Enter') ]);
	}
	await page.waitForFunction(() => window.L && typeof window.L.require === 'function', null, { timeout: 30000 });
}

/* Every page the menu offers that renders something: leaves whose action is a view, a template or
 * a CBI map, with a title. Logout is left out: it ends the session the walk runs in. */
async function menuPaths(page) {
	const paths = await page.evaluate(async () => {
		const ui = await window.L.require('ui');
		const tree = await ui.menu.load();
		const out = [];
		const walk = (node, path) => {
			for (const [ name, child ] of Object.entries(node.children || {})) {
				const p = path.concat(name);
				if (child.children && Object.keys(child.children).length) { walk(child, p); continue; }
				const type = (child.action && child.action.type) || '';
				if ([ 'view', 'template', 'cbi' ].includes(type) && child.title) out.push('/' + p.join('/'));
			}
		};
		walk(tree, []);
		return out;
	});
	return paths.filter((p) => !/\/logout$/.test(p));
}

const shotName = (path) => path.replace(/^\//, '').replace(/\//g, '_') || 'root';

/* One full load of `path`: errors seen, whether the view rendered, whether footstrap painted it. */
async function open(page, errors, path, shotDir) {
	errors.clear();
	let rendered = false;
	try {
		await page.goto(BASE + path, { waitUntil: 'load', timeout: 30000 });
		rendered = await page.waitForFunction(RENDERED, null, { timeout: 20000 }).then(() => true, () => false);
		await page.waitForTimeout(500);
	} catch (e) { errors.add(`navigation: ${signature(e.message)}`); }
	const painted = await page.evaluate(FOOTSTRAP).catch(() => false);
	if (shotDir) await page.screenshot({ path: join(shotDir, `${shotName(path)}.jpg`), type: 'jpeg', quality: 60 }).catch(() => {});
	return { errors: [ ...errors ], rendered, painted };
}

/* The same page reached the way a user reaches it in footstrap: a click on its link in the chrome,
 * from wherever the previous click left the reader. Null when the chrome has no link to it (a page
 * reached through a tab strip). */
async function click(page, errors, path) {
	errors.clear();
	const href = BASE + path;
	const found = await page.evaluate((h) => {
		const a = [ ...document.querySelectorAll('[data-fs-chrome] a[href], nav a[href]') ]
			.find((el) => el.href === h || el.href === h + '/');
		if (a) a.click();
		return !!a;
	}, href);
	if (!found) return null;
	let rendered = false;
	try {
		await page.waitForFunction((p) => location.pathname.replace(/\/$/, '').endsWith(p), path, { timeout: 20000 });
		rendered = await page.waitForFunction(RENDERED, null, { timeout: 20000 }).then(() => true, () => false);
		await page.waitForTimeout(500);
	} catch (e) { errors.add(`navigation: ${signature(e.message)}`); }
	const painted = await page.evaluate(FOOTSTRAP).catch(() => false);
	return { errors: [ ...errors ], rendered, painted };
}

async function session(browser, viewport) {
	const ctx = await browser.newContext({ viewport, ignoreHTTPSErrors: true });
	const page = await ctx.newPage();
	const errors = watch(page, new URL(BASE).origin);
	await login(page);
	return { ctx, page, errors };
}

async function crawl(browser) {
	const desk = await session(browser, { width: 1280, height: 800 });
	const paths = await menuPaths(desk.page);
	check('the menu lists pages', paths.length > 0, `${paths.length} pages`);
	const shots = (w) => { const d = join(OUT, 'footstrap', w); mkdirSync(d, { recursive: true }); return d; };

	const fs = { desktop: {}, phone: {}, click: {} };
	for (const p of paths) fs.desktop[p] = await open(desk.page, desk.errors, p, shots('desktop'));
	await desk.page.goto(BASE + paths[0], { waitUntil: 'load' });
	for (const p of paths) fs.click[p] = await click(desk.page, desk.errors, p);
	await desk.ctx.close();

	const phone = await session(browser, { width: 390, height: 844 });
	for (const p of paths) fs.phone[p] = await open(phone.page, phone.errors, p, shots('phone'));
	await phone.ctx.close();

	setTheme('/luci-static/bootstrap');
	const ref = await session(browser, { width: 1280, height: 800 });
	const bs = {};
	const bsDir = join(OUT, 'bootstrap'); mkdirSync(bsDir, { recursive: true });
	for (const p of paths) bs[p] = await open(ref.page, ref.errors, p, bsDir);
	await ref.ctx.close();
	setTheme('/luci-static/footstrap');

	const pages = [];
	for (const p of paths) {
		const base = new Set(bs[p].errors);
		for (const [ how, r ] of [ [ 'desktop', fs.desktop[p] ], [ 'phone', fs.phone[p] ], [ 'click', fs.click[p] ] ]) {
			if (!r) continue;
			const added = r.errors.filter((e) => !base.has(e));
			const problems = [ ...added ];
			if (!r.rendered && bs[p].rendered) problems.push('the view never rendered (it does under bootstrap)');
			if (!r.painted) problems.push('footstrap did not paint the page (stylesheet or chrome missing)');
			pages.push({ path: p, how, problems });
		}
	}
	const bad = pages.filter((x) => x.problems.length);
	for (const x of bad) for (const pr of x.problems) console.log(`  ${x.how.padEnd(7)} ${x.path}: ${pr}`);
	const clicked = paths.filter((p) => fs.click[p]).length;
	check('every page renders under footstrap with nothing bootstrap does not also show', bad.length === 0,
		`${paths.length} pages × desktop/phone, ${clicked} also by a click in the chrome; ${bad.length} failing`);
	return { paths, pages, bootstrap: bs };
}

/* ---- the run ---- */

let crawlReport = null;
try {
	/* A clean router: no footstrap files, LuCI on its stock theme. owlab's own `theme:` setting may
	 * have pointed LuCI at a theme that is not installed yet; that is undone, not judged. */
	check('the router starts without footstrap', sh('[ -e /www/luci-static/footstrap ] && echo yes || echo no') === 'no');
	sh('uci -q delete luci.themes.Footstrap; uci set luci.main.mediaurlbase=/luci-static/bootstrap; uci commit luci');

	const oldOut = install(opt.old);
	check('the last release installs', installedVersion() !== '', oldOut.split('\n').slice(-1)[0]);
	check('a fresh install of the last release makes it the active theme', theme() === '/luci-static/footstrap', theme());

	setTheme('/luci-static/bootstrap');
	sh('uci set footstrap.e2e=marker && uci commit footstrap');
	const before = installedVersion();
	const upOut = install(opt.new);
	const after = installedVersion();
	check('this build upgrades the last release', after !== '' && after !== before, `${before} -> ${after}; ${upOut.split('\n').slice(-1)[0]}`);
	check('the upgrade keeps the admin\'s theme', theme() === '/luci-static/bootstrap', theme());
	check('the upgrade keeps the admin\'s footstrap settings', uci('footstrap.e2e') === 'marker');

	setTheme('/luci-static/footstrap');
	const browser = await chromium.launch();
	try { crawlReport = await crawl(browser); } finally { await browser.close(); }

	const rmOut = remove();
	check('the package removes', installedVersion() === '', rmOut.split('\n').slice(-1)[0]);
	check('removal falls back to bootstrap', theme() === '/luci-static/bootstrap', theme());
	/* 25.12 answers the login form with a 403, so the body is the evidence, not the status */
	const login = await fetch(BASE + '/').then((r) => r.text(), (e) => String(e));
	check('LuCI still serves its login form after removal', /luci_password/.test(login));

	install(opt.new);
	check('a fresh install of this build makes it the active theme', theme() === '/luci-static/footstrap', theme());
} catch (e) {
	check('the run completes', false, String(e.stderr || e.message).split('\n').filter(Boolean).slice(-3).join(' | '));
}

writeFileSync(join(OUT, 'report.json'), JSON.stringify({ router: opt.router, results, crawl: crawlReport }, null, '\t'));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${opt.router}: ${results.length - failed}/${results.length} passed; report in ${OUT}`);
process.exit(failed ? 1 : 0);
