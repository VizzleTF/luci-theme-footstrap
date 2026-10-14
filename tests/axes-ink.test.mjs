/* A hex accent or status colour carries its own readable ink, computed where the hex is applied. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModule, fakeDocument } from './lib/luci-module.mjs';

function load() {
	const props = new Map();
	const style = { setProperty: (k, v) => props.set(k, v), removeProperty: (k) => props.delete(k) };
	const document = fakeDocument();
	Object.assign(document.documentElement, { style, removeAttribute() {} });
	const prefs = loadModule('fs-prefs', { document });
	return { props, axes: loadModule('fs-axes', { document, stubs: { 'fs-prefs': prefs, rpc: { declare: () => () => {} } } }) };
}

test('a light hex gets black ink, a dark one white', () => {
	const { props, axes } = load();
	axes.accent.apply('#ffcc00');
	assert.equal(props.get('--fs-on-accent'), '#000');
	axes.accent.apply('#0033aa');
	assert.equal(props.get('--fs-on-accent'), '#fff');
});

test('a hue and off hand the ink back to the palette', () => {
	const { props, axes } = load();
	axes.danger.apply('#ffcc00');
	assert.equal(props.get('--fs-on-danger'), '#000');
	axes.danger.apply(120);
	assert.equal(props.has('--fs-on-danger'), false);
	axes.danger.apply('#0033aa');
	axes.danger.apply(0);
	assert.equal(props.has('--fs-on-danger'), false);
});

test('the tint has no ink', () => {
	const { props, axes } = load();
	axes.tint.apply('#ffcc00');
	assert.deepEqual([...props.keys()], ['--fs-bg']);
});
