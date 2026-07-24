#!/usr/bin/env node
/* The set of files allowed to carry an `!important` is a contract, and it is stated TWICE — once in
 * tools/audit.py (BANG_OK, the Python gate) and once in .stylelintrc.json (the override that turns
 * declaration-no-important off for those files). The two run in different runtimes and cannot share
 * an import (Python vs a JSON config), exactly like head.ut ↔ fs-prefs.js — so this holds the CONTRACT
 * instead: derive the list from each and fail if they disagree.
 *
 * Why it needs a gate at all: adding a file to one list and forgetting the other fails SILENTLY in the
 * worse direction — audit.py would flag a legitimate flag as stray, or stylelint would wave a new
 * flag through that audit.py still rejects. CLAUDE.md promises "the same allowlist audit.py uses";
 * nothing but this holds it to that.
 *
 * Both lists implicitly include every styles/base/*.css (base carries the .left/.right/.center forcing
 * utilities and two inline-style fighters). Only the non-base, explicitly-named files are compared by
 * name; the base glob is asserted present on each side.
 */
import { join, basename } from 'node:path';

import { ROOT, read } from './lib/root.mjs';

const errors = [];

/* ---- audit.py: the BANG_OK set literal, plus its base glob -------------------------------- */
const auditSrc = read('tools/audit.py');
const auditBlock = auditSrc.match(/BANG_OK\s*=\s*\(\{([\s\S]*?)\}/);   /* up to the first `}` (the explicit set) */
if (!auditBlock) errors.push('tools/audit.py: BANG_OK set literal not found — this gate is broken, not the allowlist');
const auditNames = new Set(
	auditBlock ? [...auditBlock[1].matchAll(/"([\w.-]+\.css)"/g)].map((m) => m[1]) : []
);
const auditHasBaseGlob = /\(STYLES \/ "base"\)\.glob\("\*\.css"\)/.test(auditSrc);
if (!auditHasBaseGlob)
	errors.push('tools/audit.py: BANG_OK no longer unions styles/base via glob("*.css") — base would lose its !important exemption');

/* ---- .stylelintrc.json: the files list on the declaration-no-important:null override ------- */
const styleCfg = JSON.parse(read('.stylelintrc.json'));
const overrides = Array.isArray(styleCfg.overrides) ? styleCfg.overrides : [];
const bangOverride = overrides.find(
	(o) => o && o.rules && Object.prototype.hasOwnProperty.call(o.rules, 'declaration-no-important')
		&& o.rules['declaration-no-important'] === null
);
if (!bangOverride)
	errors.push('.stylelintrc.json: no override sets declaration-no-important:null — the !important allowlist is gone');
const styleFiles = (bangOverride && Array.isArray(bangOverride.files)) ? bangOverride.files : [];
const styleHasBaseGlob = styleFiles.some((f) => /\/base\/\*\.css$/.test(f));
if (bangOverride && !styleHasBaseGlob)
	errors.push('.stylelintrc.json: the allowlist no longer includes styles/base/*.css');
const styleNames = new Set(
	styleFiles.filter((f) => !/\/base\/\*\.css$/.test(f)).map((f) => basename(f))
);

/* ---- the two explicit sets must be identical ---------------------------------------------- */
for (const n of auditNames)
	if (!styleNames.has(n))
		errors.push(`'${n}' carries an !important exemption in audit.py but NOT in .stylelintrc.json — stylelint will reject a flag audit.py allows`);
for (const n of styleNames)
	if (!auditNames.has(n))
		errors.push(`'${n}' carries an !important exemption in .stylelintrc.json but NOT in audit.py — audit.py will flag a flag stylelint allows`);

if (errors.length) {
	console.error('FAIL: the !important allowlist has drifted between audit.py and .stylelintrc.json.');
	for (const e of errors) console.error('  - ' + e);
	process.exit(1);
}

console.log(`  ok   !important allowlist agrees: ${[...auditNames].sort().join(', ')} + styles/base/*.css`);
console.log('bang-ok: audit.py and .stylelintrc.json name the same files.');
