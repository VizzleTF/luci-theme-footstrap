#!/usr/bin/env node
/* A ratchet on what the ROUTER SENDS: the bytes of the shipped stylesheet and of the shipped JS.
 *
 * uhttpd serves /www with no compression, so identity bytes ARE wire bytes, read off flash and
 * pushed by a single-core CPU that is also routing packets. The theme has no build step a developer
 * runs before committing — the package build is where cascade.css is concatenated, the private
 * token names are mangled and terser goes over the JS — so nothing in a normal edit-and-check loop
 * shows what the artefact weighs, which is the shape a number drifts in.
 *
 * So this gate reproduces the package build's asset half and weighs the result.
 *
 * Usage: node tools/size-budget.mjs [--show] */
import { cpSync, mkdtempSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCss, ROOT } from './lib/css.mjs';
import { coldModules } from './lib/page-modules.mjs';

const SHOW = process.argv.includes('--show');

const LIMITS = {
	/* The CSS budget, measured after the token mangle: 127,142 B on 2026-08-21, the last 1.5 KB of
	 * it the 2020 colourway and two forum-reported fixes. The headroom is deliberate and small: a
	 * feature's worth of rules should fit without a gate edit, a redesign's should not. A raise wants
	 * a line saying what bought it — a palette is the one feature that cannot be cheaper, every
	 * token being declared per mode or the block does not fully apply.
	 *
	 * 125,795 B on 2026-08-27, down 1,051 B when the squeeze learned that `>` is a delimiter like
	 * `{` and `,`: 516 child combinators were carrying a space either side.
	 *
	 * 127,699 B on 2026-08-30, up 299 B for the Overview card restyle: the key/value dividers gone,
	 * the label demoted below the figure it introduces, the active interface head saying "up" in the
	 * status colour instead of a full-bleed accent fill, and the data tables one step tighter. All
	 * of it keyed on the SHAPE of a table rather than on the three cards the grid used to name, so a
	 * third-party include of the same shape gets it too. */
	cascadeCss: 128_000,
	/* The FLASH cost of the shipped modules, terser with top-level mangling: every module ships,
	 * whether or not a given page loads it. 86,737 B on 2026-08-27.
	 *
	 * This one goes UP whenever a module splits: 337 B when the Appearance axes moved to
	 * `fs-axes.js`, another 432 B when the search palette stopped being required on every page and
	 * its recents bookkeeping moved into the loader. Both are the same trade, and that was the
	 * trade: a second module costs its own prologue and its own export names, and it took 5.7 KB
	 * off what every page DOWNLOADS. Flash is the cheaper side — a JFFS2 or UBIFS overlay
	 * compresses it at about 0.39x, while uhttpd sends the wire bytes uncompressed at 1.0x, so a
	 * byte moved off the cold path is worth more than a byte added to flash. Earlier the same day
	 * it came down 2,567 B on the refactor
	 * described below — it shrinks flash as well as the wire, because the two upload flows and the
	 * three list axes each became one and four repeated messages became four constants. A raise
	 * wants a line saying what bought it.
	 *
	 * 87,905 B on 2026-08-29, up 305 B for three faults in how the reader's place is kept, all three
	 * on the engine no CI job looks at: the poll's put-off pass moved the page 58px under the reader
	 * on ImmortalWrt 24.10/WebKit and nothing was measuring it; the floor was rewritten on every
	 * container every tick, which is a scroll-anchoring suppression trigger — 1550 style writes per
	 * 25 s of polling, 75 of them carrying a value that had moved, now 45 and all real; and the floor
	 * was written on table boxes, where WebKit ignores `min-height` and the document lost 284px.
	 *
	 * 88,426 B on 2026-08-29, up 476 B for `watchThemeColor()`: the browser's own chrome — a mobile
	 * address bar, the Android task-switcher card, an installed PWA's title bar — painted white over
	 * a dark page, because the theme shipped no `<meta name="theme-color">` and a static one cannot
	 * follow a palette. One observer on :root covers all 25 axes; a call in each applier would have
	 * been the cheaper bytes and the more expensive rule.
	 *
	 * 88,701 B on 2026-08-30, up 219 B for `swapIn()`: the router's commit is wrapped in a view
	 * transition, so a navigation cross-fades where the browser has the API and cuts where it does
	 * not. The bytes are the feature — there is no CSS-only form of it, the animation has to be
	 * started from the one synchronous frame in the navigation. The 32 B ahead of it came in with
	 * `fix(fit): see a table that grew past its parent`, which raised no budget.
	 *
	 * 89,347 B on 2026-08-30, up 646 B for the companion-package seam. Three parts, measured
	 * separately: `fs-search` builds its result pool from its own index PLUS the functions on
	 * `window.__fsSearchSources`, and calls a row's `onTake()` when it is chosen (427 B, and the
	 * palette is lazy, so this half is flash only); the chrome requires whatever
	 * `footstrap.settings.plugin` names (205 B); `fs-menutree` exports raw node presence, which is
	 * what lets a plugin gate a command on the menu node carrying its ACL group (14 B). It buys
	 * section search and the `:` command line WITHOUT either shipping in the theme — the first
	 * consumer, `luci-app-footstrap-palette`, weighs 12,970 B and none of it is here.
	 *
	 * 89,522 B on 2026-08-31, up 122 B for the recents list keying rows instead of paths: the
	 * palette can recall a SECTION now, which had no key of its own and so left only the page it
	 * sits on in the list. 53 B in `fs-search` (resolve a recent row against the pool, not the
	 * index) and 69 B in `menu-footstrap-common` (`remember()` takes a key and is exported for the
	 * source that produced the row; `warmRecent()` warms the page half of one).
	 *
	 * 89,663 B on 2026-08-31, up 141 B: `putBack()` re-reads where the element actually landed, not
	 * only the offset. A write the page clamped short stops the element somewhere other than the top
	 * it was remembered at, and every later tick then corrects to a position nothing can reach — 12px
	 * and 52px of reader, webkit/Overview @390 top. Two rects on a layout the write has already
	 * forced; the third field the memo carries, `_rest.at`, is NOT written, and the sweep is green
	 * on all 18 cells of that axis without it.
	 *
	 * 89,691 B on 2026-08-31, up 28 B: `naturalHeight()` refuses a box with no height of its own, so
	 * the floor stops pinning a collapsed tab pane open — 893px of hidden pane on Network ->
	 * Interfaces, and the active pane's content that far down the page (issue #41). One rect field,
	 * on a rect the function already reads.
	 *
	 * 89,989 B on 2026-08-31, up 298 B: the Appearance tab names the translation package when the
	 * router has not got it — the other half of issue #41, since the catalogues are their own
	 * packages now and nothing else on a router can say which one is missing. `fs-appearance` is
	 * required on ONE page, so this is flash rather than a cold download.
	 *
	 * 90,149 B on 2026-09-01, up 160 B: a box the reader cannot see gives its floor back, so a tab
	 * pane stops carrying the height it had while it was open — 1265px of dead page on Network ->
	 * Interfaces, and the reader's tab starting below it (issue #41 again). The style the climb
	 * already resolves is kept rather than re-read, and the pass carries one more array.
	 *
	 * 90,690 B on 2026-09-01, up 541 B: the floor is measured to the end of the CONTENT and is given
	 * back when a container empties for good — 41px of floor missing under the reader on
	 * /admin/network/dhcp, 1299px of it holding blank page on Network -> Interfaces. Three parts, and
	 * `tools/floor-contract.mjs` measures each: a Range over the tail after the last element, the
	 * `data-fs-floor` mark that lets the sweep find a floor whose box has left the selector, and the
	 * one scheduled second pass, without which nothing revisits a page that has stopped mutating.
	 *
	 * 90,978 B on 2026-09-01, up 288 B: a table inside a box the APP scrolls is left as a table
	 * (docs/third-party-apps.md rule 9) — luci-app-filemanager's listing came out as cards on a
	 * 1280px screen with 1224px of column beside it. A walk from the table to the content root,
	 * asked once per decision.
	 *
	 * 90,861 B on 2026-09-01, DOWN 117 B, and the two halves are unrelated. `swapIn()` is gone with
	 * the view transition it started, which cost the reader up to 3,728 ms of the page they had
	 * navigated away from on WebKit (docs/spa-router.md); fs-fit spends most of it back on a third
	 * observer, for `data-tab-active` — a tab switch mutates no node, so nothing woke the sweep and
	 * the outgoing pane held its floor: 2432px of blank above System -> Startup's textarea, for the
	 * life of a page that does not poll. */
	resourcesJs: 90_861,
	/* …and this is what a cold page DOWNLOADS, which is the number that matters on a link the router
	 * is also routing packets over: the set walked from the footer's two entry points
	 * (tools/lib/page-modules.mjs, coldModules()). 73,918 B on 2026-08-27.
	 *
	 * The number came DOWN 302 B on the day the walk replaced the page-module map, and nothing
	 * bought it: the map names the two modules the loader pulls per page, so a module reached only
	 * from one of those was counted cold while no cold page fetches it. `fs-version.js` is the
	 * standing example — 281 B required by `fs-appearance` alone, charged to every page.
	 *
	 * 65,257 B on 2026-08-27, down 8,939 B across one refactor — 12% of what every admin page used
	 * to fetch. Two things were being downloaded everywhere to be used in one place: the upload
	 * machinery (a DOMParser pass, a canvas re-encode, a chmod and a rollback) now in
	 * `fs-assets.js`, and the colour engine (a probe, a canvas, the WCAG arithmetic and the colour
	 * control) now in `fs-appearance.js` itself — `colorControl` was fs-widgets' only colour export
	 * and the Appearance form its only caller, while the menu and the search palette, which are on
	 * every page, use four icon and disclosure helpers and nothing else. The rest is the two upload
	 * flows collapsed onto one factory and palette/wallpaper/density onto the axis factory the
	 * other four axes already used. Lowering it whenever the number comes down is the point;
	 * raising it is a decision that wants a line saying what bought it.
	 *
	 * 54,953 B on 2026-08-29, up 353 B against the 54,600 B it replaced: `fs-fit.js` is on the cold path, and this is the wire half
	 * of the three anchoring fixes the flash budget above spells out. The reader losing their place
	 * on a poll tick is the fault users report; 353 B is what answering it on WebKit costs.
	 *
	 * 55,474 B on 2026-08-29, up 474 B: `fs-prefs.js` is on the cold path and carries the
	 * theme-color repaint the flash budget above spells out. Every page pays it because every page
	 * is the one a phone may be showing.
	 *
	 * 55,749 B on 2026-08-30, up 219 B: `fs-router.js` is on the cold path and carries the view
	 * transition around the swap that the flash budget above spells out; 30 B of the rise is the
	 * table-overflow fix that preceded it.
	 *
	 * 55,968 B on 2026-08-30, up 219 B: the cold half of the companion-package seam the flash
	 * budget above spells out — the chrome's require of the named plugins (205 B) and
	 * `fs-menutree`'s new export (14 B). The 427 B in `fs-search` is NOT here, which is the whole
	 * reason a source registers through a global instead of requiring the palette: a page where
	 * nobody opens the palette must not download it.
	 *
	 * 56,018 B on 2026-08-30, up 18 B: `swapIn()` takes the view transition's `finished` promise as
	 * well as `ready`. `finished` rejects with whatever the update callback threw, so leaving it
	 * alone turns one fault into two console lines — measured on a page whose callback throws: two
	 * `pageerror`s with only `ready` handled, one with both.
	 *
	 * 56,129 B on 2026-08-31, up 69 B: the cold half of the recents change the flash budget above
	 * spells out. `menu-footstrap-common` is on every page because the list has to be written on
	 * every navigation; `fs-search`'s 53 B is not here, the palette still being fetched on the
	 * first gesture.
	 *
	 * 56,270 B on 2026-08-31, up the same 141 B as the flash budget: `fs-fit.js` is on the cold path
	 * and carries the whole anchoring fix — every page is one a poll tick can move under the reader.
	 *
	 * 56,298 B on 2026-08-31, up the same 28 B: the floor lives in `fs-fit.js`, on the cold path.
	 *
	 * 56,458 B on 2026-09-01, up the same 160 B: releasing that floor is in `fs-fit.js` too.
	 *
	 * 56,999 B on 2026-09-01, up the same 541 B: still `fs-fit.js`, still on every page.
	 *
	 * 57,287 B on 2026-09-01, up the same 288 B: `fs-fit.js` and `fs-select.js`, both cold.
	 *
	 * 57,170 B on 2026-09-01, down the same 117 B: `fs-router.js` and `fs-fit.js` are both cold, and
	 * the transition coming out is worth more than the tab observer going in. */
	coldJs: 57_170,
};

function bytes(path) {
	return statSync(path).size;
}

/* the stylesheet exactly as Build/Prepare leaves it: concatenated, then token-mangled */
function shippedCss() {
	const out = buildCss();
	execFileSync(join(ROOT, 'luci-theme-footstrap/mangle-tokens.sh'), [
		out,
		join(ROOT, 'luci-theme-footstrap/htdocs/luci-static/resources'),
		join(ROOT, 'luci-theme-footstrap/ucode')
	], { stdio: SHOW ? 'inherit' : 'ignore' });
	return { path: out, size: bytes(out) };
}

/* the JS exactly as tools/stage.sh leaves it. Over a COPY, never the checkout: minify-js.mjs
 * rewrites in place, and pointing it at the source tree would mangle and comment-strip it. */
function shippedJs() {
	const dir = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), 'fs-js-'));
	const res = join(dir, 'resources');
	cpSync(join(ROOT, 'luci-theme-footstrap/htdocs/luci-static/resources'), res, { recursive: true });
	/* the gate-only exports go FIRST, exactly as tools/stage.sh:75 does it — the marker is a
	 * comment and terser takes every comment with it, so a run that minified first would weigh a
	 * surface the router never receives. Measured: 115 B of difference, which is enough to fail a
	 * budget over bytes that do not ship. */
	execFileSync(join(ROOT, 'luci-theme-footstrap/strip-probes.sh'), [ res ],
		{ stdio: SHOW ? 'inherit' : 'ignore' });
	execFileSync(process.execPath, [ join(ROOT, 'tools/minify-js.mjs'), res ],
		{ stdio: SHOW ? 'inherit' : 'ignore' });
	/* What a cold visit fetches, walked from the footer's two `L.require()` calls rather than read
	 * off the page-module map. The map names the two modules the loader pulls per page, but a
	 * module reached only from one of those is just as absent from a cold visit — and counting the
	 * map alone charged every page for `fs-version.js`, which only `fs-appearance` requires. */
	const cold = new Set([ ...coldModules() ].map((n) => n + '.js'));
	const lazy = new Set(readdirSync(res).filter((f) => f.endsWith('.js') && !cold.has(f)));
	const files = readdirSync(res).filter((f) => f.endsWith('.js'))
		.map((f) => ({ name: f, size: bytes(join(res, f)), lazy: lazy.has(f) }))
		.sort((a, b) => b.size - a.size);
	return {
		files,
		size: files.reduce((n, f) => n + f.size, 0),
		cold: files.filter((f) => !f.lazy).reduce((n, f) => n + f.size, 0)
	};
}

const css = shippedCss();
const js = shippedJs();

const kb = (n) => (n / 1024).toFixed(1) + ' KB';

if (SHOW) {
	console.log('\ncascade.css  ' + kb(css.size).padStart(9) + '  (limit ' + kb(LIMITS.cascadeCss) + ')');
	console.log('resources/   ' + kb(js.size).padStart(9) + '  (limit ' + kb(LIMITS.resourcesJs) + ', on flash)');
	console.log('  cold page  ' + kb(js.cold).padStart(9) + '  (limit ' + kb(LIMITS.coldJs) + ', what a visit downloads)');
	for (const f of js.files) console.log('   ' + kb(f.size).padStart(9) + '  ' + f.name + (f.lazy ? '   (page module)' : ''));
	console.log('cold total   ' + kb(css.size + js.cold).padStart(9) + '\n');
}

const over = [];
if (css.size > LIMITS.cascadeCss)
	over.push(`cascade.css is ${css.size} B, over its ${LIMITS.cascadeCss} B budget by ${css.size - LIMITS.cascadeCss} B`);
if (js.cold > LIMITS.coldJs)
	over.push(`a cold page downloads ${js.cold} B of JS, over its ${LIMITS.coldJs} B budget by ${js.cold - LIMITS.coldJs} B`);
if (js.size > LIMITS.resourcesJs)
	over.push(`the shipped JS is ${js.size} B, over its ${LIMITS.resourcesJs} B budget by ${js.size - LIMITS.resourcesJs} B`
		+ ' (largest: ' + js.files.slice(0, 3).map((f) => f.name + ' ' + kb(f.size)).join(', ') + ')');

if (over.length) {
	console.error('\nsize-budget: the router would send more than the budget allows\n');
	for (const line of over) console.error('  ' + line);
	console.error('\nEvery byte here is flash read and CPU on a device that is also routing packets.'
		+ '\nIf the feature is worth it, raise the number in tools/size-budget.mjs and say what it bought.\n');
	process.exit(1);
}

console.log(`ok — cascade.css ${kb(css.size)}, shipped JS ${kb(js.size)} on flash and ${kb(js.cold)} on a cold page, all within budget.`);
