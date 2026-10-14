/* fs-appearance's colour observer lives exactly as long as its page: the next navigation ends it.
 * Before, it ended on the next relevant :root stamp after the page left, so N visits with no stamp
 * in between kept N observers (and N-1 detached forms) alive. watchColours() is the one export
 * (`fs:probe`) a test can reach; build() needs a browser. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModule, fakeL, fakeWindow, fakeDocument } from './lib/luci-module.mjs';

const observers = [];
globalThis.MutationObserver = class {
	constructor(cb) { this.cb = cb; this.live = false; observers.push(this); }
	observe(target, opts) { this.live = true; this.target = target; this.opts = opts; }
	disconnect() { this.live = false; }
};

function boot() {
	observers.length = 0;
	const navCbs = [];
	const doc = fakeDocument();
	const mod = loadModule('fs-appearance', { L: fakeL(), window: fakeWindow(), document: doc,
		stubs: { 'fs-router': { onNavigate: (fn) => navCbs.push(fn) } } });
	return { mod, doc, navigate: () => navCbs.forEach((fn) => fn([ 'admin', 'status', 'overview' ])) };
}

test('the observer watches :root and calls back on a stamp', () => {
	const t = boot();
	let calls = 0;
	t.mod.watchColours(() => { calls++; });
	assert.equal(observers.length, 1);
	assert.equal(observers[0].target, t.doc.documentElement);
	assert.deepEqual(observers[0].opts.attributeFilter, [ 'data-darkmode', 'data-palette', 'data-wallpaper' ]);
	observers[0].cb();
	assert.equal(calls, 1);
});

test('a navigation ends the observer with no stamp needed', () => {
	const t = boot();
	t.mod.watchColours(() => {});
	assert.equal(observers[0].live, true);
	t.navigate();
	assert.equal(observers[0].live, false, 'the page is gone; so is its observer');
});

test('visits do not accumulate observers', () => {
	const t = boot();
	for (let i = 0; i < 5; i++) { t.mod.watchColours(() => {}); t.navigate(); }
	t.mod.watchColours(() => {});
	assert.equal(observers.filter((o) => o.live).length, 1, 'only the visit on screen');
});

test('a render the router superseded does not orphan the observer before it', () => {
	const t = boot();
	t.mod.watchColours(() => {});
	t.mod.watchColours(() => {});
	assert.equal(observers.filter((o) => o.live).length, 1, 'the second build replaced the first');
	t.navigate();
	assert.equal(observers.filter((o) => o.live).length, 0);
});
