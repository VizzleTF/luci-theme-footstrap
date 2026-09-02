#!/usr/bin/env node
/* The browser floor, derived from the stylesheet instead of asserted in a doc nobody re-checks.
 *
 * Two failures this catches, both of which shipped silently before it existed:
 *
 * 1. A SELECTOR LIST that mixes a `:has()` part with a part that has none. A selector list is not
 *    forgiving, so one unsupported compound invalidates the WHOLE rule — `.table.fs-stacked .tr,
 *    .table.fs-stacked tfoot:not(:has(> .tr))` took `display: flex` off every stacked card in
 *    Firefox before 121, which is a broken mobile table rather than a missing refinement. Inside
 *    `:is()`/`:where()` the list IS forgiving, so that shape is allowed and is the fix.
 *
 * 2. A FEATURE arriving without anyone deciding what happens below its floor. Every at-rule,
 *    pseudo, value function and property in the built sheet is checked against
 *    tools/baselines/css-features.json; an unknown one fails and has to be classified.
 *
 * HARD vs SOFT is the whole judgement. HARD means a browser without it renders something broken or
 * unreadable, so its versions set the floor the theme claims. SOFT means the rule simply does not
 * apply and the page is plainer — those never raise the floor. `color-mix()` is SOFT only because
 * styles/04-nocolormix.css gives all 36 tokens static twins; delete that file and it is HARD.
 *
 * The claimed floor lives in docs/css.md between the two `css-floor` markers and is compared
 * against the computed one, so the doc cannot drift from the sheet.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import * as csstree from 'css-tree';
import { buildCss } from './lib/css.mjs';

const BASELINE = new URL('./baselines/css-features.json', import.meta.url);
const DOC = new URL('../docs/css.md', import.meta.url);
const ENGINES = [ 'chrome', 'firefox', 'safari' ];

/* Only features whose support is younger than the floor need an entry; everything older is carried
 * by the baseline file as `old`. Versions are the first stable release with unprefixed support. */
const FEATURES = {
	'pseudo:has':          { kind: 'soft', chrome: 105, firefox: 121, safari: 15.4 },
	'fn:color-mix':        { kind: 'soft', chrome: 111, firefox: 113, safari: 16.2 },
	'atrule:container':    { kind: 'soft', chrome: 105, firefox: 110, safari: 16.0 },
	'prop:text-wrap':      { kind: 'soft', chrome: 117, firefox: 137, safari: 17.5 },
	'prop:scrollbar-width':{ kind: 'soft', chrome: 121, firefox: 64,  safari: 18.2 },
	'prop:overflow-anchor':{ kind: 'soft', chrome: 56,  firefox: 66,  safari: 99 },
	/* view transitions: the swap animates where they exist and is instant where they do not
	 * (fs-router.js only starts one when the API answers). Baseline 2025-10-14. */
	'pseudoel:view-transition':     { kind: 'soft', chrome: 111, firefox: 144, safari: 18 },
	'pseudoel:view-transition-old': { kind: 'soft', chrome: 111, firefox: 144, safari: 18 },
	'pseudoel:view-transition-new': { kind: 'soft', chrome: 111, firefox: 144, safari: 18 },

	/* HARD: no fallback exists and the page is wrong without them. */
	'atrule:layer':        { kind: 'hard', chrome: 99,  firefox: 97,  safari: 15.4 },
	'pseudo:is':           { kind: 'hard', chrome: 88,  firefox: 78,  safari: 14 },
	'pseudo:where':        { kind: 'hard', chrome: 88,  firefox: 78,  safari: 14 },
	'pseudo:focus-visible':{ kind: 'hard', chrome: 86,  firefox: 85,  safari: 15.4 },
	'unit:svh':            { kind: 'hard', chrome: 108, firefox: 101, safari: 15.4 },
	'unit:dvh':            { kind: 'hard', chrome: 108, firefox: 101, safari: 15.4 },
	'prop:accent-color':   { kind: 'hard', chrome: 93,  firefox: 92,  safari: 15.4 },
	'prop:aspect-ratio':   { kind: 'hard', chrome: 88,  firefox: 89,  safari: 15 },
	'prop:inset-inline':   { kind: 'hard', chrome: 87,  firefox: 63,  safari: 14.1 },
	'prop:padding-block':  { kind: 'hard', chrome: 87,  firefox: 66,  safari: 14.1 },
	'prop:color-scheme':   { kind: 'hard', chrome: 81,  firefox: 96,  safari: 13 },
};

const css = readFileSync(buildCss(), 'utf8');
const ast = csstree.parse(css, { parseValue: true });

const seen = new Set();
const hazards = [];

/* `:has()` under an `:is()`/`:where()` ancestor is safe — those lists forgive an unsupported
 * compound and drop only it. Anywhere else, the list is all-or-nothing. */
function hasOutsideForgiving(selectorAst) {
	let found = false;
	csstree.walk(selectorAst, {
		enter(node, item, list) {
			if (node.type !== 'PseudoClassSelector' || node.name !== 'has') return;
			found = true;
		},
	});
	if (!found) return false;
	/* strip every :is()/:where() subtree, then look again */
	const clone = csstree.parse(csstree.generate(selectorAst), { context: 'selector' });
	let stillThere = false;
	const drop = (node) => {
		if (node.type !== 'PseudoClassSelector') return false;
		return node.name === 'is' || node.name === 'where';
	};
	csstree.walk(clone, {
		enter(node, item, list) {
			if (list && drop(node)) list.remove(item);
		},
	});
	csstree.walk(clone, { enter(node) { if (node.type === 'PseudoClassSelector' && node.name === 'has') stillThere = true; } });
	return stillThere;
}

csstree.walk(ast, {
	enter(node) {
		if (node.type === 'Atrule') seen.add(`atrule:${node.name}`);
		if (node.type === 'PseudoClassSelector') seen.add(`pseudo:${node.name}`);
		if (node.type === 'PseudoElementSelector') seen.add(`pseudoel:${node.name}`);
		if (node.type === 'Function') seen.add(`fn:${node.name.toLowerCase()}`);
		if (node.type === 'Dimension') seen.add(`unit:${node.unit.toLowerCase()}`);
		if (node.type === 'Declaration' && !node.property.startsWith('--'))
			seen.add(`prop:${node.property.replace(/^-\w+-/, '').toLowerCase()}`);
	},
});

csstree.walk(ast, {
	visit: 'Rule',
	enter(rule) {
		if (rule.prelude.type !== 'SelectorList') return;
		const parts = rule.prelude.children.toArray();
		if (parts.length < 2) return;
		const risky = parts.filter((p) => hasOutsideForgiving(p));
		if (risky.length && risky.length !== parts.length)
			hazards.push(csstree.generate(rule.prelude).slice(0, 160));
	},
});

const baseline = new Set(JSON.parse(readFileSync(BASELINE, 'utf8')).known);
const unknown = [ ...seen ].filter((k) => !baseline.has(k) && !FEATURES[k]).sort();

if (process.argv.includes('--update')) {
	const known = [ ...new Set([ ...baseline, ...seen ]) ].sort();
	writeFileSync(BASELINE, JSON.stringify({
		comment: 'Every CSS feature the built sheet uses. A new entry means a new browser-support '
			+ 'decision: classify it in tools/css-floor.mjs (hard/soft) before adding it here.',
		known,
	}, null, '\t') + '\n');
	console.log(`css-floor: baseline updated, ${known.length} features known.`);
	process.exit(0);
}

const floor = {};
for (const e of ENGINES) floor[e] = 0;
for (const [ key, f ] of Object.entries(FEATURES)) {
	if (f.kind !== 'hard' || !seen.has(key)) continue;
	for (const e of ENGINES) if (f[e] > floor[e]) floor[e] = f[e];
}

/* the doc's copy, between the markers */
const doc = readFileSync(DOC, 'utf8');
const block = doc.match(/<!-- css-floor -->([\s\S]*?)<!-- \/css-floor -->/);
let docMismatch = null;
if (!block) {
	docMismatch = 'docs/css.md carries no <!-- css-floor --> block';
} else {
	for (const e of ENGINES) {
		const m = block[1].match(new RegExp(`${e}\\s*(\\d+(?:\\.\\d+)?)`, 'i'));
		if (!m) { docMismatch = `docs/css.md states no ${e} version`; break; }
		if (Number(m[1]) !== floor[e]) {
			docMismatch = `docs/css.md says ${e} ${m[1]}, the sheet needs ${floor[e]}`;
			break;
		}
	}
}

console.log(`computed hard floor: ${ENGINES.map((e) => `${e} ${floor[e]}`).join(', ')}`);
const soft = Object.entries(FEATURES).filter(([ k, f ]) => f.kind === 'soft' && seen.has(k));
console.log(`progressive (no floor raised): ${soft.map(([ k ]) => k).join(', ') || 'none'}`);

let bad = false;
if (hazards.length) {
	bad = true;
	console.error('\n== selector lists that die whole without :has() ==');
	for (const h of hazards) console.error(`  ${h}`);
	console.error('  Split the rule, or wrap the list in :is() — a forgiving list drops only the\n'
		+ '  unsupported compound.');
}
if (unknown.length) {
	bad = true;
	console.error('\n== CSS features with no support decision ==');
	for (const u of unknown) console.error(`  ${u}`);
	console.error('  Classify each in tools/css-floor.mjs (hard = the page breaks without it,\n'
		+ '  soft = it only looks plainer), then run: node tools/css-floor.mjs --update');
}
if (docMismatch) {
	bad = true;
	console.error(`\n== the floor in docs/css.md does not match the sheet ==\n  ${docMismatch}`);
}
if (bad) process.exit(1);
console.log('ok — floor matches docs/css.md, no all-or-nothing :has() list, no unclassified feature.');
