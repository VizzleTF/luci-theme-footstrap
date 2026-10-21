import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage } from '../tools/lib/stands.mjs';

// A page whose goto fails `fails` times, then resolves; waitForTimeout is a stub, so no test waits 1.5 s.
function fakePage(fails) {
	const page = { gotos: [], waits: [] };
	page.goto = async (url, opts) => {
		page.gotos.push([ url, opts ]);
		if (page.gotos.length <= fails) throw new Error(`page.goto: attempt ${page.gotos.length} failed`);
	};
	page.waitForTimeout = async (ms) => { page.waits.push(ms); };
	return page;
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
