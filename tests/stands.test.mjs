import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, tooManyUnopened } from '../tools/lib/stands.mjs';

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
