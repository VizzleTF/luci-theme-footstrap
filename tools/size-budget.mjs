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
import { pageModules } from './lib/page-modules.mjs';

const SHOW = process.argv.includes('--show');

const LIMITS = {
	/* The CSS budget, measured after the token mangle: 127,142 B on 2026-08-21, the last 1.5 KB of
	 * it the 2020 colourway and two forum-reported fixes. The headroom is deliberate and small: a
	 * feature's worth of rules should fit without a gate edit, a redesign's should not. A raise wants
	 * a line saying what bought it — a palette is the one feature that cannot be cheaper, every
	 * token being declared per mode or the block does not fully apply. */
	cascadeCss: 128_500,
	/* The FLASH cost of the shipped modules, terser with top-level mangling: every module ships,
	 * whether or not a given page loads it. 89,771 B on 2026-08-24, the last 371 B buying a scroll
	 * reference on every page shape — searching the element stack rather than one hit, and keeping a
	 * surviving ancestor beside it. A raise wants a line saying what bought it. */
	resourcesJs: 89_900,
	/* …and this is what a cold page DOWNLOADS, which is the number that matters on a link the router is
	 * also routing packets over: the same set minus the page modules, which are required only on the
	 * one page each belongs to (tools/page-modules.mjs). 74,220 B on 2026-08-27, the last 106 B
	 * moving the poll floor off the content column and onto the containers a poll empties: one
	 * element became a list, so a clear pass, a read pass and a write pass replaced three lines.
	 * What it bought is on both sides of the fault — a floor that no longer suppresses the engine's
	 * own scroll anchoring (120px of unanswered growth on Chromium and Firefox with it on the
	 * column), and a clamp of 2167px reduced to none. Raising it is a decision; lowering it whenever
	 * the number comes down is the point. */
	coldJs: 74_300,
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
