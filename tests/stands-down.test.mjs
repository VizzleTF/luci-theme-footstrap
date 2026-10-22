import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from '../tools/lib/root.mjs';
import { StandDown, eachStand, login, loginFault, notRunning, reportDown, unreached } from '../tools/lib/stands.mjs';

const LOGIN = '<html><body><form><input name="luci_password"></form></body></html>';
const BAD_GATEWAY = '<html><head></head><body><h1>Bad Gateway</h1>The process did not produce any response</body></html>';

test('loginFault: the login form and an authenticated page are LuCI, whatever the status below 500', () => {
	assert.equal(loginFault(200, LOGIN), null);
	assert.equal(loginFault(403, LOGIN), null);
	assert.equal(loginFault(200, '<script src="/luci-static/resources/luci.js"></script>'), null);
	assert.equal(loginFault(200, '<script>L = new LuCI({});</script>'), null);
});

test('loginFault: a 5xx names the status and the first line of the body', () => {
	assert.equal(loginFault(502, BAD_GATEWAY),
		'LuCI answered 502 (Bad Gateway) — the stand, not the theme');
	assert.match(loginFault(500, LOGIN), /^LuCI answered 500 /);
});

test('loginFault: a 200 that is not LuCI is the stand too; script text is not a body line', () => {
	assert.match(loginFault(200, '<html><script>var x = 1;</script><body><h1>Welcome to nginx!</h1></body></html>'),
		/^LuCI answered 200 \(Welcome to nginx!\) — the stand, not the theme$/);
	assert.match(loginFault(200, ''), /\(empty body\)/);
	assert.ok(loginFault(200, '<h1>' + 'x'.repeat(500) + '</h1>').length < 200);
});

const fakePage = (status, html) => {
	const calls = [];
	return {
		calls,
		goto: async () => ({ status: () => status }),
		content: async () => html,
		$: async () => (html === LOGIN ? {} : null),
		fill: async () => calls.push('fill'),
		press: async () => calls.push('press'),
		waitForNavigation: async () => calls.push('nav'),
		waitForFunction: async () => true,
	};
};

test('login: a dead stand throws StandDown naming the router, before any form is touched', async () => {
	const page = fakePage(502, BAD_GATEWAY);
	await assert.rejects(login(page, 'http://localhost:8022/cgi-bin/luci', 'owrtsnap'), (e) => {
		assert.ok(e instanceof StandDown);
		assert.equal(e.message, 'owrtsnap: LuCI answered 502 (Bad Gateway) — the stand, not the theme');
		return true;
	});
	assert.deepEqual(page.calls, []);
});

test('login: without an id the host names the router; a healthy login form is filled in', async () => {
	await assert.rejects(login(fakePage(502, BAD_GATEWAY), 'http://localhost:8022/cgi-bin/luci'),
		/localhost:8022: LuCI answered 502/);
	const page = fakePage(403, LOGIN);
	await login(page, 'http://localhost:8022/cgi-bin/luci', 'owrtsnap');
	assert.deepEqual([ ...page.calls ].sort(), [ 'fill', 'nav', 'press' ]);
});

const BASE = 'http://localhost:8073/cgi-bin/luci';
const didNotAnswer = (cause, id = 'owrt2512') => `${id}: ${BASE} did not answer (${cause}) — the stand, not the theme`;
const failing = (e) => ({ goto: async () => { throw e; } });

test('login: a stand that refuses, resets or drops the connection is a StandDown in every engine\'s words', async () => {
	/* each line is what that engine threw against a closed port or a socket accepted then dropped */
	for (const m of [
		`page.goto: net::ERR_CONNECTION_REFUSED at ${BASE}`, `page.goto: net::ERR_CONNECTION_RESET at ${BASE}`,
		`page.goto: net::ERR_EMPTY_RESPONSE at ${BASE}`, `page.goto: net::ERR_SOCKET_NOT_CONNECTED at ${BASE}`,
		'page.goto: NS_ERROR_CONNECTION_REFUSED', 'page.goto: NS_ERROR_NET_RESET',
		'page.goto: Could not connect to 127.0.0.1: Connection refused', 'page.goto: Connection terminated unexpectedly',
		'page.goto: Error receiving data: Connection reset by peer',
	]) {
		await assert.rejects(login(failing(new Error(m)), BASE, 'owrt2512'), (e) => {
			assert.ok(e instanceof StandDown, m);
			assert.match(e.message, /^owrt2512: \S+ did not answer \(\S.*\) — the stand, not the theme$/, m);
			return true;
		});
	}
});

test('unreached: the sentence carries the cause, so a reset or a hang is not read as a closed port', () => {
	const timeout = Object.assign(new Error('page.goto: Timeout 30000ms exceeded.\nCall log:\n  - navigating'), { name: 'TimeoutError' });
	for (const [ err, cause ] of [
		[ new Error(`page.goto: net::ERR_CONNECTION_REFUSED at ${BASE}`), 'net::ERR_CONNECTION_REFUSED' ],
		[ new Error(`page.goto: net::ERR_CONNECTION_RESET at ${BASE}\nCall log:\n  - navigating`), 'net::ERR_CONNECTION_RESET' ],
		[ timeout, 'Timeout 30000ms exceeded.' ],
	]) assert.equal(unreached(err, 'owrt2512', BASE).message, didNotAnswer(cause), cause);
});

test('login: a goto that waits out its timeout is the stand; any other error keeps its stack', async () => {
	const timeout = Object.assign(new Error('page.goto: Timeout 30000ms exceeded.'), { name: 'TimeoutError' });
	await assert.rejects(login(failing(timeout), BASE, 'owrt2512'), (e) => e instanceof StandDown && e.message === didNotAnswer('Timeout 30000ms exceeded.'));
	for (const bug of [ new Error('page.goto: net::ERR_NAME_NOT_RESOLVED'), new TypeError('x is not a function') ]) {
		assert.equal(unreached(bug, 'owrt2512', BASE), bug);
		await assert.rejects(login(failing(bug), BASE, 'owrt2512'), (e) => e === bug);
	}
});

test('eachStand: every router runs to the end, and the dead ones come back named', async () => {
	const ran = [];
	const list = [ { id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' } ];
	const down = await eachStand(list, async (s) => {
		await new Promise((r) => setTimeout(r, s.id === 'a' ? 20 : 0));
		ran.push(s.id);
		if (s.id === 'b') throw new StandDown('b: LuCI answered 502 (Bad Gateway) — the stand, not the theme');
		if (s.id === 'c') throw new TypeError('boom');
	});
	assert.deepEqual(ran.sort(), [ 'a', 'b', 'c', 'd' ]);
	assert.equal(down.length, 2);
	assert.equal(down[0], 'b: LuCI answered 502 (Bad Gateway) — the stand, not the theme');
	assert.match(down[1], /^c: TypeError: boom\n\s+at /);
});

test('eachStand: a StandDown without the router in front gets it; all healthy gives nothing', async () => {
	assert.deepEqual(await eachStand([ { id: 'x' } ], async () => { throw new StandDown('LuCI answered 502'); }),
		[ 'x: LuCI answered 502' ]);
	assert.deepEqual(await eachStand([ { id: 'x' } ], async () => {}), []);
	assert.deepEqual(await eachStand([], async () => { throw new Error('never'); }), []);
});

test('eachStand: serial finishes one router before it starts the next', async () => {
	const order = [];
	const down = await eachStand([ { id: 'a' }, { id: 'b' }, { id: 'c' } ], async (s) => {
		order.push(`start ${s.id}`);
		await new Promise((r) => setTimeout(r, s.id === 'a' ? 20 : 0));
		order.push(`end ${s.id}`);
		if (s.id === 'a') throw new StandDown('a: LuCI answered 502');
	}, { serial: true });
	assert.deepEqual(order, [ 'start a', 'end a', 'start b', 'end b', 'start c', 'end c' ]);
	assert.deepEqual(down, [ 'a: LuCI answered 502' ]);
});

test('a gate over three routers: the dead ones are named once each, the live one still measures', async () => {
	const pages = { snap: failing(new Error(`page.goto: net::ERR_CONNECTION_REFUSED at ${BASE}`)),
		two: fakePage(502, BAD_GATEWAY), live: fakePage(200, LOGIN) };
	const measured = [];
	const down = await eachStand(Object.keys(pages).map((id) => ({ id })), async (s) => {
		await login(pages[s.id], BASE, s.id);
		measured.push(s.id);
	}, { serial: true });
	assert.deepEqual(measured, [ 'live' ]);
	assert.deepEqual(down, [ didNotAnswer('net::ERR_CONNECTION_REFUSED', 'snap'),
		'two: LuCI answered 502 (Bad Gateway) — the stand, not the theme' ]);
	for (const d of down) assert.match(d, /^\w+: (LuCI answered|http:)/, 'one prefix per line, not the id and the host');
});

test('reportDown: silent and 0 for none, else one line per router (once per engine too) and the count', () => {
	const seen = [];
	const err = console.error;
	console.error = (m) => seen.push(m);
	try {
		assert.equal(reportDown('gate', []), 0);
		assert.deepEqual(seen, []);
		assert.equal(reportDown('gate', [ 'a: x', 'b: y', 'a: x' ]), 2);
	} finally { console.error = err; }
	assert.match(seen[0], /gate: 2 router\(s\) did not complete/);
	assert.deepEqual(seen.slice(1), [ '  a: x', '  b: y' ]);
});

/* A gate that calls login() bare throws the stand's 502 as a stack and drops what the other routers
 * measured; every caller names the router and reports the dead ones. */
const sources = (dir) => readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((d) =>
	d.isDirectory() ? sources(join(dir, d.name)) : d.name.endsWith('.mjs') ? [ join(dir, d.name) ] : []);

test('every caller of login() passes the router id and reports a stand that is down', () => {
	const callers = sources('tools').filter((f) => f !== 'tools/lib/stands.mjs'
		&& /import \{[^}]*\blogin\b[^}]*\} from '[./]+\/lib\/stands\.mjs'/.test(readFileSync(join(ROOT, f), 'utf8')));
	assert.ok(callers.length >= 9, callers.join());
	for (const f of callers) {
		const src = readFileSync(join(ROOT, f), 'utf8');
		const calls = [ ...src.matchAll(/await login\(([^()]*)\)/g) ];
		assert.ok(calls.length, `${f} imports login() and never awaits it`);
		for (const [ , args ] of calls) assert.equal(args.split(',').length, 3, `${f}: login(${args}) names no router`);
		assert.match(src, /\breportDown\(|\bStandDown\b/, `${f} does not report a dead stand`);
	}
});

/* With every router down the StandDown list is the whole story; a "0 runs/ticks, nothing measured"
 * line after it names a second cause that is only the first one again. */
test('fit-quiet and table-tick exit on a dead stand before they judge the zero count', () => {
	for (const [ f, zero ] of [ [ 'tools/fit-quiet.mjs', /\bruns === 0/ ], [ 'tools/table-tick.mjs', /\bticks === 0/ ] ]) {
		const src = readFileSync(join(ROOT, f), 'utf8');
		const exit = src.indexOf('if (unanswered) process.exit(1)');
		assert.ok(exit > 0, `${f} never exits on an unanswered stand`);
		assert.ok(exit < src.search(zero), `${f} judges the zero count before the unanswered exit`);
	}
});

test('notRunning: only what owlab does not report running is this run\'s to stop', () => {
	const routers = [ { id: 'owrt2512', state: 'running' }, { id: 'owrt2410', state: 'exited' }, { id: 'owrt2512b', state: 'running' } ];
	assert.deepEqual(notRunning([ 'owrt2512', 'owrt2410', 'owrtsnap' ], routers), [ 'owrt2410', 'owrtsnap' ]);
	assert.deepEqual(notRunning([ 'owrt2512' ], routers), []);
	assert.deepEqual(notRunning([ 'owrt2512' ], []), [ 'owrt2512' ]);
});

// ci-local.sh: the stand list is computed by the shell function itself, run here against a stub owlab.
const ciLocal = readFileSync(join(ROOT, 'tools/ci-local.sh'), 'utf8');

test('ci-local.sh: started_stands prints the routers owlab does not have running', () => {
	const dir = mkdtempSync(join(tmpdir(), 'ci-local-stands-'));
	try {
		const fn = ciLocal.match(/^started_stands\(\) \{[\s\S]*?^\}/m)[0];
		writeFileSync(join(dir, 'owlab'), '#!/bin/sh\necho \'{"routers":[{"id":"owrt2512","state":"running"},{"id":"owrt2410","state":"exited"}]}\'\n');
		chmodSync(join(dir, 'owlab'), 0o755);
		const run = (path) => spawnSync('sh', [ '-c', `${fn}\nstarted_stands` ],
			{ cwd: ROOT, encoding: 'utf8', env: { ...process.env, PATH: path, ROUTERS: 'owrt2512 owrt2410 owrtsnap' } });
		const ok = run(`${dir}:${process.env.PATH}`);
		assert.equal(ok.stdout.trim(), 'owrt2410 owrtsnap');
		writeFileSync(join(dir, 'owlab'), '#!/bin/sh\nexit 1\n');
		const bad = run(`${dir}:${process.env.PATH}`);
		assert.notEqual(bad.status, 0, 'an unreadable status must be a failure the caller maps to "stop nothing"');
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

test('ci-local.sh: no leg runs a bare `owlab down`; all four stop what they started', () => {
	const code = ciLocal.split('\n').filter((l) => !/^\s*#/.test(l));
	const downs = code.filter((l) => /^\s*owlab down\b/.test(l));
	assert.deepEqual(downs, [ '\towlab down $STARTED >>"$RUNDIR/owlab-down.log" 2>&1 9>&- 8>&- 7>&-' ]);
	assert.equal(code.filter((l) => l === '\tstop_started').length, 4);
});
