#!/usr/bin/env node
/* Turns a `capture.mjs` recording into a static site under `--base`, servable by any web server
 * (verify.mjs uses its own). Pure and deterministic — no router, no browser, same recording always
 * produces the same tree — so this is safe to run and re-run offline against a recording that was
 * made once, on a tag.
 *
 * Per page: the recorded document, path/env rewritten (`lib.mjs`) so links and the `new LuCI({...})`
 * boot object resolve under `--base`, tokens/host/hostname scrubbed (the last swapped to whatever
 * `overlay.json` gave `system.board`, since that is baked into the page as plain text), a recording
 * banner, and `replay.js` (plus the recording's data, inlined so it is there before `luci.js`'s
 * first XHR) spliced in right before the `luci.js` tag. `overlay.json` corrects a few ubus answers
 * a container cannot give honestly; `menu.json` is pruned to the recorded pages so the built site
 * links nowhere it cannot answer.
 *
 * `docs/login.html` (`capture.mjs`) goes through the SAME `buildPage()` and lands at
 * `BASE/cgi-bin/luci/` — `build_url()`'s own answer, which is where LuCI already sends the reader
 * after a logout. `BASE/cgi-bin/luci/admin/logout/index.html` is synthesised, not recorded: the
 * router has nothing to answer that GET honestly in a static site, so it is a page of our own that
 * clears the playground's login flag and sends the reader back there. Root `--base/index.html`
 * redirects to the login, not straight to Overview — a fresh session has not "logged in" yet.
 *
 *   node tools/playground/build.mjs [--recording DIR] [--out DIR] [--base /path]
 */
import {
	mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, copyFileSync, statSync,
} from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
	rewriteBase, rewriteEnv, scrubTokens, scrubHost, rewriteHostname, rewriteHostnameInData,
	rewriteLiteral, applyOverlay, pruneMenu, jsonForScript, scrubDataDeep, guardNoSecrets,
} from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

const arg = (name, dflt) => {
	const i = process.argv.indexOf(`--${name}`);
	return i === -1 ? dflt : process.argv[i + 1];
};

if (process.argv.includes('--help')) {
	console.log('Usage: node tools/playground/build.mjs [--recording DIR] [--out DIR] [--base /path]');
	process.exit(0);
}

const RECORDING = arg('recording', join(ROOT, '..', 'tmp/playground/recording'));
const OUT = arg('out', join(ROOT, '..', 'tmp/playground/out'));
const BASE = arg('base', '/luci-theme-footstrap/playground');

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

function writeFile(path, body) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, body);
}

/* Every regular file under `dir`, as paths relative to it — `readdirSync(recursive)` also yields
 * the directories themselves, and a directory can't be `copyFileSync`d. */
function filesUnder(dir) {
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { recursive: true })
		.map((f) => join(dir, f))
		.filter((f) => statSync(f).isFile())
		.map((f) => f.slice(dir.length + 1));
}

/* One recording answers every page: the ubus keys and the menu it needs do not depend on which
 * page is asking, so the same inlined blob is correct for all of them. Inlined rather than fetched
 * by replay.js itself — a `fetch()` there would race the FIRST intercepted XHR, which can fire
 * within the same tick `luci.js` starts evaluating. `jsonForScript` keeps a `</script` or `<!--`
 * inside a recorded value from truncating this element. `__pgBase` lets replay.js undo `rewriteEnv`
 * on a path-like ubus arg before it looks the call up (lib.mjs's `stripBase`). `rpc`/`menu` arrive
 * already run through `scrubDataDeep` (main()) — `buildPage`'s `scrubTokens`/`scrubHost` only ever
 * touch the HTML document, never this inlined JSON, which is a separate byte stream a token or the
 * stand's host could still be sitting in.
 *
 * `page` is replay.js's only way to tell the login document from every other one: it runs before
 * the DOM exists, so it cannot sniff for `form.fs-login`. `overviewUrl` is the login handler's
 * fallback target when there is no (or no SAFE — `lib.mjs`'s `isSafeReturn`) return path waiting
 * in `sessionStorage`. */
function buildInject(rpc, menu, replaySrc, base, { page, overviewUrl }) {
	const data = `window.__pgRPC=${jsonForScript(rpc)};window.__pgMenu=${jsonForScript(menu)};`
		+ `window.__pgBase=${jsonForScript(base)};window.__pgPage=${jsonForScript(page)};`
		+ `window.__pgOverview=${jsonForScript(overviewUrl)};`;
	return `<script>${data}</script><script src="${replaySrc}"></script>`;
}

/* notices.ut's `empty_password` block (header.ut:26 — `getspnam('root').pwdp === ''`), baked
 * verbatim on every page owlab's containers all hit (root carries no password there). No ubus
 * overlay entry reaches it, so it is deleted by literal match, the same way `rewriteHostname`
 * corrects a different baked value; a router-like recording that already has a password set simply
 * never contains this text, so the swap is a harmless no-op then. */
const PASSWORD_NOTICE = '<div class="alert-message warning">\n\t<h2>No password set!</h2>\n\t'
	+ '<p>There is no password set on this router. Please configure a root password to protect the '
	+ 'web interface.</p>\n\t  <div class="right"><a class="btn" href="/cgi-bin/luci/admin/system/admin">'
	+ 'Go to password configuration...</a></div>\n</div>\n\n\n';

function banner(meta) {
	const distro = [ meta.distro, meta.release ].filter(Boolean).join(' ') || 'OpenWrt';
	const theme = meta.theme_version || 'unknown';
	return `<div id="pg-banner" style="position:sticky;top:0;z-index:9999;background:#222;color:#fff;`
		+ `font:12px/1.6 sans-serif;padding:4px 12px;text-align:center">`
		+ `Recorded from ${distro} / footstrap v${theme}</div>`;
}

function buildPage(rawHtml, { base, meta, inject, hostnameFrom, hostnameTo, luciFrom, luciTo }) {
	/* Ahead of `rewriteBase`: the notice's own `href="/cgi-bin/…"` is still the RAW recorded prefix
	 * here, which is what `PASSWORD_NOTICE` was captured against. */
	let html = rewriteLiteral(rawHtml, PASSWORD_NOTICE, '');
	html = rewriteLiteral(html, luciFrom, luciTo);
	html = rewriteBase(html, base);
	html = rewriteEnv(html, base);
	html = scrubTokens(html);
	html = scrubHost(html, meta.host);
	html = rewriteHostname(html, hostnameFrom, hostnameTo);
	html = html.replace(/(<script[^>]*\bsrc="[^"]*\/luci\.js[^"]*"[^>]*><\/script>)/, `${inject}$1`);
	html = html.replace(/(<body[^>]*>)/, `$1${banner(meta)}`);
	return html;
}

function main() {
	const meta = readJson(join(RECORDING, 'meta.json'));
	const menuRecorded = readJson(join(RECORDING, 'menu.json'));
	const rpcRecorded = readJson(join(RECORDING, 'rpc.json'));
	const overlay = readJson(join(HERE, 'overlay.json'));
	const pages = meta.pages || readJson(join(HERE, 'pages.json'));

	/* Old recordings (before capture.mjs saved the login form) have no `docs/login.html` — loud and
	 * specific, before this function writes anything, rather than shipping a playground with no
	 * login gate: CI always captures fresh, so the only way to hit this is a stale `--recording`. */
	const loginPath = join(RECORDING, 'docs', 'login.html');
	if (!existsSync(loginPath)) {
		throw new Error(`playground/build: ${RECORDING} has no docs/login.html — re-run `
			+ 'playground:capture (an old recording predates the playground login page).');
	}

	const rpc = applyOverlay(rpcRecorded, overlay);
	/* The recorded tree is rooted above `admin`, not at it (`pruneMenu`'s own doc comment) — pages
	 * already carry that segment, so it must stay on the path pruneMenu is asked to keep. */
	const menu = pruneMenu(menuRecorded, pages);

	/* Baked into every recorded document as plain text at capture time (head.ut's `<title>`,
	 * header.ut's `.fs-title-main`) — the overlay's `system.board({})` patch only reaches the
	 * client-side ubus replay, never these bytes, so the swap is done here instead. Computed before
	 * `buildInject` so the SAME pair also corrects the ubus data that patch reaches (uci's own
	 * `system` config, hosthints, ps — `rewriteHostnameInData`, lib.mjs). */
	const hostnameFrom = rpcRecorded['system.board({})']?.result?.[1]?.hostname;
	const hostnameTo = rpc['system.board({})']?.result?.[1]?.hostname;
	const rpcInjected = rewriteHostnameInData(rpc, hostnameFrom, hostnameTo);

	/* footer.ut's `version.luciname` (partials/footer.ut:20) is the same `getVersion().branch`
	 * string baked server-side instead of fetched — same pair, same reason as the hostname swap
	 * above, just against the overlay's `luci.getVersion({})` entry instead of `system.board({})`. */
	const luciFrom = rpcRecorded['luci.getVersion({})']?.result?.[1]?.branch;
	const luciTo = rpc['luci.getVersion({})']?.result?.[1]?.branch;

	const overview = pages.includes('admin/status/overview') ? 'admin/status/overview' : pages[0];
	const overviewUrl = `${BASE}/cgi-bin/luci/${overview}`;
	const loginUrl = `${BASE}/cgi-bin/luci/`;

	const replayDest = join(OUT, 'replay.js');
	writeFile(replayDest, readFileSync(join(HERE, 'replay.js')));
	const replaySrc = `${BASE}/replay.js`;
	const rpcScrubbed = scrubDataDeep(rpcInjected, meta.host);
	const menuScrubbed = scrubDataDeep(menu, meta.host);
	const inject = buildInject(rpcScrubbed, menuScrubbed, replaySrc, BASE, { page: 'view', overviewUrl });

	for (const p of pages) {
		const raw = readFileSync(join(RECORDING, 'docs', `${p}.html`), 'utf8');
		const html = buildPage(raw, { base: BASE, meta, inject, hostnameFrom, hostnameTo, luciFrom, luciTo });
		writeFile(join(OUT, 'cgi-bin/luci', p, 'index.html'), html);
	}

	for (const rel of filesUnder(join(RECORDING, 'static'))) {
		const dest = join(OUT, 'luci-static', rel);
		mkdirSync(dirname(dest), { recursive: true });
		copyFileSync(join(RECORDING, 'static', rel), dest);
	}

	const loginRaw = readFileSync(loginPath, 'utf8');
	const loginInject = buildInject(rpcScrubbed, menuScrubbed, replaySrc, BASE, { page: 'login', overviewUrl });
	const loginHtml = buildPage(loginRaw, { base: BASE, meta, inject: loginInject, hostnameFrom, hostnameTo, luciFrom, luciTo });
	writeFile(join(OUT, 'cgi-bin/luci/index.html'), loginHtml);

	/* Synthesised, not recorded: a static site has nothing of its own to answer this GET with, only
	 * a page that undoes what the login submit handler in replay.js did. `a.fs-logout`'s own href
	 * (partials/logout.ut, `build_url('admin/logout')`) already resolves here once `rewriteBase`
	 * has run on every OTHER page, so no page needs to name this URL specially to reach it. */
	writeFile(join(OUT, 'cgi-bin/luci/admin/logout/index.html'),
		'<!doctype html><title>Logging out…</title>'
		+ `<script>sessionStorage.removeItem('fs-pg-auth');location.replace(${JSON.stringify(loginUrl)});</script>`
		+ `<p>Logged out. <a href="${loginUrl}">Continue</a>.</p>`);

	writeFile(join(OUT, 'index.html'),
		`<!doctype html><meta http-equiv="refresh" content="0; url=${loginUrl}">`
		+ `<a href="${loginUrl}">Continue</a>`);

	writeFile(join(OUT, '404.html'),
		'<!doctype html><title>Not recorded</title>'
		+ `<p>This page was not part of the playground recording. <a href="${BASE}/">Back to the playground</a>.</p>`);

	/* Fail-closed, over the bytes actually WRITTEN rather than the values passed to `buildPage`/
	 * `buildInject` — the one check downstream of every scrub call site at once, so a future call
	 * site that forgets to scrub fails the build instead of shipping to GitHub Pages. `.woff2`/
	 * `.png`/… are skipped: recorded static assets, never where a token or the stand's host sits. */
	const TEXT_EXT = new Set([ '.html', '.js', '.json' ]);
	const written = filesUnder(OUT)
		.filter((rel) => TEXT_EXT.has(extname(rel)))
		.map((rel) => [ rel, readFileSync(join(OUT, rel), 'utf8') ]);
	guardNoSecrets(written, meta.host);

	const tarPath = join(dirname(OUT), 'playground.tar.gz');
	execFileSync('tar', [ '-czf', tarPath, '-C', OUT, '.' ]);

	console.log(`playground/build: wrote ${pages.length} page(s) to ${OUT}, packed ${tarPath}`);
}

main();
