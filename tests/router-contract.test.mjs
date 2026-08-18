/* fs-router's BOOT CONTRACT: the router must turn itself off on a luci-base that moved.
 *
 * Why this is a unit test and not a stand run: the fault it guards is a luci-base this repo does not
 * have. Both stands ship the surfaces, so a live check can only ever see the healthy branch — the
 * only way to exercise the OFF branch is to hand the module an `L` with a hole in it, which is
 * exactly what a hostile fork or a trimmed distribution does at someone else's house.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModule, fakeL, fakeUi, fakeWindow, fakeDocument } from './lib/luci-module.mjs';

function router({ L, window, document, ui } = {}) {
	const win = window || fakeWindow();
	const doc = document || fakeDocument();
	const luci = L || fakeL();
	win.L = luci;
	return loadModule('fs-router', {
		L: luci, window: win, document: doc,
		stubs: {
			ui: ui || fakeUi(),
			rpc: { addInterceptor() {} },
			/* the tree answers "this page is not in the menu", the branch wire() treats as a
			 * wildcard page — i.e. the one that goes on to wire the listeners */
			'fs-menutree': { currentNode: () => null, segsFromPath: () => null, resolveSegs: () => null,
				viewClassFor: () => null, tree: () => null },
			'fs-chrome': { syncActive() {}, renderTabMenu() {} },
			'fs-sheets': { watchViewSheets() {}, pageIsPoisoned: () => false }
		}
	});
}

test('a complete luci-base breaks no contract entry', () => {
	assert.deepEqual(router().contractBreaks(), []);
});

test('each missing surface is named, and only that one', () => {
	const cases = [
		[ 'L.require', (L) => { delete L.require; } ],
		[ 'L.Class', (L) => { delete L.Class; } ],
		[ 'L.dom.content', (L) => { L.dom = {}; } ],
		[ 'L.Poll.queue', (L) => { L.Poll.queue = null; } ],
		[ 'L.Poll.start/stop', (L) => { delete L.Poll.stop; } ],
		[ 'L.Request.addInterceptor', (L) => { L.Request = {}; } ]
	];
	for (const [ name, breakIt ] of cases) {
		const L = fakeL();
		breakIt(L);
		assert.deepEqual(router({ L }).contractBreaks(), [ name ],
			'breaking ' + name + ' must report exactly that name');
	}
});

test('a missing L.env key is reported even though L.env itself is there', () => {
	const L = fakeL();
	delete L.env.nodespec;
	const broken = router({ L }).contractBreaks();
	assert.equal(broken.length, 1);
	assert.match(broken[0], /L\.env/);
});

test('a gone ui method is reported', () => {
	const ui = fakeUi();
	delete ui.instantiateView;
	assert.deepEqual(router({ ui }).contractBreaks(), [ 'ui.instantiateView' ]);
});

test('an L that throws on a property read counts as missing, not as an exception', () => {
	const L = fakeL();
	Object.defineProperty(L, 'Poll', { get() { throw new Error('this luci-base is a proxy'); } });
	const broken = router({ L }).contractBreaks();
	assert.ok(broken.includes('L.Poll.queue'), 'a throwing probe must read as a break: ' + broken);
});

test('a broken contract leaves the document un-intercepted', () => {
	const L = fakeL();
	delete L.Poll.stop;
	const win = fakeWindow(), doc = fakeDocument();
	const r = router({ L, window: win, document: doc });
	const before = doc.listeners.length;
	r.wire();
	assert.equal(doc.listeners.filter((l) => l.type === 'click').length, 0,
		'no click interception may be installed when the contract is broken');
	assert.equal(doc.listeners.length, before, 'nothing at all may be wired');
	assert.equal(win.listeners.filter((l) => l.type === 'popstate').length, 0);
});

test('a healthy contract wires the click and popstate paths', () => {
	const win = fakeWindow(), doc = fakeDocument();
	const r = router({ window: win, document: doc });
	r.wire();
	assert.equal(doc.listeners.filter((l) => l.type === 'click').length, 1);
	assert.equal(win.listeners.filter((l) => l.type === 'popstate').length, 1);
});
