/* The page-module map, read from the one file that declares it.
 *
 * `menu-footstrap-common.js` maps a `body[data-page]` value to the module for that page and loads it
 * there. Only tools/page-modules.mjs reads this list (map against modules); the size budget uses
 * coldModules() below.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, RESOURCES } from './root.mjs';

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

/* Which modules a page downloads before it can show anything, DERIVED rather than listed: start at
 * the two `L.require(…)` calls the footer emits and walk the directive prologues, which `luci.js`
 * resolves when a module is FETCHED. A module reached only from a page module is absent from a cold
 * visit too (`fs-version.js`, 281 B, required by `fs-appearance` alone, is not counted in the budget).
 * The prologue ends at the first string literal that is neither `'use strict'` nor a `'require …'`,
 * the shape tools/minify-js.mjs parses. */
const FOOTER = join(ROOT, 'luci-theme-footstrap/ucode/template/themes/footstrap/footer.ut');

function entryModules() {
	const src = readFileSync(FOOTER, 'utf8');
	const names = [ ...src.matchAll(/L\.require\('([a-z0-9-]+)'\)/g) ].map((m) => m[1]);
	if (!names.length) throw new Error(`no L.require() entry point in ${FOOTER}`);
	return names;
}

function requiresOf(name) {
	let src;
	try { src = readFileSync(join(RESOURCES, name + '.js'), 'utf8'); }
	catch (e) { return null; }		/* a stock luci-base class, not one of ours */
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
		if (seen.has(name)) continue;
		const deps = requiresOf(name);
		if (!deps) continue;
		seen.add(name);
		queue.push(...deps);
	}
	return seen;
}
