#!/usr/bin/env node
/* A ceiling on what the router sends: the shipped stylesheet and the shipped JS, minified and
 * probe-stripped the way the package ships them. Every byte is flash read and CPU on a device that
 * is also routing packets.
 *
 * The ceiling is pinned at a release, by `/release` (`--pin`: measured plus 2 %, rounded up to
 * 10 B). Between releases it is not raised: a change that crosses it pays for itself by removing
 * something, or the maintainer raises it by hand. A re-pin DOWN is allowed between releases when a
 * refactor shrinks the build, so the slack does not hide growth. The reason for each raise is the
 * changelog's job, not a paragraph here (docs/conventions.md, "Comments").
 *
 *   node tools/size-budget.mjs          # the gate: exit 1 over the ceiling
 *   node tools/size-budget.mjs --show   # every file with its size
 *   node tools/size-budget.mjs --pin    # rewrite LIMITS below from the current build (at a release; down between releases)
 */
import { cpSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { buildCss, scratchDir } from './lib/css.mjs';
import { ROOT, RESOURCES } from './lib/root.mjs';
import { coldModules } from './lib/page-modules.mjs';
import { parseFlags } from './lib/util.mjs';

const FLAGS = parseFlags('size-budget', { show: { type: 'boolean', default: false }, pin: { type: 'boolean', default: false } });
const SHOW = FLAGS.show;
const PIN = FLAGS.pin;

/* Pinned by `--pin` to 2 % over the build; a cut that leaves 8-11 % slack is re-pinned,
 * since slack that wide stops the ratchet catching growth. */
const LIMITS = {
	cascadeCss: 118_420,
	resourcesJs: 88_310,
	coldJs: 55_000,
};

function bytes(path) {
	return statSync(path).size;
}

function shippedCss() {
	const out = buildCss();
	/* the script rewrites the JS and templates it is given in place, so it gets copies */
	const dir = scratchDir('fs-css-');
	const pkg = join(ROOT, 'luci-theme-footstrap');
	cpSync(RESOURCES, join(dir, 'resources'), { recursive: true });
	cpSync(join(pkg, 'ucode'), join(dir, 'ucode'), { recursive: true });
	execFileSync(join(pkg, 'mangle-tokens.sh'), [ out, join(dir, 'resources'), join(dir, 'ucode') ],
		{ stdio: SHOW ? 'inherit' : 'ignore' });
	return { path: out, size: bytes(out), res: join(dir, 'resources') };
}

/* stage.sh runs mangle, then probes, then uglify: start from the mangled copy shippedCss made */
function shippedJs(res) {
	execFileSync(join(ROOT, 'luci-theme-footstrap/strip-build.sh'), [ 'probes', res ],
		{ stdio: SHOW ? 'inherit' : 'ignore' });
	execFileSync(process.execPath, [ join(ROOT, 'tools/minify-js.mjs'), res ],
		{ stdio: SHOW ? 'inherit' : 'ignore' });
	const cold = new Set([ ...coldModules() ].map((n) => n + '.js'));
	const files = readdirSync(res, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.js'))
		.map((f) => ({ name: f, size: bytes(join(res, f)), lazy: !cold.has(f) }))
		.sort((a, b) => b.size - a.size);
	return {
		files,
		size: files.reduce((n, f) => n + f.size, 0),
		cold: files.filter((f) => !f.lazy).reduce((n, f) => n + f.size, 0)
	};
}

const css = shippedCss();
const js = shippedJs(css.res);

const kb = (n) => (n / 1024).toFixed(1) + ' KB';

if (SHOW) {
	console.log('\ncascade.css  ' + kb(css.size).padStart(9) + '  (limit ' + kb(LIMITS.cascadeCss) + ')');
	console.log('resources/   ' + kb(js.size).padStart(9) + '  (limit ' + kb(LIMITS.resourcesJs) + ', on flash)');
	console.log('  cold page  ' + kb(js.cold).padStart(9) + '  (limit ' + kb(LIMITS.coldJs) + ', what a visit downloads)');
	for (const f of js.files) console.log('   ' + kb(f.size).padStart(9) + '  ' + f.name + (f.lazy ? '   (page module)' : ''));
	console.log('cold total   ' + kb(css.size + js.cold).padStart(9) + '\n');
}

if (PIN) {
	const pin = (n) => Math.ceil((n * 1.02) / 10) * 10;
	const next = { cascadeCss: pin(css.size), resourcesJs: pin(js.size), coldJs: pin(js.cold) };
	const self = new URL(import.meta.url);
	let text = readFileSync(self, 'utf8');
	for (const [ k, v ] of Object.entries(next))
		text = text.replace(new RegExp('(\\t' + k + ': )[0-9_]+,'), '$1' + String(v).replace(/\B(?=(\d{3})+(?!\d))/g, '_') + ',');
	writeFileSync(self, text);
	console.log('size-budget: pinned ' + Object.entries(next).map(([ k, v ]) => k + '=' + v).join(', '));
	process.exit(0);
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
	console.error('\nThe ceiling is pinned at a release (`--pin`, /release); between releases a change'
		+ '\nthat crosses it removes something, or the maintainer raises the number by hand (a re-pin down is allowed).\n');
	process.exit(1);
}

console.log(`ok — cascade.css ${kb(css.size)}, shipped JS ${kb(js.size)} on flash and ${kb(js.cold)} on a cold page, all within budget.`);
