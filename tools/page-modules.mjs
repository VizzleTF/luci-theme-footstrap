#!/usr/bin/env node
/* The page-module contract: a module that belongs to one page must be loaded on that page and on no
 * other, and the two halves of that sentence live in two files.
 *
 * `fs-overview` adds to a stock page rather than owning a route (a theme may not register a
 * dispatcher node), so it watches `body[data-page]` and acts on one value. Required from the
 * chrome's directive prologue it would be fetched and evaluated on every admin page, so
 * menu-footstrap-common carries a MAP from `data-page` to module name instead.
 *
 * The map repeats a page name the module also carries; this gate holds the two together, plus the
 * rule that no `'require <module>'` pragma survives anywhere, since one puts the file back on every
 * page. Same shape as tools/axes.mjs: two implementations of one fact, held by a derivation.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pageModules, LOADER } from './lib/page-modules.mjs';
import { RESOURCES as RES } from './lib/root.mjs';

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
	 * a PAGE constant, or the literal inline */
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
