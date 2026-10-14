#!/usr/bin/env node
/* Turns a `capture.mjs` recording into a static site under `--base`. Pure and deterministic: no
 * router, no browser, the same recording always gives the same tree. Per page: the recorded
 * document with path/env rewritten (`lib.mjs`) so links and the `new LuCI({...})` boot object
 * resolve under `--base`, tokens/host scrubbed (hostname swapped to `overlay.json`'s
 * `system.board`), a recording banner, and `pg-data.js` + `replay.js` spliced in before the
 * `luci.js` tag. `overlay.json` corrects ubus answers a container cannot give honestly;
 * `menu.json` is pruned to the recorded pages. `docs/login.html` goes through the same
 * `buildPage()` to `BASE/cgi-bin/luci/`; `admin/logout/index.html` is synthesised, clearing the
 * playground's login flag. Root `--base/index.html` redirects to the login.
 *
 *   node tools/playground/build.mjs [--recording DIR] [--out DIR] [--base /path]
 */
import {
	mkdirSync, readFileSync, readdirSync, existsSync, copyFileSync, statSync,
} from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import {
	rewriteBase, rewriteEnv, scrubTokens, scrubHost, rewriteHostnameInData,
	rewriteLiteral, applyOverlay, pruneMenu, jsonForScript, scrubDataDeep, guardNoSecrets,
	stableStringify, ubusKey, stripBase, isSafeReturn, requestKey, mapStrings,
} from './lib.mjs';
import { ROOT } from '../lib/root.mjs';
import { writeFile } from '../lib/util.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const { values: FLAGS } = parseArgs({ options: {
	help: { type: 'boolean', default: false },
	recording: { type: 'string', default: join(ROOT, '..', 'tmp/playground/recording') },
	out: { type: 'string', default: join(ROOT, '..', 'tmp/playground/out') },
	base: { type: 'string', default: '/luci-theme-footstrap/playground' },
} });

if (FLAGS.help) {
	console.log('Usage: node tools/playground/build.mjs [--recording DIR] [--out DIR] [--base /path]');
	process.exit(0);
}

const RECORDING = FLAGS.recording;
const OUT = FLAGS.out;
const BASE = FLAGS.base;

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

/* Every regular file under `dir`, as paths relative to it — `readdirSync(recursive)` also yields
 * the directories themselves, and a directory can't be `copyFileSync`d. */
function filesUnder(dir) {
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { recursive: true })
		.map((f) => join(dir, f))
		.filter((f) => statSync(f).isFile())
		.map((f) => f.slice(dir.length + 1));
}

/* One `pg-data.js` serves every page (inlined per page it was ~40 % of the tarball), as a sync
 * `<script src>` because a fetch in replay.js would race the first intercepted XHR. `jsonForScript`
 * stops a `</script` or `<!--` in a value truncating it; `__pgBase` lets replay.js undo `rewriteEnv`.
 * `rpc`/`menu` arrive through `scrubDataDeep` (main()): `scrubTokens`/`scrubHost` only touch the HTML.
 * lib.mjs functions are written in as source so replay.js shares one global scope with them;
 * `mapStrings` is there because `stripBase` calls it. */
function buildData(rpc, menu, base, overviewUrl) {
	const shared = [ stableStringify, ubusKey, mapStrings, stripBase, requestKey, isSafeReturn ]
		.map((fn) => fn.toString()).join(';');
	return `${shared};window.__pgRPC=${jsonForScript(rpc)};window.__pgMenu=${jsonForScript(menu)};`
		+ `window.__pgBase=${jsonForScript(base)};window.__pgOverview=${jsonForScript(overviewUrl)};`;
}

/* `page` is replay.js's only way to tell the login document from every other one: it runs before
 * the DOM exists, so it cannot sniff for `form.fs-login`. Only the login page sets it, inline;
 * `overviewUrl` (in pg-data.js) is the login handler's fallback target when there is no (or no
 * SAFE — `lib.mjs`'s `isSafeReturn`) return path waiting in `sessionStorage`. */
function buildInject(dataSrc, replaySrc, { page }) {
	const pageTag = page === 'login' ? `<script>window.__pgPage=${jsonForScript(page)}</script>` : '';
	return `<script src="${dataSrc}"></script>${pageTag}<script src="${replaySrc}"></script>`;
}

/* header.ut's inline notices block `empty_password` (`getspnam('root').pwdp === ''`), baked
 * verbatim on every page owlab's containers all hit (root carries no password there). No ubus
 * overlay entry reaches it, so it is deleted by literal match, the same way the recorded
 * hostname below is corrected; a router-like recording that already has a password set simply
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
	html = rewriteLiteral(html, hostnameFrom, hostnameTo);
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
	 * `buildData` so the SAME pair also corrects the ubus data that patch reaches (uci's own
	 * `system` config, hosthints, ps — `rewriteHostnameInData`, lib.mjs). */
	const hostnameFrom = rpcRecorded['system.board({})']?.result?.[1]?.hostname;
	const hostnameTo = rpc['system.board({})']?.result?.[1]?.hostname;
	const rpcInjected = rewriteHostnameInData(rpc, hostnameFrom, hostnameTo);

	/* footer.ut's `version.luciname` is the same `getVersion().branch`
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
	writeFile(join(OUT, 'pg-data.js'), buildData(rpcScrubbed, menuScrubbed, BASE, overviewUrl));
	const inject = buildInject(`${BASE}/pg-data.js`, replaySrc, { page: 'view' });

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
	const loginInject = buildInject(`${BASE}/pg-data.js`, replaySrc, { page: 'login' });
	const loginHtml = buildPage(loginRaw, { base: BASE, meta, inject: loginInject, hostnameFrom, hostnameTo, luciFrom, luciTo });
	writeFile(join(OUT, 'cgi-bin/luci/index.html'), loginHtml);

	/* Synthesised, not recorded: a static site has nothing of its own to answer this GET with, only
	 * a page that undoes what the login submit handler in replay.js did. `a.fs-logout`'s own href
	 * (header.ut, `build_url('admin/logout')`) already resolves here once `rewriteBase`
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
	 * `buildData` — the one check downstream of every scrub call site at once, so a future call
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
