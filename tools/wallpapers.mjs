#!/usr/bin/env node
/* The doodle wallpapers are downloaded by the CLIENT and pinned by SIZE and SHA256 in fs-prefs.js —
 * so those two constants are a promise about files that live somewhere else entirely (wallpapers/
 * in this repository, served from raw.githubusercontent.com at run time).
 *
 * Nothing else can catch a stale one. Re-trace a doodle, forget the hash, and every gate stays
 * green while every router that picks that wallpaper refuses its own download with "the download
 * did not match what this theme expects" — a failure that cannot happen here and cannot be
 * anywhere but in the field. The check is trivial and that is the argument for it.
 *
 * It also holds the pair the other way: a file in wallpapers/ that no axis offers is either a
 * wallpaper somebody forgot to wire up or a leftover shipped to nobody.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { ROOT, read } from './lib/root.mjs';

const JS = read('luci-theme-footstrap/htdocs/luci-static/resources/fs-prefs.js');
const DIR = join(ROOT, 'wallpapers');

const errors = [];
const ok = [];

/* the table as the JS declares it: name -> { bytes, sha256 } */
const pinned = new Map();
const table = (JS.match(/const WALLPAPER_FILES = \{([\s\S]*?)\n\};/) || [, ''])[1];
for (const m of table.matchAll(/(\w+):\s*\{\s*bytes:\s*(\d+),\s*sha256:\s*'([0-9a-f]{64})'/g))
	pinned.set(m[1], { bytes: Number(m[2]), sha256: m[3] });

if (!pinned.size)
	errors.push('no WALLPAPER_FILES table found in fs-prefs.js — the pins this gate exists to hold are gone');

const onDisk = new Set(readdirSync(DIR).filter((f) => f.endsWith('.svg')).map((f) => f.replace(/\.svg$/, '')));

for (const [ name, want ] of pinned) {
	if (!onDisk.has(name)) {
		errors.push(`wallpaper '${name}': pinned in fs-prefs.js but wallpapers/${name}.svg does not exist — ` +
			'the download would 404 on every router that picks it');
		continue;
	}
	const file = join(DIR, `${name}.svg`);
	const bytes = statSync(file).size;
	const sha256 = createHash('sha256').update(readFileSync(file)).digest('hex');
	if (bytes !== want.bytes)
		errors.push(`wallpaper '${name}': fs-prefs.js pins ${want.bytes} bytes, wallpapers/${name}.svg is ${bytes}`);
	else if (sha256 !== want.sha256)
		errors.push(`wallpaper '${name}': fs-prefs.js pins sha256 ${want.sha256}, the file hashes to ${sha256}`);
	else
		ok.push(`${name.padEnd(6)} ${String(bytes).padStart(7)} bytes  ${sha256.slice(0, 16)}…  pin agrees`);
}
for (const name of onDisk)
	if (!pinned.has(name))
		errors.push(`wallpapers/${name}.svg exists but fs-prefs.js pins no such wallpaper — nothing can download it`);

/* …and the package must NOT carry them: that is the entire reason they are fetched on demand. */
const SHIPPED = join(ROOT, 'luci-theme-footstrap/htdocs/luci-static/footstrap');
for (const f of readdirSync(SHIPPED))
	if (pinned.has(f.replace(/\.svg$/, '')))
		errors.push(`${f} is in the SHIPPED tree — the doodles are downloaded on demand precisely so the ` +
			'package does not carry them; luci.mk copies htdocs/ wholesale, so this one would ship');

for (const line of ok) console.log(`  ok   ${line}`);
if (errors.length) {
	console.error('\nFAIL: the wallpaper pins and the files disagree.');
	for (const e of errors) console.error(`  - ${e}`);
	process.exit(1);
}
console.log('\nwallpapers: every pin matches its file, and none of them ship.');
