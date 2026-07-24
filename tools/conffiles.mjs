#!/usr/bin/env node
/* Every shipped /etc/config/* must be declared a conffile — or the package manager eats it.
 *
 * THE BUG THIS EXISTS FOR, measured on the dev router, not reasoned:
 * `root/etc/config/footstrap` ships as an empty stub and is WRITTEN AT RUNTIME — Appearance ->
 * "Save as default" has rpcd uci-set the router-wide axes into that very file (fs-prefs.js
 * saveAsDefault()). With no `conffiles` define, the package manager owns it as an ordinary file
 * and REPLACES it on upgrade, so the admin's saved defaults were wiped by the theme's own
 * one-click Update — silently, and reported as success. The live router held eight options, was
 * package-owned, and had no `.conffiles` entry beside base-files'/dnsmasq's.
 *
 * WHY A GATE AND NOT JUST THE FIX: nothing observable fails. The wipe happens on someone else's
 * router, months later, at the moment they upgrade — the exact "silent, nobody reports it" class
 * the other gates here exist for. Adding a second config file and forgetting the define would
 * reintroduce it with no test, no lint and no diff to catch it.
 *
 * OpenWrt honours the define for BOTH formats (include/package-pack.mk: KEEP_$(1) -> apk
 * .conffiles / .conffiles_static, ipk CONTROL/conffiles), so one define covers 24.10's opkg and
 * 25.12's apk alike.
 *
 * Deliberately a TEXT check on the Makefile, not a package build: the gate must run on a dev box
 * and in the lint job, neither of which has an OpenWrt SDK.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { ROOT } from './lib/root.mjs';
const PKG = join(ROOT, 'luci-theme-footstrap');
const MAKEFILE = join(PKG, 'Makefile');
const CONFIG_DIR = join(PKG, 'root/etc/config');

const fails = [];

/* what the package SHIPS into /etc/config */
const shipped = existsSync(CONFIG_DIR)
	? readdirSync(CONFIG_DIR).map(f => `/etc/config/${f}`).sort()
	: [];

/* what the Makefile DECLARES. The define body is everything between the header and `endef`;
 * blank lines and `#` comments are not paths. */
const mk = readFileSync(MAKEFILE, 'utf8');
const m = mk.match(/^define Package\/[^/\n]+\/conffiles\n([\s\S]*?)^endef$/m);
const declared = m
	? m[1].split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#')).sort()
	: [];

if (!shipped.length) {
	console.log('conffiles: the package ships no /etc/config/* — nothing to declare.');
	process.exit(0);
}

if (!m) {
	fails.push(
		`the package ships ${shipped.length} config file(s) but the Makefile has no\n` +
		`  "define Package/<name>/conffiles" block at all — every one of them is REPLACED on upgrade:\n` +
		shipped.map(p => `    ${p}`).join('\n')
	);
} else {
	for (const p of shipped)
		if (!declared.includes(p))
			fails.push(`${p} is shipped but NOT declared a conffile — an upgrade will overwrite it`);

	/* the reverse is a real fault too: a stale path silently protects nothing */
	for (const p of declared)
		if (!shipped.includes(p))
			fails.push(`${p} is declared a conffile but the package ships no such file — stale entry`);
}

console.log(`conffiles: ${shipped.length} shipped, ${declared.length} declared`);
for (const p of shipped)
	console.log(`  ${declared.includes(p) ? 'ok  ' : 'FAIL'} ${p}`);

if (fails.length) {
	console.error('\nconffiles: FAILED\n');
	for (const f of fails) console.error(`  ${f}`);
	console.error('\nAdd the path to the conffiles define in luci-theme-footstrap/Makefile.');
	process.exit(1);
}

console.log('\nconffiles: every shipped config file is protected from upgrade.');
