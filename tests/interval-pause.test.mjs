/* A VIEW'S TIMER MUST SURVIVE A HIDDEN TAB AS ITSELF — same handle, and still the router's to sweep.
 *
 * fs-router hooks `setInterval` so a client navigation can clear what the outgoing page left
 * running, and the hidden-tab pause rides that same registry: a background tab stops calling ubus
 * for a view that polls on its own. Both are right; the way it was done was not, and neither half
 * can be seen from a stand without winning a race:
 *
 *   * the pause CLEARED each timer and re-armed it on show, which hands back a NEW id. A view that
 *     kept its id to stop its own poller (a log tailer's stop button, a teardown) was then holding
 *     a dead number: `clearInterval(id)` did nothing and the timer ran on.
 *   * the paused timers were carried in a private array, out of the registry the navigation sweep
 *     reads. Hide the tab while a navigation is in flight, come back, and the previous page's
 *     timers were armed again — for a page that no longer exists, and the sweep that would have
 *     caught them had already run.
 *
 * So a paused timer STAYS in the registry (armed on nothing) instead of leaving it, and the handle
 * the view holds keeps naming it. Driven here rather than on a stand because both faults need a
 * visibilitychange to land inside a specific window; the harness dispatches it exactly.
 */
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
	window.L = L;
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

test('LuCI\'s own 1 s tick is not paused with the view timers', () => {
	const L = fakeL();
	const { window, document } = boot({ L });
	const tick = window.setInterval(() => {}, 1000);
	L.Poll.timer = tick;			/* what L.Poll.start() leaves behind, through our hook */
	const mine = window.setInterval(() => {}, 3000);
	visibility(document, true);
	assert.equal(window.live.has(tick), true, 'L.Poll owns this one and wireVisibility stops it');
	assert.equal(window.live.has(mine), false);
});

test('a luci-base whose tick cannot be told apart pauses NOTHING', () => {
	const L = fakeL({ Poll: undefined });
	const { window, document } = boot({ L });
	const id = window.setInterval(() => {}, 3000);
	visibility(document, true);
	assert.equal(window.live.has(id), true,
		'a wasted RPC in a background tab beats re-arming LuCI\'s tick behind its back');
});

test('a timer started while the tab is hidden is left alone', () => {
	const { window, document } = boot();
	visibility(document, true);
	const id = window.setInterval(() => {}, 3000);
	visibility(document, false);
	assert.equal(window.live.has(id), true, 'it was never paused, so it is not re-armed either');
	assert.equal(window.live.size, 1, 'and it is not armed twice');
});
