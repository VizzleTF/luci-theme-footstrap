/* Four Makefile invariants that each fail SILENTLY, on somebody else's router, weeks later.
 *
 * Every one of them was already written down and held by nothing: the file is small enough that a
 * reviewer trusts it, and none of these produces a build error — a wrong DEPENDS installs and then
 * fails on a router without that package, a hardcoded PKG_VERSION ships a release that reports the
 * wrong version, csstidy silently mangles :has() and color-mix(), and `rpcd restart` logs out every
 * LuCI session on the box at install time.
 *
 * `tools/scan-marker.sh` holds the fifth (the buildbot signature comment) and is not repeated here.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/root.mjs';

const PATH = 'luci-theme-footstrap/Makefile';
const src = readFileSync(join(ROOT, PATH), 'utf8');
const lines = src.split('\n');
const fails = [];

const at = (re) => lines.findIndex((l) => re.test(l)) + 1;

/* 1. +luci-base is the whole dependency list, and keeping it that way is the constraint: the theme
 *    ships no framework. curl is not in OpenWrt's default set — uclient-fetch is the fallback that
 *    exists precisely so this line does not grow. */
const dep = lines.filter((l) => (/^\s*LUCI_DEPENDS\s*:?=/).test(l));
if (dep.length !== 1) {
	fails.push(`${PATH}: expected exactly one LUCI_DEPENDS line, found ${dep.length}`);
} else if (dep[0].split('=').slice(1).join('=').trim() !== '+luci-base') {
	fails.push(`${PATH}:${at(/^\s*LUCI_DEPENDS/)}: LUCI_DEPENDS must be exactly '+luci-base', found '${dep[0].trim()}'. A second dependency is a package the theme now needs on every router.`);
}

/* 2. PKG_VERSION is git-derived. Assigning a literal makes every build report that number, which is
 *    invisible until a release says it is a version it is not. A $(VAR) reference is the shipped
 *    form and is what this allows. */
for (const [i, l] of lines.entries()) {
	const m = (/^\s*PKG_VERSION\s*:?=\s*(.+?)\s*$/).exec(l);
	if (m && !m[1].startsWith('$(')) {
		fails.push(`${PATH}:${i + 1}: PKG_VERSION is git-derived; a literal '${m[1]}' pins it. Use the CI-injected variable.`);
	}
}

/* 3. csstidy mangles :has() and color-mix(), both of which this stylesheet uses throughout. */
if (!(/^\s*LUCI_MINIFY_CSS\s*:?=\s*0\s*$/m).test(src)) {
	fails.push(`${PATH}: LUCI_MINIFY_CSS:=0 is missing. luci.mk's csstidy pass mangles :has() and color-mix().`);
}

/* 4. reload, never restart: rpcd holds sessions in memory, so a restart logs out every LuCI user on
 *    the router at the moment they install an upgrade. */
for (const [i, l] of lines.entries()) {
	if ((/rpcd\s+restart|restart\s*>.*rpcd/).test(l) || (/\/etc\/init\.d\/rpcd\s+restart/).test(l)) {
		fails.push(`${PATH}:${i + 1}: 'rpcd restart' logs out every LuCI session. Use 'rpcd reload'.`);
	}
}

if (fails.length) {
	for (const f of fails) console.error(f);
	console.error(`\nmakefile-contract: ${fails.length} violation(s).`);
	process.exit(1);
}
console.log(`makefile-contract: 4 invariants hold (${PATH}).`);
