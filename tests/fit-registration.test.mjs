/* fs-fit's registration run: a fitter that throws must not take the ones registered after it.
 *
 * The five passes in fs-select.js are registered separately so each fails alone, and every later run
 * goes through runAll()'s try/catch — but a bare call in `add()` lets a throw on the FIRST run
 * propagate out of init(), so the registrations behind it are never made. With the "an unanswered
 * table takes no room" gate already raised, that is a page whose data tables are `display: none`
 * permanently.
 *
 * A stand cannot show this: no shipped fitter throws, and one that did would be a bug fixed rather
 * than a case to keep. Driving `add()` directly is the only way to hold the guarantee. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModule, installBrowserGlobals } from './lib/luci-module.mjs';

installBrowserGlobals();

const fit = () => loadModule('fs-fit', { stubs: { baseclass: { extend: (o) => o } } });

test('a fitter that throws on registration does not escape add()', () => {
	const f = fit();
	assert.doesNotThrow(() => f.add(() => { throw new Error('third-party markup surprised me'); }));
});

test('the registrations after a throwing one still happen, and still run', () => {
	const f = fit();
	let ran = 0;
	f.add(() => { throw new Error('boom'); });
	f.add(() => { ran++; });
	assert.equal(ran, 1, 'a fitter registered after a throwing one must run on registration');
});

test('add() ignores anything that is not a function', () => {
	const f = fit();
	assert.doesNotThrow(() => { f.add(null); f.add('fitTables'); f.add(undefined); });
});
