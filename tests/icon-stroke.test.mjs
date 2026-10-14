/* The chrome icons carry no paint attributes: their stroke is one CSS rule in theme/20-shell.css.
 *
 * An <svg> with none of fill/stroke set draws its path FILLED BLACK, so a class the rule does not
 * name would paint a solid glyph with no error anywhere. These hold the two halves together: every
 * class an icon is emitted with is in the rule's selector list, and nothing re-adds the attributes
 * the rule replaced (100 B per <svg>, 300 B of every admin page). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { read, readAll } from '../tools/lib/root.mjs';
import { loadModule } from './lib/luci-module.mjs';

const SHELL = read('luci-theme-footstrap/styles/theme/20-shell.css').replace(/\/\*[\s\S]*?\*\//g, '');
const HEADER = read('luci-theme-footstrap/ucode/template/themes/footstrap/header.ut');
const JS = readAll('luci-theme-footstrap/htdocs/luci-static/resources', '.js');
const PAINT = /\s(?:fill|stroke|stroke-width|stroke-linecap|stroke-linejoin)=/;

/* the classes of the one rule that strokes the icons */
const rule = SHELL.match(/([^{}]+)\{[^}]*\bstroke-width:[^}]*\}/);
const stroked = new Set((rule ? rule[1] : '').split(',').map((s) => s.trim()));

test('one rule in 20-shell.css strokes the icons, with round caps and joins', () => {
	assert.ok(rule, 'no rule sets stroke-width');
	assert.ok(stroked.has('.fs-ico'));
	for (const d of [ 'fill: none', 'stroke: currentColor', 'stroke-width: 1.9', 'stroke-linecap: round', 'stroke-linejoin: round' ])
		assert.ok(rule[0].includes(d), d);
});

test('svgIcon emits a stroked class and none of the attributes the rule replaced', () => {
	const { svgIcon } = loadModule('fs-widgets');
	const html = svgIcon('<path d="M0 0"/>');
	assert.ok(stroked.has('.' + html.match(/class="([^"]+)"/)[1]));
	assert.doesNotMatch(html, PAINT);
});

test('every class svgIcon is called with is one the rule strokes', () => {
	const calls = JS.match(/(?<!function )\bsvgIcon\(/g) ?? [];
	const known = [ ...JS.matchAll(/(?<!function )\bsvgIcon\(\s*(?:body|'[^']*')\s*(?:,\s*'([^']+)')?\s*\)/g) ];
	assert.ok(calls.length >= 2);
	assert.equal(known.length, calls.length, 'a svgIcon() call of a new shape: teach this test its class');
	for (const m of known) if (m[1]) assert.ok(stroked.has('.' + m[1]), m[1]);
});

test('header.ut icons carry a stroked class and no paint attribute', () => {
	const svgs = HEADER.match(/<svg class="[^"]*" aria-hidden[^>]*>/g) ?? [];
	assert.equal(svgs.length, 3, 'rail toggle, search, log out');
	for (const tag of svgs) {
		assert.ok(stroked.has('.' + tag.match(/class="([^"]+)"/)[1]), tag);
		assert.doesNotMatch(tag, PAINT);
	}
});
