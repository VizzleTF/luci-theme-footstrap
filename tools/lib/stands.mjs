/* One place that knows how to reach a running router, log into LuCI and enumerate its pages.
 *
 * The routers are owlab's — `owlab status -json` names each one and the port it answers on, so
 * nothing here hard-codes a port or a container name. Nothing here boots anything either: a tool
 * that starts and stops containers by itself is a tool nobody runs locally. */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpRoot } from './tmp-root.mjs';

/* `owlab status -json`'s routers, or an empty array on any failure (owlab absent, bad JSON). */
function owlabRouters() {
	let out;
	try {
		out = execFileSync('owlab', [ 'status', '-json' ], { encoding: 'utf8', stdio: [ 'ignore', 'pipe', 'ignore' ] });
	} catch (e) { return []; }
	try { return JSON.parse(out).routers || []; } catch (e) { return []; }
}

/* The shape a caller reads a router through. */
const toStand = (r) => ({
	id: r.id,
	base: `http://localhost:${r.http_port}/cgi-bin/luci`,
	release: r.release,
	distro: r.distro,
	pkg: r.package_manager,
});

/* The running owlab OpenWrt routers `only` names (comma-separated), or every running one without it;
 * an empty array when owlab is absent. ImmortalWrt is not a target. */
export function stands(only) {
	const routers = owlabRouters();
	const wanted = (only || '').split(',').map((s) => s.trim()).filter(Boolean);
	const foreign = routers.filter((r) => r.distro !== 'openwrt' && wanted.includes(r.id));
	if (foreign.length) {
		console.error(`${foreign.map((r) => r.id).join(', ')}: not an OpenWrt router (tools/lib/stands.mjs).`);
		process.exit(2);
	}
	const running = routers
		.filter((r) => r.state === 'running' && r.http_port && r.distro === 'openwrt')
		.map(toStand);
	if (wanted.length) {
		const missing = wanted.filter((id) => !running.some((r) => r.id === id));
		if (missing.length) {
			console.error(`${missing.join(', ')}: not running (owlab up).`);
			process.exit(2);
		}
		return running.filter((r) => wanted.includes(r.id));
	}
	return running;
}

/* Cut the browser off from everything except the router under test: a fetch to the open internet
 * is somebody else's code and only adds noise. The app
 * stays on the stands (its Ace stylesheets can invert the cascade layer order, owlab.yaml); the
 * request never leaves. `abort`, not a fake 200, which the page would render. The router's origin
 * and data:/blob: pass. */
export async function sealToRouter(ctx, base) {
	const host = new URL(base).host;
	/* A predicate, never a catch-all glob: a glob sends every request, the router's own included,
	 * through a JS callback (17 minutes past CI's 45-minute limit; docs/development.md). */
	await ctx.route(
		(url) => url.host !== host && url.protocol !== 'data:' && url.protocol !== 'blob:',
		(route) => route.abort());
}

/* A stand that cannot serve LuCI at all, as opposed to a theme that misrenders it: the caller's
 * own verdict is "nothing was measured here", never a finding. */
export class StandDown extends Error {}

/* Null when the answer is a LuCI page — the login form, or an authenticated page that loads luci.js —
 * else the sentence naming what the stand said instead. A snapshot stand whose ucode and
 * ucode-mod-html disagreed on libucode answered every request 502 "Bad Gateway", and every check
 * reported "L is not defined" as a defect of the theme. */
function loginFault(status, html) {
	if (status < 500 && /luci_password|luci\.js|new LuCI\(/.test(html)) return null;
	const line = html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '').replace(/<[^>]*>/g, '\n')
		.split('\n').map((l) => l.trim()).find(Boolean) || 'empty body';
	return `LuCI answered ${status} (${line.slice(0, 120)}) — the stand, not the theme`;
}

/* What Playwright throws when nothing answers on the port, as measured against a closed port and a
 * socket accepted then dropped: Chromium names the net error, Firefox the NS_ERROR, WebKit the
 * socket's own words. A navigation that waits out its timeout is the same stand. */
const NO_ANSWER = /net::ERR_(CONNECTION_|EMPTY_RESPONSE|SOCKET_NOT_CONNECTED)|NS_ERROR_(CONNECTION_REFUSED|NET_)|Could not connect|Connection (terminated|reset)/;

/* The StandDown for such a navigation error, else the error itself: anything else is a bug in the
 * caller and keeps its stack. Use as `.catch((e) => { throw unreached(e, id, base); })`. The cause
 * rides in the sentence: a reset socket and a hung uhttpd are not a closed port, and the reader
 * would go looking for a free one. */
const cause = (e) => String(e.message).split('\n')[0].replace(/^\w+\.\w+: | at https?:\/\/\S+$/g, '').trim();
export const unreached = (e, id, base) => (e && (e.name === 'TimeoutError' || NO_ANSWER.test(String(e.message))))
	? new StandDown(`${id}: ${base} did not answer (${cause(e)}) — the stand, not the theme`) : e;

/* Has the landing page's LuCI answered `L.require`? Runs INSIDE the page via waitForFunction, which
 * waits out the returned promise. */
const LANDED = () => (window.L && typeof window.L.require === 'function')
	? window.L.require('ui').then(() => true) : false;

/* LuCI answers an unauthenticated request with the login form, not a 403 page — so every caller
 * has to log in before it can measure anything. owlab's routers are root with an empty password
 * (`owlab status` prints it); a hardware router is not what this runs against. `id` names the
 * router in the error; the host stands in for it when a caller has only a base URL.
 *
 * It returns once the landing has answered `L.require`, not at its domcontentloaded: the first goto
 * after a login from a landing still loading failed in WebKit 5 of 168 times (3.0%) against 0 of 840
 * later ones. A stand whose landing never answers is bounded at 20 s and is a StandDown. */
export async function login(page, base, id = new URL(base).host) {
	const res = await page.goto(base, { waitUntil: 'domcontentloaded' })
		.catch((e) => { throw unreached(e, id, base); });
	const fault = loginFault(res ? res.status() : 0, await page.content());
	if (fault) throw new StandDown(`${id}: ${fault}`);
	if (await page.$('input[name="luci_password"]')) {
		await page.fill('input[name="luci_username"]', 'root');
		await Promise.all([
			page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
			page.press('input[name="luci_password"]', 'Enter'),
		]);
	}
	await page.waitForFunction(LANDED, null, { timeout: 20000 })
		.catch((e) => { throw unreached(e, id, base); });
}

/* Every leaf of the router's own menu tree, as LuCI resolves it, not a list kept in the repo that
 * goes stale when an app is installed. `L.ui.menu.load()` returns the tree rooted at `admin`, so
 * the walk starts with an empty path. */
export async function menuPaths(page) {
	/* `L.ui` exists only once something required ui.js, which differs by release line (24.10
	 * crashed with "Cannot read properties of undefined (reading 'menu')"): wait, then require it. */
	await page.waitForFunction(() => window.L && typeof window.L.require === 'function', null, { timeout: 20000 });
	/* Only leaves that render and are titled (`view`, `template`, `cbi`): 105 of 169 leaves with
	 * openclash and justclash are `call` RPC endpoints, which paint nothing. */
	return page.evaluate(async () => {
		const ui = await L.require('ui');
		const tree = await ui.menu.load();
		const RENDERS = { view: 1, template: 1, cbi: 1 };
		const out = [];
		const walk = (node, path) => {
			for (const name of Object.keys(node.children || {})) {
				const child = node.children[name];
				const p = path.concat(name);
				if (child.children && Object.keys(child.children).length) { walk(child, p); continue; }
				const type = (child.action && child.action.type) || '';
				if (RENDERS[type] && child.title) out.push('/' + p.join('/'));
			}
		};
		walk(tree, []);
		return out;
	});
}

/* Two runs on one stand invent findings: a second sweep 37 s behind the first read 12 "the reader
 * drifted" cells a lone run never shows. Use of a stand is therefore an flock on
 * ../tmp/stands-<id>.lock, one per stand in sorted order, held until this process dies (a child
 * `flock` kept alive by its stdin pipe, so SIGKILL frees it). `flock` is probed synchronously
 * first, and the wait is bounded, 30 min by default (`STANDS_LOCK_TIMEOUT_MS`).
 * docs/development.md, "The stand's own traps". */
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const lockDir = tmpRoot() + '/';

/* Take one stand's lock and hold it until this process dies; the wait is bounded (see above). The
 * child writes `ok` once it holds the flock, or `busy` when `flock -w` gave up. */
function take(id, name) {
	const file = `${lockDir}stands-${id}.lock`;
	const limit = Number(process.env.STANDS_LOCK_TIMEOUT_MS) || 30 * 60 * 1000;
	const ack = `${file}.${process.pid}.ack`;
	const fd = openSync(ack, 'w');
	const child = spawn('sh', [ '-c', `flock -w ${Math.ceil(limit / 1000)} ` + '-x "$2" sh -c \'echo "$1" >"$2"; echo ok; cat >/dev/null\' sh "$1" "$2" || echo busy',
		'sh', `${name} pid ${process.pid}`, file ], { stdio: [ 'pipe', fd, 'inherit' ] });
	child.unref();
	child.stdin.unref();
	closeSync(fd);
	const t0 = Date.now();
	let said = false;
	for (;;) {
		const got = readFileSync(ack, 'utf8');
		if (got.includes('ok') || got.includes('busy')) break;
		let by = '';
		if (Date.now() - t0 > 500) {
			try { by = readFileSync(file, 'utf8').trim(); } catch { /* lock file not written yet */ }
		}
		if (!said && Date.now() - t0 > 500) {
			console.error(`${name}: stand ${id} is in use (${by || 'holder unknown'}); waiting for ${file}`);
			said = true;
		}
		sleep(100);
	}
	const held = readFileSync(ack, 'utf8').includes('ok');
	unlinkSync(ack);
	/* flock -w gives up by itself, so no waiting flock outlives this process to write a dead pid. */
	if (!held && Date.now() - t0 >= limit - 1000) {
		let by = '';
		try { by = readFileSync(file, 'utf8').trim(); } catch { /* lock file not written yet */ }
		console.error(`${name}: stand ${id} still held by ${by || 'an unknown holder'} after ${Math.round(limit / 1000)} s; gave up on ${file}`);
		process.exit(2);
	}
	return held;
}

function lockStands(ids, name) {
	mkdirSync(lockDir, { recursive: true });
	if (spawnSync('flock', [ '--version' ], { stdio: 'ignore' }).error) {
		console.error(`${name}: cannot run flock; util-linux is required`);
		process.exit(2);
	}
	for (const id of [ ...ids ].sort()) {
		/* `take` exits on a timeout, so a false here is flock itself failing. */
		if (take(id, name)) continue;
		console.error(`${name}: could not take the lock for stand ${id} (flock failed on ${lockDir}); not running unlocked`);
		process.exit(2);
	}
}

/* No stand, no verdict — and a run that quietly reports success on zero routers is worse than one
 * that fails, because it looks the same as a clean run in a log. */
export function requireStands(list, name) {
	if (!list.length) {
		console.error(`${name}: no owlab router is running, so nothing was checked.`);
		console.error('Start one with `owlab up` (see docs/development.md) and run this again.');
		process.exit(2);
	}
	lockStands(list.map((s) => s.id), name);
	return list;
}
