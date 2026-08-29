#!/usr/bin/env node
/* One package per language, and the three places that have to agree about which languages exist.
 *
 * `po/<lang>/` is the source of truth — Weblate writes there and `update-po.sh` keeps it current.
 * Two other files repeat that list, and neither fails loudly on its own:
 *
 *   tools/stage.sh   builds dist/po-<lang>/ and dist/i18n-<lang>/, and carries the label LuCI's
 *                    language menu shows. A language missing here is simply never staged.
 *   owfeed.yml       declares luci-i18n-footstrap-<lang>. A language missing here stages into a
 *                    directory nothing packages — the build stays green and the translation is
 *                    gone, which is exactly the failure that made bundling the catalogues look
 *                    like the safer choice.
 *
 * The names are luci.mk's and are checked as such: `luci-i18n-$(LUCI_BASENAME)-<lang>` with
 * LUCI_BASENAME `footstrap`, catalogue basename `footstrap`. An SDK build and an owfeed build must
 * put the same file in the same package, or a router upgrading between the two fights itself over
 * who owns /usr/lib/lua/luci/i18n/footstrap.<lang>.lmo.
 *
 * The labels are compared against luci.mk itself when a luci checkout sits beside this one — that
 * is where they come from, and a hand-typed one drifts. With no checkout the comparison is skipped
 * and said so; everything else still runs.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, read } from './lib/root.mjs';

const PO = join(ROOT, 'luci-theme-footstrap/po');
const STAGE = read('tools/stage.sh');
const FEED = read('owfeed.yml');

const errors = [];
const ok = [];

/* ---- 1. the languages that exist ---------------------------------------- */
const langs = readdirSync(PO, { withFileTypes: true })
	.filter((e) => e.isDirectory() && e.name !== 'templates')
	.map((e) => e.name)
	.filter((l) => readdirSync(join(PO, l)).some((f) => f.endsWith('.po')))
	.sort();

if (!langs.length) errors.push('po/ holds no language directory with a .po in it');
else ok.push(`po/: ${langs.length} language(s) — ${langs.join(', ')}`);

/* ---- 2. stage.sh stages each one, with a label -------------------------- */
const labels = new Map();
for (const m of STAGE.matchAll(/^\t\t(\w[\w-]*)\)\s*echo\s*'([^']+)'\s*;;/gm))
	labels.set(m[1], m[2]);

for (const l of langs) {
	if (!labels.has(l))
		errors.push(`po/${l} has no label in stage.sh's lang_name() — the build refuses it, `
			+ 'and it would never be staged');
}
for (const l of labels.keys()) {
	if (!langs.includes(l))
		errors.push(`stage.sh labels '${l}', which has no po/${l} — a label for a language that `
			+ 'does not exist is a package nobody can build');
}
if (labels.size && langs.every((l) => labels.has(l)))
	ok.push(`stage.sh: a label for every language (${[ ...labels.entries() ]
		.map(([ k, v ]) => `${k}=${v}`).join(', ')})`);

/* ---- 3. owfeed.yml declares a package per language ---------------------- */
const declared = [ ...FEED.matchAll(/^\s*- name: luci-i18n-footstrap-([\w-]+)$/gm) ].map((m) => m[1]);
for (const l of langs)
	if (!declared.includes(l))
		errors.push(`owfeed.yml declares no luci-i18n-footstrap-${l} — po/${l} would be staged `
			+ 'into a directory nothing packages, and the translation would silently not ship');
for (const l of declared)
	if (!langs.includes(l))
		errors.push(`owfeed.yml declares luci-i18n-footstrap-${l} with no po/${l} behind it`);

/* each package must take its .po from its own staging directory, or one language's package
 * quietly carries every language's catalogue */
for (const l of declared) {
	const block = FEED.split(`- name: luci-i18n-footstrap-${l}`)[1] ?? '';
	const body = block.split(/\n\s*- name:/)[0];
	if (!(new RegExp(`from:\\s*\\./dist/po-${l}\\b`)).test(body))
		errors.push(`luci-i18n-footstrap-${l} does not read from ./dist/po-${l}`);
	if (!(/basename:\s*footstrap\s*$/m).test(body))
		errors.push(`luci-i18n-footstrap-${l} must use basename 'footstrap' — that is what po2lmo `
			+ 'writes in an SDK build, and a second basename means two files for one language');
	if (!(/files:\s*\.\/dist\/i18n-/).test(body))
		errors.push(`luci-i18n-footstrap-${l} ships no staging tree, so it registers no language`);
	if (!(/depends:\s*\[luci-theme-footstrap\]/).test(body))
		errors.push(`luci-i18n-footstrap-${l} must depend on the theme it translates`);
}
if (declared.length && !errors.length)
	ok.push(`owfeed.yml: ${declared.length} language package(s), each on its own catalogue`);

/* ---- 4. the theme itself carries none ----------------------------------- */
const themeBlock = FEED.split('- name: luci-theme-footstrap')[1]?.split(/\n\s*- name:/)[0] ?? '';
if ((/^\s*i18n:/m).test(themeBlock))
	errors.push('the theme package still declares an i18n block — the catalogues would ship twice, '
		+ 'and apk refuses an install where two packages own one path');
else ok.push('the theme package carries no catalogue of its own');

/* ---- 5. the labels are LuCI's own, when luci is checked out beside us ---- */
const LUCI_MK = join(ROOT, '..', 'luci', 'luci.mk');
if (existsSync(LUCI_MK)) {
	const mk = readFileSync(LUCI_MK, 'utf8');
	let checked = 0;
	for (const [ code, label ] of labels) {
		const m = mk.match(new RegExp(`^LUCI_LANG\\.${code}=(.+)$`, 'm'));
		if (!m) continue;
		checked++;
		if (m[1].trim() !== label)
			errors.push(`stage.sh calls '${code}' "${label}"; luci.mk calls it "${m[1].trim()}" — `
				+ 'the language menu would show two names for one language');
	}
	if (checked) ok.push(`labels: ${checked} checked against luci.mk`);
} else {
	ok.push('labels: no luci checkout beside this one, comparison skipped');
}

for (const line of ok) console.log(`  ok   ${line}`);
if (errors.length) {
	console.error('\ni18n-packages: the language list has drifted\n');
	for (const e of errors) console.error(`  ${e}`);
	process.exit(1);
}
console.log('\ni18n-packages: po/, stage.sh and owfeed.yml name the same languages.');
