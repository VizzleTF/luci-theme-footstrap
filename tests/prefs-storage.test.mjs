/* fs-prefs keeps a choice in memory when the browser refuses to store it. Before that, lsSet threw
 * into a swallow and lsGet read the router default back, so Save to router sent the defaults
 * instead of the look on screen. localStorage is a bare global in the module, set on globalThis. */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './lib/luci-module.mjs';

const real = globalThis.localStorage;
afterEach(() => {
	if (real === undefined) delete globalThis.localStorage;
	else globalThis.localStorage = real;
});

function refusing() {
	const boom = () => { throw new Error('QuotaExceededError'); };
	globalThis.localStorage = { getItem: boom, setItem: boom, removeItem: boom };
}

function working() {
	const m = new Map();
	globalThis.localStorage = {
		getItem: (k) => (m.has(k) ? m.get(k) : null),
		setItem: (k, v) => m.set(k, String(v)),
		removeItem: (k) => m.delete(k)
	};
}

let prefs;
beforeEach(() => { prefs = loadModule('fs-prefs'); });

test('a refused write is read back from memory and flags the storage as broken', () => {
	refusing();
	prefs.lsSet('fs-palette', 'forum');
	assert.equal(prefs.lsGet('fs-palette'), 'forum');
	assert.equal(prefs.storageBroken(), true);
});

test('a refused delete drops the in-memory value', () => {
	refusing();
	prefs.lsSet('fs-palette', 'forum');
	prefs.lsDel('fs-palette');
	assert.equal(prefs.lsGet('fs-palette'), null);
});

test('working storage is not shadowed by memory', () => {
	working();
	prefs.lsSet('fs-palette', 'forum');
	assert.equal(localStorage.getItem('fs-palette'), 'forum');
	assert.equal(prefs.lsGet('fs-palette'), 'forum');
	assert.equal(prefs.storageBroken(), false);
});
