/* fs-sheets.js: the per-owner dedupe and the text half of the <link> re-host. The CSSOM half (an
 * @import's rules fenced once it loads) needs a real stylesheet and is held by tools/smoke.mjs.
 * The elements here are hand-built stand-ins carrying only what the module reads. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModule, fakeDocument } from './lib/luci-module.mjs';

function style(cssText, id) {
	return {
		tagName: 'STYLE', id, removed: false,
		closest: () => null,
		sheet: { cssRules: [ { cssText } ] },
		remove() { this.removed = true; }
	};
}

function load(sheets) {
	const document = fakeDocument({ querySelectorAll: () => sheets });
	return loadModule('fs-sheets', { document });
}

test('dedupe: byte-identical copies with different owners both survive', () => {
	const a = style('.x { color: red; }'), b = style('.x { color: red; }');
	const m = load([ a, b ]);
	m._owner.set(a, 'admin/services/one');
	m._owner.set(b, 'admin/services/two');
	m.dedupeViewSheets();
	assert.equal(a.removed, false);
	assert.equal(b.removed, false);
});

test('dedupe: same owner, or none, collapses to the first copy', () => {
	for (const owner of [ 'admin/services/one', null ]) {
		const a = style('.x { color: red; }'), b = style('.x { color: red; }');
		const m = load([ a, b ]);
		if (owner) { m._owner.set(a, owner); m._owner.set(b, owner); }
		m.dedupeViewSheets();
		assert.equal(a.removed, false);
		assert.equal(b.removed, true, 'owner ' + owner);
	}
});

function link(over) {
	const attrs = new Set(over.attrs || []);
	return {
		tagName: 'LINK', rel: 'stylesheet', media: '', href: 'http://router/app.css',
		dataset: {}, closest: () => null, after() { this.afterCalled = true; },
		hasAttribute: (n) => attrs.has(n), addEventListener() {}, ...over
	};
}

function rehost(el) {
	const made = [];
	const document = fakeDocument({
		createElement: () => { const s = { dataset: {}, closest: () => null, addEventListener() {} }; made.push(s); return s; }
	});
	const m = loadModule('fs-sheets', { document });
	m.rehostIntoThemeLayer(el, { names: new Set() });
	return made;
}

test('re-host: the shim keeps the link media after layer(theme)', () => {
	const [ s ] = rehost(link({ media: 'print' }));
	assert.equal(s.textContent, '@import url("http://router/app.css") layer(theme) print;');
});

test('re-host: no media adds nothing after layer(theme)', () => {
	const [ s ] = rehost(link({}));
	assert.equal(s.textContent, '@import url("http://router/app.css") layer(theme);');
});

test('re-host: alternate and disabled links are not re-hosted, and are watched for enabling', () => {
	const watched = [];
	globalThis.MutationObserver = class { observe(el, opts) { watched.push([ el, opts ]); } };
	for (const el of [ link({ rel: 'alternate stylesheet' }), link({ attrs: [ 'disabled' ] }) ]) {
		assert.deepEqual(rehost(el), []);
		assert.equal(watched.pop()[0], el);
		assert.equal(el.dataset.fsLayered, undefined);
		assert.equal(el.afterCalled, undefined);
	}
});
