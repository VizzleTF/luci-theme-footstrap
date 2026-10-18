import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeBaseline, readSeenIn, seenToJson, prunable, isFullSweep } from '../tools/lib/baseline-merge.mjs';

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

test('--prune keeps an entry only a --seen-in file reproduced, drops one seen nowhere', () => {
	const elsewhere = { a: [ 'none' ] };
	const { next, dropped } = mergeBaseline({ a: [ 'none', 'gone' ] }, { a: new Set() }, true, elsewhere);
	assert.deepEqual(next.a, [ 'none' ]);
	assert.deepEqual(dropped, [ 'a: gone' ]);
	assert.deepEqual(mergeBaseline(baseline, seen, true, { x: [ 'none' ] }).dropped, []);
});

test('--seen-out and --seen-in round-trip, files merge per key', () => {
	const files = { 'a.json': JSON.stringify(seenToJson(seen)), 'b.json': '{"a":["z"]}' };
	assert.deepEqual(seenToJson(seen).a, [ 'both', 'onlyA' ]);
	assert.deepEqual(readSeenIn('a.json,b.json', (f) => files[f]).a, [ 'both', 'onlyA', 'z' ]);
	assert.deepEqual(readSeenIn('', () => assert.fail()), {});
});

test('a page skipped for lacking #view blocks --prune when the baseline holds entries for it', () => {
	const base = { a: [ '/admin/x|1440|k|e', '/admin/y|1440|k|e' ] };
	const skipped = [ { key: 'a', path: '/admin/x' }, { key: 'a', path: '/admin/z' } ];
	assert.deepEqual(prunable(base, skipped), [ 'a /admin/x' ]);
	assert.deepEqual(prunable(base, []), []);
});

test('a full sweep is --pages-all with no --pages and no --widths', () => {
	assert.equal(isFullSweep({ pages: '', 'pages-all': true }), true);
	assert.equal(isFullSweep({ pages: '', 'pages-all': false }), false);
	assert.equal(isFullSweep({ pages: '/admin', 'pages-all': true }), false);
	assert.equal(isFullSweep({ pages: '', 'pages-all': true, widths: '800' }), false);
});
