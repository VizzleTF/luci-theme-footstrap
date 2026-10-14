/* fs-router's navigation, driven through navigate() and the popstate handler against a hand-built
 * DOM: the fixes that only show once a navigation overlaps another, a history move arrives, the
 * progress bar fades or a Back restore waits for height. Each test goes red with its fix reverted.
 * luci-module.mjs is not a browser, so the DOM here holds just the tree operations the router makes
 * (append, insert, reparent, :scope queries) and nothing about layout. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModule, fakeL, fakeUi, fakeWindow, fakeDocument, installBrowserGlobals } from './lib/luci-module.mjs';

installBrowserGlobals();

function el(tag = 'div') {
	const classes = new Set(), attrs = {};
	const e = {
		nodeType: 1, nodeName: tag.toUpperCase(), id: '', dataset: {}, children: [], parentNode: null,
		scrollTop: 0, scrolls: [],
		classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c),
			contains: (c) => classes.has(c), [Symbol.iterator]: () => classes.values() },
		set className(v) { classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach((c) => classes.add(c)); },
		get firstChild() { return e.children[0] || null; },
		get childNodes() { return e.children; },
		get childElementCount() { return e.children.length; },
		setAttribute(k, v) { attrs[k] = String(v); },
		getAttribute: (k) => (k in attrs ? attrs[k] : null),
		hasAttribute: (k) => k in attrs,
		addEventListener() {}, removeEventListener() {}, focus() {},
		scrollTo(x, y) { e.scrolls.push([ x, y ]); e.scrollTop = y; },
		detach() { if (e.parentNode) e.parentNode.children.splice(e.parentNode.children.indexOf(e), 1); e.parentNode = null; },
		appendChild(c) { c.detach(); c.parentNode = e; e.children.push(c); return c; },
		insertBefore(c, ref) {
			c.detach(); c.parentNode = e;
			const i = ref ? e.children.indexOf(ref) : -1;
			if (i < 0) e.children.push(c); else e.children.splice(i, 0, c);
			return c;
		},
		remove() { e.detach(); },
		/* the only two shapes the router asks of a node: "is anything painted" and "which child is #view" */
		querySelector: () => e.children[0] || {},
		querySelectorAll: () => e.children.filter((c) => c.id === 'view')
	};
	return e;
}

const PATH = (...segs) => '/cgi-bin/luci/' + segs.join('/');
const A = [ 'admin', 'status', 'overview' ];

function boot({ search = '', state = null } = {}) {
	const timers = new Map();
	let now = 0, tid = 0;
	const win = fakeWindow({
		setTimeout: (fn, ms) => { timers.set(++tid, { fn, at: now + ms }); return tid; },
		clearTimeout: (id) => { timers.delete(id); },
		requestAnimationFrame: () => 0,
		scrollY: 0, scrolls: []
	});
	win.scrollTo = (x, y) => win.scrolls.push([ x, y ]);
	win.location.search = search;
	win.history = { state, pushed: [], replaced: [],
		pushState(s, t, u) { this.pushed.push(u); }, replaceState(s) { this.replaced.push(s); } };
	globalThis.history = win.history;
	globalThis._ = (s) => s;
	globalThis.requestAnimationFrame = () => 0;
	let reloads = 0;
	win.location.reload = () => { reloads++; };

	const body = el('body'), main = el(), host = el();
	main.id = 'maincontent'; host.className = 'fs-content';
	main.appendChild(host); body.appendChild(main);
	const doc = fakeDocument({ body, title: 'host | Overview',
		querySelector: (s) => (s === '.fs-content' ? host : null),
		getElementById: (id) => (id === 'maincontent' ? main
			: body.children.find((c) => c.id === id) || null),
		createElement: (t) => el(t) });

	const V = class {};
	const gates = {};
	const L = fakeL({
		view: V,
		dom: { content(node, kids) { (kids || []).forEach((k) => node.appendChild(k)); }, parse: () => null, append() {} },
		require: (name) => (gates[name] ? gates[name].p : Promise.resolve(new V()))
	});
	const scopes = [];
	const tree = {
		currentNode: () => null, tree: () => null, readonlyForSegs: () => false,
		segsFromPath: (p) => (p.indexOf('/cgi-bin/luci/') === 0 ? p.split('/').slice(3) : null),
		resolveSegs: (segs) => ({ node: { title: 'T', action: {}, segs }, segs }),
		viewClassFor: (n) => (n && n.segs ? 'view.' + n.segs.join('.') : null)
	};
	const r = loadModule('fs-router', { L, window: win, document: doc, stubs: {
		ui: fakeUi(), rpc: { addInterceptor() {} }, 'fs-menutree': tree,
		'fs-chrome': { renderChrome() {} }, 'fs-fit': { forgetRest() {} },
		'fs-sheets': { watchViewSheets() {}, documentPoisoned: () => false, documentCarries: () => true,
			attributeTo() {}, scopeToCurrentPage: (...a) => scopes.push(a) }
	} });
	return {
		r, win, doc, main, host, body, L, gates, scopes, tree, V, reloads: () => reloads,
		tick(ms) {
			now += ms;
			for (const [ id, t ] of [ ...timers ])
				if (t.at <= now && timers.has(id)) { timers.delete(id); t.fn(); }
		},
		popstate() { win.listeners.find((l) => l.type === 'popstate').fn(); }
	};
}
const flush = () => new Promise((r) => setImmediate(r));
function gate() { let ok; const p = new Promise((r) => { ok = r; }); return { p, ok }; }
function banner(host) { const b = el(); b.className = 'alert-message'; return host.appendChild(b); }

test('commitStage sweeps the banners held at staging, not the ones the incoming view adds', async () => {
	const t = boot();
	t.r.seed();
	const outgoing = banner(t.main);
	const incoming = el(); incoming.className = 'alert-message';
	t.L.require = () => { t.main.appendChild(incoming); return Promise.resolve(new t.V()); };
	assert.ok(t.r.navigate(PATH('admin', 'status', 'B'), true));
	await flush();
	assert.notEqual(outgoing.parentNode, t.main, 'the outgoing page banner goes');
	assert.equal(incoming.parentNode, t.main, 'a banner the incoming view raised survives the commit');
});

test('the page spared while staging is the one on screen, not a superseded target', async () => {
	const t = boot();
	t.r.seed();
	const gB = t.gates['view.admin.status.B'] = gate();
	t.r.navigate(PATH('admin', 'status', 'B'), true);
	await flush();
	t.r.navigate(PATH('admin', 'status', 'C'), true);
	gB.ok(new t.V());
	await flush();
	const forC = t.scopes.find((a) => a[0].join('/') === 'admin/status/C');
	assert.ok(forC, 'C reached sheet scoping');
	assert.deepEqual(forC[1], A, 'A is on screen, B never committed');
});

test('popstate on the same path with no query adopts the entry and does not navigate', () => {
	const t = boot();
	t.r.wire();
	let asked = 0;
	t.tree.segsFromPath = () => { asked++; return null; };
	t.popstate();
	assert.equal(asked, 0, 'no navigation');
	assert.equal(t.reloads(), 0);
	assert.equal(t.win.history.replaced.length, 1, 'the null-state entry is stamped with an id');
});

test('popstate on the boot query is the same page; another query still reloads', () => {
	const t = boot({ search: '?q=1' });
	t.r.wire();
	t.popstate();
	assert.equal(t.reloads(), 0, 'a # link on a ?query page must not reload it');
	assert.equal(t.win.history.replaced.length, 1);
	t.win.location.search = '?q=2';
	t.popstate();
	assert.equal(t.reloads(), 1);
});

test('Back resets only the scroller axis the saved position does not carry', async () => {
	const t = boot({ state: { fsid: 'a' } });
	t.r.seed();
	t.r.wire();
	t.main.scrollTop = 300;
	t.win.history.state = { fsid: 'b' };
	t.win.location.pathname = PATH('admin', 'status', 'B');
	t.popstate();
	await flush();
	t.main.scrolls.length = 0; t.win.scrolls.length = 0;
	t.win.history.state = { fsid: 'a' };
	t.win.location.pathname = PATH(...A);
	t.popstate();
	await flush();
	assert.deepEqual(t.win.scrolls, [ [ 0, 0 ] ], 'the window carried no offset: reset');
	assert.deepEqual(t.main.scrolls, [], '#maincontent carried 300: left for the restore');
});

test('a navigation begun inside the progress fade does not cancel the fade cleanup', () => {
	const t = boot();
	t.r.progressStart();
	t.tick(150);
	t.r.progressEnd();
	const bar = t.body.children.find((c) => c.id === 'fs-nav-progress');
	assert.equal(bar.dataset.state, 'done');
	t.tick(10);
	t.r.progressStart();
	t.tick(10);
	t.r.progressEnd();
	t.tick(300);
	assert.equal(bar.dataset.state, undefined, 'done is removed');
});
test('a slow navigation begun inside the progress fade restarts the bar from zero', () => {
	const t = boot();
	t.r.progressStart();
	t.tick(150);
	const bar = t.body.children.find((c) => c.id === 'fs-nav-progress');
	const log = [];
	bar.dataset = new Proxy({ ...bar.dataset }, {
		set(o, k, v) { log.push(v); o[k] = v; return true; },
		deleteProperty(o, k) { log.push('delete'); delete o[k]; return true; }
	});
	const gcs = globalThis.getComputedStyle;
	globalThis.getComputedStyle = (e) => { if (e === bar) log.push('flush'); return gcs(e); };
	try {
		t.r.progressEnd();
		t.tick(10);
		t.r.progressStart();
		t.tick(150);
	} finally { globalThis.getComputedStyle = gcs; }
	assert.deepEqual(log, [ 'done', 'delete', 'flush', 'active' ],
		"'done' is cleared and its style committed before 'active', or the bar shrinks from full width");
});

/* Back onto an entry that saved 300 on #maincontent: the restore is armed and waiting for height */
async function armedRestore() {
	const t = boot({ state: { fsid: 'a' } });
	t.r.seed();
	t.r.wire();
	t.main.scrollTop = 300;
	t.win.history.state = { fsid: 'b' };
	t.win.location.pathname = PATH('admin', 'status', 'B');
	t.popstate();
	await flush();
	t.win.history.state = { fsid: 'a' };
	t.win.location.pathname = PATH(...A);
	t.popstate();
	await flush();
	const armed = () => t.win.listeners.some((l) => l.type === 'scroll');
	assert.ok(armed(), 'the restore waits for the page to grow');
	return { t, armed, scroll: (target) => t.win.listeners.filter((l) => l.type === 'scroll').forEach((l) => l.fn({ target })) };
}

test('a scroll inside a textarea or an overflow table does not cancel the Back restore', async () => {
	const { t, armed, scroll } = await armedRestore();
	scroll(el('textarea'));
	assert.ok(armed(), 'only #maincontent is the reader\'s scroller');
	scroll(t.main);
	assert.ok(!armed(), 'the reader moving the shell\'s column still wins');
});

test('a navigation refused for want of .fs-content leaves the one in flight alone', async () => {
	const t = boot();
	t.r.seed();
	const outgoing = banner(t.main);
	const gB = t.gates['view.admin.status.B'] = gate();
	assert.ok(t.r.navigate(PATH('admin', 'status', 'B'), true));
	await flush();
	const query = t.doc.querySelector;
	t.doc.querySelector = () => null;
	assert.equal(t.r.navigate(PATH('admin', 'status', 'C'), true), false, 'no column to stage into');
	t.doc.querySelector = query;
	gB.ok(new t.V());
	await flush();
	assert.notEqual(outgoing.parentNode, t.main, 'B still commits: the refusal did not supersede it');
});
