#!/usr/bin/env node
/* A ratchet on the stylesheet's shape: pin the numbers that only get worse by accident, so they
 * cannot drift up one commit at a time. Not style opinions — each is an invariant
 * docs/conventions.md states in prose and nothing else enforces.
 *
 *   IMPORTANTS — which declarations may carry `!important` is documented: a fact about the cascade,
 *     not a preference. The count lives in LIMITS below and nowhere else, this header having
 *     already drifted a digit when it restated it. stylelint's allowlist stops a NEW file adding
 *     one; this stops the allowlisted files growing more.
 *   MAX SPECIFICITY — "do not let source order carry meaning… win on specificity instead"
 *     (docs/conventions.md). A rule needing a wilder selector than anything else is usually
 *     fighting a battle a cascade layer should have won for it.
 *   EMPTY RULES — always a mistake, and the concatenating build cannot see one.
 *
 * Lower a number when you make it true. Raising one is a decision, and wants a comment.
 *
 *   node tools/css-metrics.mjs [--show]      (--show also prints rule/selector/declaration counts)
 */
import { readFileSync } from 'node:fs';
import { analyze } from '@projectwallace/css-analyzer';
import { buildCss } from './lib/css.mjs';

const LIMITS = {
	/* The current split: theme and pages carry the flags that fight an inline or unlayered declaration
	 * plus the reduced-motion block, whose `*` selector cannot beat a component rule in its own layer
	 * any other way; base carries the forcing utilities and `[hidden]`.
	 *
	 * `[hidden]` in base/10-reset.css is the one flag whose adversary is NOT an inline style: it is
	 * every `display` this theme sets on a class. The UA gives `hidden` the weakest `display: none`
	 * there is, so `.tr`, `.td`, `ul.nav > li`, `.cbi-page-actions` and `.ifacebox` all painted a
	 * hidden element anyway (measured), and no layer can hold that — a rule written tomorrow would
	 * re-open the hole.
	 *
	 * A raise is a decision and wants a line saying what was bought — the realtime-graph bleed is the
	 * sanctioned kind, the stock views writing `style="width:100%"` on the box they draw into, which
	 * no cascade layer can outrank. The port card's traffic figures are the other shape: one
	 * adversary, one property, two syntaxes, because an engine without `round()` drops the whole
	 * declaration, flag and all, and the fallback needs the flag for the same reason the rounded
	 * form does. A lowering is free and should be taken whenever a flag turns out to have no
	 * adversary.
	 *
	 * The card's two cell widths (theme/30-tables.css) buy the third adversary a layer cannot reach:
	 * a sheet in NO layer, which beats every layered rule at any specificity. luci-mod-dashboard
	 * ships one — measured at 390px, four cells of a station row at 81px on a single line with
	 * `flex-basis` computing to its 10%, so the card's pairs never formed. Two rather than one
	 * because a meter cell needs the whole line where a pair needs half, and those cannot be one
	 * declaration.
	 *
	 * Count these by PARSING, not by grepping: `grep -o '!important'` over styles/ answers far more,
	 * most of it the word inside the comments that justify the flags. What is ratcheted is important
	 * declarations in the BUILT sheet — css-tree is already a devDependency:
	 *   csstree.walk(ast, { visit: 'Declaration', enter: (n) => { if (n.important) count++; } }) */
	importants: 33,
	/* The widest selector the theme needs; see the layer rules in docs/conventions.md.
	 *
	 * Raised 6 -> 7 when the vertical sidebar's guard gained `:not([data-narrow])`: the sidebar gives
	 * way to the bar when the CONTENT column would be too narrow, which depends on the sidebar's own
	 * cut, so it cannot be a media query and has to be an attribute — every rule in the vertical and
	 * rail blocks therefore carries one attribute more. The ratchet did its job: it made the
	 * increase a decision rather than a drift. */
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
