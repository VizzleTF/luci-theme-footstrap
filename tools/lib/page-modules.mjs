/* The page-module map, read from the one file that declares it.
 *
 * `menu-footstrap-common.js` maps a `body[data-page]` value to the module for that page and loads it
 * there. Two tools need the list — the gate that proves map and modules agree, and the size budget,
 * which must not count a page module in what a cold page downloads — and a list parsed in two places
 * is a list that will disagree in one.
 */
import { readFileSync } from 'node:fs';
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
