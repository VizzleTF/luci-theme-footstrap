/* THE CHROME'S CUT, asked once and answered the same way twice.
 *
 * "How wide is the content column" is asked in two places for two different reasons: `fitShell()`
 * decides whether the sidebar still fits beside it, and `contentWidth()` answers a table's
 * mid-scroll question, where reading layout is forbidden. They are the same arithmetic — the window
 * less the sidebar (or the rail, or nothing) less the shell's gutter — and they were written twice,
 * so they drifted:
 *
 *   * `--fs-content-pad` is ONE side's padding and `shellGeometry()` already doubles it. fitShell
 *     subtracted it once, contentWidth twice: 56 CSS px of column that does not exist.
 *   * `data-narrow` is not the only chrome with no sidebar beside it. fitShell returns early on the
 *     top-BAR layout (it has no sidebar to fold), and it removes the attribute on the way out — so
 *     contentWidth, which read only that attribute, went on subtracting a 224px sidebar from a
 *     window that has none.
 *
 * Both are pure arithmetic over four numbers, and neither is visible in a screenshot: the wrong
 * answer only matters when it crosses fs-select's CRAMPED threshold, and then it cards a table that
 * had room and un-cards it a moment later. So the arithmetic is one exported function and this is
 * its table. What that function may NOT check — that its inputs describe the real page — is checked
 * on a stand: tools/live-audit.mjs compares contentWidth() against the live `.fs-content` box.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModule, installBrowserGlobals } from './lib/luci-module.mjs';

installBrowserGlobals();

const chrome = () => loadModule('fs-chrome');

/* what shellGeometry() reads back from 02-tokens.css at the default density — contentPad is the
 * gutter of BOTH sides, exactly as that function returns it */
const G = { contentMin: 500, sidebarW: 224, railW: 68, contentPad: 56, contentMax: 1280 };

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

test('the column stops growing at --fs-content-max', () => {
	/* `.fs-content` is `max-width: var(--fs-content-max); margin: 0 auto`, so past that width the
	 * surplus is margin, not column. Without the cap a 2560px sidebar layout answered 2280 for a
	 * column that is 1224 wide — no caller can reach that region (both ask a lower bound), which is
	 * exactly why it needs a test rather than a reader's trust. */
	assert.equal(width({ outerW: 2560 }), G.contentMax - G.contentPad);
	assert.equal(width({ outerW: 2560, top: true }), G.contentMax - G.contentPad);
	/* and the cap does not bind before it should: at the width where window-minus-sidebar first
	 * reaches the cap, the two agree */
	assert.equal(width({ outerW: G.contentMax + G.sidebarW }), G.contentMax - G.contentPad);
	assert.equal(width({ outerW: G.contentMax + G.sidebarW - 100 }), G.contentMax - 100 - G.contentPad);
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
