/* A view's timer must survive a hidden tab as ITSELF — same handle, and still the router's to sweep.
 *
 * fs-router hooks `setInterval` so a client navigation can clear what the outgoing page left
 * running, and the hidden-tab pause rides that same registry. Both are right; the way it was done
 * was not, and neither half can be seen from a stand without winning a race:
 *
 *   * the pause CLEARED each timer and re-armed it on show, which hands back a NEW id, so a view
 *     holding its own handle to stop its poller was left with a dead number;
 *   * a paused timer carried outside the registry is one a navigation sweep cannot see, so a tab
 *     hidden across a click brings the previous page's timers back.
 *
 * So a paused timer STAYS in the registry (armed on nothing) instead of leaving it, and the handle
 * the view holds keeps naming it. Driven here rather than on a stand because both faults need a
 * visibilitychange to land inside a specific window; the harness dispatches it exactly. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModule, installBrowserGlobals, fakeWindow, fakeDocument, fakeL } from './lib/luci-module.mjs';

installBrowserGlobals();

/* A window whose timer ids are MONOTONE, like a browser's and unlike the harness's default (which
 * numbers by map size and would hand the same id back after a clear — the very confusion under
 * test). `live` is what is actually armed right now. */
function timerWindow() {
	const live = new Map();
	let next = 100;
	const win = fakeWindow({
		setInterval(fn, ms, ...rest) { const id = next++; live.set(id, { fn, ms, rest }); return id; },
		clearInterval(id) { live.delete(id); }
	});
	win.live = live;
	return win;
}

function boot(extra = {}) {
	const window = extra.window || timerWindow();
	const document = extra.document || fakeDocument();
	const L = extra.L || fakeL();
	const mod = loadModule('fs-router', { window, document, L, stubs: extra.stubs });
	return { window, document, L, mod };
}

function visibility(document, hidden) {
	document.hidden = hidden;
	document.listeners.filter((l) => l.type === 'visibilitychange').forEach((l) => l.fn());
}

test('a hidden tab stops a view\'s timer', () => {
	const { window, document } = boot();
	const id = window.setInterval(() => {}, 3000);
	assert.equal(window.live.has(id), true);
	visibility(document, true);
	assert.equal(window.live.size, 0, 'nothing may still be armed while the tab is hidden');
});

test('coming back re-arms the same callback at the same period, once', () => {
	const { window, document } = boot();
	const fn = () => {};
	window.setInterval(fn, 3000, 'arg');
	visibility(document, true);
	visibility(document, false);
	assert.equal(window.live.size, 1, 'armed again, and armed once');
	const armed = [ ...window.live.values() ][0];
	assert.equal(armed.fn, fn);
	assert.equal(armed.ms, 3000);
	assert.deepEqual(armed.rest, [ 'arg' ], 'the extra arguments a view passed are passed again');
});

test('the view can still stop its own timer after a hide/show', () => {
	const { window, document } = boot();
	const id = window.setInterval(() => {}, 3000);
	visibility(document, true);
	visibility(document, false);
	window.clearInterval(id);
	assert.equal(window.live.size, 0, 'clearInterval(id) must stop the timer it was given for');
});

test('a navigation while the tab is hidden does not bring the old page\'s timers back', () => {
	const { window, document, mod } = boot();
	window.setInterval(() => {}, 3000);
	visibility(document, true);
	/* what navigate() runs on every client navigation, once the incoming page has been staged */
	mod.clearViewIntervals();
	visibility(document, false);
	assert.equal(window.live.size, 0,
		'a timer swept by a navigation may not be re-armed when the tab comes back');
});

/* luci.js's Poll: start()/stop() arm and clear through `window` at call time, so the router's hook
 * sees the tick like any other interval */
function luciPoll(window) {
	return {
		queue: [], tick: null, timer: null,
		active() { return this.timer != null; },
		start() { if (this.timer != null) return; this.tick = 0; this.timer = window.setInterval(() => {}, 1000); },
		stop() { if (this.timer == null) return; window.clearInterval(this.timer); this.timer = null; },
		add() {}, remove() {}
	};
}

test('LuCI\'s poll is stopped while hidden and armed exactly once after N hide/show', () => {
	const window = timerWindow();
	const L = fakeL();
	L.Poll = luciPoll(window);
	const { document } = boot({ window, L });
	L.Poll.start();
	const mine = window.setInterval(() => {}, 3000);
	for (let n = 0; n < 3; n++) {
		visibility(document, true);
		assert.equal(L.Poll.active(), false, 'the poll is stopped while the tab is hidden');
		assert.equal(window.live.size, 0, 'neither its tick nor the view timer is armed');
		visibility(document, false);
		assert.equal(L.Poll.active(), true);
		assert.equal(window.live.size, 2, 'one poll tick and one view timer, never a second tick');
	}
	L.Poll.stop();
	assert.deepEqual([ ...window.live.values() ].map((t) => t.ms), [ 3000 ], 'stop() leaves only view timers');
	window.clearInterval(mine);
});

test('a manual poll pause is not undone by a hide/show', () => {
	const window = timerWindow();
	const L = fakeL();
	L.Poll = luciPoll(window);
	const { document } = boot({ window, L });
	visibility(document, true);
	visibility(document, false);
	assert.equal(L.Poll.active(), false);
});

test('a timer started while the tab is hidden is left alone', () => {
	const { window, document } = boot();
	visibility(document, true);
	const id = window.setInterval(() => {}, 3000);
	visibility(document, false);
	assert.equal(window.live.has(id), true, 'it was never paused, so it is not re-armed either');
	assert.equal(window.live.size, 1, 'and it is not armed twice');
});
