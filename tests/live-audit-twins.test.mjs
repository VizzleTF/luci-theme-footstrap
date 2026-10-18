import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coreId } from '../tools/lib/stands.mjs';
import { baselineKey, noteFinding } from '../tools/lib/baseline-merge.mjs';

const baseline = { owrt2512: [ 'p|1440|k|known' ], 'owrt2512@ru': [ 'p|1440|k|ru' ] };

test('a twin stand maps to its core stand, anything else to itself', () => {
	for (const c of [ 'owrt2512', 'owrt2410', 'owrtsnap' ])
		for (const sfx of [ '', 'b', 'd' ]) assert.equal(coreId(c + sfx), c);
	assert.equal(coreId('owrt2512x'), 'owrt2512x');
	assert.equal(coreId('imm2512b'), 'imm2512b');
});

test('baselineKey composes core id, language and engine', () => {
	assert.equal(baselineKey('owrt2512b', 'en', 'chromium'), 'owrt2512');
	assert.equal(baselineKey('owrt2512d', 'ru', 'firefox'), 'owrt2512@ru@firefox');
});

test('twin finding in the core baseline is known; a twin-only one is NEW', () => {
	const seen = {}, fresh = [];
	const key = baselineKey('owrt2512b', 'en', 'chromium');
	noteFinding(seen, baseline, fresh, key, 'p|1440|k|known');
	assert.deepEqual(fresh, []);
	noteFinding(seen, baseline, fresh, key, 'p|1440|k|twin-only', 'x');
	assert.deepEqual(fresh.map((f) => f.sig), [ 'p|1440|k|twin-only' ]);
});

test('core and twin in one run share one seen set', () => {
	const seen = {}, fresh = [];
	noteFinding(seen, baseline, fresh, baselineKey('owrt2512', 'en', 'chromium'), 'a');
	noteFinding(seen, baseline, fresh, baselineKey('owrt2512b', 'en', 'chromium'), 'b');
	assert.deepEqual([ ...seen.owrt2512 ].sort(), [ 'a', 'b' ]);
});

test('a twin prints its own id while its key stays the core id', () => {
	const key = baselineKey('owrt2512b', 'ru', 'chromium');
	assert.equal(key, 'owrt2512@ru');
	assert.equal(key.replace(coreId('owrt2512b'), 'owrt2512b'), 'owrt2512b@ru');
});
