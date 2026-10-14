#!/usr/bin/env node
/* Every shipped /etc/config/* must be declared a conffile, or the package manager eats it.
 *
 * `root/etc/config/footstrap` ships as an empty stub and is written at runtime (Appearance ->
 * "Save as default" uci-sets the router-wide axes into it). Without a `conffiles` define the
 * package manager replaces it on upgrade and the saved defaults vanish, reported as success.
 *
 * A gate because nothing observable fails here: the wipe happens on someone else's router.
 * OpenWrt honours the define for both formats (include/package-pack.mk: KEEP_$(1) -> apk
 * .conffiles, ipk CONTROL/conffiles), so one define covers opkg and apk.
 *
 * A text check, not a package build: it must run where no OpenWrt SDK exists. */
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { ROOT, read } from './lib/root.mjs';
const PKG = join(ROOT, 'luci-theme-footstrap');
const CONFIG_DIR = join(PKG, 'root/etc/config');

const fails = [];

/* what the package SHIPS into /etc/config */
const shipped = existsSync(CONFIG_DIR)
	? readdirSync(CONFIG_DIR).map(f => `/etc/config/${f}`).sort()
	: [];

/* what the Makefile DECLARES. The define body is everything between the header and `endef`;
 * blank lines and `#` comments are not paths. */
const mk = read('luci-theme-footstrap/Makefile');
const m = mk.match(/^define Package\/[^/\n]+\/conffiles\n([\s\S]*?)^endef$/m);
const declared = m
	? m[1].split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#')).sort()
	: [];

/* …and what owfeed.yml declares, which is the copy that governs THE RELEASED PACKAGE. The Makefile
 * describes the SDK path, and nothing published comes from it since the build moved to owfeed, so a
 * `conffiles` correct in one file and missing from the other protects nobody while reading as
 * protected. Both are checked and must agree.
 *
 * A text match, like the Makefile one above: this gate runs on a dev box and in the lint job, and
 * neither should need a YAML parser to answer a question about one list of paths. */
const yml = read('owfeed.yml');
const y = yml.match(/^\s*conffiles:\s*\[([^\]]*)\]/m);
const owfeedDeclared = y
	? [ ...y[1].matchAll(/["']([^"']+)["']/g) ].map(mm => mm[1]).sort()
	: [];

if (!shipped.length) {
	// The sentence is honest — CONFIG_DIR really is empty or missing — but exit 0 read as a pass,
	// and a pass here is indistinguishable from "correctly protected" to anything watching the CI
	// job go green. It never legitimately means that for this package: root/etc/config/footstrap
	// is a permanent, load-bearing stub (Appearance "Save as default" writes into it at runtime;
	// see the header above), so an empty CONFIG_DIR is root/etc/config/ having been deleted or
	// renamed, not a variant of the theme that ships none. Failing closed means the day this
	// theme genuinely drops its last conffile, that has to be a conscious edit to THIS script
	// (loosen this check and say why), not a status nobody chose.
	console.error('conffiles: FAILED\n');
	console.error(`  the package ships no /etc/config/* — expected at least one (root/etc/config/footstrap,`);
	console.error(`  the "Save as default" stub); either it was deleted or ${CONFIG_DIR} moved`);
	console.error('\nIf the theme has genuinely stopped shipping a conffile, this check needs updating');
	console.error('on purpose — it does not default to that reading a missing directory.');
	process.exit(1);
}

/* one pass per source: a missing declaration, shipped but undeclared, declared but not shipped */
function compare(source, found, list, hint = '') {
	if (!found) {
		fails.push(
			`the package ships ${shipped.length} config file(s) but ${source} declares no conffiles${hint}\n` +
			`  — every one of them is REPLACED on upgrade:\n` +
			shipped.map(p => `    ${p}`).join('\n')
		);
		return;
	}
	for (const p of shipped)
		if (!list.includes(p))
			fails.push(`${p} is shipped but NOT in ${source}'s conffiles — an upgrade will overwrite it`);
	/* a stale path silently protects nothing */
	for (const p of list)
		if (!shipped.includes(p))
			fails.push(`${p} is in ${source}'s conffiles but the package ships no such file — stale entry`);
}
compare('owfeed.yml', y, owfeedDeclared, ' (the released package is built from it)');
compare('the Makefile', m, declared);

console.log(`conffiles: ${shipped.length} shipped, ${declared.length} in the Makefile, ${owfeedDeclared.length} in owfeed.yml`);
for (const p of shipped)
	console.log(`  ${declared.includes(p) && owfeedDeclared.includes(p) ? 'ok  ' : 'FAIL'} ${p}`);

if (fails.length) {
	console.error('\nconffiles: FAILED\n');
	for (const f of fails) console.error(`  ${f}`);
	console.error('\nAdd the path to BOTH: the conffiles define in luci-theme-footstrap/Makefile');
	console.error('(the SDK path) and conffiles: in owfeed.yml (what the release is built from).');
	process.exit(1);
}

console.log('\nconffiles: every shipped config file is protected from upgrade.');
