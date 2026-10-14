/* Three fixes held without a browser: the menu helpers must not overwrite a page's own
 * progressbar()/renderBox()/renderBadge(), a leaf name shared by two sections is current only under
 * the active one, and a held Space/Enter activates once while still preventing the default. Each
 * assertion goes red with its fix reverted. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModule, fakeWindow, fakeL, fakeUi } from './lib/luci-module.mjs';

globalThis._ = globalThis._ || ((s) => s);

test('menu helpers keep a page\'s own progressbar / renderBox / renderBadge', () => {
	const own = { progressbar() {}, renderBox() {}, renderBadge() {} };
	const win = fakeWindow({ ...own });
	loadModule('menu-footstrap-common', { window: win });
	for (const k of Object.keys(own)) assert.equal(win[k], own[k], k);
});

test('menu helpers define progressbar when the page has none', () => {
	const win = fakeWindow();
	loadModule('menu-footstrap-common', { window: win });
	assert.equal(typeof win.progressbar, 'function');
});

/* the few members renderMainMenu touches on an element, recording what it is given */
function fakeEl(tag, attrs = {}, kids = []) {
	if (Array.isArray(tag)) return { firstElementChild: null };
	const el = {
		tag, attrs: { ...attrs }, kids: [], dataset: {}, innerHTML: '', label: { textContent: '' },
		get firstElementChild() { return this.kids[0] ?? null; },
		appendChild(c) { this.kids.push(c); return c; },
		setAttribute(k, v) { this.attrs[k] = v; },
		addEventListener() {},
		querySelector() { return this.label; }
	};
	kids.forEach((c) => el.appendChild(c));
	return el;
}

function renderRouting() {
	const leaf = { name: 'routing', title: 'Routing' };
	const root = { children: [
		{ name: 'status', title: 'Status', children: [ leaf ] },
		{ name: 'network', title: 'Network', children: [ leaf ] }
	] };
	const top = fakeEl('ul');
	globalThis.E = fakeEl;
	const L = fakeL();
	L.env.dispatchpath = [ 'admin', 'status', 'routing' ];
	L.url = (...a) => a.join('/');
	const prefs = { currentRail: () => false, isTopLayout: () => false, currentAutoCollapse: () => true,
		lsGetArr: () => [], lsSet() {} };
	const ui = fakeUi({ menu: { getChildren: (n) => n.children || [] } });
	const doc = { documentElement: { hasAttribute: () => false }, querySelector: () => top };
	const m = loadModule('fs-chrome', { L, document: doc,
		stubs: { ui, 'fs-prefs': prefs } });
	m.renderMainMenu(root, 'admin');
	/* section li -> [link, submenu ul] -> leaf li -> [link, empty] */
	return top.kids.map((li) => li.kids[1].kids[0].kids[0]);
}

test('a same-named leaf is current only under the active section', () => {
	const [status, network] = renderRouting();
	assert.equal(status.attrs['aria-current'], 'page');
	assert.equal(status.attrs.class, 'active');
	assert.ok(!network.attrs['aria-current']);
	assert.equal(network.attrs.class, '');
});

/* a held key: the browser fires keydown with repeat:true */
function press(handler, key, repeat) {
	let prevented = false;
	handler({ key, repeat, preventDefault() { prevented = true; } });
	return prevented;
}
function keyTarget() {
	return { handler: null, addEventListener(_t, fn) { this.handler = fn; }, click() { this.clicks++; }, clicks: 0 };
}

test('wireActivate activates once per press and prevents every keydown', () => {
	const w = loadModule('fs-widgets');
	const el = keyTarget();
	let n = 0;
	w.wireActivate(el, () => n++);
	assert.ok(press(el.handler, ' ', false));
	assert.ok(press(el.handler, ' ', true));
	assert.ok(press(el.handler, 'Enter', true));
	assert.equal(n, 1);
});

test('wireActivate on an <a role=button> clicks once per press and prevents every keydown', () => {
	const w = loadModule('fs-widgets');
	const el = keyTarget();
	w.wireActivate(el, () => el.click());
	assert.ok(press(el.handler, ' ', false));
	assert.ok(press(el.handler, ' ', true));
	assert.equal(el.clicks, 1);
});
