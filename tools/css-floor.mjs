#!/usr/bin/env node
/* The browser floor, derived from the stylesheet instead of asserted in a doc nobody re-checks.
 *
 * Catches two silent failures: a selector list that mixes a `:has()` part with one that has none
 * (the list is not forgiving, so Firefox 115 lost `display: flex` on every stacked card; inside
 * `:is()`/`:where()` it is forgiving), and a feature with no decision about what happens below its
 * floor (every at-rule, pseudo, function and property is checked against
 * tools/baselines/css-features.json; an unknown one fails until classified).
 *
 * HARD means a browser without it renders something broken, so its versions set the floor. SOFT means
 * the rule just does not apply and never raises it; `color-mix()` is SOFT only because
 * styles/04-nocolormix.css gives all 26 tokens static twins (28 declarations).
 * A `value:prop=val` key covers a value whose support differs from its property's.
 * The claimed floor lives in docs/css.md between the `css-floor` markers and is compared with the
 * computed one; docs/css.md, "The browser floor", has the reasoning.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import * as csstree from 'css-tree';
import { join } from 'node:path';
import { buildCss } from './lib/css.mjs';
import { ROOT } from './lib/root.mjs';
import { parseFlags } from './lib/util.mjs';

const BASELINE = join(ROOT, 'tools/baselines/css-features.json');
const DOC = join(ROOT, 'docs/css.md');
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
	/* The visible oklch( nodes are the two @supports probes over the 9 relative-colour rules in
	 * 03-palettes.css (css-tree reads their custom-property values as Raw). Below them hue and ink stay the palette's. */
	'fn:oklch':            { kind: 'soft', chrome: 122, firefox: 128, safari: 18 },
	/* `overflow` is ancient, `clip` is Safari 16; a browser that drops it falls back to stock LuCI's
	 * rendering and `.fs-staging` stays `visibility: hidden` (docs/css.md, "The browser floor"). */
	'value:overflow=clip': { kind: 'soft', chrome: 90, firefox: 94, safari: 16 },

	/* HARD: no fallback exists and the page is wrong without them. */
	'atrule:layer':        { kind: 'hard', chrome: 99,  firefox: 97,  safari: 15.4 },
	'pseudo:is':           { kind: 'hard', chrome: 88,  firefox: 78,  safari: 14 },
	'pseudo:where':        { kind: 'hard', chrome: 88,  firefox: 78,  safari: 14 },
	'pseudo:focus-visible':{ kind: 'hard', chrome: 86,  firefox: 85,  safari: 15.4 },
	'unit:svh':            { kind: 'hard', chrome: 108, firefox: 101, safari: 15.4 },
	'unit:dvh':            { kind: 'hard', chrome: 108, firefox: 101, safari: 15.4 },
	'prop:accent-color':   { kind: 'hard', chrome: 93,  firefox: 92,  safari: 15.4 },
	'prop:inset-inline':   { kind: 'hard', chrome: 87,  firefox: 63,  safari: 14.1 },
	'prop:padding-block':  { kind: 'hard', chrome: 87,  firefox: 66,  safari: 14.1 },
	'prop:color-scheme':   { kind: 'hard', chrome: 81,  firefox: 96,  safari: 13 },
	/* logical corner radii mirror a table's four outer corners in RTL; all below the floor */
	'prop:border-start-start-radius': { kind: 'hard', chrome: 89, firefox: 66, safari: 15 },
	'prop:border-start-end-radius':   { kind: 'hard', chrome: 89, firefox: 66, safari: 15 },
	'prop:border-end-start-radius':   { kind: 'hard', chrome: 89, firefox: 66, safari: 15 },
	'prop:border-end-end-radius':     { kind: 'hard', chrome: 89, firefox: 66, safari: 15 },
};

const FLAGS = parseFlags('css-floor', { update: { type: 'boolean', default: false } });

const css = readFileSync(buildCss(), 'utf8');
const ast = csstree.parse(css, { parseValue: true });

const seen = new Set();
const hazards = [];

csstree.walk(ast, {
	enter(node) {
		if (node.type === 'Atrule') seen.add(`atrule:${node.name}`);
		if (node.type === 'PseudoClassSelector') seen.add(`pseudo:${node.name}`);
		if (node.type === 'PseudoElementSelector') seen.add(`pseudoel:${node.name}`);
		if (node.type === 'Function') seen.add(`fn:${node.name.toLowerCase()}`);
		if (node.type === 'Dimension') seen.add(`unit:${node.unit.toLowerCase()}`);
		if (node.type === 'Declaration' && !node.property.startsWith('--')) {
			const prop = node.property.replace(/^-\w+-/, '').toLowerCase();
			seen.add(`prop:${prop}`);
			if (/^overflow(-[xy])?$/.test(prop)
				&& csstree.find(node.value, (n) => n.type === 'Identifier' && n.name.toLowerCase() === 'clip'))
				seen.add('value:overflow=clip');
		}
	},
});

/* `:has()` under an `:is()`/`:where()` ancestor is safe — those lists forgive an unsupported
 * compound and drop only it. Anywhere else, the list is all-or-nothing. */
function hasOutsideForgiving(selector) {
	let depth = 0, hit = false;
	csstree.walk(selector, {
		enter(node) {
			if (node.type !== 'PseudoClassSelector') return;
			if (node.name === 'is' || node.name === 'where') depth++;
			else if (node.name === 'has' && !depth) hit = true;
		},
		leave(node) {
			if (node.type === 'PseudoClassSelector' && (node.name === 'is' || node.name === 'where')) depth--;
		},
	});
	return hit;
}

csstree.walk(ast, {
	visit: 'Rule',
	enter(rule) {
		if (rule.prelude.type !== 'SelectorList') return;
		const parts = rule.prelude.children.toArray();
		if (parts.length < 2) return;
		const risky = parts.filter(hasOutsideForgiving);
		if (risky.length && risky.length !== parts.length)
			hazards.push(csstree.generate(rule.prelude).slice(0, 160));
	},
});

const baseline = new Set(JSON.parse(readFileSync(BASELINE, 'utf8')).known);
const unknown = [ ...seen ].filter((k) => !baseline.has(k) && !FEATURES[k]).sort();

if (FLAGS.update) {
	const known = [ ...seen ].sort();
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
