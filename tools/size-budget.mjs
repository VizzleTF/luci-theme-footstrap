#!/usr/bin/env node
/* A RATCHET on what the ROUTER SENDS: the bytes of the shipped stylesheet and of the shipped JS.
 *
 * uhttpd serves /www with no compression, so identity bytes ARE wire bytes, and every one of them is
 * read off flash and pushed by a single-core CPU that is also routing packets. The theme has no
 * build step a developer runs before committing — the package build is where cascade.css is
 * concatenated, the private token names are mangled and terser goes over the JS — so nothing in a
 * normal edit-and-check loop ever shows what the artefact weighs. That is exactly the shape a number
 * drifts in: one feature at a time, each too small to argue with, none of them measured.
 *
 * So this gate reproduces the package build's asset half and weighs the result:
 *
 *   cascade.css   build-css.sh, then mangle-tokens.sh with the reserved set derived from the SOURCE
 *                 tree (Build/Prepare's own order and its own arguments — a mangle that stopped
 *                 working would show up here as +16% rather than silently)
 *   resources/*.js  a COPY of the shipped directory through tools/minify-js.mjs, which is what
 *                 tools/stage.sh runs over the staged payload for a release
 *
 * It is not a style opinion and not a cap on features: raising a limit is a decision, and it wants a
 * comment saying what was bought. Lower one whenever the number comes down, so the slack a cleanup
 * won cannot be spent silently by the next commit. (`css-metrics.mjs` is the same idea for the
 * cascade's shape; this file is the one for its weight — the size budget it once cited as precedent
 * had been dropped, and this is it back, measured on the real artefact rather than on the source.)
 *
 * Usage: node tools/size-budget.mjs [--show]
 */
import { cpSync, mkdtempSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCss, ROOT } from './lib/css.mjs';
import { pageModules } from './lib/page-modules.mjs';

const SHOW = process.argv.includes('--show');

const LIMITS = {
	/* 125,747 B measured 2026-08-18 (built 137,376, −8.5% from the token mangle) — 1.5 KB of that
	 * came from naming the hairline and the field transition, which turned 80 longhand declarations
	 * into two tokens. The headroom is deliberate and small: a feature's worth of rules should fit
	 * without a gate edit, a redesign's should not.
	 *
	 * 127,142 B measured 2026-08-21: +1.4 KB for the 2020 colourway (two full token blocks, which is
	 * what a palette costs) and 142 B for two forum-reported fixes — the realtime graph's axis
	 * labels and the air around a second heading in a card. A palette is the one feature that cannot
	 * be cheaper: every token is declared per mode or the block does not fully apply. */
	cascadeCss: 128_500,
	/* 87,347 B measured 2026-08-20 over the 14 shipped modules, terser with top-level mangling
	 * (85,671 B on 2026-08-18, before the release's own fixes). This is the FLASH cost: every module
	 * ships, whether or not a given page loads it.
	 *
	 * The last 541 B of it are the clamp the Overview kept jumping on: telling a clamped offset from
	 * a reader who scrolled and giving one back with no reference left to measure (fs-fit.js), and
	 * holding a section's height across the swap that causes it (fs-overview.js). A page that moves
	 * 200-1206px under the reader once a second is not a page anybody reads, so the bytes are worth
	 * their flash.
	 *
	 * 88,356 B measured 2026-08-21. The last 356 B are the theme's own range slider, carried for
	 * 23.05: `ui.RangeSlider` arrived in 24.10, and on the older release its absence took the whole
	 * Appearance tab with it. A widget the theme only uses where luci-base has none is the cheapest
	 * form of that support — the alternative was dropping a release that still ships on a lot of
	 * hardware. */
	resourcesJs: 88_500,
	/* …and this is what a cold page DOWNLOADS, which is the number that matters on a link the
	 * router is also routing packets over: the same set minus the page modules, which are required
	 * only on the one page each belongs to (tools/page-modules.mjs). 72,499 B measured 2026-08-20,
	 * i.e. 14.5 KB less than the sum. Raising it is a decision; lowering it whenever the number
	 * comes down is the point.
	 *
	 * The last 252 B of it are the three Status→Overview template globals, which moved OUT of the
	 * page module and into the chrome bootstrap: a page module is required during the navigation
	 * that needs it, and a stock include calling `renderBadge` before it lands throws. Ordering is
	 * not something a page module can promise, so the bytes buy it on every page. */
	coldJs: 73_000,
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
	execFileSync(process.execPath, [ join(ROOT, 'tools/minify-js.mjs'), res ],
		{ stdio: SHOW ? 'inherit' : 'ignore' });
	/* a page module is not part of a cold visit anywhere but on its own page */
	const lazy = new Set([ ...pageModules().values() ].map((n) => n + '.js'));
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
