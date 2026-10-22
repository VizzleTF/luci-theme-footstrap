/* The live half of the gates: one place that knows how to reach a running router, log into LuCI and
 * enumerate its pages.
 *
 * Every static gate here measures a FILE. The bugs that reached users measured a PAGE — a column
 * shredded to one character per line (#11), a submenu title clipped (#22), a doubled scrollbar in
 * Firefox (#12), a third-party app's tabs laid out wrong (#36, #33, #8), a client navigation that
 * painted less than a full load (upstream review). None can be seen in a stylesheet; all are one
 * query away on a live page.
 *
 * The routers are owlab's — `owlab status -json` names each one and the port it answers on, so
 * nothing here hard-codes a port or a container name. Nothing here boots anything either: a gate
 * that starts and stops containers by itself is a gate nobody runs locally. */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpRoot } from './tmp-root.mjs';

/* The routers a gate runs on by default: the three OpenWrt lines the theme supports (apk on 25.12+,
 * opkg on 24.10, and the snapshot box, which tracks luci-base's master). `--all` widens to every
 * running OpenWrt router (the twins); a gate that takes `--only` must honour `--all` too.
 * ImmortalWrt is not a gate target: a running `imm*` router is ignored and `--only imm2512` is
 * refused (its two legs gave 1685 unreadable `noname` findings of their own app set at 0.14.13). */
export const CORE = [ 'owrt2512', 'owrt2410', 'owrtsnap' ];

/* The core stand an owlab twin (`owrt2512b`, `owrt2512d`) shares its install and baseline with;
 * any other id maps to itself. A twin booted from the same image finds the core's findings. */
export const coreId = (id) => CORE.find((c) => id === c || (id.startsWith(c) && /^[bd]$/.test(id.slice(c.length)))) ?? id;

/* Has the view actually rendered, or is a live gate about to measure a blank shell? fs-overview.js
 * keeps every section hidden until network.flushCache()'s five RPCs answer; on a router that just
 * booted, one answers late enough that a fixed wait expires first. scroll-jank.mjs armed on
 * `scrollable 0` with no tables and read the page finishing its own paint mid-scroll as a
 * 4044px jump (docs/development.md, "The stand's own traps") — 4 of 16 PR runs. Scroller
 * detection matches fs-fit.js's own scroller() so every gate asks the page the same way.
 * Runs INSIDE the page via page.evaluate/waitForFunction. */
export const PAINTED = () => {
	const mc = document.getElementById('maincontent');
	const flow = mc ? getComputedStyle(mc).overflowY : '';
	const scroller = (flow === 'auto' || flow === 'scroll') ? mc : null;
	const scrollable = scroller ? scroller.scrollHeight - scroller.clientHeight
		: document.documentElement.scrollHeight - window.innerHeight;
	const rendered = [ ...document.querySelectorAll('#view .cbi-section, #view .table') ]
		.some((el) => el.offsetParent !== null);
	return rendered && scrollable > 0;
};

/* Bounded wait for PAINTED, true/false rather than a throw: a page still unpainted at the deadline
 * is its own finding ("page not painted, run proves nothing"), not a script failure. */
export async function waitForPaint(page, timeout) {
	try { await page.waitForFunction(PAINTED, { timeout }); return true; }
	catch (e) { return false; }
}

/* `stands()` and `pairStands()` both used to shell out to `owlab status -json` and `JSON.parse` its
 * answer themselves. One place now: an empty array on any failure (owlab absent, bad JSON) — the
 * caller decides whether that's a gate failure or a reason to skip. */
function owlabRouters() {
	let out;
	try {
		out = execFileSync('owlab', [ 'status', '-json' ], { encoding: 'utf8', stdio: [ 'ignore', 'pipe', 'ignore' ] });
	} catch (e) { return []; }
	try { return JSON.parse(out).routers || []; } catch (e) { return []; }
}

/* The shape every gate reads a router through — `stands()`'s CORE/`--all` filtering and
 * `pairStands()`'s twin lookup both produced this same object by hand. */
const toStand = (r) => ({
	id: r.id,
	base: `http://localhost:${r.http_port}/cgi-bin/luci`,
	release: r.release,
	distro: r.distro,
	pkg: r.package_manager,
});

/* Every RUNNING owlab router, newest release first, or an empty array when owlab is absent — the
 * caller decides whether that is a failure (a gate) or a reason to skip (a local convenience).
 * With no `only` and no `all`, the CORE set above; if none of it is running, everything that is,
 * with a line saying so — a gate that silently measured a different set than it claims is worse
 * than a slow one. */
export function stands(only, { all = false } = {}) {
	const routers = owlabRouters();
	const wanted = (only || '').split(',').map((s) => s.trim()).filter(Boolean);
	const foreign = routers.filter((r) => r.distro !== 'openwrt' && wanted.includes(r.id));
	if (foreign.length) {
		console.error(`${foreign.map((r) => r.id).join(', ')}: not a gate target — the gates measure OpenWrt `
			+ 'routers only (tools/lib/stands.mjs).');
		process.exit(2);
	}
	const running = routers
		.filter((r) => r.state === 'running' && r.http_port && r.distro === 'openwrt')
		.map(toStand);
	if (wanted.length) {
		/* --only names a stand that is not running: measuring the rest would pass a gate on fewer routers than asked */
		const missing = wanted.filter((id) => !running.some((r) => r.id === id));
		if (missing.length) {
			console.error(`${missing.join(', ')}: not running — --only asked for it, and a gate does not `
				+ 'measure fewer routers than it was asked to (owlab up).');
			process.exit(2);
		}
		return running.filter((r) => wanted.includes(r.id));
	}
	if (all) return running;
	const core = running.filter((r) => CORE.includes(r.id));
	if (core.length) return core;
	if (running.length)
		process.stderr.write(`(none of ${CORE.join(', ')} is running — measuring `
			+ `${running.map((r) => r.id).join(', ')} instead)\n`);
	return running;
}

/* Cut the browser off from everything except the router under test: a fetch to the open internet
 * is somebody else's code and only adds noise (docs/development.md, "The live gates"). The app
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

/* A stand that cannot serve LuCI at all, as opposed to a theme that misrenders it: the gate's
 * own verdict is "nothing was measured here", never a finding (docs/ci.md). */
export class StandDown extends Error {}

/* Null when the answer is a LuCI page — the login form, or an authenticated page that loads luci.js —
 * else the sentence naming what the stand said instead. A snapshot stand whose ucode and
 * ucode-mod-html disagreed on libucode answered every request 502 "Bad Gateway", and every gate
 * reported "L is not defined" as a defect of the theme. */
export function loginFault(status, html) {
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
 * gate and keeps its stack. Use as `.catch((e) => { throw unreached(e, id, base); })`. The cause
 * rides in the sentence: a reset socket and a hung uhttpd are not a closed port, and the reader
 * would go looking for a free one. */
const cause = (e) => String(e.message).split('\n')[0].replace(/^\w+\.\w+: | at https?:\/\/\S+$/g, '').trim();
export const unreached = (e, id, base) => (e && (e.name === 'TimeoutError' || NO_ANSWER.test(String(e.message))))
	? new StandDown(`${id}: ${base} did not answer (${cause(e)}) — the stand, not the theme`) : e;

/* Has the landing page's LuCI answered `L.require`? Runs INSIDE the page via waitForFunction, which
 * waits out the returned promise. */
const LANDED = () => (window.L && typeof window.L.require === 'function')
	? window.L.require('ui').then(() => true) : false;

/* LuCI answers an unauthenticated request with the login form, not a 403 page — so every live gate
 * has to log in before it can measure anything. owlab's routers are root with an empty password
 * (`owlab status` prints it); a hardware router is not what these gates run against. `id` names the
 * router in the error; the host stands in for it when a caller has only a base URL.
 *
 * It returns once the landing has answered `L.require`, not at its domcontentloaded: the first goto
 * after a login from a landing still loading failed in WebKit 5 of 168 times (3.0%) against 0 of 840
 * later ones, while scroll-anchor, which awaited `L.require` there before its first goto, lost 7 of
 * ~7400 (0.09%). A stand whose landing never answers is bounded at openPage's 20 s and is a StandDown. */
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

/* A single `page.goto` in CI is not reliable enough to fail a release on. Two runs an hour apart on
 * the same commit died on webkit/owrt2410 with `page.goto: Timeout 20000ms exceeded` and
 * `page.goto: WebKit encountered an internal error` — two cells out of the sweep, every other cell
 * reporting `reader moved 0px`, and the same sweep green locally over 174 runs. So: three attempts
 * before a cell is written off. scroll-jank's gotos died the same way before any measurement (4
 * CI runs since 2026-10-20), so both gates open pages through this. Each failed attempt prints one
 * stderr line, because a retry that worked left no trace and CI could not say what it had done. */
export async function openPage(page, url) {
	let last;
	for (let attempt = 1; attempt <= 3; attempt++) {
		try {
			await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
			return;
		} catch (e) {
			last = e;
			console.error(`openPage: ${page.context().browser()?.browserType().name()} ${url} attempt ${attempt}/3: ${String(e.message).split('\n')[0]}`);
			/* the WebKit process may still be dying; give it a moment rather than racing it */
			if (attempt < 3) await page.waitForTimeout(1500);
		}
	}
	throw last;
}

/* Share of attempted cells or pages under test that may go unopened before the sweep itself is the
 * problem: one flaky cell is the runner, a stand that stopped answering is not, and a run that
 * measured almost nothing must not say the reader stayed put. 2% alone rounds to zero on a small
 * sweep, so each gate names a floor, the count it tolerates whatever the share: scroll-anchor 3 of
 * ~170 cells (1.8%), scroll-jank 1 of 8 pages on a PR stand (12.5%; a floor of 3 would let both
 * processes@768 cells, the only ones holding the remedy contract, vanish unreported). */
const UNOPENED_TOLERANCE = 0.02;
export const tooManyUnopened = (unopened, attempted, floor) => unopened > Math.max(floor, attempted * UNOPENED_TOLERANCE);

/* Every leaf of the router's own menu tree, as LuCI resolves it, not a list kept in the repo that
 * goes stale when an app is installed. `L.ui.menu.load()` returns the tree rooted at `admin`, so
 * the walk starts with an empty path (docs/development.md, "The live gates"). */
export async function menuPaths(page, opts = {}) {
	/* `L.ui` exists only once something required ui.js, which differs by release line (24.10
	 * crashed with "Cannot read properties of undefined (reading 'menu')"): wait, then require it. */
	await page.waitForFunction(() => window.L && typeof window.L.require === 'function', null, { timeout: 20000 });
	/* Only leaves that render and are titled (`view`, `template`, `cbi`): 105 of 169 leaves with
	 * openclash and justclash are `call` RPC endpoints, which paint nothing. `{ all: true }` returns
	 * the raw dispatcher walk. */
	return page.evaluate(async (all) => {
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
				if (all || (RENDERS[type] && child.title)) out.push('/' + p.join('/'));
			}
		};
		walk(tree, []);
		return out;
	}, !!opts.all);
}

/* Pages a sweep must not open twice: they end the session or the router, and the second visit
 * measures a login form or a dead container. Named by path fragment, because the menu labels are
 * translated and the paths are not. */
export const DESTRUCTIVE = /\/(logout|reboot|flash|backup|shutdown)(\/|$)/;

/* The literal clone owlab boots beside `owrt2512`, `owrt2410` and `owrtsnap` (`owlab.yaml`): same
 * distro, release and package manager, its own ubus, so a sweep treats the pair as one stand with
 * twice the concurrency. Auto-paired only when the caller did not name the twin:
 * `--only owrt2512,owrt2512b` means "measure both, separately". Returns a Map keyed by the BASE
 * stand's id; a twin another process holds is left out (try-lock, never a wait); empty when owlab
 * has no `-b` set running, so a three-stand lab degrades to exactly today's behaviour. */
export function pairStands(list, name) {
	const running = owlabRouters().filter((r) => r.state === 'running' && r.http_port);
	const byId = new Map(running.map((r) => [ r.id, r ]));
	const explicit = new Set(list.map((s) => s.id));
	const pairs = new Map();
	for (const s of list) {
		const twinId = s.id + 'b';
		if (explicit.has(twinId)) continue;
		const t = byId.get(twinId);
		if (!t) continue;
		if (take(twinId, name, false)) { pairs.set(s.id, toStand(t)); continue; }
		let by = '';
		try { by = readFileSync(`${lockDir}stands-${twinId}.lock`, 'utf8').trim(); } catch { /* not written */ }
		console.error(`${name}: twin ${twinId} is in use (${by || 'holder unknown'}); measuring ${s.id} alone`);
	}
	return pairs;
}

/* Two runs on one stand invent findings: a second sweep 37 s behind the first read 12 "the reader
 * drifted" cells a lone run never shows. Use of a stand is therefore an flock on
 * ../tmp/stands-<id>.lock, one per stand in sorted order, held until this process dies (a child
 * `flock` kept alive by its stdin pipe, so SIGKILL frees it). `flock` is probed synchronously
 * first, and the wait is bounded, 30 min by default (`STANDS_LOCK_TIMEOUT_MS`).
 * tools/ci-local.sh hands its locks down through `STANDS_LOCK_HELD`/`STANDS_LOCK_PID`, checked by
 * `heldBy()`. docs/development.md, "The stand's own traps". */
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/* True only when `env` names a live ci-local that holds `file` for stand `id`. Exported for the
 * unit test; `flock -n` exits 1 only on contention, so any other failure reads as "not held". */
export function heldBy(id, file, env = process.env) {
	const pid = Number(env.STANDS_LOCK_PID);
	if (!Number.isInteger(pid) || pid < 1) return false;
	if (!(env.STANDS_LOCK_HELD || '').split(' ').includes(id)) return false;
	try { process.kill(pid, 0); } catch (e) { if (e.code !== 'EPERM') return false; }
	try { if (readFileSync(file, 'utf8').trim() !== `ci-local pid ${pid}`) return false; } catch { return false; }
	return spawnSync('flock', [ '-n', file, 'true' ], { stdio: 'ignore' }).status === 1;
}

const lockDir = tmpRoot() + '/';

/* Take one stand's lock and hold it until this process dies. `wait` blocks (bounded, see above); a
 * try-lock (wait=false) answers `busy` instead and returns false, so the optional twin never stalls
 * a run. The child writes `ok` once it holds the flock, or `busy` when `flock -n` lost. */
function take(id, name, wait) {
	const file = `${lockDir}stands-${id}.lock`;
	if (heldBy(id, file)) return true;
	const limit = Number(process.env.STANDS_LOCK_TIMEOUT_MS) || 30 * 60 * 1000;
	const ack = `${file}.${process.pid}.ack`;
	const fd = openSync(ack, 'w');
	const child = spawn('sh', [ '-c', 'flock ' + (wait ? `-w ${Math.ceil(limit / 1000)} ` : '-n ') + '-x "$2" sh -c \'echo "$1" >"$2"; echo ok; cat >/dev/null\' sh "$1" "$2" || echo busy',
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
	if (wait && !held && Date.now() - t0 >= limit - 1000) {
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
		/* wait mode never answers `busy` for contention, so a false here is flock itself failing. */
		if (take(id, name, true)) continue;
		console.error(`${name}: could not take the lock for stand ${id} (flock failed on ${lockDir}); not running unlocked`);
		process.exit(2);
	}
}

/* No stand, no verdict — and a gate that quietly reports success on zero routers is worse than one
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

/* Run `fn` on every stand at once and let each finish: one router answering 502 must not discard
 * what the others measured. `serial` runs them one after another for a gate whose subject is frame
 * pacing, where a second router rendering is noise (scroll-jank). Returns the routers that threw as
 * `<id>: <reason>` lines — a StandDown by its sentence, anything else with its stack, because that
 * one is a bug in the gate. */
export async function eachStand(list, fn, { serial = false } = {}) {
	const run = async (stand) => {
		try { await fn(stand); return []; }
		catch (e) {
			const text = e instanceof StandDown ? e.message : String((e && e.stack) || e);
			return [ text.startsWith(`${stand.id}:`) ? text : `${stand.id}: ${text}` ];
		}
	};
	if (!serial) return (await Promise.all(list.map(run))).flat();
	const down = [];
	for (const stand of list) down.push(...await run(stand));
	return down;
}

/* Say which routers measured nothing, and return how many: the caller exits non-zero after it has
 * printed the findings of the routers that did answer. A gate that runs once per engine passes the
 * same line per engine; it is named once. */
export function reportDown(name, down) {
	const rows = [ ...new Set(down) ];
	if (!rows.length) return 0;
	console.error(`\n${name}: ${rows.length} router(s) did not complete, so nothing was measured on them:`);
	for (const d of rows) console.error(`  ${d}`);
	return rows.length;
}

/* The ids in `wanted` that owlab does not report running. tools/ci-local.sh stops exactly these
 * after a leg: `owlab down` with no ids stops every stand of owlab.yaml (9 on the maintainer's box). */
export const notRunning = (wanted, routers) =>
	wanted.filter((id) => !routers.some((r) => r.id === id && r.state === 'running'));
