/* fs-select.js shapeOf(): the slot cache's column-count key, read off the title row for every header
 * markup tagDataTables() recognises. Stand-in elements carry only what the lookup reads. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './lib/luci-module.mjs';

const el = (tagName, children = []) => ({ tagName, children, firstElementChild: children[0] || null });
const cells = (n, tag = 'TH') => Array.from({ length: n }, () => el(tag));

/* a table whose querySelector answers the first selector it holds a node for */
function table({ titled, thead, rows = [], caption }) {
	return {
		firstElementChild: caption || thead || null, /* a real table's first child: its caption, else its thead */
		querySelector(sel) {
			if (titled && sel.includes(titled.sel)) return titled.node;
			return sel.includes('thead') ? thead || null : null;
		},
		rows
	};
}

const { shapeOf } = loadModule('fs-select', { stubs: { ui: {}, dom: {}, 'fs-fit': {} } });

test('thead > tr: the row\'s cells, not the thead\'s one child', () => {
	assert.equal(shapeOf(table({ thead: el('THEAD', [ el('TR', cells(4)) ]) })), '4');
});

test('caption first: the caption does not hide the thead', () => {
	assert.equal(shapeOf(table({ caption: el('CAPTION'), thead: el('THEAD', [ el('TR', cells(4)) ]) })), '4');
});

test('E() thead holding th directly', () => {
	assert.equal(shapeOf(table({ thead: el('THEAD', cells(3)) })), '3');
});

test('ui.Table .tr.table-titles', () => {
	const node = el('DIV', cells(5, 'DIV'));
	assert.equal(shapeOf(table({ titled: { sel: '.tr.table-titles', node } })), '5');
});

test('apk .tr.cbi-section-table-titles', () => {
	const node = el('DIV', cells(4, 'DIV'));
	assert.equal(shapeOf(table({ titled: { sel: '.tr.cbi-section-table-titles', node } })), '4');
});

test('non-adopted parsed <tr class=tr><th>: column count, not row count', () => {
	const row = el('TR', cells(2));
	const t = table({ rows: [ row, el('TR', cells(2, 'TD')), el('TR', cells(2, 'TD')) ] });
	t.rows.forEach((r) => { r.cells = r.children; });
	assert.equal(shapeOf(t), '2');
});

test('no header at all is 0', () => {
	assert.equal(shapeOf(table({ rows: [] })), '0');
});
