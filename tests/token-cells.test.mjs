/* fs-select.js markTokenCells(): a stacked table's first cell is tagged only when its text has no
 * break opportunity (no whitespace, U+002D, U+00AD, U+2010-U+2014). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './lib/luci-module.mjs';

const { markTokenCells } = loadModule('fs-select', { stubs: { ui: {}, dom: {}, 'fs-fit': {} } });

function tagged(text) {
	const set = new Set();
	const cell = { textContent: text, classList: {
		contains: (c) => set.has(c),
		toggle: (c, on) => (on ? set.add(c) : set.delete(c))
	} };
	markTokenCells({ querySelectorAll: () => [ cell ] });
	return set.has('fs-td-token');
}

for (const t of [ '/dev/mtdblock6', 'myddns_ipv4', '  wan6\n' ])
	test(`token: ${JSON.stringify(t)}`, () => assert.equal(tagged(t), true));

for (const t of [ 'esp-sensor-hall', 'macbook-pro', 'Cloudflare (Standard)', 'a­b', 'a–b', 'a—b', '', ' \n\t ' ])
	test(`not a token: ${JSON.stringify(t)}`, () => assert.equal(tagged(t), false));
