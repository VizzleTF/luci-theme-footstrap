#!/usr/bin/env node
/* Proves a `build.mjs` output offline, in a real Chromium: serves `--out` under `--base` (the
 * pattern `tools/lib/gallery.mjs`'s `serveGallery` uses for the a11y/export-tier gates, generalised
 * to a whole directory tree and a base prefix) and opens every recorded page. Fails a page on a
 * `pageerror`, a non-empty `window.__pgMiss` (replay.js's own miss log), any 404, or an empty
 * `#view` once the page has settled — the same four questions `tools/smoke.mjs` asks of the
 * gallery, asked here of the built site instead. Also proves the ONE client navigation
 * (overview -> footstrap, `docs/spa-router.md`) does not fall back to a full load, that an
 * Appearance change both takes effect and survives a reload, and that the login gate
 * (`replay.js`) sends an unauthenticated visit to the login form, accepts any credentials, and
 * `.fs-logout` sends the reader back.
 *
 * Needs `--out` already built (`playground:build`); never touches a router.
 *
 *   node tools/playground/verify.mjs [--out DIR] [--base /path] [--budget-kb N]
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { resolveUnderRoot } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

const { values: FLAGS } = parseArgs({ options: {
	help: { type: 'boolean', default: false },
	out: { type: 'string', default: join(ROOT, '..', 'tmp/playground/out') },
	base: { type: 'string', default: '/luci-theme-footstrap/playground' },
	/* no `default:` — `undefined` is what "no budget passed" means below, and 'string' can't
	 * default to null. */
	'budget-kb': { type: 'string' },
} });

if (FLAGS.help) {
	console.log('Usage: node tools/playground/verify.mjs [--out DIR] [--base /path] [--budget-kb N]');
	process.exit(0);
}

const OUT = FLAGS.out;
const BASE = FLAGS.base;
const BUDGET_KB = FLAGS['budget-kb'];
const SETTLE_MS = 1400;

const TYPES = {
	'.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
	'.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
	'.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon',
};

/* Same directory-index rule a real static host applies to `cgi-bin/luci/<page>/index.html`
 * (build.mjs's own layout): a request for the directory itself is redirected to the trailing
 * slash, which is then handed `index.html`. Anything neither a file nor such a directory answers
 * with `404.html` at a 404 status, the same page a live router would 404 with. */
function serveOut(outDir, base) {
	const normBase = base.replace(/\/+$/, '');
	const server = createServer((req, res) => {
		let pathname;
		try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
		catch (e) { res.writeHead(400).end(); return; }
		if (pathname !== normBase && !pathname.startsWith(`${normBase}/`)) { res.writeHead(404).end(); return; }
		const rel = pathname.slice(normBase.length) || '/';
		/* `resolveUnderRoot` (lib.mjs) is what actually decides the request stays inside `outDir` —
		 * a plain `join()` followed by a `startsWith()` on the unnormalised STRING let a decoded
		 * `{base}/../../etc/passwd` out, since `../` only collapses once something normalises the
		 * path, which the string compare never did. */
		const file = resolveUnderRoot(outDir, rel.endsWith('/') ? `${rel}index.html` : rel);
		if (!file) { res.writeHead(403).end(); return; }
		/* `file` for a directory URL with no trailing slash IS `existsSync` (it names the directory
		 * itself), so the redirect must key on `isDirectory()`, not on absence — the inverted check
		 * fell through to the 404 branch below for every one of build.mjs's `cgi-bin/luci/<page>/`
		 * directories. */
		if (!rel.endsWith('/') && existsSync(file) && statSync(file).isDirectory()) {
			const indexFile = resolveUnderRoot(outDir, `${rel}/index.html`);
			if (indexFile && existsSync(indexFile)) {
				res.writeHead(301, { location: `${pathname}/` }).end();
				return;
			}
		}
		if (!existsSync(file) || !statSync(file).isFile()) {
			const notFound = join(outDir, '404.html');
			res.writeHead(404, { 'content-type': 'text/html' });
			res.end(existsSync(notFound) ? readFileSync(notFound) : 'Not found');
			return;
		}
		res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
		res.end(readFileSync(file));
	});
	return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
		base: `http://127.0.0.1:${server.address().port}${normBase}`,
		close: () => server.close(),
	})));
}

async function checkPage(context, serverBase, p, fail) {
	const page = await context.newPage();
	const problems = [];
	page.on('pageerror', (e) => problems.push(`pageerror: ${e}`));
	page.on('response', (r) => { if (r.status() === 404) problems.push(`404: ${r.url()}`); });

	await page.goto(`${serverBase}/cgi-bin/luci/${p}`, { waitUntil: 'load' });
	await page.waitForTimeout(SETTLE_MS);

	const miss = await page.evaluate(() => window.__pgMiss || []);
	if (miss.length) problems.push(`__pgMiss: ${JSON.stringify(miss)}`);

	const viewFilled = await page.$eval('#view', (el) => el.textContent.trim().length > 0).catch(() => false);
	if (!viewFilled) problems.push('#view is empty after settle');

	if (problems.length) fail(`${p}: ${problems.join('; ')}`);
	await page.close();
}

/* A section's own `<ul>` is `display: none` until its trigger — the `<a role="button"
 * aria-controls>` menu-footstrap.js:212-218 wires beside it — adds `.open` to their shared `<li>`
 * (menu-footstrap.js:220-235, `li.has-sub.open > ul { display: … }`, 20-shell.css:174/406/528). A
 * user reaches a nested item by opening every ancestor section first; clicking the link directly
 * hit Playwright's own visibility wait and timed out. Climbs outward from `el`, clicking each
 * `[aria-controls]` trigger in turn — capped at 5, deeper than any real menu.d tree nests. */
async function openAncestorSections(page, el) {
	let current = el;
	for (let i = 0; i < 5; i++) {
		const submenuHandle = await page.evaluateHandle((node) => node.closest('ul[id^="fs-sub-"]'), current);
		const submenu = submenuHandle.asElement();
		if (!submenu) return;
		const triggerHandle = await page.evaluateHandle(
			(ul) => document.querySelector(`[aria-controls="${ul.id}"]`), submenu);
		const trigger = triggerHandle.asElement();
		if (!trigger) return;
		await trigger.click();
		current = trigger;
	}
}

async function checkSpaNav(context, serverBase, fail) {
	const page = await context.newPage();
	let loads = 0;
	page.on('load', () => { loads += 1; });

	await page.goto(`${serverBase}/cgi-bin/luci/admin/status/overview`, { waitUntil: 'load' });
	await page.waitForTimeout(SETTLE_MS);

	const link = await page.evaluateHandle(() => Array.from(document.querySelectorAll('a[href]'))
		.find((a) => (a.getAttribute('href') || '').endsWith('/footstrap')));
	const el = link.asElement();
	if (!el) { fail('spa: no link to the footstrap page in the rendered menu'); await page.close(); return; }

	await openAncestorSections(page, el);
	await page.waitForTimeout(200);

	await el.click();
	await page.waitForTimeout(SETTLE_MS);

	if (loads !== 1) fail(`spa: overview -> footstrap triggered ${loads - 1} extra full load(s)`);
	const onFootstrap = await page.evaluate(() => location.pathname.endsWith('/footstrap'));
	if (!onFootstrap) fail('spa: the URL did not change to the footstrap page');
	await page.close();
}

/* fs-appearance.js's `selectCtl` sets `aria-label` on `ui.Select#render()`'s return value, which is
 * the WRAPPING `<div>` (ui.js:807 `frameEl`), not the `<select>` it appends — `aria-label` sits one
 * level above the element it should describe. What the caption actually is sits in the `group()`
 * row's own `label.cbi-value-title` text (fs-appearance.js:264), so that is what a lookup has to
 * key on instead. */
async function checkPalette(context, serverBase, fail) {
	const page = await context.newPage();
	await page.goto(`${serverBase}/cgi-bin/luci/admin/system/footstrap`, { waitUntil: 'load' });
	await page.waitForTimeout(SETTLE_MS);

	const handle = await page.evaluateHandle(() => {
		const row = Array.from(document.querySelectorAll('.cbi-value')).find((r) => {
			const title = r.querySelector('.cbi-value-title');
			return title && title.textContent.trim() === 'Palette';
		});
		return row ? row.querySelector('select') : null;
	});
	const select = handle.asElement();
	if (!select) { fail('palette: no Palette control on the Appearance page'); await page.close(); return; }

	const options = await select.$$eval('option', (opts) => opts.map((o) => o.value));
	for (const want of [ 'footstrap', 'hicontrast', 'bootstrap', '2020', 'forum' ])
		if (!options.includes(want)) fail(`palette: option "${want}" missing from the Palette select`);

	/* fs-select.js hides this native `<select>` (`display: none`, fs-select.js:110) behind a
	 * visible `cbi-dropdown` it builds beside it, so `selectOption` — which waits on the element's
	 * OWN visibility — times out. `ui.Select.bind()` wires `widget-change` off THIS element's own
	 * `change` event (ui.js:882-883), not off fs-select's widget, and fs-select's own picked-option
	 * handler ends by setting `.value` and dispatching that same event on it (fs-select.js:145-146)
	 * — so driving it directly is the same signal a real click on the visible widget produces. */
	await select.evaluate((el, v) => {
		el.value = v;
		el.dispatchEvent(new Event('change', { bubbles: true }));
	}, 'hicontrast');
	await page.waitForTimeout(200);

	const applied = await page.evaluate(() => document.documentElement.dataset.palette);
	if (applied !== 'hicontrast') fail(`palette: dataset.palette is "${applied}", not "hicontrast"`);

	await page.reload({ waitUntil: 'load' });
	await page.waitForTimeout(SETTLE_MS);
	const survived = await page.evaluate(() => document.documentElement.dataset.palette);
	if (survived !== 'hicontrast') fail(`palette: dataset.palette did not survive reload ("${survived}")`);
	await page.close();
}

/* The one check that measures the login GATE itself — every check above sets `fs-pg-auth` up front
 * (main()'s `addInitScript`) so it keeps measuring a page instead of the form. Its own context, with
 * no init script: `replay.js`'s guard only fires with nothing in sessionStorage, the state a first
 * visit is actually in. */
async function checkLoginFlow(browser, serverBase, fail) {
	const page = await (await browser.newContext()).newPage();
	const problems = [];
	page.on('pageerror', (e) => problems.push(`pageerror: ${e}`));

	/* `.fs-logout` is a REAL navigation to a page that itself `location.replace()`s onward
	 * (build.mjs's synthesised logout page) — two hops, not one, so a click is followed by
	 * `waitForURL(predicate)` (tolerates any number of hops in between) rather than raced against a
	 * single `waitForNavigation`, which is free to resolve on the FIRST of the two and read the
	 * logout page's own transient URL as the answer. */
	const settle = async (urlIsDone) => {
		await page.waitForURL(urlIsDone, { timeout: 10000 }).catch(() => {});
		await page.waitForTimeout(SETTLE_MS);
	};
	const onLogin = (u) => u.pathname.endsWith('/cgi-bin/luci/');

	await page.goto(`${serverBase}/cgi-bin/luci/admin/status/overview`, { waitUntil: 'load' });
	await settle(onLogin);

	if (!page.url().endsWith('/cgi-bin/luci/'))
		problems.push(`an unauthenticated open of overview landed on "${page.url()}", not the login page`);

	const miss = await page.evaluate(() => window.__pgMiss || []);
	if (miss.length) problems.push(`login page: __pgMiss ${JSON.stringify(miss)}`);

	const username = await page.$eval('input[name="luci_username"]', (el) => el.value).catch(() => null);
	const password = await page.$eval('input[name="luci_password"]', (el) => el.value).catch(() => null);
	if (username !== 'root') problems.push(`login page: username field is "${username}", not "root"`);
	if (password !== '') problems.push(`login page: password field is "${password}", not empty`);

	const submit = async () => {
		await page.fill('input[name="luci_username"]', 'x');
		await page.fill('input[name="luci_password"]', 'y');
		await page.click('form.fs-login input[type="submit"]');
		await settle((u) => !onLogin(u));
	};

	await submit();
	if (!/\/admin\/status\/overview\/?$/.test(new URL(page.url()).pathname))
		problems.push(`submitting any credentials landed on "${page.url()}", not the requested overview page`);

	const logout = await page.$('.fs-logout');
	if (!logout) {
		problems.push('no .fs-logout control on the overview page');
	} else {
		await logout.click();
		await settle(onLogin);
		if (!page.url().endsWith('/cgi-bin/luci/'))
			problems.push(`.fs-logout landed on "${page.url()}", not the login page`);
	}

	await page.goto(`${serverBase}/cgi-bin/luci/admin/system/footstrap`, { waitUntil: 'load' });
	await settle(onLogin);
	if (!page.url().endsWith('/cgi-bin/luci/'))
		problems.push(`a direct open of footstrap while logged out landed on "${page.url()}", not the login page`);

	await submit();
	if (!/\/admin\/system\/footstrap\/?$/.test(new URL(page.url()).pathname))
		problems.push(`submitting after a direct footstrap open landed on "${page.url()}", not footstrap`);

	if (problems.length) fail(`login: ${problems.join('; ')}`);
	await page.close();
}

function checkBudget(fail) {
	if (BUDGET_KB == null) return;
	const tarPath = join(dirname(OUT), 'playground.tar.gz');
	if (!existsSync(tarPath)) { fail(`budget: ${tarPath} does not exist — run playground:build first`); return; }
	const kb = statSync(tarPath).size / 1024;
	if (kb > Number(BUDGET_KB)) fail(`budget: playground.tar.gz is ${kb.toFixed(0)} KB, over the ${BUDGET_KB} KB budget`);
}

async function main() {
	if (!existsSync(OUT)) {
		console.error(`playground/verify: ${OUT} does not exist — run playground:build first.`);
		process.exit(2);
	}
	const pages = JSON.parse(readFileSync(join(HERE, 'pages.json'), 'utf8'));
	const failures = [];
	const fail = (msg) => failures.push(msg);

	const server = await serveOut(OUT, BASE);
	const browser = await chromium.launch();
	const context = await browser.newContext();
	/* Every check below but `checkLoginFlow` measures a PAGE, not the login gate — without this,
	 * every one of them would land on the login form instead (replay.js's guard fires on a fresh
	 * `sessionStorage`, which every new page in a fresh context starts with). */
	await context.addInitScript(() => window.sessionStorage.setItem('fs-pg-auth', '1'));

	/* One check throwing (a `goto` timeout, a closed page) used to unwind straight past
	 * `browser.close()` into the outer catch, which prints the one exception and exits — dropping
	 * every failure `fail()` had already collected from checks that ran and finished before it.
	 * Each check runs to completion or has its own throw folded into `failures` instead, so a run
	 * always reports everything it saw, not just the first thing that broke. */
	const guard = async (label, run) => {
		try { await run(); }
		catch (e) { fail(`${label}: threw — ${(e && e.stack) || e}`); }
	};

	for (const p of pages) await guard(p, () => checkPage(context, server.base, p, fail));
	await guard('spa', () => checkSpaNav(context, server.base, fail));
	await guard('palette', () => checkPalette(context, server.base, fail));
	await guard('login', () => checkLoginFlow(browser, server.base, fail));
	await guard('budget', () => checkBudget(fail));

	await browser.close();
	server.close();

	if (failures.length) {
		console.error(`playground/verify: ${failures.length} problem(s):`);
		for (const f of failures) console.error(`  - ${f}`);
		process.exit(1);
	}
	console.log(`playground/verify: ${pages.length} page(s), SPA nav, login gate, palette and budget all pass.`);
}

main().catch((e) => {
	console.error(String((e && e.stack) || e));
	process.exit(1);
});
