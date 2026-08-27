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
	 * `{` and `,`: 516 child combinators were carrying a space either side. */
	cascadeCss: 127_400,
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
	 * wants a line saying what bought it. */
	resourcesJs: 87_600,
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
	 * raising it is a decision that wants a line saying what bought it. */
	coldJs: 54_600,
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
