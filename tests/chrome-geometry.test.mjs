/* The chrome's cut, asked once and answered the same way twice.
 *
 * "How wide is the content column" is asked in two places for two reasons: `fitShell()` decides
 * whether the sidebar still fits beside it, and `contentWidth()` answers a table's mid-scroll
 * question, where reading layout is forbidden. They are the same arithmetic — the window less the
 * sidebar (or the rail, or nothing) less the shell's gutter — and written twice they drifted:
 * the gutter shellGeometry() returns is already both sides, and contentWidth subtracted it a
 * second time: 56 CSS px of column that does not exist. And `data-narrow` is not the only chrome
 * with no sidebar beside it — fitShell returns early on the top-BAR layout, so contentWidth, which
 * read only that attribute, went on subtracting a 224px sidebar from a window that has none.
 *
 * Neither shows in a screenshot: the wrong answer matters only across fs-select's CRAMPED
 * threshold, where it cards a table that had room. That the inputs describe the real page is
 * checked on a stand: tools/live-audit.mjs compares contentWidth() against the live `.fs-content`. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModule, fakeDocument, installBrowserGlobals } from './lib/luci-module.mjs';

installBrowserGlobals();

const chrome = () => loadModule('fs-chrome', { stubs: { 'fs-prefs': { lsGetArr: () => [] } } });

/* what shellGeometry() returns at the default density — contentPad is the gutter of BOTH sides,
 * measured off `.fs-content` (GEOM_DFLT's 56 until the first measurement) */
const G = { contentMin: 500, sidebarW: 224, railW: 68, contentPad: 56 };

function width(state) {
	return chrome().columnWidth(G, Object.assign({ narrow: false, top: false, rail: false }, state));
}

test('the sidebar and ONE gutter come off the window', () => {
	assert.equal(width({ outerW: 1280 }), 1000);
	/* the number fs-select's comment quotes: an 800px window is a 520px column */
	assert.equal(width({ outerW: 800 }), 520);
});

test('the rail is a narrower sidebar, not a missing one', () => {
	assert.equal(width({ outerW: 800, rail: true }), 800 - G.railW - G.contentPad);
});

test('a narrow shell has the chrome above the content, so nothing is cut', () => {
	assert.equal(width({ outerW: 800, narrow: true }), 800 - G.contentPad);
	assert.equal(width({ outerW: 800, narrow: true, rail: true }), 800 - G.contentPad,
		'the rail preference is meaningless once the sidebar is a bar');
});

test('the top-bar layout has no sidebar either, and it carries no data-narrow', () => {
	/* fitShell() returns early on this layout AND removes data-narrow, so `narrow` is false here —
	 * which is exactly how 224px went on being subtracted from a window with no sidebar in it */
	assert.equal(width({ outerW: 900, top: true }), 900 - G.contentPad);
	assert.equal(width({ outerW: 900, top: true, rail: true }), 900 - G.contentPad);
});

test('the gutter is whatever the sheet gave the column, not what the token says', () => {
	/* `theme/20-shell.css` re-paddings `.fs-content` to `--fs-space-4` below 767px, so the gutter
	 * there is 16px a side against the token's 28 — a 24px error the model carried on every phone
	 * width until `live-audit` reported it at 320, 390 and 568 on every page. Hence `g.contentPad`
	 * is MEASURED off the element (see contentGutter in fs-chrome.js) and this function only ever
	 * subtracts what it is handed. The breakpoint itself never enters the JS. */
	const phone = Object.assign({}, G, { contentPad: 32 });
	assert.equal(chrome().columnWidth(phone, { outerW: 390, narrow: true, top: false, rail: false }), 358);
	assert.equal(chrome().columnWidth(phone, { outerW: 568, narrow: true, top: false, rail: false }), 536);
});

test('an omitted flag means the sidebar is there', () => {
	/* fitShell() calls this with `{ outerW, rail }` and nothing else, deliberately: it is the pass
	 * that DECIDES `data-narrow`, so it may not read it, and the top layout returned before it got
	 * here. Anything that made an absent flag mean something other than "sidebar present" would
	 * move the fold threshold without touching a line of fitShell. */
	assert.equal(chrome().columnWidth(G, { outerW: 800, rail: false }), 520);
	assert.equal(chrome().columnWidth(G, { outerW: 800, rail: true }), 800 - G.railW - G.contentPad);
});

test('a column is never negative', () => {
	assert.equal(width({ outerW: 10 }), 0);
});

test('the fold threshold is the same arithmetic fitShell folds on', () => {
	/* fitShell(): data-narrow iff the column is under --fs-content-min. At exactly the floor the
	 * sidebar stays — the comparison is `<`, and this is the boundary a token change moves. */
	const floor = G.sidebarW + G.contentPad + G.contentMin;
	assert.equal(width({ outerW: floor }), G.contentMin);
	assert.equal(width({ outerW: floor - 1 }) < G.contentMin, true);
});

/* contentWidth() answers off the width fitChrome() last measured, and fitChrome() stands aside for
 * the whole SCROLL_IDLE window when a resize lands mid-flick — so the one read it makes itself is the
 * window's width, compared against the cached one. Measured before this: 568px reported for a 390px
 * viewport for up to 220ms after the rotate, and fs-select judged a table to have room it did not. */
test('contentWidth() notices a window that changed width with no fitter having run', () => {
	const root = { clientWidth: 1280, getAttribute: () => null, hasAttribute: () => false, setAttribute() {},
		dataset: {}, style: { getPropertyValue: () => '' },
		classList: { add() {}, remove() {}, contains: () => false } };
	const doc = fakeDocument({ documentElement: root, body: { appendChild() {}, getAttribute: () => null },
		querySelector: () => ({}),
		createElement: () => ({ style: { setProperty() {} }, setAttribute() {} }) });
	const c = loadModule('fs-chrome', { document: doc,
		stubs: { 'fs-prefs': { isTopLayout: () => false, currentRail: () => false, lsGetArr: () => [] } } });
	assert.equal(c.contentWidth(), 1280 - G.sidebarW - G.contentPad);
	root.clientWidth = 800;
	assert.equal(c.contentWidth(), 800 - G.sidebarW - G.contentPad, 'the rotate is seen on the next call');
});

/* ui.showIndicator rewrites a pill's label in place (`firstChild.data = label`) when the text
 * differs: Refreshing to Paused, the change counter. That is a characterData record, no childList,
 * and with polling paused nothing else wakes the fit — the bar kept the wrap of the old width. */
test('the #indicators observer re-fits the bar on a label change, not only on a pill arriving', () => {
	const realMO = globalThis.MutationObserver;
	const observers = [];
	globalThis.MutationObserver = class {
		constructor(cb) { this.cb = cb; observers.push(this); }
		observe() {}
	};
	try {
		const box = { querySelectorAll: () => [] };
		const doc = fakeDocument({ getElementById: (id) => (id === 'indicators' ? box : null) });
		let fits = 0;
		const c = loadModule('fs-chrome', { document: doc, stubs: {
			'fs-fit': { scrolling: () => { fits++; return true; }, deferMeasurement() {} },
			'fs-prefs': { lsGetArr: () => [] }, 'fs-menutree': {}, ui: {} } });
		c.wireIndicatorCounts();
		const mo = observers.at(-1);
		mo.cb([{ type: 'characterData', target: { nodeType: 3, parentNode: { nodeType: 1 } } }]);
		assert.equal(fits, 1, 'a label text change fits the chrome');
		mo.cb([{ type: 'childList', target: box }]);
		assert.equal(fits, 2, 'a pill arriving still does');
	} finally {
		globalThis.MutationObserver = realMO;
	}
});
