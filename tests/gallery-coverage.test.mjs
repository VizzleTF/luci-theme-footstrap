import { test } from 'node:test';
import assert from 'node:assert/strict';
import { elementsOf, pairsOf, missing } from '../tools/gallery-coverage.mjs';

const keys = (css) => [ ...pairsOf(css).keys() ];

test('a widget under a container is a pair; the child combinator is part of the key', () => {
	assert.deepEqual(keys('.td.cbi-section-actions > .cbi-dropdown { a: b }'), [ 'cbi-dropdown in .td.cbi-section-actions >' ]);
	assert.deepEqual(keys('.btn.cbi-button-apply, .cbi-value-field .cbi-checkbox { a: b }'), [ 'cbi-checkbox in .cbi-value-field' ]);
});

test('relative selectors, siblings, bare subjects and widget internals yield nothing', () => {
	assert.deepEqual(keys('.x:has(> .y .cbi-checkbox) { a: b }'), []);
	assert.deepEqual(keys('.cbi-dropdown + .cbi-button { a: b }'), []);
	assert.deepEqual(keys('.cbi-dropdown { a: b }'), []);
	assert.deepEqual(keys('.cbi-dynlist .cbi-button { a: b }'), []);
});

test('a family folds its variants: btn and cbi-button-apply are one widget', () => {
	assert.deepEqual(keys('.modal .btn, .modal .cbi-button-apply { a: b }'), [ 'cbi-button in .modal' ]);
});

test('elementsOf keeps ancestry across void tags, comments and mismatched closers', () => {
	const els = elementsOf('<!-- <div class="no"> --><div class="a"><input class="v"><p class="b"><span class="c">x</span></div><i class="d"></i>');
	const by = (c) => els.find((e) => e.cls.has(c));
	assert.equal(by('no'), undefined);
	assert.equal(by('c').parent, by('b'));
	assert.equal(by('b').parent, by('a'));
	assert.equal(by('v').parent, by('a'));
	assert.equal(by('d').parent, null);
});

test('missing: descendant versus child, and the stacked state is part of the container', () => {
	const pairs = pairsOf('.table.fs-stacked .td.cbi-section-actions > .cbi-dropdown { a: b }');
	const page = (cls) => elementsOf(`<table class="${cls}"><tr><td class="td cbi-section-actions"><div class="cbi-dropdown"></div></td></tr></table>`);
	assert.deepEqual(missing(pairs, page('table')), [ 'cbi-dropdown in .table.fs-stacked .td.cbi-section-actions >' ]);
	assert.deepEqual(missing(pairs, page('table fs-stacked')), []);
	const nested = elementsOf('<table class="table fs-stacked"><td class="td cbi-section-actions"><div><div class="cbi-dropdown"></div></div></td></table>');
	assert.equal(missing(pairs, nested).length, 1, '> is not a descendant');
});
