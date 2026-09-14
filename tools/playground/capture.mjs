#!/usr/bin/env node
/* Records a real router into `--recording` for build.mjs to turn into a static site: the raw
 * server document per page (`docs/`), the unauthenticated login form the same way (`docs/login.html`
 * — its OWN context, no cookie from the session below), every `/luci-static/**` GET the pages
 * actually fetched plus the whole icons directory an overlay-driven state can pick from but a
 * container's own state never requested (`static/`), every distinct ubus call keyed by
 * `object.method(args)` (`rpc.json`, `lib.mjs`'s `requestKey`), the ACL-filtered menu (`menu.json`)
 * and the stand's own version info (`meta.json`). Talks to ONE owlab stand (`tools/lib/stands.mjs`),
 * never touches the built site.
 *
 * Never run by a gate: needs a booted, installed owlab router (T2, docs/development.md).
 *
 *   node tools/playground/capture.mjs [--stand owrt2512] [--recording DIR] [--pages FILE]
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { stands, login, menuPaths, sealToRouter, requireStands } from '../lib/stands.mjs';
import { splitBatch, parseLsLines } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

const arg = (name, dflt) => {
	const i = process.argv.indexOf(`--${name}`);
	return i === -1 ? dflt : process.argv[i + 1];
};

if (process.argv.includes('--help')) {
	console.log('Usage: node tools/playground/capture.mjs [--stand owrt2512] [--recording DIR] [--pages FILE]');
	process.exit(0);
}

const STAND_ID = arg('stand', 'owrt2512');
const OUT = arg('recording', join(ROOT, '..', 'tmp/playground/recording'));
const PAGES_FILE = arg('pages', join(HERE, 'pages.json'));
/* Full load + settle, the same window a full navigation is given elsewhere in the live gates
 * (spa-parity.mjs) before anything on the page is trusted to have finished rendering. */
const SETTLE_MS = 1400;

const pages = JSON.parse(readFileSync(PAGES_FILE, 'utf8'));

/* Best-effort: the theme's own package version is not reachable over ubus (no RPC object exposes
 * an installed package's version), only over the stand's shell. A failure here still leaves a
 * usable recording — the banner build.mjs writes from it just says "unknown" instead of a version. */
function themeVersion(standId) {
	try {
		const out = execFileSync('owlab', [ 'exec', standId, '--',
			'opkg list-installed luci-theme-footstrap 2>/dev/null || apk info -e -a luci-theme-footstrap 2>/dev/null' ],
		{ encoding: 'utf8' });
		const m = out.match(/luci-theme-footstrap\s*-\s*([^\s]+)|luci-theme-footstrap-([^\s]+)/);
		return (m && (m[1] || m[2])) || 'unknown';
	} catch (e) {
		return 'unknown';
	}
}

/* uhttpd serves the docroot with no directory index turned on (no uci-defaults here or upstream
 * enables `Options +Indexes`), so a GET on `/luci-static/resources/icons/` itself 404s — the
 * router's own shell is the only place left that can enumerate it. Same `owlab exec` shape as
 * `themeVersion()` above, but loud on failure: a directory this cannot list is a directory whose
 * files silently stay unrecorded, which is the exact bug this function exists to close. */
function listStaticDir(standId, dir) {
	try {
		const out = execFileSync('owlab', [ 'exec', standId, '--', 'ls', '-1', `/www/luci-static/${dir}` ],
			{ encoding: 'utf8' });
		return parseLsLines(out);
	} catch (e) {
		throw new Error(`playground/capture: could not list /www/luci-static/${dir} on ${standId}: ${e.message}`);
	}
}

function writeFile(path, body) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, body);
}

async function main() {
	const [ stand ] = requireStands(stands(STAND_ID), 'playground/capture');

	const browser = await chromium.launch();

	/* Keyed by lib.mjs's requestKey: the LAST response for a given call wins, which is also what a
	 * live page would show if it made the same call twice (a poll tick, a re-render). Declared here,
	 * ahead of login, so the SAME set/file tree also catches the static assets the login page's own
	 * <head> loads (luci.js, the theme's CSS) — recorded once, not twice, if the logged-in pages
	 * below happen to load them again. */
	const rpc = {};
	const staticSeen = new Set();

	async function recordStatic(response) {
		const request = response.request();
		if (request.method() !== 'GET') return;
		let url;
		try { url = new URL(response.url()); } catch (e) { return; }
		if (!url.pathname.startsWith('/luci-static/')) return;
		const rel = url.pathname.slice('/luci-static/'.length);
		if (staticSeen.has(rel)) return;
		staticSeen.add(rel);
		try { writeFile(join(OUT, 'static', rel), await response.body()); }
		catch (e) { /* opaque/aborted response — nothing to save */ }
	}

	/* Unauthenticated on purpose, in its OWN context so no cookie from the logged-in session below
	 * leaks in. LuCI answers a bare GET with the login form itself — 403 + X-LuCI-Login-Required
	 * (dispatcher.uc:967) — and `page.goto` does not throw on a non-2xx status, so the raw body is
	 * there to read once the load settles. */
	const loginContext = await browser.newContext();
	await sealToRouter(loginContext, stand.base);
	const loginPage = await loginContext.newPage();
	loginPage.on('response', recordStatic);
	const [ loginResponse ] = await Promise.all([
		loginPage.waitForResponse((r) => r.request().resourceType() === 'document', { timeout: 30000 }),
		loginPage.goto(stand.base, { waitUntil: 'load' }),
	]);
	await loginPage.waitForTimeout(SETTLE_MS);
	writeFile(join(OUT, 'docs', 'login.html'), await loginResponse.body());
	await loginContext.close();

	const context = await browser.newContext();
	await sealToRouter(context, stand.base);
	const page = await context.newPage();

	await login(page, stand.base);

	/* Every LEAF the router's own menu resolves to, not the list in pages.json: a page this build
	 * asks for that the router does not offer is a stale pages.json entry, and failing loudly here
	 * beats shipping a 404 the tester finds three steps later. `menuPaths()` walks the tree
	 * `action_menu` returns (dispatcher.uc:153), which is rooted ABOVE admin, not at it — its
	 * leaves come back as `/admin/…`, the same shape `pages.json` entries already have. */
	const known = new Set(await menuPaths(page));
	for (const p of pages) {
		const leaf = `/${p}`;
		if (!known.has(leaf))
			throw new Error(`playground/capture: "${p}" is not a page in ${stand.id}'s menu`);
	}

	const menu = await page.evaluate(async () => {
		const res = await fetch(`${window.L.env.scriptname}/admin/menu`, { credentials: 'same-origin' });
		return res.json();
	});
	const ubuspath = await page.evaluate(() => window.L.env.ubuspath);

	page.on('response', async (response) => {
		const request = response.request();
		if (request.method() !== 'GET' && request.method() !== 'POST') return;
		if (request.method() === 'GET') { await recordStatic(response); return; }

		let url;
		try { url = new URL(response.url()); } catch (e) { return; }

		if (url.pathname === ubuspath) {
			try {
				const reqEntries = splitBatch(request.postData() || '{}');
				const resBody = JSON.parse(await response.text());
				const resEntries = Array.isArray(resBody) ? resBody : [ resBody ];
				reqEntries.forEach(({ key }, i) => {
					if (resEntries[i] !== undefined) rpc[key] = resEntries[i];
				});
			} catch (e) { /* not a JSON-RPC exchange, or the router answered with something else */ }
		}
	});

	for (const p of pages) {
		const url = `${stand.base}/${p}`;
		/* `luci.getFeatures` and the boot `list()` probe cache themselves in sessionStorage on the
		 * FIRST real call (luci.js:1882 getLocalData, :2604 probeSystemFeatures) — this loop reuses
		 * one `page` across every URL, so without this every page after the first silently answers
		 * from cache and this recorder's response listener never sees the call to save. */
		await page.evaluate(() => window.sessionStorage.clear());
		const [ response ] = await Promise.all([
			page.waitForResponse((r) => r.url() === url && r.request().resourceType() === 'document', { timeout: 30000 }),
			page.goto(url, { waitUntil: 'load' }),
		]);
		await page.waitForTimeout(SETTLE_MS);
		writeFile(join(OUT, 'docs', `${p}.html`), await response.body());
	}

	/* `overlay.json` can turn a radio "up" or hand it a signal reading the container never had, and
	 * the client then asks for an icon the recorded page loads never triggered (`wifi.svg`, a
	 * `signal-NNN-NNN.svg`) — a state-driven directory a page picks FROM, not a fixed list any one
	 * page load can be trusted to exercise. Fetched through the logged-in `page` so the `response`
	 * listener above files each one under `static/` exactly like a page-triggered GET would. */
	const iconFiles = listStaticDir(stand.id, 'resources/icons');
	await page.evaluate(async (files) => {
		await Promise.all(files.map((f) =>
			fetch(`/luci-static/resources/icons/${f}`, { credentials: 'same-origin' }).catch(() => {})));
	}, iconFiles);
	await page.waitForTimeout(200);

	await browser.close();

	writeFile(join(OUT, 'menu.json'), JSON.stringify(menu, null, 2));
	writeFile(join(OUT, 'rpc.json'), JSON.stringify(rpc, null, 2));
	writeFile(join(OUT, 'meta.json'), JSON.stringify({
		captured_at: new Date().toISOString(),
		stand: stand.id,
		distro: stand.distro,
		release: stand.release,
		package_manager: stand.pkg,
		theme_version: themeVersion(stand.id),
		luci_version: rpc['luci.getVersion({})']?.result?.[1] ?? null,
		pages,
		login: true,
		host: new URL(stand.base).host,
	}, null, 2));

	console.log(`playground/capture: wrote ${pages.length} page(s) to ${OUT}`);
}

main().catch((e) => {
	console.error(String(e && e.stack || e));
	process.exit(1);
});
