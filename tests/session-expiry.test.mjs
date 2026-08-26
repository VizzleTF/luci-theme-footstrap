/* When the router decides the session is gone — and, just as important, when it takes that back.
 *
 * A client navigation cannot survive an expired session: the swap succeeds, the view's first RPC
 * comes back 403 and the reader is left on a page that will never fill. So the router listens on
 * both interception points luci-base offers — `L.Request` for the HTTP 403 that carries
 * `X-LuCI-Login-Required`, `rpc` for the `session/access` reply — and once it hears one it hands
 * every later click back to the browser as a full load, which lands on the login page.
 *
 * The verdict is not a LATCH: that is the wrong shape for a signal this broad. An interceptor sees
 * `msg` only after the transport succeeded and the body parsed (rpc.js: a rejected request never
 * reaches one), so a missing frame is not a network flap — but it is a captive portal, a proxy's
 * error page, a body truncated once.
 *
 * So the verdict follows the evidence in BOTH directions: a clean `session/access` says the session
 * is there, because that is the same call the failing one was. If the session really is gone, no
 * clean one arrives and the router stays off. A stand cannot show either half without expiring a
 * real session mid-run, which is a fixture, not a test. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModule, installBrowserGlobals, fakeWindow, fakeDocument, fakeL } from './lib/luci-module.mjs';

installBrowserGlobals();

function boot() {
	const rpcFns = [], reqFns = [];
	const L = fakeL({ Request: { addInterceptor(fn) { reqFns.push(fn); }, get: () => Promise.resolve({}) } });
	const window = fakeWindow();
	window.L = L;
	const mod = loadModule('fs-router', {
		window, document: fakeDocument(), L,
		stubs: { rpc: { addInterceptor(fn) { rpcFns.push(fn); } } }
	});
	return {
		mod,
		/* every registered interceptor, driven the way luci-base drives it */
		rpc: (msg, req) => rpcFns.forEach((fn) => fn(msg, req)),
		http: (res) => reqFns.forEach((fn) => fn(res))
	};
}

const ACCESS = { object: 'session', method: 'access' };
/* the three replies measured on the stands (owrt2512, 25.12.4): a live sid answers `access: true`,
 * a dead one answers `access: false` with HTTP 200 and NO error frame, and the `-32002` error is
 * what the ordinary call that triggered the probe came back with */
const OK = { jsonrpc: '2.0', id: 1, result: [ 0, { access: true } ] };
const NO_ACCESS = { jsonrpc: '2.0', id: 1, result: [ 0, { access: false } ] };
const DENIED = { jsonrpc: '2.0', id: 1, error: { code: -32002, message: 'Access denied' } };

function response(status, header) {
	return { status, headers: { get: (k) => (k === 'X-LuCI-Login-Required' ? header : null) } };
}

test('a clean session/access reply leaves the router on', () => {
	const t = boot();
	t.rpc(OK, ACCESS);
	assert.equal(t.mod.sessionExpired(), false);
});

test('an error on session/access takes the router off', () => {
	const t = boot();
	t.rpc(DENIED, ACCESS);
	assert.equal(t.mod.sessionExpired(), true);
});

test('a later clean session/access takes the verdict BACK', () => {
	const t = boot();
	t.rpc(DENIED, ACCESS);
	t.rpc(OK, ACCESS);
	assert.equal(t.mod.sessionExpired(), false,
		'the same call that said the session was gone is what can say it is there');
});

test('`access: false` says nothing in either direction', () => {
	/* it is what a DEAD sid answers — and what an ACL denial answers for a live one, which is why
	 * it may neither expire the session nor revive it. The trap it closes: a 403 has just turned
	 * the router off, luci-base fires this probe, and reading "the frame parsed" as "the session is
	 * back" would clear the verdict with the very reply that confirms it. */
	const t = boot();
	t.rpc(NO_ACCESS, ACCESS);
	assert.equal(t.mod.sessionExpired(), false, 'a restricted user keeps client navigation');

	const u = boot();
	u.http(response(403, 'yes'));
	u.rpc(NO_ACCESS, ACCESS);
	assert.equal(u.mod.sessionExpired(), true, 'and it cannot take back a verdict already reached');
});

test('a reply with no frame is not proof of an expired session on its own', () => {
	const t = boot();
	t.rpc(null, ACCESS);
	t.rpc(OK, ACCESS);
	assert.equal(t.mod.sessionExpired(), false);
});

test('an error on somebody else\'s call is not ours to read', () => {
	const t = boot();
	t.rpc(DENIED, { object: 'uci', method: 'get' });
	assert.equal(t.mod.sessionExpired(), false);
});

test('a 403 carrying the login header takes the router off', () => {
	const t = boot();
	t.http(response(403, 'yes'));
	assert.equal(t.mod.sessionExpired(), true);
});

test('a 403 without the header is an ordinary denial', () => {
	const t = boot();
	t.http(response(403, null));
	assert.equal(t.mod.sessionExpired(), false);
});

test('an interceptor handed junk neither throws nor decides', () => {
	const t = boot();
	assert.doesNotThrow(() => { t.rpc(undefined, undefined); t.http(undefined); });
	assert.equal(t.mod.sessionExpired(), false);
});
