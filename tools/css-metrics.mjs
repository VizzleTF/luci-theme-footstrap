#!/usr/bin/env node
/* A RATCHET on the stylesheet's shape: pin the numbers that only get worse by accident, so they
 * cannot drift up one commit at a time. Not style opinions; each is an invariant CLAUDE.md states
 * in prose and nothing enforced. (The CSS size budget and the font-byte budget this once cited as
 * precedent are both GONE — build-css.sh keeps only a broken-build floor.)
 *
 *   IMPORTANTS — which declarations may carry `!important` is documented: a fact about the
 *     cascade, not a preference. The count lives in LIMITS below and nowhere else — this header
 *     used to restate it and had already drifted a digit, which is the failure build.yml refuses
 *     to repeat by name. stylelint's `declaration-no-important` + allowlist stops a NEW file adding one;
 *     this stops the allowlisted files growing more. A RATCHET: it was 33 while three flags in base
 *     were fighting footstrap's own rules rather than an inline one — the cascade answers that with
 *     a later layer, so they are gone and the number came down with them. Tighten it again whenever
 *     a flag goes, so it cannot drift back.
 *   MAX SPECIFICITY — "do not let source order carry meaning… win on specificity instead." A rule
 *     needing a wilder selector than anything else is usually fighting a battle a cascade layer
 *     should have won for it.
 *   EMPTY RULES — always a mistake, and the concatenating build cannot see one.
 *
 * Lower a number when you make it true. Raising one is a decision, and wants a comment.
 *
 * Usage: node tools/css-metrics.mjs [--show]
 */
import { readFileSync } from 'node:fs';
import { analyze } from '@projectwallace/css-analyzer';
import { buildCss } from './lib/css.mjs';

const LIMITS = {
	/* 17 (theme+pages, each fighting an inline or unlayered declaration) + 14 (base).
	 *
	 * Raised 30 -> 31 for theme/45-misc.css's realtime-graph bleed. It is the sanctioned kind: the
	 * stock views size their drawing from #view but write `style="width:100%"` on the box they draw
	 * into, so inside our padded card the canvas is 34px short and the newest samples are clipped —
	 * and an inline declaration is exactly what no cascade layer can outrank. */
	importants: 31,
	/* The widest selector the theme needs; see the layer rules in CLAUDE.md.
	 *
	 * Raised 6 -> 7 when the vertical sidebar's guard gained `:not([data-narrow])`. Not sprawl:
	 * the sidebar gives way to the bar when the CONTENT column would be too narrow, and that
	 * depends on the sidebar's own cut (224px expanded, 68px as a rail) — so it cannot be a
	 * media query and has to be an attribute. Every rule in the vertical and rail blocks
	 * therefore carries one attribute more; the deepest is the rail's paused-poll glyph at
	 * [1,7,0]. The ratchet did its job: it made the increase a decision, not a drift. */
	maxSpecificity: [1, 7, 0],
	emptyRules: 0,
};

const result = analyze(readFileSync(buildCss(), 'utf8'));

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
