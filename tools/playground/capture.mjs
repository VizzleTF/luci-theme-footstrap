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
import {
	splitBatch, parseLsLines, waitForQuiet, drainReads, missingOverlayKeys,
	createActivityTracker, createGenerationGate, describePendingRequests,
} from './lib.mjs';

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
/* A FLOOR, not the wait itself: gives a page the same load+settle window the live gates give a full
 * navigation (spa-parity.mjs) before the adaptive wait below starts reading ubus traffic — without
 * it, a page whose lazy includes haven't even started executing yet reads as "already quiet". The
 * actual per-page wait is `waitForQuiet` below; see its doc comment for why a fixed settle alone
 * (this constant, formerly the whole wait) dropped overlay keys on a slow CI container. */
const SETTLE_MS = 1400;
/* No same-origin request in flight for this long is "this page is done making the calls it's going
 * to make" — `waitForQuiet`/`createActivityTracker` below. Hard cap per page so a page that never
 * goes quiet fails loudly instead of hanging capture. Picked to be well past a poll tick; not itself
 * measured. */
const QUIET_MS = 750;
const QUIET_TIMEOUT_MS = 30000;
/* A response body read can neither resolve nor reject (one stalled ~148 s on a stand); `drain()`
 * fails loudly at this bound instead of hanging capture — `drainReads`, lib.mjs. */
const DRAIN_TIMEOUT_MS = 15000;

const pages = JSON.parse(readFileSync(PAGES_FILE, 'utf8'));
/* Read once here (not just inside `applyOverlay` at build time) so a key this stand never actually
 * answers is a capture-time failure naming the page it stalled on, not a build-time one three steps
 * removed from the router that produced — or failed to produce — it. */
const overlay = JSON.parse(readFileSync(join(HERE, 'overlay.json'), 'utf8'));

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
	const origin = new URL(stand.base).origin;
	function isSameOrigin(url) {
		try { return new URL(url).origin === origin; } catch (e) { return false; }
	}

	const browser = await chromium.launch();

	/* Keyed by lib.mjs's requestKey: the LAST response for a given call wins, which is also what a
	 * live page would show if it made the same call twice (a poll tick, a re-render). Declared here,
	 * ahead of login, so the SAME set/file tree also catches the static assets the login page's own
	 * <head> loads (luci.js, the theme's CSS) — recorded once, not twice, if the logged-in pages
	 * below happen to load them again. */
	const rpc = {};
	const staticSeen = new Set();

	/* `page.on('response', …)` never has its handler's promise awaited by anyone — Playwright fires
	 * it and moves on — so a slow `response.body()`/`.text()` still in flight when the next `goto`
	 * or `browser.close()` runs used to fail silently ("Response body is not available for a
	 * response that was navigated", "Target page … closed") and just drop whatever it was reading.
	 * `track` files the promise here instead of awaiting it inline; `drain` below is called at every
	 * point capture.mjs is about to navigate or close, and turns a still-rejected read into a loud
	 * failure instead of a gap in the recording. */
	let pending = [];
	function track(label, promise) {
		promise.catch(() => {}); /* drain() below decides what a rejection means; this only stops
			node's unhandled-rejection warning from firing before drain gets to look at it */
		pending.push([ label, promise ]);
	}
	async function drain(phase) {
		const batch = pending;
		pending = [];
		await drainReads(batch, phase, DRAIN_TIMEOUT_MS);
	}

	async function recordStatic(response) {
		const request = response.request();
		if (request.method() !== 'GET') return;
		let url;
		try { url = new URL(response.url()); } catch (e) { return; }
		if (!url.pathname.startsWith('/luci-static/')) return;
		const rel = url.pathname.slice('/luci-static/'.length);
		if (staticSeen.has(rel)) return;
		staticSeen.add(rel);
		let body;
		try { body = await response.body(); }
		catch (e) { throw new Error(`could not read body of "${rel}": ${e.message}`); }
		writeFile(join(OUT, 'static', rel), body);
	}

	/* Unauthenticated on purpose, in its OWN context so no cookie from the logged-in session below
	 * leaks in. LuCI answers a bare GET with the login form itself — 403 + X-LuCI-Login-Required
	 * (dispatcher.uc:967) — and `page.goto` does not throw on a non-2xx status, so the raw body is
	 * there to read once the load settles. */
	const loginContext = await browser.newContext();
	await sealToRouter(loginContext, stand.base);
	const loginPage = await loginContext.newPage();
	loginPage.on('response', (response) => track(`login GET ${response.url()}`, recordStatic(response)));
	const [ loginResponse ] = await Promise.all([
		loginPage.waitForResponse((r) => r.request().resourceType() === 'document', { timeout: 30000 }),
		loginPage.goto(stand.base, { waitUntil: 'load' }),
	]);
	await loginPage.waitForTimeout(SETTLE_MS);
	await drain('login page');
	writeFile(join(OUT, 'docs', 'login.html'), await loginResponse.body());
	await loginContext.close();

	const context = await browser.newContext();
	await sealToRouter(context, stand.base);
	const page = await context.newPage();

	/* `gate` tells a stale response (one that arrived after its own page was navigated away from)
	 * from a current one; `activity` is `waitForQuiet`'s in-flight half, now tagged and read by the
	 * SAME generation (`lib.mjs`'s `createActivityTracker` doc comment) so a request the outgoing page
	 * abandons on navigation cannot hold the NEXT page's quiet window open forever. `teardown()` below
	 * (`about:blank` + `bump()` + `prune()`) runs right before each page's `goto`; `login(page, …)`'s
	 * OWN navigation runs at generation 0. Both listeners are wired BEFORE `login()` so the dashboard
	 * `login()` lands on is covered from its very first request, not just the pages this loop below
	 * explicitly asks for. */
	const gate = createGenerationGate();
	const activity = createActivityTracker();
	page.on('request', (request) => {
		gate.tag(request);
		if (isSameOrigin(request.url())) activity.start(request, gate.current());
	});
	const settleActivity = (request) => { if (isSameOrigin(request.url())) activity.finish(request); };
	page.on('requestfinished', settleActivity);
	page.on('requestfailed', settleActivity);

	/* Playwright drops `requestfinished`/`requestfailed` for a request its own page abandons on
	 * navigation, so `activity`'s in-flight set never sees one settle (root cause, `lib.mjs`'s
	 * `createActivityTracker` doc comment). `about:blank` is a navigation CDP fully waits out, unlike
	 * `goto()`'s own `load` racing a still-firing XHR, so whatever the outgoing page never finished is
	 * gone by the time the NEXT generation's quiet window starts being measured — `bump()` first so a
	 * response still arriving from the torn-down page reads as stale (`gate.isCurrent`), `prune()`
	 * after so it stops counting toward `activity.quiet()` either. */
	async function teardown() {
		await page.goto('about:blank', { waitUntil: 'load' });
		gate.bump();
		activity.prune(gate.current());
	}

	/* `ubuspath` is only known once `login()` has run (it comes off `window.L.env`); an ubus POST
	 * that lands before then (the landing page's own boot calls) is simply not matched below — the
	 * SAME calls run again, and get recorded then, the moment the loop below reloads that page for
	 * real. Not a gap: `pages.json`'s entries are always freshly navigated to, cache cleared first. */
	let ubuspath = null;
	page.on('response', (response) => {
		const request = response.request();
		/* Stale generation: its own page is gone, CDP may have already discarded this resource —
		 * skip outright rather than attempt a read that would throw (`recordStatic`, the ubus read
		 * below) over a byte range capture.mjs no longer needs and the page no longer has. */
		if (!gate.isCurrent(request)) return;
		if (request.method() !== 'GET' && request.method() !== 'POST') return;
		if (request.method() === 'GET') { track(`GET ${response.url()}`, recordStatic(response)); return; }
		if (!ubuspath) return;

		let url;
		try { url = new URL(response.url()); } catch (e) { return; }
		if (url.pathname !== ubuspath) return;

		track(`ubus POST ${response.url()}`, (async () => {
			const reqEntries = splitBatch(request.postData() || '{}');
			let text;
			try { text = await response.text(); }
			catch (e) { throw new Error(`could not read ubus response body: ${e.message}`); }
			let resBody;
			try { resBody = JSON.parse(text); }
			catch (e) { return; /* not a JSON-RPC exchange, or the router answered with something else */ }
			const resEntries = Array.isArray(resBody) ? resBody : [ resBody ];
			reqEntries.forEach(({ key }, i) => {
				if (resEntries[i] !== undefined) rpc[key] = resEntries[i];
			});
		})());
	});

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
	ubuspath = await page.evaluate(() => window.L.env.ubuspath);

	for (const p of pages) {
		const url = `${stand.base}/${p}`;
		/* `luci.getFeatures` and the boot `list()` probe cache themselves in sessionStorage on the
		 * FIRST real call (luci.js:1882 getLocalData, :2604 probeSystemFeatures) — this loop reuses
		 * one `page` across every URL, so without this every page after the first silently answers
		 * from cache and this recorder's response listener never sees the call to save. */
		await page.evaluate(() => window.sessionStorage.clear());
		/* Tears down the previous page (on the FIRST iteration, whatever `login()`'s own landing
		 * dashboard was still doing) and starts THIS page's generation — a response or an in-flight
		 * request tagged before this point is the previous page's and is dropped by the `response`
		 * listener above / no longer counted by `activity.quiet()` (`teardown()`). */
		await teardown();
		const [ response ] = await Promise.all([
			page.waitForResponse((r) => r.url() === url && r.request().resourceType() === 'document', { timeout: 30000 }),
			page.goto(url, { waitUntil: 'load' }),
		]);
		await page.waitForTimeout(SETTLE_MS);
		try {
			/* Quiet = no same-origin request in flight AND QUIET_MS idle since the last one started or
			 * finished — not "no ubus POST": a still-loading lazy include
			 * (view/status/include/*.js) or a slow ubus reply both hold this open exactly like a POST
			 * would (`createActivityTracker`, lib.mjs). `L.Poll`'s own repeat calls still let this
			 * return, at the first gap between ticks wider than QUIET_MS; QUIET_TIMEOUT_MS is the hard
			 * cap for the page whose poll interval never opens one. */
			await waitForQuiet({
				isQuiet: () => activity.quiet(QUIET_MS, gate.current()),
				quietMs: QUIET_MS,
				timeoutMs: QUIET_TIMEOUT_MS,
				describe: () => {
					const pending = activity.pendingEntries(gate.current());
					const list = describePendingRequests(pending.map((r) =>
						({ method: r.method(), url: r.url(), postData: r.postData() })));
					return `${pending.length} request(s) still in flight: ${list}`;
				},
			});
		} catch (e) {
			const missing = missingOverlayKeys(rpc, overlay);
			throw new Error(`playground/capture: page "${p}" ${e.message}; overlay key(s) still `
				+ `missing: ${missing.length ? missing.join(', ') : 'none'}`);
		}
		await drain(`page "${p}"`);
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
	await drain('icons');

	await browser.close();

	/* The same check `applyOverlay` (build.mjs) runs, moved here: a key this recording never got is
	 * now a capture-time failure at the page that should have produced it, not a build-time one the
	 * quiet-window wait above should already have prevented — this is the backstop for a key that
	 * isn't tied to ubus traffic on any recorded page at all (a stale overlay entry). */
	const missing = missingOverlayKeys(rpc, overlay);
	if (missing.length)
		throw new Error(`playground/capture: recording is missing overlay key(s) the build needs: ${missing.join(', ')}`);

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
