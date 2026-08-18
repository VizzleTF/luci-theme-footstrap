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

const SHOW = process.argv.includes('--show');

const LIMITS = {
	/* 126,866 B measured 2026-08-17 (built 138,798, −8.6% from the token mangle). The headroom is
	 * deliberate and small: a feature's worth of rules should fit without a gate edit, a redesign's
	 * should not. */
	cascadeCss: 130_000,
	/* 84,432 B measured 2026-08-17 over the 14 shipped modules, terser with top-level mangling.
	 * ALL of them load on every admin page — menu-footstrap-common requires the whole graph — so
	 * the sum is the honest per-visit number, not a worst case. */
	resourcesJs: 86_000,
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
	const files = readdirSync(res).filter((f) => f.endsWith('.js'))
		.map((f) => ({ name: f, size: bytes(join(res, f)) }))
		.sort((a, b) => b.size - a.size);
	return { files, size: files.reduce((n, f) => n + f.size, 0) };
}

const css = shippedCss();
const js = shippedJs();

const kb = (n) => (n / 1024).toFixed(1) + ' KB';

if (SHOW) {
	console.log('\ncascade.css  ' + kb(css.size).padStart(9) + '  (limit ' + kb(LIMITS.cascadeCss) + ')');
	console.log('resources/   ' + kb(js.size).padStart(9) + '  (limit ' + kb(LIMITS.resourcesJs) + ')');
	for (const f of js.files) console.log('   ' + kb(f.size).padStart(9) + '  ' + f.name);
	console.log('cold total   ' + kb(css.size + js.size).padStart(9) + '\n');
}

const over = [];
if (css.size > LIMITS.cascadeCss)
	over.push(`cascade.css is ${css.size} B, over its ${LIMITS.cascadeCss} B budget by ${css.size - LIMITS.cascadeCss} B`);
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

console.log(`ok — cascade.css ${kb(css.size)}, shipped JS ${kb(js.size)}, both within budget.`);
