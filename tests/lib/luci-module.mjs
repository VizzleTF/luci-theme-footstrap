/* Load one shipped `fs-*.js` the way luci.js loads it, so a unit test can call its exports.
 *
 * A LuCI resource file is NOT an ES module and cannot be `import`ed: it has no exports, it ends in a
 * bare `return`, and its dependencies arrive as PARAMETERS named by the `'require x as y'` pragmas in
 * its directive prologue. luci.js evaluates it as the body of
 *
 *     function (window, document, L, <one param per pragma>) { … }
 *
 * with `E` and `_` reached through `window`. This reproduces exactly that call, which is the only
 * honest way to test the file that ships — a rewritten copy in ESM syntax would be a second source
 * of truth, and the interesting bugs live in the seam this wrapper IS (see tools/minify-js.mjs, where
 * the same derivation stops terser handing `L` to one of its own variables).
 *
 * The alias is derived the way luci.js derives it: the `as` name, else the dependency with every
 * non-word character replaced. A dependency with no stub is handed an empty object rather than
 * `undefined`, so a module that only reaches into an unrelated dependency at call time still loads.
 *
 * What this is NOT: a browser. There is no layout, no CSS and no event dispatch — `window` and
 * `document` here record what a module ASKS FOR (listeners, timers) and answer the few reads a
 * module makes at eval. Anything that needs a real box on a real page belongs on a stand
 * (docs/development.md), and the suite says so rather than faking a measurement.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const RESOURCES = join(ROOT, 'luci-theme-footstrap/htdocs/luci-static/resources');

/* The leading run of string-literal statements. Scanned line-wise rather than parsed: the prologue
 * is by definition the head of the file, one directive per line in this tree (eslint keeps it so),
 * and a test harness that needed a JS parser to start would be a dependency for nothing. */
function pragmas(src) {
	const out = [];
	for (const line of src.split('\n')) {
		const m = (/^\s*'([^']*)'\s*;\s*$/).exec(line);
		if (!m) break;
		if (m[1] !== 'use strict') out.push(m[1]);
	}
	return out;
}

function aliasFor(pragma) {
	const m = (/^require\s+(\S+)(?:\s+as\s+([A-Za-z_]\S*))?$/).exec(pragma);
	if (!m) return null;
	return { dep: m[1], alias: m[2] || m[1].replace(/[^A-Za-z0-9_]/g, '_') };
}

/* A listener/timer recorder with the handful of reads a module performs while it evaluates. Both
 * fakes are returned so a test can assert on what the module registered — "the router wired no click
 * listener" is the only observable difference between an active router and one that declined. */
export function fakeDocument(extra = {}) {
	const doc = {
		listeners: [],
		hidden: false,
		documentElement: { dataset: {}, setAttribute() {}, getAttribute: () => null,
			hasAttribute: () => false, classList: { add() {}, remove() {}, contains: () => false } },
		body: null,
		addEventListener(type, fn, opts) { this.listeners.push({ type, fn, opts }); },
		removeEventListener(type, fn) {
			this.listeners = this.listeners.filter((l) => !(l.type === type && l.fn === fn));
		},
		querySelector: () => null,
		querySelectorAll: () => [],
		getElementById: () => null,
		createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, classList: { add() {} } }),
		...extra
	};
	doc.body = doc.body ?? null;
	return doc;
}

export function fakeWindow(extra = {}) {
	const win = {
		listeners: [],
		intervals: new Map(),
		innerWidth: 1280,
		innerHeight: 900,
		location: { pathname: '/cgi-bin/luci/admin/status/overview', search: '', hash: '',
			href: 'http://router/cgi-bin/luci/admin/status/overview', reload() {} },
		history: { pushState() {}, replaceState() {}, state: null },
		addEventListener(type, fn, opts) { this.listeners.push({ type, fn, opts }); },
		removeEventListener(type, fn) {
			this.listeners = this.listeners.filter((l) => !(l.type === type && l.fn === fn));
		},
		setInterval(fn, ms) { const id = win.intervals.size + 1; win.intervals.set(id, { fn, ms }); return id; },
		clearInterval(id) { win.intervals.delete(id); },
		setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
		clearTimeout: (id) => globalThis.clearTimeout(id),
		requestAnimationFrame: (fn) => globalThis.setTimeout(() => fn(0), 0),
		cancelAnimationFrame: (id) => globalThis.clearTimeout(id),
		getComputedStyle: () => ({ getPropertyValue: () => '' }),
		matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
		localStorage: {
			_v: new Map(),
			getItem(k) { return this._v.has(k) ? this._v.get(k) : null; },
			setItem(k, v) { this._v.set(k, String(v)); },
			removeItem(k) { this._v.delete(k); }
		},
		...extra
	};
	return win;
}

/* A luci-base that answers every existence check the theme makes. Tests deep-copy nothing: each
 * caller gets a fresh object it is free to BREAK, which is the point (tests/router-contract). */
export function fakeL(extra = {}) {
	const L = {
		env: {
			scriptname: '/cgi-bin/luci', base_url: '/luci-static/resources', resource: '/luci-static/resources',
			media: '/luci-static/footstrap', resource_version: '1',
			dispatchpath: [ 'admin', 'status', 'overview' ], requestpath: [ 'admin', 'status', 'overview' ],
			pathinfo: '/admin/status/overview', nodespec: { readonly: false }
		},
		Class: function Class() {},
		require: () => Promise.resolve({}),
		dom: { content() {}, parse: () => null, append() {} },
		Poll: {
			queue: [], timer: null,
			active() { return this.timer != null; },
			start() { this.timer = 1; }, stop() { this.timer = null; }, add() {}, remove() {}
		},
		Request: { addInterceptor() {}, get: () => Promise.resolve({ status: 200 }) },
		url: () => '/cgi-bin/luci',
		get: () => Promise.resolve({}),
		hasSystemFeature: () => false,
		...extra
	};
	return L;
}

/* the `ui` a module reaches through its pragma — every method the theme calls, doing nothing */
export function fakeUi(extra = {}) {
	return {
		instantiateView: () => Promise.resolve({}),
		hideModal() {}, hideIndicator() {}, showIndicator() {}, addNotification() {},
		menu: { load: () => Promise.resolve({}) },
		...extra
	};
}

/* The browser objects a resource file reaches as BARE globals rather than through `window` —
 * observers above all. Node has none of them, and a module that constructs one at eval or on its
 * first call would die on a ReferenceError before a single assertion ran. Installed once, on
 * globalThis, doing nothing: a test that needs an observer to actually fire belongs on a stand,
 * where the layout it observes exists. */
export function installBrowserGlobals() {
	const noop = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
	if (typeof globalThis.MutationObserver === 'undefined') globalThis.MutationObserver = noop;
	if (typeof globalThis.ResizeObserver === 'undefined') globalThis.ResizeObserver = noop;
	if (typeof globalThis.IntersectionObserver === 'undefined') globalThis.IntersectionObserver = noop;
	if (typeof globalThis.matchMedia === 'undefined')
		globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
	if (typeof globalThis.getComputedStyle === 'undefined')
		globalThis.getComputedStyle = () => ({ getPropertyValue: () => '', overflowY: 'visible' });
}

/* Evaluate `<name>.js` from the shipped resource directory and return what it exports.
 *
 * `stubs` is keyed by the pragma's dependency name (`ui`, `rpc`, `fs-menutree`), not by the alias —
 * the alias is a local detail of the file under test and renaming one must not break a caller here.
 */
export function loadModule(name, { L, window, document, stubs = {} } = {}) {
	const src = readFileSync(join(RESOURCES, name + '.js'), 'utf8');
	const win = window || fakeWindow();
	const doc = document || fakeDocument();
	const luci = L || fakeL();

	win.L = win.L || luci;
	win.document = doc;
	win.E = win.E || ((tag) => ({ tag, appendChild() {}, setAttribute() {} }));
	win._ = win._ || ((s) => s);

	const deps = pragmas(src).map(aliasFor).filter(Boolean);
	const args = deps.map((d) => {
		if (Object.prototype.hasOwnProperty.call(stubs, d.dep)) return stubs[d.dep];
		/* baseclass is the one dependency every module has and none of them can do without: LuCI's
		 * is a class whose extend() returns the prototype, and the tests read that object. */
		if (d.dep === 'baseclass') return { extend: (o) => o };
		return {};
	});

	const factory = new Function('window', 'document', 'L', ...deps.map((d) => d.alias), src);
	return factory.call(win, win, doc, luci, ...args);
}
