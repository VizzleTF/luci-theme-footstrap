/* Five Makefile invariants that each fail SILENTLY, on somebody else's router, weeks later.
 *
 * Every one of them was already written down and held by nothing: the file is small enough that a
 * reviewer trusts it, and none of these produces a build error — a wrong DEPENDS installs and then
 * fails on a router without that package, a hardcoded PKG_VERSION ships a release that reports the
 * wrong version, csstidy silently mangles :has() and color-mix(), a live `rpcd reload` or
 * `restart` re-execs rpcd and drops its sessions on the box at install time, and a
 * PKG_LICENSE_FILES whose file the SDK path no longer copies declares a licence that is not there.
 *
 * `tools/scan-marker.sh` holds the sixth (the buildbot signature comment) and is not repeated here.
 */
import { read } from './lib/root.mjs';

const PATH = 'luci-theme-footstrap/Makefile';
const src = read(PATH);
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

/* 4. no live `rpcd reload` or `restart`: reload is a re-exec that drops every LuCI session as
 *    surely as restart (the Makefile's postinst note has the measurement). Comment lines are the
 *    note itself and are skipped. */
for (const [i, l] of lines.entries()) {
	if (!(/^\s*#/).test(l) && (/\b(?:reload|restart)\b.*\brpcd\b|\brpcd\b.*\b(?:reload|restart)\b/).test(l)) {
		fails.push(`${PATH}:${i + 1}: a live 'rpcd reload|restart' drops every LuCI session. Tell the user to log in again instead.`);
	}
}

/* 5. PKG_LICENSE_FILES resolves against $(PKG_BUILD_DIR), which luci.mk fills with only src/ luasrc/
 *    htdocs/ root/ ucode/. Build/Prepare has to copy each file it names there, or the SDK path
 *    declares a licence text that is not in the tree. */
const licence = lines.find((l) => (/^\s*PKG_LICENSE_FILES\s*:?=/).test(l));
for (const f of licence ? licence.split('=')[1].trim().split(/\s+/) : []) {
	const copy = `$(CP) $(CURDIR)/${f} $(PKG_BUILD_DIR)/`;
	if (!lines.some((l) => l.trim() === copy)) {
		fails.push(`${PATH}:${at(/^\s*PKG_LICENSE_FILES/)}: PKG_LICENSE_FILES names '${f}' but Build/Prepare does not run '${copy}'.`);
	}
}

if (fails.length) {
	for (const f of fails) console.error(f);
	console.error(`\nmakefile-contract: ${fails.length} violation(s).`);
	process.exit(1);
}
console.log(`makefile-contract: 5 invariants hold (${PATH}).`);
