#!/usr/bin/env node
/* A ratchet on the stylesheet's shape: pin the numbers that only get worse by accident, so they
 * cannot drift up one commit at a time. Each is an invariant docs/conventions.md states in prose.
 *
 *   IMPORTANTS — which declarations may carry `!important` is a fact about the cascade. The count
 *     lives in LIMITS only. stylelint's allowlist stops a NEW file adding one; this stops the
 *     allowlisted files growing more.
 *   EMPTY RULES — always a mistake; stylelint's block-no-empty misses `a{;}`, which the build's
 *     squeeze turns into `a{}`, so they are counted on the built sheet.
 *   Max specificity is stylelint's `selector-max-specificity` (.stylelintrc.json), not counted here.
 *
 * Lower a number when you make it true. Raising one is a decision, and wants a comment.
 *
 *   node tools/css-metrics.mjs
 */
import { readFileSync } from 'node:fs';
import * as csstree from 'css-tree';
import { buildCss } from './lib/css.mjs';

const LIMITS = {
	/* theme and pages carry the flags that fight an inline or unlayered declaration, base the forcing
	 * utilities and `[hidden]`. A raise wants a line saying what was bought; a lowering is free.
	 * Counted by parsing the built sheet, not by grepping the word out of the comments that justify
	 * the flags. Each flag's adversary: docs/css.md, "`!important` inverts layer order". */
	importants: 35,
	emptyRules: 0,
};

const ast = csstree.parse(readFileSync(buildCss(), 'utf8'), { positions: false });

let empty = 0, importants = 0;
csstree.walk(ast, (node) => {
	if (node.type === 'Rule' && node.block.children.isEmpty) empty++;
	if (node.type === 'Declaration' && node.important) importants++;
});

const fails = [];
console.log(`importants       ${importants}  (max ${LIMITS.importants})`);
if (importants > LIMITS.importants)
	fails.push(`importants ${importants} > ${LIMITS.importants}`);

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
