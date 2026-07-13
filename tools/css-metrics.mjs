#!/usr/bin/env node
/* A RATCHET on the stylesheet's shape — the same idea as the font-byte budget in
 * build-css.sh: pin the numbers that only ever get worse by accident, so they cannot drift
 * up one commit at a time.
 *
 * These are not style opinions. Each one is an invariant CLAUDE.md already states in prose
 * and that nothing enforced:
 *
 *   IMPORTANTS — the theme documents exactly which declarations may carry `!important`
 *     (16 in theme+pages that fight an inline or unlayered declaration, 17 in base). That
 *     count is a fact about the cascade, not a preference. stylelint's
 *     `declaration-no-important` + its allowlist stops a NEW file adding one; this stops
 *     the allowlisted files quietly growing more.
 *
 *   MAX SPECIFICITY — "Do not let source order carry meaning… win on specificity instead."
 *     A rule that needs a wilder selector than anything else in the sheet is usually
 *     fighting a battle that a cascade layer should have won for it.
 *
 *   EMPTY RULES — a selector with no declarations is always a mistake, and the concatenating
 *     build cannot see one.
 *
 * Lower a number when you make it true. Raising one is a decision, and wants a comment.
 *
 * Usage: node tools/css-metrics.mjs [--show]
 */
import { readFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze } from '@projectwallace/css-analyzer';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const LIMITS = {
	/* 16 (theme+pages, each fighting an inline or unlayered declaration) + 17 (base) */
	importants: 33,
	/* the widest selector the theme needs; see the layer rules in CLAUDE.md */
	maxSpecificity: [1, 6, 0],
	emptyRules: 0,
};

const tmp = join(mkdtempSync(join(tmpdir(), 'cssmetrics-')), 'cascade.css');
execFileSync(join(ROOT, 'luci-theme-footstrap', 'build-css.sh'), [tmp], { stdio: 'ignore' });
const result = analyze(readFileSync(tmp, 'utf8'));

const importants = result.declarations.importants.total;
const spec = result.selectors.specificity.max;			/* [a, b, c] */
const empty = result.rules.empty.total;

const cmp = (a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]);

if (process.argv.includes('--show')) {
	console.log(`rules            ${result.rules.total}`);
	console.log(`selectors        ${result.selectors.total} (${result.selectors.totalUnique} unique)`);
	console.log(`declarations     ${result.declarations.total} (${result.declarations.totalUnique} unique)`);
}

const fails = [];
console.log(`importants       ${importants}  (max ${LIMITS.importants})`);
if (importants > LIMITS.importants)
	fails.push(`importants ${importants} > ${LIMITS.importants}`);

console.log(`max specificity  [${spec}]  (max [${LIMITS.maxSpecificity}])`);
if (cmp(spec, LIMITS.maxSpecificity) > 0)
	fails.push(`max specificity [${spec}] > [${LIMITS.maxSpecificity}]`);

console.log(`empty rules      ${empty}  (max ${LIMITS.emptyRules})`);
if (empty > LIMITS.emptyRules)
	fails.push(`empty rules ${empty} > ${LIMITS.emptyRules}`);

if (fails.length) {
	console.error(`\nFAIL:\n  ${fails.join('\n  ')}`);
	console.error('\nEach limit is an invariant, not a preference — read the note at the top of');
	console.error('tools/css-metrics.mjs before raising one.');
	process.exit(1);
}
console.log('\nok — the sheet is within every budget.');
