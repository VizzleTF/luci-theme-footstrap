import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StandDown, login, openPage, tooManyUnopened } from '../tools/lib/stands.mjs';

// A page whose goto fails `fails` times, then resolves; waitForTimeout is a stub, so no test waits 1.5 s.
function fakePage(fails) {
	const page = { gotos: [], waits: [] };
	page.goto = async (url, opts) => {
		page.gotos.push([ url, opts ]);
		if (page.gotos.length <= fails) throw new Error(`page.goto: attempt ${page.gotos.length} failed`);
	};
	page.waitForTimeout = async (ms) => { page.waits.push(ms); };
	page.context = () => ({ browser: () => ({ browserType: () => ({ name: () => 'webkit' }) }) });
	return page;
}

// console.error lines written while `fn` runs
async function stderrOf(fn) {
	const seen = [];
	const err = console.error;
	console.error = (m) => seen.push(m);
	try { await fn(); } catch (e) { /* the caller asserts on the lines, not the throw */ } finally { console.error = err; }
	return seen;
}

test('openPage: a goto that fails twice then answers resolves after 3 calls', async () => {
	const page = fakePage(2);
	await openPage(page, 'http://x/admin');
	assert.equal(page.gotos.length, 3);
	assert.deepEqual(page.waits, [ 1500, 1500 ]);
});

test('openPage: one good goto is one call and no wait', async () => {
	const page = fakePage(0);
	await openPage(page, 'http://x/admin');
	assert.equal(page.gotos.length, 1);
	assert.deepEqual(page.waits, []);
});

test('openPage: three failures reject with the last error, after exactly 3 calls', async () => {
	const page = fakePage(3);
	await assert.rejects(openPage(page, 'http://x/admin'), /attempt 3 failed/);
	assert.equal(page.gotos.length, 3);
	assert.equal(page.waits.length, 2);
});

test('openPage: every attempt gets the 20 s timeout and domcontentloaded', async () => {
	const page = fakePage(2);
	await openPage(page, 'http://x/admin');
	for (const [ url, opts ] of page.gotos) {
		assert.equal(url, 'http://x/admin');
		assert.deepEqual(opts, { waitUntil: 'domcontentloaded', timeout: 20000 });
	}
});

test('openPage: one stderr line per failed attempt (engine, url, the error\'s first line), none on a first-try success', async () => {
	const failed = fakePage(3);
	failed.goto = async () => { throw new Error('page.goto: WebKit encountered an internal error\nCall log:\n  - navigating'); };
	const lines = await stderrOf(() => openPage(failed, 'http://x/admin'));
	assert.deepEqual(lines, [ 1, 2, 3 ].map((n) => `openPage: webkit http://x/admin attempt ${n}/3: page.goto: WebKit encountered an internal error`));
	assert.deepEqual(await stderrOf(() => openPage(fakePage(0), 'http://x/admin')), []);
});

// A landing page as login() sees it: already authenticated (no form), LuCI's `window.L` run in node.
// waitForFunction runs the page function against `globalThis.window` and gives up after 3 polls,
// with Playwright's own TimeoutError, instead of waiting out the real 20 s.
function landingPage() {
	const page = { opts: null };
	page.goto = async () => ({ status: () => 200 });
	page.content = async () => '<script src="/luci-static/resources/luci.js"></script>';
	page.$ = async () => null;
	page.waitForFunction = async (fn, arg, opts) => {
		page.opts = opts;
		for (let i = 0; i < 3; i++) { const r = await fn(arg); if (r) return r; }
		throw Object.assign(new Error(`page.waitForFunction: Timeout ${opts.timeout}ms exceeded.`), { name: 'TimeoutError' });
	};
	return page;
}
const BASE = 'http://localhost:8073/cgi-bin/luci';

test('login: resolves only after the landing\'s L.require answers, waiting at most 20 s', async () => {
	const events = [];
	globalThis.window = { L: { require: (m) => {
		events.push(`require ${m}`);
		return new Promise((r) => setTimeout(() => { events.push('answered'); r(); }, 30));
	} } };
	try {
		const page = landingPage();
		await login(page, BASE, 'owrt2512');
		events.push('login returned');
		assert.deepEqual(events, [ 'require ui', 'answered', 'login returned' ]);
		assert.equal(page.opts.timeout, 20000);
	} finally { delete globalThis.window; }
});

test('login: a landing with no L (the stand served no LuCI) is a StandDown, not a hang', async () => {
	for (const win of [ {}, { L: {} } ]) {
		globalThis.window = win;
		try {
			await assert.rejects(login(landingPage(), BASE, 'owrt2512'), (e) => {
				assert.ok(e instanceof StandDown);
				assert.equal(e.message, `owrt2512: ${BASE} did not answer (Timeout 20000ms exceeded.) — the stand, not the theme`);
				return true;
			});
		} finally { delete globalThis.window; }
	}
});

test('tooManyUnopened: scroll-anchor floor 3 tolerates 3 of 16, the 4th is too many', () => {
	assert.equal(tooManyUnopened(0, 16, 3), false);
	assert.equal(tooManyUnopened(3, 16, 3), false);
	assert.equal(tooManyUnopened(4, 16, 3), true);
});

test('tooManyUnopened: scroll-jank floor 1 tolerates one page of 8, two are too many', () => {
	assert.equal(tooManyUnopened(0, 8, 1), false);
	assert.equal(tooManyUnopened(1, 8, 1), false);
	assert.equal(tooManyUnopened(2, 8, 1), true);
});

test('tooManyUnopened: past 50 attempts 2% outgrows a floor of 1', () => {
	assert.equal(tooManyUnopened(3, 170, 1), false);	// 3.4 allowed
	assert.equal(tooManyUnopened(4, 170, 1), true);
	assert.equal(tooManyUnopened(3, 170, 3), false);
	assert.equal(tooManyUnopened(4, 170, 3), true);
});
