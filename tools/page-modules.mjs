#!/usr/bin/env node
/* THE PAGE-MODULE CONTRACT: a module that belongs to one page must be loaded on that page, and on
 * no other — and the two halves of that sentence live in two files.
 *
 * `fs-appearance` and `fs-overview` add to a stock page rather than owning a route (a theme may not
 * register a dispatcher node), so each watches `body[data-page]` and acts on one value. They used to
 * be `require`d in menu-footstrap-common.js's directive prologue, which made them a hard dependency
 * of the chrome: luci.js fetched and evaluated both on every admin page, 15.3 KB after terser for
 * panels that page did not have. Now menu-footstrap-common carries a MAP from `data-page` to module
 * name and requires the module when that page appears.
 *
 * That map repeats a string each module also tests for itself, and a repeat that nothing checks is a
 * bug waiting for the day someone renames a page node: the map would keep loading nothing while the
 * module keeps waiting for a stamp that never comes, and the only symptom is a panel that quietly
 * stopped appearing. So this derives BOTH sides from the source and compares them:
 *
 *   * the map's keys and values, read out of menu-footstrap-common.js;
 *   * the `data-page` value each mapped module compares itself against, read out of that module;
 *   * that no `'require <module>'` pragma is left anywhere, because one pragma anywhere in the
 *     graph puts the file back on every page and takes the saving with it;
 *   * that each mapped module exports a `wire`, which is what the loader calls.
 *
 * Same shape as tools/axes.mjs: two implementations of one fact, held together by a derivation
 * rather than by a comment asking the next person to remember.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pageModules, RESOURCES as RES, LOADER } from './lib/page-modules.mjs';

const src = (name) => readFileSync(join(RES, name), 'utf8');
const fail = [];

let map;
try { map = pageModules(); }
catch (e) { console.error('page-modules: ' + e.message); process.exit(1); }

/* ---- what each module thinks its page is ---- */
for (const [ page, name ] of map) {
	let text;
	try { text = src(name + '.js'); }
	catch (e) { fail.push(`${name}: mapped from ${page} but ${name}.js does not exist`); continue; }

	/* every `data-page` value the module compares itself against, however it spells the comparison:
	 * a PAGE constant, or the literal inline (fs-overview does both) */
	const pages = new Set();
	for (const m of text.matchAll(/const PAGE\s*=\s*'([a-z0-9-]+)'/g)) pages.add(m[1]);
	for (const m of text.matchAll(/getAttribute\('data-page'\)[^;]{0,40}?[!=]==\s*'([a-z0-9-]+)'/g)) pages.add(m[1]);
	for (const m of text.matchAll(/[!=]==\s*'(admin-[a-z0-9-]+)'/g)) pages.add(m[1]);

	if (!pages.size)
		fail.push(`${name}: nothing in it tests a data-page value, so the map cannot be checked against it`);
	else if (pages.size > 1 || !pages.has(page))
		fail.push(`${name}: the map loads it on "${page}", the module acts on ${[ ...pages ].map((p) => `"${p}"`).join(', ')}`);

	if (!/return baseclass\.extend\(\{[^}]*\bwire\b/s.test(text))
		fail.push(`${name}: the loader calls wire() and the module does not export one`);
}

/* ---- and nothing may require them at eval, anywhere ---- */
for (const file of readdirSync(RES).filter((f) => f.endsWith('.js'))) {
	const text = src(file);
	for (const name of map.values()) {
		const pragma = new RegExp(`^'require\\s+${name}\\b`, 'm');
		if (pragma.test(text))
			fail.push(`${file}: '${name}' is required in its directive prologue, which ships it on every page`);
	}
}

if (fail.length) {
	console.error('\npage-modules: the page map and the modules disagree\n');
	for (const f of fail) console.error('  ' + f);
	console.error('\nThe map is in ' + LOADER + '; each module tests its own data-page value.\n');
	process.exit(1);
}
console.log(`page-modules: ${map.size} page module(s) — ` +
	[ ...map ].map(([ p, n ]) => `${n} on ${p}`).join(', ') + ', each loaded there and nowhere else.');
