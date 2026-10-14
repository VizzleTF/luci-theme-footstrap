import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeBaseline } from '../tools/lib/baseline-merge.mjs';

const baseline = { a: [ 'onlyA', 'onlyB', 'both', 'none' ], b: [ 'onlyB' ] };
const seen = { a: new Set([ 'onlyA', 'both' ]), b: new Set([ 'onlyB', 'both' ]) };

test('--prune keeps an entry any stand reproduced and lists the dropped keys', () => {
	const { next, dropped } = mergeBaseline(baseline, seen, true);
	assert.deepEqual(next.a, [ 'both', 'onlyA', 'onlyB' ]);
	assert.deepEqual(next.b, [ 'both', 'onlyB' ]);
	assert.deepEqual(dropped, [ 'a: none' ]);
});

test('without --prune the result is the union and nothing is dropped', () => {
	const { next, dropped } = mergeBaseline(baseline, seen, false);
	assert.deepEqual(next.a, [ 'both', 'none', 'onlyA', 'onlyB' ]);
	assert.deepEqual(dropped, []);
});
