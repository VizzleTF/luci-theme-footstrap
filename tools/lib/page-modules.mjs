/* The page-module map, read from the one file that declares it.
 *
 * `menu-footstrap-common.js` maps a `body[data-page]` value to the module for that page and loads it
 * there. Two tools need the list — the gate that proves map and modules agree, and the size budget,
 * which must not count a page module in what a cold page downloads — and a list parsed in two places
 * is a list that will disagree in one.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RESOURCES = resolve(dirname(fileURLToPath(import.meta.url)),
	'../../luci-theme-footstrap/htdocs/luci-static/resources');
export const LOADER = 'menu-footstrap-common.js';

/* -> Map(data-page -> module name). Throws rather than returning an empty map: every caller reads
 * "no page modules" as a fact about the theme, so a parse that quietly found none lies to both. */
export function pageModules() {
	const src = readFileSync(join(RESOURCES, LOADER), 'utf8');
	const block = /const PAGE_MODULES = \{([^}]*)\}/.exec(src);
	if (!block) throw new Error(`no PAGE_MODULES map in ${LOADER}`);
	const map = new Map();
	for (const m of block[1].matchAll(/'([a-z0-9-]+)'\s*:\s*'([a-z0-9-]+)'/g)) map.set(m[1], m[2]);
	if (!map.size) throw new Error(`PAGE_MODULES in ${LOADER} is empty`);
	return map;
}

/* Which modules a page downloads before it can show anything, DERIVED rather than listed.
 *
 * The page-module map answers a narrower question than the size budget needs: it names the two
 * modules the loader fetches per page, but a module reached only from one of THOSE is just as
 * absent from a cold visit, and the budget was counting it. `fs-version.js` is the standing
 * example — 281 B required by `fs-appearance` alone, downloaded on no cold page, and paid for on
 * every one of them in the number the gate printed.
 *
 * So: start at the two `L.require(…)` calls the footer emits and walk the directive prologues.
 * `luci.js` resolves a prologue when the module is FETCHED, so everything the walk does not reach
 * is fetched only when something else asks for it. The prologue shape is the one
 * `tools/minify-js.mjs` parses, and the same constraint applies — the scan stops at the first
 * string literal that is neither `'use strict'` nor a `'require …'`. */
const FOOTER = resolve(RESOURCES, '../../../ucode/template/themes/footstrap/partials/footer.ut');

export function entryModules() {
	const src = readFileSync(FOOTER, 'utf8');
	const names = [ ...src.matchAll(/L\.require\('([a-z0-9-]+)'\)/g) ].map((m) => m[1]);
	if (!names.length) throw new Error(`no L.require() entry point in ${FOOTER}`);
	return names;
}

function ours(name) {
	return existsSync(join(RESOURCES, name + '.js'));
}

function requiresOf(name) {
	let src;
	try { src = readFileSync(join(RESOURCES, name + '.js'), 'utf8'); }
	catch (e) { return []; }			/* a stock luci-base class, not one of ours */
	const out = [];
	for (const line of src.split('\n')) {
		const m = /^\s*'(?:use strict|require\s+(\S+?)(?:\s+as\s+\S+)?)'\s*;?\s*$/.exec(line);
		if (m) { if (m[1]) out.push(m[1]); continue; }
		if (line.trim() === '' || line.trim().startsWith('/*') || line.trim().startsWith('*')
			|| line.trim().startsWith('//')) continue;
		break;							/* the prologue ends at the first real statement */
	}
	return out;
}

/* -> Set of OUR module names a cold page fetches. A stock luci-base class reached along the way
 * (`baseclass`, `dom`, `ui`, `rpc`) is not the theme's to weigh — luci-base loads ui, rpc and form
 * unconditionally on every page regardless of what this theme asks for. */
export function coldModules() {
	const seen = new Set();
	const queue = entryModules();
	while (queue.length) {
		const name = queue.shift();
		if (seen.has(name) || !ours(name)) continue;
		seen.add(name);
		for (const dep of requiresOf(name)) queue.push(dep);
	}
	return seen;
}
