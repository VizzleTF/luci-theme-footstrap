/* The surface the live gate measures through.
 *
 * tools/scroll-anchor.mjs parks the reader and then has to wait until fs-fit has taken a reference
 * at that offset — anything measured before that measures the guard, not the anchor. Nothing in the
 * page can answer it: `scrolling()` says "no" both before the motion sampler starts and after it
 * finishes, 1.5 seconds apart in WebKit. So the module exports `restAt()` and the gate waits on it.
 *
 * A rename or a drop here fails nothing: the gate's `try` swallows it, falls back to a flat wait and
 * goes green while measuring the wrong moment — which is exactly how a 60px-per-tick drift on Safari
 * stayed invisible for a release. This test is what makes that a red gate instead. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModule, installBrowserGlobals } from './lib/luci-module.mjs';

installBrowserGlobals();

const fit = () => loadModule('fs-fit', { stubs: { baseclass: { extend: (o) => o } } });

test('fs-fit exports the two the live gate waits on', () => {
	const f = fit();
	assert.equal(typeof f.scrolling, 'function', 'scrolling() is what says the page is moving');
	assert.equal(typeof f.restAt, 'function', 'restAt() is what says a reference has been taken');
});

test('restAt() is null until a still moment has been measured', () => {
	const f = fit();
	assert.equal(f.restAt(), null, 'a module that has never settled must not claim an offset');
});

test('scrolling() is false on a page nobody has touched', () => {
	const f = fit();
	assert.equal(f.scrolling(), false);
});
